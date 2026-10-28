import { ENEMY_ROSTERS, ELITE_ROSTERS, opposingRoster } from './roster.js';
import { HEROES } from './heroes.js';

export const WIDTH = 2560;
export const HEIGHT = 1600;
export const limits = Object.freeze({ enemies: 64, bullets: 96, orbs: 96, particles: 80, chests: 4, pickups: 8, events: 32, rice: 9, chromeOrb: 9, resetScroll: 9, astraCore: 9 });

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const unit = (x, y) => { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; };
const traitPool = [
  ['damage', '高压水滴', '水弹伤害提高 25%。', '💧'], ['fireRate', '快速进食', '射击间隔减少 20%。', '⚡'],
  ['maxHealth', '深海储备', '最大生命提高 25，并恢复 25 点生命。', '💗'], ['vampirism', '血潮', '每层使击杀回血增加 2 点，上限 8 点；触发间隔 0.25 秒。', '🩸'],
  ['multishot', '双重水弹', '每次多发射一枚水弹。', '💧'], ['piercing', '坚硬米核', '水弹可额外穿透一名敌人。', '🌰'],
  ['crit', '幸运一击', '暴击率提高 12%。', '🍀'], ['speed', '顺流而行', '移动速度提高 12%。', '🌊'],
  ['magnet', '米粒磁力', '经验吸取范围增加 65。', '🧲'], ['chargeCooldown', '快速冲锋', '冲锋冷却减少 0.75 秒，最短 1 秒。', '💥'],
];
const equipmentPool = [
  ['ricebox', '米饭便当', '米饭额外恢复 10 点生命。', '🍚'], ['armor', '贝壳护甲', '每次受到的伤害减少 1 点。', '🐚'],
  ['thrust', '强劲鱼尾', '移动速度提高 15 点。', '🐟'], ['regen', '平静洋流', '每秒恢复 0.6 点生命。', '💚'],
  ['impact', '冲击核心', '冲锋对敌人和宝箱的伤害提高 40%。', '🔵'],
];
const gptTraitPool = [
  ['energyGain', '高效学习', '每点经验额外获得 2 点能量。', '📈'], ['energyMax', '深层缓存', '最大能量提高 20 点。', '🔋'],
  ['efficiency', '高效推理', '变身期间能量消耗降低 20%。', '🧠'], ['transformedDamage', '强化输出', '正常 GPT 形态伤害提高 20%。', '⚙️'],
];
export const CATALOG = Object.fromEntries([...traitPool, ...gptTraitPool, ...equipmentPool].map(([id, name, description, icon]) => [id, { name, description, icon }]));

export function createGame({ seed = 1, hero = 'deepseek', faction } = {}) {
  const s = (Number(seed) >>> 0) || 1;
  const heroId = Object.hasOwn(HEROES, hero) ? hero : 'deepseek'; const heroConfig = HEROES[heroId];
  const playerFaction = Object.hasOwn(ENEMY_ROSTERS, faction) ? faction : heroConfig.faction;
  const stats = heroConfig.stats;
  return {
    rng: s, visualRng: s, phase: 'playing', round: 1, maxRounds: 10, roundTime: 0, roundDuration: 20, time: 0, playerFaction, heroId,
    score: 0, level: 1, xp: 0, xpNeed: 8, pendingLevels: 0,
    player: { x: WIDTH / 2, y: HEIGHT / 2, radius: 28, fishStage: 1, health: stats.health, maxHealth: stats.health, vx: 0, vy: 0, facing: 1,
      fatLevel: 1, fatXp: 0, fatXpNeed: 2, fatness: 0, superFat: false, slideTimer: 0, slideDuration: 0,
      damage: stats.damage, fireRate: stats.fireRate, shots: 1, speed: stats.speed, dashCooldown: 0, dashTimer: 0, chargeCooldown: 0, chargeTimer: 0, chargeDamage: stats.chargeDamage, chargeHits: [],
      shotTimer: 0, invulnerable: 0, magnet: 95, crit: 0, vampirism: 0, vampirismTimer: 0, chargeDirection: 0,
      energy: 0, energyMax: 100, transformed: false, transformTimer: 0, skillCooldown: 0, toolNodeTimer: 0,
      chromeShieldTimer: 0, chromeShieldCharges: 0 },
    enemies: [], bullets: [], orbs: [], chests: [], pickups: [], particles: [], choices: [],
    traits: {}, equipment: {}, inventory: { rice: 0, chromeOrb: 0, resetScroll: 0, astraCore: 0 }, notice: '', events: [], spawnTimer: 0, chestTimer: 2, eliteSpawned: false, bossSpawned: false,
    kills: 0, damageTaken: 0, nextEnemyId: 1, bossDefeated: false, nextAutoRiceAt: 8,
  };
}

function rand(g) { g.rng = (Math.imul(g.rng, 1664525) + 1013904223) >>> 0; return g.rng / 4294967296; }
function visualRand(g) { g.visualRng = (Math.imul(g.visualRng, 1664525) + 1013904223) >>> 0; return g.visualRng / 4294967296; }
function event(g, type, data = {}) { g.events.push({ type, ...data }); if (g.events.length > limits.events) g.events.shift(); }
function choicesFrom(g, pool, count, prefix) {
  const a = pool.map(row => [...row]);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(g) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, count).map(([id, name, description, icon]) => ({ id: `${prefix}:${id}`, name, description, icon }));
}
function levelCheck(g) {
  while (g.xp >= g.xpNeed) { g.xp -= g.xpNeed; g.level++; g.xpNeed = 8 + 4 * (g.level - 1); g.pendingLevels++; }
  if (g.pendingLevels && g.phase === 'playing') { g.phase = 'trait'; g.choices = choicesFrom(g, availableTraits(g), 3, 'trait'); }
}
export function grantExperience(g, amount) {
  if (g.phase === 'lost' || g.phase === 'won') return;
  amount = Math.max(0, amount);
  if (g.heroId === 'gpt') g.player.energy = Math.min(g.player.energyMax, g.player.energy + amount * (4 + 2 * (g.traits.energyGain || 0)));
  g.xp += amount; levelCheck(g);
}
function availableTraits(g) {
  const p=g.player;
  const general=traitPool.filter(([id]) => id==='damage'||id==='maxHealth'||
    (id==='fireRate'&&p.fireRate>0.12)||(id==='vampirism'&&p.vampirism<4)||(id==='multishot'&&p.shots<8)||
    (id==='piercing'&&(p.piercing||1)<6)||(id==='crit'&&p.crit<0.75)||(id==='speed'&&(g.traits.speed||0)<6)||
    (id==='magnet'&&(g.traits.magnet||0)<6)||(id==='chargeCooldown'&&(g.heroId==='deepseek'||g.heroId==='astra')&&(g.traits.chargeCooldown||0)<5));
  if(g.heroId!=='gpt')return general;
  const specials=gptTraitPool.filter(([id]) => (g.traits[id]||0)<(id==='energyMax'?3:5));
  return [...specials,...general];
}
function availableEquipment(g){return g.heroId==='deepseek'?equipmentPool:equipmentPool.filter(([id])=>id!=='ricebox'&&id!=='impact');}
function addXpOrb(g, x, y, value = 1) {
  if (g.orbs.length < limits.orbs) g.orbs.push({ x, y, value, radius: 7 });
  else { const nearest = g.orbs.reduce((a, b) => dist2(a, { x, y }) < dist2(b, { x, y }) ? a : b); nearest.value += value; }
}
function spawnEnemy(g, kind = 'chaser') {
  if (g.enemies.length >= limits.enemies) return false;
  const angle = rand(g) * Math.PI * 2, radiusFromPlayer = 480 + rand(g) * 220;
  const x = clamp(g.player.x + Math.cos(angle) * radiusFromPlayer, 30, WIDTH - 30), y = clamp(g.player.y + Math.sin(angle) * radiusFromPlayer, 30, HEIGHT - 30);
  const defs = { chaser: [26, 54 + g.round * 8, 48 + g.round * 2], dash: [20, 34 + g.round * 5, 85 + g.round * 2], ranged: [22, 48 + g.round * 7, 42 + g.round], elite: [38, 260 + g.round * 30, 32 + g.round], boss: [62, 1700, 26] };
  let [radius, hp, speed] = defs[kind];
  const opponent = opposingRoster(g.playerFaction)[kind];
  const elite = kind === 'elite' ? ELITE_ROSTERS[g.playerFaction][Math.floor(rand(g) * ELITE_ROSTERS[g.playerFaction].length)] : null;
  const identity = elite || opponent;
  if(elite?.behavior==='tank'){hp=Math.round(hp*1.35);speed*=.8;}
  if(elite?.behavior==='burst'){hp=Math.round(hp*.85);speed*=1.6;}
  g.enemies.push({ id: g.nextEnemyId++, x, y, radius, hp, maxHp: hp, speed, kind, modelId: identity.modelId, name: identity.name, tier: identity.tier, portrait: identity.portrait, color: identity.color, behavior: elite?.behavior || null,
    shotTimer: 1.5, dashTimer: 1.2, hitFlash: 0, xp: kind === 'boss' ? 50 : kind === 'elite' ? 12 : 2 });
  return true;
}
function fire(g, target) {
  const p = g.player; const d = unit(target.x - p.x, target.y - p.y); p.facing = Math.atan2(d.y, d.x);
  const n = p.shots; for (let i = 0; i < n; i++) {
    if (g.bullets.length >= limits.bullets) break;
    const spread = (i - (n - 1) / 2) * 0.13; const c = Math.cos(spread), s = Math.sin(spread);
    const dx = d.x * c - d.y * s, dy = d.x * s + d.y * c;
    g.bullets.push({ x: p.x, y: p.y, vx: dx * 550, vy: dy * 550, damage: p.damage, radius: 9, life: 1.8, hits: p.piercing || 1, hitIds: [] });
  }
}
function damageChest(g, chest, amount) {
  chest.hp -= amount;
  if (chest.hp <= 0) { g.chests = g.chests.filter(c => c !== chest); const key=HEROES[g.heroId].itemKey; if (g.pickups.length < limits.pickups) g.pickups.push({ x: chest.x, y: chest.y, kind: key, itemKey:key, radius: 13 }); event(g, 'chest-opened'); }
}
export function openChest(g, chest) { if (g.chests.includes(chest)) damageChest(g, chest, chest.hp); }
function hurt(g, amount) {
  const p = g.player; if (p.invulnerable > 0 || g.phase !== 'playing') return;
  if(p.chromeShieldTimer>0&&p.chromeShieldCharges>0){p.chromeShieldCharges--;p.invulnerable=Math.max(p.invulnerable,0.45);if(!p.chromeShieldCharges)p.chromeShieldTimer=0;event(g,'chrome-shield-hit',{charges:p.chromeShieldCharges});return;}
  let reduced = Math.max(1, amount - (g.equipment.armor || 0));
  if(g.heroId==='gpt'&&p.transformed)reduced=Math.max(1,Math.ceil(reduced*0.5));
  const damage = p.slideTimer > 0 ? Math.max(1, Math.ceil(reduced * 0.6)) : reduced;
  p.health = Math.max(0, p.health - damage); p.invulnerable = 0.45; g.damageTaken += damage;
  if (!p.health) { g.phase = 'lost'; g.notice = '你被深海洋流卷走了。'; event(g, 'lost'); }
}
function killEnemy(g, e) {
  g.enemies = g.enemies.filter(x => x !== e); g.kills++; g.score += e.kind === 'boss' ? 5000 : e.kind === 'elite' ? 300 : 50;
  addXpOrb(g, e.x, e.y, e.xp); if (e.kind === 'boss') g.bossDefeated = true;
  if (g.player.vampirism && g.player.vampirismTimer <= 0) { g.player.health = Math.min(g.player.maxHealth, g.player.health + Math.min(8, 2 * g.player.vampirism)); g.player.vampirismTimer = 0.25; }
  event(g, 'enemy-defeated', { kind: e.kind });
}
function primary(g) {
  const p = g.player; if (p.chargeCooldown > 0 || p.chargeTimer > 0 || p.slideTimer > 0) return;
  p.chargeTimer = p.dashTimer = 0.4; p.chargeCooldown = p.dashCooldown = Math.max(1, 5 * (1 - (g.traits.chargeCooldown || 0) * 0.15)); p.chargeHits = []; p.invulnerable = 0.45;
  const aim = Number.isFinite(p.aimX) && Number.isFinite(p.aimY) && (Math.abs(p.aimX - p.x) + Math.abs(p.aimY - p.y) > 1);
  const d = aim ? unit(p.aimX - p.x, p.aimY - p.y) : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
  p.facing = Math.atan2(d.y, d.x); p.chargeDirection = p.facing; p.chargeVx = d.x * 550; p.chargeVy = d.y * 550; p.vx = p.chargeVx; p.vy = p.chargeVy; event(g, 'charge');
}
function applyGptForm(g, normal) {
  const p=g.player;p.transformed=normal;
  const traitDamage=1.25**(g.traits.damage||0);
  p.damage=(normal?36*(1+0.2*(g.traits.transformedDamage||0)):HEROES.gpt.stats.damage)*traitDamage;
  p.speed=(normal?125:HEROES.gpt.stats.speed)*1.12**(g.traits.speed||0)+15*(g.equipment.thrust||0);
  p.fireRate=Math.max(0.12,(normal?0.5:HEROES.gpt.stats.fireRate)*0.8**(g.traits.fireRate||0));
}
export function useHeroSkill(g) {
  if(g.phase!=='playing')return [];
  const p=g.player;
  if(g.heroId==='deepseek'){primary(g);return g.events.splice(0);}
  if(g.heroId==='gemini'){
    if(p.skillCooldown>0)return [];
    if(Number.isFinite(p.aimX)&&Number.isFinite(p.aimY)&&Math.hypot(p.aimX-p.x,p.aimY-p.y)>1)p.facing=Math.atan2(p.aimY-p.y,p.aimX-p.x);
    p.x=clamp(p.x+Math.cos(p.facing)*260,p.radius,WIDTH-p.radius);p.y=clamp(p.y+Math.sin(p.facing)*260,p.radius,HEIGHT-p.radius);
    p.invulnerable=Math.max(p.invulnerable,0.65);p.skillCooldown=HEROES.gemini.skillCooldown;event(g,'flash',{distance:260});return g.events.splice(0);
  }
  if(g.heroId==='astra'){
    if(p.skillCooldown>0)return [];
    for(const e of [...g.enemies])if(dist2(p,e)<=300**2){e.hp-=300;e.hitFlash=.2;const d=unit(e.x-p.x,e.y-p.y);e.x=clamp(e.x+d.x*160,e.radius,WIDTH-e.radius);e.y=clamp(e.y+d.y*160,e.radius,HEIGHT-e.radius);if(e.hp<=0)killEnemy(g,e);}
    p.skillCooldown=7;event(g,'starburst',{radius:300,damage:300});return g.events.splice(0);
  }
  if(!p.transformed){if(p.energy<20)return [];applyGptForm(g,true);event(g,'gpt-transform',{energy:p.energy});return g.events.splice(0);}
  if(p.skillCooldown>0)return [];
  p.toolNodeTimer=3;p.skillCooldown=6;
  for(const b of g.bullets)if(b.hostile&&dist2(p,b)<=360**2)b.life=0;
  for(const e of g.enemies)if(dist2(p,e)<=360**2){const d=unit(e.x-p.x,e.y-p.y);e.x=clamp(e.x+d.x*360,e.radius,WIDTH-e.radius);e.y=clamp(e.y+d.y*360,e.radius,HEIGHT-e.radius);}
  g.bullets=g.bullets.filter(b=>b.life>0);event(g,'tool-node',{duration:3,radius:360});return g.events.splice(0);
}
export function performAction(g, command) {
  g.events = [];
  if (g.phase !== 'playing') return [];
  if (typeof command === 'object' && command) {
    if (Number.isFinite(command.aimX)) g.player.aimX = command.aimX;
    if (Number.isFinite(command.aimY)) g.player.aimY = command.aimY;
    g.input = { moveX: command.moveX || 0, moveY: command.moveY || 0 };
    if (command.type === 'primary' || command.command === 'primary') return useHeroSkill(g);
    if (command.type === 'use-item') return useItem(g, command.slot ?? 1);
  } else if (command === 'primary') return useHeroSkill(g);
  return g.events.splice(0);
}
export function useItem(g, slot = 1) {
  if (g.phase !== 'playing' || slot !== 1) return [];
  const key=HEROES[g.heroId].itemKey; if(!g.inventory?.[key])return [];
  if(key==='rice')return eatRice(g,false);
  if(key==='chromeOrb'&&g.player.chromeShieldTimer>0)return [];
  if(key==='resetScroll'&&g.player.energy>=g.player.energyMax)return [];
  if(key==='astraCore'){g.inventory[key]--;g.player.skillCooldown=0;return [{type:'item-used',item:key,slot:1,cooldown:0,remaining:g.inventory[key]}];}
  g.inventory[key]--;
  if(key==='chromeOrb'){g.player.chromeShieldTimer=8;g.player.chromeShieldCharges=3;return [{type:'item-used',item:key,slot:1,charges:3,duration:8,remaining:g.inventory[key]}];}
  if(key==='resetScroll'){g.player.energy=g.player.energyMax;return [{type:'item-used',item:key,slot:1,energy:g.player.energy,remaining:g.inventory[key]}];}
  return [];
}
export function itemInfo(g) {
  const hero=HEROES[g.heroId]; const key=hero.itemKey; const available=(g.inventory[key]||0)>0;
  const ready=key==='rice'?g.player.health<g.player.maxHealth:key==='resetScroll'?g.player.energy<g.player.energyMax:key==='astraCore'?g.player.skillCooldown>0:g.player.chromeShieldTimer<=0;
  return { key,name:hero.itemName,icon:hero.itemIcon,description:hero.itemDescription,count:g.inventory[key]||0,canUse:g.phase==='playing'&&available&&ready };
}
function recomputeFatStats(g) {
  const p = g.player; if(g.heroId!=='deepseek')return;
  p.fatLevel=clamp(p.fatLevel,1,30);p.fatness=p.fatLevel-1;p.radius=28+2.2*p.fatness;
  p.fishStage=Math.min(11,1+Math.ceil(p.fatness/3));
  p.maxHealth=HEROES.deepseek.stats.health+12*p.fatness+25*(g.traits.maxHealth||0);p.health=Math.min(p.health,p.maxHealth);
  p.chargeDamage=HEROES.deepseek.stats.chargeDamage*(1+0.07*p.fatness)*(1+0.4*(g.equipment.impact||0));
}
function eatRice(g, automatic) {
  const p = g.player; if (g.heroId!=='deepseek'||g.phase !== 'playing' || !g.inventory.rice || (!automatic && p.health >= p.maxHealth)) return [];
  g.inventory.rice--;
  if(p.fatLevel<30){p.fatXp++;if(p.fatXp>=p.fatXpNeed){p.fatXp-=p.fatXpNeed;p.fatLevel++;p.fatXpNeed=2+Math.floor((p.fatLevel-1)*1.5);recomputeFatStats(g);}}
  const normalHeal = 30 + (g.equipment.ricebox || 0) * 10; const requested = automatic ? Math.floor(normalHeal / 2) : normalHeal;
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
    g.traits[id] = (g.traits[id] || 0) + 1; const p = g.player;
    if (id === 'damage') p.damage *= 1.25; if (id === 'fireRate') p.fireRate = Math.max(0.12,p.fireRate * 0.8);
    if (id === 'maxHealth') { if(g.heroId==='deepseek'){p.health=Math.min(p.maxHealth+25,p.health+25);recomputeFatStats(g);}else{p.maxHealth=HEROES[g.heroId].stats.health+25*g.traits.maxHealth;p.health=Math.min(p.maxHealth,p.health+25);} }
    if (id === 'vampirism') p.vampirism = g.traits.vampirism; if (id === 'multishot') p.shots++; if (id === 'piercing') p.piercing = (p.piercing || 1) + 1;
    if (id === 'crit') p.crit = Math.min(0.75, p.crit + 0.12); if (id === 'speed') p.speed *= 1.12; if (id === 'magnet') p.magnet += 65;
    if(id==='chargeCooldown'&&g.heroId==='astra')p.skillCooldown=Math.max(0,p.skillCooldown-.75);
    if(id==='energyGain'||id==='energyMax'||id==='efficiency'||id==='transformedDamage'){if(id==='energyMax')p.energyMax=Math.min(160,p.energyMax+20);if(id==='transformedDamage'&&p.transformed)applyGptForm(g,true);}
    g.pendingLevels--; g.choices = []; if (g.pendingLevels) g.choices = choicesFrom(g, availableTraits(g), 3, 'trait'); else if (g.roundEnding) queueReward(g); else g.phase = 'playing'; return true;
  }
  if (type === 'gear' && g.phase === 'reward') { g.equipment[id] = (g.equipment[id] || 0) + 1; if (id === 'thrust') g.player.speed += 15; if (id === 'impact') recomputeFatStats(g); g.choices = []; g.phase = 'rest'; return true; }
  return false;
}
export function continueRound(g) {
  if (g.phase !== 'rest') return false;
  if (g.round >= g.maxRounds) { g.phase = 'won'; g.notice = '你征服了深海！'; if(g.heroId==='gpt')event(g,'game-won',{hero:'gpt'});else event(g,'won',{hero:g.heroId}); return true; }
  g.round++; g.roundTime = 0; g.roundDuration = 20 + 5 * (g.round - 1); g.spawnTimer = 0; g.chestTimer = 2; g.eliteSpawned = false; g.bossSpawned = false; g.phase = 'playing'; g.notice = `第 ${g.round} 轮`; return true;
}
function endRound(g) {
  g.enemies = []; g.bullets = []; g.roundEnding = true; g.orbs.forEach(o => grantExperience(g, o.value)); g.orbs = []; if (g.phase === 'trait') return;
  queueReward(g);
}
function queueReward(g) { g.roundEnding = false; g.phase = 'reward'; g.choices = choicesFrom(g, availableEquipment(g), 3, 'gear'); event(g, 'round-ended', { round: g.round }); }
export function stepGame(g, input = {}, dt = 1 / 60) {
  if (g.phase !== 'playing') return [];
  g.events = [];
  dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05); const p = g.player; g.time += dt; g.roundTime += dt;
  p.invulnerable = Math.max(0, p.invulnerable - dt); p.chargeCooldown = p.dashCooldown = Math.max(0, p.chargeCooldown - dt); p.vampirismTimer = Math.max(0, p.vampirismTimer - dt);
  p.skillCooldown=Math.max(0,p.skillCooldown-dt);p.toolNodeTimer=Math.max(0,p.toolNodeTimer-dt);p.chromeShieldTimer=Math.max(0,p.chromeShieldTimer-dt);
  if(p.transformed){p.energy=Math.max(0,p.energy-8*Math.max(0.2,1-0.2*(g.traits.efficiency||0))*dt);if(p.energy<1e-9){p.energy=0;applyGptForm(g,false);}}
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
  p.x = clamp(p.x + p.vx * dt, p.radius, WIDTH - p.radius); p.y = clamp(p.y + p.vy * dt, p.radius, HEIGHT - p.radius);
  if ((input.command === 'primary' || input.type === 'primary') && p.slideTimer <= 0) useHeroSkill(g);
  g.spawnTimer -= dt; if (g.spawnTimer <= 0 && g.enemies.length < limits.enemies) { spawnEnemy(g, g.round >= 4 && rand(g) < 0.25 ? 'ranged' : g.round >= 2 && rand(g) < 0.3 ? 'dash' : 'chaser'); g.spawnTimer = Math.max(0.22, 1.1 - g.round * 0.06); }
  if ([3, 5, 7, 9].includes(g.round) && !g.eliteSpawned) g.eliteSpawned = spawnEnemy(g, 'elite');
  if (g.round === 10 && !g.bossSpawned) g.bossSpawned = spawnEnemy(g, 'boss');
  g.chestTimer -= dt; if (g.chestTimer <= 0 && g.chests.length < limits.chests) { const a=rand(g)*Math.PI*2, r=200+rand(g)*300; g.chests.push({ x: clamp(p.x+Math.cos(a)*r,70,WIDTH-70), y:clamp(p.y+Math.sin(a)*r,70,HEIGHT-70),hp:40,maxHp:40,radius:20 }); g.chestTimer = 7; }
  // Auto-fire chooses the nearest chest only when it is closer than the nearest enemy.
  let target = null, targetD = Infinity; for (const candidate of [...g.enemies, ...g.chests]) { const d = dist2(p, candidate); if (d < targetD) { target = candidate; targetD = d; } }
  p.shotTimer -= dt; if (target && p.shotTimer <= 0) { fire(g, target); p.shotTimer = p.fireRate; }
  for (const b of g.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.hostile) { if(p.toolNodeTimer>0&&dist2(b,p)<=360**2)b.life=0;else if (dist2(b, p) < (b.radius + p.radius) ** 2) { hurt(g, b.damage); b.life = 0; } continue; }
    let struck = false; for (const e of [...g.enemies]) if (!b.hitIds.includes(e.id) && dist2(b, e) < (b.radius + e.radius) ** 2) { const damage = rand(g) < p.crit ? b.damage * 2 : b.damage; e.hp -= damage; b.hitIds.push(e.id); e.hitFlash = 0.12; if (e.hp <= 0) killEnemy(g, e); if (b.hitIds.length >= b.hits) b.life = 0; struck = true; break; } if (!struck) for (const c of [...g.chests]) if (dist2(b, c) < (b.radius + c.radius) ** 2) { damageChest(g, c, b.damage); b.life = 0; break; }
  }
  g.bullets = g.bullets.filter(b => b.life > 0 && b.x >= 0 && b.x <= WIDTH && b.y >= 0 && b.y <= HEIGHT).slice(0, limits.bullets);
  for (const e of [...g.enemies]) {
    e.hitFlash = Math.max(0, (e.hitFlash || 0) - dt); const d = unit(p.x - e.x, p.y - e.y);
    if (e.kind === 'ranged' || e.behavior === 'sniper') { if (dist2(p, e) < 360 ** 2) { e.x -= d.x * e.speed * dt; e.y -= d.y * e.speed * dt; } else if (dist2(p, e) > 520 ** 2) { e.x += d.x * e.speed * dt; e.y += d.y * e.speed * dt; }
      e.shotTimer -= dt; if (e.shotTimer <= 0 && g.bullets.length < limits.bullets) { const aim = unit(p.x - e.x, p.y - e.y); g.bullets.push({ x:e.x, y:e.y, vx:aim.x*210, vy:aim.y*210, damage:8, radius:7, life:3, hostile:true, hitIds:[] }); e.shotTimer = 2.2; }
    } else if (e.kind === 'dash' || e.behavior === 'burst') { e.dashTimer -= dt; if (e.dashTimer <= 0) { e.dashTimer = e.behavior === 'burst' ? 2.2 : 1.6; e.dashWindup = e.behavior === 'burst' ? 0.2 : 0.36; e.dashDir = unit(p.x-e.x,p.y-e.y); }
      if (e.dashWindup > 0) e.dashWindup -= dt; else if (e.dashDir) { e.x += e.dashDir.x * e.speed * 3.2 * dt; e.y += e.dashDir.y * e.speed * 3.2 * dt; if (e.dashTimer < 0.3) e.dashDir = null; }
      else { e.x += d.x*e.speed*dt; e.y += d.y*e.speed*dt; }
    } else { e.x += d.x * e.speed * dt; e.y += d.y * e.speed * dt; }
    e.x = clamp(e.x, e.radius, WIDTH-e.radius); e.y = clamp(e.y, e.radius, HEIGHT-e.radius);
    if (dist2(p, e) < (p.radius + e.radius) ** 2 && p.chargeTimer <= 0) {
      hurt(g, e.kind === 'boss' ? 20 : e.kind === 'elite' ? 14 : 8);
      if (p.slideTimer > 0) { const away = unit(e.x-p.x,e.y-p.y); e.x=clamp(e.x+away.x*36,e.radius,WIDTH-e.radius); e.y=clamp(e.y+away.y*36,e.radius,HEIGHT-e.radius); }
    }
  }
  if (g.phase !== 'playing') return g.events.splice(0);
  if (p.chargeTimer > 0) for (const e of [...g.enemies]) if (!p.chargeHits.includes(e.id) && dist2(p, e) < (p.radius + e.radius + 14) ** 2) { e.hp -= p.chargeDamage; e.hitFlash = 0.18; e.x += Math.cos(p.chargeDirection) * 22; e.y += Math.sin(p.chargeDirection) * 22; p.chargeHits.push(e.id); if (e.hp <= 0) killEnemy(g, e); }
  for (const c of [...g.chests]) if (p.chargeTimer > 0 && dist2(p, c) < (p.radius + c.radius + 14) ** 2) damageChest(g, c, p.chargeDamage);
  for (const o of [...g.orbs]) if (dist2(p, o) < (p.magnet + 100) ** 2) { const d = unit(p.x - o.x, p.y - o.y); o.x += d.x * 180 * dt; o.y += d.y * 180 * dt; if (dist2(p, o) < (p.radius + 12) ** 2) { g.orbs = g.orbs.filter(v => v !== o); grantExperience(g, o.value); } }
  for (const item of [...g.pickups]) { const key=item.itemKey||item.kind; if(key===HEROES[g.heroId].itemKey&&(g.inventory[key]||0)<limits[key]&&dist2(p,item)<(p.radius+item.radius)**2){g.inventory[key]++;g.pickups=g.pickups.filter(v=>v!==item);event(g,'item-collected',{item:key,count:g.inventory[key]});} }
  while (g.heroId==='deepseek'&&g.time>=g.nextAutoRiceAt){g.nextAutoRiceAt+=8;if(g.inventory.rice>0&&rand(g)<0.35)eatRice(g,true);}
  if (g.equipment.regen) p.health = Math.min(p.maxHealth, p.health + 0.6 * g.equipment.regen * dt);
  if (g.roundTime >= g.roundDuration && (g.round < 10 || (g.bossSpawned && g.bossDefeated))) endRound(g);
  g.particles.length = Math.min(g.particles.length, limits.particles); return g.events.splice(0);
}
export function getHud(g) { return { phase: g.phase, round: g.round, maxRounds: g.maxRounds, roundTime: g.roundTime, roundDuration: g.roundDuration, score: g.score, level: g.level, xp: g.xp, xpNeed: g.xpNeed, health: g.player.health, maxHealth: g.player.maxHealth, enemies: g.enemies.length, kills: g.kills, notice: g.notice }; }
