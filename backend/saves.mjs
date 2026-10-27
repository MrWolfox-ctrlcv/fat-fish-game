import { createHash } from 'node:crypto';

export const SAVE_PRICE_USD = '0.01';
export const SAVE_PRICE_QUOTA = 5000;
export const SAVE_LIMITS = Object.freeze({
  free_slots: 1,
  max_slots: 5,
  free_retention_hours: 24,
  paid_retention_days: 7,
  extension_days: 7,
  max_retention_days: 30,
});
export const FREE_TTL = SAVE_LIMITS.free_retention_hours * 60 * 60 * 1000;
export const PAID_TTL = SAVE_LIMITS.paid_retention_days * 24 * 60 * 60 * 1000;
export const SAVE_EXTENSION = SAVE_LIMITS.extension_days * 24 * 60 * 60 * 1000;
export const SAVE_TTL = FREE_TTL;
export const SAVE_MAX_RETENTION = SAVE_LIMITS.max_retention_days * 24 * 60 * 60 * 1000;
export const SAVE_MAX_BYTES = 256 * 1024;

const invalid = (message = '存档请求不正确。') => Object.assign(new Error(message), { status: 422, code: 'INVALID_SAVE' });

export function validateSaveRequest(input, physicsVersion) {
  if (!input || typeof input !== 'object' || !Number.isSafeInteger(input.slot) || input.slot < 1 || input.slot > SAVE_LIMITS.max_slots ||
      typeof input.run_id !== 'string' || input.run_id.length < 8 || input.run_id.length > 128 ||
      !Number.isSafeInteger(input.step) || input.step < 0 || !Array.isArray(input.moves) || input.moves.length > 500 ||
      input.physics_version !== physicsVersion || !/^[a-zA-Z0-9_-]{8,128}$/.test(input.request_id || '') ||
      (input.confirm_quota !== undefined && input.confirm_quota !== SAVE_PRICE_QUOTA)) throw invalid();
  return input;
}

export function validateSaveExtension(input) {
  if (!input || typeof input !== 'object' || !Number.isSafeInteger(input.slot) || input.slot < 1 || input.slot > SAVE_LIMITS.max_slots ||
      input.confirm_quota !== SAVE_PRICE_QUOTA || !/^[a-zA-Z0-9_-]{8,128}$/.test(input.request_id || '')) throw invalid();
  return input;
}

export function validateSaveLoad(input, physicsVersion) {
  if (!input || typeof input !== 'object' || !Number.isSafeInteger(input.slot) || input.slot < 1 || input.slot > SAVE_LIMITS.max_slots) throw invalid();
  if (input.physics_version !== physicsVersion) throw Object.assign(new Error('游戏已更新，当前存档与此版本不兼容。'), { status: 409, code: 'GAME_UPDATED' });
  return input;
}

export function saveFingerprint(input, mode = 'write') {
  const data = mode === 'extend'
    ? { slot: input.slot, confirm_quota: input.confirm_quota, mode }
    : { slot: input.slot, run_id: input.run_id, step: input.step, moves: input.moves,
      physics_version: input.physics_version, confirm_quota: input.confirm_quota ?? null, mode };
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function isValidSnapshot(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.bodies) || state.bodies.length > 250 ||
      !Number.isSafeInteger(state.stepIndex) || state.stepIndex < 0 || !Number.isSafeInteger(state.randomState) ||
      !Number.isSafeInteger(state.variantState) || !Array.isArray(state.unlocked) || !Array.isArray(state.seenEggs) ||
      !Array.isArray(state.seenEggStages)) return false;
  const serialized = JSON.stringify(state);
  return Buffer.byteLength(serialized, 'utf8') <= SAVE_MAX_BYTES;
}

// Particles only animate merge effects and never affect scoring or replay physics.
// Persist all gameplay state while dropping this ephemeral visual history.
export function compactSnapshot(state) {
  return { ...structuredClone(state), particles: [] };
}
