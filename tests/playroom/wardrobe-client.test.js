import test from 'node:test';
import assert from 'node:assert/strict';
import { createWardrobeClient } from '../../playroom/src/wardrobe-client.js';
import { shouldRefreshWardrobeForSessionEvent } from '../../playroom/src/wardrobe.js';

const json = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
const auth = (token, id = 12) => json({ success: true, data: { access_token: token, user: { id } } });

class FakeChannel {
  static instances = [];
  constructor(name) { this.name = name; FakeChannel.instances.push(this); }
  close() {}
  dispatch(data) { this.onmessage?.({ data }); }
}

test('refresh verifies NewAPI envelope and keeps bearer in memory', async () => {
  const calls = [];
  const client = createWardrobeClient({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/user/auth/refresh') return auth('secret-a', 41);
    return json({ success: true, catalog: [], equipped: 'maid:1', unlocked_count: 1 });
  } });
  const snapshot = await client.get();
  assert.equal(snapshot.success, true);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[1].options.headers.get('Authorization'), 'Bearer secret-a');
  assert.equal(client.owner, '41');
  client.destroy();
});

test('kind signed_out and authenticated broadcasts invalidate pending refreshes', async () => {
  const prior = globalThis.BroadcastChannel;
  globalThis.BroadcastChannel = FakeChannel;
  FakeChannel.instances = [];
  try {
    let finishRefresh;
    let wardrobeCalls = 0;
    const client = createWardrobeClient({ fetchImpl: async (url) => {
      if (url === '/api/user/auth/refresh') return new Promise((resolve) => { finishRefresh = resolve; });
      wardrobeCalls += 1; return json({ success: true, catalog: [] });
    } });
    const pending = client.get();
    await new Promise((resolve) => setImmediate(resolve));
    FakeChannel.instances[0].dispatch({ kind: 'signed_out' });
    finishRefresh({ ok: true, status: 200, json: async () => ({ success: true, data: { access_token: 'late-token', user: { id: 51 } } }) });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(client.owner, null);
    assert.equal(wardrobeCalls, 0);
    client.destroy();
  } finally { globalThis.BroadcastChannel = prior; }
});

test('concurrent requests share one refresh and same owner refresh does not emit a false account change', async () => {
  let refreshes = 0;
  let release;
  const client = createWardrobeClient({ fetchImpl: async (url) => {
    if (url === '/api/user/auth/refresh') {
      refreshes += 1;
      return new Promise((resolve) => { release = () => resolve(auth('token-a', 7)); });
    }
    return json({ success: true, catalog: [], equipped: 'maid:1' });
  } });
  const events = [];
  client.onSessionChange((event) => events.push(event));
  const first = client.get(); const second = client.get();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshes, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(events.filter((event) => event.type === 'account_changed').length, 0);
  assert.equal(events.filter((event) => event.type === 'authenticated').length, 1);
  client.destroy();
});

test('a different owner on refresh emits account_changed and retries with that owner token', async () => {
  let refreshes = 0;
  const seen = [];
  const client = createWardrobeClient({ fetchImpl: async (url, options) => {
    if (url === '/api/user/auth/refresh') {
      refreshes += 1;
      return auth(refreshes === 1 ? 'token-a' : 'token-b', refreshes === 1 ? 1 : 2);
    }
    if (url === '/games/fat-fish/api/wardrobe') return json({ success: true, catalog: [], equipped: 'maid:1' });
    if (url === '/protected') seen.push(options.headers.get('Authorization'));
    if (options.headers.get('Authorization') === 'Bearer token-a') return json({ success: false }, 401);
    return json({ success: true });
  } });
  const events = [];
  client.onSessionChange((event) => events.push(event));
  await client.get();
  await client.fetchAuthorized('/protected');
  assert.deepEqual(seen, ['Bearer token-a', 'Bearer token-b']);
  assert.equal(client.owner, '2');
  assert.ok(events.some((event) => event.type === 'account_changed'));
  client.destroy();
});

test('anonymous starter sprites use no-cache without authentication or refresh', async () => {
  const calls = [];
  const client = createWardrobeClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200 }; } });
  for (const skin of [
    { id: 'maid:1', level: 1 }, { id: 'gpt-silly:2', level: 2 }, { id: 'deepseek-claude:5', level: 5 },
  ]) assert.equal((await client.art(skin)).ok, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ url, options }) => url.includes('/games/fat-fish/api/sprites?') && options.cache === 'no-cache'));
  assert.ok(calls.every(({ options }) => !options.headers?.Authorization));
  client.destroy();
});

test('failed refresh remains anonymous and exposes only the default guest wardrobe', async () => {
  let endpointCalls = 0;
  const events = [];
  const client = createWardrobeClient({ fetchImpl: async (url) => {
    if (url === '/api/user/auth/refresh') return json({ message: 'guest' }, 401);
    endpointCalls += 1;
    return json({ success: false }, 401);
  } });
  client.onSessionChange((event) => events.push(event));
  const result = await client.get();
  const again = await client.get();
  assert.equal(result.guest, true);
  assert.equal(again.guest, true);
  assert.equal(result.equipped, 'maid:1');
  assert.equal(result.unlocked_count, 1);
  assert.equal(endpointCalls, 0);
  assert.deepEqual(events, []);
  assert.equal(client.owner, null);
  client.destroy();
});

test('wardrobe refreshes only for real account changes, sign-out, or a broadcast sign-in', () => {
  assert.equal(shouldRefreshWardrobeForSessionEvent({ type: 'token_expired' }), false);
  assert.equal(shouldRefreshWardrobeForSessionEvent({ type: 'authenticated', source: 'refresh' }), false);
  assert.equal(shouldRefreshWardrobeForSessionEvent({ type: 'signed_out' }), true);
  assert.equal(shouldRefreshWardrobeForSessionEvent({ type: 'account_changed' }), true);
  assert.equal(shouldRefreshWardrobeForSessionEvent({ type: 'authenticated', source: 'broadcast' }), true);
});
