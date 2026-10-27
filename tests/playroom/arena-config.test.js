import test from "node:test";
import assert from "node:assert/strict";
import { ARENA_CHARACTER_IDS, normalizeArenaConfig } from "../../playroom/src/arena-config.js";
import { createGame } from "../../playroom/src/modes/bumper.js";

test("arena settings preserve six-player bot-filled defaults and normalize an empty bot pool", () => {
  assert.deepEqual(normalizeArenaConfig(), { maxPlayers: 6, fillBots: true, botRoster: [...ARENA_CHARACTER_IDS] });
  assert.deepEqual(normalizeArenaConfig({ maxPlayers: 2, fillBots: false, botRoster: [] }), {
    maxPlayers: 2, fillBots: false, botRoster: [...ARENA_CHARACTER_IDS],
  });
});

test("strict settings validation rejects invalid bounds, team counts, and roster input", () => {
  assert.throws(() => normalizeArenaConfig({ maxPlayers: 7 }, { strict: true }), { code: "invalid_settings" });
  assert.throws(() => normalizeArenaConfig({ mode: "teams", maxPlayers: 3 }, { strict: true }), { code: "invalid_settings" });
  assert.throws(() => normalizeArenaConfig({ botRoster: "deepseek" }, { strict: true }), { code: "invalid_bot_roster" });
  assert.throws(() => normalizeArenaConfig({ botRoster: ["unknown"] }, { strict: true }), { code: "invalid_bot_roster" });
  assert.throws(() => normalizeArenaConfig({ mode: "teams", botRoster: ["deepseek"] }, { strict: true }), { code: "invalid_bot_roster" });
});

test("engine honors player count, bot fill, roster limits, factions, and sparse human ids", () => {
  const two = createGame({ maxPlayers: 2, fillBots: true, humanIds: [0] });
  assert.equal(two.fighters.length, 2);
  const humansOnly = createGame({ maxPlayers: 4, fillBots: false, humanIds: [0, 3] });
  assert.deepEqual(humansOnly.fighters.map((f) => f.id), [0, 3]);
  assert.ok(humansOnly.fighters.every((f) => f.isHuman));
  const sparsePair = createGame({ maxPlayers: 2, fillBots: false, humanIds: [2, 5] });
  assert.deepEqual(sparsePair.fighters.map((f) => f.id), [2, 5], "sparse human seat IDs remain unchanged");
  assert.throws(() => createGame({ maxPlayers: 2, humanIds: [0, 3, 5] }), RangeError);
  assert.throws(() => createGame({ mode: "teams", maxPlayers: 2, humanIds: [0, 3, 5] }), RangeError);
  const cappedTeams = createGame({ mode: "teams", maxPlayers: 2, humanIds: [2, 5], humanTeams: { 2: 0, 5: 0 }, botRoster: ["deepseek", "gptNormal"] });
  assert.deepEqual(cappedTeams.fighters.map((f) => [f.id, f.teamId]), [[2, 0], [5, 1]]);
  const repeated = createGame({ maxPlayers: 4, fillBots: true, humanIds: [0], botRoster: ["deepseek"] });
  assert.equal(repeated.fighters.length, 4);
  assert.ok(repeated.fighters.slice(1).every((f) => f.characterId === "deepseek"));
  const teams = createGame({ mode: "teams", maxPlayers: 4, humanIds: [0, 2], humanTeams: { 0: 0, 2: 1 }, botRoster: ["deepseek", "gptNormal"] });
  assert.deepEqual(teams.fighters.map((f) => f.teamId).sort(), [0, 0, 1, 1]);
  assert.ok(teams.fighters.every((f) => teams.botRoster.includes(f.characterId)));
});
