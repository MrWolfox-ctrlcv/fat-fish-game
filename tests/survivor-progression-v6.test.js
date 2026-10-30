import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, normalizeGameSnapshot, grantExperience, choose } from '../survival/engine.js';
import { HEROES } from '../survival/heroes.js';

test('damage traits add power linearly and repeated high rarity stays within 5.5x base',()=>{
  const g=createGame({hero:'gemini'}),base=HEROES.gemini.stats.damage;
  for(let i=0;i<12;i++){
    g.phase='trait';g.pendingLevels=1;g.choices=[{id:'trait:damage',name:'高压水滴',rarity:{label:'传奇'},multiplier:3}];
    choose(g,'trait:damage');
  }
  assert.equal(g.traitPower.damage,30);
  assert.ok(g.player.damage<=base*5.5);
  assert.equal(g.player.damage,base*(1+.18*12+.06*18));
  assert.equal(g.traits.damage,12);
});

test('legacy overpowered snapshot recalculates legal stats and caps progression',()=>{
  const old=createGame({hero:'deepseek'});
  old.level=95;old.xp=999999;old.pendingLevels=300;old.traitPower={damage:1000,maxHealth:500,speed:100,fireRate:200};
  old.traits={damage:1000,maxHealth:500,speed:100,fireRate:200};old.player.damage=6670000;old.player.maxHealth=999999;old.player.health=999999;old.player.speed=999999;old.player.fireRate=.001;
  const g=normalizeGameSnapshot(old);
  assert.equal(g.level,40);assert.equal(g.pendingLevels,0);assert.equal(g.xp,0);
  assert.equal(g.traitPower.damage,30);assert.equal(g.traitPower.maxHealth,8);
  assert.equal(g.traits.damage,12);assert.equal(g.traits.maxHealth,8);
  assert.ok(g.player.damage<=HEROES.deepseek.stats.damage*5.5);
  assert.equal(g.player.maxHealth,HEROES.deepseek.stats.health+25*8);
  assert.equal(g.player.health,g.player.maxHealth);
  assert.ok(g.player.speed<1000);assert.ok(g.player.fireRate>=.12);
});

test('experience progression stops at level 40 and uses the slower curve',()=>{
  const g=createGame();
  grantExperience(g,1000000);
  assert.equal(g.level,40);assert.equal(g.pendingLevels,39);
  assert.equal(g.xpNeed,8+4*39+2*(40-8)**2);
  g.level=40;g.pendingLevels=0;g.phase='playing';g.xp=0;
  grantExperience(g,100000);
  assert.equal(g.level,40);assert.equal(g.pendingLevels,0);
});
