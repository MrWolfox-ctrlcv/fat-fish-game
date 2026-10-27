import test from 'node:test';
import assert from 'node:assert/strict';
import { pushArenaSnapshot, sampleArenaSnapshots } from '../playroom/src/arena-interpolation.js';

const fighter = (overrides = {}) => ({ id: 1, x: 0, y: 0, vx: 100, vy: 0, facing: 3.1, alive: true, respawn: 0, ...overrides });
const snapshot = (time, fighters) => ({ time, phase: 'playing', fighters });

test('interpolation uses buffered game time and caps the snapshot history at eight', () => {
  const buffer = [];
  for (let i = 0; i < 10; i++) pushArenaSnapshot(buffer, snapshot(i / 10, [fighter({ x: i * 10 })]), i * 100);
  assert.equal(buffer.length, 8);
  assert.equal(buffer[0].snapshot.time, 0.2);
  assert.equal(sampleArenaSnapshots(buffer, 0.85).fighters[0].x, 85);
});

test('angles take the short path across pi', () => {
  const buffer = [
    { snapshot: snapshot(0, [fighter({ facing: 3.1 })]), receivedAt: 0 },
    { snapshot: snapshot(0.1, [fighter({ facing: -3.1, x: 10 })]), receivedAt: 100 },
  ];
  const facing = sampleArenaSnapshots(buffer, 0.05).fighters[0].facing;
  assert.ok(Math.abs(Math.abs(facing) - Math.PI) < 0.03);
});

test('arrival jitter does not change the interpolation point on the server timeline', () => {
  const buffer = [
    { snapshot: snapshot(1, [fighter({ x: 0 })]), receivedAt: 10 },
    { snapshot: snapshot(1.1, [fighter({ x: 10 })]), receivedAt: 260 },
    { snapshot: snapshot(1.2, [fighter({ x: 20 })]), receivedAt: 275 },
  ];
  assert.ok(Math.abs(sampleArenaSnapshots(buffer, 1.15).fighters[0].x - 15) < 1e-9);
});

test('death, respawn, and remote position jumps do not interpolate', () => {
  for (const [before, after] of [
    [fighter(), fighter({ x: 10, alive: false })],
    [fighter({ alive: false, respawn: 0.2 }), fighter({ x: 10, alive: true, respawn: 0 })],
    [fighter(), fighter({ x: 900 })],
  ]) {
    const buffer = [
      { snapshot: snapshot(0, [before]), receivedAt: 0 },
      { snapshot: snapshot(0.1, [after]), receivedAt: 100 },
    ];
    assert.equal(sampleArenaSnapshots(buffer, 0.05).fighters[0].x, after.x);
    assert.equal(sampleArenaSnapshots(buffer, 0.05).fighters[0].alive, after.alive);
  }
});

test('extrapolation stops at 80ms', () => {
  const buffer = [
    { snapshot: snapshot(0, [fighter({ x: 0 })]), receivedAt: 0 },
    { snapshot: snapshot(0.1, [fighter({ x: 10 })]), receivedAt: 100 },
  ];
  assert.equal(sampleArenaSnapshots(buffer, 0.15).fighters[0].x, 15);
  assert.equal(sampleArenaSnapshots(buffer, 1).fighters[0].x, 18);
});
