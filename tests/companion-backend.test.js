import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCompanion, normalizeCompanionInput } from '../backend/companion.mjs';

const input = { game: 'bumper', event: 'chat', score: 30, level: 1, elapsed: 20, message: '这局怎么打？', api_key: 'must-not-leave', history: ['must-not-leave'] };
const env = { COMPANION_ENABLED: '1', COMPANION_API_URL: 'http://local.test/v1/chat/completions', COMPANION_API_KEY: 'private-test-only', COMPANION_MODEL: 'fixture', COMPANION_GLOBAL_DAILY: '2' };

test('team summaries preserve bounded scores and friend identity, rejecting forged shapes', () => {
  const scene = { mode: 'teams', team_scores: [-2, 4], player: { x: 640, y: 450, alive: true, dash_ready: true, edge_distance: 300, kills: 2, falls: 1, rank: 2, team_id: 0 },
    opponents: [{ x: 500, y: 400, alive: true, team_id: 0 }, { x: 700, y: 500, alive: true, team_id: 1 }], arena_radius: 390, remaining: 50, private_note: 'drop' };
  const clean = normalizeCompanionInput({ ...input, scene }).scene;
  assert.deepEqual(clean.team_scores, [-2, 4]);
  assert.equal(clean.opponents[0].team_id, clean.player.team_id);
  assert.equal(clean.private_note, undefined);
  assert.throws(() => normalizeCompanionInput({ ...input, scene: { ...scene, team_scores: [1, 2, 3] } }), { code: 'AI_INPUT' });
  assert.throws(() => normalizeCompanionInput({ ...input, scene: { ...scene, player: { ...scene.player, team_id: '0' } } }), { code: 'AI_INPUT' });
});

test('短摘要只包含白名单；关闭和非法输入不会调用上游', async () => {
  const db = new DatabaseSync(':memory:'); let calls = 0;
  const companion = createCompanion({ db, env: {}, fetchImpl: async () => { calls++; } });
  try {
    assert.equal(companion.status().enabled, false);
    await assert.rejects(companion.respond('u:1', input), { code: 'AI_DISABLED' });
    assert.equal(calls, 0);
    assert.equal(normalizeCompanionInput(input).api_key, undefined);
    assert.throws(() => normalizeCompanionInput({ ...input, message: 'a'.repeat(161) }), { code: 'AI_INPUT' });
    assert.throws(() => normalizeCompanionInput({ ...input, scene: { balls: Array.from({ length: 13 }, () => ({ level: 1, x: 1, y: 1, variant: null })) } }), { code: 'AI_INPUT' });
    assert.throws(() => normalizeCompanionInput({ ...input, scene: { balls: [{ level: 1, x: '1', y: 1, variant: null }], ball_count: 1, stack_height: 2, danger: false, highest_level: 1 } }), { code: 'AI_INPUT' });
    const noImage = normalizeCompanionInput({ ...input, game: 'fat-fish', scene: { balls: [], ball_count: 1, stack_height: 2, danger: false, highest_level: 1, image: 'screenshot' } });
    assert.equal(JSON.stringify(noImage).includes('screenshot'), false);
    assert.throws(() => normalizeCompanionInput({ ...input, event: 'new_easter', detail: { level: 2, variant: 'unknown' } }), { code: 'AI_INPUT' });
    for (const [level, variant] of [[4, 'qwen'], [6, 'kimi'], [7, 'grok'], [8, 'claude-real'], [2, 'yellow-doubao']]) {
      assert.equal(normalizeCompanionInput({ ...input, game: 'fat-fish', event: 'new_easter', detail: { level, variant } }).detail.variant, variant);
    }
    const clean = normalizeCompanionInput({ ...input, game: 'fat-fish', scene: { balls: [], ball_count: 2, stack_height: 4, danger: false, highest_level: 3, username: 'secret' } });
    assert.deepEqual(clean.scene, { balls: [], ball_count: 2, stack_height: 4, danger: false, highest_level: 3 });
    assert.equal(JSON.stringify(clean).includes('secret'), false);
    const arena = normalizeCompanionInput({ ...input, scene: { player: { x: 400, y: 450, alive: true, edge_distance: 90, dash_ready: false, kills: 2, falls: 1, rank: 3, nickname: 'secret' }, opponents: [{ x: 600, y: 450, alive: true, history: ['secret'] }], arena_radius: 500, remaining: 40, screenshot: 'secret' } });
    assert.deepEqual(arena.scene, { player: { x: 400, y: 450, edge_distance: 90, kills: 2, falls: 1, rank: 3, alive: true, dash_ready: false }, opponents: [{ x: 600, y: 450, alive: true }], arena_radius: 500, remaining: 40 });
  } finally { db.close(); }
});

test('预算重启后保持且跨用户共享；无历史上下文和固定输出上限', async () => {
  const db = new DatabaseSync(':memory:'); const payloads = [];
  const fetchImpl = async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: '试试绕到对手侧面冲刺！' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  };
  const options = { db, env, fetchImpl, now: () => 1792886400000 };
  try {
    const c = createCompanion(options);
    assert.equal((await c.respond('u:1', input)).remaining, 1);
    await assert.rejects(c.respond('u:1', input), { code: 'AI_COOLDOWN' });
    const restarted = createCompanion(options);
    assert.equal((await restarted.respond('u:2', input)).remaining, 0);
    await assert.rejects(restarted.respond('u:3', input), { code: 'AI_BUDGET' });
    assert.equal(payloads.length, 2);
    assert.equal(payloads[0].messages.length, 2);
    assert.ok(payloads[0].max_tokens <= 192);
    assert.ok(!JSON.stringify(payloads).includes('must-not-leave'));
    assert.equal(db.prepare("SELECT calls,input_tokens FROM companion_daily WHERE owner='*'").get().input_tokens, 200);
  } finally { db.close(); }
});

test('白名单场景与客户端事件详情准确传给上游，无任意附加字段', async () => {
  const db = new DatabaseSync(':memory:'); const payloads = [];
  const fetchImpl = async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: '看准时机！' } }] });
  };
  const scene = { balls: [{ level: 4, x: 80, y: 500, variant: 'gpt-normal', secret: 'drop' }], ball_count: 8, stack_height: 400, danger: true, highest_level: 5, screenshot: 'drop' };
  try {
    const companion = createCompanion({ db, env, fetchImpl, now: () => 1792886400000 });
    await companion.respond('u:1', { game: 'fat-fish', event: 'new_easter', score: 100, level: 5, elapsed: 30, detail: { level: 4, variant: 'gpt-normal', api_key: 'drop' }, scene, api_key: 'drop', history: ['drop'] });
    const content = payloads[0].messages[1].content;
    assert.ok(content.includes('"balls":[{"level":4,"x":80,"y":500,"variant":"gpt-normal"}]'));
    assert.ok(content.includes('"level":4,"variant":"gpt-normal"'));
    assert.equal(content.includes('drop'), false);
    assert.ok(content.includes('当前场景='));
    assert.equal(db.prepare("SELECT calls FROM companion_daily WHERE owner='*'").get().calls, 1);
  } finally { db.close(); }
});

test('上游失败仍消耗预留次数，错误中没有密钥且不会自动重试', async () => {
  const db = new DatabaseSync(':memory:'); let calls = 0;
  const options = { db, env: { ...env, COMPANION_GLOBAL_DAILY: '1' }, now: () => 1792886400000,
    fetchImpl: async () => { calls++; throw new Error('private-test-only'); } };
  try {
    await assert.rejects(createCompanion(options).respond('u:1', input), (e) => e.code === 'AI_UNAVAILABLE' && !e.message.includes('private-test-only'));
    await assert.rejects(createCompanion(options).respond('u:2', input), { code: 'AI_BUDGET' });
    assert.equal(calls, 1);
  } finally { db.close(); }
});
