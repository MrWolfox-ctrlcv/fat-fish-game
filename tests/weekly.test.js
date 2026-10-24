import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GameStore } from '../backend/store.mjs';
import { createGameServer } from '../backend/app.mjs';
import { previousWeek, weekFor } from '../backend/weekly.mjs';

const weekly = { id: 'weekly-pool', title: '周冠军专属奖池', min_level: 2, kind: 'weekly' };
const normal = { id: 'level-pool', title: '等级谢礼', min_level: 2, kind: 'level' };
const redemption = (id, key = `code-${String(id).padStart(24, 'x')}`) =>
  ({ id, key, name: `code-${id}`, quota: 51200, expired_time: 0 });
const inWeek = (weekId, offset = 1000) => Date.parse(`${weekId}T00:00:00+08:00`) + offset;
const afterWeek = (weekId) => Date.parse(`${weekId}T00:00:00+08:00`) + 7 * 86400000 + 1000;

test('周标识按北京时间周一零点切换，上一周边界与 ISO 值准确', () => {
  const before = Date.parse('2026-10-25T15:59:59.999Z'); // Monday Shanghai 23:59:59.999
  const after = before + 1;
  assert.deepEqual(weekFor(before), {
    id: '2026-10-19', start: Date.parse('2026-10-18T16:00:00.000Z'), end: Date.parse('2026-10-25T16:00:00.000Z'),
    start_at: '2026-10-18T16:00:00.000Z', end_at: '2026-10-25T16:00:00.000Z', label: '2026-10-19 至 2026-10-25',
  });
  assert.equal(weekFor(after).id, '2026-10-26');
  assert.equal(previousWeek(after).id, '2026-10-19');
});

test('同分先达到者获胜，userId只作为相同时间的稳定排序', () => {
  const store = new GameStore(':memory:');
  try {
    store.recordWeeklyScore({ weekId: '2026-10-19', userId: 10, name: '先到', score: 90, maxLevel: 4, runId: 'a', attainedAt: inWeek('2026-10-19', 100) });
    store.recordWeeklyScore({ weekId: '2026-10-19', userId: 2, name: '后到', score: 90, maxLevel: 8, runId: 'b', attainedAt: inWeek('2026-10-19', 101) });
    store.recordWeeklyScore({ weekId: '2026-10-19', userId: 3, name: '更小ID但同刻', score: 90, maxLevel: 5, runId: 'c', attainedAt: inWeek('2026-10-19', 100) });
    store.recordWeeklyScore({ weekId: '2026-10-19', userId: 10, name: '分数持平不改时间', score: 90, maxLevel: 11, runId: 'd', attainedAt: inWeek('2026-10-19', 200) });
    const order = store.weeklyRows('2026-10-19').map((row) => row.user_id);
    assert.deepEqual(order, [3, 10, 2]);
    assert.equal(store.weeklyScore('2026-10-19', 10).attained_at, inWeek('2026-10-19', 100));
    assert.equal(store.weeklyScore('2026-10-19', 10).max_level, 4);
    const settled = store.settleWeek('2026-10-19', afterWeek('2026-10-19'));
    assert.equal(settled.status, 'pending');
    assert.equal(store.recordWeeklyScore({ weekId: '2026-10-19', userId: 10, name: '晚写入', score: 999,
      maxLevel: 11, runId: 'late', attainedAt: inWeek('2026-10-19', 500) }), false);
    assert.equal(store.weeklyScore('2026-10-19', 10).score, 90);
    assert.equal(store.settleWeek('2026-10-26', inWeek('2026-10-26')), null); // current week cannot settle
  } finally { store.close(); }
});

test('专用池只发周奖，连续冠军可跨周各领一张且周奖码不能移除', () => {
  const store = new GameStore(':memory:');
  try {
    store.createCampaign(1, weekly);
    store.createCampaign(1, normal);
    store.importPrizes(1, weekly, [redemption(301), redemption(302)]);
    store.importPrizes(1, normal, [redemption(303)]);
    store.recordWeeklyScore({ weekId: '2026-10-05', userId: 7, name: 'winner@example.com', score: 10, maxLevel: 3, runId: 'r1', attainedAt: inWeek('2026-10-05') });
    store.recordWeeklyScore({ weekId: '2026-10-12', userId: 7, name: 'winner@example.com', score: 12, maxLevel: 4, runId: 'r2', attainedAt: inWeek('2026-10-12') });
    assert.equal(store.settleWeek('2026-10-05', afterWeek('2026-10-05')).status, 'assigned');
    assert.equal(store.settleWeek('2026-10-12', afterWeek('2026-10-12')).status, 'assigned');
    const awards = store.weeklyRewardRows(7);
    assert.equal(awards.length, 2);
    assert.equal(new Set(awards.map((award) => award.code)).size, 2);
    assert.ok(awards.every((award) => award.status === 'assigned'));
    store.saveProgress(7, { score: 20, unlocked: [1, 2], egg_stages: [] });
    const levelReward = store.claim(7, normal.id);
    assert.equal(levelReward.code, redemption(303).key);
    assert.ok(!store.rewards(7).some((reward) => reward.campaign_id === weekly.id));
    const pool = store.campaignPrizes(weekly.id);
    assert.equal(pool.items.filter((item) => !item.removable).length, 2);
    assert.deepEqual(store.removePrizes(1, weekly.id, [301, 302]).removed, 0);
    assert.equal(store.campaigns().find((campaign) => campaign.id === weekly.id).remaining, 0);
    assert.throws(() => store.claim(7, weekly.id), /自动发放/);
  } finally { store.close(); }
});

test('无库存结算保持pending，补库存后自动补发且重复结算不重复占码', () => {
  const store = new GameStore(':memory:');
  try {
    store.createCampaign(1, weekly);
    store.recordWeeklyScore({ weekId: '2026-10-05', userId: 9, name: '冠军', score: 30, maxLevel: 5, runId: 'r', attainedAt: inWeek('2026-10-05') });
    assert.equal(store.settleWeek('2026-10-05', afterWeek('2026-10-05')).status, 'pending');
    store.importPrizes(1, weekly, [{ ...redemption(401, 'expired-weekly-code'), expired_time: Math.floor(afterWeek('2026-10-05') / 1000) - 1 }]);
    assert.equal(store.settleWeek('2026-10-05', afterWeek('2026-10-05') + 500).status, 'pending');
    assert.equal(store.weeklyRewardRows(9).length, 1);
    assert.equal(store.weeklyRewardRows(9)[0].status, 'pending');
    assert.equal(store.weeklyRewardRows(9)[0].code, undefined);
    store.importPrizes(1, weekly, [redemption(402)]);
    assert.equal(store.settleWeek('2026-10-05', afterWeek('2026-10-05') + 2000).status, 'assigned');
    const first = store.weeklyRewardRows(9)[0];
    assert.equal(first.code, redemption(402).key);
    assert.equal(store.settleWeek('2026-10-05', afterWeek('2026-10-05') + 3000).prize_id,
      store.settleWeek('2026-10-05', afterWeek('2026-10-05') + 4000).prize_id);
    assert.equal(store.weeklyRewardRows(9).length, 1);
  } finally { store.close(); }
});

test('无选手的周结算不发奖也不消耗周奖库存', () => {
  const store = new GameStore(':memory:');
  try {
    store.createCampaign(1, weekly);
    store.importPrizes(1, weekly, [redemption(501)]);
    const result = store.settleWeek('2026-10-05', afterWeek('2026-10-05'));
    assert.equal(result.status, 'no_winner');
    assert.equal(result.winner_user_id, null);
    assert.equal(store.campaigns().find((campaign) => campaign.id === weekly.id).remaining, 1);
  } finally { store.close(); }
});

test('数据库重开会保留待补发和已分配状态，历史码不重复发放', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fat-fish-weekly-'));
  const path = join(directory, 'game.sqlite');
  try {
    let store = new GameStore(path);
    store.createCampaign(1, weekly);
    store.recordWeeklyScore({ weekId: '2026-10-05', userId: 12, name: '冠军', score: 5, maxLevel: 2, runId: 'r1', attainedAt: inWeek('2026-10-05') });
    store.settleWeek('2026-10-05', afterWeek('2026-10-05'));
    store.close();
    store = new GameStore(path);
    assert.equal(store.settleWeek('2026-10-05', afterWeek('2026-10-05') + 1000).status, 'pending');
    store.importPrizes(1, weekly, [redemption(601)]);
    store.settleWeek('2026-10-05', afterWeek('2026-10-05') + 2000);
    store.close();
    store = new GameStore(path);
    assert.equal(store.settleWeek('2026-10-05', afterWeek('2026-10-05') + 3000).status, 'assigned');
    assert.equal(store.weeklyRewardRows(12).length, 1);
    assert.equal(store.campaignPrizes(weekly.id).items[0].removable, false);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('停机超过两周后按周补结算，同一冠军可连续领取各周的一张奖品', () => {
  const store = new GameStore(':memory:');
  try {
    store.createCampaign(1, weekly);
    store.importPrizes(1, weekly, [redemption(650), redemption(651), redemption(652)]);
    for (const [index, weekId] of ['2026-10-05', '2026-10-12', '2026-10-19'].entries()) {
      store.recordWeeklyScore({ weekId, userId: 44, name: '连胜者', score: 100 + index, maxLevel: 6,
        runId: `run-${weekId}`, attainedAt: inWeek(weekId) });
    }
    const recovered = store.dueWeeklySettlementWeeks('2026-10-26');
    assert.deepEqual(recovered, ['2026-10-05', '2026-10-12', '2026-10-19']);
    recovered.forEach((weekId) => store.settleWeek(weekId, afterWeek(weekId)));
    const awards = store.weeklyRewardRows(44);
    assert.equal(awards.length, 3);
    assert.equal(new Set(awards.map((award) => award.code)).size, 3);
    assert.deepEqual(store.dueWeeklySettlementWeeks('2026-10-26'), []);
  } finally { store.close(); }
});

test('周奖补库存保留奖池类型，导入冲突类型会拒绝', () => {
  const store = new GameStore(':memory:');
  try {
    store.createCampaign(1, weekly);
    assert.throws(() => store.importPrizes(1, { ...weekly, kind: 'level' }, [redemption(660)]), /保持原名称/);
    assert.equal(store.importPrizes(1, { id: weekly.id, title: weekly.title, min_level: 2 }, [redemption(661)]).imported, 1);
    assert.equal(store.db.prepare('SELECT campaign_kind FROM prizes WHERE redemption_id=661').get().campaign_kind, 'weekly');
  } finally { store.close(); }
});

test('新建数据库仍限制同一等级奖池不能把同一领取人写两次', () => {
  const store = new GameStore(':memory:');
  try {
    store.createCampaign(1, normal);
    store.importPrizes(1, normal, [redemption(670), redemption(671)]);
    store.db.prepare('UPDATE prizes SET claimed_by=? WHERE redemption_id=?').run(8, 670);
    assert.throws(() => store.db.prepare('UPDATE prizes SET claimed_by=? WHERE redemption_id=?').run(8, 671), /UNIQUE constraint failed/);
  } finally { store.close(); }
});

test('旧数据库迁移保留原活动、领取人和兑换码，不重建奖品表', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fat-fish-legacy-'));
  const path = join(directory, 'game.sqlite');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE campaigns(id TEXT PRIMARY KEY,title TEXT NOT NULL,min_level INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE prizes(id INTEGER PRIMARY KEY,redemption_id INTEGER NOT NULL UNIQUE,code TEXT NOT NULL UNIQUE,campaign_id TEXT NOT NULL,
        name TEXT NOT NULL,quota INTEGER NOT NULL,expired_time INTEGER NOT NULL,imported_by INTEGER NOT NULL,imported_at INTEGER NOT NULL,
        claimed_by INTEGER,claimed_at INTEGER,UNIQUE(campaign_id,claimed_by));
      CREATE TABLE profiles(user_id INTEGER PRIMARY KEY,best INTEGER NOT NULL DEFAULT 0,unlocked TEXT NOT NULL DEFAULT '[1]',
        egg_stages TEXT NOT NULL DEFAULT '[]',updated_at INTEGER NOT NULL);
      CREATE TABLE audit(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL);
      INSERT INTO campaigns VALUES('old','旧奖池',2,1);
      INSERT INTO prizes VALUES(8,808,'legacy-redemption-code','old','legacy',51200,0,1,1,42,1234);`);
    legacy.close();
    const store = new GameStore(path);
    try {
      assert.equal(store.db.prepare("SELECT kind FROM campaigns WHERE id='old'").get().kind, 'level');
      const migrated = store.db.prepare('SELECT code,claimed_by,claimed_at,campaign_kind FROM prizes WHERE id=8').get();
      assert.deepEqual({ ...migrated }, { code: 'legacy-redemption-code', claimed_by: 42, claimed_at: 1234, campaign_kind: 'level' });
      assert.equal(store.db.prepare('PRAGMA index_list(prizes)').all().some((index) => index.unique && index.origin === 'u'), true);
    } finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('补跑迁移时把已有周榜活动库存从默认level纠正为weekly', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fat-fish-weekly-kind-'));
  const path = join(directory, 'game.sqlite');
  try {
    const partial = new DatabaseSync(path);
    partial.exec(`CREATE TABLE campaigns(id TEXT PRIMARY KEY,title TEXT NOT NULL,min_level INTEGER NOT NULL,created_at INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'level');
      CREATE TABLE prizes(id INTEGER PRIMARY KEY,redemption_id INTEGER NOT NULL UNIQUE,code TEXT NOT NULL UNIQUE,campaign_id TEXT NOT NULL,
        name TEXT NOT NULL,quota INTEGER NOT NULL,expired_time INTEGER NOT NULL,imported_by INTEGER NOT NULL,imported_at INTEGER NOT NULL,
        claimed_by INTEGER,claimed_at INTEGER,campaign_kind TEXT NOT NULL DEFAULT 'level',UNIQUE(campaign_id,claimed_by));
      CREATE TABLE profiles(user_id INTEGER PRIMARY KEY,best INTEGER NOT NULL DEFAULT 0,unlocked TEXT NOT NULL DEFAULT '[1]',egg_stages TEXT NOT NULL DEFAULT '[]',updated_at INTEGER NOT NULL);
      CREATE TABLE audit(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL);
      INSERT INTO campaigns VALUES('weekly-existing','周榜',2,1,'weekly');
      INSERT INTO prizes VALUES(1,990,'weekly-existing-code','weekly-existing','weekly',51200,0,1,1,NULL,NULL,'level');`);
    partial.close();
    const store = new GameStore(path);
    try {
      assert.equal(store.db.prepare('SELECT campaign_kind FROM prizes WHERE redemption_id=990').get().campaign_kind, 'weekly');
    } finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('API 仅用核验分记周榜，跨周对局不计入旧榜，公开榜不泄露账号或兑换码', async () => {
  let clock = Date.parse('2026-10-25T15:59:59.000Z');
  let crossingDuringVerify = false;
  let clockCalls = 0;
  const now = () => {
    if (crossingDuringVerify && ++clockCalls === 6) {
      clock = Date.parse('2026-10-25T16:00:01.000Z');
      crossingDuringVerify = false;
    }
    return clock;
  };
  const store = new GameStore(':memory:');
  store.createCampaign(1, weekly);
  store.importPrizes(1, weekly, [redemption(701)]);
  store.recordWeeklyScore({ weekId: '2026-10-19', userId: 3, name: 'secret@example.com', score: 88, maxLevel: 4, runId: 'seed', attainedAt: clock - 2000 });
  const fetchImpl = async (_url, options) => {
    const token = options.headers.Authorization;
    const users = { 'Bearer player-one-token': { id: 1, role: 1, username: 'private.player@example.com' },
      'Bearer winner-three-token': { id: 3, role: 1, username: 'secret@example.com' } };
    const user = users[token];
    return user ? Response.json({ success: true, data: user }) : Response.json({ success: false }, { status: 401 });
  };
  const { server } = await createGameServer({ store, now, fetchImpl, art: new Map() });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/games/fat-fish/`;
  const request = (path, token) => fetch(base + path, token ? { headers: { Authorization: token } } : {});
  try {
    const started = await (await fetch(base + 'api/run', { method: 'POST', headers: { Authorization: 'Bearer player-one-token' }, body: '{}' })).json();
    crossingDuringVerify = true;
    clockCalls = 0;
    const checkpoint = await fetch(base + 'api/run/checkpoint', { method: 'POST', headers: { Authorization: 'Bearer player-one-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: started.run.id, step: 60, moves: [{ step: 0, x: 240 }], score: 999999, max_level: 11 }) });
    assert.equal(checkpoint.status, 200);
    assert.equal(store.weeklyRows('2026-10-19').length, 1);
    assert.equal(store.weeklyScore('2026-10-19', 3).score, 88);
    assert.equal(store.weeklyRows('2026-10-26').length, 0); // started before week boundary

    const currentStarted = await (await fetch(base + 'api/run', { method: 'POST', headers: { Authorization: 'Bearer player-one-token' }, body: '{}' })).json();
    const currentCheckpoint = await fetch(base + 'api/run/checkpoint', { method: 'POST', headers: { Authorization: 'Bearer player-one-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: currentStarted.run.id, step: 60, moves: [{ step: 0, x: 240 }], score: 999999, max_level: 11 }) });
    assert.equal(currentCheckpoint.status, 200);
    assert.equal(store.weeklyRows('2026-10-26').length, 0); // fabricated request score does not create a verified score

    const publicResponse = await request('api/leaderboard?period=previous');
    const publicBody = await publicResponse.json();
    assert.equal(publicResponse.status, 200);
    assert.equal(publicBody.week.id, '2026-10-19');
    assert.equal(publicBody.total, 1);
    assert.equal(publicBody.winner.status, 'assigned');
    assert.ok(!JSON.stringify(publicBody).includes('secret@example.com'));
    assert.ok(!JSON.stringify(publicBody).includes(redemption(701).key));
    assert.ok(!JSON.stringify(publicBody).includes('user_id'));
    assert.equal((await request('api/leaderboard?period=all')).status, 400);
    assert.equal((await request('api/leaderboard/me')).status, 401);
    const privateBody = await (await request('api/leaderboard/me', 'Bearer winner-three-token')).json();
    assert.equal(privateBody.weekly_rewards[0].status, 'assigned');
    assert.equal(privateBody.weekly_rewards[0].code, redemption(701).key);
    assert.equal((await request('api/me', 'Bearer winner-three-token').then((response) => response.json())).weekly_rewards[0].code, redemption(701).key);
  } finally { await new Promise((resolve) => server.close(resolve)); store.close(); }
});
