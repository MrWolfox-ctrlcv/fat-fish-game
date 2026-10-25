import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../backend/store.mjs';
import { createGameServer } from '../backend/app.mjs';

test('静态压缩/304节省传输，图片304之前仍核验解锁与账户权限，删除活动仅管理员', async () => {
  const store = new GameStore(':memory:');
  store.saveProgress(1, { score: 1, unlocked: [1, 2], egg_stages: [] });
  store.createCampaign(1, { id: 'obsolete', title: '无效活动', min_level: 2 });
  const { server } = await createGameServer({ store, art: new Map([['maid:2', Buffer.from('test-art')]]), companionEnv: {},
    fetchImpl: async (_url, options) => Response.json({ success: true, data: options.headers.Authorization === 'Bearer administrator' ? { id: 1, role: 100 } : { id: 2, role: 1 } }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/games/fat-fish/`;
  const admin = { Authorization: 'Bearer administrator' };
  try {
    const js = await fetch(base + 'game.js', { headers: { 'Accept-Encoding': 'br' } });
    assert.equal(js.headers.get('content-encoding'), 'br');
    assert.ok(Number(js.headers.get('content-length')) < 20000);
    const conditional = await fetch(base + 'game.js', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': js.headers.get('etag') } });
    assert.equal(conditional.status, 304);
    const art = await fetch(base + 'api/art?level=2', { headers: admin });
    assert.equal(art.status, 200);
    const tag = art.headers.get('etag');
    assert.equal(art.headers.get('cache-control'), 'private, no-cache');
    assert.equal((await fetch(base + 'api/art?level=2', { headers: { ...admin, 'If-None-Match': tag } })).status, 304);
    assert.equal((await fetch(base + 'api/art?level=2', { headers: { Authorization: 'Bearer other-user', 'If-None-Match': tag } })).status, 403);
    assert.equal((await fetch(base + 'api/art?level=2', { headers: { 'If-None-Match': tag } })).status, 401);
    assert.equal((await fetch(base + 'assets/whale-maids.png')).status, 404);
    const remove = (token) => fetch(base + 'api/admin/campaigns/delete', { method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ campaign_id: 'obsolete' }) });
    assert.equal((await remove('Bearer other-user')).status, 403);
    const deleted = await remove(admin.Authorization);
    assert.equal(deleted.status, 200);
    assert.deepEqual((await deleted.json()).campaigns, []);
    assert.equal((await remove(admin.Authorization)).status, 409);
  } finally { await new Promise((resolve) => server.close(resolve)); store.close(); }
});
