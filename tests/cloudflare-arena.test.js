import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena } from '../worker.js';
import { MAX_PLAYERS } from '../shared/config.js';

function setup() {
  const arena = new Arena({});
  const peer = () => {
    const messages=[];
    const ws={send(raw){messages.push(JSON.parse(raw));}};
    const session={id:`id-${arena.sessions.size}`,room:null};
    arena.sessions.set(ws,session);
    return {ws,session,messages,send(type,data={},requestId=1){arena.webSocketMessage(ws,JSON.stringify({type,data,requestId}));},ack(){return messages.filter(m=>m.type==='ack').at(-1)?.result;}};
  };
  return {arena,peer};
}

test('Cloudflare multiplayer accepts twelve players, unique heroes and bases',()=>{
  const {arena,peer}=setup(), players=[];
  for(let i=0;i<MAX_PLAYERS;i++){
    const p=peer();p.send('join',{name:`Пилот ${i}`,hero:i,room:'TEST'});
    assert.equal(p.ack().ok,true);
    assert.equal(p.ack().slot,i);
    players.push(p);
  }
  assert.equal(arena.rooms.get('TEST').players.size,12);
  assert.equal(new Set([...arena.rooms.get('TEST').players.values()].map(x=>x.hero)).size,12);
  const extra=peer();extra.send('join',{room:'TEST',hero:0});
  assert.equal(extra.ack().ok,false);
  extra.send('join',{room:'PUBLIC',hero:0});assert.equal(extra.ack().ok,true);
  assert.equal(players[0].messages.filter(m=>m.type==='snapshot').length>0,true);
  assert.equal(players[0].messages.find(m=>m.type==='snapshot').data.npcs.length,8);
});

test('Cloudflare room handles moves, cooldowns, upgrades, and snapshots',()=>{
  const {arena,peer}=setup(),p=peer();p.send('join',{name:'Test',hero:0,room:'PUBLIC'});
  const room=arena.rooms.get('PUBLIC');const pilot=room.players.get(p.session.id);
  const initialX=pilot.x;
  p.send('move',{x:initialX+1,z:pilot.z,rot:0});
  assert.ok(pilot.x>initialX);
  p.send('attack',{dx:0,dz:1});assert.equal(room.projectiles.length,1);
  p.send('attack',{dx:0,dz:1});assert.equal(room.projectiles.length,1);
  p.send('ability',{dx:0,dz:1});assert.ok(pilot.energy<100);
  pilot.coins=1000;
  const home=pilot.slot;pilot.x=-150;pilot.z=0;
  p.send('upgrade',{},3);
  assert.equal(p.messages.filter(m=>m.type==='ack').at(-1).result.ok,false);
  pilot.x=0;pilot.z=-145;
  p.send('upgrade',{},4);
  assert.equal(p.messages.filter(m=>m.type==='ack').at(-1).result.ok,true);
  arena.tick();
  assert.ok(p.messages.filter(m=>m.type==='snapshot').length>=2);
});

test('Player and room cleanup on disconnect',()=>{
  const {arena,peer}=setup(),p=peer();p.send('join',{room:'SOLO'});
  arena.webSocketClose(p.ws);
  assert.equal(arena.rooms.has('SOLO'),false);
});
