import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, performAction, choose, useHeroSkill, useHeroSecondary, useItem, itemInfo, getStats, normalizeGameSnapshot, limits } from '../survival/engine.js';
import { HEROES } from '../survival/heroes.js';
import { ENEMY_ROSTERS, DOUBAO_BOSS } from '../survival/roster.js';

function enemy(id,x,y,hp=500,extra={}){return {id,x,y,radius:18,hp,maxHp:hp,speed:0,kind:'chaser',xp:1,...extra};}

test('new heroes have the requested CN stats, factions, and item keys',()=>{
  assert.deepEqual(HEROES.doubao.stats,{health:120,speed:140,damage:12,fireRate:.8,chargeDamage:0});
  assert.deepEqual(HEROES.qwen.stats,{health:125,speed:135,damage:16,fireRate:.9,chargeDamage:0});
  assert.deepEqual(HEROES.kimi.stats,{health:80,speed:95,damage:58,fireRate:1.7,piercing:3,chargeDamage:0});
  for(const id of ['doubao','qwen','kimi']){const g=createGame({hero:id});assert.equal(g.playerFaction,'cn');assert.equal(g.inventory[HEROES[id].itemKey],0);}
  assert.equal(HEROES.doubao.itemKey,'doubaoSnack');assert.equal(HEROES.qwen.itemKey,'computeCell');assert.equal(HEROES.kimi.itemKey,'kimiLens');
});

test('Doubao shield absorbs two hits for three seconds, pushes foes, cools down, and snack heals 25',()=>{
  const g=createGame({hero:'doubao'}),p=g.player,foe=enemy(1,p.x+90,p.y);g.enemies=[foe];const oldX=foe.x;
  assert.ok(performAction(g,{type:'primary'}).some(e=>e.type==='doubao-shield'));
  assert.equal(p.shieldTimer,3);assert.equal(p.shieldCharges,2);assert.equal(p.shieldCooldown,8);assert.ok(foe.x>oldX+170);
  p.health-=20;p.invulnerable=0;g.bullets=[{x:p.x,y:p.y,vx:0,vy:0,life:1,hostile:true,damage:10,radius:2}];stepGame(g,{},.01);
  assert.equal(p.health,100);assert.equal(p.shieldCharges,1);
  p.invulnerable=0;g.bullets=[{x:p.x,y:p.y,vx:0,vy:0,life:1,hostile:true,damage:10,radius:2}];stepGame(g,{},.01);
  assert.equal(p.health,100);assert.equal(p.shieldCharges,0);
  g.inventory.doubaoSnack=1;p.health=80;assert.equal(itemInfo(g).canUse,true);assert.equal(useItem(g)[0].healed,25);assert.equal(p.health,105);
  assert.equal(useItem(g).length,0);assert.equal(g.inventory.doubaoSnack,0);
});

test('Qwen compute pays summon costs, regenerates in active play, and compute cells restore up to cap',()=>{
  const g=createGame({hero:'qwen'}),p=g.player;
  assert.equal(p.compute,100);assert.equal(p.computeMax,100);
  assert.ok(performAction(g,{type:'primary'}).some(e=>e.type==='ally-summoned'));
  assert.equal(p.compute,80);assert.equal(g.allies[0].kind,'qwenSmall');assert.equal(g.allies[0].life,10);
  assert.ok(performAction(g,{type:'secondary'}).some(e=>e.type==='ally-summoned'));
  assert.equal(p.compute,20);assert.equal(g.allies[1].kind,'qwenMax');assert.equal(g.allies[1].life,12);
  g.inventory.computeCell=1;assert.equal(itemInfo(g).canUse,true);assert.equal(useItem(g)[0].compute,60);
  const frozen=p.compute;g.phase='trait';stepGame(g,{},1);assert.equal(p.compute,frozen);
  g.phase='playing';stepGame(g,{},.05);assert.ok(p.compute>frozen);
  assert.ok(useHeroSecondary(g).some(e=>e.kind==='qwenMax'));assert.equal(g.allies.length,3);
});

test('Qwen allies follow and attack while respecting ally, enemy, and reserved bullet caps',()=>{
  const g=createGame({hero:'qwen'}),p=g.player;g.spawnTimer=g.chestTimer=100;
  g.allies=Array.from({length:limits.allies},(_,i)=>({id:i+1,x:p.x+100+i,y:p.y,radius:13,kind:'qwenSmall',life:10,maxLife:10,shotTimer:0,damage:12,modelId:'qwenSmall',name:'Qwen小兵',color:'#71c7a0'}));
  g.nextAllyId=limits.allies+1;g.enemies=[enemy(100,p.x+150,p.y)];
  const before=Math.hypot(g.allies[0].x-p.x,g.allies[0].y-p.y);stepGame(g,{},.05);
  assert.ok(Math.hypot(g.allies[0].x-p.x,g.allies[0].y-p.y)<before);
  assert.ok(g.bullets.some(b=>b.owner==='ally'));assert.ok(g.bullets.filter(b=>b.owner==='ally').length<=limits.allyBullets);
  assert.ok(g.allies.length<=limits.allies);assert.ok(g.enemies.length<=limits.enemies);
});

test('Qwen Max summons a telegraphed burst of Qwen small enemies without exceeding 64 enemies',()=>{
  const g=createGame({hero:'gpt',faction:'us',seed:2});g.round=10;g.spawnTimer=g.chestTimer=100;
  stepGame(g,{},.01);const boss=g.enemies.find(e=>e.kind==='boss');
  assert.ok(boss);assert.equal(boss.modelId,'qwenMax');assert.equal(boss.behavior,'summoner');assert.equal(boss.telegraph,0.99);
  boss.summonTimer=.01;boss.telegraph=.01;stepGame(g,{},.02);
  assert.equal(g.enemies.filter(e=>e.modelId==='qwenSmall').length,6);assert.equal(boss.summonTimer,5);assert.ok(g.enemies.length<=limits.enemies);
  boss.summonTimer=1.5;stepGame(g,{},.05);assert.equal(boss.telegraph,0);boss.summonTimer=1.01;stepGame(g,{},.05);assert.ok(boss.telegraph>0&&boss.telegraph<=1);
  const full=createGame({hero:'gpt',faction:'us'});full.round=10;full.enemies=Array.from({length:limits.enemies-1},(_,i)=>enemy(i+1,40+i,40));full.nextEnemyId=limits.enemies;full.spawnTimer=full.chestTimer=100;
  stepGame(full,{},.01);const fullBoss=full.enemies.find(e=>e.kind==='boss');assert.ok(fullBoss);fullBoss.summonTimer=.01;
  stepGame(full,{},.02);assert.equal(full.enemies.length,limits.enemies);
});

test('US boss is usually Qwen Max and has a deterministic Doubao egg variant with shield push',()=>{
  assert.equal(ENEMY_ROSTERS.us.boss.modelId,'qwenMax');
  const ids=[];for(let seed=1;seed<=100;seed++){const g=createGame({seed,faction:'us'});g.round=10;g.spawnTimer=g.chestTimer=100;stepGame(g,{},.01);ids.push(g.enemies.find(e=>e.kind==='boss')?.modelId);}
  const eggs=ids.filter(id=>id==='doubaoBoss').length;assert.ok(eggs>=4&&eggs<=20);assert.ok(ids.filter(id=>id==='qwenMax').length>80);
  assert.equal(DOUBAO_BOSS.name,'豆包·彩蛋首领');
  const seed=ids.findIndex(id=>id==='doubaoBoss')+1,g=createGame({seed,faction:'us'});g.round=10;g.spawnTimer=g.chestTimer=100;stepGame(g,{},.01);
  const egg=g.enemies.find(e=>e.kind==='boss');assert.equal(egg.modelId,'doubaoBoss');assert.equal(egg.shieldTimer,2.99);
  egg.x=g.player.x+70;egg.y=g.player.y;egg.shieldTimer=1;egg.shieldCooldown=.01;const beforeX=g.player.x;const events=stepGame(g,{},.02);
  assert.ok(events.some(e=>e.type==='egg-push'));assert.ok(Math.abs(g.player.x-beforeX)>100);
});

test('Kimi normal and focused lasers hit line targets, preserve piercing, and can destroy chests',()=>{
  const g=createGame({hero:'kimi'}),p=g.player;g.spawnTimer=g.chestTimer=100;p.shotTimer=0;p.aimX=p.x+300;p.aimY=p.y;
  const targets=[enemy(1,p.x+150,p.y),enemy(2,p.x+250,p.y),enemy(3,p.x+350,p.y),enemy(4,p.x+450,p.y)];g.enemies=targets;
  stepGame(g,{},.01);assert.deepEqual(targets.map(e=>e.hp),[442,442,442,500]);
  assert.ok(g.beams.some(b=>b.x===p.x&&b.toX-p.x>639&&b.width===8));
  const laser=createGame({hero:'kimi'}),q=laser.player;laser.spawnTimer=laser.chestTimer=100;
  laser.enemies=Array.from({length:4},(_,i)=>enemy(i+1,q.x+100+i*100,q.y));
  const emitted=performAction(laser,{type:'primary',aimX:q.x+500,aimY:q.y});
  assert.ok(emitted.some(e=>e.type==='kimi-focus'));assert.equal(q.skillCooldown,8);
  assert.deepEqual(laser.enemies.map(e=>e.hp),[380,380,380,500]);assert.ok(laser.beams[0].toX-q.x>849);
  const chest=createGame({hero:'kimi'}),r=chest.player;chest.spawnTimer=chest.chestTimer=100;r.shotTimer=0;r.aimX=r.x+150;r.aimY=r.y;
  chest.chests=[{x:r.x+120,y:r.y,radius:20,hp:24,maxHp:24}];stepGame(chest,{},.01);
  assert.equal(chest.chests.length,0);assert.equal(chest.pickups[0].kind,'kimiLens');
  chest.player.skillCooldown=7;chest.inventory.kimiLens=1;assert.equal(useItem(chest)[0].cooldown,0);assert.equal(chest.player.skillCooldown,0);
});

test('Kimi multishot and weapons apply to beams, and nova chain cannot double-credit laser targets',()=>{
  const g=createGame({hero:'kimi'}),p=g.player;g.spawnTimer=g.chestTimer=100;p.shotTimer=0;p.shots=2;p.aimX=p.x+300;p.aimY=p.y;g.weaponPower.frost=1;g.weaponPower.ricochet=1;g.weaponPower.orbit=1;g.effects.orbit=1;
  const one=enemy(1,p.x+150,p.y,500),two=enemy(2,p.x+220,p.y,500);g.enemies=[one,two];stepGame(g,{},.01);
  assert.equal(g.beams.filter(b=>b.width===8).length,2);assert.ok(one.hp<442&&two.hp<442);assert.ok(two.slowTimer>0);
  const chain=createGame({hero:'kimi'}),q=chain.player;chain.spawnTimer=chain.chestTimer=100;q.shotTimer=100;q.aimX=q.x+300;q.aimY=q.y;chain.weaponPower.nova=3;
  chain.enemies=[enemy(11,q.x+100,q.y,100),enemy(12,q.x+150,q.y,50)];
  performAction(chain,{type:'primary',aimX:q.x+300,aimY:q.y});
  assert.equal(chain.kills,2);assert.equal(chain.score,100);assert.equal(chain.orbs.length,2);assert.equal(chain.enemies.length,0);
});

test('hero cooldowns, summons, and beams pause; beam and ally collections remain bounded',()=>{
  const kimi=createGame({hero:'kimi'});performAction(kimi,{type:'primary',aimX:kimi.player.x+300,aimY:kimi.player.y});
  const life=kimi.beams[0].life,cooldown=kimi.player.skillCooldown;kimi.phase='trait';stepGame(kimi,{},.05);assert.equal(kimi.beams[0].life,life);assert.equal(kimi.player.skillCooldown,cooldown);
  kimi.phase='playing';for(let i=0;i<40;i++){kimi.player.skillCooldown=0;performAction(kimi,{type:'primary',aimX:kimi.player.x+300,aimY:kimi.player.y});}assert.equal(kimi.beams.length,limits.beams);
  const qwen=createGame({hero:'qwen'});useHeroSkill(qwen);const allyLife=qwen.allies[0].life,compute=qwen.player.compute;qwen.phase='trait';stepGame(qwen,{},.5);assert.equal(qwen.allies[0].life,allyLife);assert.equal(qwen.player.compute,compute);
});

test('V2 snapshots normalize by cloning, preserve health and RNG, and fill only missing V3 fields',()=>{
  const old=createGame({seed:123,hero:'deepseek'});old.player.health=37;old.inventory.rice=2;delete old.allies;delete old.beams;delete old.player.compute;delete old.inventory.doubaoSnack;
  const before=JSON.stringify(old),normalized=normalizeGameSnapshot(old);
  assert.equal(JSON.stringify(old),before);assert.equal(normalized.player.health,37);assert.equal(normalized.player.compute,0);assert.deepEqual(normalized.allies,[]);assert.deepEqual(normalized.beams,[]);
  assert.equal(normalized.inventory.rice,2);assert.equal(normalized.inventory.doubaoSnack,0);assert.equal(normalized.rng,123);
  const replay=normalizeGameSnapshot(JSON.parse(before));stepGame(normalized,{},.03);stepGame(replay,{},.03);assert.deepEqual(normalized,replay);
  const qwen=createGame({hero:'qwen',seed:9});qwen.player.compute=33;qwen.player.shieldCharges=1;qwen.allies=[{id:7,kind:'qwenSmall',life:4}];
  const copy=normalizeGameSnapshot(JSON.parse(JSON.stringify(qwen)));assert.equal(copy.player.compute,33);assert.equal(copy.player.shieldCharges,1);assert.equal(copy.nextAllyId,8);assert.equal(copy.rng,qwen.rng);
});
