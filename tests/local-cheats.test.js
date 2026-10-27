import test from "node:test";
import assert from "node:assert/strict";
import { isLocalCheatAllowed, chooseAutoDropX } from "../dist/local-cheats.js";
import { createGame, makeBody, mergeBodiesInLocalMode } from "../dist/game.js";

test("cheat mode requires an explicit flag on loopback hosts", () => {
  for (const hostname of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
    assert.equal(isLocalCheatAllowed({ hostname, search: "?cheat=1" }), true);
    assert.equal(isLocalCheatAllowed({ hostname, search: "?cheat=0" }), false);
  }
  for (const hostname of ["example.com", "192.168.1.2"]) {
    assert.equal(isLocalCheatAllowed({ hostname, search: "?cheat=1" }), false);
  }
  assert.equal(isLocalCheatAllowed({ hostname: "localhost", search: "" }), false);
});

test("automatic drop targets the lowest same-level fish and clamps the position", () => {
  const game = { width: 480, bodies: [{ level: 2, x: 40, y: 200 }, { level: 2, x: 410, y: 500 }, { level: 3, x: 100, y: 700 }] };
  assert.equal(chooseAutoDropX(game, 2), 410);
  assert.equal(chooseAutoDropX(game, 1), 240);
  assert.equal(chooseAutoDropX({ width: 480, bodies: [{ level: 4, x: -80, y: 1 }] }, 4), 30);
});

test("local merge tool keeps score and unlocks consistent and rejects top-level fish", () => {
  const game = createGame({ random: () => 0.1, variantRandom: () => 0.99 });
  const a = makeBody(game, 4, 150, 500), b = makeBody(game, 4, 230, 500);
  game.bodies.push(a, b);
  const merged = mergeBodiesInLocalMode(game, a.id, b.id);
  assert.equal(merged.level, 5);
  assert.equal(game.bodies.length, 1);
  assert.equal(game.score, 60);
  assert.equal(game.unlocked.has(5), true);
  const topA = makeBody(game, 11, 150, 500), topB = makeBody(game, 11, 230, 500);
  game.bodies.push(topA, topB);
  assert.equal(mergeBodiesInLocalMode(game, topA.id, topB.id), null);
});
