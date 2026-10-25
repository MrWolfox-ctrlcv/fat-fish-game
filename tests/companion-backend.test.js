import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCompanion, normalizeCompanionInput } from '../backend/companion.mjs';

const input = { game: 'bumper', event: 'chat', score: 30, level: 1, elapsed: 20, message: '这局怎么打？', api_key: 'must-not-leave', history: ['must-not-leave'] };
const env = { COMPANION_ENABLED: '1', COMPANION_API_URL: 'http://local.test/v1/chat/completions', COMPANION_API_KEY: 'private-test-only', COMPANION_MODEL: 'fixture', COMPANION_GLOBAL_DAILY: '2' };

test('短摘要只包含白名单；关闭和非法输入不会调用上游', async () => {
  const db = new DatabaseSync(':memory:'); let calls = 0;
  const companion = createCompanion({ db, env: {}, fetchImpl: async () => { calls++; } });
  try {
    assert.equal(companion.status().enabled, false);
    await assert.rejects(companion.respond('u:1', input), { code: 'AI_DISABLED' });
    assert.equal(calls, 0);
    assert.equal(normalizeCompanionInput(input).api_key, undefined);
    assert.throws(() => normalizeCompanionInput({ ...input, message: 'a'.repeat(161) }), { code: 'AI_INPUT' });
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
