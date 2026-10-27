import test from "node:test";
import assert from "node:assert/strict";
import { applyFishProp, awardForLevel, createGame, dropBody, easterUnlocksFor, ensureAdminCampaigns, formatRewardExpiry, formatRewardQuota, galleryUnlocksFor, getRegisteredEasterImage, isInvalidRunError, makeBody, MAX_LEVEL, radiusForLevel, registerEasterImage, stepGame, toNumericCandidateIds } from "../dist/game.js";
import { EASTER_EGGS, EASTER_STAGE_COUNT, getAllowedVariants, getEasterImageKey, isEasterEggId, rollEasterVariant, STAGE_VARIANTS } from "../dist/easter-eggs.js";
import { OnlineApiError } from "../dist/online-client.js";

const fixedRandom = () => 0;

test("付费道具移除指定鱼，并可从失败状态救场而不立刻再次失败", () => {
  const game = createGame({ random: fixedRandom, variantRandom: fixedRandom });
  const target = makeBody(game, 2, 100, 120, { dangerTime: 1.2 });
  const survivor = makeBody(game, 3, 200, 130, { dangerTime: 1.4 });
  game.bodies.push(target, survivor);
  game.over = true;
  game.overTimer = 2;
  const result = applyFishProp(game, "remove", [target.id]);
  assert.deepEqual(game.bodies.map((body) => body.id), [survivor.id]);
  assert.equal(game.over, false);
  assert.equal(game.overTimer, 0);
  assert.equal(survivor.dangerTime, 0);
  assert.equal(result.kind, "remove");
  assert.equal(result.summary.over, false);
});

test("付费道具同级合成复用合成分数、等级解锁和彩蛋随机状态", () => {
  const game = createGame({ random: fixedRandom, variantRandom: fixedRandom });
  const first = makeBody(game, 4, 140, 180);
  const second = makeBody(game, 4, 210, 180);
  const other = makeBody(game, 2, 300, 180);
  game.bodies.push(first, second, other);
  const result = applyFishProp(game, "merge", [first.id, second.id]);
  assert.deepEqual(game.bodies.map((body) => body.id), [other.id, result.resultBodyId]);
  const merged = game.bodies.find((body) => body.id === result.resultBodyId);
  assert.equal(merged.level, 5);
  assert.equal(game.score, 60);
  assert.ok(game.unlocked.has(5));
  assert.equal(result.summary.score, 60);
});

test("付费道具拒绝无效鱼选择且不会修改游戏状态", () => {
  const game = createGame({ random: fixedRandom, variantRandom: fixedRandom });
  const first = makeBody(game, 4, 100, 140);
  const second = makeBody(game, 5, 180, 140);
  const max = makeBody(game, MAX_LEVEL, 260, 140);
  game.bodies.push(first, second, max);
  const before = game.bodies.map((body) => body.id);
  assert.throws(() => applyFishProp(game, "remove", [999]), RangeError);
  assert.throws(() => applyFishProp(game, "merge", [first.id, second.id]), RangeError);
  assert.throws(() => applyFishProp(game, "merge", [max.id, max.id]), RangeError);
  assert.throws(() => applyFishProp(game, "unknown", [first.id]), RangeError);
  assert.deepEqual(game.bodies.map((body) => body.id), before);
});

test("谢礼额度和 Unix 到期时间按用户格式显示，库存错误不误报游戏局失效", () => {
  assert.equal(formatRewardQuota(1000000), "2");
  assert.equal(formatRewardQuota(750000), "1.5");
  assert.equal(formatRewardQuota(51200), "0.1024");
  assert.equal(formatRewardExpiry(1700000000), new Date(1700000000000).toLocaleString("zh-CN"));
  assert.equal(isInvalidRunError(new OnlineApiError("库存不足", { status: 409, code: "CAMPAIGN_EMPTY" })), false);
  assert.equal(isInvalidRunError(new OnlineApiError("游戏记录失效", { status: 409, code: "RUN_EXPIRED" })), true);
});

test("空奖池列表保留可导入的默认活动，管理员奖品 ID 转换为数字", () => {
  assert.deepEqual(ensureAdminCampaigns([]), [{
    id: "first-fat-fish-6", title: "首次合成谢礼", min_level: 6, remaining: 0, total: 0, isDefault: true,
  }]);
  const campaigns = ensureAdminCampaigns([{ id: "other", title: "已有活动", min_level: 4 }]);
  assert.equal(campaigns.at(-1).id, "first-fat-fish-6");
  assert.deepEqual(toNumericCandidateIds(new Map([
    ["17", { checkbox: { checked: true } }],
    ["42", { checkbox: { checked: false } }],
    ["bad-id", { checkbox: { checked: true } }],
  ])), [17]);
});

test("对局素材许可不会扩展访客的账户图鉴", () => {
  const history = { unlocked: [1, 4], egg_stages: ["gpt-normal:4"] };
  assert.deepEqual(galleryUnlocksFor(null, history), [1]);
  assert.deepEqual(easterUnlocksFor(null, history), []);
  assert.deepEqual(galleryUnlocksFor({ id: 9 }, history), [1, 4]);
  assert.deepEqual(easterUnlocksFor({ id: 9 }, history), ["gpt-normal:4"]);
});

test("投放会消耗当前预览、推进下一只，并把落点限制在墙内", () => {
  const game = createGame({ random: fixedRandom });
  game.currentLevel = 2;
  game.nextLevel = 3;
  const dropped = dropBody(game, -100);
  assert.equal(dropped.level, 2);
  assert.equal(dropped.x, dropped.r + 6);
  assert.equal(game.currentLevel, 3);
  assert.equal(dropBody(game, 240), null, "投放冷却期间忽略重复输入");
});

test("投放的彩蛋与当前预览一致，并记录本局遇见", () => {
  const game = createGame({ random: fixedRandom });
  game.currentVariant = "gpt-normal";
  game.nextVariant = "deepseek-claude";
  const dropped = dropBody(game, 240);
  assert.equal(dropped.variant, "gpt-normal");
  assert.equal(game.seenEggs.has("gpt-normal"), true);
  assert.equal(game.currentVariant, "deepseek-claude");
});

test("同级相遇只生成高一级并且只计一次分", () => {
  const game = createGame({ random: fixedRandom });
  game.bodies.push(makeBody(game, 2, 160, 300, { age: 2 }), makeBody(game, 2, 200, 300, { age: 2 }));
  const { merged } = stepGame(game, 1 / 60);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].level, 3);
  assert.equal(game.bodies.length, 1);
  assert.equal(game.score, awardForLevel(3));
});

test("不同彩蛋外观的同级鱼仍可合成，得分只由等级决定", () => {
  const game = createGame({ random: fixedRandom });
  game.bodies.push(
    makeBody(game, 2, 160, 300, { age: 2, variant: "gpt-silly" }),
    makeBody(game, 2, 200, 300, { age: 2, variant: "super-whale" }),
  );
  const { merged } = stepGame(game, 1 / 60);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].level, 3);
  assert.equal(game.score, awardForLevel(3));
});

test("彩蛋外观按精确等级绑定，稀有率按阶段区间生效", () => {
  assert.deepEqual(Object.values(STAGE_VARIANTS), [
    "gpt-silly", "gpt-silly", "gpt-silly", "gpt-normal", "deepseek-claude",
    "gpt-normal", "deepseek-claude", "super-whale", "super-whale", "super-whale", "super-whale",
  ]);
  for (let level = 1; level <= 10; level++) assert.equal(rollEasterVariant(level, () => 0), STAGE_VARIANTS[level]);
  assert.equal(rollEasterVariant(11, () => 0.999), "super-whale");
  for (const level of [1, 2, 3]) assert.equal(rollEasterVariant(level, () => 0.03), null);
  for (const level of [4, 5, 6, 7]) assert.equal(rollEasterVariant(level, () => 0.04), null);
  for (const level of [8, 9, 10]) assert.equal(rollEasterVariant(level, () => 0.03), null);
  assert.equal(EASTER_EGGS.find((egg) => egg.id === "gpt-silly").previewLevel, 3);
  assert.equal(EASTER_EGGS.find((egg) => egg.id === "gpt-normal").previewLevel, 6);
  assert.equal(EASTER_EGGS.find((egg) => egg.id === "deepseek-claude").previewLevel, 7);
  assert.equal(EASTER_EGGS.find((egg) => egg.id === "super-whale").previewLevel, 11);
  assert.equal(EASTER_EGGS.find((egg) => egg.id === "gpt-astra").previewLevel, 10);
});

test("Astra 只在 9 到 11 级合成时以 2% 边界出现", () => {
  assert.equal(rollEasterVariant(8, () => 0, "merge"), "super-whale");
  for (const level of [9, 10, 11]) {
    assert.equal(rollEasterVariant(level, () => 0.019, "merge"), "gpt-astra");
  }
  assert.equal(rollEasterVariant(9, () => 0, "spawn"), "super-whale", "投放不会抽到 Astra");
  for (const level of [9, 10]) {
    let calls = 0;
    assert.equal(rollEasterVariant(level, () => calls++ === 0 ? 0.02 : 0.03, "merge"), null);
  }
  assert.equal(rollEasterVariant(11, () => 0.02, "merge"), "super-whale");
  assert.ok(EASTER_EGGS.some((egg) => egg.id === 'gpt-astra'));
});

test('豆包与 Gemini 各有固定阶段造型，分摊原有彩蛋概率', () => {
  assert.equal(EASTER_STAGE_COUNT, 20);
  for (const level of [2, 4, 6]) assert.equal(getEasterImageKey('doubao', level), `doubao:${level}`);
  for (const level of [3, 5, 7]) assert.equal(getEasterImageKey('gemini', level), `gemini:${level}`);
  assert.equal(getEasterImageKey('doubao', 3), null);
  assert.equal(getEasterImageKey('gemini', 6), null);
  assert.equal(rollEasterVariant(2, () => .015), 'doubao');
  assert.equal(rollEasterVariant(3, () => .015), 'gemini');
  assert.equal(rollEasterVariant(6, () => .02), 'doubao');
  assert.equal(rollEasterVariant(7, () => .02), 'gemini');
  for (let level = 1; level <= 10; level++) {
    let total = 0;
    for (let i = 0; i < 10000; i++) if (rollEasterVariant(level, () => i / 10000)) total++;
    assert.equal(total, level <= 3 ? 300 : level <= 7 ? 400 : 300);
  }
});

test("注册在第 4 级的彩蛋图片不会被第 6 级读取", () => {
  const imageAtFour = { width: 64, height: 64, tag: "normal-4" };
  const imageAtSix = { width: 64, height: 64, tag: "normal-6" };
  registerEasterImage("gpt-normal", imageAtFour, null, 4);
  assert.equal(getRegisteredEasterImage("gpt-normal", 4).image, imageAtFour);
  assert.equal(getRegisteredEasterImage("gpt-normal", 6), null);
  assert.equal(getEasterImageKey("gpt-normal", 5), null);
  assert.deepEqual(getAllowedVariants(9), ["super-whale", "gpt-astra"]);
  registerEasterImage("gpt-normal", imageAtSix, null, 6);
  assert.equal(getRegisteredEasterImage("gpt-normal", 6).image, imageAtSix);
  assert.equal(getRegisteredEasterImage("gpt-normal", 4).image, imageAtFour);
  const astraPreviewImage = { width: 64, height: 64, tag: "astra-preview" };
  registerEasterImage("gpt-astra", astraPreviewImage);
  assert.equal(getRegisteredEasterImage("gpt-astra", 10).image, astraPreviewImage);
  assert.equal(getRegisteredEasterImage("gpt-astra", 9), null, "省略等级时只注册 previewLevel");
  assert.throws(() => registerEasterImage("gpt-astra", astraPreviewImage, null, 8), RangeError);
});

test("彩蛋随机流不会改变正常等级预览序列", () => {
  const makeLevelRandom = () => {
    const rolls = [0.2, 0.75, 0.1, 0.95];
    let index = 0;
    return () => rolls[index++ % rolls.length];
  };
  const plain = createGame({ random: makeLevelRandom(), variantRandom: () => 0.99 });
  const decorated = createGame({ random: makeLevelRandom(), variantRandom: () => 0 });
  assert.equal(plain.currentLevel, decorated.currentLevel);
  assert.equal(plain.nextLevel, decorated.nextLevel);
});

test("未知彩蛋 id 会安全忽略", () => {
  const game = createGame({ random: fixedRandom });
  assert.equal(isEasterEggId("not-a-real-egg"), false);
  assert.equal(makeBody(game, 2, 180, 240, { variant: "not-a-real-egg" }).variant, null);
});

test("三只重叠同级鱼在一个物理步内不会让新鱼连锁重复合成", () => {
  const game = createGame({ random: fixedRandom });
  game.bodies.push(
    makeBody(game, 1, 160, 300, { age: 2 }),
    makeBody(game, 1, 180, 300, { age: 2 }),
    makeBody(game, 1, 200, 300, { age: 2 }),
  );
  const { merged } = stepGame(game, 1 / 60);
  assert.equal(merged.length, 1);
  assert.equal(game.score, awardForLevel(2));
  assert.equal(game.bodies.filter((body) => body.level === 2).length, 1);
  assert.equal(game.bodies.length, 2);
});

test("彼此分开的两对鱼能各自合成一次", () => {
  const game = createGame({ random: fixedRandom });
  game.bodies.push(
    makeBody(game, 2, 80, 300, { age: 2 }), makeBody(game, 2, 120, 300, { age: 2 }),
    makeBody(game, 2, 340, 300, { age: 2 }), makeBody(game, 2, 380, 300, { age: 2 }),
  );
  const { merged } = stepGame(game, 1 / 60);
  assert.equal(merged.length, 2);
  assert.equal(game.score, awardForLevel(3) * 2);
  assert.equal(game.bodies.length, 2);
});

test("第 11 级不再合成", () => {
  const game = createGame({ random: fixedRandom });
  game.bodies.push(makeBody(game, MAX_LEVEL, 180, 300, { age: 2 }), makeBody(game, MAX_LEVEL, 380, 300, { age: 2 }));
  const { merged } = stepGame(game, 1 / 60);
  assert.equal(merged.length, 0);
  assert.equal(game.score, 0);
  assert.equal(game.bodies.length, 2);
  assert.equal(radiusForLevel(MAX_LEVEL), 123);
});

test('近距离同级肥鱼及时靠拢并在真实接触后合成，保留自然滚动', () => {
  const game = createGame({ random: fixedRandom });
  const r = radiusForLevel(2);
  const y = game.height - 9 - r;
  const a = makeBody(game, 2, 180, y);
  const b = makeBody(game, 2, 180 + 2 * r + 8, y);
  game.bodies.push(a, b);
  const center = (a.x + b.x) / 2;
  assert.equal(stepGame(game, 1 / 60).merged.length, 0, '吸附不能隔空直接合成');
  assert.ok(a.vx > 0 && b.vx < 0);
  assert.ok(a.x - 180 < .2, '每步平滑移动，不直接跳到一起');
  assert.ok(Math.abs((a.x + b.x) / 2 - center) < 1e-9);
  for (let i = 0; i < 20; i++) stepGame(game, 1 / 60);
  assert.ok(a.angle > 0 && b.angle < 0, '靠拢过程仍是滚动');
  for (let i = 0; i < 180 && game.score === 0; i++) stepGame(game, 1 / 60);
  assert.equal(game.bodies.length, 1);
  assert.equal(game.bodies[0].level, 3);
  assert.equal(game.score, awardForLevel(3));
});

test('小中大球隔着可见间隙时能在一秒内滚动合成', () => {
  for (const [level, gap] of [[1, 20], [2, 24], [6, 40], [9, 48], [10, 20]]) {
    const game = createGame({ random: fixedRandom });
    const r = radiusForLevel(level);
    const y = game.height - 9 - r;
    const a = makeBody(game, level, 240 - r - gap / 2, y);
    const b = makeBody(game, level, 240 + r + gap / 2, y);
    game.bodies.push(a, b);
    assert.equal(stepGame(game, 1 / 60).merged.length, 0, `等级 ${level} 不能隔空合成`);
    assert.ok(a.vx > 0 && b.vx < 0, `等级 ${level} 应在更大间隙内启动吸附`);
    let frames = 1;
    while (!game.score && frames < 60) { stepGame(game, 1 / 60); frames++; }
    assert.equal(game.bodies.length, 1, `等级 ${level}、间隙 ${gap} 应在一秒内合成`);
    assert.equal(game.bodies[0].level, level + 1);
  }
});

test('不同等级、远距离、合成冷却和封顶肥鱼不受吸附影响', () => {
  for (const scenario of ['different', 'far', 'cooldown', 'max']) {
    const game = createGame({ random: fixedRandom });
    let a, b;
    if (scenario === 'max') {
      a = makeBody(game, MAX_LEVEL, 128, 160);
      b = makeBody(game, MAX_LEVEL, 350, 290);
    } else {
      const otherLevel = scenario === 'different' ? 3 : 2;
      const gap = scenario === 'far' ? 80 : 8;
      a = makeBody(game, 2, 180, 300, { mergeCooldown: scenario === 'cooldown' ? .2 : 0 });
      b = makeBody(game, otherLevel, 180 + a.r + radiusForLevel(otherLevel) + gap, 300);
    }
    game.bodies.push(a, b);
    stepGame(game, 1 / 60);
    assert.equal(a.vx, 0, scenario);
    assert.equal(b.vx, 0, scenario);
  }
});

test('成堆肥鱼只吸附最近伙伴，不叠加拉力，也不钳制原有高速靠拢', () => {
  const game = createGame({ random: fixedRandom });
  for (const x of [160, 214, 268]) game.bodies.push(makeBody(game, 1, x, 300));
  stepGame(game, 1 / 60);
  assert.ok(game.bodies[0].vx > 0 && game.bodies[1].vx < 0);
  assert.equal(game.bodies[2].vx, 0);
  const pair = createGame({ random: fixedRandom });
  pair.bodies.push(makeBody(pair, 1, 160, 300), makeBody(pair, 1, 214, 300));
  stepGame(pair, 1 / 60);
  assert.equal(game.bodies[1].vx, pair.bodies[1].vx, '三只同级球不能叠加拉力');
  const fast = createGame({ random: fixedRandom });
  fast.bodies.push(makeBody(fast, 2, 180, 300, { vx: 60 }), makeBody(fast, 2, 248, 300, { vx: -60 }));
  stepGame(fast, 1 / 60);
  assert.ok(Math.abs(fast.bodies[0].vx - 60 * .986) < 1e-9);
  assert.ok(Math.abs(fast.bodies[1].vx + 60 * .986) < 1e-9);
});

test("地面水平滚动按方向生成角速度", () => {
  for (const vx of [80, -80]) {
    const game = createGame({ random: fixedRandom });
    const body = makeBody(game, 1, 240, game.height - 9 - radiusForLevel(1), { vx });
    game.bodies.push(body);
    for (let i = 0; i < 8; i++) stepGame(game, 1 / 60);
    assert.ok(body.angularVelocity * vx > 0, `${vx > 0 ? "向右" : "向左"}滚动的角速度符号应对应顺/逆时针`);
    assert.ok(body.angle * vx > 0, "角色朝向应随滚动更新");
  }
});

test("偏心球球接触的切向摩擦会带来角动量", () => {
  const game = createGame({ random: fixedRandom });
  const lower = makeBody(game, 2, 200, 300);
  const falling = makeBody(game, 1, 230, 260, { vy: 100 });
  game.bodies.push(lower, falling);
  for (let i = 0; i < 5; i++) stepGame(game, 1 / 60);
  assert.ok(Math.abs(lower.angularVelocity) > 0.05 || Math.abs(falling.angularVelocity) > 0.05);
  assert.ok(Math.abs(lower.angle) > 0.01 || Math.abs(falling.angle) > 0.01);
});

test("纯竖直自由落下不会凭空自转", () => {
  const game = createGame({ random: fixedRandom });
  const body = makeBody(game, 2, game.width / 2, 100);
  game.bodies.push(body);
  for (let i = 0; i < 24; i++) stepGame(game, 1 / 60);
  assert.equal(body.angularVelocity, 0);
  assert.equal(body.angle, 0);
});

test("静止接触摩擦与角阻尼会让球逐渐停稳", () => {
  const game = createGame({ random: fixedRandom });
  const body = makeBody(game, 1, 240, game.height - 9 - radiusForLevel(1), { angle: 0.25, angularVelocity: 2 });
  game.bodies.push(body);
  for (let i = 0; i < 600; i++) stepGame(game, 1 / 60);
  assert.ok(Math.abs(body.angularVelocity) < 0.01);
  assert.ok(Math.abs(body.vx) < 0.1);
});

test("合成时环绕角度平滑继承，不发生角度跳变", () => {
  const game = createGame({ random: fixedRandom });
  game.bodies.push(
    makeBody(game, 2, 200, 300, { angle: 3.12, angularVelocity: 0.5 }),
    makeBody(game, 2, 240, 300, { angle: -3.12, angularVelocity: -0.5 }),
  );
  const { merged } = stepGame(game, 1 / 60);
  assert.equal(merged.length, 1);
  assert.ok(Math.abs(Math.abs(merged[0].angle) - Math.PI) < 0.1);
  assert.ok(Number.isFinite(merged[0].angularVelocity));
});

test("新落下的鱼有宽限期，持续顶出警戒线才结束", () => {
  const young = createGame({ random: fixedRandom, height: 220 });
  young.bodies.push(makeBody(young, 1, 240, 78));
  for (let i = 0; i < 10; i++) stepGame(young, 0.05);
  assert.equal(young.over, false, "新鱼下落经过警戒线时不会误判");

  const crowded = createGame({ random: fixedRandom, height: 220 });
  const stack = [{ level: 1, y: 188 }, { level: 2, y: 135 }, { level: 1, y: 82 }, { level: 2, y: 29 }];
  for (const item of stack) crowded.bodies.push(makeBody(crowded, item.level, 240, item.y, { age: 2 }));
  for (let i = 0; i < 80 && !crowded.over; i++) stepGame(crowded, 0.05);
  assert.equal(crowded.over, true, "上方堆积持续超过警戒线后进入失败状态");
});

test("大量第 11 级堆到水面上方后能触发失败", () => {
  const game = createGame({ random: fixedRandom });
  for (let i = 0; i < 60; i++) {
    game.bodies.push(makeBody(game, MAX_LEVEL, 125 + (i % 2) * 230, 500 - Math.floor(i / 2) * 210, { age: 5 }));
  }
  for (let i = 0; i < 1200 && !game.over; i++) stepGame(game, 1 / 60);
  assert.equal(game.over, true, "最大级堆叠持续越过水面警戒线时必须结束本局");
});
