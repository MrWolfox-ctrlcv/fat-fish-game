import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, choose, continueRound, normalizeGameSnapshot, limits, isBossRound, roundDuration } from '../survival/engine.js';
import { MAPS, mapForRound, terrainFactor, ventPhase } from '../survival/maps.js';

test('twenty-round expedition visits all four maps with capped duration and a boss every fifth round',()=>{
  const g=createGame({length:"long"});const maps=new Set();
  for(let r=1;r<=20;r++){
    assert.equal(g.round,r);assert.equal(g.roundDuration,roundDuration(r));maps.add(g.scene.mapId);
    assert.equal(isBossRound(g),r%5===0);
    // Round completion still requires a real choice before continuing.
    g.phase='reward';g.choices=[{id:'gear:armor',name:'armor',multiplier:1,rarity:{id:'common',label:'普通'}}];
    choose(g,'gear:armor');assert.equal(g.phase,'rest');continueRound(g);
  }
  assert.equal(g.phase,'won');assert.equal(maps.size,4);assert.equal(roundDuration(20),75);
});

test('each chapter boss gates completion and receives progressively more health',()=>{
  const health=[];
  for(const round of [5,10,15,20]){
    const g=createGame();g.round=round;g.roundTime=1000;g.player.invulnerable=100;
    stepGame(g,{},.01);const boss=g.enemies.find(e=>e.kind==='boss');
    assert.ok(boss);health.push(boss.maxHp);assert.equal(g.phase,'playing');
    boss.hp=.1;boss.x=g.player.x+30;boss.y=g.player.y;g.player.damage=10000;g.player.shotTimer=0;
    for(let i=0;i<20&&g.phase==='playing';i++)stepGame(g,{},.05);
    while(g.phase==='trait')choose(g,g.choices[0].id);
    assert.equal(g.phase,'reward');
  }
  assert.ok(health.every((x,i)=>i===0||x>health[i-1]));
});

test('legacy ten-round saves keep their campaign, RNG, hp and completion route',()=>{
  const old=createGame({seed:123});old.maxRounds=10;delete old.campaignVersion;delete old.scene;old.round=10;old.phase='rest';old.player.health=42;
  const loaded=normalizeGameSnapshot(old);
  assert.equal(loaded.maxRounds,10);assert.equal(loaded.rng,old.rng);assert.equal(loaded.player.health,42);
  assert.equal(loaded.scene.mapId,'moon');continueRound(loaded);assert.equal(loaded.phase,'won');
});

test('terrain slows players and enemies alike, while ground node state persists without new combat RNG',()=>{
  const g=createGame({seed:123});const terrain=MAPS[0].terrain[0];
  assert.ok(terrainFactor(g,terrain)<1);assert.equal(terrainFactor(g,{x:1280,y:800}),1);
  g.scene.nodes[0].hp=0;const rng=g.rng,loaded=normalizeGameSnapshot(g);
  assert.equal(loaded.scene.nodes[0].hp,0);assert.equal(loaded.rng,rng);
  assert.equal(mapForRound(6).id,'moon');assert.equal(mapForRound(11).id,'harbor');assert.equal(mapForRound(16).id,'abyss');
});

test('environment warning is harmless, active vent damages both sides, and paused games freeze it',()=>{
  const g=createGame();const vent=MAPS[0].vents[0];g.player.x=vent.x;g.player.y=vent.y;g.spawnTimer=g.chestTimer=100;g.player.shotTimer=100;g.player.damage=0;
  g.time=6;g.scene.nextPulseAt=0;assert.equal(ventPhase(g.time,vent),'warning');
  stepGame(g,{},.01);assert.equal(g.player.health,g.player.maxHealth);
  g.time=7.6;g.scene.nextPulseAt=0;
  const e={id:100,x:vent.x+40,y:vent.y,radius:10,hp:100,maxHp:100,speed:0,kind:'chaser',xp:1};g.enemies.push(e);
  stepGame(g,{},.01);assert.ok(g.player.health<g.player.maxHealth);assert.equal(e.hp,88);
  g.phase='trait';const time=g.time,hp=g.player.health;stepGame(g,{},.05);assert.equal(g.time,time);assert.equal(g.player.health,hp);
});

test('crystals can be broken by normal weapons once, and only a map change resets them',()=>{
  const g=createGame();g.spawnTimer=g.chestTimer=100;g.player.shotTimer=100;
  const node=g.scene.nodes[0];g.player.x=node.x+100;g.player.y=node.y;g.player.magnet=0;
  const shot=()=>({x:node.x,y:node.y,vx:0,vy:0,radius:8,life:1,damage:40,hits:1,hitIds:[]});
  g.bullets=[shot()];stepGame(g,{},.01);assert.equal(node.hp,0);assert.equal(g.orbs.reduce((n,o)=>n+o.value,0),5);
  g.bullets=[shot()];stepGame(g,{},.01);assert.equal(g.orbs.reduce((n,o)=>n+o.value,0),5);
  g.phase='rest';continueRound(g);assert.equal(g.scene.nodes[0].hp,0);
  g.round=5;g.phase='rest';g.inventory.rice=2;g.player.health=60;continueRound(g);
  assert.equal(g.scene.mapId,'moon');assert.equal(g.scene.nodes[0].hp,32);assert.equal(g.inventory.rice,2);assert.equal(g.player.health,60);
});

test('denser late waves respect entity limits and remain lighter on relaxed mode',()=>{
  const run=difficulty=>{const g=createGame({difficulty});g.round=12;g.roundDuration=1000;g.player.invulnerable=1000;g.player.shotTimer=1000;g.player.damage=0;
    for(let i=0;i<400;i++)stepGame(g,{},.05);return g;};
  const g=run('standard'),easy=run('relaxed');
  assert.ok(g.enemies.length>64);assert.ok(g.enemies.length<=limits.enemies);assert.ok(easy.enemies.length<g.enemies.length);
  assert.ok(g.bullets.length<=limits.bullets&&g.orbs.length<=limits.orbs);
});
