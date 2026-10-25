import test from "node:test";
import assert from "node:assert/strict";
import { createGame, getHud, performAction, stepGame } from "../../playroom/src/modes/survival.js";

const tick = (g, input = {}, count = 1) => {
  const events = [];
  for (let i = 0; i < count; i++) events.push(...stepGame(g, input, 1 / 30));
  return events;
};

test("automatic fire emits bullets that hit and damage a nearby enemy", () => {
  const g = createGame({ seed: 42 });
  g.enemies.push({ id: 100, kind: "bug", x: 405, y: 240, vx: 0, vy: 0, hp: 2, maxHp: 2, radius: 12, speed: 0, xp: 1, color: "#d46cff", flash: 0, elite: false, knock: 0 });
  const ev = tick(g, {}, 10);
  assert.ok(ev.some(e => e.type === "hit"));
  assert.ok(g.enemies[0].hp < 2);
});

test("enemy defeat drops collectible XP and level upgrades improve real combat stats", () => {
  const g = createGame({ seed: 3 });
  // Place a low-health target in the shot lane and let the real projectile resolve.
  g.player.x = 130;
  g.enemies.push({ id: 100, kind: "bug", x: 200, y: 240, vx: 0, vy: 0, hp: 1, maxHp: 1, radius: 12, speed: 0, xp: 5, color: "#d46cff", flash: 0, elite: false, knock: 0 });
  const killed = [];
  for (let i = 0; i < 18 && !killed.some(e => e.type === "kill"); i++) {
    killed.push(...stepGame(g, {}, 1 / 30));
  }
  assert.ok(killed.some(e => e.type === "kill"));
  g.player.x = 350;
  g.player.y = 400;
  assert.equal(g.orbs.length, 1);
  // The pickup's value crosses the initial threshold and gives a fan shot.
  g.player.x = g.orbs[0].x;
  g.player.y = g.orbs[0].y;
  const beforeRate = g.player.fireRate;
  const picked = tick(g, {}, 1);
  assert.ok(picked.some(e => e.type === "level"));
  assert.equal(g.level, 2);
  assert.ok(g.player.fireRate < beforeRate, "the level cuts the interval between automatic volleys");
  assert.equal(g.orbs.length, 0);
});

test("two bullets in one frame award only one kill and one XP drop", () => {
  const g = createGame({ seed: 31 });
  g.enemies.push({ id: 100, kind: "bug", x: 420, y: 240, vx: 0, vy: 0, hp: 1, maxHp: 1, radius: 12, speed: 0, xp: 1, color: "#d46cff", flash: 0, elite: false, knock: 0 });
  for (let i = 0; i < 2; i++) g.bullets.push({ x: 420, y: 240, vx: 0, vy: 0, damage: 1, life: 1, radius: 4 });
  const events = stepGame(g, {}, 1 / 30);
  assert.equal(events.filter(e => e.type === "kill").length, 1);
  assert.equal(g.score, 1);
  assert.equal(g.orbs.length, 1);
  assert.equal(g.bullets.length, 1, "the later bullet does not also resolve against the dead target");
});

test("dash grants brief invulnerability and observes its three second cooldown", () => {
  const g = createGame({ seed: 6 });
  const first = performAction(g);
  assert.equal(first[0]?.type, "dash");
  assert.equal(g.player.dashCooldown, 3);
  assert.deepEqual(performAction(g), []);
  g.enemies.push({ id: 101, kind: "bug", x: g.player.x, y: g.player.y, vx: 0, vy: 0, hp: 1, maxHp: 1, radius: 12, speed: 0, xp: 1, color: "#d46cff", flash: 0, elite: false, knock: 0 });
  const health = g.player.health;
  tick(g, {}, 2);
  assert.equal(g.player.health, health, "dash window prevents contact damage");
  tick(g, {}, 90);
  assert.ok(g.player.dashCooldown <= 0);
  assert.equal(performAction(g)[0]?.type, "dash");
});

test("contact damage has a 0.7 second grace window and can end the run", () => {
  const g = createGame({ seed: 8 });
  const makeToucher = () => ({ id: g.nextId++, kind: "bug", x: g.player.x, y: g.player.y, vx: 0, vy: 0, hp: 100, maxHp: 100, radius: 12, speed: 0, xp: 1, color: "#d46cff", flash: 0, elite: false, knock: 0 });
  g.player.dashTimer = 0;
  g.enemies.push(makeToucher());
  tick(g);
  assert.equal(g.player.health, 7);
  g.enemies.push(makeToucher());
  tick(g, {}, 10);
  assert.equal(g.player.health, 7, "a second overlap cannot bypass hurt cooldown");
  g.player.hurtTimer = 0;
  g.player.health = 1;
  g.enemies.push(makeToucher());
  const ev = tick(g);
  assert.equal(g.phase, "lost");
  assert.ok(ev.some(e => e.type === "end" && e.won === false));
  const time = g.time;
  assert.deepEqual(stepGame(g, {}, 1 / 30), []);
  assert.equal(g.time, time);
});

test("scheduled elites appear at 30 and 45 seconds; surviving 60 seconds wins once", () => {
  const g = createGame({ seed: 10 });
  g.player.health = 999;
  g.player.hurtTimer = 999;
  const events = [];
  for (let i = 0; i < 30 * 30; i++) events.push(...stepGame(g, {}, 1 / 30));
  assert.ok(g.enemies.some(e => e.elite));
  assert.ok(events.some(e => e.text === "精英入侵"));
  for (let i = 0; i < 15 * 30; i++) events.push(...stepGame(g, {}, 1 / 30));
  assert.ok(g.enemies.filter(e => e.elite).length >= 2);
  assert.ok(events.some(e => e.text === "精英增援"));
  for (let i = 0; i < 15 * 30; i++) events.push(...stepGame(g, {}, 1 / 30));
  assert.equal(g.phase, "won");
  assert.equal(g.time, 60);
  assert.equal(events.filter(e => e.type === "end").length, 1);
  assert.equal(getHud(g).time, 60);
});

test("seeded runs are deterministic and entity counts and coordinates stay bounded", () => {
  const a = createGame({ seed: 123456 });
  const b = createGame({ seed: 123456 });
  a.player.health = b.player.health = 999;
  a.player.hurtTimer = b.player.hurtTimer = 999;
  for (let i = 0; i < 60 * 30; i++) {
    const input = { moveX: i % 240 < 120 ? 0.7 : -0.7, moveY: i % 90 < 45 ? -0.3 : 0.3 };
    stepGame(a, input, 1 / 30);
    stepGame(b, input, 1 / 30);
  }
  assert.deepEqual(a, b);
  assert.ok(a.enemies.length <= 34);
  assert.ok(a.bullets.length <= 36);
  assert.ok(a.orbs.length <= 72);
  assert.ok(a.particles.length <= 48);
  for (const point of [a.player, ...a.enemies, ...a.bullets, ...a.orbs, ...a.particles]) {
    for (const value of Object.values(point)) if (typeof value === "number") assert.ok(Number.isFinite(value));
  }
});

test("active movement with cooldown dashes can survive while standing still is dangerous", () => {
  const idle = createGame({ seed: 20261025 });
  const moving = createGame({ seed: 20261025 });
  for (let i = 0; i < 60 * 30; i++) {
    if (idle.phase === "playing") stepGame(idle, {}, 1 / 30);
    if (moving.phase === "playing") {
      const angle = (i / 30) * 1.05;
      const input = { moveX: Math.cos(angle), moveY: Math.sin(angle) };
      if (i % 90 === 0) performAction(moving, { type: "primary", ...input });
      stepGame(moving, input, 1 / 30);
    }
  }
  assert.equal(idle.phase, "lost");
  assert.equal(moving.phase, "won");
  assert.ok(moving.level > 1, "moving through the field collects XP and upgrades combat");
  assert.ok(moving.player.health > 0);
});
