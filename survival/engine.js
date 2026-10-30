import { ENEMY_ROSTERS, ELITE_ROSTERS, DOUBAO_BOSS, opposingRoster } from './roster.js';
import { HEROES } from './heroes.js';
import { RARITIES, rarityWeights, rollRarity } from './loot.js';
import { SHOP_ITEMS } from './shop-items.js';
import { mapForRound, createScene, ensureScene, terrainFactor, ventPhase } from './maps.js';
import { beginBossArena, updateBossPressure } from './boss-pressure.js';
export { RARITIES, rarityWeights, rollRarity } from './loot.js';
export { SHOP_ITEMS } from './shop-items.js';

export const WIDTH = 2560;
export const HEIGHT = 1600;
export const limits = Object.freeze({ enemies: 112, bullets: 144, orbs: 128, particles: 80, blasts: 12, allies: 8, allyBullets: 8, beams: 16, chests: 2, pickups: 8, events: 32, rice: 9, chromeOrb: 9, resetScroll: 9, astraCore: 9, computeCell: 9, doubaoSnack: 9, kimiLens: 9 });
export const roundDuration = round => Math.min(75,20+5*(round-1));
export const isBossRound = g => g.round === g.maxRounds || ((g.campaignVersion>=3 || g.maxRounds > 10) && g.round % 5 === 0);
export const DIFFICULTIES = Object.freeze({
  relaxed: Object.freeze({ label: '轻松', description: '敌人更弱、进场更慢，经验略多。', enemyHealth: .75, enemyDamage: .7, spawnInterval: 1.2, xp: 1.15 }),
  standard: Object.freeze({ label: '标准', description: '标准敌人强度与出现速度。', enemyHealth: 1, enemyDamage: 1, spawnInterval: 1, xp: 1 }),
  hard: Object.freeze({ label: '困难', description: '敌人更强、出现更快。', enemyHealth: 1.25, enemyDamage: 1.25, spawnInterval: .8, xp: 1 }),
});

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const damageFactor = power => Math.min(5.5, 1 + .18 * Math.min(12, power) + .06 * Math.max(0, power - 12));
const fireInterval = (base,power) => Math.max(.12,base/(1+.22*Math.max(0,power)));
const xpThreshold = level => 8 + 4 * (level - 1) + 2 * Math.max(0, level - 8) ** 2;
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const unit = (x, y) => { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; };
const traitPool = [
  ['damage', '高压水滴', '水弹伤害提高 25%。', '💧'], ['fireRate', '快速进食', '射击间隔减少 20%。', '⚡'],
  ['maxHealth', '深海储备', '最大生命提高 25，并恢复 25 点生命。', '💗'], ['vampirism', '血潮', '每层使击杀回血增加 2 点，上限 8 点；触发间隔 0.25 秒。', '🩸'],
  ['multishot', '双重水弹', '每次多发射一枚水弹。', '💧'], ['piercing', '坚硬米核', '水弹可额外穿透一名敌人。', '🌰'],
  ['crit', '幸运一击', '暴击率提高 12%。', '🍀'], ['speed', '顺流而行', '移动速度提高 12%。', '🌊'],
  ['magnet', '米粒磁力', '经验吸取范围增加 65。', '🧲'], ['chargeCooldown', '快速冲锋', '冲锋冷却减少 0.75 秒，最短 1 秒。', '💥'],
  ['fortune', '命运眷顾', '幸运提高 10 点，增加高稀有度掉落机会。', '🍀'],
];
const equipmentPool = [
  ['ricebox', '米饭便当', '米饭额外恢复 10 点生命。', '🍚'], ['armor', '贝壳护甲', '每次受到的伤害减少 1 点。', '🐚'],
  ['thrust', '强劲鱼尾', '移动速度提高 15 点。', '🐟'], ['regen', '平静洋流', '每秒恢复 0.6 点生命。', '💚'],
  ['impact', '冲击核心', '冲锋对敌人和宝箱的伤害提高 40%。', '🔵'],
  ['frost', '寒霜水弹', '水弹命中后减速敌人 1.5 秒。', '❄️'], ['ricochet', '反弹连锁', '水弹命中后跳向附近敌人。', '🪃'],
  ['orbit', '环流水刃', '周期性伤害身边的敌人。', '🌀'], ['nova', '击杀爆破', '击杀时对附近敌人造成爆炸伤害。', '💫'],
];
const gptTraitPool = [
  ['energyGain', '高效学习', '每点经验额外获得 2 点能量。', '📈'], ['energyMax', '深层缓存', '最大能量提高 20 点。', '🔋'],
  ['efficiency', '高效推理', '变身期间能量消耗降低 20%。', '🧠'], ['transformedDamage', '强化输出', '正常 GPT 形态伤害提高 20%。', '⚙️'],
];
export const CATALOG = Object.fromEntries([...traitPool, ...gptTraitPool, ...equipmentPool].map(([id, name, description, icon]) => [id, { name, description, icon }]));

export function createGame({ seed = 1, hero = 'deepseek', faction, difficulty = 'standard', length='standard' } = {}) {
  const s = (Number(seed) >>> 0) || 1;
  const heroId = Object.hasOwn(HEROES, hero) ? hero : 'deepseek'; const heroConfig = HEROES[heroId];
  const playerFaction = Object.hasOwn(ENEMY_ROSTERS, faction) ? faction : heroConfig.faction;
  const stats = heroConfig.stats;
  return {
    rng: s, visualRng: s, difficulty: Object.hasOwn(DIFFICULTIES,difficulty)?difficulty:'standard', phase: 'playing', round: 1, maxRounds: ({quick:5,standard:10,long:20}[length]||10), campaignVersion: 3, scene: createScene(1), roundTime: 0, roundDuration: 20, time: 0, playerFaction, heroId,
    score: 0, level: 1, xp: 0, xpNeed: 8, pendingLevels: 0,
    player: { x: WIDTH / 2, y: HEIGHT / 2, radius: 28, fishStage: 1, health: stats.health, maxHealth: stats.health, vx: 0, vy: 0, facing: 1,
      fatLevel: 1, fatXp: 0, fatXpNeed: 2, fatness: 0, superFat: false, slideTimer: 0, slideDuration: 0,
      damage: stats.damage, fireRate: stats.fireRate, shots: 1, piercing: stats.piercing||1, speed: stats.speed, dashCooldown: 0, dashTimer: 0, chargeCooldown: 0, chargeTimer: 0, chargeDamage: stats.chargeDamage, chargeHits: [], orbitTimer: 0, orbitAngle: 0, luck: 0,
      shotTimer: 0, invulnerable: 0, magnet: 95, crit: 0, vampirism: 0, vampirismTimer: 0, chargeDirection: 0,
      energy: 0, energyMax: 100, transformed: false, transformTimer: 0, skillCooldown: 0, toolNodeTimer: 0,
      chromeShieldTimer: 0, chromeShieldCharges: 0, shieldTimer: 0, shieldCharges: 0, shieldCooldown: 0,
      compute: heroId==='qwen'?heroConfig.computeMax:0, computeMax: heroConfig.computeMax||0, laserTimer: 0 },
    enemies: [], bullets: [], beams: [], allies: [], orbs: [], chests: [], pickups: [], particles: [], blasts: [], choices: [], bossArena:null,bossHazards:[],
    traits: {}, traitPower: {}, equipment: {}, equipmentPower: {}, weapons: {}, weaponPower: {}, effects: { frost: 0, ricochet: 0, orbit: 0, nova: 0 }, buildLog: [], novaActive: false, inventory: { rice: 0, chromeOrb: 0, resetScroll: 0, astraCore: 0, doubaoSnack: 0, computeCell: 0, kimiLens: 0 }, appliedShopReceipts: [], notice: '', events: [], spawnTimer: 0, chestTimer: 12, eliteSpawned: false, bossSpawned: false,
    kills: 0, damageTaken: 0, nextEnemyId: 1, nextAllyId: 1, bossDefeated: false, nextAutoRiceAt: 8,
  };
}

export function normalizeGameSnapshot(snapshot){
  const raw=snapshot&&typeof snapshot==='object'?JSON.parse(JSON.stringify(snapshot)):{};
  const hero=Object.hasOwn(HEROES,raw.heroId)?raw.heroId:'deepseek';
  const defaults=createGame({seed:raw.rng??1,hero,faction:raw.playerFaction,difficulty:raw.difficulty});
  const result={...defaults,...raw};
  result.maxRounds=[5,10,20].includes(raw.maxRounds)?raw.maxRounds:10;
  result.campaignVersion=3;
  result.level=Math.min(40,Math.max(1,Number(raw.level)||1));result.xpNeed=xpThreshold(result.level);result.pendingLevels=Math.min(Math.max(0,Number(raw.pendingLevels)||0),40-result.level);
  ensureScene(result);
  result.heroId=hero;result.playerFaction=Object.hasOwn(ENEMY_ROSTERS,raw.playerFaction)?raw.playerFaction:defaults.playerFaction;
  result.difficulty=Object.hasOwn(DIFFICULTIES,result.difficulty)?result.difficulty:'standard';
  result.player={...defaults.player,...(raw.player||{})};
  for(const key of ['inventory','traits','traitPower','equipment','equipmentPower','weapons','weaponPower','effects'])result[key]={...defaults[key],...(raw[key]||{})};
  for(const [key,cap] of Object.entries({damage:30,maxHealth:8,speed:6,fireRate:10,transformedDamage:5}))result.traitPower[key]=clamp(Number(result.traitPower[key])||0,0,cap);
  for(const [key,cap] of Object.entries({damage:12,maxHealth:8,speed:6,fireRate:10,transformedDamage:5}))result.traits[key]=Math.min(cap,Math.max(0,Number(result.traits[key])||0));
  result.xp=Math.max(0,Math.min(Number(raw.xp)||0,result.level===40?0:result.xpNeed-1));
  const p=result.player,base=HEROES[hero].stats;
  const maxHealth=base.health+Math.round(25*result.traitPower.maxHealth)+(hero==='deepseek'?12*Math.max(0,(p.fatLevel||1)-1):0);
  p.maxHealth=maxHealth;p.health=clamp(Number.isFinite(p.health)?p.health:maxHealth,0,maxHealth);
  const formBase=hero==='gpt'&&p.transformed?36:base.damage;
  p.damage=formBase*Math.min(5.5,damageFactor(result.traitPower.damage)+(hero==='gpt'&&p.transformed ? .2*result.traitPower.transformedDamage : 0));
  p.speed=(hero==='gpt'&&p.transformed?125:base.speed)*(1+.12*result.traitPower.speed)+15*(result.equipmentPower.thrust||0);
  p.fireRate=fireInterval(hero==='gpt'&&p.transformed ? .5 : base.fireRate,result.traitPower.fireRate);
  for(const key of ['enemies','bullets','beams','allies','orbs','chests','pickups','particles','blasts','choices','buildLog','events'])result[key]=Array.isArray(raw[key])?raw[key]:defaults[key];
  result.appliedShopReceipts=Array.isArray(raw.appliedShopReceipts)?raw.appliedShopReceipts.filter(id=>typeof id==='string').slice(-128):[];
  result.nextAllyId=Math.max(Number.isInteger(raw.nextAllyId)&&raw.nextAllyId>0?raw.nextAllyId:1,Math.max(0,...result.allies.map(a=>Number(a.id)||0))+1);
  result.allies=result.allies.slice(0,limits.allies).map(normalizeAlly);
  result.bossHazards=Array.isArray(raw.bossHazards)?raw.bossHazards.slice(0,12):[];
  if(!result.enemies.some(e=>e.kind==='boss'&&e.hp>0)){result.bossArena=null;result.bossHazards=[];}
  return result;
}

function rand(g) { g.rng = (Math.imul(g.rng, 1664525) + 1013904223) >>> 0; return g.rng / 4294967296; }
function visualRand(g) { g.visualRng = (Math.imul(g.visualRng, 1664525) + 1013904223) >>> 0; return g.visualRng / 4294967296; }
function event(g, type, data = {}) { g.events.push({ type, ...data }); if (g.events.length > limits.events) g.events.shift(); }
function addBlast(g,x,y,kind='nova',radius=80) {
  g.blasts ||= [];g.particles ||= [];g.visualRng ??= 1;
  if(g.blasts.length>=limits.blasts)g.blasts.shift();
  g.blasts.push({x,y,radius,age:0,duration:.45,kind});
  for(let i=0;i<24&&g.particles.length<limits.particles;i++){
    const angle=visualRand(g)*Math.PI*2,speed=35+visualRand(g)*135,life=.22+visualRand(g)*.28;
    g.particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,radius:2+visualRand(g)*3,color:visualRand(g)<.5?'#ffb44f':'#fff0a6',life,maxLife:life});
  }
}
function recordBuild(g, choice) {
  g.buildLog.push({ name: choice.name, id: choice.id, rarity: choice.rarity.label, rarityId: choice.rarity.id, description: choice.description });
  if (g.buildLog.length > 100) g.buildLog.shift();
}
function powerDescription(id, rarity, g) {
  const m = rarity.multiplier;
  if (id === 'damage') {const before=damageFactor(g.traitPower.damage||0),after=damageFactor(Math.min(30,(g.traitPower.damage||0)+m));return `水弹伤害提高 ${((after/before-1)*100).toFixed(1)}%；累计加成，后段收益递减。`;}
  if (id === 'fireRate') {const before=g.player.fireRate,base=g.heroId==='gpt'&&g.player.transformed ? .5 : HEROES[g.heroId].stats.fireRate,after=fireInterval(base,Math.min(10,(g.traitPower.fireRate||0)+m));return `射击间隔减少 ${((1-after/before)*100).toFixed(1)}%。`;}
  if (id === 'maxHealth') {const power=g.traitPower.maxHealth||0,gain=Math.round(25*Math.min(8,power+m))-Math.round(25*power);return `最大生命提高 ${gain}，并恢复同等生命。`;}
  if (id === 'crit') return `暴击率提高 ${((Math.min(.75,g.player.crit+.12*m)-g.player.crit)*100).toFixed(1)} 个百分点。`;
  if (id === 'speed') {
    const before=1+.12*(g.traitPower.speed||0);
    const after=1+.12*Math.min(6,(g.traitPower.speed||0)+m);
    return `移动速度提高 ${((after/before-1)*100).toFixed(1)}%。`;
  }
  if (id === 'fortune') return `幸运提高 ${Math.min(100-g.player.luck,10*m).toFixed(1)} 点。`;
  if (id === 'multishot') return `每次额外发射 ${Math.max(1,Math.ceil(m))} 枚水弹。`;
  if (id === 'piercing') return `水弹额外穿透 ${Math.max(1,Math.ceil(m))} 名敌人。`;
  if (id === 'vampirism') {const before=Math.min(8,Math.round(2*(g.traitPower.vampirism||0))),after=Math.min(8,Math.round(2*((g.traitPower.vampirism||0)+m)));return `击杀回血额外提高 ${after-before} 点，上限 8 点；每 0.25 秒最多触发一次。`;}
  if (id === 'magnet') return `经验吸取范围增加 ${Math.round(65*m)}。`;
  if (id === 'chargeCooldown') {const before=Math.max(1,5*(1-.15*(g.traitPower.chargeCooldown||0))),after=Math.max(1,5*(1-.15*((g.traitPower.chargeCooldown||0)+m)));return `冲锋冷却减少 ${(before-after).toFixed(1)} 秒。`;}
  if (id === 'armor') return `每次受到的伤害减少 ${m.toFixed(1)} 点。`;
  if (id === 'thrust') return `移动速度提高 ${(15 * m).toFixed(1)} 点。`;
  if (id === 'regen') return `每秒恢复 ${(.6 * m).toFixed(1)} 点生命。`;
  if (id === 'energyGain') return `每点经验额外获得 ${(2*m).toFixed(1)} 点能量。`;
  if (id === 'energyMax') return `最大能量提高 ${Math.min(160-g.player.energyMax,Math.round(20*m))} 点。`;
  if (id === 'efficiency') {const before=Math.max(.2,1-.2*(g.traitPower.efficiency||0)),after=Math.max(.2,1-.2*((g.traitPower.efficiency||0)+m));return `变身期间能量消耗额外降低 ${((before-after)*100).toFixed(1)}%。`;}
  if (id === 'transformedDamage') {const base=damageFactor(g.traitPower.damage||0),power=g.traitPower.transformedDamage||0,before=Math.min(5.5,base+.2*power),after=Math.min(5.5,base+.2*Math.min(5,power+m));return `正常 GPT 形态伤害提高 ${((after/before-1)*100).toFixed(1)}%。`;}
  if (id === 'impact') return `冲锋伤害提高 ${Math.round(40 * m)}%。`;
  if (id === 'frost') return `水弹命中后额外造成 ${(10*m).toFixed(1)}% 伤害，并减速 ${Math.round(40*m)}%，持续 ${Math.min(3,1.5+.2*(m-1)).toFixed(1)} 秒。`;
  if (id === 'ricochet') return `命中后最多弹射 ${Math.min(2,Math.floor(m))} 次，每次造成 ${(35*m).toFixed(1)}% 伤害。`;
  if (id === 'orbit') {
    const oldLevel=g.weapons.orbit||0, oldCount=oldLevel?Math.min(7,oldLevel+2):0, count=Math.min(7,Math.max(3,oldLevel+1+2));
    const addedDamage=10*m,totalDamage=10*((g.weaponPower.orbit||0)+m);
    return oldLevel?`环刃数量增加 ${count-oldCount} 枚（共 ${count} 枚）；每 0.9 秒脉冲伤害增加 ${addedDamage.toFixed(1)} 点（共 ${totalDamage.toFixed(1)} 点），半径 150。`:`获得 ${count} 枚环刃；每 0.9 秒对半径 150 内敌人造成 ${totalDamage.toFixed(1)} 点脉冲伤害。`;
  }
  if (id === 'nova') return `击杀爆破半径 80，造成 ${(24*m).toFixed(1)} 点伤害。`;
  return CATALOG[id]?.description || '';
}
function choicesFrom(g, pool, count, prefix) {
  const a = pool.map(row => [...row]);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(g) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  const selected=a.slice(0,count);
  if(prefix==='trait'&&g.heroId==='gpt'){
    for(const id of ['energyMax','maxHealth']){
      const guaranteed=a.find(row=>row[0]===id);
      if(guaranteed&&!selected.some(row=>row[0]===id)){
        const replace=selected.findIndex(row=>row[0]!=='energyMax'&&row[0]!=='maxHealth');
        if(replace>=0)selected[replace]=guaranteed;
      }
    }
  }
  return selected.map(([id, name, description, icon]) => {
    const rarity = rollRarity(rand(g), g.player.luck);
    return { id: `${prefix}:${id}`, name, description: powerDescription(id, rarity, g) || description, icon, rarity, rarityId: rarity.id, rarityLabel: rarity.label, rarityColor: rarity.color, multiplier: rarity.multiplier };
  });
}
function levelCheck(g) {
  while (g.level<40 && g.xp >= g.xpNeed) { g.xp -= g.xpNeed; g.level++; g.xpNeed = 8 + 4 * (g.level - 1)+2*Math.max(0,g.level-8)**2; g.pendingLevels++; }
  if(g.level>=40)g.xp=0;
  if (g.pendingLevels && g.phase === 'playing') { g.phase = 'trait'; g.choices = choicesFrom(g, availableTraits(g), 3, 'trait'); }
}
export function grantExperience(g, amount) {
  if (g.phase === 'lost' || g.phase === 'won') return;
  amount = Math.max(0, amount);
  if (g.heroId === 'gpt') g.player.energy = Math.min(g.player.energyMax, g.player.energy + amount * (4 + 2 * (g.traitPower.energyGain || 0)));
  g.xp += amount; levelCheck(g);
}
function availableTraits(g) {
  const p=g.player;
  const general=traitPool.filter(([id]) => (id==='damage'&&(g.traits.damage||0)<12&&(g.traitPower.damage||0)<30)||(id==='maxHealth'&&(g.traitPower.maxHealth||0)<8)||
    (id==='fireRate'&&(g.traitPower.fireRate||0)<10&&p.fireRate>0.12)||(id==='vampirism'&&p.vampirism<4)||(id==='multishot'&&p.shots<8)||
    (id==='piercing'&&(p.piercing||1)<6)||(id==='crit'&&p.crit<0.75)||(id==='speed'&&(g.traitPower.speed||0)<6)||
    (id==='magnet'&&(g.traits.magnet||0)<6)||(id==='fortune'&&p.luck<100)||(id==='chargeCooldown'&&g.heroId==='deepseek'&&5*(1-.15*(g.traitPower.chargeCooldown||0))>1));
  if(g.heroId!=='gpt')return general;
  const specials=gptTraitPool.filter(([id]) => id==='energyMax'?p.energyMax<160:id==='efficiency'?(g.traitPower.efficiency||0)<4:id==='transformedDamage'?(g.traitPower.transformedDamage||0)<5:(g.traits[id]||0)<5);
  return [...specials,...general];
}
function availableEquipment(g){return (g.heroId==='deepseek'?equipmentPool:equipmentPool.filter(([id])=>id!=='ricebox'&&id!=='impact')).filter(([id])=>['frost','ricochet','orbit','nova'].includes(id)?(g.weapons[id]||0)<5:(g.equipment[id]||0)<5);}
function addXpOrb(g, x, y, value = 1) {
  if (g.orbs.length < limits.orbs) g.orbs.push({ x, y, value, radius: 7 });
  else { const nearest = g.orbs.reduce((a, b) => dist2(a, { x, y }) < dist2(b, { x, y }) ? a : b); nearest.value += value; }
}
function spawnEnemy(g, kind = 'chaser', { identity:forcedIdentity=null, lifetime=0 } = {}) {
  if (g.enemies.length >= limits.enemies) return false;
  const angle = rand(g) * Math.PI * 2, radiusFromPlayer = 320 + rand(g) * 180;
  const x = clamp(g.player.x + Math.cos(angle) * radiusFromPlayer, 30, WIDTH - 30), y = clamp(g.player.y + Math.sin(angle) * radiusFromPlayer, 30, HEIGHT - 30);
  const progression=Math.min(10,g.round)+Math.max(0,g.round-10)*.55;
  const late=Math.max(0,g.round-10);
  const defs = { chaser: [26, g.round>10?200+44*(g.round-11):28+progression*7, 48+progression*2], summon: [17, 24+progression*3, 72+progression*2], dash: [20, 30+progression*4+late*30, 85+progression*2], ranged: [22, 38+progression*5+late*30, 42+progression], elite: [38, 180+progression*25+late*35, 32+progression], boss: [62+Math.floor((g.round-1)/5)*4, 2000+90*g.round*g.round, 40] };
  let [radius, hp, speed] = defs[kind]||defs.chaser;
  const opponent = opposingRoster(g.playerFaction)[kind];
  const elite = kind === 'elite' ? ELITE_ROSTERS[g.playerFaction][Math.floor(rand(g) * ELITE_ROSTERS[g.playerFaction].length)] : null;
  const qwenSmall={modelId:'qwenSmall',name:'Qwen小兵',tier:1,portrait:'qwen',color:'#71c7a0'};
  let identity = forcedIdentity || elite || (kind==='summon'?qwenSmall:opponent);
  if(kind==='boss'&&g.playerFaction==='cn'&&g.round<g.maxRounds)identity={modelId:'fable',name:'GPT Fable',tier:5,portrait:'gptNormal',color:'#d48fcb'};
  if(kind==='boss'&&g.playerFaction==='us')identity=rand(g)<.1?DOUBAO_BOSS:opponent;
  if(elite?.behavior==='tank'){hp=Math.round(hp*1.35);speed*=.8;}
  if(elite?.behavior==='burst'){hp=Math.round(hp*.85);speed*=1.6;}
  const difficulty=DIFFICULTIES[g.difficulty]||DIFFICULTIES.standard;
  hp=Math.max(1,Math.round(hp*difficulty.enemyHealth));
  const enemy={ id: g.nextEnemyId++, x, y, radius, hp, maxHp: hp, speed, kind, modelId: identity.modelId, name: identity.name, tier: identity.tier, portrait: identity.portrait, color: identity.color, behavior: identity.behavior||elite?.behavior||null,
    shotTimer: 1.5, dashTimer: 1.2, hitFlash: 0, slowTimer: 0, xp: (kind === 'boss' ? 35 : kind === 'elite' ? 10 : kind==='summon'?0:kind==='chaser'?1:2)*difficulty.xp };
  if(g.round>=6&&['chaser','dash','ranged'].includes(kind)&&rand(g)<Math.min(.65,.25+.025*(g.round-6))){
    enemy.modifier=rand(g)<.5?'armored':'swift';
    if(enemy.modifier==='swift')enemy.speed*=1.25;
    else{enemy.hp=enemy.maxHp=Math.round(enemy.hp*1.2);}
  }
  if(lifetime>0){enemy.life=lifetime;enemy.maxLife=lifetime;enemy.summoned=true;}
  if(kind==='boss'&&identity.behavior==='summoner'){enemy.summonTimer=1;enemy.telegraph=1;}
  if(kind==='boss'&&identity.behavior==='egg'){enemy.shieldTimer=3;enemy.shieldCooldown=8;}
  g.enemies.push(enemy);
  if(kind==='boss')beginBossArena(g,enemy,{width:WIDTH,height:HEIGHT});
  return true;
}
function fire(g, target) {
  const p = g.player; const d = unit(target.x - p.x, target.y - p.y); p.facing = Math.atan2(d.y, d.x);
  if(g.heroId==='kimi'){fireLaser(g,640,8,p.damage,p.piercing||3,'#72ddff',target);return;}
  const n = p.shots; for (let i = 0; i < n; i++) {
    if (g.bullets.length >= limits.bullets) break;
    const spread = (i - (n - 1) / 2) * 0.13; const c = Math.cos(spread), s = Math.sin(spread);
    const dx = d.x * c - d.y * s, dy = d.x * s + d.y * c;
    g.bullets.push({ x: p.x, y: p.y, vx: dx * 550, vy: dy * 550, damage: p.damage, radius: 9, life: 1.8, hits: p.piercing || 1, hitIds: [], ricochets: Math.min(2, Math.floor(g.weaponPower.ricochet || 0)) });
  }
}
function pointSegmentDistance2(point,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,len=dx*dx+dy*dy||1,t=clamp(((point.x-ax)*dx+(point.y-ay)*dy)/len,0,1),x=ax+t*dx,y=ay+t*dy;return {distance2:(point.x-x)**2+(point.y-y)**2,t};}
function addBeam(g,beam){g.beams||=[];if(g.beams.length>=limits.beams)g.beams.shift();g.beams.push({...beam,life:.16,maxLife:.16});}
function dealEnemyDamage(g,e,amount,{ignoreShield=false}={}){
  if(!g.enemies.includes(e))return 0;
  const effective=(!ignoreShield&&e.kind==='boss'&&e.behavior==='egg'&&e.shieldTimer>0?amount*.5:amount)*(e.modifier==='armored'?.75:1);
  e.hp-=effective;e.hitFlash=.12;if(e.hp<=0)killEnemy(g,e);return effective;
}
function chainRicochet(g,from,hitIds,damage,power){let left=Math.min(2,Math.floor(power)),origin=from;
  while(left-->0){let next=null,near=180**2;for(const candidate of g.enemies){if(hitIds.includes(candidate.id))continue;const d=dist2(origin,candidate);if(d<near){near=d;next=candidate;}}
    if(!next)break;hitIds.push(next.id);dealEnemyDamage(g,next,damage*.35*power);origin=next;
  }
}
function fireLaser(g,length,width,damage,maxHits,color,aimTarget=null){
  const p=g.player;let target=aimTarget;
  for(const e of g.enemies)if(!Number.isInteger(e.id))e.id=g.nextEnemyId++;
  if(!target&&Number.isFinite(p.aimX)&&Number.isFinite(p.aimY)&&Math.hypot(p.aimX-p.x,p.aimY-p.y)>1)target={x:p.aimX,y:p.aimY};
  if(!target){let nearest=Infinity;for(const e of g.enemies){const d=dist2(p,e);if(d<nearest){nearest=d;target=e;}}}
  const baseAngle=target?Math.atan2(target.y-p.y,target.x-p.x):p.facing,shots=Math.min(8,Math.max(1,p.shots||1));p.facing=baseAngle;
  for(let shot=0;shot<shots;shot++){
    const angle=baseAngle+(shot-(shots-1)/2)*.035,dx=Math.cos(angle),dy=Math.sin(angle),toX=p.x+dx*length,toY=p.y+dy*length;
    addBeam(g,{x:p.x,y:p.y,toX,toY,width,color});
    const inLine=g.enemies.map(e=>({e,...pointSegmentDistance2(e,p.x,p.y,toX,toY)})).filter(x=>x.distance2<=(x.e.radius+width/2)**2).sort((a,b)=>a.t-b.t);
    const hitIds=[];for(const {e} of inLine){if(hitIds.length>=maxHits)break;if(!g.enemies.includes(e))continue;hitIds.push(e.id);const hitDamage=damage*(rand(g)<p.crit?2:1)*(1+.1*(g.weaponPower.frost||0));dealEnemyDamage(g,e,hitDamage);
      if(g.weaponPower.frost>0){e.slowTimer=Math.max(e.slowTimer||0,Math.min(3,1.5+.2*(g.weaponPower.frost-1)));e.slowFactor=Math.max(.2,1-.4*g.weaponPower.frost);}}
    if(g.weaponPower.ricochet>0&&hitIds.length)chainRicochet(g,inLine.find(x=>x.e.id===hitIds.at(-1)).e,hitIds,damage,g.weaponPower.ricochet);
    for(const chest of [...g.chests])if(pointSegmentDistance2(chest,p.x,p.y,toX,toY).distance2<=(chest.radius+width/2)**2)damageChest(g,chest,damage);
    for(const node of g.scene?.nodes||[])if(node.hp>0&&pointSegmentDistance2(node,p.x,p.y,toX,toY).distance2<=(node.radius+width/2)**2)damageSceneNode(g,node,damage);
  }
}
function normalizeAlly(a){
  const max=a.kind==='qwenMax',maxHp=Number.isFinite(a.maxHp)?a.maxHp:max?420:80;
  const result={...a,maxHp,hp:Number.isFinite(a.hp)?a.hp:maxHp,radius:max?38:(a.radius||17),speed:Number.isFinite(a.speed)?a.speed:max?68:125,fireRate:Number.isFinite(a.fireRate)?a.fireRate:max?.75:.95,range:Number.isFinite(a.range)?a.range:max?600:470,armor:max?4:0,invulnerable:Number.isFinite(a.invulnerable)?a.invulnerable:0};
  delete result.life;delete result.maxLife;return result;
}
function hurtAlly(g,a,amount){
  if(a.hp<=0||a.invulnerable>0)return;
  a.hp=Math.max(0,a.hp-Math.max(1,amount*(DIFFICULTIES[g.difficulty]||DIFFICULTIES.standard).enemyDamage-(a.armor||0)));a.invulnerable=.55;
  if(!a.hp)event(g,'ally-defeated',{id:a.id,kind:a.kind});
}
function summonAlly(g,kind){
  if(g.heroId!=='qwen'||g.phase!=='playing'||g.allies.length>=limits.allies)return false;
  const p=g.player,max=kind==='qwenMax',cost=max?HEROES.qwen.maxCost:HEROES.qwen.smallCost;if(p.compute<cost)return false;p.compute-=cost;
  const index=g.allies.length,angle=(index%8)*Math.PI/4;
  const maxHp=max?420:Math.round(55+rand(g)*55),speed=max?68:Math.round(95+rand(g)*70),damage=max?38:Math.round(8+rand(g)*10),fireRate=max?.75:.7+rand(g)*.55;
  const ally=normalizeAlly({id:g.nextAllyId++,x:clamp(p.x+Math.cos(angle)*75,40,WIDTH-40),y:clamp(p.y+Math.sin(angle)*75,40,HEIGHT-40),radius:max?38:16+Math.round(rand(g)*4),kind,hp:maxHp,maxHp,speed,damage,fireRate,shotTimer:.35,modelId:max?'qwenMax':'qwenSmall',name:max?'Qwen Max':'Qwen小兵',color:max?'#26b482':'#71c7a0'});
  g.allies.push(ally);event(g,'ally-summoned',{kind,cost,compute:p.compute,id:ally.id});return ally;
}
function updateAllies(g,dt){
  const p=g.player;g.allies=(g.allies||[]).slice(0,limits.allies);
  for(let index=0;index<g.allies.length;index++){
    let ally=g.allies[index];if(!Number.isFinite(ally.hp))ally=g.allies[index]=normalizeAlly(ally);if(ally.hp<=0)continue;ally.invulnerable=Math.max(0,(ally.invulnerable||0)-dt);
    let target=null,nearest=Infinity;for(const e of g.enemies){const d=dist2(ally,e);if(d<nearest){nearest=d;target=e;}}
    let desiredX=p.x+Math.cos(index*Math.PI/4)*90,desiredY=p.y+Math.sin(index*Math.PI/4)*90;
    if(target&&nearest<750**2&&dist2(ally,p)<850**2){const toward=unit(target.x-ally.x,target.y-ally.y),standOff=ally.kind==='qwenMax'?220:160;desiredX=target.x-toward.x*standOff;desiredY=target.y-toward.y*standOff;}
    const follow=unit(desiredX-ally.x,desiredY-ally.y),distance=Math.hypot(desiredX-ally.x,desiredY-ally.y),move=Math.min(distance,ally.speed*dt*terrainFactor(g,ally));
    ally.x=clamp(ally.x+follow.x*move,ally.radius,WIDTH-ally.radius);ally.y=clamp(ally.y+follow.y*move,ally.radius,HEIGHT-ally.radius);
    for(let j=0;j<index;j++){const other=g.allies[j],distance=Math.hypot(ally.x-other.x,ally.y-other.y),minimum=ally.radius+other.radius+5;if(distance<minimum){const d=distance>.01?unit(ally.x-other.x,ally.y-other.y):{x:1,y:0},push=Math.min((minimum-distance)*.5,45*dt);ally.x=clamp(ally.x+d.x*push,ally.radius,WIDTH-ally.radius);ally.y=clamp(ally.y+d.y*push,ally.radius,HEIGHT-ally.radius);}}
    ally.shotTimer-=dt;
    if(target&&nearest<ally.range**2&&ally.shotTimer<=0&&g.bullets.length<limits.bullets-limits.allyBullets){
      const aim=unit(target.x-ally.x,target.y-ally.y);g.bullets.push({x:ally.x,y:ally.y,vx:aim.x*460,vy:aim.y*460,damage:ally.damage,radius:6,life:1.6,hits:1,hitIds:[],owner:'ally'});ally.shotTimer=ally.fireRate;
    }
  }
  g.allies=g.allies.filter(ally=>ally.hp>0);
}
function damageChest(g, chest, amount) {
  chest.hp -= amount;
  if (chest.hp <= 0) { g.chests = g.chests.filter(c => c !== chest); const key=HEROES[g.heroId].itemKey; if (g.pickups.length < limits.pickups) g.pickups.push({ x: chest.x, y: chest.y, kind: key, itemKey:key, radius: 13 }); event(g, 'chest-opened'); }
}
export function openChest(g, chest) { if (g.chests.includes(chest)) damageChest(g, chest, chest.hp); }
function damageSceneNode(g,node,amount){
  if(node.hp<=0)return;node.hp=Math.max(0,node.hp-amount);
  if(!node.hp){addXpOrb(g,node.x,node.y,5);event(g,'scene-node-broken',{text:'晶簇击碎了，捡起经验！'});}
}
function updateScene(g){
  const scene=ensureScene(g);if(g.time<scene.nextPulseAt)return;scene.nextPulseAt=g.time+.5;
  for(const vent of mapForRound(g.round).vents){if(ventPhase(g.time,vent)!=='active')continue;
    if(dist2(g.player,vent)<(vent.radius+g.player.radius*.4)**2)hurt(g,5);
    for(const e of [...g.enemies])if(dist2(e,vent)<(vent.radius+e.radius*.4)**2)dealEnemyDamage(g,e,12);
    for(const a of g.allies)if(a.hp>0&&dist2(a,vent)<(vent.radius+a.radius*.4)**2)hurtAlly(g,a,5);
  }
}
function hurt(g, amount) {
  const p = g.player; if (p.invulnerable > 0 || g.phase !== 'playing') return;
  if(p.chromeShieldTimer>0&&p.chromeShieldCharges>0){p.chromeShieldCharges--;p.invulnerable=Math.max(p.invulnerable,0.45);if(!p.chromeShieldCharges)p.chromeShieldTimer=0;event(g,'chrome-shield-hit',{charges:p.chromeShieldCharges});return;}
  if(p.shieldTimer>0&&p.shieldCharges>0){p.shieldCharges--;p.invulnerable=Math.max(p.invulnerable,.45);event(g,'doubao-shield-hit',{charges:p.shieldCharges});return;}
  amount *= (DIFFICULTIES[g.difficulty]||DIFFICULTIES.standard).enemyDamage;
  let reduced = Math.max(1, amount - (g.equipmentPower.armor || 0));
  if(g.heroId==='gpt'&&p.transformed)reduced=Math.max(1,Math.ceil(reduced*0.5));
  const damage = p.slideTimer > 0 ? Math.max(1, Math.ceil(reduced * 0.6)) : reduced;
  p.health = Math.max(0, p.health - damage); p.invulnerable = 0.45; g.damageTaken += damage;
  if (!p.health) { g.phase = 'lost'; g.notice = '你被深海洋流卷走了。'; event(g, 'lost'); }
}
function killEnemy(g, e) {
  if(!g.enemies.includes(e))return;
  g.enemies = g.enemies.filter(x => x !== e); g.kills++; g.score += e.kind === 'boss' ? 5000 : e.kind === 'elite' ? 300 : 50;
  addXpOrb(g, e.x, e.y, e.xp); if (e.kind === 'boss') {g.bossDefeated = true;g.bossArena=null;g.bossHazards=[];}
  const nova = 24 * (g.weaponPower.nova || 0);
  if (nova > 0 && !g.novaActive) {
    addBlast(g,e.x,e.y,'nova');
    g.novaActive = true;
    for (const other of [...g.enemies]) if (dist2(e, other) <= 80 ** 2) dealEnemyDamage(g,other,nova);
    g.novaActive = false;
    event(g, 'nova', { x: e.x, y: e.y, radius: 80, damage: nova });
  }
  if (g.player.vampirism && g.player.vampirismTimer <= 0) { g.player.health = Math.min(g.player.maxHealth, g.player.health + Math.min(8, Math.round(2 * (g.traitPower.vampirism||g.player.vampirism)))); g.player.vampirismTimer = 0.25; }
  event(g, 'enemy-defeated', { kind: e.kind });
}
function primary(g) {
  const p = g.player; if (p.chargeCooldown > 0 || p.chargeTimer > 0 || p.slideTimer > 0) return;
  p.chargeTimer = p.dashTimer = 0.4; p.chargeCooldown = p.dashCooldown = Math.max(1, 5 * (1 - (g.traitPower.chargeCooldown || 0) * 0.15)); p.chargeHits = []; p.invulnerable = 0.45;
  const aim = Number.isFinite(p.aimX) && Number.isFinite(p.aimY) && (Math.abs(p.aimX - p.x) + Math.abs(p.aimY - p.y) > 1);
  const d = aim ? unit(p.aimX - p.x, p.aimY - p.y) : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
  p.facing = Math.atan2(d.y, d.x); p.chargeDirection = p.facing; p.chargeVx = d.x * 550; p.chargeVy = d.y * 550; p.vx = p.chargeVx; p.vy = p.chargeVy; event(g, 'charge');
}
function applyGptForm(g, normal) {
  const p=g.player;p.transformed=normal;
  const baseDamage=normal?36:HEROES.gpt.stats.damage;
  p.damage=baseDamage*Math.min(5.5,damageFactor(g.traitPower.damage||0)+(normal?0.2*(g.traitPower.transformedDamage||0):0));
  p.speed=(normal?125:HEROES.gpt.stats.speed)*(1+0.12*(g.traitPower.speed||0))+15*(g.equipmentPower.thrust||g.equipment.thrust||0);
  p.fireRate=fireInterval(normal?0.5:HEROES.gpt.stats.fireRate,g.traitPower.fireRate||0);
}
export function useHeroSkill(g) {
  if(g.phase!=='playing')return [];
  const p=g.player;
  if(g.heroId==='doubao'){
    if(p.shieldCooldown>0)return [];
    p.shieldTimer=3;p.shieldCharges=2;p.shieldCooldown=HEROES.doubao.skillCooldown;
    for(const e of g.enemies)if(dist2(p,e)<=HEROES.doubao.pushRadius**2){const d=unit(e.x-p.x,e.y-p.y);e.x=clamp(e.x+d.x*HEROES.doubao.pushDistance,e.radius,WIDTH-e.radius);e.y=clamp(e.y+d.y*HEROES.doubao.pushDistance,e.radius,HEIGHT-e.radius);}
    event(g,'doubao-shield',{duration:p.shieldTimer,charges:p.shieldCharges,push:HEROES.doubao.pushDistance});return g.events.splice(0);
  }
  if(g.heroId==='qwen'){summonAlly(g,'qwenSmall');return g.events.splice(0);}
  if(g.heroId==='kimi'){
    if(p.skillCooldown>0)return [];
    p.skillCooldown=HEROES.kimi.skillCooldown;fireLaser(g,850,14,120,p.piercing||3,'#ffc668');event(g,'kimi-focus',{length:850,damage:120,width:14});return g.events.splice(0);
  }
  if(g.heroId==='deepseek'){primary(g);return g.events.splice(0);}
  if(g.heroId==='gemini'){
    if(p.skillCooldown>0)return [];
    if(Number.isFinite(p.aimX)&&Number.isFinite(p.aimY)&&Math.hypot(p.aimX-p.x,p.aimY-p.y)>1)p.facing=Math.atan2(p.aimY-p.y,p.aimX-p.x);
    p.x=clamp(p.x+Math.cos(p.facing)*260,p.radius,WIDTH-p.radius);p.y=clamp(p.y+Math.sin(p.facing)*260,p.radius,HEIGHT-p.radius);
    p.invulnerable=Math.max(p.invulnerable,0.65);p.skillCooldown=HEROES.gemini.skillCooldown;event(g,'flash',{distance:260});return g.events.splice(0);
  }
  if(g.heroId==='astra'){
    if(p.skillCooldown>0)return [];
    for(const e of [...g.enemies])if(dist2(p,e)<=300**2){dealEnemyDamage(g,e,300);const d=unit(e.x-p.x,e.y-p.y);e.x=clamp(e.x+d.x*160,e.radius,WIDTH-e.radius);e.y=clamp(e.y+d.y*160,e.radius,HEIGHT-e.radius);}
    p.skillCooldown=7;event(g,'starburst',{radius:300,damage:300});return g.events.splice(0);
  }
  if(!p.transformed){if(p.energy<20)return [];applyGptForm(g,true);event(g,'gpt-transform',{energy:p.energy});return g.events.splice(0);}
  if(p.skillCooldown>0)return [];
  p.toolNodeTimer=3;p.skillCooldown=6;
  for(const b of g.bullets)if(b.hostile&&dist2(p,b)<=360**2)b.life=0;
  for(const e of g.enemies)if(dist2(p,e)<=360**2){const d=unit(e.x-p.x,e.y-p.y);e.x=clamp(e.x+d.x*360,e.radius,WIDTH-e.radius);e.y=clamp(e.y+d.y*360,e.radius,HEIGHT-e.radius);}
  g.bullets=g.bullets.filter(b=>b.life>0);event(g,'tool-node',{duration:3,radius:360});return g.events.splice(0);
}
export function useHeroSecondary(g){
  if(g.phase!=='playing'||g.heroId!=='qwen')return [];
  summonAlly(g,'qwenMax');return g.events.splice(0);
}
export function performAction(g, command) {
  g.events = [];
  if (g.phase !== 'playing') return [];
  if (typeof command === 'object' && command) {
    if (Number.isFinite(command.aimX)) g.player.aimX = command.aimX;
    if (Number.isFinite(command.aimY)) g.player.aimY = command.aimY;
    g.input = { moveX: command.moveX || 0, moveY: command.moveY || 0 };
    if (command.type === 'primary' || command.command === 'primary') return useHeroSkill(g);
    if (command.type === 'secondary' || command.command === 'secondary') return useHeroSecondary(g);
    if(command.type==='transform-off'&&g.heroId==='gpt'&&g.player.transformed){applyGptForm(g,false);g.player.toolNodeTimer=0;event(g,'gpt-transform-off');return g.events.splice(0);}
    if (command.type === 'use-item') return useItem(g, command.slot ?? 1);
  } else if (command === 'primary') return useHeroSkill(g); else if(command==='secondary')return useHeroSecondary(g);
  return g.events.splice(0);
}
export function useItem(g, slot = 1) {
  if (g.phase !== 'playing' || slot !== 1) return [];
  const key=HEROES[g.heroId].itemKey; if(!g.inventory?.[key])return [];
  if(key==='rice')return eatRice(g,false);
  if(key==='chromeOrb'&&g.player.chromeShieldTimer>0)return [];
  if(key==='resetScroll'&&g.player.energy>=g.player.energyMax)return [];
  if(key==='doubaoSnack'&&g.player.health>=g.player.maxHealth)return [];
  if(key==='computeCell'&&g.player.compute>=g.player.computeMax)return [];
  if(key==='kimiLens'&&g.player.skillCooldown<=0)return [];
  if(key==='astraCore'){g.inventory[key]--;g.player.skillCooldown=0;return [{type:'item-used',item:key,slot:1,cooldown:0,remaining:g.inventory[key]}];}
  g.inventory[key]--;
  if(key==='chromeOrb'){g.player.chromeShieldTimer=8;g.player.chromeShieldCharges=3;return [{type:'item-used',item:key,slot:1,charges:3,duration:8,remaining:g.inventory[key]}];}
  if(key==='resetScroll'){g.player.energy=g.player.energyMax;return [{type:'item-used',item:key,slot:1,energy:g.player.energy,remaining:g.inventory[key]}];}
  if(key==='doubaoSnack'){const before=g.player.health;g.player.health=Math.min(g.player.maxHealth,g.player.health+25);return [{type:'item-used',item:key,slot:1,healed:g.player.health-before,remaining:g.inventory[key]}];}
  if(key==='computeCell'){g.player.compute=Math.min(g.player.computeMax,g.player.compute+40);return [{type:'item-used',item:key,slot:1,compute:g.player.compute,remaining:g.inventory[key]}];}
  if(key==='kimiLens'){g.player.skillCooldown=0;return [{type:'item-used',item:key,slot:1,cooldown:0,remaining:g.inventory[key]}];}
  return [];
}
export function getShopItemStatus(g,id) {
  const item=SHOP_ITEMS[id];
  if(!item)return {available:false,reason:'没有这个商品。'};
  if(g.phase!=='playing')return {available:false,reason:'请在战斗中使用商品。'};
  if(id==='medkit'&&g.player.health>=g.player.maxHealth)return {available:false,reason:'生命值已满，暂时用不上医疗包。'};
  if(id==='supplies'){
    const key=HEROES[g.heroId]?.itemKey, count=Number(g.inventory?.[key]||0);
    if(!key||count>7||count+2>(limits[key]||0))return {available:false,reason:'背包至少需要 2 个空位。'};
  }
  if(id==='pulse'&&!g.enemies.some(e=>dist2(g.player,e)<=420**2))return {available:false,reason:'范围内没有可命中的敌人。'};
  if(id==='magnet'&&(!g.orbs.length||!g.orbs.some(o=>Number(o.value)>0)))return {available:false,reason:'场上没有可吸取的经验米粒。'};
  return {available:true,reason:'可使用。'};
}
export function applyShopItem(g,id,requestId) {
  g.appliedShopReceipts=Array.isArray(g.appliedShopReceipts)?g.appliedShopReceipts:[];
  const receiptKey=`${id}:${requestId}`;
  if(typeof requestId!=='string'||!requestId.trim()||requestId.length>128)return {applied:false,reason:'请求编号无效。',events:[]};
  if(g.appliedShopReceipts.includes(receiptKey))return {applied:false,reason:'这笔购买已处理过。',events:[]};
  const status=getShopItemStatus(g,id);
  if(!status.available)return {applied:false,reason:status.reason,events:[]};
  g.events=[];const p=g.player;let payload;
  if(id==='medkit'){
    const before=p.health, amount=Math.round(p.maxHealth*.4);p.health=Math.min(p.maxHealth,p.health+amount);
    payload={type:'shop-item-used',item:id,healed:p.health-before};
  }else if(id==='supplies'){
    const key=HEROES[g.heroId].itemKey;g.inventory[key]=(g.inventory[key]||0)+2;
    payload={type:'shop-item-used',item:id,inventoryItem:key,count:g.inventory[key],added:2};
  }else if(id==='pulse'){
    const targets=g.enemies.filter(e=>dist2(p,e)<=420**2);
    addBlast(g,p.x,p.y,'shop-pulse',420);let hit=0,damage=0,pushed=0;
    for(const e of targets){if(!g.enemies.includes(e))continue;const amount=e.kind==='boss'?60:120;damage+=dealEnemyDamage(g,e,amount,{ignoreShield:true});hit++;
      if(g.enemies.includes(e)){const d=unit(e.x-p.x,e.y-p.y);e.x=clamp(e.x+d.x*120,e.radius,WIDTH-e.radius);e.y=clamp(e.y+d.y*120,e.radius,HEIGHT-e.radius);pushed++;}}
    payload={type:'shop-item-used',item:id,hit,damage,pushed,radius:420,knockback:120};
  }else if(id==='magnet'){
    const count=g.orbs.length,totalXp=g.orbs.reduce((sum,o)=>sum+Math.max(0,Number(o.value)||0),0);
    if(!count||!totalXp)return {applied:false,reason:'场上没有可吸取的经验米粒。',events:[]};
    g.orbs=[];grantExperience(g,totalXp);payload={type:'shop-item-used',item:id,collected:count,xp:totalXp};
  }
  if(!payload)return {applied:false,reason:'商品暂时无法使用。',events:[]};
  g.appliedShopReceipts.push(receiptKey);if(g.appliedShopReceipts.length>128)g.appliedShopReceipts.splice(0,g.appliedShopReceipts.length-128);
  event(g,payload.type,payload);
  return {applied:true,reason:'使用成功。',events:g.events.splice(0)};
}
export function itemInfo(g) {
  const hero=HEROES[g.heroId]; const key=hero.itemKey; const available=(g.inventory[key]||0)>0;
  const ready=key==='rice'?(g.player.health<g.player.maxHealth||g.player.fatLevel<30):key==='doubaoSnack'?g.player.health<g.player.maxHealth:key==='computeCell'?g.player.compute<g.player.computeMax:key==='resetScroll'?g.player.energy<g.player.energyMax:key==='astraCore'||key==='kimiLens'?g.player.skillCooldown>0:key==='chromeOrb'?g.player.chromeShieldTimer<=0:true;
  return { key,name:hero.itemName,icon:hero.itemIcon,description:hero.itemDescription,count:g.inventory[key]||0,canUse:g.phase==='playing'&&available&&ready };
}
function recomputeFatStats(g) {
  const p = g.player; if(g.heroId!=='deepseek')return;
  p.fatLevel=clamp(p.fatLevel,1,30);p.fatness=p.fatLevel-1;p.radius=28+2.2*p.fatness;
  p.fishStage=Math.min(11,1+Math.ceil(p.fatness/3));
  p.maxHealth=HEROES.deepseek.stats.health+12*p.fatness+Math.round(25*(g.traitPower.maxHealth||0));p.health=Math.min(p.health,p.maxHealth);
  p.chargeDamage=HEROES.deepseek.stats.chargeDamage*(1+0.07*p.fatness)*(1+0.4*(g.equipmentPower.impact||0));
}
function eatRice(g, automatic) {
  const p = g.player; if (g.heroId!=='deepseek'||g.phase !== 'playing' || !g.inventory.rice || (!automatic && p.health >= p.maxHealth && p.fatLevel >= 30)) return [];
  const fullAtStart=p.health>=p.maxHealth;
  g.inventory.rice--;
  if(p.fatLevel<30){p.fatXp++;if(p.fatXp>=p.fatXpNeed){p.fatXp-=p.fatXpNeed;p.fatLevel++;p.fatXpNeed=2+Math.floor((p.fatLevel-1)*.65);recomputeFatStats(g);}}
  const normalHeal = 30 + (g.equipmentPower.ricebox || g.equipment.ricebox || 0) * 10; const requested = fullAtStart ? 0 : automatic ? Math.floor(normalHeal / 2) : normalHeal;
  const before = p.health; p.health = Math.min(p.maxHealth, p.health + requested);
  if (p.fatLevel >= 5 && !p.superFat && visualRand(g) < 0.04) p.superFat = true;
  const payload = { type: automatic ? 'auto-rice' : 'item-used', item: 'rice', slot: 1, healed: p.health - before, remaining: g.inventory.rice, fatness: p.fatness, fatLevel:p.fatLevel, fatXp:p.fatXp, fatXpNeed:p.fatXpNeed };
  if (automatic) event(g, 'auto-rice', payload);
  return [payload];
}
export function choose(g, choiceId) {
  const choice = g.choices.find(c => c.id === choiceId); if (!choice) return false;
  const [type, id] = choice.id.split(':');
  if (type === 'trait' && g.phase === 'trait') {
    recordBuild(g, choice);
    const previousPower=g.traitPower[id]||0;
    g.traits[id] = (g.traits[id] || 0) + 1; g.traitPower[id] = (g.traitPower[id] || 0) + choice.multiplier; const p = g.player;
    if(id==='damage')g.traitPower.damage=Math.min(30,g.traitPower.damage);
    if(id==='maxHealth')g.traitPower.maxHealth=Math.min(8,g.traitPower.maxHealth);
    if(id==='fireRate')g.traitPower.fireRate=Math.min(10,g.traitPower.fireRate);
    if(id==='speed')g.traitPower.speed=Math.min(6,g.traitPower.speed);
    if(id==='transformedDamage')g.traitPower.transformedDamage=Math.min(5,g.traitPower.transformedDamage);
    const mult = choice.multiplier;
    if (id === 'damage') {if(g.heroId==='gpt')applyGptForm(g,p.transformed);else p.damage=Math.min(HEROES[g.heroId].stats.damage*5.5,HEROES[g.heroId].stats.damage*damageFactor(g.traitPower.damage));}
    if (id === 'fireRate') { if(g.heroId==='gpt')applyGptForm(g,p.transformed);else p.fireRate = fireInterval(HEROES[g.heroId].stats.fireRate,g.traitPower.fireRate); }
    if (id === 'maxHealth') { const gain=Math.round(25*g.traitPower.maxHealth)-Math.round(25*previousPower);if(g.heroId==='deepseek'){p.health=Math.min(p.maxHealth+gain,p.health+gain);recomputeFatStats(g);}else{p.maxHealth=HEROES[g.heroId].stats.health+Math.round(25*(g.traitPower.maxHealth||0));p.health=Math.min(p.maxHealth,p.health+gain);} }
    if (id === 'vampirism') p.vampirism = g.traits.vampirism;
    if (id === 'multishot') p.shots = Math.min(8,p.shots+Math.max(1,Math.ceil(mult)));
    if (id === 'piercing') p.piercing = Math.min(6,(p.piercing || 1) + Math.max(1,Math.ceil(mult)));
    if (id === 'crit') p.crit = Math.min(0.75, p.crit + 0.12*mult);
    if (id === 'speed') { if(g.heroId==='gpt')applyGptForm(g,p.transformed);else p.speed=HEROES[g.heroId].stats.speed*(1+.12*g.traitPower.speed)+15*(g.equipmentPower.thrust||0); }
    if (id === 'magnet') p.magnet += Math.round(65*mult);
    if (id === 'fortune') p.luck = Math.min(100,p.luck+10*mult);
    if(id==='energyGain'||id==='energyMax'||id==='efficiency'||id==='transformedDamage'){if(id==='energyMax')p.energyMax=Math.min(160,p.energyMax+Math.round(20*mult));if(id==='transformedDamage'&&p.transformed)applyGptForm(g,true);}
    g.pendingLevels--; g.choices = []; if (g.pendingLevels) g.choices = choicesFrom(g, availableTraits(g), 3, 'trait'); else if (g.roundEnding) queueReward(g); else g.phase = 'playing'; return true;
  }
  if (type === 'gear' && g.phase === 'reward') {
    recordBuild(g, choice); const mult=choice.multiplier;
    if(['frost','ricochet','orbit','nova'].includes(id)) { g.weapons[id]=(g.weapons[id]||0)+1;g.weaponPower[id]=(g.weaponPower[id]||0)+mult;g.effects[id]=g.weaponPower[id]; }
    else { g.equipment[id]=(g.equipment[id]||0)+1;g.equipmentPower[id]=(g.equipmentPower[id]||0)+mult; }
    if (id === 'thrust') { if(g.heroId==='gpt')applyGptForm(g,g.player.transformed);else g.player.speed += 15*mult; }
    if (id === 'impact') recomputeFatStats(g);
    g.choices = []; g.phase = 'rest'; return true;
  }
  return false;
}
export function continueRound(g) {
  if (g.phase !== 'rest') return false;
  if (g.round >= g.maxRounds) { g.phase = 'won'; g.notice = '你征服了深海！'; if(g.heroId==='gpt')event(g,'game-won',{hero:'gpt'});else event(g,'won',{hero:g.heroId}); return true; }
  const previousMap=mapForRound(g.round).id;
  g.round++; g.roundTime = 0; g.roundDuration = roundDuration(g.round); g.spawnTimer = 0; g.chestTimer = 10; g.eliteSpawned = false; g.bossSpawned = false; g.bossDefeated=false; g.phase = 'playing'; g.notice = `第 ${g.round} 轮`;
  if(mapForRound(g.round).id!==previousMap){g.scene=createScene(g.round);g.chests=[];g.pickups=[];g.beams=[];g.particles=[];g.blasts=[];g.player.x=WIDTH/2;g.player.y=HEIGHT/2;g.player.vx=g.player.vy=0;g.player.chargeTimer=g.player.dashTimer=g.player.slideTimer=0;g.player.invulnerable=Math.max(1.5,g.player.invulnerable);g.allies.forEach((a,i)=>{a.x=g.player.x+Math.cos(i)*80;a.y=g.player.y+Math.sin(i)*80;});event(g,'map-changed',{text:`抵达${mapForRound(g.round).name}！`,mapId:g.scene.mapId});}
  return true;
}
function endRound(g) {
  g.bossArena=null;g.bossHazards=[];
  g.enemies = []; g.bullets = []; g.roundEnding = true; g.orbs.forEach(o => grantExperience(g, o.value)); g.orbs = []; if (g.phase === 'trait') return;
  queueReward(g);
}
function queueReward(g) { g.roundEnding = false; g.phase = 'reward'; g.choices = choicesFrom(g, availableEquipment(g), 3, 'gear'); event(g, 'round-ended', { round: g.round }); }
export function stepGame(g, input = {}, dt = 1 / 60) {
  if (g.phase !== 'playing') return [];
  g.events = [];
  dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05); const p = g.player; g.time += dt; g.roundTime += dt;
  ensureScene(g);
  if(!g.bossArena){const boss=g.enemies.find(e=>e.kind==='boss'&&e.hp>0);if(boss)beginBossArena(g,boss,{width:WIDTH,height:HEIGHT});}
  p.invulnerable = Math.max(0, p.invulnerable - dt); p.chargeCooldown = p.dashCooldown = Math.max(0, p.chargeCooldown - dt); p.vampirismTimer = Math.max(0, p.vampirismTimer - dt);
  p.shieldTimer=Math.max(0,p.shieldTimer-dt);if(!p.shieldTimer)p.shieldCharges=0;p.shieldCooldown=Math.max(0,p.shieldCooldown-dt);
  if(g.heroId==='qwen')p.compute=Math.min(p.computeMax,p.compute+HEROES.qwen.computeRegen*dt);
  p.skillCooldown=Math.max(0,p.skillCooldown-dt);p.toolNodeTimer=Math.max(0,p.toolNodeTimer-dt);p.chromeShieldTimer=Math.max(0,p.chromeShieldTimer-dt);
  if(g.heroId==='gpt'){
    const regen=0.8*dt, extra=p.transformed?(0.8+8*Math.max(0.2,1-0.2*(g.traitPower.efficiency||0)))*dt:0;
    p.energy=clamp(p.energy+regen-extra,0,p.energyMax);
    if(p.transformed&&p.energy<1e-9){p.energy=0;applyGptForm(g,false);}
  }
  p.aimX = Number.isFinite(input.aimX) ? input.aimX : p.x + Math.cos(p.facing) * 100; p.aimY = Number.isFinite(input.aimY) ? input.aimY : p.y + Math.sin(p.facing) * 100;
  const mx = clamp(Number(input.moveX ?? g.input?.moveX) || 0, -1, 1), my = clamp(Number(input.moveY ?? g.input?.moveY) || 0, -1, 1); const magnitude = Math.min(1, Math.hypot(mx, my));
  for (const e of g.enemies) if (!Number.isInteger(e.id)) e.id = g.nextEnemyId++;
  const move = magnitude ? { x: mx / Math.hypot(mx, my), y: my / Math.hypot(mx, my) } : { x: 0, y: 0 };
  if (magnitude && !p.chargeTimer && !p.slideTimer) p.facing = Math.atan2(move.y, move.x);
  if (p.chargeTimer > 0) {
    p.vx = p.chargeVx; p.vy = p.chargeVy; p.chargeTimer = p.dashTimer = Math.max(0, p.chargeTimer - dt);
    if (p.chargeTimer === 0) p.slideTimer = p.slideDuration = 0.3 + 0.045 * p.fatness;
  } else if (p.slideTimer > 0) {
    p.slideTimer = Math.max(0, p.slideTimer - dt); const damping = Math.exp(-1.8 * dt); p.vx *= damping; p.vy *= damping;
    if (!p.slideTimer) p.vx = p.vy = 0;
  } else { p.vx += (move.x * p.speed * magnitude - p.vx) * Math.min(1, dt * 8); p.vy += (move.y * p.speed * magnitude - p.vy) * Math.min(1, dt * 8); }
  const terrainSpeed=terrainFactor(g,p);
  p.x = clamp(p.x + p.vx * dt*terrainSpeed, p.radius, WIDTH - p.radius); p.y = clamp(p.y + p.vy * dt*terrainSpeed, p.radius, HEIGHT - p.radius);
  if ((input.command === 'primary' || input.type === 'primary') && p.slideTimer <= 0) useHeroSkill(g);
  if ((input.command === 'secondary' || input.type === 'secondary') && p.slideTimer <= 0) useHeroSecondary(g);
  const difficulty=DIFFICULTIES[g.difficulty]||DIFFICULTIES.standard;
  const spawnCap=limits.enemies-(isBossRound(g)&&!g.bossSpawned?1:0);
  g.spawnTimer -= dt; if (g.spawnTimer <= 0 && g.enemies.length < spawnCap) {
    const interval = Math.max(0.24, 0.65 - 0.032 * g.round) * difficulty.spawnInterval * (g.difficulty === 'relaxed' ? 1.5 : 1);
    const count = g.difficulty === 'relaxed' ? (g.round>=8?2:1) : g.round >= 11 ? 5 : g.round >= 6 ? 4 : g.round >= 3 ? 3 : 2;
    for (let i = 0; i < count && g.enemies.length < spawnCap; i++)
      spawnEnemy(g, g.round >= 4 && rand(g) < 0.25 ? 'ranged' : g.round >= 2 && rand(g) < 0.3 ? 'dash' : 'chaser');
    g.spawnTimer = interval;
  }
  if (isBossRound(g) && !g.bossSpawned) g.bossSpawned = spawnEnemy(g, 'boss');
  if (g.round>=3 && g.round%2===1 && !g.eliteSpawned && g.enemies.length<spawnCap) g.eliteSpawned = spawnEnemy(g, 'elite');
    g.chestTimer -= dt; if (g.chestTimer <= 0 && g.chests.length < 2) { const a=rand(g)*Math.PI*2, r=200+rand(g)*300; g.chests.push({ x: clamp(p.x+Math.cos(a)*r,70,WIDTH-70), y:clamp(p.y+Math.sin(a)*r,70,HEIGHT-70),hp:24,maxHp:24,radius:20 }); g.chestTimer = 18; }
  updateAllies(g,dt);
  // Auto-fire chooses the nearest chest only when it is closer than the nearest enemy.
  let target = null, targetD = Infinity; for (const candidate of [...g.enemies, ...g.chests,...g.scene.nodes.filter(n=>n.hp>0)]) { const d = dist2(p, candidate); if (d < targetD) { target = candidate; targetD = d; } }
  p.shotTimer -= dt; if (target && p.shotTimer <= 0) { fire(g, target); p.shotTimer = p.fireRate; }
  for (const b of g.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.hostile) { if(p.toolNodeTimer>0&&dist2(b,p)<=360**2)b.life=0;else {const ally=g.allies.find(a=>a.hp>0&&dist2(b,a)<(b.radius+a.radius)**2);if(ally){hurtAlly(g,ally,b.damage);b.life=0;}else if (dist2(b, p) < (b.radius + p.radius) ** 2) { hurt(g, b.damage); b.life = 0; }} continue; }
    let struck = false; for (const e of [...g.enemies]) if (!b.hitIds.includes(e.id) && dist2(b, e) < (b.radius + e.radius) ** 2) {
      const damage = (rand(g) < p.crit ? b.damage * 2 : b.damage)*(1+.1*(g.weaponPower.frost||0)); dealEnemyDamage(g,e,damage); b.hitIds.push(e.id);
      if(g.weaponPower.frost>0){e.slowTimer=Math.max(e.slowTimer||0,Math.min(3,1.5+.2*(g.weaponPower.frost-1)));e.slowFactor=Math.max(.2,1-.4*g.weaponPower.frost);}
      chainRicochet(g,e,b.hitIds,b.damage,g.weaponPower.ricochet||0);
      if (b.hitIds.length >= b.hits) b.life = 0; struck = true; break;
    } if (!struck) for (const c of [...g.chests]) if (dist2(b, c) < (b.radius + c.radius) ** 2) { damageChest(g, c, b.damage); b.life = 0; struck=true;break; }
    if(!struck)for(const node of g.scene.nodes)if(node.hp>0&&dist2(b,node)<(b.radius+node.radius)**2){damageSceneNode(g,node,b.damage);b.life=0;break;}
  }
  g.bullets = g.bullets.filter(b => b.life > 0 && b.x >= 0 && b.x <= WIDTH && b.y >= 0 && b.y <= HEIGHT).slice(0, limits.bullets);
  for(const beam of g.beams||[])beam.life-=dt;g.beams=(g.beams||[]).filter(beam=>beam.life>0).slice(-limits.beams);
  p.orbitAngle=(p.orbitAngle||0)+dt*2; p.orbitTimer-=dt;
  if(g.weaponPower.orbit>0&&p.orbitTimer<=0){const orbit=getOrbitStats(g);p.orbitTimer=orbit.interval;const orbitDamage=orbit.damage;for(const e of [...g.enemies])if(dist2(p,e)<=orbit.radius**2)dealEnemyDamage(g,e,orbitDamage);event(g,'orbit-pulse',{x:p.x,y:p.y,radius:orbit.radius,damage:orbitDamage,count:orbit.count,angle:p.orbitAngle});}
  for (const e of [...g.enemies]) {
    if(e.summoned){e.life-=dt;if(e.life<=0){g.enemies=g.enemies.filter(other=>other!==e);continue;}}
    let victim=p,nearestVictim=dist2(p,e);for(const ally of g.allies)if(ally.hp>0&&dist2(ally,e)<nearestVictim){victim=ally;nearestVictim=dist2(ally,e);}
    e.hitFlash = Math.max(0, (e.hitFlash || 0) - dt); e.slowTimer = Math.max(0,(e.slowTimer||0)-dt); const speedScale=(e.slowTimer>0?(e.slowFactor||0.6):1)*terrainFactor(g,e); const d = unit(victim.x - e.x, victim.y - e.y);
    if(e.behavior==='summoner'){
      e.summonTimer=(e.summonTimer??5)-dt;e.telegraph=e.summonTimer>0&&e.summonTimer<=1?Math.min(1,e.summonTimer):0;
      if(e.summonTimer<=0){for(let i=0;i<6&&g.enemies.length<limits.enemies;i++)spawnEnemy(g,'summon',{lifetime:10});e.summonTimer=5;e.telegraph=0;}
    }
    if(e.behavior==='egg'){
      e.shieldTimer=Math.max(0,(e.shieldTimer||0)-dt);e.shieldCooldown=(e.shieldCooldown||0)-dt;
      if(e.shieldCooldown<=0){e.shieldTimer=3;e.shieldCooldown=8;if(dist2(e,p)<=180**2){const away=unit(p.x-e.x,p.y-e.y);p.x=clamp(p.x+away.x*180,p.radius,WIDTH-p.radius);p.y=clamp(p.y+away.y*180,p.radius,HEIGHT-p.radius);event(g,'egg-push',{distance:180});}}
    }
    if (e.kind === 'ranged' || e.behavior === 'sniper') { if (dist2(victim, e) < 360 ** 2) { e.x -= d.x * e.speed * speedScale * dt; e.y -= d.y * e.speed * speedScale * dt; } else if (dist2(victim, e) > 520 ** 2) { e.x += d.x * e.speed * speedScale * dt; e.y += d.y * e.speed * speedScale * dt; }
      e.shotTimer -= dt; if (e.shotTimer <= 0 && g.bullets.length < limits.bullets) { const aim = unit(victim.x - e.x, victim.y - e.y); g.bullets.push({ x:e.x, y:e.y, vx:aim.x*210, vy:aim.y*210, damage:8, radius:7, life:3, hostile:true, hitIds:[] }); e.shotTimer = 2.2; }
    } else if (e.kind === 'dash' || e.behavior === 'burst') { e.dashTimer -= dt; if (e.dashTimer <= 0) { e.dashTimer = e.behavior === 'burst' ? 2.2 : 1.6; e.dashWindup = e.behavior === 'burst' ? 0.2 : 0.36; e.dashDir = unit(victim.x-e.x,victim.y-e.y); }
      if (e.dashWindup > 0) e.dashWindup -= dt; else if (e.dashDir) { e.x += e.dashDir.x * e.speed * speedScale * 3.2 * dt; e.y += e.dashDir.y * e.speed * speedScale * 3.2 * dt; if (e.dashTimer < 0.3) e.dashDir = null; }
      else { e.x += d.x*e.speed*speedScale*dt; e.y += d.y*e.speed*speedScale*dt; }
    } else { e.x += d.x * e.speed * speedScale * dt; e.y += d.y * e.speed * speedScale * dt; }
      e.x = clamp(e.x, e.radius, WIDTH-e.radius); e.y = clamp(e.y, e.radius, HEIGHT-e.radius);
    for(const ally of g.allies)if(ally.hp>0&&dist2(ally,e)<(ally.radius+e.radius)**2)hurtAlly(g,ally,e.kind==='boss'?24:e.kind==='elite'?16:9);
    if (dist2(p, e) < (p.radius + e.radius) ** 2 && p.chargeTimer <= 0) {
      const laterPressure = Math.floor(Math.max(0, g.round - 1) / 4);
      hurt(g, e.kind === 'boss' ? 20 + laterPressure * 2 : e.kind === 'elite' ? 14 + laterPressure : 8 + laterPressure);
      if (p.slideTimer > 0) { const away = unit(e.x-p.x,e.y-p.y); e.x=clamp(e.x+away.x*36,e.radius,WIDTH-e.radius); e.y=clamp(e.y+away.y*36,e.radius,HEIGHT-e.radius); }
    }
  }
  g.allies=g.allies.filter(a=>a.hp>0);
  if (g.phase !== 'playing') return g.events.splice(0);
  if (p.chargeTimer > 0) for (const e of [...g.enemies]) if (!p.chargeHits.includes(e.id) && dist2(p, e) < (p.radius + e.radius + 14) ** 2) { dealEnemyDamage(g,e,p.chargeDamage); e.x += Math.cos(p.chargeDirection) * 22; e.y += Math.sin(p.chargeDirection) * 22; p.chargeHits.push(e.id); }
  for (const c of [...g.chests]) if (p.chargeTimer > 0 && dist2(p, c) < (p.radius + c.radius + 14) ** 2) damageChest(g, c, p.chargeDamage);
  for(const node of g.scene.nodes)if(node.hp>0&&p.chargeTimer>0&&dist2(p,node)<(p.radius+node.radius+14)**2)damageSceneNode(g,node,p.chargeDamage);
  updateBossPressure(g,dt,{hurtPlayer:amount=>hurt(g,amount),spawnAdds:count=>{for(let i=0;i<count&&g.enemies.length<limits.enemies;i++)spawnEnemy(g,'summon',{identity:opposingRoster(g.playerFaction).chaser});},addHostileBullet:b=>{if(g.bullets.length<limits.bullets)g.bullets.push(b);}});
  if(g.phase!=='playing')return g.events.splice(0);
  updateScene(g);
  if(g.phase!=='playing')return g.events.splice(0);
  for (const o of [...g.orbs]) if (dist2(p, o) < (p.magnet + 100) ** 2) { const d = unit(p.x - o.x, p.y - o.y); o.x += d.x * 180 * dt; o.y += d.y * 180 * dt; if (dist2(p, o) < (p.radius + 12) ** 2) { g.orbs = g.orbs.filter(v => v !== o); grantExperience(g, o.value); } }
  for (const item of [...g.pickups]) { const key=item.itemKey||item.kind; if(key===HEROES[g.heroId].itemKey&&(g.inventory[key]||0)<limits[key]&&dist2(p,item)<(p.radius+item.radius)**2){g.inventory[key]++;g.pickups=g.pickups.filter(v=>v!==item);event(g,'item-collected',{item:key,count:g.inventory[key]});} }
  while (g.heroId==='deepseek'&&g.time>=g.nextAutoRiceAt){g.nextAutoRiceAt+=8;if(g.inventory.rice>0&&rand(g)<0.35)eatRice(g,true);}
  if (g.equipmentPower.regen) p.health = Math.min(p.maxHealth, p.health + 0.6 * g.equipmentPower.regen * dt);
  for(const blast of g.blasts||[])blast.age+=dt;
  g.blasts=(g.blasts||[]).filter(blast=>blast.age<blast.duration).slice(-limits.blasts);
  for(const particle of g.particles||[]){particle.x+=particle.vx*dt;particle.y+=particle.vy*dt;particle.vx*=Math.exp(-2.5*dt);particle.vy*=Math.exp(-2.5*dt);particle.life-=dt;}
  g.particles=(g.particles||[]).filter(particle=>particle.life>0).slice(-limits.particles);
  if (g.roundTime >= g.roundDuration && (!isBossRound(g) || (g.bossSpawned && g.bossDefeated))) endRound(g);
  return g.events.splice(0);
}
export function getStats(g) {
  const p=g.player, weights=rarityWeights(p.luck);
  const percents=weights.map(x=>Math.round(x*1000)/10);percents[3]=Math.round((1000-percents.slice(0,3).reduce((a,b)=>a+b*10,0))/10);
  const entries=[
    {key:'damage',label:'伤害',value:p.damage,unit:'点/发'},
    {key:'fireRate',label:'射击间隔',value:p.fireRate,unit:'秒'},
    {key:'shots',label:'弹丸数',value:p.shots,unit:'枚'},
    {key:'crit',label:'暴击率',value:p.crit*100,unit:'%'},
    {key:'speed',label:'移速',value:p.speed,unit:'点/秒'},
    {key:'health',label:'生命',value:p.health,max:p.maxHealth,unit:'点'},
    {key:'armor',label:'护甲',value:g.equipmentPower.armor||0,unit:'点'},
    {key:'lifesteal',label:'击杀回血',value:p.vampirism?Math.min(8,Math.round(2*(g.traitPower.vampirism||p.vampirism))):0,unit:'点'},
    {key:'luck',label:'幸运',value:p.luck,unit:'点'},
  ];
  const orbit=getOrbitStats(g);
  if(orbit.count)entries.push({key:'orbitCount',label:'环绕水弹',value:orbit.count,unit:'枚'},{key:'orbitDamage',label:'环刃脉冲伤害',value:orbit.damage,unit:'点/脉冲'});
  const hero=g.heroId==='deepseek'?{fatLevel:p.fatLevel,fatXp:p.fatXp,fatXpNeed:p.fatXpNeed,fatness:p.fatness,fishStage:p.fishStage}:g.heroId==='gpt'?{energy:p.energy,energyMax:p.energyMax,transformed:p.transformed}:g.heroId==='qwen'?{compute:p.compute,computeMax:p.computeMax,computeRegen:HEROES.qwen.computeRegen,allies:g.allies.length}:g.heroId==='doubao'?{shieldTimer:p.shieldTimer,shieldCharges:p.shieldCharges,shieldCooldown:p.shieldCooldown}:g.heroId==='kimi'?{skillCooldown:p.skillCooldown,piercing:p.piercing,beams:g.beams.length}:{};
  if(g.heroId==='qwen')entries.push({key:'compute',label:'算力',value:p.compute,max:p.computeMax,unit:'点'},{key:'allies',label:'召唤物',value:g.allies.length,max:limits.allies,unit:'个'});
  if(g.heroId==='qwen')for(const ally of g.allies){entries.push({key:'allyHp'+ally.id,label:`${ally.name} #${ally.id} 生命`,value:ally.hp,max:ally.maxHp,unit:'点'},{key:'allyDamage'+ally.id,label:`#${ally.id} 伤害 / 移速`,value:ally.damage,unit:`点 · ${ally.speed}速度`},{key:'allyRate'+ally.id,label:`#${ally.id} 射击间隔`,value:ally.fireRate,unit:'秒'});}
  if(g.heroId==='doubao')entries.push({key:'shield',label:'护盾',value:p.shieldCharges,max:2,unit:'次'},{key:'shieldCooldown',label:'护盾冷却',value:p.shieldCooldown,unit:'秒'});
  if(g.heroId==='kimi')entries.push({key:'laserPiercing',label:'光束穿透',value:p.piercing,unit:'名敌人'},{key:'laserCooldown',label:'聚焦冷却',value:p.skillCooldown,unit:'秒'});
  const weapons=Object.entries(g.weapons).map(([id,level])=>({id,name:CATALOG[id]?.name||id,level,power:g.weaponPower[id]||0,count:id==='orbit'?orbit.count:level}));
  return {entries,weights:weights.map((weight,i)=>({id:RARITIES[i].id,label:RARITIES[i].label,percent:percents[i],color:RARITIES[i].color})),weapons,effects:{...g.effects},hero};
}
export function getOrbitStats(g) {
  const power=g.weaponPower?.orbit||0, level=g.weapons?.orbit||0;
  return {count:power>0?Math.min(7,Math.max(3,level+2)):0,damage:10*power,interval:.9,radius:150};
}
export function getHud(g) { return { phase: g.phase, round: g.round, maxRounds: g.maxRounds, roundTime: g.roundTime, roundDuration: g.roundDuration, score: g.score, level: g.level, xp: g.xp, xpNeed: g.xpNeed, health: g.player.health, maxHealth: g.player.maxHealth, enemies: g.enemies.length, kills: g.kills, notice: g.notice, difficulty: g.difficulty, compute:g.player.compute,computeMax:g.player.computeMax,allies:g.allies.length,beams:g.beams.length }; }
