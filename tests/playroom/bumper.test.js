import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  getHud,
  getStandings,
  performAction,
  stepGame,
} from "../../playroom/src/modes/bumper.js";
const F = 1 / 60;
function tick(g, n, input = {}) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(...stepGame(g, input, F));
  return out;
}
function clear(g) {
  for (const f of g.fighters.slice(1)) {
    f.alive = false;
    f.respawn = 999;
  }
}

test("90-second match ends once and standings resolve ties by falls", () => {
  const g = createGame();
  clear(g);
  g.time = 89.99;
  const e = stepGame(g, {}, F);
  assert.equal(g.duration, 90);
  assert.equal(g.phase, "won");
  assert.equal(e.filter((x) => x.type === "end").length, 1);
  assert.equal(getHud(g).time, 90);
  assert.deepEqual(stepGame(g, {}, F), []);
});
test("a lower-ranked player is not described as tied for first when leaders are tied", () => {
  const g = createGame();
  clear(g);
  g.fighters[1].kills = 4;
  g.fighters[2].kills = 4;
  g.time = 89.99;
  stepGame(g, {}, F);
  assert.equal(g.phase, "lost");
  assert.match(g.result, /^第3名/);
});
test("all six use identical body and dash rules; aim takes precedence over movement", () => {
  const g = createGame();
  for (const f of g.fighters) {
    assert.equal(f.r, 26);
    assert.equal(f.mass, 1);
    assert.equal(f.speed, 225);
    assert.equal(f.dashSpeed, 620);
    assert.equal(f.dashCooldown, 0);
  }
  performAction(g, {
    type: "primary",
    moveX: -1,
    aimX: g.player.x + 100,
    aimY: g.player.y,
  });
  assert.ok(g.player.vx > 300);
  assert.equal(g.player.dashCooldown, 1.8);
});
test("stationary dash reaches burst speed and aim turns the avatar independently of movement", () => {
  const g = createGame();
  const player = g.player;
  const events = stepGame(g, { aimX: player.x, aimY: player.y - 100 }, F);
  assert.equal(player.facing, -Math.PI / 2);
  assert.ok(events.some((event) => event.type === "dash") === false);
  assert.deepEqual(
    performAction(g, {
      type: "primary",
      aimX: player.x + 100,
      aimY: player.y,
    }),
    [{ type: "dash", id: 0, x: player.x, y: player.y }],
  );
  assert.ok(player.vx > 600);
  stepGame(g, { aimX: player.x, aimY: player.y + 100 }, F);
  assert.ok(player.facing > 1.4 && player.facing < 1.7);
});
test("reverse motion does not weaken a dash aimed in the opposite direction", () => {
  const g = createGame();
  const player = g.player;
  player.vx = -225;
  const events = performAction(g, {
    type: "primary",
    aimX: player.x + 100,
    aimY: player.y,
  });
  assert.equal(events[0]?.type, "dash");
  assert.ok(
    player.vx >= 600,
    `expected forward dash velocity, got ${player.vx}`,
  );
  assert.ok(Math.hypot(player.vx, player.vy) <= 620.001);
});
test("player fall respawns without ending match; self-fall does not score", () => {
  const g = createGame();
  clear(g);
  g.player.x = 1050;
  g.player.y = 450;
  const e = stepGame(g, {}, F);
  assert.equal(g.phase, "playing");
  assert.ok(e.some((x) => x.type === "fall"));
  assert.equal(g.score, 0);
  tick(g, 181);
  assert.ok(g.player.alive);
  assert.equal(g.player.invulnerable, 1);
  assert.deepEqual(performAction(g), []);
});
test("last effective attacker receives a point within three seconds; expired ownership does not", () => {
  const g = createGame();
  clear(g);
  g.time = 10;
  const [p, v] = g.fighters;
  Object.assign(p, { x: 500, y: 450 });
  Object.assign(v, {
    alive: true,
    respawn: 0,
    x: 1135,
    y: 450,
    vx: 0,
    vy: 0,
    lastHitBy: p.id,
    lastHitAt: g.time,
  });
  const e = stepGame(g, {}, F);
  assert.ok(e.some((x) => x.type === "kill"));
  assert.equal(p.kills, 1);
  assert.equal(g.score, 1);
  const other = g.fighters[1];
  v.alive = true;
  v.x = 1135;
  v.y = 450;
  v.lastHitBy = other.id;
  v.lastHitAt = g.time - 4;
  stepGame(g, {}, F);
  assert.equal(other.kills, 0);
});
test("multiplayer kill events identify the human attacker without changing player-zero score", () => {
  const g = createGame({ seed: 44, humanIds: [0, 1] });
  clear(g);
  g.time = 10;
  const [playerZero, attacker, victim] = g.fighters;
  Object.assign(attacker, { x: 500, y: 450 });
  Object.assign(victim, {
    alive: true, respawn: 0, x: 1135, y: 450, vx: 0, vy: 0,
    lastHitBy: attacker.id, lastHitAt: g.time,
  });
  const events = stepGame(g, {}, F);
  const kill = events.find((event) => event.type === "kill");
  assert.equal(kill?.attackerId, attacker.id);
  assert.equal(kill?.victimId, victim.id);
  assert.equal(kill?.humanKill, true);
  assert.equal(kill?.playerKill, false);
  assert.equal(attacker.kills, 1);
  assert.equal(playerZero.kills, 0);
  assert.equal(g.score, 0);
});
test("player kill events fire when a single step crosses double and streak thresholds", () => {
  const g = createGame();
  clear(g);
  g.time = 10;
  g.player.kills = 5;
  g.score = 5;
  g.playerStreak = 2;
  g.playerKillTimes = [g.time - 0.2, g.time - 0.1];
  g.botState.think = 10;
  g.botState.inputs = Array(5).fill({});
  for (const [i, victim] of g.fighters.slice(1, 3).entries()) {
    Object.assign(victim, {
      alive: true,
      respawn: 0,
      x: 1050,
      y: 250 + i * 300,
      vx: 0,
      vy: 0,
      lastHitBy: g.player.id,
      lastHitAt: g.time,
    });
  }

  const events = stepGame(g, {}, F);
  const doubleKill = events.find((event) => event.type === "double_kill");
  const killStreak = events.find((event) => event.type === "kill_streak");
  assert.deepEqual(doubleKill?.count, 2);
  assert.deepEqual(killStreak?.count, 3);
  assert.equal(killStreak?.id, "streak:7");
});
test("survivor requires 30 continuous seconds alive after the latest respawn", () => {
  const g = createGame();
  clear(g);
  g.time = 25;
  Object.assign(g.player, { x: 1050, y: 450 });
  stepGame(g, {}, F);
  assert.equal(g.playerAliveSince, null);

  g.player.respawn = F;
  stepGame(g, {}, F);
  const aliveSince = g.playerAliveSince;
  assert.equal(g.player.alive, true);
  assert.ok(aliveSince > 25);

  g.time = 29.99;
  assert.equal(
    stepGame(g, {}, F).some((event) => event.type === "survivor"),
    false,
  );
  g.time = aliveSince + 30 - F / 2;
  assert.equal(
    stepGame(g, {}, F).some((event) => event.type === "survivor"),
    true,
  );
  assert.equal(
    stepGame(g, {}, F).some((event) => event.type === "survivor"),
    false,
  );
});
test("dash collision is directional, one hit per target, and facing dashers push symmetrically", () => {
  const g = createGame();
  clear(g);
  g.time = 12;
  const [a, b] = g.fighters;
  g.botState.think = 1;
  Object.assign(a, {
    x: 500,
    y: 450,
    vx: 200,
    vy: 0,
    dashTimer: 0.2,
    dashX: 1,
    dashY: 0,
  });
  Object.assign(b, {
    alive: true,
    x: 537,
    y: 450,
    vx: -200,
    vy: 0,
    dashTimer: 0.2,
    dashX: -1,
    dashY: 0,
  });
  const e = stepGame(g, {}, F);
  assert.equal(e.filter((x) => x.type === "hit").length, 2);
  assert.ok(a.vx < 200);
  assert.ok(b.vx > -200);
  assert.ok(Math.abs(a.vx + b.vx) < 0.01);
  assert.equal(a.dashHits.length, 1);
  assert.equal(b.dashHits.length, 1);
});
test("dash knockback persists through a short reduced-control window", () => {
  const g = createGame();
  clear(g);
  const [a, b] = g.fighters;
  Object.assign(a, {
    x: 500,
    y: 450,
    vx: 0,
    vy: 0,
    dashTimer: 0.2,
    dashX: 1,
    dashY: 0,
  });
  Object.assign(b, { alive: true, x: 537, y: 450, vx: 0, vy: 0 });
  stepGame(g, {}, F);
  const hitSpeed = Math.hypot(b.vx, b.vy);
  tick(g, 3);
  assert.ok(hitSpeed > 300);
  assert.ok(Math.hypot(b.vx, b.vy) > 250);
});
test("cooldown gates dash and seeded replay stays deterministic and finite", () => {
  const a = createGame({ seed: 101 }),
    b = createGame({ seed: 101 });
  a.player.dashCooldown = b.player.dashCooldown = 1;
  assert.deepEqual(performAction(a), []);
  for (let i = 0; i < 1800; i++) {
    const input = {
      moveX: i % 80 < 40 ? 1 : -0.6,
      moveY: i % 60 < 20 ? -0.7 : 0.2,
      aimX: 700,
      aimY: 450,
      primary: i % 100 === 0,
    };
    stepGame(a, input, F);
    stepGame(b, input, F);
    assert.deepEqual(a, b);
    for (const f of a.fighters)
      for (const n of [f.x, f.y, f.vx, f.vy]) assert.ok(Number.isFinite(n));
  }
});
test("standings returns rank records without changing game state", () => {
  const g = createGame();
  g.fighters[1].kills = 2;
  const before = JSON.stringify(g);
  const rows = getStandings(g);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].rank, 1);
  assert.equal(JSON.stringify(g), before);
});
test("bots dash, hit and score against one another during a deterministic match", () => {
  const g = createGame({ seed: 101 });
  let botDashes = 0;
  let botHits = 0;
  for (let i = 0; i < 5400 && g.phase === "playing"; i++) {
    for (const event of stepGame(g, {}, F)) {
      if (event.type === "dash" && event.id > 0) botDashes++;
      if (event.type === "hit" && event.id > 0 && event.targetId > 0) botHits++;
    }
  }
  assert.ok(botDashes > 0, `expected bot dash, got ${botDashes}`);
  assert.ok(botHits > 0, `expected bot-on-bot hit, got ${botHits}`);
  assert.ok(g.fighters.slice(1).some((f) => f.kills > 0));
});
test("respawn chooses a safe gap from living fighters and clears hit ownership", () => {
  const g = createGame();
  const [p, bot] = g.fighters;
  Object.assign(p, {
    alive: false,
    respawn: 0,
    lastHitBy: bot.id,
    lastHitAt: g.time,
  });
  Object.assign(bot, { x: 500, y: 450, alive: true });
  stepGame(g, {}, F);
  assert.equal(p.alive, true);
  assert.equal(p.lastHitBy, null);
  assert.equal(p.lastHitAt, -Infinity);
  assert.ok(Math.hypot(p.x - bot.x, p.y - bot.y) >= 60);
});
test("a bot predicts outward momentum and turns back before leaving the platform", () => {
  const g = createGame();
  const bot = g.fighters[1];
  for (const other of g.fighters.slice(2)) {
    other.alive = false;
    other.respawn = 999;
  }
  bot.x = 640 + g.arenaRadius - 60;
  bot.y = 450;
  bot.vx = 130;
  bot.vy = 0;
  const startRadius = Math.hypot(bot.x - 640, bot.y - 450);
  tick(g, 45);
  const endRadius = Math.hypot(bot.x - 640, bot.y - 450);
  assert.ok(
    endRadius < startRadius,
    `bot should return inward: ${startRadius} -> ${endRadius}`,
  );
});
