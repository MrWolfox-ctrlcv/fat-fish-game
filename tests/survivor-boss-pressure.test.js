import test from 'node:test';
import assert from 'node:assert/strict';
import { beginBossArena, updateBossPressure } from '../survival/boss-pressure.js';

const game = modelId => ({ phase: 'playing', player: { x: 1000, y: 700, hp: 100, radius: 10 }, enemies: [{ id: 'boss', modelId, x: 1000, y: 700, hp: 100, radius: 20 }], allies: [] });

test('confines player, enemies, and allies and tightens arena', () => {
  const g = game('astra'); g.player.x = 2000; g.enemies.push({ id: 'e', x: 2000, y: 700, hp: 10 }); g.allies.push({ x: -100, y: 700, hp: 10 });
  const a = beginBossArena(g, g.enemies[0]);
  updateBossPressure(g, 0.05);
  for (const e of [g.player, ...g.enemies, ...g.allies]) assert.ok(Math.hypot(e.x - a.cx, e.y - a.cy) <= a.radius + 1);
  for (let i = 0; i < 400; i++) updateBossPressure(g, 0.05);
  assert.equal(a.radius, 480);
});

test('supports health-based players and keeps a large fish inside map and shrinking arena', () => {
  const g = game('astra');
  g.player = { x: 10, y: 10, health: 100, maxHealth: 100, radius: 92, vx: -20, vy: -20 };
  const arena = beginBossArena(g, g.enemies[0], { width: 2560, height: 1600 });
  assert.equal(arena.cx, 700); assert.equal(arena.cy, 600);
  for (let i = 0; i < 400; i++) updateBossPressure(g, 0.05);
  assert.equal(arena.radius, 480);
  assert.ok(g.player.x >= 92 && g.player.x <= 2560 - 92);
  assert.ok(g.player.y >= 92 && g.player.y <= 1600 - 92);
  assert.ok(Math.hypot(g.player.x - arena.cx, g.player.y - arena.cy) <= arena.radius - 92 + 1);
});

test('hazards only damage after windup and trigger once', () => {
  const g = game('other'); beginBossArena(g, g.enemies[0]);
  const hits = []; updateBossPressure(g, 0.05);
  g.bossArena.age = 3.5; updateBossPressure(g, 0.05, { hurtPlayer: n => hits.push(n) });
  assert.equal(hits.length, 0);
  for (let i = 0; i < 24; i++) updateBossPressure(g, 0.05, { hurtPlayer: n => hits.push(n) });
  for (let i = 0; i < 24; i++) updateBossPressure(g, 0.05, { hurtPlayer: n => hits.push(n) });
  assert.equal(hits.length, 1); assert.equal(hits[0], 18);
});

test('non-playing phases freeze arena and hazards; a missing boss releases them', () => {
  const g = game('fable'); beginBossArena(g, g.enemies[0]);
  g.bossHazards = [{ x: 900, y: 600, radius: 90, age: 0.3, windup: 1.1, duration: 0.35, damage: 18, hit: false }];
  for (const phase of ['paused', 'trait', 'reward', 'rest']) {
    g.phase = phase;
    const snapshot = structuredClone({ arena: g.bossArena, hazards: g.bossHazards });
    updateBossPressure(g, 0.05);
    assert.deepEqual({ arena: g.bossArena, hazards: g.bossHazards }, snapshot);
  }
  g.phase = 'playing'; g.enemies[0].hp = 0;
  updateBossPressure(g, 0.05);
  assert.equal(g.bossArena, null); assert.deepEqual(g.bossHazards, []);
});

test('caps zones and dispatches model-specific pressure callbacks', () => {
  const g = game('fable'); beginBossArena(g, g.enemies[0]); g.bossArena.age = 100;
  let adds = 0;
  updateBossPressure(g, 0.05, { spawnAdds: n => adds += n });
  assert.equal(adds, 2); assert.ok(g.bossHazards.length <= 12);
  const a = game('astra'); beginBossArena(a, a.enemies[0]); a.bossArena.age = 100;
  const bullets = []; updateBossPressure(a, 0.05, { addHostileBullet: b => bullets.push(b) });
  assert.equal(bullets.length, 8); assert.equal(bullets[0].damage, 10);
});

test('late hazard groups are separated, predicted, and occur every 3.5 seconds', () => {
  const g = game('other'); g.player.vx = 100; g.player.vy = 0;
  beginBossArena(g, g.enemies[0]);
  g.bossArena.age = 12;
  updateBossPressure(g, 0.01);
  assert.equal(g.bossHazards.length, 3);
  assert.equal(new Set(g.bossHazards.map(h => `${h.x},${h.y}`)).size, 3);
  const x = g.bossHazards[0].x;
  g.bossHazards = [];
  g.bossArena.age = 15.48;
  updateBossPressure(g, 0.01);
  assert.equal(g.bossHazards.length, 0);
  g.bossArena.age = 15.51;g.player.x+=100;
  updateBossPressure(g, 0.01);
  assert.equal(g.bossHazards.length, 3);
  assert.ok(g.bossHazards[0].x > x);
});
