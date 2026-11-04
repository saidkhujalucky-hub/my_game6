import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_RADIUS, HEROES, MAX_PLAYERS, MAP_RADIUS, UPGRADE_COSTS, basePosition, clampToArena, publicPlayer } from '../shared/config.js';

test('12 heroes with unique ids and abilities', () => {
  assert.equal(HEROES.length,12);
  assert.equal(new Set(HEROES.map(h=>h.id)).size,12);
  assert.ok(HEROES.every(h=>h.weapon&&h.ability&&h.damage>0&&h.hp>=100&&h.rate>=200));
});
test('12 distinct bases evenly spaced around map', () => {
  assert.equal(MAX_PLAYERS,12);
  const positions=Array.from({length:MAX_PLAYERS},(_,i)=>basePosition(i));
  for(const p of positions)assert.ok(Math.abs(Math.hypot(p.x,p.z)-BASE_RADIUS)<1e-8);
  const nearest=Math.hypot(positions[1].x-positions[0].x,positions[1].z-positions[0].z);
  assert.ok(nearest>60);
});
test('arena boundary and base upgrades',()=>{
  const inside=clampToArena(23,50);assert.deepEqual(inside,{x:23,z:50});
  const outside=clampToArena(700,800);assert.ok(Math.hypot(outside.x,outside.z)<=MAP_RADIUS-4+.01);
  assert.deepEqual(UPGRADE_COSTS,[120,260,480]);
});
test('public player serialization hides private state and computes cooldowns',()=>{
  const p={id:'a',name:'player',hero:0,slot:0,x:1,z:2,rot:0,hp:100,maxHp:125,energy:45.5,coins:160,baseLevel:1,kills:2,downs:0,shieldUntil:2000,boostUntil:0,respawnAt:0,lastSkill:0,lastAttack:50};
  const out=publicPlayer(p,1000);
  assert.equal(out.energy,46);assert.equal(out.shield,true);assert.equal(out.skillReady,HEROES[0].skillCooldown-1000);
  assert.ok(!('lastAttack' in out));
});
