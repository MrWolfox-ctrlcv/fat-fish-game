import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../backend/store.mjs';
import { createGameServer } from '../backend/app.mjs';
import { initialState, replayCheckpoint } from '../backend/replay.mjs';
import { createGame, dropBody, stepGame } from '../dist/game.js';
import { seededRandom } from '../dist/seeded-random.js';
import { weekFor } from '../backend/weekly.mjs';

test('服务器逐帧复算与浏览器相同，并拒绝密集投放和倒退记录', () => {
  const game = createGame({ random: seededRandom(431), variantRandom: seededRandom(987) });
  const moves = [];
  for (let i = 0; i < 900; i++) {
    if (i % 30 === 0) { moves.push({ step: game.stepIndex, x: 240 }); assert.ok(dropBody(game, 240)); }
    stepGame(game, 1 / 60);
  }
  const result = replayCheckpoint(initialState(431, 987), moves, game.stepIndex);
  assert.equal(result.summary.score, game.score);
  assert.deepEqual(result.state.bodies, game.bodies);
  assert.deepEqual(result.summary.unlocked, [...game.unlocked]);
  assert.throws(() => replayCheckpoint(initialState(431, 987), [{ step: 0, x: 200 }, { step: 0, x: 200 }], 1), /频率/);
  assert.throws(() => replayCheckpoint(result.state, [], 0), /时间/);
});

test('账户进度隔离，奖品分配持久且每账户每奖池只能领取一个', () => {
  const store = new GameStore(':memory:');
  const campaign = { id: 'gift', title: '合成谢礼', min_level: 6 };
  const codes = [1, 2].map((id) => ({ id, key: String(id).padStart(32, 'a'), name: 'batch', quota: 51200, expired_time: 0 }));
  assert.equal(store.importPrizes(1, campaign, codes).imported, 2);
  assert.equal(store.importPrizes(1, campaign, codes).imported, 0);
  store.saveProgress(2, { score: 1200, unlocked: [1, 6], egg_stages: ['gpt-normal:6'] });
  assert.deepEqual(store.profile(3), { best: 0, unlocked: [1], egg_stages: [] });
  assert.throws(() => store.claim(3, 'gift'), /解锁/);
  const first = store.claim(2, 'gift');
  assert.equal(store.claim(2, 'gift').code, first.code);
  store.saveProgress(3, { score: 1300, unlocked: [1, 6], egg_stages: [] });
  assert.notEqual(store.claim(3, 'gift').code, first.code);
  assert.equal(store.campaigns()[0].remaining, 0);
  store.close();
});

test('鉴权、越权素材、私有原图、幂等复算与兑换码导入的端到端接口', async () => {
  const store = new GameStore(':memory:');
  let clock = Date.now();
  const fakeFetch = async (url, options) => {
    const token = options.headers.Authorization;
    const user = token === 'Bearer administrator-token' ? { id: 1, role: 100, username: 'admin' }
      : token === 'Bearer second-user-token' ? { id: 2, role: 1, username: 'second' }
      : token === 'Bearer third-user-token' ? { id: 3, role: 1, username: 'third' } : null;
    if (!user) return Response.json({ success: false }, { status: 401 });
    if (new URL(url).pathname === '/api/user/self') return Response.json({ success: true, data: user });
    if (user.role < 10) return Response.json({ success: false }, { status: 403 });
    const redemption = { id: 17, key: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', status: 1, used_user_id: 0, quota: 51200, name: 'holiday', expired_time: Math.floor(clock / 1000) + 86400 };
    return Response.json({ success: true, data: new URL(url).pathname.endsWith('/search') ? { items: [redemption] } : redemption });
  };
  const { server } = await createGameServer({ store, fetchImpl: fakeFetch, now: () => clock,
    art: new Map([1, 2, 3, 6].map((level) => [`maid:${level}`, Buffer.from(`original-generated-maid-${level}`)])), origins: ['http://allowed.test'] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/games/fat-fish/`;
  const request = (path, token = 'second-user-token', payload, extra = {}) => fetch(base + path, {
    method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  try {
    assert.equal((await fetch(base + 'api/me')).status, 401);
    assert.equal((await request('api/me', 'forged-user-token')).status, 401);
    assert.equal((await request('api/art?level=6')).status, 403);
    assert.equal((await request('api/art?level=1')).status, 200);
    assert.equal((await request('assets/ai-stage-eggs.png')).status, 404);
    assert.equal((await request('../data/game.sqlite')).status, 404);
    assert.equal((await request('api/admin/candidates')).status, 403);
    assert.equal((await fetch(base + 'api/admin/campaigns')).status, 401);
    assert.equal((await request('api/admin/campaigns')).status, 403);
    assert.equal((await request('api/admin/campaigns', undefined, { title: '非管理员活动', min_level: 6 })).status, 403);
    for (const invalid of [{ title: '   ', min_level: 6 }, { title: '无效活动', min_level: 1 },
      { title: '无效活动', min_level: 12 }, { title: '无效活动', min_level: 6.5 }, { title: '字'.repeat(81), min_level: 6 }]) {
      assert.equal((await request('api/admin/campaigns', 'administrator-token', invalid)).status, 400);
    }
    const createdResponse = await request('api/admin/campaigns', 'administrator-token', { title: ' 周末肥鱼谢礼 ', min_level: 8 });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.campaign.title, '周末肥鱼谢礼');
    assert.equal(created.campaign.min_level, 8);
    assert.equal(created.campaign.total, 0);
    assert.equal(created.campaign.remaining, 0);
    assert.match(created.campaign.id, /^fish-[a-f0-9-]{36}$/);
    assert.ok((await (await request('api/admin/campaigns', 'administrator-token')).json()).campaigns.some((c) => c.id === created.campaign.id));
    assert.equal((await request('api/run', undefined, {}, { Origin: 'http://evil.test' })).status, 403);
    const candidates = await (await request('api/admin/candidates?keyword=holiday', 'administrator-token')).json();
    assert.equal(candidates.items.length, 1);
    assert.ok(!JSON.stringify(candidates).includes('bbbbbbbb'));
    const imported = await (await request('api/admin/import', 'administrator-token', { ids: [17], campaign_id: 'first-fat-fish-6', title: '首次合成谢礼', min_level: 6 })).json();
    assert.equal(imported.imported, 1);
    assert.equal((await request('api/admin/import', 'administrator-token', { ids: [17], campaign_id: 'first-fat-fish-6', title: '首次合成谢礼', min_level: 6 })).status, 200);
    const started = await (await request('api/run', undefined, { height: 620 })).json();
    assert.deepEqual(started.play.levels, [1, 2, 3]);
    assert.equal((await request(`api/play/art?run_id=${started.run.id}&level=3`)).status, 200);
    assert.equal((await request(`api/play/art?run_id=${started.run.id}&level=3`, 'third-user-token')).status, 409);
    assert.equal((await request('api/art?level=3')).status, 403);
    assert.equal((await request(`api/play/art?run_id=${started.run.id}&level=6`)).status, 403);
    const payload = { run_id: started.run.id, step: 60, moves: [{ step: 0, x: 240 }] };
    clock += 1000;
    const checked = await (await request('api/run/checkpoint', undefined, payload)).json();
    assert.equal(checked.success, true);
    assert.deepEqual((await (await request('api/run/checkpoint', undefined, payload)).json()).profile, checked.profile);
    assert.equal((await request('api/run/checkpoint', 'third-user-token', payload)).status, 409);
    const fakeScore = await request('api/run/checkpoint', undefined, { run_id: started.run.id, step: 61, moves: [], score: 999999, unlocked: [11] });
    assert.equal(fakeScore.status, 200);
    assert.ok(!(await (await request('api/me')).json()).profile.unlocked.includes(11));
    assert.equal((await request('api/rewards/claim', undefined, { run_id: started.run.id, campaign_id: 'first-fat-fish-6' })).status, 403);
    store.saveProgress(2, { score: 1000, unlocked: [1, 6], egg_stages: [] });
    const claims = await Promise.all([1, 2, 3].map(() => request('api/rewards/claim', undefined, { run_id: started.run.id, campaign_id: 'first-fat-fish-6' }).then((r) => r.json())));
    assert.equal(new Set(claims.map((r) => r.reward.code)).size, 1);
    const other = await (await request('api/me', 'third-user-token')).json();
    assert.ok(!JSON.stringify(other).includes('bbbbbbbb'));
    assert.equal((await request('api/art?level=6', 'third-user-token')).status, 403);
    assert.equal((await request('api/art?level=6')).status, 200);
  } finally { await new Promise((resolve) => server.close(resolve)); store.close(); }
});

test('新活动可独立补充奖品，原活动规则不被覆盖，每个活动分别限制领取', () => {
  const store = new GameStore(':memory:');
  try {
    const weekend = { id: 'weekend', title: '周末谢礼', min_level: 8 };
    const normal = { id: 'normal', title: '普通谢礼', min_level: 6 };
    assert.equal(store.createCampaign(1, weekend).total, 0);
    store.createCampaign(1, normal);
    const codes = [1, 2, 3].map((id) => ({ id, key: `reserved-code-for-test-${id}`, name: '专用测试批次', quota: 51200, expired_time: 0 }));
    assert.equal(store.importPrizes(1, weekend, codes.slice(0, 2)).imported, 2);
    assert.equal(store.importPrizes(1, weekend, codes.slice(0, 2)).imported, 0);
    assert.equal(store.importPrizes(1, normal, codes).imported, 1);
    assert.throws(() => store.importPrizes(1, { ...weekend, min_level: 2 }, []), /保持原名称和解锁等级/);
    store.saveProgress(2, { score: 1000, unlocked: [1, 6], egg_stages: [] });
    assert.throws(() => store.claim(2, weekend.id), /达到解锁等级/);
    const ordinaryCode = store.claim(2, normal.id).code;
    store.saveProgress(2, { score: 2000, unlocked: [1, 8], egg_stages: [] });
    const weekendCode = store.claim(2, weekend.id).code;
    assert.notEqual(ordinaryCode, weekendCode);
    assert.equal(store.claim(2, weekend.id).code, weekendCode);
    assert.equal(store.campaigns().find((c) => c.id === weekend.id).remaining, 1);
  } finally { store.close(); }
});

test('游客正常显示本局生成素材，不解锁账户图鉴，也不能读取其他游客或未遇见的形态', async () => {
  const store = new GameStore(':memory:');
  let clock = Date.now();
  const { server } = await createGameServer({ store, now: () => clock,
    art: new Map([1, 2, 3, 6].map((level) => [`maid:${level}`, Buffer.from(`generated-maid-${level}`)])),
    fetchImpl: async () => { throw new Error('游客不应调用中转站账户服务'); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/games/fat-fish/`;
  const post = (path, payload, cookie) => fetch(base + path, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
  }, body: JSON.stringify(payload) });
  try {
    const response = await post('api/play/run', {});
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    const started = await response.json();
    assert.equal(started.run.guest, true);
    assert.deepEqual(started.play.levels, [1, 2, 3]);
    const imagePath = `api/play/art?run_id=${started.run.id}&level=3`;
    const image = await fetch(base + imagePath, { headers: { Cookie: cookie } });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(await image.text(), 'generated-maid-3');
    assert.equal((await fetch(base + imagePath)).status, 409);
    assert.equal((await fetch(base + imagePath, { headers: { Cookie: 'fat_fish_guest=' + 'f'.repeat(32) } })).status, 409);
    assert.equal((await fetch(base + `api/play/art?run_id=${started.run.id}&level=6`, { headers: { Cookie: cookie } })).status, 403);
    assert.equal((await fetch(base + 'api/art?level=3', { headers: { Cookie: cookie } })).status, 401);
    const payload = { run_id: started.run.id, step: 60, moves: [{ step: 0, x: 240 }] };
    clock += 1000;
    const checked = await (await post('api/play/checkpoint', payload, cookie)).json();
    assert.equal(checked.success, true);
    assert.equal(checked.profile, undefined);
    assert.equal(checked.rewards, undefined);
    assert.deepEqual((await (await post('api/play/checkpoint', payload, cookie)).json()), checked);
    assert.deepEqual(store.profile(1).unlocked, [1]);
    assert.equal((await post('api/rewards/claim', { run_id: started.run.id, campaign_id: 'gift' }, cookie)).status, 401);
    await post('api/play/run', {}, cookie);
    assert.equal((await fetch(base + imagePath, { headers: { Cookie: cookie } })).status, 409);
  } finally { await new Promise((resolve) => server.close(resolve)); store.close(); }
});

test('活动兑换码移除仅限本活动未领取项，可重导入，保留领取记录且不修改 New API 原码', async () => {
  const store = new GameStore(':memory:');
  const campaign = { id: 'pool-a', title: '活动 A', min_level: 6 };
  const other = { id: 'pool-b', title: '活动 B', min_level: 8 };
  const codes = [1, 2, 3, 4].map((id) => ({ id, key: `${'abcdef1234567890'.repeat(2)}-${id}`, name: '移除验证', quota: 51200,
    status: 1, used_user_id: 0, expired_time: id === 3 ? 1 : 0 }));
  store.importPrizes(1, campaign, codes.slice(0, 3));
  store.importPrizes(1, other, codes.slice(3));
  store.saveProgress(2, { score: 500, unlocked: [1, 6], egg_stages: [] });
  const claimed = store.claim(2, campaign.id);
  const upstreamCalls = [];
  const { server } = await createGameServer({ store, art: new Map(), origins: ['http://allowed.test'], fetchImpl: async (url, options) => {
    upstreamCalls.push({ path: new URL(url).pathname, method: options.method || 'GET' });
    const admin = options.headers.Authorization === 'Bearer administrator-token';
    if (new URL(url).pathname === '/api/user/self') return Response.json({ success: true, data: { id: admin ? 1 : 2, role: admin ? 100 : 1 } });
    return Response.json({ success: true, data: new URL(url).pathname.endsWith('/search') ? { items: codes } : codes.find((item) => String(item.id) === new URL(url).pathname.split('/').at(-1)) });
  } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/games/fat-fish/api/admin/`;
  const request = (path, payload, token = 'administrator-token', extra = {}) => fetch(base + path, {
    method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  try {
    assert.equal((await fetch(base + 'prizes?campaign_id=pool-a')).status, 401);
    assert.equal((await request('prizes?campaign_id=pool-a', null, 'ordinary-user-token')).status, 403);
    assert.equal((await request('prizes/remove', { campaign_id: 'pool-a', ids: [2] }, 'ordinary-user-token')).status, 403);
    assert.equal((await request('prizes/remove', { campaign_id: 'pool-a', ids: [2] }, undefined, { Origin: 'http://evil.test' })).status, 403);
    for (const ids of [[], [0], ['2'], [2.5], Array.from({ length: 101 }, (_, i) => i + 1), {}]) {
      assert.equal((await request('prizes/remove', { campaign_id: 'pool-a', ids })).status, 400);
    }
    assert.equal((await request('prizes?campaign_id=pool-a&page=-1')).status, 400);
    const listed = await (await request('prizes?campaign_id=pool-a')).json();
    assert.equal(listed.total, 3);
    assert.equal(listed.items.find((item) => item.redemption_id === 1).removable, false);
    assert.equal(listed.items.find((item) => item.redemption_id === 3).status, 'expired');
    assert.ok(!JSON.stringify(listed).includes(codes[0].key));
    assert.ok(listed.items.every((item) => !('code' in item) && !('claimed_by' in item)));
    const removed = await (await request('prizes/remove', { campaign_id: 'pool-a', ids: [1, 2, 3, 4, 999, 2] })).json();
    assert.equal(removed.removed, 2);
    assert.equal(removed.skipped, 3);
    assert.equal(removed.remaining, 0);
    assert.equal(store.campaignPrizes('pool-b').total, 1);
    assert.equal(store.claim(2, campaign.id).code, claimed.code);
    assert.equal((await (await request('prizes/remove', { campaign_id: 'pool-a', ids: [2, 3] })).json()).removed, 0);
    const candidates = await (await request('candidates?keyword=移除验证')).json();
    assert.deepEqual(candidates.items.map((item) => item.id), [2]);
    const reimport = await (await request('import', { ids: [2], campaign_id: other.id, title: other.title, min_level: other.min_level })).json();
    assert.equal(reimport.imported, 1);
    assert.equal(store.campaignPrizes('pool-b').total, 2);
    assert.equal(store.campaignPrizes('pool-a').total, 1);
    assert.ok(upstreamCalls.every((call) => call.method === 'GET'));
    assert.ok(!JSON.stringify(store.db.prepare("SELECT details FROM audit WHERE action='prizes.remove'").all()).includes(codes[0].key));
  } finally { await new Promise((resolve) => server.close(resolve)); store.close(); }
});

test('活动兑换码按 100 条分页，移除后总数与可重新导入状态一致', () => {
  const store = new GameStore(':memory:');
  try {
    const campaign = { id: 'many', title: '大批次', min_level: 6 };
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, key: `test-only-code-${String(i).padStart(20, '0')}`, name: '批次', quota: 100, expired_time: 0 }));
    store.importPrizes(1, campaign, rows);
    const first = store.campaignPrizes('many');
    const second = store.campaignPrizes('many', 2);
    assert.equal(first.total, 101);
    assert.equal(first.items.length, 100);
    assert.equal(second.items.length, 1);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.redemption_id)).size, 101);
    assert.equal(store.removePrizes(1, 'many', first.items.map((item) => item.redemption_id)).removed, 100);
    assert.equal(store.campaignPrizes('many').total, 1);
    assert.equal(store.importedIds().size, 1);
  } finally { store.close(); }
});

test('真实合成的服务端复算分数能上周榜，重复同步不改变首次达到时间', async () => {
  const store = new GameStore(':memory:');
  let clock = Date.parse('2026-10-24T14:00:00Z');
  const { server } = await createGameServer({ store, now: () => clock, art: new Map(), fetchImpl: async () =>
    Response.json({ success: true, data: { id: 100, role: 1, username: 'private-example-user' } }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/games/fat-fish/api/`;
  const request = (path, payload) => fetch(base + path, { method: payload ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer verified-player-token', 'Content-Type': 'application/json' },
    ...(payload ? { body: JSON.stringify(payload) } : {}) });
  try {
    const { run } = await (await request('run', {})).json();
    const game = createGame({ height: 620, random: seededRandom(run.seed), variantRandom: seededRandom(run.variant_seed) });
    const moves = [];
    while (game.stepIndex < 900 && !game.over) {
      if (game.stepIndex % 30 === 0) {
        const x = 80 + (game.currentLevel - 1) * 160;
        moves.push({ step: game.stepIndex, x });
        assert.ok(dropBody(game, x));
      }
      stepGame(game, 1 / 60);
    }
    assert.ok(game.score > 0);
    clock += Math.ceil(game.stepIndex / 60 * 1000);
    const payload = { run_id: run.id, step: game.stepIndex, moves, score: 999999 };
    const checked = await (await request('run/checkpoint', payload)).json();
    assert.equal(checked.success, true);
    assert.equal(checked.summary.score, game.score);
    const week = weekFor(clock).id;
    const first = store.weeklyScore(week, 100);
    assert.equal(first.score, game.score);
    assert.equal((await (await request('leaderboard/me')).json()).my_rank, 1);
    clock += 1000;
    assert.equal((await request('run/checkpoint', payload)).status, 200);
    assert.equal(store.weeklyScore(week, 100).attained_at, first.attained_at);
    assert.equal(store.weeklyCount(week), 1);
  } finally { await new Promise((resolve) => server.close(resolve)); store.close(); }
});
