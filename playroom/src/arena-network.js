// Shared compact snapshot codec for the authoritative bumper room stream.
// Header is 12 bytes; each fighter is exactly 24 bytes, little-endian.
import { ROSTER } from './arena-roster.js';
export const ARENA_WIRE_VERSION = 1;
export const ARENA_HEADER_BYTES = 12;
export const ARENA_FIGHTER_BYTES = 24;
export const ARENA_MAX_FIGHTERS = 6;
export const ARENA_FLAGS = Object.freeze({ alive: 1, invulnerable: 2, dash: 4, human: 8 });

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const scaled = (value, factor, min, max) => Math.round(clamp(finite(value), min, max) * factor);
const characterIndex = (value) => Number.isInteger(value) ? clamp(value, 0, ROSTER.length - 1) : Math.max(0, ROSTER.findIndex((character) => character.id === value));

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
  view.setUint16(10, 0, true);
  fighters.forEach((fighter, index) => {
    const offset = ARENA_HEADER_BYTES + index * ARENA_FIGHTER_BYTES;
    let flags = 0;
    if (fighter.alive) flags |= ARENA_FLAGS.alive;
    if (fighter.invulnerable > 0 || fighter.invulnerable === true) flags |= ARENA_FLAGS.invulnerable;
    if (fighter.dashTimer > 0) flags |= ARENA_FLAGS.dash;
    if (fighter.isHuman) flags |= ARENA_FLAGS.human;
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
  if (!buffer || buffer.byteLength < ARENA_HEADER_BYTES) throw new TypeError('Invalid arena snapshot');
  const view = new DataView(buffer);
  if (view.getUint16(0, true) !== ARENA_WIRE_VERSION) throw new TypeError('Unsupported arena snapshot version');
  const count = view.getUint8(7);
  if (count > ARENA_MAX_FIGHTERS || buffer.byteLength !== ARENA_HEADER_BYTES + count * ARENA_FIGHTER_BYTES) throw new TypeError('Invalid arena snapshot length');
  const phaseCode = view.getUint8(6);
  if (phaseCode > 2) throw new TypeError('Invalid arena phase');
  const fighters = [];
  for (let i = 0; i < count; i++) {
    const o = ARENA_HEADER_BYTES + i * ARENA_FIGHTER_BYTES;
    const flags = view.getUint16(o + 2, true);
    fighters.push({
      id: view.getUint8(o), characterId: view.getUint8(o + 1),
      alive: Boolean(flags & ARENA_FLAGS.alive), invulnerable: Boolean(flags & ARENA_FLAGS.invulnerable),
      dash: Boolean(flags & ARENA_FLAGS.dash), isHuman: Boolean(flags & ARENA_FLAGS.human),
      x: view.getInt16(o + 4, true) / 4, y: view.getInt16(o + 6, true) / 4,
      vx: view.getInt16(o + 8, true) / 4, vy: view.getInt16(o + 10, true) / 4,
      facing: view.getInt16(o + 12, true) / 1000, kills: view.getUint16(o + 14, true), falls: view.getUint16(o + 16, true),
      respawn: view.getUint16(o + 18, true) / 1000, dashCooldown: view.getUint16(o + 20, true) / 1000,
      dashTimer: view.getUint16(o + 22, true) / 1000,
    });
  }
  return { version: ARENA_WIRE_VERSION, tick: view.getUint16(2, true), time: view.getUint16(4, true) / 100,
    phase: ['waiting', 'playing', 'ended'][phaseCode], radius: view.getUint16(8, true) / 4, fighters };
}
