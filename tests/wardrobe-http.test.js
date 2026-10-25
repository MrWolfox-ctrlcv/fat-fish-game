import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../backend/store.mjs';
import { createGameServer } from '../backend/app.mjs';

test('wardrobe uses verified account progress; shared sprites retain private ownership and reuse bytes', async () => {
  const store = new GameStore(':memory:');
  store.saveProgress(1, { score: 20, unlocked: [1, 2, 3], egg_stages: ['gpt-normal:4'] });
  const calls = [];
  const { server } = await createGameServer({ store,
    art: new Map([['maid:1', Buffer.from('starter')], ['maid:2', Buffer.from('shared-two')], ['gpt-silly:2', Buffer.from('npc')]]),
    fetchImpl: async (url, options) => {
      calls.push([String(url), options.method || 'GET']);
      return Response.json({ success: true, data: { id: options.headers.Authorization === 'Bearer first-user' ? 1 : 2, role: 1 } });
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/games/fat-fish/api/`;
  const request = (path, owner, payload, more = {}) => fetch(base + path, { method: payload ? 'POST' : 'GET',
    headers: { ...(owner ? { Authorization: `Bearer ${owner}-user` } : {}), 'Content-Type': 'application/json', ...more },
    ...(payload ? { body: JSON.stringify(payload) } : {}) });
  try {
    assert.equal((await request('wardrobe')).status, 401);
    const catalog = await (await request('wardrobe', 'first')).json();
    assert.equal(catalog.total, 31); assert.equal(catalog.equipped, 'maid:1'); assert.equal(catalog.purchases_enabled, false);
    assert.equal(catalog.catalog.find((x) => x.id === 'gpt-normal:4').unlocked, true);
    assert.equal(catalog.catalog.find((x) => x.id === 'gpt-normal:6').unlocked, false);
    assert.equal((await request('wardrobe/equip', 'second', { skin_id: 'maid:2', user_id: 1, unlocked: [1, 2] })).status, 403);
    const equipped = await (await request('wardrobe/equip', 'first', { skin_id: 'maid:2' })).json();
    assert.equal(equipped.equipped, 'maid:2');
    assert.equal((await (await request('wardrobe', 'second')).json()).equipped, 'maid:1');
    const old = await request('art?level=2', 'first'); const tag = old.headers.get('etag');
    const shared = await request('sprites?level=2', 'first');
    assert.equal(await shared.text(), 'shared-two'); assert.equal(shared.headers.get('etag'), tag);
    assert.equal((await request('sprites?level=2', 'first', null, { 'If-None-Match': tag })).status, 304);
    assert.equal((await request('sprites?level=2', 'second', null, { 'If-None-Match': tag })).status, 403);
    assert.equal((await request('sprites?level=2')).status, 401);
    const npc = await request('sprites?level=2&variant=gpt-silly');
    assert.equal(npc.status, 200); assert.equal(npc.headers.get('cache-control'), 'public, no-cache');
    assert.equal((await request('wardrobe/equip', 'second', { skin_id: 'gpt-silly:2' })).status, 403);
    store.saveProgress(2, { score: 25, unlocked: [1, 2], egg_stages: [] });
    assert.equal((await request('wardrobe/equip', 'second', { skin_id: 'maid:2' })).status, 200);
    assert.ok(calls.every(([url, method]) => url.endsWith('/api/user/self') && method === 'GET'));
  } finally { await new Promise((resolve) => server.close(resolve)); store.close(); }
});
