import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, openChest, useItem, applyShopItem, getShopItemStatus, normalizeGameSnapshot, limits } from '../survival/engine.js';
import { HEROES } from '../survival/heroes.js';
import { SHOP_ITEMS } from '../survival/shop-items.js';

test('first chest arrives at twelve seconds, then eighteen seconds apart, with two on the field maximum', () => {
  const g=createGame({seed:45});g.roundDuration=120;g.spawnTimer=100;g.player.shotTimer=100;
  for(let i=0;i<239;i++)stepGame(g,{},.05);
  assert.equal(g.chests.length,0);
  stepGame(g,{},.05);assert.equal(g.chests.length,1);assert.equal(g.chests[0].maxHp,24);
  for(let i=0;i<359;i++)stepGame(g,{},.05);
  assert.equal(g.chests.length,1);
  stepGame(g,{},.05);assert.equal(g.chests.length,2);
  for(let i=0;i<900;i++)stepGame(g,{},.05);
  assert.equal(g.chests.length,2);
  openChest(g,g.chests[0]);
  for(let i=0;i<360;i++)stepGame(g,{},.05);
  assert.equal(g.chests.length,2);
});

test('enemy pressure scales by round and difficulty while all spawns stay near the player and capped', () => {
  const round1=createGame({seed:8}),round3=createGame({seed:8}),round7=createGame({seed:8});
  for(const [g,round] of [[round1,1],[round3,3],[round7,7]]){g.round=round;g.eliteSpawned=true;g.spawnTimer=0;g.chestTimer=100;stepGame(g,{},.01);}
  assert.equal(round1.enemies.length,2);assert.equal(round3.enemies.length,3);assert.equal(round7.enemies.length,4);
  for(const g of [round1,round3,round7])for(const e of g.enemies){const d=Math.hypot(e.x-g.player.x,e.y-g.player.y);assert.ok(d>=320&&d<=500);}
  assert.ok(round7.spawnTimer<round3.spawnTimer&&round3.spawnTimer<round1.spawnTimer);
  const relaxed=createGame({seed:8,difficulty:'relaxed'});relaxed.round=7;relaxed.eliteSpawned=true;relaxed.spawnTimer=0;relaxed.chestTimer=100;stepGame(relaxed,{},.01);
  assert.equal(relaxed.enemies.length,1);assert.ok(relaxed.spawnTimer>round7.spawnTimer);
  const capped=createGame({seed:2});capped.round=7;capped.enemies=Array.from({length:limits.enemies-1},(_,i)=>({id:i+1,x:10,y:10,radius:1,hp:100,maxHp:100,speed:0,kind:'chaser'}));capped.nextEnemyId=limits.enemies;capped.spawnTimer=0;capped.chestTimer=100;stepGame(capped,{},.01);
  assert.equal(capped.enemies.length,limits.enemies);
});

test('contact damage rises modestly in later rounds without changing the opening hit', () => {
  const damageFor=round=>{const g=createGame();g.round=round;g.spawnTimer=g.chestTimer=100;g.player.invulnerable=0;g.player.shotTimer=100;g.enemies=[{id:9,x:g.player.x,y:g.player.y,radius:30,hp:100,maxHp:100,speed:0,kind:'chaser'}];stepGame(g,{},.01);return g.damageTaken;};
  assert.equal(damageFor(1),8);assert.equal(damageFor(9),10);
});

test('rice growth is quicker after the first two bowls, can progress at full HP, and old progress is preserved', () => {
  const g=createGame();g.player.health=g.player.maxHealth;
  g.inventory.rice=1;const first=useItem(g)[0];assert.equal(first.healed,0);assert.equal(g.player.fatLevel,1);assert.equal(g.player.fatXp,1);
  g.inventory.rice=1;useItem(g);assert.equal(g.player.fatLevel,2);assert.equal(g.player.fatXp,0);assert.equal(g.player.fatXpNeed,2);
  g.inventory.rice=1;useItem(g);assert.equal(g.player.fatLevel,2);assert.equal(g.player.fatXp,1);
  g.inventory.rice=1;useItem(g);assert.equal(g.player.fatLevel,3);assert.equal(g.player.fatXpNeed,3);
  const old=createGame();old.player.fatXp=5;old.player.fatXpNeed=6;const restored=normalizeGameSnapshot(JSON.parse(JSON.stringify(old)));
  assert.equal(restored.player.fatXp,5);assert.equal(restored.player.fatXpNeed,6);
  restored.player.health=restored.player.maxHealth;restored.inventory.rice=1;useItem(restored);assert.equal(restored.player.fatLevel,2);assert.equal(restored.player.fatXpNeed,2);
});

test('shop definitions have explicit identical per-action prices and localized names', () => {
  assert.deepEqual(Object.keys(SHOP_ITEMS),['medkit','supplies','pulse','magnet']);
  for(const item of Object.values(SHOP_ITEMS)){assert.equal(item.priceQuota,5000);assert.equal(item.priceUsd,.01);assert.ok(item.name.length>0);assert.ok(/[^\x00-\x7f]/.test(item.name));}
});

test('medkit heals forty percent of max HP once and records receipts only after success', () => {
  const g=createGame();g.player.health=10;
  const result=applyShopItem(g,'medkit','medkit-1');assert.equal(result.applied,true);assert.equal(g.player.health,66);assert.equal(result.events[0].healed,56);
  const duplicate=applyShopItem(g,'medkit','medkit-1');assert.equal(duplicate.applied,false);assert.equal(g.player.health,66);
  g.player.health=g.player.maxHealth;const before=g.appliedShopReceipts.length;
  assert.equal(getShopItemStatus(g,'medkit').available,false);assert.equal(applyShopItem(g,'medkit','medkit-full').applied,false);assert.equal(g.appliedShopReceipts.length,before);
  g.player.health=20;assert.equal(applyShopItem(g,'medkit','medkit-full').applied,true);
});

test('supplies add exactly two current-hero items only when both bag slots fit', () => {
  for(const hero of Object.keys(HEROES)){
    const g=createGame({hero});const key=HEROES[hero].itemKey;g.inventory[key]=7;
    assert.equal(getShopItemStatus(g,'supplies').available,true,hero);
    assert.equal(applyShopItem(g,'supplies',`supply-${hero}`).applied,true,hero);assert.equal(g.inventory[key],9,hero);
    assert.equal(applyShopItem(g,'supplies',`supply-${hero}-again`).applied,false,hero);
    assert.equal(g.inventory[key],9,hero);
  }
});

test('pulse hits enemies in range, halves boss damage, pushes survivors, and never hits the player or chests', () => {
  const g=createGame();const p=g.player;p.health=73;
  const ordinary={id:1,x:p.x+100,y:p.y,radius:20,hp:200,maxHp:200,speed:0,kind:'chaser'};
  const boss={id:2,x:p.x+200,y:p.y,radius:40,hp:500,maxHp:500,speed:0,kind:'boss',behavior:'egg',shieldTimer:3};
  const far={id:3,x:p.x+500,y:p.y,radius:20,hp:200,maxHp:200,speed:0,kind:'elite'};
  const chest={x:p.x+120,y:p.y,hp:24,maxHp:24,radius:20};g.enemies=[ordinary,boss,far];g.chests=[chest];
  const result=applyShopItem(g,'pulse','pulse-1');assert.equal(result.applied,true);
  assert.equal(ordinary.hp,80);assert.equal(boss.hp,440);assert.equal(far.hp,200);assert.equal(p.health,73);assert.equal(chest.hp,24);
  assert.equal(ordinary.x,p.x+220);assert.equal(boss.x,p.x+320);assert.equal(g.blasts.at(-1).radius,420);
});

test('magnet collects only current XP orbs and can trigger normal level choices', () => {
  const g=createGame();g.orbs=[{x:0,y:0,value:5},{x:5,y:0,value:4}];
  const result=applyShopItem(g,'magnet','magnet-1');assert.equal(result.applied,true);assert.equal(g.orbs.length,0);assert.equal(g.xp,1);assert.equal(g.level,2);assert.equal(g.phase,'trait');
  assert.equal(result.events[0].xp,9);const duplicate=applyShopItem(g,'magnet','magnet-1');assert.equal(duplicate.applied,false);assert.equal(g.xp,1);
});

test('shop actions reject frozen, invalid, out-of-target, full-bag, and empty-field cases without consuming receipts', () => {
  const g=createGame();g.phase='trait';g.player.health=1;g.inventory.rice=8;
  for(const [id,rid] of [['medkit','paused-med'],['supplies','paused-supply'],['pulse','paused-pulse'],['magnet','paused-magnet']]){
    assert.equal(applyShopItem(g,id,rid).applied,false);assert.equal(g.appliedShopReceipts.includes(`${id}:${rid}`),false);
  }
  g.phase='playing';assert.equal(applyShopItem(g,'not-real','bad-id').applied,false);assert.equal(applyShopItem(g,'medkit','').applied,false);
  g.player.health=g.player.maxHealth;assert.equal(applyShopItem(g,'medkit','full').applied,false);
  g.inventory.rice=8;assert.equal(applyShopItem(g,'supplies','fullbag').applied,false);
  assert.equal(applyShopItem(g,'pulse','no-enemies').applied,false);assert.equal(applyShopItem(g,'magnet','no-orbs').applied,false);
  assert.equal(g.appliedShopReceipts.length,0);
});

test('shop receipts survive normalization and remain bounded to the latest 128', () => {
  const g=createGame();g.appliedShopReceipts=Array.from({length:140},(_,i)=>`medkit:r${i}`);
  const normalized=normalizeGameSnapshot(JSON.parse(JSON.stringify(g)));
  assert.equal(normalized.appliedShopReceipts.length,128);assert.equal(normalized.appliedShopReceipts[0],'medkit:r12');assert.equal(normalized.appliedShopReceipts.at(-1),'medkit:r139');
  const old=normalizeGameSnapshot({heroId:'deepseek',player:{health:10}});assert.deepEqual(old.appliedShopReceipts,[]);
});
