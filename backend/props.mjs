import { createHash } from 'node:crypto';
import { seededRandom } from '../dist/seeded-random.js';
import { snapshot } from './replay.mjs';

export const PROP_PRICE_USD = '0.01';
export const PROP_PRICE_QUOTA = 5000;
export const PROP_KINDS = new Set(['remove', 'merge', 'swap', 'pack', 'revive']);

const invalid = (message = '道具选择无效。') => Object.assign(new Error(message), { status: 422, code: 'INVALID_PROP' });

export function validatePropInput(input) {
  if (!input || typeof input !== 'object' || typeof input.run_id !== 'string' ||
      !Number.isSafeInteger(input.step) || input.step < 0 ||
      !Array.isArray(input.moves) || !/^[a-zA-Z0-9_-]{8,128}$/.test(input.request_id || '') ||
      !PROP_KINDS.has(input.kind) || input.confirm_quota !== PROP_PRICE_QUOTA || !Array.isArray(input.body_ids)) throw invalid();
  const validCount = input.kind === 'revive' ? input.body_ids.length === 0 : input.kind === 'pack'
    ? input.body_ids.length >= 1 && input.body_ids.length <= 3
    : input.body_ids.length === (input.kind === 'remove' ? 1 : 2);
  if (!validCount || input.body_ids.some((id) => typeof id !== 'string' && !Number.isSafeInteger(id)) ||
      new Set(input.body_ids).size !== input.body_ids.length) throw invalid();
  return { runId: input.run_id, step: input.step, moves: input.moves, requestId: input.request_id,
    kind: input.kind, bodyIds: input.body_ids, quota: PROP_PRICE_QUOTA };
}

export function propFingerprint(prop) {
  return createHash('sha256').update(JSON.stringify({ run_id: prop.runId, step: prop.step, moves: prop.moves,
    kind: prop.kind, body_ids: prop.bodyIds, confirm_quota: prop.quota })).digest('hex');
}

export function propInputFingerprint(input) {
  return createHash('sha256').update(JSON.stringify({ run_id: input?.run_id, step: input?.step, moves: input?.moves,
    kind: input?.kind, body_ids: input?.body_ids, confirm_quota: input?.confirm_quota })).digest('hex');
}

export function hydrateState(state) {
  return { ...structuredClone(state), random: seededRandom(state.randomState), variantRandom: seededRandom(state.variantState),
    unlocked: new Set(state.unlocked), seenEggs: new Set(state.seenEggs), seenEggStages: new Set(state.seenEggStages) };
}

export function validatePropBodies(state, kind, bodyIds) {
  if (!Array.isArray(bodyIds)) throw invalid('所选鱼不符合道具使用条件。');
  if (kind === 'revive') {
    if (state.over !== true || bodyIds.length !== 0) throw invalid('只能在本局结束后续玩。');
    return [];
  }
  const validCount = kind === 'remove' ? bodyIds.length === 1
    : kind === 'pack' ? bodyIds.length >= 1 && bodyIds.length <= 3
      : ['merge', 'swap'].includes(kind) && bodyIds.length === 2;
  if (!validCount || new Set(bodyIds).size !== bodyIds.length) throw invalid('所选鱼不符合道具使用条件。');
  const selected = bodyIds.map((id) => state.bodies.find((body) => body.id === id));
  if (selected.some((body) => !body) ||
      (kind === 'merge' && (selected[0].level !== selected[1].level || selected[0].level >= 11)) ||
      (kind === 'pack' && selected.some((body) => body.level < 1 || body.level > 3))) throw invalid('所选鱼不符合道具使用条件。');
  return selected;
}

export async function applyProp(state, kind, bodyIds) {
  const { applyFishProp } = await import('../dist/game.js');
  if (typeof applyFishProp !== 'function') throw Object.assign(new Error('道具功能暂不可用。'), { status: 503, code: 'PROP_UNAVAILABLE' });
  const game = hydrateState(state);
  validatePropBodies(game, kind, bodyIds);
  const result = applyFishProp(game, kind, bodyIds);
  if (!result) throw invalid('道具无法应用到所选鱼。');
  return { state: snapshot(game), summary: result.summary };
}
