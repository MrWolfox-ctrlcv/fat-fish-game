import { drawAvatar } from "../art.js";
import { drawArenaFloor } from "../arena-scene.js";
import { ROSTER, getCharacter } from "../arena-roster.js";
import { decideBotInput } from "../arena-bots.js";

export const WIDTH = 1280;
export const HEIGHT = 900;
const CX = WIDTH / 2,
  CY = HEIGHT / 2,
  TAU = Math.PI * 2,
  MAX_DT = 1 / 30;
export const meta = {
  id: "bumper",
  name: "碰碰擂台",
  tagline: "90秒击飞积分赛，掉出台外可以复活！",
  instructions:
    "WASD移动，鼠标瞄准；按冲刺向瞄准方向突进。触屏可双指移动与瞄准",
  actionLabel: "冲刺",
  stats: ["名次", "冲刺"],
  goals: ["击飞选手得分", "掉出台外后会复活", "90秒按击飞数排名"],
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
  len = (x, y) => Math.hypot(x, y),
  finite = (v, d = 0) => (Number.isFinite(v) ? v : d);
function rng(g) {
  let v = (g.rng + 0x6d2b79f5) >>> 0;
  g.rng = v;
  v = Math.imul(v ^ (v >>> 15), v | 1);
  v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
  return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
}
function unit(x, y, fx = 1, fy = 0) {
  const l = len(x, y);
  return l > 0.001 ? [x / l, y / l] : [fx, fy];
}
function arenaRadius(t) {
  return t <= 70 ? 390 : 390 - (t - 70) * 3;
}
function fighter(id, isHuman, x, y, characterId) {
  const character = getCharacter(characterId);
  return {
    id,
    name: isHuman && id === 0 ? "你" : character.name,
    isPlayer: id === 0,
    isHuman,
    characterId: character.id,
    brain: character.brain,
    x,
    y,
    vx: 0,
    vy: 0,
    r: 26,
    mass: 1,
    speed: 225,
    dashSpeed: 620,
    dashDuration: 0.22,
    dashCooldown: 0,
    dashTimer: 0,
    dashX: 1,
    dashY: 0,
    dashHits: [],
    aimX: 0,
    aimY: 0,
    skin: character.skin,
    facing: isHuman ? -Math.PI / 2 : 0,
    alive: true,
    respawn: 0,
    invulnerable: 0,
    lastHitBy: null,
    lastHitAt: -Infinity,
    kills: 0,
    falls: 0,
    knockoutTimer: 0,
    botKind: character.id,
  };
}
export function createGame({ seed = 20261025, humanIds = [0], humanCharacters = {}, botCharacters = {} } = {}) {
  let s = Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : 0x51f15e;
  if (!s) s = 0x51f15e;
  const g = {
    phase: "playing",
    score: 0,
    time: 0,
    duration: 90,
    result: "",
    playerAliveSince: 0,
    survivorReported: false,
    rng: s,
    arenaRadius: 390,
    fighters: [],
    impact: null,
    effects: [],
    botState: { think: 0, inputs: [] },
    humanIds: [...new Set(humanIds.map(Number))],
  };
  const ids = g.humanIds = g.humanIds.filter((id) => Number.isInteger(id) && id >= 0 && id < 6);
  if (!ids.length) ids.push(0);
  const used = new Set(ids.map((id) => getCharacter(humanCharacters[id] || (id === 0 ? "deepseek" : ROSTER[(id % (ROSTER.length - 1)) + 1].id)).id));
  const shuffled = [...ROSTER];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng(g) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (let id = 0; id < 6; id++) {
    const isHuman = ids.includes(id);
    let characterId = humanCharacters[id];
    if (!isHuman) {
      characterId = botCharacters[id];
      if (!characterId || used.has(characterId)) characterId = shuffled.find((c) => !used.has(c.id))?.id;
      if (!characterId) characterId = ROSTER.find((c) => !used.has(c.id))?.id || "deepseek";
      used.add(characterId);
    }
    const slot = ids.indexOf(id);
    const a = slot < 0 ? (TAU * (id + 0.5)) / 6 + 0.3 : (TAU * slot) / Math.max(1, ids.length) + 0.3;
    const r = isHuman && id === 0 ? 0 : 125 + rng(g) * 80;
    g.fighters.push(fighter(id, isHuman, CX + Math.cos(a) * r, CY + Math.sin(a) * r, characterId));
  }
  g.player = g.fighters.find((f) => f.id === 0) || g.fighters[0];
  if (g.player) g.player.isPlayer = true;
  return g;
}
export function getStandings(g) {
  const sorted = [...g.fighters].sort(
    (a, b) => b.kills - a.kills || a.falls - b.falls || a.id - b.id,
  );
  let rank = 0,
    prev = null;
  return sorted.map((f, i) => {
    if (!prev || f.kills !== prev.kills || f.falls !== prev.falls) rank = i + 1;
    prev = f;
    return {
      id: f.id,
      name: f.name,
      isPlayer: f.isPlayer,
      isHuman: f.isHuman,
      characterId: f.characterId,
      brain: f.brain,
      kills: f.kills,
      falls: f.falls,
      rank,
    };
  });
}
function endGame(g, events) {
  if (g.phase !== "playing") return;
  const row = getStandings(g).find((x) => x.isPlayer);
  const tied = getStandings(g).filter((x) => x.rank === 1).length > 1;
  g.phase = row.rank === 1 ? "won" : "lost";
  const place = row.rank === 1 && tied ? "并列第1名" : `第${row.rank}名`;
  g.result = `${place} · ${row.kills}次击飞`;
  events.push({
    type: "end",
    x: g.player.x,
    y: g.player.y,
    text: g.result,
    won: g.phase === "won",
  });
}
function startDash(g, f, input, events) {
  if (!f.alive || f.invulnerable > 0 || f.dashCooldown > 0) return false;
  let dx = finite(input?.aimX, NaN) - f.x,
    dy = finite(input?.aimY, NaN) - f.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || len(dx, dy) < 4) {
    dx = finite(input?.moveX);
    dy = finite(input?.moveY);
  }
  if (len(dx, dy) < 0.001) {
    dx = f.vx;
    dy = f.vy;
  }
  if (len(dx, dy) < 0.001) {
    dx = Math.cos(f.facing);
    dy = Math.sin(f.facing);
  }
  [dx, dy] = unit(dx, dy);
  f.dashX = dx;
  f.dashY = dy;
  f.facing = Math.atan2(dy, dx);
  f.dashTimer = f.dashDuration;
  f.dashCooldown = 1.8;
  f.dashHits = [];
  const tangentSpeed = clamp(-f.vx * dy + f.vy * dx, -50, 50) * 0.2;
  const forwardSpeed = Math.sqrt(f.dashSpeed ** 2 - tangentSpeed ** 2);
  f.vx = dx * forwardSpeed - dy * tangentSpeed;
  f.vy = dy * forwardSpeed + dx * tangentSpeed;
  events.push({ type: "dash", id: f.id, x: f.x, y: f.y });
  return true;
}
export function performAction(g, command = { type: "primary" }) {
  const ev = [];
  if (g.phase === "playing" && (!command || command.type === "primary"))
    startDash(g, g.player, command || {}, ev);
  return ev;
}
function move(f, input, dt) {
  if (!f.alive) {
    f.respawn -= dt;
    return;
  }
  f.knockoutTimer = Math.max(0, f.knockoutTimer - dt);
  let mx = finite(input?.moveX),
    my = finite(input?.moveY),
    m = len(mx, my);
  if (m > 1) {
    mx /= m;
    my /= m;
  }
  if (
    Number.isFinite(input?.aimX) &&
    Number.isFinite(input?.aimY) &&
    len(input.aimX - f.x, input.aimY - f.y) > 4
  )
    f.facing = Math.atan2(input.aimY - f.y, input.aimX - f.x);
  else if (m > 0.01 && f.dashTimer <= 0) f.facing = Math.atan2(my, mx);
  const control = f.knockoutTimer > 0 ? 0.22 : 1;
  f.vx += mx * 900 * control * dt;
  f.vy += my * 900 * control * dt;
  const damping = Math.exp(
    -(f.dashTimer > 0
      ? 0.35
      : f.knockoutTimer > 0
        ? 0.28
        : m > 0.01
          ? 4.5
          : 8) * dt,
  );
  f.vx *= damping;
  f.vy *= damping;
  let sp = len(f.vx, f.vy),
    max = f.dashTimer > 0 ? f.dashSpeed : f.knockoutTimer > 0 ? 550 : f.speed;
  if (sp > max) {
    f.vx *= max / sp;
    f.vy *= max / sp;
  }
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  f.dashTimer = Math.max(0, f.dashTimer - dt);
  f.dashCooldown = Math.max(0, f.dashCooldown - dt);
  f.invulnerable = Math.max(0, f.invulnerable - dt);
}
function collide(g, a, b, events) {
  if (!a.alive || !b.alive || a.invulnerable > 0 || b.invulnerable > 0) return;
  let dx = b.x - a.x,
    dy = b.y - a.y,
    d = len(dx, dy),
    min = a.r + b.r;
  if (d >= min) return;
  let nx, ny;
  if (d < 0.001) {
    const z = ((a.id + 1) * 31 + (b.id + 2) * 17) * 2.3999632297;
    nx = Math.cos(z);
    ny = Math.sin(z);
    d = 0.001;
  } else {
    nx = dx / d;
    ny = dy / d;
  }
  let overlap = min - d;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel < 0) {
    const j = -(1.35 * rel) / 2;
    a.vx -= j * nx;
    a.vy -= j * ny;
    b.vx += j * nx;
    b.vy += j * ny;
  }
  const dashA =
    a.dashTimer > 0 &&
    !a.dashHits.includes(b.id) &&
    a.dashX * nx + a.dashY * ny >= 0.2;
  const dashB =
    b.dashTimer > 0 &&
    !b.dashHits.includes(a.id) &&
    b.dashX * -nx + b.dashY * -ny >= 0.2;
  if (dashA && dashB) {
    applyDashHit(g, a, b, events);
    applyDashHit(g, b, a, events);
  } else if (dashA) applyDashHit(g, a, b, events);
  else if (dashB) applyDashHit(g, b, a, events);
}
function applyDashHit(g, attacker, target, events) {
  const push = 420;
  target.vx += attacker.dashX * push;
  target.vy += attacker.dashY * push;
  attacker.dashHits.push(target.id);
  target.lastHitBy = attacker.id;
  target.lastHitAt = g.time;
  target.knockoutTimer = 0.32;
  g.impact = { x: target.x, y: target.y, ttl: 0.28, max: 0.28 };
  events.push({
    type: "hit",
    id: attacker.id,
    targetId: target.id,
    x: target.x,
    y: target.y,
    text: "砰！",
  });
}
function respawn(g, f, events) {
  const rr = Math.max(55, g.arenaRadius - 80);
  let x = CX,
    y = CY;
  for (let attempt = 0; attempt < 24; attempt++) {
    const ang = (TAU * ((f.id + attempt * 0.618 + g.time * 0.11) % 6)) / 6;
    const candidateX = CX + Math.cos(ang) * rr,
      candidateY = CY + Math.sin(ang) * rr;
    const clear = g.fighters.every(
      (other) =>
        other === f ||
        !other.alive ||
        len(candidateX - other.x, candidateY - other.y) >= 60,
    );
    if (clear) {
      x = candidateX;
      y = candidateY;
      break;
    }
  }
  f.x = x;
  f.y = y;
  f.vx = f.vy = 0;
  f.alive = true;
  if (f === g.player) g.playerAliveSince = g.time;
  f.respawn = 0;
  f.invulnerable = 1;
  f.dashTimer = 0;
  f.dashHits = [];
  f.lastHitBy = null;
  f.lastHitAt = -Infinity;
  events.push({ type: "respawn", x: f.x, y: f.y, id: f.id });
}
function falls(g, events) {
  for (const f of g.fighters) {
    if (!f.alive) {
      if (f.respawn <= 0) respawn(g, f, events);
      continue;
    }
    if (len(f.x - CX, f.y - CY) > g.arenaRadius - f.r * 0.15) {
      f.alive = false;
      if (f === g.player) g.playerAliveSince = null;
      f.falls++;
      f.respawn = 3;
      const owner = g.fighters.find((x) => x.id === f.lastHitBy);
      if (owner && g.time - f.lastHitAt <= 3) {
        owner.kills++;
        if (owner.isPlayer) {
          g.score = owner.kills;
        }
        events.push({
          type: "kill",
          id: owner.id,
          attackerId: owner.id,
          victimId: f.id,
          playerKill: owner.isPlayer,
          humanKill: owner.isHuman,
          playerFall: f.isPlayer,
          humanFall: f.isHuman,
          fallCount: f.falls,
          x: f.x,
          y: f.y,
          text: owner.isHuman ? "+1" : "击飞",
        });
        if (!owner.isPlayer)
          events.push({
            type: "fall",
            id: f.id,
            fallCount: f.falls,
            playerFall: f.isPlayer,
            humanFall: f.isHuman,
            attackerId: owner.id,
            x: f.x,
            y: f.y,
          });
      } else
        events.push({
          type: "fall",
          id: f.id,
          fallCount: f.falls,
          playerFall: f.isPlayer,
          humanFall: f.isHuman,
          victimId: f.id,
          x: f.x,
          y: f.y,
        });
      f.lastHitBy = null;
      f.lastHitAt = -Infinity;
    }
  }
}
export function stepGame(g, input = {}, dt = 1 / 60) {
  return stepArena(g, { [g.player?.id ?? 0]: input }, dt);
}
export function stepArena(g, inputsById = {}, dt = 1 / 60) {
  const events = [];
  if (g.phase !== "playing" || !Number.isFinite(dt) || dt <= 0) return events;
  dt = Math.min(dt, MAX_DT);
  g.time = Math.min(g.duration, g.time + dt);
  g.arenaRadius = arenaRadius(g.time);
  if (g.impact) {
    g.impact.ttl -= dt;
    if (g.impact.ttl <= 0) g.impact = null;
  }
  const commands = {};
  for (const f of g.fighters) {
    if (f.isHuman) commands[f.id] = inputsById?.[f.id] || {};
    else commands[f.id] = g.botState.inputs?.[f.id] || {};
  }
  if (g.botState.think <= 0) {
    g.botState.think = 0.14;
    for (const f of g.fighters) {
      if (f.isHuman) continue;
      commands[f.id] = g.botState.inputs[f.id] = decideBotInput(g, f, () => rng(g));
      if (commands[f.id].primary) startDash(g, f, commands[f.id], events);
    }
  }
  for (const f of g.fighters) {
    const input = commands[f.id] || {};
    if (f.isHuman && input.primary) startDash(g, f, input, events);
    move(f, input, dt);
  }
  for (let i = 0; i < g.fighters.length; i++)
    for (let j = i + 1; j < g.fighters.length; j++)
      collide(g, g.fighters[i], g.fighters[j], events);
  g.botState.think -= dt;
  for (const f of g.fighters) {
    if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) {
      f.x = CX;
      f.y = CY;
      f.vx = f.vy = 0;
    }
    const s = len(f.vx, f.vy),
      max = f.dashTimer > 0 ? 620 : f.knockoutTimer > 0 ? 550 : f.speed;
    if (s > max) {
      f.vx *= max / s;
      f.vy *= max / s;
    }
  }
  falls(g, events);
  if (events.some((event) => event.type === "fall" && event.playerFall)) {
    g.playerStreak = 0;
    g.playerKillTimes = [];
  }
  const playerKills = events.filter(
    (event) => event.type === "kill" && event.playerKill,
  ).length;
  if (playerKills) {
    g.playerKillTimes ??= [];
    g.playerStreak ??= 0;
    g.playerKillTimes = g.playerKillTimes.filter((time) => g.time - time <= 5);
    const priorWindowKills = g.playerKillTimes.length;
    const priorStreak = g.playerStreak;
    for (let i = 0; i < playerKills; i++) {
      g.playerKillTimes.push(g.time);
      g.playerStreak += 1;
    }
    const nextWindowKills = g.playerKillTimes.length;
    if (Math.floor(priorWindowKills / 2) < Math.floor(nextWindowKills / 2)) {
      const doubleThresholds =
        Math.floor(nextWindowKills / 2) - Math.floor(priorWindowKills / 2);
      events.push({
        type: "double_kill",
        id: `double:${g.player.kills}`,
        count: doubleThresholds * 2,
      });
    }
    if (Math.floor(priorStreak / 3) < Math.floor(g.playerStreak / 3)) {
      events.push({
        type: "kill_streak",
        id: `streak:${g.player.kills}`,
        count: Math.floor(g.playerStreak / 3) * 3,
      });
    }
  }
  if (
    !g.survivorReported &&
    g.player.alive &&
    g.playerAliveSince !== null &&
    g.time - g.playerAliveSince >= 30
  ) {
    g.survivorReported = true;
    events.push({ type: "survivor", id: "survivor:30" });
  }
  if (g.time >= g.duration) endGame(g, events);
  return events;
}
export function getHud(g) {
  const row = getStandings(g).find((x) => x.isPlayer);
  return {
    score: g.score,
    time: g.time,
    stat1: `第${row.rank}名`,
    stat2:
      g.player.dashCooldown > 0
        ? `${g.player.dashCooldown.toFixed(1)}s`
        : "就绪",
    message: g.phase === "playing" ? "击飞得分 · 落水3秒后复活" : g.result,
  };
}
function shadow(ctx, x, y, r, a = 0.2) {
  ctx.beginPath();
  ctx.ellipse(x + 3, y + r * 0.65, r, r * 0.4, 0, 0, TAU);
  ctx.fillStyle = `rgba(16,40,61,${a})`;
  ctx.fill();
}
export function renderGame(ctx, g, view = {}) {
  ctx.save();
  if (view.floor) ctx.drawImage(view.floor, 0, 0);
  else drawArenaFloor(ctx, g.arenaRadius);
  for (const f of g.fighters) {
    if (!f.alive) {
      continue;
    }
    const avatarSkin = view.art?.[`portrait:${f.characterId}`]
      ? `portrait:${f.characterId}`
      : f.skin;
    shadow(ctx, f.x, f.y, f.r);
    if (f.invulnerable > 0) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, 37, 0, TAU);
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (f.dashTimer > 0) {
      ctx.globalAlpha = 0.3;
      drawAvatar(
        ctx,
        view.art,
        avatarSkin,
        f.x - f.dashX * 27,
        f.y - f.dashY * 27,
        72,
        0,
        0,
      );
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(f.x, f.y, 34, 0, TAU);
    ctx.fillStyle = f.isPlayer
      ? "rgba(255,248,222,.8)"
      : "rgba(255,255,255,.3)";
    ctx.fill();
    ctx.strokeStyle = f.isPlayer ? "#efad68" : "rgba(85,127,137,.6)";
    ctx.lineWidth = f.isPlayer ? 3 : 2;
    ctx.stroke();
    drawAvatar(
      ctx,
      view.art,
      avatarSkin,
      f.x,
      f.y,
      72,
      0,
      f.dashTimer > 0 ? 0.18 : 0,
    );
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.facing);
    ctx.beginPath();
    ctx.moveTo(34, 0);
    ctx.lineTo(43, -6);
    ctx.lineTo(43, 6);
    ctx.closePath();
    ctx.fillStyle = f.isPlayer ? "#efad68" : "#568d87";
    ctx.fill();
    ctx.restore();
    ctx.font = "bold 18px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = "#31556a";
    ctx.fillText(f.name, f.x, f.y + 53);
  }
  if (g.impact) {
    let t = 1 - g.impact.ttl / g.impact.max;
    ctx.beginPath();
    ctx.arc(g.impact.x, g.impact.y, 10 + 28 * t, 0, TAU);
    ctx.strokeStyle = `rgba(240,132,159,${1 - t})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  const p = g.player;
  if (!p.alive) {
    ctx.fillStyle = "rgba(15,30,48,.55)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 30px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(`复活倒计时 ${Math.max(0, p.respawn).toFixed(1)} 秒`, CX, CY);
  }
  ctx.restore();
}
