import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA_HEADER_BYTES, ARENA_FIGHTER_BYTES, ARENA_V1_HEADER_BYTES, encodeArenaSnapshot, decodeArenaSnapshot } from '../../playroom/src/arena-network.js';

test('v2 team snapshots preserve compact fighter state and signed team scores', () => {
  const packet = encodeArenaSnapshot({ tick: 65537, time: 12.34, phase: 'playing', radius: 389.5, mode: 'teams', teamScores: [7, -2], fighters: [
    { id: 2, characterId: 'gptNormal', teamId: 1, isHuman: true, alive: true, invulnerable: 0.5, dashTimer: 0.2, x: 123.25, y: -22.5, vx: 3.25, vy: -4.5, facing: 1.234, kills: 9, falls: 2, respawn: 0, dashCooldown: 1.8 },
  ] });
  assert.equal(packet.byteLength, ARENA_HEADER_BYTES + ARENA_FIGHTER_BYTES);
  const decoded = decodeArenaSnapshot(packet);
  assert.equal(decoded.version, 2);
  assert.equal(decoded.tick, 1);
  assert.equal(decoded.phase, 'playing');
  assert.equal(decoded.mode, 'teams');
  assert.deepEqual(decoded.teamScores, [7, -2]);
  assert.equal(decoded.fighters[0].id, 2);
  assert.equal(decoded.fighters[0].characterId, 1);
  assert.equal(decoded.fighters[0].teamId, 1);
  assert.equal(decoded.fighters[0].isHuman, true);
  assert.equal(decoded.fighters[0].invulnerable, true);
  assert.equal(decoded.fighters[0].dash, true);
  assert.equal(decoded.fighters[0].x, 123.25);
  assert.equal(decoded.fighters[0].y, -22.5);
  assert.equal(decoded.fighters[0].facing, 1.234);
  assert.equal(decoded.fighters[0].kills, 9);
});

test('v1 FFA packets remain readable with no team assignments or scores', () => {
  const buffer = new ArrayBuffer(ARENA_V1_HEADER_BYTES + ARENA_FIGHTER_BYTES);
  const view = new DataView(buffer);
  view.setUint16(0, 1, true); view.setUint16(2, 22, true); view.setUint16(4, 1350, true);
  view.setUint8(6, 1); view.setUint8(7, 1); view.setUint16(8, 1500, true); view.setUint16(10, 0, true);
  const o = ARENA_V1_HEADER_BYTES;
  view.setUint8(o, 1); view.setUint8(o + 1, 2); view.setUint16(o + 2, 9, true);
  const decoded = decodeArenaSnapshot(buffer);
  assert.equal(decoded.version, 1);
  assert.equal(decoded.mode, 'ffa');
  assert.deepEqual(decoded.teamScores, [0, 0]);
  assert.equal(decoded.fighters[0].teamId, null);
  assert.equal(decoded.fighters[0].isHuman, true);
});

test('decoder rejects malformed lengths, unknown versions, and invalid v2 metadata', () => {
  assert.throws(() => decodeArenaSnapshot(new ArrayBuffer(3)), /Invalid/);
  const unsupported = encodeArenaSnapshot({ fighters: [] });
  new DataView(unsupported).setUint16(0, 3, true);
  assert.throws(() => decodeArenaSnapshot(unsupported), /Unsupported/);
  const malformed = new ArrayBuffer(ARENA_V1_HEADER_BYTES + ARENA_FIGHTER_BYTES);
  new DataView(malformed).setUint16(0, 1, true);
  assert.throws(() => decodeArenaSnapshot(malformed), /length/);
  const badMode = encodeArenaSnapshot({ fighters: [] });
  new DataView(badMode).setUint8(10, 2);
  assert.throws(() => decodeArenaSnapshot(badMode), /mode/);
  const bothTeams = encodeArenaSnapshot({ mode: 'teams', fighters: [{ id: 0, teamId: 0 }] });
  new DataView(bothTeams).setUint16(ARENA_HEADER_BYTES + 2, 16 | 32, true);
  assert.throws(() => decodeArenaSnapshot(bothTeams), /team/);
  const missingTeam = encodeArenaSnapshot({ mode: 'teams', fighters: [{ id: 0 }] });
  assert.throws(() => decodeArenaSnapshot(missingTeam), /team/);
});
