// Compact room snapshots: v2 has a 16-byte header and 24 bytes per fighter.
import { ROSTER } from './arena-roster.js';

export const ARENA_WIRE_VERSION = 2;
export const ARENA_HEADER_BYTES = 16;
export const ARENA_V1_HEADER_BYTES = 12;
export const ARENA_FIGHTER_BYTES = 24;
export const ARENA_MAX_FIGHTERS = 6;
export const ARENA_FLAGS = Object.freeze({ alive: 1, invulnerable: 2, dash: 4, human: 8, team0: 16, team1: 32 });

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const scaled = (value, factor, min, max) => Math.round(clamp(finite(value), min, max) * factor);
const characterIndex = (value) => Number.isInteger(value) ? clamp(value, 0, ROSTER.length - 1) : Math.max(0, ROSTER.findIndex((character) => character.id === value));

function teamScore(scores, index) {
  const value = Array.isArray(scores) ? scores[index] : scores?.[index];
  return clamp(Math.trunc(finite(value)), -32768, 32767);
}

export function encodeArenaSnapshot(state = {}) {
  const fighters = Array.isArray(state.fighters) ? state.fighters.slice(0, ARENA_MAX_FIGHTERS) : [];
  const buffer = new ArrayBuffer(ARENA_HEADER_BYTES + fighters.length * ARENA_FIGHTER_BYTES);
  const view = new DataView(buffer);
  view.setUint16(0, ARENA_WIRE_VERSION, true);
  view.setUint16(2, finite(state.tick) & 0xffff, true);
  view.setUint16(4, Math.round(clamp(finite(state.time), 0, 655.35) * 100), true);
  view.setUint8(6, state.phase === 'playing' ? 1 : state.phase === 'ended' ? 2 : 0);
  view.setUint8(7, fighters.length);
  view.setUint16(8, scaled(state.radius, 4, 0, 16383.75), true);
  view.setUint8(10, state.mode === 'teams' ? 1 : 0);
  view.setUint8(11, 0);
  view.setInt16(12, teamScore(state.teamScores, 0), true);
  view.setInt16(14, teamScore(state.teamScores, 1), true);
  fighters.forEach((fighter, index) => {
    const offset = ARENA_HEADER_BYTES + index * ARENA_FIGHTER_BYTES;
    let flags = 0;
    if (fighter.alive) flags |= ARENA_FLAGS.alive;
    if (fighter.invulnerable > 0 || fighter.invulnerable === true) flags |= ARENA_FLAGS.invulnerable;
    if (fighter.dashTimer > 0) flags |= ARENA_FLAGS.dash;
    if (fighter.isHuman) flags |= ARENA_FLAGS.human;
    if (state.mode === 'teams' && fighter.teamId === 0) flags |= ARENA_FLAGS.team0;
    if (state.mode === 'teams' && fighter.teamId === 1) flags |= ARENA_FLAGS.team1;
    view.setUint8(offset, clamp(Math.trunc(finite(fighter.id)), 0, 255));
    view.setUint8(offset + 1, characterIndex(fighter.characterId));
    view.setUint16(offset + 2, flags, true);
    view.setInt16(offset + 4, scaled(fighter.x, 4, -8192, 8191.75), true);
    view.setInt16(offset + 6, scaled(fighter.y, 4, -8192, 8191.75), true);
    view.setInt16(offset + 8, scaled(fighter.vx, 4, -8192, 8191.75), true);
    view.setInt16(offset + 10, scaled(fighter.vy, 4, -8192, 8191.75), true);
    view.setInt16(offset + 12, scaled(fighter.facing, 1000, -32.768, 32.767), true);
    view.setUint16(offset + 14, clamp(Math.trunc(finite(fighter.kills)), 0, 65535), true);
    view.setUint16(offset + 16, clamp(Math.trunc(finite(fighter.falls)), 0, 65535), true);
    view.setUint16(offset + 18, Math.round(clamp(finite(fighter.respawn), 0, 65.535) * 1000), true);
    view.setUint16(offset + 20, Math.round(clamp(finite(fighter.dashCooldown), 0, 65.535) * 1000), true);
    view.setUint16(offset + 22, Math.round(clamp(finite(fighter.dashTimer), 0, 65.535) * 1000), true);
  });
  return buffer;
}

export function decodeArenaSnapshot(value) {
  const buffer = value instanceof ArrayBuffer ? value : ArrayBuffer.isView(value) ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : null;
  if (!buffer || buffer.byteLength < ARENA_V1_HEADER_BYTES) throw new TypeError('Invalid arena snapshot');
  const view = new DataView(buffer);
  const version = view.getUint16(0, true);
  if (version !== 1 && version !== ARENA_WIRE_VERSION) throw new TypeError('Unsupported arena snapshot version');
  const headerBytes = version === 1 ? ARENA_V1_HEADER_BYTES : ARENA_HEADER_BYTES;
  if (buffer.byteLength < headerBytes) throw new TypeError('Invalid arena snapshot');
  const count = view.getUint8(7);
  if (count > ARENA_MAX_FIGHTERS || buffer.byteLength !== headerBytes + count * ARENA_FIGHTER_BYTES) throw new TypeError('Invalid arena snapshot length');
  const phaseCode = view.getUint8(6);
  if (phaseCode > 2) throw new TypeError('Invalid arena phase');
  let mode = 'ffa';
  let teamScores = [0, 0];
  if (version === 1) {
    if (view.getUint16(10, true) !== 0) throw new TypeError('Invalid arena reserved field');
  } else {
    const modeCode = view.getUint8(10);
    if (modeCode > 1 || view.getUint8(11) !== 0) throw new TypeError('Invalid arena mode or reserved field');
    mode = modeCode === 1 ? 'teams' : 'ffa';
    teamScores = [view.getInt16(12, true), view.getInt16(14, true)];
  }
  const fighters = [];
  for (let i = 0; i < count; i++) {
    const o = headerBytes + i * ARENA_FIGHTER_BYTES;
    const flags = view.getUint16(o + 2, true);
    const t0 = Boolean(flags & ARENA_FLAGS.team0);
    const t1 = Boolean(flags & ARENA_FLAGS.team1);
    if (version === 1 && (t0 || t1) || t0 && t1 || mode === 'ffa' && (t0 || t1) || mode === 'teams' && !t0 && !t1) throw new TypeError('Invalid arena fighter team');
    fighters.push({
      id: view.getUint8(o), characterId: view.getUint8(o + 1),
      alive: Boolean(flags & ARENA_FLAGS.alive), invulnerable: Boolean(flags & ARENA_FLAGS.invulnerable),
      dash: Boolean(flags & ARENA_FLAGS.dash), isHuman: Boolean(flags & ARENA_FLAGS.human),
      teamId: version === 1 || mode === 'ffa' ? null : t0 ? 0 : t1 ? 1 : null,
      x: view.getInt16(o + 4, true) / 4, y: view.getInt16(o + 6, true) / 4,
      vx: view.getInt16(o + 8, true) / 4, vy: view.getInt16(o + 10, true) / 4,
      facing: view.getInt16(o + 12, true) / 1000, kills: view.getUint16(o + 14, true), falls: view.getUint16(o + 16, true),
      respawn: view.getUint16(o + 18, true) / 1000, dashCooldown: view.getUint16(o + 20, true) / 1000,
      dashTimer: view.getUint16(o + 22, true) / 1000,
    });
  }
  return { version, tick: view.getUint16(2, true), time: view.getUint16(4, true) / 100,
    phase: ['waiting', 'playing', 'ended'][phaseCode], radius: view.getUint16(8, true) / 4, mode, teamScores, fighters };
}
