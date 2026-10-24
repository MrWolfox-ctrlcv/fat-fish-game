import { createGame, dropBody, stepGame } from '../dist/game.js';
import { seededRandom } from '../dist/seeded-random.js';

export function snapshot(game) {
  return {
    ...game, random: undefined, variantRandom: undefined,
    randomState: game.random.getState(), variantState: game.variantRandom.getState(),
    unlocked: [...game.unlocked], seenEggs: [...game.seenEggs], seenEggStages: [...game.seenEggStages],
  };
}

export function initialState(seed, variantSeed) {
  return snapshot(createGame({ height: 620, random: seededRandom(seed), variantRandom: seededRandom(variantSeed) }));
}

export function replayCheckpoint(state, moves, target) {
  if (!Number.isSafeInteger(target) || target < state.stepIndex || target > 108000 || target - state.stepIndex > 18000) {
    throw new Error('对局时间不合法，请重新开始。');
  }
  if (!Array.isArray(moves) || moves.length > 500) throw new Error('投放记录过长。');
  const game = {
    ...structuredClone(state), random: seededRandom(state.randomState), variantRandom: seededRandom(state.variantState),
    unlocked: new Set(state.unlocked), seenEggs: new Set(state.seenEggs), seenEggStages: new Set(state.seenEggStages),
  };
  let index = 0;
  let previousStep = state.stepIndex;
  for (const move of moves) {
    if (!move || !Number.isSafeInteger(move.step) || move.step < previousStep || move.step > target ||
        !Number.isFinite(move.x) || move.x < 0 || move.x > 480) throw new Error('投放记录不合法。');
    previousStep = move.step;
  }
  while (true) {
    while (index < moves.length && moves[index].step === game.stepIndex) {
      if (!dropBody(game, moves[index].x)) throw new Error('投放频率不合法。');
      index++;
    }
    if (game.stepIndex === target) break;
    if (game.over) throw new Error('这局已结束，请重新开始。');
    stepGame(game, 1 / 60);
    if (game.bodies.length > 250) throw new Error('鱼缸记录不合法。');
  }
  if (index !== moves.length) throw new Error('投放记录不完整。');
  const summary = {
    score: game.score, max_level: Math.max(...game.unlocked), over: game.over,
    unlocked: [...game.unlocked], egg_stages: [...game.seenEggStages],
  };
  return { state: snapshot(game), summary };
}
