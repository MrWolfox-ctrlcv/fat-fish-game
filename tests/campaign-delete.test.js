import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GameStore } from '../backend/store.mjs';

const levelCampaign = (id, title = 'Unused campaign') => ({ id, title, min_level: 2, kind: 'level' });
const weeklyCampaign = (id, title = 'Weekly rewards') => ({ id, title, min_level: 2, kind: 'weekly' });
const prize = (id) => ({ id, key: `unused-code-${id}`, name: `batch-${id}`, quota: 51200, expired_time: 0 });
const inWeek = (weekId) => Date.parse(`${weekId}T00:00:00+08:00`) + 1000;
const afterWeek = (weekId) => Date.parse(`${weekId}T00:00:00+08:00`) + 7 * 86400000 + 1000;

test('旧数据库迁移新增deleted_at且保留活动为未删除', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fat-fish-campaign-delete-migration-'));
  const path = join(directory, 'game.sqlite');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE campaigns(id TEXT PRIMARY KEY,title TEXT NOT NULL,min_level INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE prizes(id INTEGER PRIMARY KEY,redemption_id INTEGER NOT NULL UNIQUE,code TEXT NOT NULL UNIQUE,campaign_id TEXT NOT NULL,
        name TEXT NOT NULL,quota INTEGER NOT NULL,expired_time INTEGER NOT NULL,imported_by INTEGER NOT NULL,imported_at INTEGER NOT NULL,
        claimed_by INTEGER,claimed_at INTEGER,UNIQUE(campaign_id,claimed_by));
      CREATE TABLE profiles(user_id INTEGER PRIMARY KEY,best INTEGER NOT NULL DEFAULT 0,unlocked TEXT NOT NULL DEFAULT '[1]',egg_stages TEXT NOT NULL DEFAULT '[]',updated_at INTEGER NOT NULL);
      CREATE TABLE audit(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL);
      INSERT INTO campaigns VALUES('old','Old campaign',2,1);`);
    legacy.close();
    const store = new GameStore(path);
    try {
      assert.equal(store.db.prepare('SELECT deleted_at FROM campaigns WHERE id=?').get('old').deleted_at, 0);
      assert.equal(store.campaigns().some((campaign) => campaign.id === 'old'), true);
    } finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('删除不存在活动返回404且不自动创建默认活动', () => {
  const store = new GameStore(':memory:');
  try {
    assert.throws(() => store.deleteCampaign(1, 'missing'), (error) => error.status === 404);
    assert.deepEqual(store.campaigns(), []);
  } finally { store.close(); }
});

test('删除活动释放未领取奖品，保留已领记录并审计数量', () => {
  const store = new GameStore(':memory:');
  try {
    const campaign = levelCampaign('gift');
    store.importPrizes(1, campaign, [prize(101), prize(102)]);
    store.saveProgress(7, { score: 20, unlocked: [1, 2], egg_stages: [] });
    const claimed = store.claim(7, campaign.id);
    const result = store.deleteCampaign(1, campaign.id);
    assert.deepEqual(result, { campaign_id: 'gift', removed_prizes: 1, retained_prizes: 1 });
    assert.deepEqual(store.campaigns(), []);
    assert.deepEqual(store.rewards(7), []);
    assert.equal(store.db.prepare('SELECT deleted_at FROM campaigns WHERE id=?').get('gift').deleted_at > 0, true);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM prizes WHERE campaign_id=?').get('gift').count, 1);
    assert.equal(store.db.prepare('SELECT code FROM prizes WHERE campaign_id=?').get('gift').code, claimed.code);
    assert.equal(store.importedIds().has(102), false);
    assert.deepEqual(JSON.parse(store.db.prepare("SELECT details FROM audit WHERE action='campaign_delete'").get().details),
      { campaign_id: 'gift', removed_prizes: 1, retained_prizes: 1 });
    assert.throws(() => store.deleteCampaign(1, campaign.id), (error) => error.status === 409);
    assert.throws(() => store.claim(7, campaign.id), (error) => error.status === 404);
  } finally { store.close(); }
});

test('删除活动保留weekly奖励分配和关联奖品，且归档活动不再供后续结算挑选', () => {
  const store = new GameStore(':memory:');
  try {
    const oldPool = weeklyCampaign('old-weekly', 'Same title');
    store.importPrizes(1, oldPool, [prize(201), prize(202), prize(204)]);
    store.recordWeeklyScore({ weekId: '2026-10-19', userId: 8, name: 'winner', score: 99, maxLevel: 5,
      runId: 'old-week', attainedAt: inWeek('2026-10-19') });
    const oldReward = store.settleWeek('2026-10-19', afterWeek('2026-10-19'));
    assert.equal(oldReward.status, 'assigned');
    const oldPrizeId = oldReward.prize_id;
    const reservedPrizeId = store.db.prepare('SELECT id FROM prizes WHERE redemption_id=204').get().id;
    store.db.prepare(`INSERT INTO weekly_settlements
      (week_id,winner_user_id,status,created_at,prize_id) VALUES(?,?,?,?,?)`)
      .run('2026-10-12', 7, 'pending', Date.now(), reservedPrizeId);
    const deleted = store.deleteCampaign(1, oldPool.id);
    assert.deepEqual(deleted, { campaign_id: oldPool.id, removed_prizes: 1, retained_prizes: 2 });
    assert.equal(store.db.prepare('SELECT prize_id FROM weekly_awards WHERE week_id=?').get('2026-10-19').prize_id, oldPrizeId);
    assert.equal(store.db.prepare('SELECT id FROM prizes WHERE id=?').get(reservedPrizeId).id, reservedPrizeId);
    assert.equal(store.weeklyRewardRows(8)[0].status, 'assigned');

    const newPool = weeklyCampaign('new-weekly', 'Same title');
    store.importPrizes(1, newPool, [prize(203)]);
    store.recordWeeklyScore({ weekId: '2026-10-26', userId: 9, name: 'next winner', score: 110, maxLevel: 6,
      runId: 'new-week', attainedAt: inWeek('2026-10-26') });
    const nextReward = store.settleWeek('2026-10-26', afterWeek('2026-10-26'));
    assert.equal(nextReward.status, 'assigned');
    assert.equal(store.db.prepare('SELECT p.redemption_id FROM prizes p WHERE p.id=?').get(nextReward.prize_id).redemption_id, 203);
  } finally { store.close(); }
});

test('归档活动拒绝导入和同ID重建，允许同名新ID活动并可重新导入已释放兑换码', () => {
  const store = new GameStore(':memory:');
  try {
    const archived = levelCampaign('archived', 'Repeated title');
    store.importPrizes(1, archived, [prize(301)]);
    store.deleteCampaign(1, archived.id);
    assert.throws(() => store.importPrizes(1, archived, [prize(301)]), (error) => error.status === 409);
    assert.throws(() => store.createCampaign(1, archived), (error) => error.status === 409);
    const replacement = levelCampaign('replacement', archived.title);
    assert.equal(store.createCampaign(1, replacement).id, replacement.id);
    assert.equal(store.importPrizes(1, replacement, [prize(301)]).imported, 1);
  } finally { store.close(); }
});
