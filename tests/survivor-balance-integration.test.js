import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,stepGame,choose,normalizeGameSnapshot,isBossRound,grantExperience} from '../survival/engine.js';
import {HEROES} from '../survival/heroes.js';

test('all run lengths end at a real boss and default is ten rounds',()=>{
  assert.equal(createGame().maxRounds,10);
  for(const [length,n] of [['quick',5],['standard',10],['long',20]]){
    const g=createGame({length});assert.equal(g.maxRounds,n);
    g.round=n;assert.ok(isBossRound(g));stepGame(g,{},.01);assert.ok(g.bossArena);assert.equal(g.enemies.find(e=>e.kind==='boss').modelId,'astra');
  }
});

test('boss confinement survives choice/save/load, pauses, and releases immediately upon defeat',()=>{
  const g=createGame({length:'long'});g.round=10;g.player.invulnerable=100;g.player.shotTimer=100;stepGame(g,{},.01);
  assert.equal(g.enemies.find(e=>e.kind==='boss').modelId,'fable');
  for(let i=0;i<400;i++)stepGame(g,{},.05);
  assert.equal(g.bossArena.radius,480);assert.ok(g.bossHazards.length<=12);
  grantExperience(g,8);assert.equal(g.phase,'trait');const age=g.bossArena.age;
  const restored=normalizeGameSnapshot(g);stepGame(restored,{},.05);assert.equal(restored.bossArena.age,age);
  choose(restored,restored.choices[0].id);assert.equal(restored.phase,'playing');
  const boss=restored.enemies.find(e=>e.kind==='boss');boss.hp=1;restored.enemies=[boss];
  restored.bullets=[{x:boss.x,y:boss.y,vx:0,vy:0,radius:5,life:1,hits:1,hitIds:[],damage:9999}];stepGame(restored,{},.01);
  assert.equal(restored.bossArena,null);assert.deepEqual(restored.bossHazards,[]);assert.equal(restored.bossDefeated,true);
});

test('each repeated damage choice adds to the base and high-power upgrades have smaller marginal returns',()=>{
  const g=createGame({hero:'qwen'}),values=[g.player.damage];
  for(let i=0;i<9;i++){g.phase='trait';g.pendingLevels=1;g.choices=[{id:'trait:damage',name:'damage',rarity:{label:'legendary'},multiplier:2}];choose(g,'trait:damage');values.push(g.player.damage);}
  assert.ok(Math.abs((values[2]-values[1])-(values[1]-values[0]))<1e-10);
  assert.ok(values[9]-values[8]<values[2]-values[1]);assert.ok(values[9]<HEROES.qwen.stats.damage*4);
});

test('saving does not revive a defeated player or change balanced live stats',()=>{
  const g=createGame({hero:'gemini'});g.player.health=0;g.phase='lost';
  assert.equal(normalizeGameSnapshot(g).player.health,0);
  for(const id of ['speed','fireRate','maxHealth','damage']){g.phase='trait';g.pendingLevels=1;g.choices=[{id:'trait:'+id,name:id,rarity:{label:'rare'},multiplier:2.1}];choose(g,'trait:'+id);}
  const r=normalizeGameSnapshot(g);
  for(const key of ['speed','fireRate','maxHealth','damage','health'])assert.equal(r.player[key],g.player[key],key);
});
