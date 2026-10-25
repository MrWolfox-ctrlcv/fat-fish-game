import { drawAvatar } from "../art.js";

export const WIDTH = 720;
export const HEIGHT = 480;

export const meta = {
  id: "survival",
  name: "肥鱼幸存者",
  tagline: "边走边打，收集经验，撑过 60 秒",
  instructions: "WASD / 摇杆移动；自动攻击附近 Bug；靠近经验点即可吸收；Space 冲刺。",
  actionLabel: "冲刺",
  stats: ["成长等级", "生命"],
  goals: ["移动躲避追击", "收集经验升级", "存活 60 秒"],
};

const PLAYER_RADIUS = 14;
const MAX_ENEMIES = 34;
const MAX_BULLETS = 36;
const MAX_ORBS = 72;
const MAX_PARTICLES = 48;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function random(g) {
  let x = g.rng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  g.rng = x >>> 0 || 1;
  return g.rng / 4294967296;
}

function addBurst(g, x, y, color, count = 5) {
  for (let i = 0; i < count && g.particles.length < MAX_PARTICLES; i++) {
    const angle = random(g) * Math.PI * 2;
    const speed = 22 + random(g) * 64;
    g.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.35 + random(g) * 0.2, color });
  }
}

function spawnEnemy(g, kind = null) {
  if (g.enemies.length >= MAX_ENEMIES) return;
  const angle = random(g) * Math.PI * 2;
  const edge = random(g) < 0.5 ? -18 : 738;
  let x, y;
  if (random(g) < 0.5) {
    x = edge;
    y = 24 + random(g) * 432;
  } else {
    x = 24 + random(g) * 672;
    y = random(g) < 0.5 ? -18 : 498;
  }
  // Keep the first wave comfortably far from the player.
  if (g.time < 4 && distance2({ x, y }, g.player) < 185 ** 2) {
    x = g.player.x + Math.cos(angle) * 220;
    y = g.player.y + Math.sin(angle) * 180;
  }
  x = clamp(x, -20, 740);
  y = clamp(y, -20, 500);
  if (!kind) kind = random(g) < 0.58 ? "bug" : random(g) < 0.55 ? "error" : "bot";
  const elite = kind === "elite";
  const spec = elite ? { hp: 13, radius: 25, speed: 39, xp: 7, color: "#ff9f43" }
    : kind === "bot" ? { hp: 3, radius: 16, speed: 48, xp: 2, color: "#69e5d2" }
      : kind === "error" ? { hp: 2, radius: 13, speed: 65, xp: 2, color: "#ff5468" }
        : { hp: 1, radius: 12, speed: 57, xp: 1, color: "#d46cff" };
  g.enemies.push({ id: g.nextId++, kind, x, y, vx: 0, vy: 0, hp: spec.hp, maxHp: spec.hp, radius: spec.radius, speed: spec.speed, xp: spec.xp, color: spec.color, flash: 0, elite, knock: 0 });
}

function dropXp(g, x, y, amount) {
  if (g.orbs.length >= MAX_ORBS) return;
  g.orbs.push({ x, y, value: amount, radius: 7, life: 24, phase: random(g) * 6.28 });
}

function collectXp(g, orb) {
  g.xp += orb.value;
  g.collected += orb.value;
  let leveled = false;
  while (g.xp >= g.xpNeed) {
    g.xp -= g.xpNeed;
    g.level += 1;
    g.xpNeed = Math.floor(5 + g.level * 3.1);
    // Alternating upgrades ensure every level immediately improves combat.
    if (g.level % 3 === 0) {
      g.player.damage += 1;
      g.upgrade = `火力 ${g.player.damage}`;
    } else if (g.level % 3 === 1) {
      g.player.shots = Math.min(5, g.player.shots + 1);
      g.upgrade = `弹数 ${g.player.shots}`;
    } else {
      g.player.fireRate = Math.max(0.2, g.player.fireRate * 0.86);
      g.upgrade = `射速 ${Math.round(1 / g.player.fireRate * 10) / 10}/秒`;
    }
    g.levelFlash = 0.8;
    leveled = true;
  }
  return leveled;
}

export function createGame({ seed = 20261025 } = {}) {
  const safeSeed = (Number(seed) >>> 0) || 1;
  return {
    phase: "playing", score: 0, time: 0, duration: 60, result: "", rng: safeSeed,
    player: { x: 360, y: 240, vx: 0, vy: 0, radius: PLAYER_RADIUS, health: 8, maxHealth: 8, damage: 1, shots: 1, fireRate: 0.62, fireTimer: 0.25, dashCooldown: 0, dashTimer: 0, hurtTimer: 0, facing: 0 },
    enemies: [], bullets: [], orbs: [], particles: [], xp: 0, xpNeed: 5, level: 1, collected: 0,
    nextId: 1, spawnTimer: 0.7, elite30: false, elite45: false, levelFlash: 0, upgrade: "", hitFlash: 0,
  };
}

function finish(g, won, events) {
  if (g.phase !== "playing") return;
  g.phase = won ? "won" : "lost";
  g.result = won ? "成功撑过 60 秒！" : "生命耗尽，换条路线再来！";
  events.push({ type: "end", won });
}

export function performAction(g, command = { type: "primary" }) {
  const events = [];
  if (g.phase !== "playing" || command?.type !== "primary" || g.player.dashCooldown > 0) return events;
  const p = g.player;
  let dx = Number.isFinite(command?.moveX) ? command.moveX : 0;
  let dy = Number.isFinite(command?.moveY) ? command.moveY : 0;
  if (Math.hypot(dx, dy) < 0.1) { dx = p.vx; dy = p.vy; }
  if (Math.hypot(dx, dy) < 12) {
    if (Number.isFinite(command?.aimX) && Number.isFinite(command?.aimY)) {
      dx = command.aimX - p.x;
      dy = command.aimY - p.y;
    }
    if (Math.hypot(dx, dy) < 1) { dx = Math.cos(p.facing); dy = Math.sin(p.facing); }
  }
  const length = Math.hypot(dx, dy) || 1;
  p.vx = dx / length * 430;
  p.vy = dy / length * 430;
  p.dashTimer = 0.24;
  p.dashCooldown = 3;
  events.push({ type: "dash", x: p.x, y: p.y });
  return events;
}

export function stepGame(g, input = {}, dt) {
  if (g.phase !== "playing") return [];
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 1 / 30) : 0;
  if (!step) return [];
  const events = [];
  const p = g.player;
  const oldTime = g.time;
  g.time = Math.min(g.duration, g.time + step);
  if (g.time >= g.duration - 1e-8) g.time = g.duration;
  p.dashCooldown = Math.max(0, p.dashCooldown - step);
  p.dashTimer = Math.max(0, p.dashTimer - step);
  p.hurtTimer = Math.max(0, p.hurtTimer - step);
  g.levelFlash = Math.max(0, g.levelFlash - step);
  g.hitFlash = Math.max(0, g.hitFlash - step);

  if (p.dashTimer <= 0) {
    const mx = Number.isFinite(input.moveX) ? input.moveX : 0;
    const my = Number.isFinite(input.moveY) ? input.moveY : 0;
    const magnitude = Math.hypot(mx, my);
    const nx = magnitude > 1 ? mx / magnitude : mx;
    const ny = magnitude > 1 ? my / magnitude : my;
    const speed = 180;
    p.vx += (nx * speed - p.vx) * Math.min(1, step * 9);
    p.vy += (ny * speed - p.vy) * Math.min(1, step * 9);
  }
  p.x = clamp(p.x + p.vx * step, 20, WIDTH - 20);
  p.y = clamp(p.y + p.vy * step, 32, HEIGHT - 22);
  if (Math.hypot(p.vx, p.vy) > 4) p.facing = Math.atan2(p.vy, p.vx);

  // Scheduled elites are guaranteed to appear once at the requested marks.
  if (!g.elite30 && oldTime < 30 && g.time >= 30) { spawnEnemy(g, "elite"); g.elite30 = true; events.push({ type: "order", x: 360, y: 62, text: "精英入侵" }); }
  if (!g.elite45 && oldTime < 45 && g.time >= 45) { spawnEnemy(g, "elite"); g.elite45 = true; events.push({ type: "order", x: 360, y: 62, text: "精英增援" }); }

  g.spawnTimer -= step;
  if (g.spawnTimer <= 0) {
    const interval = Math.max(0.47, 1.25 - g.time * 0.011);
    spawnEnemy(g);
    g.spawnTimer += interval;
  }

  // Auto fire at the nearest target in range; extra levels fan out the volley.
  p.fireTimer -= step;
  if (p.fireTimer <= 0 && g.enemies.length) {
    let target = null, nearest = 250 ** 2;
    for (const enemy of g.enemies) {
      const d = distance2(p, enemy);
      if (d < nearest) { nearest = d; target = enemy; }
    }
    if (target) {
      const baseAngle = Math.atan2(target.y - p.y, target.x - p.x);
      p.facing = baseAngle;
      const count = p.shots;
      for (let i = 0; i < count && g.bullets.length < MAX_BULLETS; i++) {
        const angle = baseAngle + (i - (count - 1) / 2) * 0.16;
        g.bullets.push({ x: p.x + Math.cos(angle) * 18, y: p.y + Math.sin(angle) * 18, vx: Math.cos(angle) * 330, vy: Math.sin(angle) * 330, damage: p.damage, life: 1.35, radius: 4 });
      }
      p.fireTimer = p.fireRate;
    } else p.fireTimer = 0.08;
  }

  for (const enemy of g.enemies) {
    const dx = p.x - enemy.x, dy = p.y - enemy.y;
    const d = Math.hypot(dx, dy) || 1;
    enemy.vx = dx / d * enemy.speed + enemy.vx * 0.15;
    enemy.vy = dy / d * enemy.speed + enemy.vy * 0.15;
    if (enemy.knock > 0) enemy.knock = Math.max(0, enemy.knock - step);
    else { enemy.x += enemy.vx * step; enemy.y += enemy.vy * step; }
    enemy.x = clamp(enemy.x, -24, WIDTH + 24);
    enemy.y = clamp(enemy.y, -24, HEIGHT + 24);
    enemy.flash = Math.max(0, enemy.flash - step);
  }
  const survivors = [];
  for (const bullet of g.bullets) {
    bullet.x += bullet.vx * step; bullet.y += bullet.vy * step; bullet.life -= step;
    let hit = false;
    for (const enemy of g.enemies) {
      if (enemy.dead) continue;
      if (distance2(bullet, enemy) <= (bullet.radius + enemy.radius) ** 2) {
        enemy.hp -= bullet.damage; enemy.flash = 0.12; hit = true;
        events.push({ type: "hit", x: enemy.x, y: enemy.y });
        if (enemy.hp <= 0) {
          enemy.dead = true;
          g.score += enemy.elite ? 3 : 1;
          dropXp(g, enemy.x, enemy.y, enemy.xp);
          addBurst(g, enemy.x, enemy.y, enemy.color, enemy.elite ? 10 : 4);
          events.push({ type: "kill", x: enemy.x, y: enemy.y, text: enemy.elite ? "精英击破" : "Bug 击破" });
        }
        break;
      }
    }
    if (!hit && bullet.life > 0 && bullet.x > -20 && bullet.x < WIDTH + 20 && bullet.y > -20 && bullet.y < HEIGHT + 20) survivors.push(bullet);
  }
  g.bullets = survivors;
  g.enemies = g.enemies.filter(enemy => !enemy.dead);

  const orbs = [];
  for (const orb of g.orbs) {
    orb.life -= step; orb.phase += step * 3;
    const d = Math.sqrt(distance2(p, orb));
    if (d < 112) {
      const pull = d < 1 ? 0 : (180 + (112 - d) * 4) / d;
      orb.x += (p.x - orb.x) * Math.min(1, pull * step);
      orb.y += (p.y - orb.y) * Math.min(1, pull * step);
    }
    if (distance2(p, orb) < 22 ** 2) {
      const levelUp = collectXp(g, orb);
      events.push({ type: levelUp ? "level" : "serve", x: p.x, y: p.y, text: levelUp ? `升级 ${g.level}` : `+${orb.value} XP` });
    } else if (orb.life > 0) orbs.push(orb);
  }
  g.orbs = orbs;

  for (const enemy of g.enemies) {
    const contactRange = p.radius + enemy.radius - 1;
    if (distance2(p, enemy) <= contactRange ** 2 && p.dashTimer <= 0 && p.hurtTimer <= 0) {
      p.health -= 1;
      p.hurtTimer = 0.7;
      g.hitFlash = 0.18;
      const d = Math.hypot(p.x - enemy.x, p.y - enemy.y) || 1;
      enemy.x -= (p.x - enemy.x) / d * 22;
      enemy.y -= (p.y - enemy.y) / d * 22;
      enemy.knock = 0.12;
      events.push({ type: "hit", x: p.x, y: p.y, text: "受伤" });
      if (p.health <= 0) finish(g, false, events);
      break;
    }
  }

  for (const particle of g.particles) {
    particle.x += particle.vx * step; particle.y += particle.vy * step;
    particle.vx *= 0.92; particle.vy *= 0.92; particle.life -= step;
  }
  g.particles = g.particles.filter(particle => particle.life > 0);

  if (g.phase === "playing" && g.time >= g.duration) finish(g, true, events);
  return events;
}

export function getHud(g) {
  const p = g.player;
  const cd = p.dashCooldown > 0 ? `${p.dashCooldown.toFixed(1)}s` : "就绪";
  const message = g.phase !== "playing" ? g.result : p.dashCooldown > 0 ? `冲刺 ${cd}` : "Space 冲刺就绪";
  return { score: g.score, time: g.time, stat1: `Lv.${g.level}`, stat2: `♥ ${p.health}/${p.maxHealth}`, message };
}

function drawEnemy(ctx, e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.fillStyle = e.flash > 0 ? "#ffffff" : e.color;
  if (e.kind === "bug") {
    ctx.beginPath(); ctx.ellipse(0, 0, e.radius, e.radius * 0.78, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#e8c8ff"; ctx.lineWidth = 2;
    for (const side of [-1, 1]) for (const y of [-5, 4]) { ctx.beginPath(); ctx.moveTo(side * 7, y); ctx.lineTo(side * 14, y + Math.sign(side) * 4); ctx.stroke(); }
    ctx.fillStyle = "#202445"; ctx.beginPath(); ctx.arc(-4, -2, 2, 0, 7); ctx.arc(4, -2, 2, 0, 7); ctx.fill();
  } else if (e.kind === "error") {
    ctx.fillRect(-e.radius, -e.radius, e.radius * 2, e.radius * 2);
    ctx.strokeStyle = "#ffcf68"; ctx.lineWidth = 2; ctx.strokeRect(-e.radius + 2, -e.radius + 2, e.radius * 2 - 4, e.radius * 2 - 4);
    ctx.fillStyle = "#fff4e8"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("!", 0, 0);
  } else if (e.kind === "bot") {
    ctx.fillRect(-e.radius * 0.8, -e.radius * 0.75, e.radius * 1.6, e.radius * 1.5);
    ctx.fillStyle = "#16364a"; ctx.fillRect(-6, -5, 4, 4); ctx.fillRect(3, -5, 4, 4);
    ctx.fillStyle = "#a7fff0"; ctx.fillRect(-4, 5, 8, 2);
  } else {
    ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff0ba"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#5e2538"; ctx.fillRect(-8, -4, 5, 5); ctx.fillRect(3, -4, 5, 5);
    ctx.fillStyle = "#fff2cc"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center"; ctx.fillText("ERR", 0, 11);
    ctx.fillStyle = "#351a36"; ctx.fillRect(-20, -e.radius - 9, 40, 4);
    ctx.fillStyle = "#ffdf76"; ctx.fillRect(-20, -e.radius - 9, 40 * clamp(e.hp / e.maxHp, 0, 1), 4);
  }
  ctx.restore();
}

export function renderGame(ctx, g, view = {}) {
  ctx.fillStyle = "#071a32"; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#0a2440";
  for (let y = 18; y < HEIGHT; y += 32) for (let x = 18; x < WIDTH; x += 32) ctx.fillRect(x, y, 1, 1);
  ctx.strokeStyle = "rgba(67,155,190,.12)"; ctx.lineWidth = 1;
  for (let x = 24; x < WIDTH; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke(); }
  for (let y = 24; y < HEIGHT; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke(); }

  for (const orb of g.orbs) {
    const r = orb.radius + Math.sin(orb.phase) * 1.2;
    ctx.fillStyle = "rgba(77,235,255,.18)"; ctx.beginPath(); ctx.arc(orb.x, orb.y, r + 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#63f2ff"; ctx.beginPath(); ctx.arc(orb.x, orb.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e4ffff"; ctx.beginPath(); ctx.arc(orb.x - 2, orb.y - 2, 2, 0, Math.PI * 2); ctx.fill();
  }
  for (const bullet of g.bullets) {
    ctx.fillStyle = "#ffe66d"; ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.radius + 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fffbd0"; ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2); ctx.fill();
  }
  for (const enemy of g.enemies) drawEnemy(ctx, enemy);
  for (const particle of g.particles) {
    ctx.globalAlpha = clamp(particle.life / 0.5, 0, 1); ctx.fillStyle = particle.color;
    ctx.beginPath(); ctx.arc(particle.x, particle.y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  const p = g.player;
  if (p.dashTimer > 0) {
    ctx.strokeStyle = "rgba(98,241,255,.72)"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(p.x, p.y, 23, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.25; ctx.fillStyle = "#6df5ff"; ctx.beginPath(); ctx.ellipse(p.x - p.vx * 0.035, p.y - p.vy * 0.035, 19, 12, p.facing, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  }
  if (p.hurtTimer <= 0 || Math.floor(g.time * 22) % 2 === 0) drawAvatar(ctx, view.art, "deepseek", p.x, p.y, 38, p.facing, Math.min(1, Math.hypot(p.vx, p.vy) / 160));
  if (p.hurtTimer > 0) {
    ctx.strokeStyle = "rgba(255,86,111,.92)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, 25, 0, Math.PI * 2); ctx.stroke();
  }

  // Compact XP meter is part of the playfield to preserve the shared two-stat HUD.
  ctx.fillStyle = "rgba(2,12,28,.78)"; ctx.fillRect(16, 14, 240, 38);
  ctx.fillStyle = "#dff8ff"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(`Lv.${g.level}  ${g.xp}/${g.xpNeed} XP`, 25, 24);
  ctx.fillStyle = "#173b56"; ctx.fillRect(25, 34, 220, 8);
  ctx.fillStyle = "#4deaff"; ctx.fillRect(25, 34, 220 * clamp(g.xp / g.xpNeed, 0, 1), 8);
  if (g.levelFlash > 0) {
    ctx.globalAlpha = clamp(g.levelFlash / 0.8, 0, 1); ctx.fillStyle = "#fff29a"; ctx.font = "bold 21px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(`LEVEL UP! ${g.upgrade}`, 360, 76); ctx.globalAlpha = 1;
  }
  if (g.hitFlash > 0) { ctx.globalAlpha = g.hitFlash / 0.18 * 0.18; ctx.fillStyle = "#ff385d"; ctx.fillRect(0, 0, WIDTH, HEIGHT); ctx.globalAlpha = 1; }
  if (g.phase !== "playing") {
    ctx.fillStyle = "rgba(4,12,29,.68)"; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 34px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(g.phase === "won" ? "60 秒生存！" : "被 Bug 淹没了", 360, 225);
    ctx.font = "16px sans-serif"; ctx.fillStyle = "#bfefff"; ctx.fillText(g.result, 360, 266);
  }
}
