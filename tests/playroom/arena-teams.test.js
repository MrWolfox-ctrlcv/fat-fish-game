import test from "node:test";
import assert from "node:assert/strict";
import { balanceHumanTeams, getCharacterFaction, getTeamLabel } from "../../playroom/src/arena-teams.js";
import { createGame, getHud, getTeamStandings, stepArena } from "../../playroom/src/modes/bumper.js";

const F = 1 / 60;

test("faction map and strict team choices balance human seats", () => {
  assert.equal(getCharacterFaction("deepseek"), 0);
  assert.equal(getCharacterFaction("astra"), 1);
  assert.equal(getTeamLabel(0), "国模队");
  assert.equal(getTeamLabel(1), "美模队");
  assert.deepEqual(balanceHumanTeams([0, 1, 2, 3], { 0: 1, 1: null }), { 0: 1, 1: 0, 2: 0, 3: 1 });
  assert.deepEqual(balanceHumanTeams([0, 1], {}, 1), { 0: 0, 1: 1 });
});

test("team game balances humans, fills both factions to three, and keeps shared physics", () => {
  const g = createGame({ mode: "teams", seed: 7, humanIds: [0, 1], humanTeams: { 0: 1, 1: 1 } });
  assert.deepEqual(g.fighters.slice(0, 2).map((f) => f.teamId), [1, 1]);
  assert.equal(g.fighters.filter((f) => f.teamId === 0).length, 3);
  assert.equal(g.fighters.filter((f) => f.teamId === 1).length, 3);
  for (const f of g.fighters) {
    assert.equal(getCharacterFaction(f.characterId), f.teamId);
    assert.deepEqual([f.r, f.mass, f.speed, f.dashSpeed, f.dashDuration], [26, 1, 225, 620, 0.22]);
  }
  assert.deepEqual(getHud(g).teamScores, [0, 0]);
});

test("team character picks cannot mismatch the selected faction", () => {
  const g = createGame({ mode: "teams", humanIds: [0, 1], humanTeams: { 0: 0, 1: 1 }, humanCharacters: { 0: "astra", 1: "deepseek" } });
  assert.deepEqual(g.fighters.slice(0, 2).map((f) => f.characterId), ["deepseek", "gptNormal"]);
});

test("team bots target enemies even when a closer ally is present", () => {
  const g = createGame({ mode: "teams", seed: 8, humanIds: [0, 1], humanTeams: { 0: 0, 1: 1 }, botCharacters: { 2: "deepseek" } });
  const bot = g.fighters[2], ally = g.fighters[3], enemy = g.fighters[1];
  Object.assign(bot, { x: 500, y: 450 });
  Object.assign(ally, { alive: true, teamId: bot.teamId, x: 510, y: 450 });
  for (const f of g.fighters) if (![bot, ally, enemy].includes(f)) f.alive = false;
  Object.assign(enemy, { alive: true, x: 750, y: 500, vx: 0, vy: 0 });
  g.fighters[0].teamId = 1;
  const events = stepArena(g, {}, F);
  assert.ok(!events.some((event) => event.type === "dash" && event.id === bot.id && event.x === ally.x));
  assert.ok(bot.x > 500 || bot.y !== 450, "bot advances toward the opposing faction");
});

test("enemy kills score personally and for the team; friendly falls penalize without a kill", () => {
  const g = createGame({ mode: "teams", seed: 9, humanIds: [0, 1], humanTeams: { 0: 0, 1: 1 } });
  const [attacker, victim] = g.fighters;
  g.time = 5;
  Object.assign(victim, { x: 1135, y: 450, vx: 0, vy: 0, lastHitBy: attacker.id, lastHitAt: g.time });
  let events = stepArena(g, {}, F);
  assert.equal(attacker.kills, 1);
  assert.equal(g.teamScores[0], 1);
  assert.equal(events.find((e) => e.type === "kill")?.teamScoreDelta, 1);

  const teammate = g.fighters[2];
  teammate.teamId = victim.teamId;
  g.botState.think = 10;
  Object.assign(victim, { alive: true, x: 1135, y: 450, vx: 0, vy: 0, lastHitBy: teammate.id, lastHitAt: g.time });
  const beforeKills = teammate.kills;
  events = stepArena(g, {}, F);
  assert.equal(teammate.kills, beforeKills);
  assert.equal(teammate.friendlyKills, 1);
  assert.equal(g.teamScores[victim.teamId], -1);
  assert.equal(events.find((e) => e.type === "friendly-fire")?.teamScoreDelta, -1);
  assert.equal(events.find((e) => e.type === "friendly-fire")?.victimId, victim.id);
});

test("uncredited falls cost the victim team; team standings tie and end as a draw", () => {
  const g = createGame({ mode: "teams", seed: 10, humanIds: [0, 1], humanTeams: { 0: 0, 1: 1 } });
  const victim = g.fighters[0];
  Object.assign(victim, { x: 1135, y: 450, vx: 0, vy: 0, lastHitBy: null });
  let events = stepArena(g, {}, F);
  assert.equal(g.teamScores[0], -1);
  assert.equal(events.find((e) => e.type === "fall")?.teamScoreDelta, -1);
  g.teamScores = [2, 2];
  assert.deepEqual(getTeamStandings(g).map((r) => r.rank), [1, 1]);
  g.time = g.duration - F;
  events = stepArena(g, {}, F);
  assert.equal(g.phase, "draw");
  assert.equal(g.teamWinnerId, null);
  assert.ok(events.some((e) => e.type === "end" && e.draw));
});
