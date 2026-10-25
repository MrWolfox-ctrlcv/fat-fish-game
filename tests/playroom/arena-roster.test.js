import test from "node:test";
import assert from "node:assert/strict";
import { createGame, stepArena } from "../../playroom/src/modes/bumper.js";
import { ROSTER } from "../../playroom/src/arena-roster.js";
import { decideBotInput } from "../../playroom/src/arena-bots.js";
import { drawAvatar, loadArt } from "../../playroom/src/art.js";

test("room fills six slots with distinct roster characters and marks humans", () => {
  const g = createGame({ seed: 11, humanIds: [0, 2], humanCharacters: { 0: "gptNormal", 2: "kimi" } });
  assert.equal(g.fighters.length, 6);
  assert.deepEqual(g.fighters.filter((f) => f.isHuman).map((f) => f.id), [0, 2]);
  assert.equal(g.fighters[0].characterId, "gptNormal");
  assert.equal(g.fighters[2].characterId, "kimi");
  assert.equal(new Set(g.fighters.map((f) => f.characterId)).size, 6);
  assert.equal(ROSTER.length, 11);
});

test("stepArena moves every human from its own input while bots remain autonomous", () => {
  const g = createGame({ seed: 12, humanIds: [0, 1] });
  const a = g.fighters[0], b = g.fighters[1], bot = g.fighters[2];
  const by = b.y;
  stepArena(g, { 0: { moveX: 1 }, 1: { moveY: 1 } }, 1 / 30);
  assert.ok(a.x > 640);
  assert.ok(b.y > by);
  assert.ok(bot.x !== 640 || bot.y !== 450);
});

test("bot brain decisions are character-specific and repeatable with a seeded random stream", () => {
  const make = (id) => {
    const g = createGame({ seed: 13, humanIds: [0], humanCharacters: { 0: "qwen" }, botCharacters: { 1: id } });
    const f = g.fighters[1]; Object.assign(f, { x: 820, y: 450, vx: 0, vy: 0 });
    return g;
  };
  const steady = make("deepseek"), silly = make("gptSilly"), astra = make("astra");
  const sequence = (g) => { let x = 123; return () => ((x = (x * 48271) % 2147483647) / 2147483647); };
  const a = decideBotInput(steady, steady.fighters[1], sequence(steady));
  const b = decideBotInput(silly, silly.fighters[1], sequence(silly));
  const c = decideBotInput(astra, astra.fighters[1], sequence(astra));
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("counter, patient, orbital, aggressive and distracted brains react differently to a charging rival", () => {
  const decide = (characterId) => {
    const g = createGame({ seed: 22, humanIds: [0], humanCharacters: { 0: "gptNormal" }, botCharacters: { 1: characterId } });
    const bot = g.fighters[1], rival = g.fighters[0];
    for (const other of g.fighters.slice(2)) other.alive = false;
    Object.assign(bot, { x: 500, y: 450, vx: 0, vy: 0, dashCooldown: 0 });
    Object.assign(rival, { x: 650, y: 450, dashTimer: 0.18, dashX: -1, dashY: 0, vx: 0, vy: 0 });
    return decideBotInput(g, bot, () => 0);
  };
  const claude = decide("claude");
  const kimi = decide("kimi");
  const qwen = decide("qwen");
  const grok = decide("grok");
  const doubao = decide("doubao");
  assert.ok(claude.moveX < 0 && claude.primary, "Claude backs off and counters the incoming dash");
  assert.ok(kimi.moveY > 0.6 && kimi.primary, "Kimi circles, then counters patiently");
  assert.ok(qwen.moveY > kimi.moveY, "Qwen takes a stronger perpendicular line");
  assert.ok(grok.moveX > 0.98 && grok.primary, "Grok leads the chase and attacks eagerly");
  assert.ok(Math.hypot(doubao.moveX, doubao.moveY) < 0.2, "Doubao sometimes hesitates with a weak input");
});

test("arena portrait keys stay separate from canonical wardrobe skins", () => {
  const legacy = { label: "canonical" }, portrait = { label: "new portrait" }, drawn = [];
  const ctx = new Proxy({}, { get(_target, key) { return key === "drawImage" ? (image) => drawn.push(image) : () => {}; } });
  const art = { deepseek: legacy, "portrait:deepseek": portrait };
  drawAvatar(ctx, art, "deepseek", 0, 0, 20);
  drawAvatar(ctx, art, "portrait:deepseek", 0, 0, 20);
  assert.deepEqual(drawn, [legacy, portrait]);
});

test("default art load includes the full local arena roster alongside legacy sprites", async () => {
  const previousImage = globalThis.Image, previousLocation = globalThis.location;
  const requested = [];
  globalThis.location = { pathname: "/" };
  globalThis.Image = class {
    set src(value) { this.url = value; requested.push(value); queueMicrotask(() => this.onload?.()); }
  };
  try {
    const art = await loadArt();
    for (const id of ["deepseek", "gptNormal", "claude", "gemini", "doubao", "qwen", "kimi", "grok"])
      assert.ok(art[`portrait:${id}`], `${id} portrait requested at startup`);
    assert.ok(art.deepseek && art.gptSilly && art.fakeClaude, "legacy starter sprites remain available");
    assert.ok(requested.includes("/portraits/deepseek.png"));
  } finally {
    if (previousImage === undefined) delete globalThis.Image; else globalThis.Image = previousImage;
    if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation;
  }
});
