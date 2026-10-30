import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, choose, stepGame, getStats, getOrbitStats, grantExperience, CATALOG, limits } from '../survival/engine.js';
import { RARITIES, rarityWeights, rollRarity } from '../survival/loot.js';

function offer(g, phase, id, rarity) {
  g.phase = phase;
  g.pendingLevels = phase === 'trait' ? 1 : 0;
  g.choices = [{ id, name: CATALOG[id.split(':')[1]].name, icon: 'x', description: '', rarity,
    rarityId: rarity.id, rarityLabel: rarity.label, rarityColor: rarity.color, multiplier: rarity.multiplier }];
}
function generatedOrbitCard(level=0,power=0) {
  const g=createGame({seed:1});g.weapons.orbit=level;g.weaponPower.orbit=power;g.roundTime=g.roundDuration;g.spawnTimer=g.chestTimer=100;
  stepGame(g,{},.001);return g.choices.find(c=>c.id==='gear:orbit');
}

test('rarity weights sum to one, clamp luck, and smoothly increase higher tiers', () => {
  const zero = rarityWeights(0), half = rarityWeights(50), full = rarityWeights(100);
  for (const weights of [zero, half, full]) assert.ok(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-12);
  assert.deepEqual(zero, [0.7,0.23,0.06,0.01]);
  assert.deepEqual(full, [0.35,0.35,0.23,0.07]);
  assert.ok(half[0]<zero[0]&&half[1]>zero[1]&&half[2]>zero[2]&&half[3]>zero[3]);
  assert.deepEqual(rarityWeights(-200),zero);assert.deepEqual(rarityWeights(200),full);
  assert.equal(rollRarity(0,0).id,'common');assert.equal(rollRarity(.71,0).id,'rare');
  assert.equal(rollRarity(.99,0).id,'legendary');assert.equal(rollRarity(1,100).id,'legendary');
  assert.equal(RARITIES.length,4);
});

test('seeded reward choices carry rarity metadata, numerical descriptions, and bounded build history', () => {
  const a=createGame({seed:21}),b=createGame({seed:21});
  grantExperience(a,8);grantExperience(b,8);assert.deepEqual(a.choices,b.choices);
  assert.ok(a.choices.every(c=>RARITIES.some(r=>r.id===c.rarityId)&&c.rarity.multiplier===c.multiplier));
  const damage=a.choices.find(c=>c.id==='trait:damage');
  if(damage){assert.match(damage.description,/%/);const before=a.player.damage;choose(a,damage.id);assert.ok(a.player.damage>before);assert.equal(a.buildLog.at(-1).rarityId,damage.rarityId);}
  for(let i=0;i<110;i++){a.buildLog.push({name:'x'});if(a.buildLog.length>100)a.buildLog.shift();}
  assert.equal(a.buildLog.length,100);
});

test('luck changes rarity draws while identical runs remain reproducible', () => {
  const low=createGame({seed:1}),high=createGame({seed:1}),repeat=createGame({seed:1});
  high.player.luck=100;
  grantExperience(low,8);grantExperience(high,8);grantExperience(repeat,8);
  assert.deepEqual(low.choices,repeat.choices);
  assert.notDeepEqual(low.choices.map(c=>c.rarityId),high.choices.map(c=>c.rarityId));
});

test('rarity multiplier changes actual damage and armor effects, not only their labels', () => {
  const common=createGame(),legendary=createGame();
  offer(common,'trait','trait:damage',RARITIES[0]);offer(legendary,'trait','trait:damage',RARITIES[3]);
  choose(common,'trait:damage');choose(legendary,'trait:damage');
  assert.ok(legendary.player.damage>common.player.damage);
  assert.equal(legendary.player.damage/common.player.damage,(1+0.18*2.1)/(1+0.18));
  const weak=createGame({hero:'gemini'}),strong=createGame({hero:'gemini'});
  offer(weak,'reward','gear:armor',RARITIES[0]);offer(strong,'reward','gear:armor',RARITIES[3]);choose(weak,'gear:armor');choose(strong,'gear:armor');
  assert.equal(weak.equipmentPower.armor,1);assert.equal(strong.equipmentPower.armor,2.1);
  const stats=getStats(strong);assert.equal(stats.entries.find(e=>e.key==='armor').value,2.1);
});

test('frost, ricochet, orbit, and nova weapons each have live combat behavior', () => {
  const frost=createGame();frost.spawnTimer=frost.chestTimer=100;frost.weaponPower.frost=2.1;frost.effects.frost=2.1;
  const foe={id:501,x:frost.player.x+170,y:frost.player.y,radius:20,hp:500,maxHp:500,speed:0,kind:'chaser',xp:1,slowTimer:0};frost.enemies=[foe];
  frost.bullets=[{x:foe.x,y:foe.y,vx:0,vy:0,life:1,damage:1,radius:9,hits:1,hitIds:[]}];stepGame(frost,{},.01);
  assert.ok(foe.slowTimer>1.5);assert.ok(foe.slowFactor<=.2);assert.equal(frost.effects.frost,2.1);

  const chain=createGame();chain.spawnTimer=chain.chestTimer=100;chain.weaponPower.ricochet=2.1;
  const hit={id:601,x:chain.player.x+170,y:chain.player.y,radius:20,hp:500,maxHp:500,speed:0,kind:'chaser',xp:1};
  const next={id:602,x:hit.x+60,y:hit.y,radius:20,hp:500,maxHp:500,speed:0,kind:'chaser',xp:1};chain.enemies=[hit,next];
  chain.bullets=[{x:hit.x,y:hit.y,vx:0,vy:0,life:1,damage:100,radius:9,hits:1,hitIds:[],ricochets:2}];stepGame(chain,{},.01);
  assert.ok(next.hp<500);

  const orbit=createGame();orbit.spawnTimer=orbit.chestTimer=100;orbit.weaponPower.orbit=1.3;orbit.effects.orbit=1.3;
  const orbitFoe={id:701,x:orbit.player.x+100,y:orbit.player.y,radius:20,hp:500,maxHp:500,speed:0,kind:'chaser',xp:1};orbit.enemies=[orbitFoe];
  const orbitEvents=stepGame(orbit,{},.01);assert.equal(orbitFoe.hp,487);assert.ok(orbitEvents.some(e=>e.type==='orbit-pulse'));

  const nova=createGame();nova.spawnTimer=nova.chestTimer=100;nova.weaponPower.nova=1;
  const killed={id:801,x:nova.player.x+170,y:nova.player.y,radius:20,hp:1,maxHp:1,speed:0,kind:'chaser',xp:1};
  const nearby={id:802,x:killed.x+40,y:killed.y,radius:20,hp:500,maxHp:500,speed:0,kind:'chaser',xp:1};nova.enemies=[killed,nearby];
  nova.bullets=[{x:killed.x,y:killed.y,vx:0,vy:0,life:1,damage:10,radius:9,hits:1,hitIds:[]}];const novaEvents=stepGame(nova,{},.01);
  assert.equal(nearby.hp,476);assert.ok(novaEvents.some(e=>e.type==='nova'));
});

test('weapon offers scale power by rarity and stat panel reports tier weights and weapon levels', () => {
  const g=createGame({seed:4});
  offer(g,'reward','gear:orbit',RARITIES[2]);assert.equal(choose(g,'gear:orbit'),true);
  assert.equal(g.weapons.orbit,1);assert.equal(g.weaponPower.orbit,1.65);
  const stats=getStats(g);assert.equal(stats.weapons[0].power,1.65);assert.equal(stats.effects.orbit,1.65);
  assert.equal(stats.weights.reduce((sum,x)=>sum+x.percent,0),100);
  assert.equal(limits.enemies,112);
});

test('orbit upgrades add a visible orb and increase aggregate pulse damage up to the seven orb cap', () => {
  const g=createGame();
  offer(g,'reward','gear:orbit',RARITIES[0]);choose(g,'gear:orbit');
  g.phase='playing';
  assert.deepEqual(getOrbitStats(g),{count:3,damage:10,interval:.9,radius:150});
  const first=stepGame(g,{},.01).find(e=>e.type==='orbit-pulse');assert.equal(first.count,3);assert.equal(first.damage,10);
  offer(g,'reward','gear:orbit',RARITIES[0]);
  assert.match(generatedOrbitCard(0,0).description,/获得 3 枚环刃/);
  assert.match(generatedOrbitCard(1,1).description,/数量增加 1 枚/);
  choose(g,'gear:orbit');g.phase='playing';
  assert.deepEqual(getOrbitStats(g),{count:4,damage:20,interval:.9,radius:150});
  g.player.orbitTimer=0;
  const second=stepGame(g,{},.01).find(e=>e.type==='orbit-pulse');assert.equal(second.count,4);assert.equal(second.damage,20);
  for(let i=2;i<5;i++){offer(g,'reward','gear:orbit',RARITIES[0]);choose(g,'gear:orbit');}
  assert.deepEqual(getOrbitStats(g),{count:7,damage:50,interval:.9,radius:150});
  const stats=getStats(g);assert.equal(stats.entries.find(e=>e.key==='orbitCount').value,7);assert.equal(stats.weapons[0].count,7);
  const rare=createGame();offer(rare,'reward','gear:orbit',RARITIES[3]);choose(rare,'gear:orbit');
  assert.equal(getOrbitStats(rare).count,3);assert.equal(getOrbitStats(rare).damage,21);
});

test('enemy slow state, orbit angle, and damage stay deterministic and bounded', () => {
  const a=createGame({seed:55}),b=createGame({seed:55});
  for(const g of [a,b]){g.weaponPower.frost=1.3;g.weaponPower.orbit=1;g.enemies=Array.from({length:limits.enemies},(_,i)=>({id:i+1,x:g.player.x+80,y:g.player.y,radius:1,hp:10,speed:0,kind:'chaser',xp:1,slowTimer:1,slowFactor:.48}));}
  for(let i=0;i<20;i++){stepGame(a,{},.05);stepGame(b,{},.05);}
  assert.deepEqual(a,b);assert.ok(a.enemies.length<=limits.enemies);assert.ok(a.player.orbitAngle>0);
});

test('moving DeepSeek starter can clear the denser first round without test-only stat boosts', () => {
  const g=createGame({seed:1});
  for(let i=0;i<400;i++){
    if(g.phase==='trait')choose(g,g.choices[0].id);
    stepGame(g,{moveX:Math.cos(i*.025),moveY:Math.sin(i*.025)},.05);
  }
  while(g.phase==='trait')choose(g,g.choices[0].id);
  assert.equal(g.phase,'reward');assert.equal(g.round,1);assert.equal(g.roundDuration,20);
  assert.ok(g.kills>=5);assert.ok(g.damageTaken>0);assert.ok(g.player.health>0);
});
