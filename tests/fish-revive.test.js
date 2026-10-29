import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, makeBody, stepGame, applyFishProp, WARNING_LINE_Y, FAILURE_LINE_Y } from '../dist/game.js';
import { seededRandom } from '../dist/seeded-random.js';
import { snapshot } from '../backend/replay.mjs';
import { validatePropBodies, validatePropInput } from '../backend/props.mjs';

test('a settled fish between the warning and real limit never ends the round', () => {
  const game = createGame({ height: 130 });
  game.bodies.push(makeBody(game, 1, 200, 98, { age: 10 }));
  for (let i = 0; i < 240; i++) stepGame(game, 1 / 60);
  const top = game.bodies[0].y - game.bodies[0].r;
  assert.ok(top < WARNING_LINE_Y && top > FAILURE_LINE_Y);
  assert.equal(game.over, false);
  assert.equal(game.overTimer, 0);
});

test('the higher limit retains the young-fish grace and persistent overflow rule', () => {
  const game = createGame({ height: 95 });
  game.bodies.push(makeBody(game, 1, 200, 63));
  for (let i = 0; i < 60; i++) stepGame(game, 1 / 60);
  assert.equal(game.over, false);
  for (let i = 0; i < 150; i++) stepGame(game, 1 / 60);
  assert.equal(game.over, true);
});

test('revive clears the warning zone, preserves score and RNG, and can only revive an ended run', () => {
  const game = createGame({ random: seededRandom(123), variantRandom: seededRandom(456) });
  const top = makeBody(game, 3, 100, 40, { age: 10, dangerTime: 3 });
  const near = makeBody(game, 1, 200, 125, { age: 10 });
  const safe = makeBody(game, 2, 300, 300, { age: 10, dangerTime: 2 });
  game.bodies = [top, near, safe]; game.over = true; game.overTimer = 3; game.score = 1000;
  const before = snapshot(game);
  applyFishProp(game, 'revive', []);
  assert.deepEqual(game.bodies.map(x => x.id), [safe.id]);
  assert.equal(game.over, false); assert.equal(game.overTimer, 0); assert.equal(safe.dangerTime, 0);
  const after = snapshot(game);
  for (const key of ['score', 'randomState', 'variantState', 'nextLevel', 'currentLevel', 'stepIndex']) assert.deepEqual(after[key], before[key]);
  assert.throws(() => applyFishProp(game, 'revive', []));
  assert.throws(() => validatePropBodies(after, 'revive', []));
  assert.throws(() => validatePropBodies(before, 'revive', [safe.id]));
  assert.equal(validatePropInput({ run_id: 'run', step: 0, moves: [], request_id: 'revive-0001', kind: 'revive', body_ids: [], confirm_quota: 5000 }).kind, 'revive');
  for (let i = 0; i < 240; i++) stepGame(game, 1 / 60);
  assert.equal(game.over, false);
});
