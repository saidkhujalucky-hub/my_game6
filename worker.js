import { HEROES, MAX_PLAYERS, RESPAWN_MS, UPGRADE_COSTS, basePosition, clampToArena, publicPlayer } from './shared/config.js';

// Cloudflare-native authoritative multiplayer backend: one Durable Object per arena shard.
// No Node.js process, external Socket.IO service, or database credentials are required.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/game-ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket upgrade required', { status: 426 });
      }
      const instance = env.ARENA.idFromName('global-arena-v1');
      return env.ARENA.get(instance).fetch(request);
    }
    if (url.pathname === '/health') {
      return Response.json({ ok: true, backend: 'cloudflare-durable-objects', version: 3 });
    }
    return env.ASSETS.fetch(request);
  }
};

const NOW = () => Date.now();
const MAX_PROJECTILES = 180;
const MAX_ROOMS = 100;
const cleanRoom = code => String(code || 'PUBLIC').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 14) || 'PUBLIC';
const cleanName = name => String(name || 'Герой').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18) || 'Герой';
const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const npcPayload = n => ({ id:n.id, x:n.x, z:n.z, rot:n.rot, hp:n.hp, maxHp:n.maxHp, respawn: Math.max(0,n.respawnAt-NOW()) });

export class Arena {
  constructor(ctx) {
    this.ctx = ctx;
    this.sessions = new Map();
    this.rooms = new Map();
    this.timer = null;
    this.lastTick = NOW();
  }
  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required', {status:426});
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    this.sessions.set(server, { id: crypto.randomUUID(), room: null });
    this.start();
    return new Response(null, {status:101, webSocket:client});
  }
  start() {
    if (!this.timer) {
      this.lastTick = NOW();
      this.timer = setInterval(() => this.tick(), 100);
    }
  }
  send(ws, type, data) {
    try { ws.send(JSON.stringify({ type, data })); }
    catch { this.leave(ws); this.sessions.delete(ws); }
  }
  sendTo(room, type, data) {
    for (const [ws,session] of this.sessions) if (session.room===room.code) this.send(ws,type,data);
  }
  ack(ws, requestId, result) {
    if (requestId !== undefined && requestId !== null) {
      try { ws.send(JSON.stringify({ type:'ack', requestId, result })); } catch {}
    }
  }
  newRoom(code) {
    const t=NOW();
    const npcs=Array.from({length:8},(_,i)=>{
      const a=i*Math.PI/4+.28, r=49+(i%3)*13;
      return {id:`npc-${i}`,x:Math.cos(a)*r,z:Math.sin(a)*r,homeX:Math.cos(a)*r,homeZ:Math.sin(a)*r,
        rot:a,hp:75,maxHp:75,respawnAt:0,lastAttack:0,phase:i*1.71};
    });
    const room={code,players:new Map(),npcs,projectiles:[],nextProjectile:1,lastIncome:t,lastSnapshot:0,lastTurret:t};
    this.rooms.set(code,room);
    return room;
  }
  leave(ws) {
    const session=this.sessions.get(ws);
    if (!session?.room) return;
    const room=this.rooms.get(session.room);
    // Disconnect before broadcasting, otherwise a closed socket can re-enter leave().
    session.room=null;
    if(room) {
      const p=room.players.get(session.id);
      room.players.delete(session.id);
      if(p) this.sendTo(room,'feed',{text:`${p.name} покинул арену`});
      if(!room.players.size) this.rooms.delete(room.code);
      else this.snapshot(room);
    }
  }
  webSocketClose(ws) { this.leave(ws); this.sessions.delete(ws); this.maybeStop(); }
  webSocketError(ws) { this.leave(ws); this.sessions.delete(ws); this.maybeStop(); }
  maybeStop() {
    if(this.sessions.size===0 && this.timer) { clearInterval(this.timer); this.timer=null; }
  }
  webSocketMessage(ws, raw) {
    if(typeof raw!=='string'||raw.length>2500)return;
    let msg;try{msg=JSON.parse(raw);}catch{return;}
    const session=this.sessions.get(ws);if(!session||typeof msg.type!=='string')return;
    const data=msg.data && typeof msg.data==='object' ? msg.data : {};
    const ack=result=>this.ack(ws,msg.requestId,result);
    if(msg.type==='join')return this.join(ws,session,data,ack);
    const room=this.rooms.get(session.room),p=room?.players.get(session.id);
    if(!p)return;
    if(msg.type==='move') {
      if(p.respawnAt)return;
      const x=Number(data.x),z=Number(data.z),rot=Number(data.rot);
      if(![x,z,rot].every(Number.isFinite))return;
      const t=NOW(),dt=Math.max(.016, Math.min((t-p.lastMove)/1000,.26));
      p.lastMove=t;
      const maxDistance=HEROES[p.hero].speed*(p.boostUntil>t?1.6:1)*dt*1.8+1.8;
      const distance=Math.hypot(x-p.x,z-p.z);
      const factor=distance>maxDistance?maxDistance/distance:1;
      const next=clampToArena(p.x+(x-p.x)*factor,p.z+(z-p.z)*factor);
      p.x=next.x;p.z=next.z;p.rot=rot%(Math.PI*2);
    } else if(msg.type==='attack') {
      if(p.respawnAt)return;
      const hero=HEROES[p.hero],t=NOW();
      if(t-p.lastAttack<hero.rate)return;
      const dx=Number(data.dx),dz=Number(data.dz);
      if(!Number.isFinite(dx)||!Number.isFinite(dz)||Math.hypot(dx,dz)<.1)return;
      p.lastAttack=t;this.fire(room,p,dx,dz);
    } else if(msg.type==='ability') {
      this.ability(room,p,data);
    } else if(msg.type==='upgrade') {
      if(p.respawnAt)return ack({ok:false,error:'Дождись возрождения'});
      const home=basePosition(p.slot);
      if(near(p,home)>25)return ack({ok:false,error:'Подойди ближе к своей базе'});
      if(p.baseLevel>=3)return ack({ok:false,error:'База полностью улучшена'});
      const cost=UPGRADE_COSTS[p.baseLevel];
      if(p.coins<cost)return ack({ok:false,error:`Не хватает ${cost-p.coins} кредитов`});
      p.coins-=cost;p.baseLevel++;
      ack({ok:true,level:p.baseLevel});
      this.sendTo(room,'effect',{type:'upgrade',x:home.x,z:home.z,color:HEROES[p.hero].color});
      this.sendTo(room,'feed',{text:`${p.name} улучшил базу до уровня ${p.baseLevel}`});
      this.snapshot(room);
    }
  }
  join(ws,session,data,ack) {
    this.leave(ws);
    let code=cleanRoom(data.room);
    if(code==='PUBLIC') {
      let i=1;
      while(this.rooms.get(i===1?'PUBLIC':`PUBLIC-${i}`)?.players.size>=MAX_PLAYERS && i<100)i++;
      code=i===1?'PUBLIC':`PUBLIC-${i}`;
    }
    let room=this.rooms.get(code);
    if(!room) {
      if(this.rooms.size>=MAX_ROOMS)return ack({ok:false,error:'Сервер перегружен. Выбери другую комнату позже.'});
      room=this.newRoom(code);
    }
    if(room.players.size>=MAX_PLAYERS)return ack({ok:false,error:'Комната заполнена (12/12)'});
    const used=new Set([...room.players.values()].map(p=>p.hero));
    const requested=Number(data.hero);
    const hero=Number.isInteger(requested)&&requested>=0&&requested<HEROES.length&&!used.has(requested)
      ? requested : HEROES.findIndex((_,i)=>!used.has(i));
    const busy=new Set([...room.players.values()].map(p=>p.slot));
    const slot=Array.from({length:MAX_PLAYERS},(_,i)=>i).find(i=>!busy.has(i));
    const pos=basePosition(slot),info=HEROES[hero],t=NOW();
    const p={id:session.id,hero,slot,name:cleanName(data.name),
      x:pos.x*.91,z:pos.z*.91,rot:0,hp:info.hp,maxHp:info.hp,energy:100,
      coins:180,kills:0,downs:0,baseLevel:0,respawnAt:0,lastAttack:0,lastSkill:-1e15,
      shieldUntil:0,boostUntil:0,lastMove:t,lastTurret:t};
    room.players.set(session.id,p);session.room=room.code;
    ack({ok:true,id:p.id,room:room.code,hero,slot,player:publicPlayer(p,t)});
    this.sendTo(room,'feed',{text:`${p.name} присоединился к арене (${room.players.size}/12)`});
    this.sendTo(room,'effect',{type:'spawn',x:p.x,z:p.z,color:info.color});
    this.snapshot(room);
  }
  fire(room,p,dx,dz,opts={}) {
    const h=HEROES[p.hero],len=Math.hypot(dx,dz);if(len<.1||room.projectiles.length>=MAX_PROJECTILES)return;
    const a={id:room.nextProjectile++,owner:p.id,x:p.x+dx/len*2.1,z:p.z+dz/len*2.1,
      dx:dx/len,dz:dz/len,speed:opts.speed??h.projectileSpeed,damage:opts.damage??h.damage,
      color:opts.color??h.color,kind:opts.kind??'shot',life:0,maxLife:opts.maxLife??1950,radius:opts.radius??1.6};
    room.projectiles.push(a);
    this.sendTo(room,'effect',{type:'muzzle',x:a.x,z:a.z,color:a.color});
  }
  damagePlayer(room,p,amount,attackerId) {
    if(p.hp<=0||p.respawnAt)return;
    const t=NOW();if(p.shieldUntil>t)amount=Math.ceil(amount*.25);
    p.hp=Math.max(0,p.hp-amount);
    this.sendTo(room,'effect',{type:'hit',x:p.x,z:p.z,color:HEROES[p.hero].color,damage:amount});
    if(p.hp===0) {
      p.respawnAt=t+RESPAWN_MS;p.downs++;
      const killer=room.players.get(attackerId);
      if(killer&&killer.id!==p.id){killer.kills++;killer.coins+=95;}
      this.sendTo(room,'effect',{type:'down',x:p.x,z:p.z,color:HEROES[p.hero].color,name:p.name});
      this.sendTo(room,'feed',{text:`${killer?.name||'Дрон'} победил ${p.name}`});
    }
  }
  damageNPC(room,n,amount,attackerId) {
    if(n.respawnAt)return;
    n.hp=Math.max(0,n.hp-amount);
    this.sendTo(room,'effect',{type:'hit',x:n.x,z:n.z,color:0xffc27b,damage:amount});
    if(n.hp===0) {
      n.respawnAt=NOW()+7000;
      const p=room.players.get(attackerId);
      if(p){p.coins+=45;this.sendTo(room,'feed',{text:`${p.name} уничтожил дрона (+45)`});}
      this.sendTo(room,'effect',{type:'down',x:n.x,z:n.z,color:0xffc27b});
    }
  }
  ability(room,p,data) {
    if(p.respawnAt)return;
    const h=HEROES[p.hero],t=NOW();
    if(t-p.lastSkill<h.skillCooldown||p.energy<h.skillCost)return;
    p.energy-=h.skillCost;p.lastSkill=t;
    let dx=Number(data.dx),dz=Number(data.dz);
    if(!Number.isFinite(dx)||!Number.isFinite(dz)||Math.hypot(dx,dz)<.1){dx=Math.sin(p.rot);dz=Math.cos(p.rot);}
    const len=Math.hypot(dx,dz);dx/=len;dz/=len;
    if(h.skill==='shield')p.shieldUntil=t+6500;
    else if(h.skill==='heal')p.hp=Math.min(p.maxHp,p.hp+57);
    else if(h.skill==='speed')p.boostUntil=t+6500;
    else if(h.skill==='blink'||h.skill==='dash') {
      const dist=h.skill==='dash'?20:29;
      const pos=clampToArena(p.x+dx*dist,p.z+dz*dist);
      p.x=pos.x;p.z=pos.z;p.lastMove=t;
      if(h.skill==='dash') {
        for(const target of room.players.values())if(target.id!==p.id&&near(target,p)<8)this.damagePlayer(room,target,23,p.id);
        for(const n of room.npcs)if(near(n,p)<8)this.damageNPC(room,n,23,p.id);
      }
    } else if(h.skill==='nova') {
      for(const target of room.players.values())if(target.id!==p.id&&near(target,p)<18)this.damagePlayer(room,target,38,p.id);
      for(const n of room.npcs)if(near(n,p)<18)this.damageNPC(room,n,38,p.id);
    } else if(h.skill==='barrage') {
      for(let i=0;i<12;i++){const a=i*Math.PI/6;this.fire(room,p,Math.cos(a),Math.sin(a),{damage:13,maxLife:1400,speed:34});}
    }
    this.sendTo(room,'effect',{type:h.skill,x:p.x,z:p.z,color:h.color,playerId:p.id});
    this.snapshot(room);
  }
  snapshot(room) {
    const t=NOW();
    const packet={room:room.code,players:[...room.players.values()].map(p=>publicPlayer(p,t)),
      npcs:room.npcs.map(npcPayload),
      projectiles:room.projectiles.map(({id,x,z,color,kind,owner})=>({id,x,z,color,kind,owner}))};
    this.sendTo(room,'snapshot',packet);
  }
  tick() {
    const t=NOW(),dt=Math.min(.25,Math.max(.001,(t-this.lastTick)/1000));this.lastTick=t;
    if(this.sessions.size===0){this.maybeStop();return;}
    for(const room of this.rooms.values()) {
      for(const p of room.players.values()) {
        p.energy=Math.min(100,p.energy+dt*7);
        if(p.respawnAt&&p.respawnAt<=t) {
          const home=basePosition(p.slot);p.x=home.x*.91;p.z=home.z*.91;
          p.hp=p.maxHp;p.energy=100;p.respawnAt=0;p.lastMove=t;
          this.sendTo(room,'effect',{type:'spawn',x:p.x,z:p.z,color:HEROES[p.hero].color});
        }
      }
      if(t-room.lastIncome>=4000) {
        const cycles=Math.min(5,Math.floor((t-room.lastIncome)/4000));
        room.lastIncome+=cycles*4000;
        for(const p of room.players.values())p.coins+=cycles*(14+11*p.baseLevel);
      }
      for(const n of room.npcs) {
        if(n.respawnAt) {
          if(n.respawnAt<=t){n.hp=n.maxHp;n.respawnAt=0;n.x=n.homeX;n.z=n.homeZ;}
          continue;
        }
        const a=t/1600+n.phase;
        n.x=n.homeX+Math.sin(a)*7;n.z=n.homeZ+Math.cos(a*.83)*7;
        n.rot=a;
        if(t-n.lastAttack>2100) {
          let closest=null,dist=24;
          for(const p of room.players.values())if(!p.respawnAt&&p.hp>0) {
            const d=near(p,n);if(d<dist){dist=d;closest=p;}
          }
          if(closest){n.lastAttack=t;this.damagePlayer(room,closest,9,'npc');}
        }
      }
      for(const bullet of room.projectiles) {
        bullet.life+=dt*1000;
        bullet.x+=bullet.dx*bullet.speed*dt;bullet.z+=bullet.dz*bullet.speed*dt;
        if(bullet.life>=bullet.maxLife){continue;}
        const attacker=room.players.get(bullet.owner);
        let hit=false;
        for(const p of room.players.values()) {
          if(p.id===bullet.owner||p.hp<=0||p.respawnAt)continue;
          if(near(p,bullet)<bullet.radius+1.2){this.damagePlayer(room,p,bullet.damage,bullet.owner);hit=true;break;}
        }
        if(!hit)for(const n of room.npcs){
          if(!n.respawnAt&&near(n,bullet)<bullet.radius+1.5){this.damageNPC(room,n,bullet.damage,bullet.owner);hit=true;break;}
        }
        if(hit)bullet.life=bullet.maxLife;
        if(!attacker)bullet.life=bullet.maxLife;
      }
      room.projectiles=room.projectiles.filter(p=>p.life<p.maxLife);
      if(t-room.lastTurret>500) {
        room.lastTurret=t;
        for(const p of room.players.values()) {
          if(p.baseLevel<2||p.respawnAt||t-p.lastTurret<2000)continue;
          const home=basePosition(p.slot);let enemy=null,dist=37;
          for(const other of room.players.values())if(other.id!==p.id&&!other.respawnAt){
            const d=near(other,home);if(d<dist){dist=d;enemy=other;}
          }
          if(enemy){p.lastTurret=t;this.fire(room,{...p,x:home.x,z:home.z},enemy.x-home.x,enemy.z-home.z,{damage:15,speed:49,color:0xffc85c,kind:'turret',maxLife:1100});}
        }
      }
      if(t-room.lastSnapshot>=100){room.lastSnapshot=t;this.snapshot(room);}
    }
  }
}
