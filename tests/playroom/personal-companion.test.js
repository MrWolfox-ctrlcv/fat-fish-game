import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalCompanion, makeCompanionPayload, normalizeCompanionReply } from '../../playroom/src/personal-companion.js';

const json = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
const envelope = (data = {}) => json({ success: true, data });
const model = 'deepseek/deepseek-v4.1-flash';
const ownerGroups = { standard: { ratio: 1, desc: '标准' }, premium: { ratio: 2, desc: '高配' }, auto: { ratio: 1, desc: '自动' } };
const validToken = (id = 91, name = 'Wolfox-Companion-12-x', overrides = {}) => ({
  id, name, user_id: 12, status: 1, group: 'standard', remain_quota: 50000, used_quota: 0,
  expired_time: 1_900_000_000, unlimited_quota: false, model_limits_enabled: true, model_limits: model, allow_ips: '', ...overrides,
});
class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}
function setup({ owner = '12', extraFetch, storage = new MemoryStorage(), now = () => 1_800_000_000_000 } = {}) {
  const calls = [];
  const listeners = new Set();
  const client = { owner, fetchAuthorized: async (url, options = {}) => {
    calls.push({ url, options });
    const custom = await extraFetch?.(url, options);
    if (custom) return custom;
    if (url === '/api/user/self/groups') return envelope(ownerGroups);
    if (url === '/api/pricing') return envelope([{ model_name: model, enable_groups: ['standard', 'premium', 'auto'] }]);
    if (url.startsWith('/api/token/search')) return envelope({ items: [] });
    if (url === '/api/token/' && options.method === 'POST') return envelope();
    return envelope({});
  }, onSessionChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  const personal = createPersonalCompanion({ client, storage, now, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return extraFetch?.(url, options) ?? json({ choices: [{ message: { content: 'hello' } }] });
  } });
  return { personal, client, calls, storage, listeners };
}

test('catalog intersects exact account-group map with pricing and excludes auto', async () => {
  const { personal, calls } = setup();
  const catalog = await personal.catalog();
  assert.deepEqual(catalog.groups.map(({ id }) => id), ['standard', 'premium']);
  assert.equal(catalog.groups[0].ratio, 1);
  assert.equal(catalog.model, model);
  assert.equal(calls.filter(({ url }) => url === '/api/user/self/groups').length, 1);
  personal.destroy();
});

test('pricing response is read with a streaming 2 MiB cap, while failed NewAPI envelopes are rejected', async () => {
  const priceText = `${JSON.stringify({ success: true, data: [{ model_name: model, enable_groups: ['standard'] }] })}${' '.repeat(40_000)}`;
  const streamResponse = {
    ok: true, status: 200, headers: new Headers(),
    body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(priceText)); controller.close(); } }),
  };
  const { personal } = setup({ extraFetch: (url) => url === '/api/pricing' ? streamResponse : null });
  assert.equal((await personal.catalog()).groups[0].id, 'standard');
  personal.destroy();
  const { personal: failed } = setup({ extraFetch: (url) => url === '/api/pricing' ? json({ success: false, message: 'no pricing' }) : null });
  await assert.rejects(failed.catalog(), /no pricing/);
  failed.destroy();
});

test('connect requires explicit consent, validates cents, uses dedicated model and stores only numeric token id', async () => {
  let generatedName;
  const { personal, calls, storage } = setup({ extraFetch: (url) => {
    if (url.startsWith('/api/token/search')) {
      generatedName = new URLSearchParams(url.split('?')[1]).get('keyword');
      return envelope({ items: [validToken(91, generatedName, { remain_quota: 145000 })] });
    }
    if (url === '/api/token/91') return envelope(validToken(91, generatedName, { remain_quota: 145000 }));
    if (url === '/api/token/91/key') return envelope({ key: 'sk-abc123' });
    return null;
  } });
  await assert.rejects(personal.connect({ group: 'standard', consent: false }), { code: 'consent_required' });
  for (const budgetUsd of [0, 0.001, 0.101, 10.01, NaN]) await assert.rejects(personal.connect({ group: 'standard', budgetUsd, consent: true }));
  const state = await personal.connect({ group: 'standard', budgetUsd: 0.29, consent: true });
  assert.equal(state.connected, true);
  assert.equal(state.key, null);
  const post = calls.find((call) => call.url === '/api/token/' && call.options.method === 'POST');
  const body = JSON.parse(post.options.body);
  assert.equal(body.remain_quota, 145000);
  assert.equal(body.unlimited_quota, false);
  assert.equal(body.model_limits, model);
  assert.equal(body.group, 'standard');
  assert.equal(body.cross_group_retry, false);
  assert.ok(body.name.startsWith('Wolfox-Companion-12-'));
  assert.ok(new TextEncoder().encode(body.name).byteLength <= 50);
  assert.deepEqual([...storage.values.keys()], ['fat-fish:personal-companion:token-id:12']);
  assert.ok([...storage.values.values()].every((value) => !String(value).includes('sk-')));
  personal.destroy();
});

test('status after refresh validates the managed token without loading secret, first chat reads existing key without creating token', async () => {
  let keyReads = 0;
  const { personal, calls, storage } = setup({ extraFetch: (url) => {
    if (url === '/api/token/7') return envelope(validToken(7, 'Wolfox-Companion-12-existing'));
    if (url === '/api/token/7/key') { keyReads++; return envelope({ key: 'sk-existing' }); }
    return null;
  } });
  storage.setItem('fat-fish:personal-companion:token-id:12', '7');
  const state = await personal.status();
  assert.equal(state.connected, true);
  assert.equal(state.key, null);
  assert.equal(keyReads, 0);
  const result = await personal.chat({ game: 'fat-fish', event: 'new_level', detail: { level: 3 }, score: 45, elapsed: 20, scene: { balls: [{ level: 3, x: 12, y: 34, variant: null }], danger: true, ball_count: 1, stack_height: 34, highest_level: 3 } });
  assert.deepEqual(result, { success: true, text: 'hello' });
  assert.equal(keyReads, 1);
  assert.equal(calls.some(({ url, options }) => url === '/api/token/' && options.method === 'POST'), false);
  const chat = calls.find(({ url }) => url === '/v1/chat/completions');
  assert.equal(chat.options.headers.Authorization, 'Bearer sk-existing');
  const body = JSON.parse(chat.options.body);
  assert.equal(body.model, model);
  assert.equal(body.reasoning_effort, 'off');
  assert.equal(body.max_tokens, 384);
  const event = JSON.parse(body.messages[1].content);
  assert.deepEqual(event, { game: 'fat-fish', event: 'new_level', score: 45, elapsed: 20, scene: { balls: [{ level: 3, x: 12, y: 34, variant: null }], ball_count: 1, stack_height: 34, danger: true, highest_level: 3 }, detail: { level: 3 } });
  assert.equal(chat.options.credentials, 'omit');
  personal.destroy();
});

test('change group uses numeric token id and preserves existing fields', async () => {
  const putBodies = [];
  const { personal, storage } = setup({ extraFetch: (url, options) => {
    if (url === '/api/token/4') return envelope(validToken(4, 'Wolfox-Companion-12-a', { allow_ips: '127.0.0.1' }));
    if ((url === '/api/token/' || url === '/api/token/?status_only=true') && options.method === 'PUT') { putBodies.push({ url, body: JSON.parse(options.body) }); return envelope(); }
    return null;
  } });
  storage.setItem('fat-fish:personal-companion:token-id:12', '4');
  assert.equal((await personal.changeGroup('premium')).group, 'premium');
  assert.equal(typeof putBodies[0].body.id, 'number');
  assert.equal(putBodies[0].body.id, 4);
  assert.equal(putBodies[0].body.allow_ips, '127.0.0.1');
  assert.equal(putBodies[0].body.group, 'premium');
  assert.equal(putBodies[0].body.cross_group_retry, false);
  assert.equal((await personal.disable()).connected, false);
  assert.equal(putBodies[1].url, '/api/token/?status_only=true');
  assert.equal(typeof putBodies[1].body.id, 'number');
  assert.equal(putBodies[1].body.id, 4);
  assert.equal(putBodies[1].body.status, 2);
  personal.destroy();
});

test('disabled, expired, exhausted and owner-mismatched tokens are not usable', async () => {
  for (const [row, expected] of [
    [validToken(2, 'Wolfox-Companion-12-disabled', { status: 2 }), 'disabled'],
    [validToken(3, 'Wolfox-Companion-12-expired', { expired_time: 1_700_000_000 }), 'expired'],
    [validToken(4, 'Wolfox-Companion-12-empty', { remain_quota: 0 }), 'exhausted'],
    [validToken(6, 'Wolfox-Companion-12-status-expired', { status: 3, remain_quota: 100 }), 'expired'],
    [validToken(7, 'Wolfox-Companion-12-status-empty', { status: 4, remain_quota: 100 }), 'exhausted'],
    [validToken(5, 'Wolfox-Companion-12-other', { user_id: 13 }), null],
  ]) {
    const { personal, storage } = setup({ extraFetch: (url) => url === `/api/token/${row.id}` ? envelope(row) : null });
    storage.setItem('fat-fish:personal-companion:token-id:12', String(row.id));
    const state = await personal.status();
    assert.equal(state.statusReason ?? null, expected);
    assert.equal(state.connected, false);
    personal.destroy();
  }
});

test('session changes notify UI and remove key from memory', async () => {
  const { personal, client, listeners, storage } = setup({ extraFetch: (url) => {
    if (url === '/api/token/8') return envelope(validToken(8, 'Wolfox-Companion-12-secret'));
    if (url.endsWith('/key')) return envelope({ key: 'sk-memory' });
    return null;
  } });
  storage.setItem('fat-fish:personal-companion:token-id:12', '8');
  await personal.chat({ game: 'kitchen', event: 'chat', message: 'hi' });
  const events = [];
  personal.onSessionChange((event) => events.push(event.type));
  client.owner = '13';
  for (const fn of listeners) fn({ type: 'account_changed', owner: '13' });
  assert.deepEqual(events, ['account_changed']);
  personal.destroy();
});

test('create failure is not retried and points to manual recovery', async () => {
  let creates = 0;
  const { personal } = setup({ extraFetch: (url, options) => {
    if (url === '/api/token/' && options.method === 'POST') { creates++; throw new Error('network lost'); }
    return null;
  } });
  await assert.rejects(personal.connect({ group: 'standard', consent: true }), /不要重新创建/);
  assert.equal(creates, 1);
  personal.destroy();
});

test('payload helper reuses game whitelist and caps context/output', () => {
  const scene = { balls: [{ level: 3, x: 12, y: 34, variant: 'evil' }, { level: 99, x: 99999, y: -99999 }], danger: true, ball_count: 2, stack_height: 34, highest_level: 3, injected: 'secret' };
  const payload = makeCompanionPayload({ game: 'fat-fish', event: 'new_level', detail: { level: 3 }, score: 10, elapsed: 2, scene, arbitrary: 'secret' }, Array.from({ length: 8 }, (_, index) => ({ role: 'user', content: String(index) })));
  assert.equal(payload.model, model);
  assert.equal(payload.reasoning_effort, 'off');
  assert.equal(payload.max_tokens, 384);
  assert.equal(payload.messages.length, 8);
  const event = JSON.parse(payload.messages.at(-1).content);
  assert.equal(event.event, 'new_level');
  assert.equal(event.scene.balls.length, 2);
  assert.equal(event.scene.balls[0].variant, null);
  assert.equal('injected' in event.scene, false);
  assert.equal('arbitrary' in event, false);
  const chat = makeCompanionPayload({ game: 'kitchen', event: 'chat', message: 'current phrase', score: 4, elapsed: 8 }, [{ role: 'assistant', content: 'prior reply' }]);
  assert.equal(chat.messages[1].content, 'prior reply');
  assert.equal(chat.messages[2].role, 'user');
  assert.match(chat.messages[2].content, /current phrase/);
  assert.equal(chat.messages[2].content.match(/current phrase/g).length, 1);
  assert.match(chat.messages[0].content, /640,450/);
  assert.equal(normalizeCompanionReply({ choices: [{ message: { content: 'x'.repeat(400) } }] }).length, 320);
});
