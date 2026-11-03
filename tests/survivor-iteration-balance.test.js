import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, normalizeGameSnapshot, grantExperience, choose, stepGame, useHeroSkill, xpThreshold } from '../survival/engine.js';

function spawnChaser(round) {
  const g=createGame({seed:321});g.round=round;g.maxRounds=20;g.roundDuration=999;g.spawnTimer=0;g.chestTimer=999;g.player.invulnerable=100;
  stepGame(g,{},.01);return g.enemies.find(e=>e.kind==='chaser');
}

test('ordinary chaser health has no step jump from round 10 to 11',()=>{
  const ten=spawnChaser(10),eleven=spawnChaser(11);
  assert.ok(ten&&eleven);assert.ok(eleven.maxHp>ten.maxHp);assert.ok(eleven.maxHp-ten.maxHp<20,`${ten.maxHp} -> ${eleven.maxHp}`);
});

test('GPT early trait options guarantee one resource trait, then return to random options',()=>{
  const g=createGame({hero:'gpt',seed:19});
  const pick=(preferResource)=>{grantExperience(g,g.xpNeed);assert.equal(g.phase,'trait');const ids=g.choices.map(c=>c.id);const selected=preferResource?g.choices.find(c=>c.id==='trait:energyMax'||c.id==='trait:maxHealth'):g.choices[0];choose(g,selected.id);return ids;};
  const first=pick(true);
  g.phase='playing';g.pendingLevels=0;g.choices=[];
  const second=pick(false);
  assert.ok(first.some(id=>id==='trait:energyMax'||id==='trait:maxHealth'));
  assert.equal(g.traitChoiceCount,2);
  let sawNonResource=false;
  for(let seed=1;seed<35&&!sawNonResource;seed++){const next=createGame({hero:'gpt',seed});next.traitChoiceCount=2;grantExperience(next,next.xpNeed);sawNonResource=next.choices.every(c=>!['trait:energyMax','trait:maxHealth'].includes(c.id));}
  assert.ok(sawNonResource,'post-guarantee options must allow fully random non-resource sets');
});

test('multishot gains exactly one shot at every rarity multiplier',()=>{
  for(const multiplier of [1,1.5,2,3]){const g=createGame();g.phase='trait';g.pendingLevels=1;g.choices=[{id:'trait:multishot',name:'双重水弹',rarity:{label:'测试'},multiplier}];const before=g.player.shots;assert.equal(choose(g,'trait:multishot'),true);assert.equal(g.player.shots,before+1);}
});

test('Qwen companions inherit bounded damage and fire rate once and preserve it across load',()=>{
  const g=createGame({hero:'qwen',seed:44});
  for(const [id,multiplier] of [['damage',3],['damage',3],['fireRate',3],['fireRate',3]]){g.phase='trait';g.pendingLevels=1;g.choices=[{id:`trait:${id}`,name:id,rarity:{label:'测试'},multiplier}];assert.equal(choose(g,`trait:${id}`),true);}
  g.phase='playing';useHeroSkill(g);
  stepGame(g,{},.01);const a=g.allies[0],damage=a.damage,rate=a.fireRate;
  stepGame(g,{},.01);assert.equal(a.damage,damage);assert.equal(a.fireRate,rate);assert.ok(a.damage<=a.baseDamage*2);assert.ok(a.fireRate>=a.baseFireRate/2);
  const loaded=normalizeGameSnapshot(JSON.parse(JSON.stringify(g)));stepGame(loaded,{},.01);
  assert.ok(Math.abs(loaded.allies[0].damage-a.damage)<1e-9);assert.ok(Math.abs(loaded.allies[0].fireRate-a.fireRate)<1e-9);
});

test('final round completion wins directly and clears pending choices',()=>{
  const g=createGame({length:'quick'});g.round=g.maxRounds;g.phase='playing';g.roundTime=g.roundDuration;g.bossSpawned=true;g.bossDefeated=true;g.pendingLevels=3;g.xp=7;g.choices=[{id:'trait:damage'}];
  stepGame(g,{},.01);assert.equal(g.phase,'won');assert.equal(g.pendingLevels,0);assert.equal(g.xp,0);assert.deepEqual(g.choices,[]);
});

test('live XP threshold and normalized snapshot use the same curve, capped at level 40',()=>{
  const g=createGame();for(const level of [1,8,9,20,39]){g.level=level;g.xpNeed=xpThreshold(level);g.xp=0;g.pendingLevels=0;grantExperience(g,g.xpNeed);assert.equal(g.level,level+1);assert.equal(g.xpNeed,xpThreshold(level+1));const loaded=normalizeGameSnapshot({...g});assert.equal(loaded.xpNeed,xpThreshold(level+1));}
  g.level=40;g.xp=0;g.pendingLevels=0;grantExperience(g,100000);assert.equal(g.level,40);assert.equal(g.pendingLevels,0);assert.equal(g.xp,0);
});
