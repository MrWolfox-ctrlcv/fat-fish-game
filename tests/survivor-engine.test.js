import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, performAction, choose, continueRound, grantExperience, openChest, useItem, itemInfo, useHeroSkill, limits, WIDTH, HEIGHT, CATALOG, DIFFICULTIES, getHud } from '../survival/engine.js';
import { ENEMY_ROSTERS, ELITE_ROSTERS } from '../survival/roster.js';
import { HEROES } from '../survival/heroes.js';

test('seeded runs produce the same simulation', () => {
  const a = createGame({ seed: 42 }); const b = createGame({ seed: 42 });
  for (let i = 0; i < 120; i++) { stepGame(a, { moveX: 1, aimX: 900, aimY: 400 }, 1 / 60); stepGame(b, { moveX: 1, aimX: 900, aimY: 400 }, 1 / 60); }
  assert.deepEqual(a, b);
});

test('movement stays in bounds and trait levels pause gameplay until selected', () => {
  const g = createGame(); stepGame(g, { moveX: 1, moveY: -1 }, 0.05);
  assert.ok(g.player.x <= WIDTH - g.player.radius && g.player.y >= g.player.radius);
  grantExperience(g, 10); assert.equal(g.phase, 'trait');
  const time = g.time; stepGame(g, { moveX: -1 }, 0.05); assert.equal(g.time, time);
  assert.equal(choose(g, 'nope'), false); assert.equal(g.phase, 'trait');
  assert.equal(choose(g, g.choices[0].id), true); assert.equal(g.phase, 'playing');
});

test('charge can damage enemies and chests; chests drop healing rice', () => {
  const g = createGame(); const enemy = { x: g.player.x + 20, y: g.player.y, radius: 20, hp: 20, maxHp: 20, speed: 0, kind: 'chaser', xp: 2 };
  g.enemies.push(enemy); assert.deepEqual(performAction(g, { type: 'primary', aimX: g.player.x + 100, aimY: g.player.y }), [{ type: 'charge' }]);
  for (let i = 0; i < 10; i++) stepGame(g, { aimX: g.player.x + 100, aimY: g.player.y }, 0.04);
  assert.equal(g.enemies.includes(enemy), false); assert.equal(g.kills, 1);
  const chest = { x: g.player.x, y: g.player.y, hp: 1, radius: 20 }; g.chests.push(chest); openChest(g, chest);
  assert.equal(g.chests.length, 0); assert.equal(g.pickups[0].kind, 'rice');
  g.player.health = 100; stepGame(g, {}, 0.01); assert.equal(g.player.health, 100); assert.equal(g.inventory.rice, 1);
  assert.equal(useItem(g)[0].healed, 30); assert.equal(g.player.health, 130); assert.equal(g.inventory.rice, 0);
});

test('damage causes loss and loss freezes; round rewards and final victory progress by choice', () => {
  const g = createGame(); g.player.health = 1; g.player.shotTimer = 10; g.enemies.push({ x: g.player.x, y: g.player.y, radius: 30, hp: 100, speed: 0, kind: 'chaser', xp: 1 });
  stepGame(g, {}, 0.01); assert.equal(g.phase, 'lost'); const t = g.time; assert.deepEqual(stepGame(g, {}, 1 / 60), []); assert.equal(g.time, t);
  const h = createGame(); h.round = 9; h.roundDuration = 0.01; h.enemies.push({ x: 0, y: 0, radius: 20, hp: 1, speed: 0, kind: 'chaser', xp: 1 });
  stepGame(h, {}, 0.02); assert.equal(h.phase, 'reward');
  assert.equal(choose(h, 'bad-choice'), false); assert.equal(choose(h, h.choices[0].id), true); assert.equal(h.phase, 'rest');
  assert.equal(continueRound(h), true); assert.equal(h.phase, 'playing'); assert.equal(h.round, 10);
  h.phase = 'rest'; assert.equal(continueRound(h), true); assert.equal(h.phase, 'won'); assert.equal(continueRound(h), false);
});

test('simulation collections remain capped', () => {
  const g = createGame(); g.enemies = Array.from({ length: limits.enemies }, (_, i) => ({ x: 0, y: i, radius: 1, hp: 10, speed: 0, kind: 'chaser', xp: 1 }));
  g.orbs = Array.from({ length: limits.orbs }, (_, i) => ({ x: i, y: 0, value: 1, radius: 1 }));
  g.bullets = Array.from({ length: limits.bullets + 5 }, () => ({ x: -5, y: -5, vx: 0, vy: 0, life: 0, hits: 1, hitIds: [] }));
  stepGame(g, {}, 0.01); assert.ok(g.enemies.length <= limits.enemies); assert.ok(g.orbs.length <= limits.orbs); assert.ok(g.bullets.length <= limits.bullets);
});

test('action and step return one-shot events and frozen phases stay quiet', () => {
  const g = createGame(); assert.deepEqual(performAction(g, { type: 'primary', moveX: 1, moveY: 0 }), [{ type: 'charge' }]);
  assert.equal(stepGame(g, {}, 0.016).some(e => e.type === 'charge'), false);
  g.phase = 'trait'; const time = g.time; assert.deepEqual(stepGame(g, {}, 0.05), []); assert.equal(g.time, time);
  assert.deepEqual(performAction(g, { type: 'primary' }), []);
});

test('round ten waits for its boss and boss defeat enables the reward', () => {
  const g = createGame(); g.round = 10; g.roundTime = 100; g.roundDuration = 1;
  stepGame(g, { aimX: 0, aimY: 0 }, 0.01); const boss = g.enemies.find(e => e.kind === 'boss');
  assert.ok(boss); assert.equal(g.phase, 'playing'); g.enemies = [boss]; boss.x = g.player.x + 30; boss.y = g.player.y; boss.hp = 0.1; g.player.damage = 10000; g.player.shotTimer = 0;
  for (let i = 0; i < 10 && g.phase === 'playing'; i++) stepGame(g, { aimX: boss.x, aimY: boss.y }, 0.05);
  assert.equal(g.enemies.some(e => e.kind === 'boss'), false);
  while (g.phase === 'trait') choose(g, g.choices[0].id);
  assert.equal(g.phase, 'reward');
});

test('boss spawning retries at capacity and only defeating the spawned boss opens the gate', () => {
  const g = createGame(); g.round = 10; g.roundTime = g.roundDuration + 1;
  g.enemies = Array.from({ length: limits.enemies }, (_, i) => ({ id:i+1,x:0,y:0,radius:1,hp:100,speed:0,kind:'chaser',xp:1 }));
  stepGame(g, {}, 0.01); assert.equal(g.bossSpawned, false); assert.equal(g.phase, 'playing');
  g.enemies.pop(); g.eliteSpawned = true; g.spawnTimer = 10; stepGame(g, {}, 0.01); assert.equal(g.bossSpawned, true); assert.equal(g.bossDefeated, false); assert.equal(g.phase, 'playing');
  g.enemies = g.enemies.filter(e => e.kind === 'boss'); const boss = g.enemies[0]; boss.hp = 0.1; boss.x = g.player.x + 30; boss.y = g.player.y;
  g.player.damage = 10000; g.player.shotTimer = 0;
  for (let i=0; i<8 && !g.bossDefeated; i++) stepGame(g, { aimX:boss.x, aimY:boss.y }, 0.05);
  assert.equal(g.bossDefeated, true); while (g.phase === 'trait') choose(g, g.choices[0].id); assert.equal(g.phase, 'reward');
});

test('a real 20 second first round awards equipment and continue sets round two to 25 seconds', () => {
  const g = createGame({ seed: 9 }); g.player.health = 100000; g.player.maxHealth = 100000; g.player.invulnerable = 10000; g.player.damage = 10000;
  while (g.roundTime < g.roundDuration) {
    if (g.phase === 'trait') { choose(g, g.choices[0].id); continue; }
    stepGame(g, {}, 0.05);
  }
  while (g.phase === 'trait') choose(g, g.choices[0].id);
  assert.equal(g.roundDuration, 20); assert.equal(g.phase, 'reward');
  assert.equal(choose(g, g.choices[0].id), true); assert.equal(g.phase, 'rest');
  assert.equal(continueRound(g), true); assert.equal(g.round, 2); assert.equal(g.roundDuration, 25);
});

test('round end resolves pending traits before offering equipment', () => {
  const g = createGame(); g.roundTime = g.roundDuration - 0.01; g.orbs.push({ x:g.player.x,y:g.player.y,value:10,radius:7 });
  stepGame(g, {}, 0.02); assert.equal(g.phase, 'trait'); assert.equal(g.roundEnding, true);
  while (g.phase === 'trait') choose(g, g.choices[0].id);
  assert.equal(g.phase, 'reward'); assert.equal(g.roundEnding, false);
});

test('rice enters inventory at full health; movement preserves analog strength; catalog is Chinese', () => {
  const g = createGame(); g.pickups.push({ x:g.player.x,y:g.player.y,kind:'rice',heal:30,radius:13 });
  stepGame(g, {}, 0.01); assert.equal(g.pickups.length, 0); assert.equal(g.inventory.rice, 1);
  g.player.vx = 0; stepGame(g, { moveX:0.2 }, 0.05); assert.ok(g.player.vx > 0 && g.player.vx < g.player.speed * 0.2);
  assert.match(CATALOG.damage.name, /[\u3400-\u9fff]/); assert.match(CATALOG.impact.description, /[\u3400-\u9fff]/);
});

test('enemy rosters contain opposite-faction characters for every tier and spawned foes use that roster', () => {
  const kinds = ['chaser', 'dash', 'ranged', 'elite', 'boss'];
  assert.deepEqual(Object.keys(ENEMY_ROSTERS.cn), kinds); assert.deepEqual(Object.keys(ENEMY_ROSTERS.us), kinds);
  const cn = createGame({ faction: 'cn', seed: 7 }); const us = createGame({ faction: 'us', seed: 7 });
  stepGame(cn, {}, 0.01); stepGame(us, {}, 0.01);
  const cnEnemy = cn.enemies[0], usEnemy = us.enemies[0];
  assert.equal(cnEnemy.modelId, ENEMY_ROSTERS.cn.chaser.modelId); assert.equal(usEnemy.modelId, ENEMY_ROSTERS.us.chaser.modelId);
  assert.equal(cnEnemy.name, ENEMY_ROSTERS.cn.chaser.name); assert.equal(usEnemy.name, ENEMY_ROSTERS.us.chaser.name);
  assert.equal(cnEnemy.tier, ENEMY_ROSTERS.cn.chaser.tier); assert.equal(usEnemy.tier, ENEMY_ROSTERS.us.chaser.tier);
  assert.equal(createGame({ faction: 'unknown' }).playerFaction, 'cn');
});

test('rice pickups enter bounded inventory and use heals only on a valid manual action', () => {
  const g = createGame(); g.player.health = g.player.maxHealth;
  g.pickups.push({ x:g.player.x,y:g.player.y,kind:'rice',heal:30,radius:13 }); stepGame(g, {}, 0.01);
  assert.equal(g.inventory.rice, 1); assert.equal(g.player.health, g.player.maxHealth); assert.equal(g.pickups.length, 0);
  g.equipment.ricebox = 2; g.player.health = 20;
  assert.deepEqual(performAction(g, { type:'use-item', slot:1 }), [{ type:'item-used',item:'rice',slot:1,healed:50,remaining:0,fatness:0,fatLevel:1,fatXp:1,fatXpNeed:2 }]);
  assert.equal(g.player.health, 70);
  assert.deepEqual(useItem(g, 2), []); assert.equal(g.inventory.rice, 0);
  g.inventory.rice = 1; g.player.health = g.player.maxHealth; assert.deepEqual(useItem(g), []); assert.equal(g.inventory.rice, 1);
  g.player.health = 20; g.phase = 'trait'; assert.deepEqual(useItem(g), []); assert.equal(g.inventory.rice, 1);
  g.phase = 'playing'; g.inventory.rice = 0; assert.deepEqual(useItem(g), []); assert.equal(g.player.health, 20);
});

test('full rice inventory leaves collected pickup on the ground', () => {
  const g = createGame(); g.inventory.rice = limits.rice;
  g.pickups.push({ x:g.player.x,y:g.player.y,kind:'rice',heal:30,radius:13 }); stepGame(g, {}, 0.01);
  assert.equal(g.inventory.rice, limits.rice); assert.equal(g.pickups.length, 1);
});

test('fatness levels only grow when calorie bar fills and cap at level 30', () => {
  const g=createGame(),p=g.player;p.health=0;
  g.inventory.rice=1;useItem(g);assert.equal(p.fatLevel,1);assert.equal(p.fatXp,1);assert.equal(p.radius,28);
  g.inventory.rice=1;useItem(g);assert.equal(p.fatLevel,2);assert.equal(p.fatXp,0);assert.equal(p.fatXpNeed,3);
  for(let i=0;i<2000&&p.fatLevel<30;i++){g.inventory.rice=1;p.health=0;useItem(g);}
  assert.equal(p.fatLevel,30);assert.equal(p.fatness,29);assert.ok(Math.abs(p.radius-91.8)<1e-8);assert.equal(p.maxHealth,488);assert.equal(p.chargeDamage,166.65);
  const size=p.radius,hp=p.maxHealth,dmg=p.chargeDamage;g.inventory.rice=1;p.health=0;useItem(g);
  assert.equal(p.fatLevel,30);assert.equal(p.radius,size);assert.equal(p.maxHealth,hp);assert.equal(p.chargeDamage,dmg);
});

test('automatic rice uses half healing, can eat at full health, is seeded, and pauses with the game', () => {
  const a = createGame({ seed:1 }), b = createGame({ seed:1 });
  for (const g of [a,b]) { g.inventory.rice=1; g.player.health=50; g.spawnTimer=100; g.chestTimer=100; }
  for (let i=0;i<161;i++) { stepGame(a,{},0.05); stepGame(b,{},0.05); }
  assert.deepEqual(a,b); assert.equal(a.inventory.rice,0); assert.equal(a.player.fatness,0); assert.equal(a.player.fatXp,1); assert.equal(a.player.health,65);
  const full=createGame({seed:1}); full.inventory.rice=1; full.spawnTimer=100; full.chestTimer=100; full.player.health=full.player.maxHealth;
  for(let i=0;i<161;i++) stepGame(full,{},0.05);
  assert.equal(full.inventory.rice,0); assert.equal(full.player.fatness,0); assert.equal(full.player.fatXp,1); assert.equal(full.player.health,140);
  const frozen=createGame(); frozen.phase='trait'; frozen.inventory.rice=1;
  for(let i=0;i<300;i++) stepGame(frozen,{},0.05);
  assert.equal(frozen.inventory.rice,1); assert.equal(frozen.player.fatness,0);
});

test('charge transitions into longer uncontrolled slide that pushes without impact damage', () => {
  const g=createGame(); const p=g.player; p.y=HEIGHT/2; p.fatness=10; g.inventory.rice=0; p.slideTimer=0;
  performAction(g,{type:'primary',aimX:p.x+100,aimY:p.y});
  for(let i=0;i<12;i++) stepGame(g,{moveY:1},0.04);
  assert.equal(p.chargeTimer,0); assert.ok(p.slideTimer>0); assert.equal(p.slideDuration,0.75);
  const foe={id:999,x:p.x+8,y:p.y,radius:20,hp:100,maxHp:100,speed:0,kind:'chaser',xp:1}; g.enemies.push(foe); p.shotTimer=10; p.health=140; const before=foe.x;
  stepGame(g,{moveY:1,command:'primary'},0.02);
  assert.ok(Math.abs(foe.x-before)>0); assert.equal(foe.hp,100); assert.equal(p.health,135); assert.ok(p.slideTimer>0.65);
  assert.ok(p.y<HEIGHT/2+10); // steering input was ignored during the slide
});

test('super-fat roll changes only its visual flag and uses deterministic seeded randomness', () => {
  const a=createGame({seed:12}),b=createGame({seed:12});
  for(const g of [a,b]) { g.inventory.rice=1;g.player.health=1;g.player.fatLevel=4;g.player.fatXp=5;g.player.fatXpNeed=6; }
  assert.equal(a.player.superFat,b.player.superFat); assert.deepEqual(a.player,b.player);
  const ordinary=structuredClone(a.player); a.player.superFat=!a.player.superFat;
  assert.equal(a.player.fatness,ordinary.fatness); assert.equal(a.player.maxHealth,ordinary.maxHealth); assert.equal(a.player.chargeDamage,ordinary.chargeDamage);
  const rolled=createGame({seed:1972}); rolled.inventory.rice=1; rolled.player.fatLevel=4;rolled.player.fatXp=5;rolled.player.fatXpNeed=6;rolled.player.health=0; useItem(rolled); assert.equal(rolled.player.superFat,true);
});

test('elites rotate among faction archetypes and Gemini Flash Lite remains the small dash foe', () => {
  const g=createGame({seed:71}); const seen=new Set(); g.spawnTimer=100;
  for(const round of [3,5,7,9]) { g.round=round; g.eliteSpawned=false; stepGame(g,{},0.01); const elite=g.enemies.find(e=>e.kind==='elite'); assert.ok(elite); seen.add(elite.modelId); assert.ok(ELITE_ROSTERS.cn.some(v=>v.modelId===elite.modelId)); g.enemies=[]; }
  assert.ok(seen.size>=2);
  assert.equal(ENEMY_ROSTERS.cn.dash.modelId,'geminiFlashLite');
  assert.deepEqual(ELITE_ROSTERS.cn.map(x=>x.modelId),['gptSol','claudeOpus','geminiFlash']);
});

test('world bounds and near-player spawns use the expanded arena', () => {
  const g=createGame(); stepGame(g,{moveX:1},0.05); const e=g.enemies[0];
  assert.ok(g.player.x<=WIDTH-g.player.radius); assert.ok(e.x>=0&&e.x<=WIDTH&&e.y>=0&&e.y<=HEIGHT);
  assert.ok(Math.hypot(e.x-g.player.x,e.y-g.player.y)<=720);
});

test('hero catalog and items bind to DeepSeek, Gemini, GPT and locally-previewable Astra', () => {
  assert.deepEqual(Object.keys(HEROES),['deepseek','gemini','gpt','astra']);
  for(const hero of Object.keys(HEROES)){const g=createGame({hero});assert.equal(g.heroId,hero);assert.equal(g.playerFaction,HEROES[hero].faction);assert.ok(g.inventory[HEROES[hero].itemKey]===0);assert.equal(itemInfo(g).key,HEROES[hero].itemKey);}
  assert.equal(HEROES.deepseek.skillName,'肉蛋冲击');assert.equal(HEROES.gemini.name,'Gemini');assert.equal(HEROES.gemini.nickname,'故障机器猫');assert.equal(HEROES.gpt.name,'降智 GPT');
  assert.equal(HEROES.gemini.faction,'us');assert.equal(HEROES.gpt.faction,'us');assert.equal(HEROES.astra.faction,'us');
  assert.deepEqual(Object.keys(itemInfo(createGame({hero:'gpt'}))).sort(),['canUse','count','description','icon','key','name'].sort());
  assert.equal(createGame({hero:'unknown'}).heroId,'deepseek');
});

test('GPT XP fills energy, transformation preserves health, drains back, and reset scroll does not heal', () => {
  const g=createGame({hero:'gpt'});const p=g.player;p.invulnerable=100;assert.deepEqual(useHeroSkill(g),[]);assert.equal(p.toolNodeTimer,0);
  assert.equal(p.health,90);grantExperience(g,5);assert.equal(p.energy,20);assert.equal(g.level,1);
  assert.ok(performAction(g,{type:'primary'}).some(e=>e.type==='gpt-transform'));
  assert.equal(p.transformed,true);assert.equal(p.health,90);assert.equal(p.maxHealth,90);assert.equal(p.damage,36);assert.equal(p.speed,125);assert.equal(p.fireRate,.5);
  for(let i=0;i<50;i++)stepGame(g,{},.05);assert.equal(p.energy,0);assert.equal(p.transformed,false);assert.equal(p.health,90);
  p.energy=20;p.health=12;g.inventory.resetScroll=1;assert.equal(useItem(g)[0].energy,100);assert.equal(p.health,12);
  assert.equal(g.playerFaction,'us');
});

test('combat XP levels quickly with linear thresholds and every level still offers valid traits', () => {
  const g=createGame({hero:'gpt',seed:1});grantExperience(g,8);assert.equal(g.phase,'trait');assert.equal(g.level,2);assert.equal(g.xpNeed,12);
  assert.ok(g.choices.some(c=>c.id==='trait:energyMax'));assert.ok(g.choices.some(c=>c.id==='trait:maxHealth'));
  while(g.phase==='trait')choose(g,g.choices[0].id);grantExperience(g,12);assert.equal(g.level,3);assert.equal(g.xpNeed,16);assert.equal(g.phase,'trait');
  for(let i=0;i<100;i++){g.phase='playing';g.pendingLevels=0;grantExperience(g,g.xpNeed);while(g.phase==='trait')choose(g,g.choices[0].id);assert.ok(g.level>0);}
});

test('form changes preserve GPT movement gear, and other heroes get only relevant round gear', () => {
  const g=createGame({hero:'gpt'});g.player.energy=20;g.equipment.thrust=2;useHeroSkill(g);assert.equal(g.player.speed,155);
  g.player.energy=.01;stepGame(g,{},.05);assert.equal(g.player.transformed,false);assert.equal(g.player.speed,140);
  const other=createGame({hero:'gemini'});other.roundTime=other.roundDuration-.01;other.spawnTimer=100;stepGame(other,{},.02);
  assert.equal(other.phase,'reward');assert.equal(other.choices.length,3);assert.ok(other.choices.every(c=>c.id!=='gear:ricebox'&&c.id!=='gear:impact'));
});

test('GPT tool node knocks enemies back and intercepts hostile projectiles', () => {
  const g=createGame({hero:'gpt'});const p=g.player;p.skillCooldown=0;g.spawnTimer=g.chestTimer=100;
  p.energy=20;useHeroSkill(g);p.skillCooldown=0;
  const e={id:1,x:p.x+100,y:p.y,radius:20,hp:500,maxHp:500,speed:0,kind:'chaser',xp:1};g.enemies.push(e);const old=e.x;
  assert.ok(useHeroSkill(g).some(event=>event.type==='tool-node'));assert.equal(g.player.toolNodeTimer,3);assert.ok(e.x>old+300);
  g.bullets.push({x:p.x+30,y:p.y,vx:0,vy:0,life:1,hostile:true,damage:10,radius:4,hitIds:[]});stepGame(g,{},.01);assert.equal(g.bullets.filter(b=>b.hostile).length,0);
});

test('Gemini fixed-direction flash and chrome orb shield each respect one-use cooldowns', () => {
  const g=createGame({hero:'gemini'});const p=g.player;const x=p.x,y=p.y;p.facing=0;
  assert.ok(performAction(g,{type:'primary',aimX:x,aimY:y+500}).some(event=>event.type==='flash'));
  assert.equal(p.x,x);assert.equal(p.y,y+260);assert.ok(p.invulnerable>0);
  assert.deepEqual(useHeroSkill(g),[]);g.inventory.chromeOrb=1;assert.equal(itemInfo(g).canUse,true);
  const used=useItem(g);assert.equal(used[0].charges,3);assert.equal(p.chromeShieldTimer,8);assert.equal(g.inventory.chromeOrb,0);
  const foe={id:2,x:p.x+10,y:p.y,radius:25,hp:200,maxHp:200,speed:0,kind:'chaser',xp:1};g.enemies=[foe];p.invulnerable=0;p.health=50;p.shotTimer=100;stepGame(g,{},.01);
  assert.equal(p.chromeShieldCharges,2);assert.equal(p.health,50);
});

test('Astra skill is local engine behavior and only GPT completion emits the game-won unlock signal', () => {
  const a=createGame({hero:'astra'});const e={id:1,x:a.player.x+100,y:a.player.y,radius:30,hp:500,maxHp:500,speed:0,kind:'chaser',xp:1};a.enemies=[e];
  assert.ok(useHeroSkill(a).some(event=>event.type==='starburst'));assert.equal(e.hp,200);a.inventory.astraCore=1;assert.equal(a.player.skillCooldown,7);assert.equal(useItem(a)[0].item,'astraCore');assert.equal(a.player.skillCooldown,0);
  const g=createGame({hero:'gpt'});g.round=10;g.phase='rest';assert.equal(continueRound(g),true);assert.equal(g.phase,'won');assert.ok(g.events.some(event=>event.type==='game-won'&&event.hero==='gpt'));
  const d=createGame({hero:'deepseek'});d.round=10;d.phase='rest';continueRound(d);assert.equal(d.events.some(event=>event.type==='game-won'),false);
});

test('slide cannot be cancelled by direct skill action, but auto shooting continues', () => {
  const g=createGame();const p=g.player;g.spawnTimer=g.chestTimer=100;
  p.slideTimer=1;p.chargeCooldown=0;p.vx=100;p.vy=0;p.shotTimer=0;
  const y=p.y;
  g.enemies=[{id:1,x:p.x+300,y:p.y,radius:20,hp:200,maxHp:200,speed:0,kind:'chaser',xp:1}];
  performAction(g,{type:'primary',aimX:p.x,aimY:p.y+300});
  assert.equal(p.chargeTimer,0);assert.equal(p.slideTimer,1);
  stepGame(g,{moveY:1},1/60);
  assert.equal(p.y,y);assert.ok(g.bullets.length>0);assert.equal(g.enemies[0].hp,200);
});

test('super-fat cosmetic roll does not consume gameplay RNG or change subsequent enemy spawns', () => {
  const a=createGame({seed:1972}),b=createGame({seed:1972});
  for(const g of [a,b]){g.player.fatLevel=4;g.player.fatXp=5;g.player.fatXpNeed=6;g.player.health=1;g.inventory.rice=1;}
  b.player.superFat=true;
  useItem(a);useItem(b);
  assert.equal(a.player.superFat,true);assert.equal(a.rng,b.rng);
  assert.equal(a.player.radius,b.player.radius);assert.equal(a.player.maxHealth,b.player.maxHealth);
  stepGame(a,{},1/60);stepGame(b,{},1/60);
  assert.deepEqual(a.enemies,b.enemies);
});

test('starts at DeepSeek fat level one; stage and body grow at calorie thresholds only', () => {
  const g=createGame();const p=g.player;
  assert.equal(p.radius,28);assert.equal(p.fishStage,1);assert.equal(p.fatLevel,1);assert.equal(p.fatXpNeed,2);assert.equal(g.level,1);
  g.inventory.rice=1;p.health=1;useItem(g);assert.equal(p.fatLevel,1);assert.equal(p.radius,28);
  g.inventory.rice=1;p.health=1;useItem(g);assert.equal(p.fatLevel,2);assert.equal(p.fishStage,2);assert.equal(p.radius,30.2);
  for(let level=3;level<=30;level++){
    p.fatXp=p.fatXpNeed-1;g.inventory.rice=1;p.health=1;useItem(g);
    assert.equal(p.fatLevel,level);assert.equal(p.fishStage,Math.min(11,1+Math.ceil((level-1)/3)));
  }
  assert.ok(Math.abs(p.radius-91.8)<1e-8);assert.equal(g.level,1);
});

test('difficulty presets change enemy toughness, damage, spawn cadence, and XP without altering heroes', () => {
  assert.deepEqual(Object.keys(DIFFICULTIES),['relaxed','standard','hard']);
  const games=['relaxed','standard','hard'].map(difficulty=>createGame({seed:24,difficulty}));
  for(const g of games){g.spawnTimer=0;g.chestTimer=100;g.player.invulnerable=0;g.bullets=[{x:g.player.x,y:g.player.y,vx:0,vy:0,life:1,hostile:true,damage:8,radius:3}];}
  const before=games.map(g=>({health:g.player.maxHealth,damage:g.player.damage,speed:g.player.speed}));
  for(const g of games)stepGame(g,{},.01);
  assert.deepEqual(before.map(x=>[x.health,x.damage,x.speed]),[[140,18,135],[140,18,135],[140,18,135]]);
  const [easy,normal,hard]=games;
  assert.ok(easy.enemies[0].hp<normal.enemies[0].hp&&normal.enemies[0].hp<hard.enemies[0].hp);
  assert.ok(easy.damageTaken<normal.damageTaken&&normal.damageTaken<hard.damageTaken);
  assert.ok(easy.spawnTimer>normal.spawnTimer&&normal.spawnTimer>hard.spawnTimer);
  assert.ok(easy.enemies[0].xp>normal.enemies[0].xp&&normal.enemies[0].xp===3&&hard.enemies[0].xp===3);
  assert.equal(getHud(easy).difficulty,'relaxed');assert.equal(createGame({difficulty:'invalid'}).difficulty,'standard');
  for(const g of games){const selected=g.difficulty;for(let i=0;i<10;i++)stepGame(g,{},.05);assert.equal(g.difficulty,selected);}
  const bosses=['relaxed','standard','hard'].map(difficulty=>{const g=createGame({difficulty});g.round=10;g.spawnTimer=g.chestTimer=100;stepGame(g,{},.01);return g.enemies.find(e=>e.kind==='boss').hp;});
  assert.ok(bosses[0]<bosses[1]&&bosses[1]<bosses[2]);
});

test('nova blasts and cosmetic particles are bounded, pause with phases, and survive JSON snapshots', () => {
  function popOne(g,id){const target={id,x:g.player.x+200,y:g.player.y,radius:20,hp:1,maxHp:1,speed:0,kind:'chaser',xp:1};g.enemies=[target];g.bullets=[{x:target.x,y:target.y,vx:0,vy:0,life:1,damage:10,radius:9,hits:1,hitIds:[]}];stepGame(g,{},.01);}
  const g=createGame({seed:87});g.spawnTimer=g.chestTimer=100;g.player.shotTimer=100;g.weaponPower.nova=1;
  const control=structuredClone(g);popOne(g,1);control.weaponPower.nova=0;popOne(control,1);
  assert.equal(g.rng,control.rng);assert.notEqual(g.visualRng,control.visualRng);
  assert.equal(g.blasts.length,1);assert.equal(g.blasts[0].kind,'nova');assert.ok(g.particles.length<=limits.particles);
  const age=g.blasts[0].age;g.phase='trait';assert.deepEqual(stepGame(g,{},1),[]);assert.equal(g.blasts[0].age,age);
  g.phase='playing';
  for(let i=0;i<12;i++)popOne(g,i+2);
  assert.equal(g.blasts.length,limits.blasts);assert.ok(g.particles.length<=limits.particles);
  const restored=Object.assign(createGame({difficulty:g.difficulty}),JSON.parse(JSON.stringify(g)));
  stepGame(g,{},.03);stepGame(restored,{},.03);assert.deepEqual(restored,g);
  for(let i=0;i<12;i++)stepGame(g,{},.05);assert.equal(g.blasts.length,0);
});
