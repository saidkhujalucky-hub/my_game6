import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server } from 'socket.io';
import {
  HEROES, MAX_PLAYERS, MAP_RADIUS, RESPAWN_MS, UPGRADE_COSTS,
  basePosition, clampToArena, publicPlayer
} from '../shared/config.js';

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });
const rooms = new Map();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');
app.get('/health', (_req, res) => res.json({ ok:true, rooms:rooms.size, players:[...rooms.values()].reduce((n,r)=>n+r.players.size,0) }));
app.use(express.static(dist));
app.get('*', (req,res) => {
  if (req.path.startsWith('/socket.io')) return res.status(404).end();
  res.sendFile(path.join(dist, 'index.html'), err => { if (err && !res.headersSent) res.status(404).send('Build the frontend first: npm run build'); });
});
const MAX_ROOM_LENGTH = 14;
const sanitize = s => String(s ?? '').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,18);
const now = () => Date.now();
function broadcastEffect(room, effect) { io.to(room.code).emit('effect', effect); }
function createRoom(code) {
  const npcs=Array.from({length:8},(_,i)=>{
    const a=i*Math.PI/4+.28,r=49+(i%3)*13;
    return {id:`npc-${i}`,x:Math.cos(a)*r,z:Math.sin(a)*r,
      homeX:Math.cos(a)*r,homeZ:Math.sin(a)*r,rot:a,hp:75,maxHp:75,
      respawnAt:0,lastAttack:0,phase:i*1.71,hero:0};
  });
  const room = {code,players:new Map(),npcs,projectiles:[],nextProjectile:1,lastIncome:now(),lastState:0,lastTurret:0};
  rooms.set(code,room); return room;
}
function roomOf(socket) { return rooms.get(socket.data.room); }
function playerOf(socket) { return roomOf(socket)?.players.get(socket.id); }
function roomSnapshot(room) {
  const t = now();
  return {room:room.code,players:[...room.players.values()].map(p=>publicPlayer(p,t)),npcs:room.npcs.map(n=>({id:n.id,x:n.x,z:n.z,rot:n.rot,hp:n.hp,maxHp:n.maxHp,respawn:Math.max(0,n.respawnAt-t)})),projectiles:room.projectiles.map(({id,x,z,color,kind,owner})=>({id,x,z,color,kind,owner}))};
}
function emitRoom(room) { io.to(room.code).emit('snapshot',roomSnapshot(room)); }
function fireProjectile(room, p, dx, dz, opts={}) {
  const hero=HEROES[p.hero];
  const length=Math.hypot(dx,dz); if(length<0.001)return;
  dx/=length;dz/=length;
  const a={id:room.nextProjectile++,owner:p.id,x:p.x+dx*2.1,z:p.z+dz*2.1,
    dx,dz,speed:opts.speed??hero.projectileSpeed,damage:opts.damage??hero.damage,
    color:opts.color??hero.color,kind:opts.kind??'shot',life:0,maxLife:opts.maxLife??1950,
    radius:opts.radius??1.55};
  room.projectiles.push(a);
  broadcastEffect(room,{type:'muzzle',x:a.x,z:a.z,color:a.color});
}
function damageNPC(room,npc,amount,attackerId) {
  if(npc.respawnAt)return;
  npc.hp=Math.max(0,npc.hp-amount);
  broadcastEffect(room,{type:'hit',x:npc.x,z:npc.z,color:0xffb76b,damage:amount});
  if(npc.hp===0){
    npc.respawnAt=now()+7000;
    const player=room.players.get(attackerId);
    if(player){player.coins+=45;io.to(room.code).emit('feed',{text:`${player.name} уничтожил дрона (+45 кредитов)`});}
    broadcastEffect(room,{type:'down',x:npc.x,z:npc.z,color:0xffaf67});
  }
}
function damagePlayer(room,p,amount,attackerId) {
  if(p.hp<=0 || p.respawnAt)return;
  const t=now();
  if(p.shieldUntil>t) amount=Math.ceil(amount*0.25);
  p.hp=Math.max(0,p.hp-amount);
  broadcastEffect(room,{type:'hit',x:p.x,z:p.z,color:HEROES[p.hero].color,damage:amount});
  if(p.hp===0){
    p.respawnAt=t+RESPAWN_MS;p.downs++;
    const killer=room.players.get(attackerId);
    if(killer && killer.id!==p.id){killer.kills++;killer.coins+=95;}
    broadcastEffect(room,{type:'down',x:p.x,z:p.z,color:HEROES[p.hero].color,name:p.name});
    io.to(room.code).emit('feed',{text:`${killer ? killer.name : 'Боевой дрон'} выбил ${p.name}${killer?' (+95 кредитов)':''}`});
  }
}
function nearestEnemy(room,source,range){
  let result=null,best=range*range;
  for(const p of room.players.values()){
    if(p.id===source.id || p.hp<=0 || p.respawnAt)continue;
    const d=(source.x-p.x)**2+(source.z-p.z)**2;
    if(d<best){best=d;result=p;}
  }
  return result;
}
function dropPlayer(socket){
  const room=roomOf(socket); if(!room)return;
  const p=room.players.get(socket.id);
  if(p){room.players.delete(socket.id);socket.leave(room.code);io.to(room.code).emit('feed',{text:`${p.name} вышел из игры`});}
  if(room.players.size===0)rooms.delete(room.code);
  else emitRoom(room);
  socket.data.room=undefined;
}

io.on('connection',socket=>{
  socket.on('join',(payload={},ack=()=>{})=>{
    if(typeof ack!=='function')ack=()=>{};
    if(socket.data.room)dropPlayer(socket);
    let code=String(payload.room||'PUBLIC').replace(/[^a-zA-Z0-9-]/g,'').toUpperCase().slice(0,MAX_ROOM_LENGTH)||'PUBLIC';
    if(code==='PUBLIC'){
      let i=1;
      while(rooms.get(i===1?'PUBLIC':`PUBLIC-${i}`)?.players.size>=MAX_PLAYERS)i++;
      code=i===1?'PUBLIC':`PUBLIC-${i}`;
    }
    const room=rooms.get(code)||createRoom(code);
    if(room.players.size>=MAX_PLAYERS)return ack({ok:false,error:'Комната заполнена. Максимум 12 игроков.'});
    const taken=new Set([...room.players.values()].map(p=>p.hero));
    const requested=Number(payload.hero);
    const hero=Number.isInteger(requested)&&requested>=0&&requested<HEROES.length&&!taken.has(requested)?requested:
      HEROES.findIndex((_,i)=>!taken.has(i));
    const occupied=new Set([...room.players.values()].map(p=>p.slot));
    const slot=Array.from({length:MAX_PLAYERS},(_,i)=>i).find(i=>!occupied.has(i));
    const pos=basePosition(slot);
    const info=HEROES[hero];
    const p={id:socket.id,hero,slot,name:sanitize(payload.name)||`Герой ${slot+1}`,
      x:pos.x*0.91,z:pos.z*0.91,rot:0,hp:info.hp,maxHp:info.hp,energy:100,
      coins:180,kills:0,downs:0,baseLevel:0,respawnAt:0,lastAttack:0,lastSkill:-1e15,
      shieldUntil:0,boostUntil:0,lastMove:now(),lastTurret:0};
    room.players.set(socket.id,p);socket.data.room=room.code;socket.join(room.code);
    ack({ok:true,id:p.id,room:room.code,hero,slot,player:publicPlayer(p)});
    broadcastEffect(room,{type:'spawn',x:p.x,z:p.z,color:info.color});
    io.to(room.code).emit('feed',{text:`${p.name} присоединился к арене (${room.players.size}/12)`});
    emitRoom(room);
  });
  socket.on('move',(data={})=>{
    const p=playerOf(socket);if(!p||p.respawnAt)return;
    const x=Number(data.x),z=Number(data.z),rot=Number(data.rot);
    if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(rot))return;
    const t=now(),dt=Math.max(0,Math.min((t-p.lastMove)/1000,0.25));p.lastMove=t;
    const hero=HEROES[p.hero],speed=hero.speed*(p.boostUntil>t?1.6:1);
    const maxDistance=speed*dt*1.8+1.4;
    const distance=Math.hypot(x-p.x,z-p.z);
    const factor=distance>maxDistance?maxDistance/distance:1;
    const next=clampToArena(p.x+(x-p.x)*factor,p.z+(z-p.z)*factor);
    p.x=next.x;p.z=next.z;p.rot=rot%(Math.PI*2);
  });
  socket.on('attack',(data={})=>{
    const p=playerOf(socket);if(!p||p.respawnAt)return;
    const t=now(),hero=HEROES[p.hero];
    if(t-p.lastAttack<hero.rate)return;
    const dx=Number(data.dx),dz=Number(data.dz);
    if(!Number.isFinite(dx)||!Number.isFinite(dz)||Math.hypot(dx,dz)<0.1)return;
    p.lastAttack=t;
    fireProjectile(roomOf(socket),p,dx,dz);
  });
  socket.on('ability',(data={})=>{
    const room=roomOf(socket),p=playerOf(socket);if(!p||p.respawnAt)return;
    const t=now(),hero=HEROES[p.hero];
    if(t-p.lastSkill<hero.skillCooldown || p.energy<hero.skillCost)return;
    p.energy-=hero.skillCost;p.lastSkill=t;
    let dx=Number(data.dx),dz=Number(data.dz);
    if(!Number.isFinite(dx)||!Number.isFinite(dz)||Math.hypot(dx,dz)<0.1){dx=Math.sin(p.rot);dz=Math.cos(p.rot);}
    const len=Math.hypot(dx,dz);dx/=len;dz/=len;
    if(hero.skill==='shield')p.shieldUntil=t+6500;
    else if(hero.skill==='heal')p.hp=Math.min(p.maxHp,p.hp+57);
    else if(hero.skill==='speed')p.boostUntil=t+6500;
    else if(hero.skill==='dash'||hero.skill==='blink'){
      const dist=hero.skill==='dash'?20:29;
      const pos=clampToArena(p.x+dx*dist,p.z+dz*dist);
      p.x=pos.x;p.z=pos.z;p.lastMove=t;
      if(hero.skill==='dash'){
        for(const target of room.players.values()){
          if(target.id===p.id||target.respawnAt)continue;
          if(Math.hypot(target.x-p.x,target.z-p.z)<8)damagePlayer(room,target,23,p.id);
        }
        for(const npc of room.npcs)if(Math.hypot(npc.x-p.x,npc.z-p.z)<8)damageNPC(room,npc,23,p.id);
      }
    }else if(hero.skill==='nova'){
      for(const target of room.players.values()){
        if(target.id===p.id||target.respawnAt)continue;
        if(Math.hypot(target.x-p.x,target.z-p.z)<18)damagePlayer(room,target,38,p.id);
      }
      for(const npc of room.npcs)if(Math.hypot(npc.x-p.x,npc.z-p.z)<18)damageNPC(room,npc,38,p.id);
    }else if(hero.skill==='barrage'){
      for(let i=0;i<12;i++){
        const a=i*Math.PI/6;
        fireProjectile(room,p,Math.cos(a),Math.sin(a),{damage:13,maxLife:1400,speed:34});
      }
    }
    broadcastEffect(room,{type:hero.skill,x:p.x,z:p.z,color:hero.color,playerId:p.id});
    emitRoom(room);
  });
  socket.on('upgrade',(_data={},ack=()=>{})=>{
    const room=roomOf(socket),p=playerOf(socket);
    if(typeof ack!=='function')ack=()=>{};
    if(!p||p.respawnAt)return ack({ok:false,error:'Сначала нужно возродиться'});
    const home=basePosition(p.slot);
    if(Math.hypot(p.x-home.x,p.z-home.z)>25)return ack({ok:false,error:'Вернись к своей базе'});
    if(p.baseLevel>=3)return ack({ok:false,error:'База уже полностью улучшена'});
    const cost=UPGRADE_COSTS[p.baseLevel];
    if(p.coins<cost)return ack({ok:false,error:`Нужно ${cost} кредитов`});
    p.coins-=cost;p.baseLevel++;
    ack({ok:true,level:p.baseLevel});
    broadcastEffect(room,{type:'upgrade',x:home.x,z:home.z,color:HEROES[p.hero].color});
    io.to(room.code).emit('feed',{text:`${p.name} улучшил базу до уровня ${p.baseLevel}`});
    emitRoom(room);
  });
  socket.on('disconnect',()=>dropPlayer(socket));
});

let lastTick=now();
setInterval(()=>{
  const t=now(),dt=Math.min((t-lastTick)/1000,0.08);lastTick=t;
  for(const room of rooms.values()){
    for(const npc of room.npcs){
      if(npc.respawnAt){
        if(t>=npc.respawnAt){npc.respawnAt=0;npc.hp=npc.maxHp;npc.x=npc.homeX;npc.z=npc.homeZ;
          broadcastEffect(room,{type:'spawn',x:npc.x,z:npc.z,color:0xffb66a});}
        else continue;
      }
      const opponent=nearestEnemy(room,{id:npc.id,x:npc.x,z:npc.z},53);
      let dx=0,dz=0;
      if(opponent){
        const distance=Math.hypot(opponent.x-npc.x,opponent.z-npc.z);
        dx=(opponent.x-npc.x)/Math.max(1,distance);dz=(opponent.z-npc.z)/Math.max(1,distance);
        if(distance>18){npc.x+=dx*dt*5.8;npc.z+=dz*dt*5.8;}
        npc.rot=Math.atan2(dx,dz);
        if(distance<49 && t-npc.lastAttack>2200){
          npc.lastAttack=t;
          fireProjectile(room,npc,dx,dz,{damage:9,speed:29,color:0xffaf67,kind:'drone',maxLife:1600,radius:1.35});
        }
      }else{
        npc.phase+=dt*.39;
        npc.x+=(npc.homeX+Math.cos(npc.phase)*10-npc.x)*dt*.45;
        npc.z+=(npc.homeZ+Math.sin(npc.phase)*10-npc.z)*dt*.45;
        npc.rot=npc.phase+Math.PI/2;
      }
    }
    for(const p of room.players.values()){
      if(p.respawnAt && t>=p.respawnAt){
        const home=basePosition(p.slot);
        p.x=home.x*0.91;p.z=home.z*0.91;
        p.hp=p.maxHp;p.energy=100;p.respawnAt=0;p.shieldUntil=t+2500;p.lastMove=t;
        broadcastEffect(room,{type:'spawn',x:p.x,z:p.z,color:HEROES[p.hero].color});
      }
      if(!p.respawnAt)p.energy=Math.min(100,p.energy+dt*7.5);
    }
    if(t-room.lastIncome>=4000){
      const ticks=Math.min(3,Math.floor((t-room.lastIncome)/4000));
      room.lastIncome=t;
      for(const p of room.players.values())p.coins+=ticks*(14+p.baseLevel*11);
    }
    for(const ball of room.projectiles){
      ball.x+=ball.dx*ball.speed*dt;ball.z+=ball.dz*ball.speed*dt;ball.life+=dt*1000;
      if(Math.hypot(ball.x,ball.z)>MAP_RADIUS-2)ball.life=ball.maxLife;
      if(ball.life>=ball.maxLife)continue;
      for(const target of room.players.values()){
        if(target.id===ball.owner || target.respawnAt)continue;
        if(Math.hypot(ball.x-target.x,ball.z-target.z)<ball.radius+1.15){
          damagePlayer(room,target,ball.damage,ball.owner);
          broadcastEffect(room,{type:'impact',x:ball.x,z:ball.z,color:ball.color});
          ball.life=ball.maxLife;break;
        }
      }
      if(ball.life>=ball.maxLife || ball.owner.startsWith('npc-'))continue;
      for(const npc of room.npcs){
        if(npc.respawnAt || Math.hypot(ball.x-npc.x,ball.z-npc.z)>ball.radius+1.7)continue;
        damageNPC(room,npc,ball.damage,ball.owner);
        ball.life=ball.maxLife;
        break;
      }
    }
    room.projectiles=room.projectiles.filter(p=>p.life<p.maxLife);
    if(t-room.lastTurret>=450){
      room.lastTurret=t;
      for(const p of room.players.values()){
        if(p.baseLevel<2 || p.respawnAt || t-p.lastTurret<1900)continue;
        const home=basePosition(p.slot);
        const target=nearestEnemy(room,{...p,x:home.x,z:home.z},39);
        if(target){
          p.lastTurret=t;
          const dir={x:target.x-home.x,z:target.z-home.z};const len=Math.hypot(dir.x,dir.z);
          if(len>0.1){
            const proxy={...p,x:home.x,z:home.z};
            fireProjectile(room,proxy,dir.x/len,dir.z/len,{damage:15,speed:49,color:0xffc85c,kind:'turret',maxLife:1100});
          }
        }
      }
    }
    if(t-room.lastState>=100){room.lastState=t;emitRoom(room);}
  }
},50);

const port=Number(process.env.PORT)||3001;
httpServer.listen(port,'0.0.0.0',()=>console.log(`HERO ISLANDS server: http://localhost:${port}`));
