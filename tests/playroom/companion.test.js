import test from "node:test";
import assert from "node:assert/strict";
import {
  canUseCompanion,
  createCompanion,
  createCompanionRateLimit,
  createRequestGuard,
  makeCompanionPayload,
  makeCompanionPolicy,
} from "../../playroom/src/companion.js";
import { makeBumperScene } from "../../playroom/src/companion-scene.js";
import * as bumper from "../../playroom/src/modes/bumper.js";
import { normalizeCompanionInput } from "../../backend/companion.mjs";

class ElementStub {
  listeners = new Map();
  disabled = false;
  checked = false;
  value = "";
  textContent = "";
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
  dispatch(type, event = {}) {
    for (const callback of this.listeners.get(type) || [])
      callback({ preventDefault() {}, stopPropagation() {}, ...event });
  }
}

test("chooses concrete high priority events, keeps legacy milestones, and ends once", () => {
  const policy = makeCompanionPolicy();
  assert.equal(
    policy.choose(
      [{ type: "hit" }, { type: "dash" }, { type: "kill", victimId: 1 }],
      0,
    ),
    null,
  );
  assert.equal(policy.choose([{ type: "kill", victimId: 2 }], 1), null);
  assert.equal(
    policy.choose([{ type: "kill", victimId: 3 }], 2).event,
    "milestone",
  );
  assert.equal(
    policy.choose([{ type: "level", level: 4 }], 3).event,
    "new_level",
  );
  const selected = policy.choose(
    [
      { type: "death_streak", id: "d", count: 2 },
      { type: "double_kill", id: "k", count: 2 },
    ],
    4,
  );
  assert.equal(selected.event, "death_streak");
  assert.deepEqual(selected.detail, { count: 2 });
  assert.equal(policy.choose([{ type: "end" }], 5).event, "end");
  assert.equal(policy.choose([{ type: "kill" }]), null);
});

test("queues only the highest priority event during cooldown and expires old events", () => {
  const policy = makeCompanionPolicy();
  assert.equal(
    policy.choose(
      [{ type: "new_easter", variant: "gold", id: "egg" }],
      100,
      false,
    ),
    null,
  );
  policy.choose([{ type: "survivor", id: "s" }], 101, false);
  assert.equal(policy.pending.event, "new_easter");
  assert.deepEqual(policy.choose([], 102, true), {
    event: "new_easter",
    detail: { variant: "gold" },
  });
  policy.choose([{ type: "survivor", id: "old" }], 200, false);
  assert.equal(policy.choose([], 8201, true), null);
});

test("deduplicates repeated events and counts only two player falls for a death streak", () => {
  const policy = makeCompanionPolicy();
  const double = { type: "double_kill", id: "double:2", count: 2 };
  assert.equal(policy.choose([double], 10).event, "double_kill");
  assert.equal(policy.choose([double], 11), null);
  assert.equal(
    policy.choose(
      [{ type: "fall", id: 1, fallCount: 1, playerFall: false }],
      12,
    ),
    null,
  );
  assert.equal(
    policy.choose(
      [{ type: "fall", id: 0, fallCount: 1, playerFall: true }],
      13,
    ),
    null,
  );
  assert.deepEqual(
    policy.choose(
      [{ type: "fall", id: 0, fallCount: 2, playerFall: true }],
      14,
    ),
    { event: "death_streak", detail: { count: 2 } },
  );
});

test("nested fish tracker detail and bounded fish scene pass the real backend normalizer", () => {
  const policy = makeCompanionPolicy();
  const levelChoice = policy.choose(
    [{ type: "new_level", detail: { level: 9 } }],
    1,
  );
  const levelPayload = makeCompanionPayload("fat-fish", levelChoice, {
    score: 90,
    level: 9,
    elapsed: 40,
    scene: {
      balls: [
        { level: 9, x: 320, y: 500, variant: null },
        { level: 8, x: 420, y: 400, variant: "gemini" },
      ],
      ball_count: 2,
      stack_height: 600,
      danger: true,
      highest_level: 9,
    },
  });
  assert.deepEqual(levelPayload.detail, { level: 9 });
  assert.deepEqual(
    normalizeCompanionInput(levelPayload).scene,
    levelPayload.scene,
  );

  const easterChoice = policy.choose(
    [{ type: "new_easter", detail: { level: 10, variant: "gemini" } }],
    2,
  );
  const easterPayload = makeCompanionPayload("fat-fish", easterChoice, {
    level: 10,
  });
  assert.deepEqual(easterPayload.detail, { level: 10, variant: "gemini" });
  assert.deepEqual(
    normalizeCompanionInput(easterPayload).detail,
    easterPayload.detail,
  );
});

test("end remains pending through cooldown, then delivers once within its short window", () => {
  const policy = makeCompanionPolicy();
  assert.equal(policy.choose([{ type: "end" }], 100, false), null);
  assert.equal(policy.pending.event, "end");
  assert.deepEqual(policy.choose([], 200, true), { event: "end", detail: {} });
  assert.equal(policy.choose([], 201, true), null);
});

test("automatic requests keep a three call per-game cap across policy updates", () => {
  const policy = makeCompanionPolicy();
  assert.equal(policy.canSendAuto(), true);
  policy.recordAuto();
  policy.recordAuto();
  policy.recordAuto();
  assert.equal(policy.canSendAuto(), false);
  policy.reset();
  assert.equal(policy.autoCalls, 0);
  assert.equal(policy.canSendAuto(), true);
});

test("manual and automatic requests share a 20 second cooldown and in-flight lock across resets", () => {
  const rate = createCompanionRateLimit();
  const first = rate.begin(100_000);
  assert.equal(first, 1);
  assert.equal(rate.canAttempt(130_000), false);
  rate.finish(first);
  assert.equal(rate.canAttempt(119_999), false);
  assert.equal(rate.remainingSeconds(119_999), 1);
  assert.equal(rate.canAttempt(120_000), true);
  const next = rate.begin(120_000);
  assert.equal(rate.begin(140_000), false);
  rate.finish(next);
  assert.equal(rate.canAttempt(140_000), true);
});

test("disabled configuration gates usage and payload contains only approved summary fields", () => {
  assert.equal(canUseCompanion({ enabled: false }, true), false);
  assert.equal(canUseCompanion({ enabled: true }, false), false);
  assert.equal(canUseCompanion({ enabled: true }, true), true);
  const payload = makeCompanionPayload("survival", "milestone", {
    score: 12,
    level: 7,
    elapsed: 31,
    playerName: "private",
    x: 12,
  });
  assert.deepEqual(payload, {
    game: "survival",
    event: "milestone",
    score: 12,
    level: 7,
    elapsed: 31,
  });
  const scenePayload = makeCompanionPayload(
    "bumper",
    { event: "kill_streak", detail: { count: 3 } },
    {
      scene: {
        player: {
          x: 20,
          y: 30,
          alive: true,
          dash_ready: true,
          edge_distance: 50,
          kills: 3,
          falls: 0,
          rank: 1,
        },
        opponents: [{ x: 3, y: 4, alive: false }],
        arena_radius: 390,
        remaining: 20,
        screenshot: "secret",
      },
    },
  );
  assert.equal(scenePayload.scene.player.x, 20);
  assert.equal(scenePayload.scene.screenshot, undefined);
  assert.deepEqual(scenePayload.detail, { count: 3 });
});

test("bumper scene snapshot has bounded world coordinates and excludes names", () => {
  const game = bumper.createGame();
  game.player.x = 600;
  game.player.y = 400;
  const scene = makeBumperScene(game);
  assert.deepEqual(Object.keys(scene.player).sort(), [
    "alive",
    "dash_ready",
    "edge_distance",
    "falls",
    "kills",
    "rank",
    "x",
    "y",
  ]);
  assert.equal(scene.player.x, 600);
  assert.equal(scene.opponents.length, 5);
  assert.equal("name" in scene.opponents[0], false);
});

test("bumper identifies player falls and emits survivor after 30 seconds", () => {
  const game = bumper.createGame();
  game.time = 29.99;
  const survivorEvents = bumper.stepGame(game, {}, 1 / 60);
  assert.equal(
    survivorEvents.some((event) => event.type === "survivor"),
    true,
  );
  game.player.x = 1200;
  const fallEvents = bumper.stepGame(game, {}, 1 / 60);
  assert.equal(
    fallEvents.some(
      (event) => event.type === "fall" && event.playerFall && event.id === 0,
    ),
    true,
  );
  assert.equal(
    fallEvents.some((event) => event.type === "fall" && !event.playerFall),
    false,
  );
});

test("request generation invalidates stale responses after reset or opt-out", () => {
  const guard = createRequestGuard();
  const pending = guard.begin();
  assert.equal(guard.isCurrent(pending), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(pending), false);
  const next = guard.begin();
  assert.equal(guard.isCurrent(next), true);
});

test("delayed config GET still enables the real panel after game reset", async () => {
  const elements = new Map([
    ["[data-companion-status]", new ElementStub()],
    ["[data-companion-output]", new ElementStub()],
    ["[data-companion-form]", new ElementStub()],
    ["[data-companion-input]", new ElementStub()],
    ["[data-companion-enable]", new ElementStub()],
    ["[data-companion-refresh]", new ElementStub()],
  ]);
  const sendButton = new ElementStub();
  elements.get("[data-companion-form]").querySelector = () => sendButton;
  const container = new ElementStub();
  container.querySelector = (selector) => elements.get(selector);
  let resolveGet;
  const getResponse = new Promise((resolve) => {
    resolveGet = resolve;
  });
  const companion = createCompanion({
    container,
    endpoint: "/api/companion",
    gameId: "bumper",
    getSnapshot: () => ({}),
    fetchImpl: () => getResponse,
  });

  companion.reset();
  resolveGet({
    ok: true,
    json: async () => ({
      success: true,
      enabled: true,
      limits: {
        cooldown_seconds: 20,
        daily_per_user: 20,
        global_daily: 100,
        max_message: 160,
      },
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));

  const enable = elements.get("[data-companion-enable]");
  const input = elements.get("[data-companion-input]");
  assert.equal(enable.disabled, false);
  assert.match(elements.get("[data-companion-status]").textContent, /服务可用/);
  enable.checked = true;
  enable.dispatch("change");
  assert.equal(input.disabled, false);
  assert.equal(sendButton.disabled, false);
  companion.destroy();
});
