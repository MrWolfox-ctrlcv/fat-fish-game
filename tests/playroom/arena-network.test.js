import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA_HEADER_BYTES, ARENA_FIGHTER_BYTES, encodeArenaSnapshot, decodeArenaSnapshot } from '../../playroom/src/arena-network.js';

test('arena snapshots round trip compact little-endian fighter state', () => {
  const packet = encodeArenaSnapshot({ tick: 65537, time: 12.34, phase: 'playing', radius: 389.5, fighters: [
    { id: 2, characterId: 'gptNormal', isHuman: true, alive: true, invulnerable: 0.5, dashTimer: 0.2, x: 123.25, y: -22.5, vx: 3.25, vy: -4.5, facing: 1.234, kills: 9, falls: 2, respawn: 0, dashCooldown: 1.8 },
  ] });
  assert.equal(packet.byteLength, ARENA_HEADER_BYTES + ARENA_FIGHTER_BYTES);
  const decoded = decodeArenaSnapshot(packet);
  assert.equal(decoded.tick, 1);
  assert.equal(decoded.phase, 'playing');
  assert.equal(decoded.fighters[0].id, 2);
  assert.equal(decoded.fighters[0].characterId, 1);
  assert.equal(decoded.fighters[0].isHuman, true);
  assert.equal(decoded.fighters[0].invulnerable, true);
  assert.equal(decoded.fighters[0].dash, true);
  assert.equal(decoded.fighters[0].x, 123.25);
  assert.equal(decoded.fighters[0].y, -22.5);
  assert.equal(decoded.fighters[0].facing, 1.234);
  assert.equal(decoded.fighters[0].kills, 9);
});

test('decoder rejects malformed and unsupported packets', () => {
  assert.throws(() => decodeArenaSnapshot(new ArrayBuffer(3)), /Invalid/);
  const packet = encodeArenaSnapshot({ fighters: [] });
  new DataView(packet).setUint16(0, 2, true);
  assert.throws(() => decodeArenaSnapshot(packet), /Unsupported/);
  const malformed = new ArrayBuffer(ARENA_HEADER_BYTES + ARENA_FIGHTER_BYTES);
  new DataView(malformed).setUint16(0, 1, true);
  assert.throws(() => decodeArenaSnapshot(malformed), /length/);
});
