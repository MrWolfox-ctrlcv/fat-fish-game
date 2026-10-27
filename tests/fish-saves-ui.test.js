import test from "node:test";
import assert from "node:assert/strict";
import { createGame, makeBody } from "../dist/game.js";
import { hydrateGameState, LOCAL_CHEAT_SAVE_KEY, serializeGameState, validateGameState } from "../dist/fish-saves-ui.js";

test("serialized saves preserve fish and seeded random state when available", () => {
  const game = createGame({ random: Object.assign(() => 0.4, { getState: () => 23 }), variantRandom: Object.assign(() => 0.8, { getState: () => 29 }) });
  game.bodies.push(makeBody(game, 3, 100, 300, { vx: 1.5 }));
  game.stepIndex = 14;
  const state = serializeGameState(game);
  assert.equal(state.randomState, 23);
  assert.equal(state.variantState, 29);
  const hydrated = hydrateGameState(state);
  assert.equal(hydrated.bodies[0].level, 3);
  assert.equal(hydrated.bodies[0].vx, 1.5);
  assert.ok(hydrated.unlocked instanceof Set);
  assert.ok(hydrated.random.getState());
});

test("save validation rejects oversized, malformed, invalid-level, and non-finite body data", () => {
  assert.throws(() => validateGameState(" ".repeat(256 * 1024 + 1)), /256 KB/);
  assert.throws(() => validateGameState("{"), /损坏/);
  const valid = serializeGameState(createGame());
  assert.throws(() => validateGameState({ ...valid, currentLevel: 12 }), /结构或鱼等级/);
  assert.throws(() => validateGameState({ ...valid, bodies: [{ ...makeBody(createGame(), 1, 20, 20), x: Infinity }] }), /鱼数据/);
});

test("local cheat saves use a dedicated local-only storage key", () => {
  assert.equal(LOCAL_CHEAT_SAVE_KEY, "local-cheat-save-v1");
});
