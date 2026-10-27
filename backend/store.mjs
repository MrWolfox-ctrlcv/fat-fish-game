import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { weekFor } from './weekly.mjs';

export class GameStore {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') { try { chmodSync(path, 0o600); } catch {} }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS profiles (
        user_id INTEGER PRIMARY KEY, best INTEGER NOT NULL DEFAULT 0,
        unlocked TEXT NOT NULL DEFAULT '[1]', egg_stages TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, min_level INTEGER NOT NULL, created_at INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'level', deleted_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS prizes (
        id INTEGER PRIMARY KEY, redemption_id INTEGER NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE,
        campaign_id TEXT NOT NULL, name TEXT NOT NULL, quota INTEGER NOT NULL,
        expired_time INTEGER NOT NULL, imported_by INTEGER NOT NULL, imported_at INTEGER NOT NULL,
        claimed_by INTEGER, claimed_at INTEGER, campaign_kind TEXT NOT NULL DEFAULT 'level',
        UNIQUE(campaign_id, claimed_by)
      );
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, action TEXT NOT NULL,
        details TEXT NOT NULL, created_at INTEGER NOT NULL
      );`);
    this.migrateWeeklySchema();
  }

  migrateWeeklySchema() {
    const addColumn = (table, name, definition) => {
      if (!this.db.prepare(`PRAGMA table_info(${table})`).all().some((column) => column.name === name)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      }
    };
    addColumn('campaigns', 'kind', "TEXT NOT NULL DEFAULT 'level'");
    addColumn('campaigns', 'deleted_at', 'INTEGER NOT NULL DEFAULT 0');
    const prizeColumns = this.db.prepare('PRAGMA table_info(prizes)').all();
    const hasCampaignKind = prizeColumns.some((column) => column.name === 'campaign_kind');
    if (!hasCampaignKind) {
      this.db.exec(`ALTER TABLE prizes ADD COLUMN campaign_kind TEXT NOT NULL DEFAULT 'level';
        UPDATE prizes SET campaign_kind=COALESCE((SELECT kind FROM campaigns WHERE campaigns.id=prizes.campaign_id),'level');`);
    } else {
      this.db.exec(`UPDATE prizes SET campaign_kind=COALESCE((SELECT kind FROM campaigns WHERE campaigns.id=prizes.campaign_id),'level')
        WHERE campaign_kind='level' AND EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id=prizes.campaign_id AND campaigns.kind='weekly');`);
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS prizes_available ON prizes(campaign_id, claimed_by, expired_time);
      CREATE TABLE IF NOT EXISTS weekly_scores (
        week_id TEXT NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL,
        max_level INTEGER NOT NULL, attained_at INTEGER NOT NULL, run_id TEXT NOT NULL,
        PRIMARY KEY(week_id,user_id)
      );
      CREATE INDEX IF NOT EXISTS weekly_scores_rank ON weekly_scores(week_id,score DESC,attained_at,user_id);
      CREATE TABLE IF NOT EXISTS weekly_run_scores (
        week_id TEXT NOT NULL, user_id INTEGER NOT NULL, run_id TEXT NOT NULL, name TEXT NOT NULL,
        score INTEGER NOT NULL, max_level INTEGER NOT NULL, attained_at INTEGER NOT NULL,
        used_props INTEGER NOT NULL DEFAULT 0 CHECK(used_props IN (0,1)),
        PRIMARY KEY(week_id,user_id,run_id)
      );
      CREATE INDEX IF NOT EXISTS weekly_run_scores_rank ON weekly_run_scores(week_id,score DESC,attained_at,user_id);
      CREATE TABLE IF NOT EXISTS weekly_prop_runs (
        week_id TEXT NOT NULL, user_id INTEGER NOT NULL, run_id TEXT NOT NULL, first_used_at INTEGER NOT NULL,
        PRIMARY KEY(week_id,user_id,run_id)
      );
      CREATE TABLE IF NOT EXISTS weekly_settlements (
        week_id TEXT PRIMARY KEY, winner_user_id INTEGER, winner_name TEXT, score INTEGER,
        max_level INTEGER, attained_at INTEGER, prize_id INTEGER UNIQUE, status TEXT NOT NULL,
        created_at INTEGER NOT NULL, assigned_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS weekly_awards (
        id INTEGER PRIMARY KEY AUTOINCREMENT, week_id TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL, prize_id INTEGER NOT NULL UNIQUE, assigned_at INTEGER NOT NULL
      );`);
    // Preserve historic weekly records as normal-play entries. Keep settlements untouched.
    this.db.exec(`INSERT OR IGNORE INTO weekly_run_scores
      (week_id,user_id,run_id,name,score,max_level,attained_at,used_props)
      SELECT s.week_id,s.user_id,s.run_id,s.name,s.score,s.max_level,s.attained_at,0 FROM weekly_scores s
      WHERE NOT EXISTS (SELECT 1 FROM weekly_prop_runs p WHERE p.week_id=s.week_id AND p.user_id=s.user_id AND p.run_id=s.run_id);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS prop_receipts (
      request_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, run_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','committed','failed')),
      receipt_id TEXT NOT NULL UNIQUE, quota INTEGER NOT NULL, kind TEXT NOT NULL,
      body_ids TEXT NOT NULL, step INTEGER NOT NULL, week_id TEXT, name TEXT,
      move_count INTEGER NOT NULL DEFAULT 0, prop_revision INTEGER NOT NULL DEFAULT 0,
      state TEXT, summary TEXT, profile TEXT,
      rewards TEXT, play TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS prop_receipts_user_run ON prop_receipts(user_id,run_id);`);
    addColumn('prop_receipts', 'week_id', 'TEXT');
    addColumn('prop_receipts', 'name', 'TEXT');
    addColumn('prop_receipts', 'move_count', 'INTEGER NOT NULL DEFAULT 0');
    addColumn('prop_receipts', 'prop_revision', 'INTEGER NOT NULL DEFAULT 0');
  }

  profile(userId) {
    const row = this.db.prepare('SELECT best,unlocked,egg_stages FROM profiles WHERE user_id=?').get(userId);
    return row ? { best: row.best, unlocked: JSON.parse(row.unlocked), egg_stages: JSON.parse(row.egg_stages) }
      : { best: 0, unlocked: [1], egg_stages: [] };
  }

  saveProgress(userId, summary) {
    const profile = this.previewProgress(userId, summary);
    this.db.prepare(`INSERT INTO profiles(user_id,best,unlocked,egg_stages,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET best=excluded.best, unlocked=excluded.unlocked,
        egg_stages=excluded.egg_stages, updated_at=excluded.updated_at`)
      .run(userId, profile.best, JSON.stringify(profile.unlocked), JSON.stringify(profile.egg_stages), Date.now());
    return profile;
  }

  previewProgress(userId, summary) {
    const previous = this.profile(userId);
    return { best: Math.max(previous.best, summary.score),
      unlocked: [...new Set([...previous.unlocked, ...summary.unlocked])].sort((a, b) => a - b),
      egg_stages: [...new Set([...previous.egg_stages, ...summary.egg_stages])].sort() };
  }

  rewards(userId, profile = this.profile(userId)) {
    const max = Math.max(...profile.unlocked);
    const now = Math.floor(Date.now() / 1000);
    return this.db.prepare("SELECT * FROM campaigns WHERE kind='level' AND deleted_at=0 ORDER BY created_at,id").all().map((campaign) => {
      const mine = this.db.prepare('SELECT code,quota,expired_time FROM prizes WHERE campaign_id=? AND claimed_by=?')
        .get(campaign.id, userId);
      const available = this.db.prepare(`SELECT quota,expired_time FROM prizes WHERE campaign_id=?
        AND claimed_by IS NULL AND (expired_time=0 OR expired_time>?) ORDER BY id LIMIT 1`).get(campaign.id, now);
      return {
        campaign_id: campaign.id, title: campaign.title, min_level: campaign.min_level,
        status: mine ? 'claimed' : !available ? 'empty' : max >= campaign.min_level ? 'available' : 'locked',
        ...(mine ?? available ?? { quota: 0, expired_time: 0 }),
      };
    });
  }

  campaigns() {
    return this.db.prepare(`SELECT c.id,c.title,c.min_level,c.kind,COUNT(p.id) AS total,
      SUM(CASE WHEN p.id IS NOT NULL AND p.claimed_by IS NULL AND (p.expired_time=0 OR p.expired_time>?) THEN 1 ELSE 0 END) AS remaining
      FROM campaigns c LEFT JOIN prizes p ON p.campaign_id=c.id WHERE c.deleted_at=0 GROUP BY c.id ORDER BY c.created_at DESC`)
      .all(Math.floor(Date.now() / 1000));
  }

  recordWeeklyScore({ weekId, userId, name, score, maxLevel, runId, attainedAt, usedProps = false, inTransaction = false }) {
    if (!Number.isSafeInteger(score) || (!usedProps && score <= 0) || weekFor(attainedAt).id !== weekId) return false;
    if (!inTransaction) this.db.exec('BEGIN IMMEDIATE');
    try {
      if (usedProps) this.markWeeklyRunUsedProps({ weekId, userId, runId, attainedAt });
      // A result that arrives after its week has been settled must never revise its winner.
      if (this.db.prepare('SELECT 1 FROM weekly_settlements WHERE week_id=?').get(weekId)) {
        if (!inTransaction) this.db.exec('COMMIT');
        return false;
      }
      if (score <= 0) { if (!inTransaction) this.db.exec('COMMIT'); return false; }
      const result = this.db.prepare(`INSERT INTO weekly_run_scores
        (week_id,user_id,run_id,name,score,max_level,attained_at,used_props) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(week_id,user_id,run_id) DO UPDATE SET
          name=excluded.name,score=excluded.score,max_level=excluded.max_level,attained_at=excluded.attained_at,
          used_props=MAX(weekly_run_scores.used_props,excluded.used_props)
        WHERE excluded.score > weekly_run_scores.score OR excluded.used_props > weekly_run_scores.used_props`)
        .run(weekId, userId, runId, String(name || ''), score, maxLevel, attainedAt, Number(usedProps));
      if (!usedProps) this.db.prepare(`INSERT INTO weekly_scores(week_id,user_id,name,score,max_level,attained_at,run_id)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(week_id,user_id) DO UPDATE SET
          name=excluded.name,score=excluded.score,max_level=excluded.max_level,attained_at=excluded.attained_at,run_id=excluded.run_id
        WHERE excluded.score > weekly_scores.score`).run(weekId, userId, String(name || ''), score, maxLevel, attainedAt, runId);
      if (!inTransaction) this.db.exec('COMMIT');
      return Number(result.changes) === 1;
    } catch (error) { if (!inTransaction) this.db.exec('ROLLBACK'); throw error; }
  }

  markWeeklyRunUsedProps({ weekId, userId, runId, attainedAt }) {
    this.db.prepare('INSERT OR IGNORE INTO weekly_prop_runs(week_id,user_id,run_id,first_used_at) VALUES(?,?,?,?)')
      .run(weekId, userId, runId, attainedAt);
    this.db.prepare('DELETE FROM weekly_run_scores WHERE week_id=? AND user_id=? AND run_id=? AND used_props=0')
      .run(weekId, userId, runId);
    this.db.prepare('DELETE FROM weekly_scores WHERE week_id=? AND user_id=?').run(weekId, userId);
    this.db.prepare(`INSERT INTO weekly_scores(week_id,user_id,name,score,max_level,attained_at,run_id)
      SELECT week_id,user_id,name,score,max_level,attained_at,run_id FROM weekly_run_scores
      WHERE week_id=? AND user_id=? AND used_props=0 ORDER BY score DESC,attained_at ASC,run_id ASC LIMIT 1`)
      .run(weekId, userId);
  }

  propReceipt(requestId) {
    const row = this.db.prepare('SELECT * FROM prop_receipts WHERE request_id=?').get(requestId);
    if (!row) return null;
    for (const key of ['state', 'summary', 'profile', 'rewards', 'play']) row[key] = row[key] == null ? null : JSON.parse(row[key]);
    row.body_ids = JSON.parse(row.body_ids);
    return row;
  }

  createPropReceipt({ requestId, userId, runId, fingerprint, receiptId, kind, bodyIds, step, now, weekId = null, name = '',
    moveCount = 0, propRevision = 0, state = null, summary = null, profile = null, rewards = null, play = null }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.propReceipt(requestId);
      if (existing) { this.db.exec('COMMIT'); return { ...existing, created: false }; }
      this.db.prepare(`INSERT INTO prop_receipts
        (request_id,user_id,run_id,fingerprint,status,receipt_id,quota,kind,body_ids,step,week_id,name,move_count,prop_revision,state,summary,profile,rewards,play,created_at,updated_at)
        VALUES(?,?,?,?,'pending',?,5000,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(requestId, userId, runId, fingerprint, receiptId, kind, JSON.stringify(bodyIds), step, weekId, name, moveCount, propRevision,
          state === null ? null : JSON.stringify(state), summary === null ? null : JSON.stringify(summary),
          profile === null ? null : JSON.stringify(profile), rewards === null ? null : JSON.stringify(rewards),
          play === null ? null : JSON.stringify(play), now, now);
      this.db.exec('COMMIT');
      return { ...this.propReceipt(requestId), created: true };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  failPropReceipt(requestId, now) {
    this.db.prepare("UPDATE prop_receipts SET status='failed',updated_at=? WHERE request_id=? AND status='pending'")
      .run(now, requestId);
  }

  pendingPropReceipt(userId) {
    const row = this.db.prepare("SELECT receipt_id,quota,request_id,run_id FROM prop_receipts WHERE user_id=? AND status='pending' ORDER BY created_at LIMIT 1")
      .get(userId);
    return row || null;
  }

  commitPropReceipt({ requestId, now, state, summary, profile, rewards, play, week, userId, name, runId, usedProps }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const receipt = this.db.prepare('SELECT status FROM prop_receipts WHERE request_id=?').get(requestId);
      if (!receipt || receipt.status !== 'pending') throw Object.assign(new Error('道具支付状态已变化。'), { status: 409, code: 'PROP_RECEIPT_CONFLICT' });
      const persistedProfile = this.saveProgress(userId, summary);
      this.markWeeklyRunUsedProps({ weekId: week, userId, runId, attainedAt: now });
      if (week === weekFor(now).id) this.recordWeeklyScore({ weekId: week, userId, name, score: summary.score,
        maxLevel: summary.max_level, runId, attainedAt: now, usedProps, inTransaction: true });
      this.db.prepare(`UPDATE prop_receipts SET status='committed',state=?,summary=?,profile=?,rewards=?,play=?,updated_at=?
        WHERE request_id=? AND status='pending'`).run(JSON.stringify(state), JSON.stringify(summary),
        JSON.stringify({ ...persistedProfile, user_id: userId }), JSON.stringify(this.rewards(userId, persistedProfile)), JSON.stringify(play), now, requestId);
      this.db.exec('COMMIT');
      return this.propReceipt(requestId);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  weeklyEntries(weekId, usedProps = null) {
    return this.db.prepare(`WITH ranked AS (
      SELECT user_id,name,score,max_level,attained_at,used_props,
        ROW_NUMBER() OVER (PARTITION BY user_id,used_props ORDER BY score DESC,attained_at ASC,run_id ASC) AS pick
      FROM weekly_run_scores WHERE week_id=? ${usedProps === null ? '' : 'AND used_props=?'}
    ) SELECT user_id,name,score,max_level,attained_at,used_props FROM ranked WHERE pick=1
      ORDER BY score DESC,attained_at ASC,user_id ASC,used_props ASC`)
      .all(...(usedProps === null ? [weekId] : [weekId, Number(usedProps)]));
  }

  weeklyRows(weekId, limit = 20, usedProps = null) {
    return this.db.prepare(`WITH ranked AS (
      SELECT user_id,name,score,max_level,attained_at,used_props,
        ROW_NUMBER() OVER (PARTITION BY user_id,used_props ORDER BY score DESC,attained_at ASC,run_id ASC) AS pick
      FROM weekly_run_scores WHERE week_id=? ${usedProps === null ? '' : 'AND used_props=?'}
    ) SELECT user_id,name,score,max_level,attained_at,used_props FROM ranked WHERE pick=1
      ORDER BY score DESC,attained_at ASC,user_id ASC,used_props ASC LIMIT ?`)
      .all(...(usedProps === null ? [weekId, limit] : [weekId, Number(usedProps), limit]));
  }

  weeklyCount(weekId, usedProps = 0) {
    return this.db.prepare(`WITH ranked AS (
      SELECT user_id,used_props,ROW_NUMBER() OVER (PARTITION BY user_id,used_props ORDER BY score DESC,attained_at ASC,run_id ASC) AS pick
      FROM weekly_run_scores WHERE week_id=? ${usedProps === null ? '' : 'AND used_props=?'}
    ) SELECT COUNT(*) AS count FROM ranked WHERE pick=1`)
      .get(...(usedProps === null ? [weekId] : [weekId, Number(usedProps)])).count;
  }

  weeklyScore(weekId, userId, usedProps = 0) {
    return this.db.prepare(`SELECT user_id,name,score,max_level,attained_at,used_props FROM weekly_run_scores
      WHERE week_id=? AND user_id=? AND used_props=? ORDER BY score DESC,attained_at ASC,run_id ASC LIMIT 1`)
      .get(weekId, userId, Number(usedProps)) || null;
  }

  weeklyRank(weekId, userId, usedProps = 0) {
    const mine = this.weeklyScore(weekId, userId, usedProps);
    if (!mine) return null;
    return this.db.prepare(`WITH ranked AS (
      SELECT user_id,score,attained_at,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC,attained_at ASC,run_id ASC) AS pick
      FROM weekly_run_scores WHERE week_id=? AND used_props=?
    ) SELECT COUNT(*) AS ahead FROM ranked WHERE pick=1 AND
      (score>? OR (score=? AND (attained_at<? OR (attained_at=? AND user_id<?))))`)
      .get(weekId, Number(usedProps), mine.score, mine.score, mine.attained_at, mine.attained_at, userId).ahead + 1;
  }

  weeklyMixedRank(weekId, userId, usedProps) {
    const mine = this.weeklyScore(weekId, userId, usedProps);
    if (!mine) return null;
    return this.db.prepare(`WITH ranked AS (
      SELECT user_id,score,attained_at,used_props,
        ROW_NUMBER() OVER (PARTITION BY user_id,used_props ORDER BY score DESC,attained_at ASC,run_id ASC) AS pick
      FROM weekly_run_scores WHERE week_id=?
    ), entries AS (SELECT user_id,score,attained_at,used_props FROM ranked WHERE pick=1)
    SELECT COUNT(*) AS ahead FROM entries WHERE score>? OR
      (score=? AND (attained_at<? OR (attained_at=? AND (user_id<? OR (user_id=? AND used_props<?)))))`)
      .get(weekId, mine.score, mine.score, mine.attained_at, mine.attained_at, userId, userId, Number(usedProps)).ahead + 1;
  }

  dueWeeklySettlementWeeks(currentWeekId) {
    return this.db.prepare(`SELECT s.week_id FROM weekly_run_scores s LEFT JOIN weekly_settlements w ON w.week_id=s.week_id
      WHERE s.week_id<? AND w.week_id IS NULL
      UNION SELECT week_id FROM weekly_settlements WHERE status='pending' AND week_id<? ORDER BY week_id`)
      .all(currentWeekId, currentWeekId).map((row) => row.week_id);
  }

  settleWeek(weekId, timestamp = Date.now()) {
    if (weekId >= weekFor(timestamp).id) return null;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let settlement = this.db.prepare('SELECT * FROM weekly_settlements WHERE week_id=?').get(weekId);
      if (!settlement) {
        const winner = this.weeklyRows(weekId, 1, null)[0];
        this.db.prepare(`INSERT INTO weekly_settlements
          (week_id,winner_user_id,winner_name,score,max_level,attained_at,status,created_at)
          VALUES(?,?,?,?,?,?,?,?)`).run(weekId, winner?.user_id ?? null, winner?.name ?? null,
          winner?.score ?? null, winner?.max_level ?? null, winner?.attained_at ?? null,
          winner ? 'pending' : 'no_winner', timestamp);
        settlement = this.db.prepare('SELECT * FROM weekly_settlements WHERE week_id=?').get(weekId);
      }
      if (settlement.status === 'pending') {
        const prize = this.db.prepare(`SELECT p.id,p.campaign_id FROM prizes p JOIN campaigns c ON c.id=p.campaign_id
          WHERE c.kind='weekly' AND c.deleted_at=0 AND p.campaign_kind='weekly' AND p.claimed_by IS NULL
            AND (p.expired_time=0 OR p.expired_time>?) ORDER BY c.created_at,c.id,p.id LIMIT 1`)
          .get(Math.floor(timestamp / 1000));
        if (prize) {
          const assignedAt = timestamp;
          const award = this.db.prepare('INSERT INTO weekly_awards(week_id,user_id,prize_id,assigned_at) VALUES(?,?,?,?)')
            .run(weekId, settlement.winner_user_id, prize.id, assignedAt);
          const claimedBy = -Number(award.lastInsertRowid);
          const claimed = this.db.prepare('UPDATE prizes SET claimed_by=?,claimed_at=? WHERE id=? AND claimed_by IS NULL')
            .run(claimedBy, assignedAt, prize.id);
          if (Number(claimed.changes) === 1) {
            this.db.prepare(`UPDATE weekly_settlements SET prize_id=?,status='assigned',assigned_at=? WHERE week_id=? AND status='pending'`)
              .run(prize.id, assignedAt, weekId);
            this.db.prepare('INSERT INTO audit(user_id,action,details,created_at) VALUES(?,?,?,?)')
              .run(settlement.winner_user_id, 'weekly.prize.assigned', JSON.stringify({ week_id: weekId, campaign_id: prize.campaign_id }), assignedAt);
          }
        }
      }
      const result = this.db.prepare('SELECT * FROM weekly_settlements WHERE week_id=?').get(weekId);
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  weeklyRewardRows(userId) {
    return this.db.prepare(`SELECT a.week_id,s.status,c.title,p.code,p.quota,p.expired_time
      FROM weekly_awards a JOIN weekly_settlements s ON s.week_id=a.week_id
      JOIN prizes p ON p.id=a.prize_id
      LEFT JOIN campaigns c ON c.id=p.campaign_id
      WHERE a.user_id=? AND s.status='assigned' ORDER BY a.week_id DESC`)
      .all(userId).map(({ week_id, title, status, code, quota, expired_time }) => ({
        week_id, title: title || '周榜奖励', status,
        ...(status === 'assigned' ? { code, quota, expired_time } : {}),
      })).concat(this.db.prepare(`SELECT s.week_id,'周榜奖励' AS title,s.status
        FROM weekly_settlements s WHERE s.winner_user_id=? AND s.status='pending'
        ORDER BY s.week_id DESC`).all(userId).map(({ week_id, title, status }) => ({ week_id, title, status })))
      .sort((a, b) => b.week_id.localeCompare(a.week_id));
  }

  importedIds() {
    return new Set(this.db.prepare('SELECT redemption_id FROM prizes').all().map((row) => row.redemption_id));
  }

  createCampaign(userId, campaign) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare('SELECT 1 FROM campaigns WHERE id=? AND deleted_at<>0').get(campaign.id)) {
        throw Object.assign(new Error('该活动已删除，无法重新启用。'), { status: 409 });
      }
      const kind = campaign.kind === 'weekly' ? 'weekly' : 'level';
      this.db.prepare('INSERT INTO campaigns(id,title,min_level,created_at,kind) VALUES(?,?,?,?,?)')
        .run(campaign.id, campaign.title, kind === 'weekly' ? 2 : campaign.min_level, Date.now(), kind);
      this.db.prepare('INSERT INTO audit(user_id,action,details,created_at) VALUES(?,?,?,?)')
        .run(userId, 'campaign.create', JSON.stringify({ campaign_id: campaign.id, title: campaign.title, min_level: kind === 'weekly' ? 2 : campaign.min_level, kind }), Date.now());
      this.db.exec('COMMIT');
      return this.campaigns().find((item) => item.id === campaign.id);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  campaignPrizes(campaignId, page = 1) {
    if (!this.db.prepare('SELECT 1 FROM campaigns WHERE id=? AND deleted_at=0').get(campaignId)) {
      throw Object.assign(new Error('该活动不存在。'), { status: 404 });
    }
    const time = Math.floor(Date.now() / 1000);
    const total = this.db.prepare('SELECT COUNT(*) AS count FROM prizes WHERE campaign_id=?').get(campaignId).count;
    const rows = this.db.prepare(`SELECT redemption_id,name,quota,expired_time,claimed_by,claimed_at,
      substr(code,1,4) || '…' || substr(code,-4) AS code_hint
      FROM prizes WHERE campaign_id=? ORDER BY id DESC LIMIT 100 OFFSET ?`).all(campaignId, (page - 1) * 100);
    const items = rows.map(({ claimed_by, ...row }) => ({ ...row, removable: claimed_by === null,
      status: claimed_by !== null ? 'claimed' : row.expired_time > 0 && row.expired_time <= time ? 'expired' : 'available' }));
    return { items, total, page, page_size: 100 };
  }

  removePrizes(userId, campaignId, ids) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare('SELECT id FROM campaigns WHERE id=? AND deleted_at=0').get(campaignId)) {
        throw Object.assign(new Error('该活动不存在，请刷新活动列表。'), { status: 404 });
      }
      const removedIds = [];
      const remove = this.db.prepare('DELETE FROM prizes WHERE campaign_id=? AND redemption_id=? AND claimed_by IS NULL');
      for (const id of ids) if (Number(remove.run(campaignId, id).changes) === 1) removedIds.push(id);
      this.db.prepare('INSERT INTO audit(user_id,action,details,created_at) VALUES(?,?,?,?)')
        .run(userId, 'prizes.remove', JSON.stringify({ campaign_id: campaignId, redemption_ids: removedIds }), Date.now());
      this.db.exec('COMMIT');
      return { removed: removedIds.length, skipped: ids.length - removedIds.length,
        remaining: this.campaigns().find((item) => item.id === campaignId)?.remaining ?? 0 };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  importPrizes(userId, campaign, redemptions) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaign.id);
      if (old?.deleted_at) throw Object.assign(new Error('该活动已删除，无法继续导入。'), { status: 409 });
      if (old && (old.min_level !== campaign.min_level || old.title !== campaign.title || (campaign.kind && old.kind !== campaign.kind))) {
        throw Object.assign(new Error('该奖池已存在，请保持原名称和解锁等级，或使用新的奖池标识。'), { status: 409 });
      }
      const kind = old?.kind || campaign.kind || 'level';
      this.db.prepare('INSERT OR IGNORE INTO campaigns(id,title,min_level,created_at,kind) VALUES(?,?,?,?,?)')
        .run(campaign.id, campaign.title, kind === 'weekly' ? 2 : campaign.min_level, Date.now(), kind);
      let imported = 0;
      for (const row of redemptions) {
        imported += Number(this.db.prepare(`INSERT OR IGNORE INTO prizes
          (redemption_id,code,campaign_id,name,quota,expired_time,imported_by,imported_at,campaign_kind) VALUES(?,?,?,?,?,?,?,?,?)`)
          .run(row.id, row.key, campaign.id, row.name, row.quota, row.expired_time || 0, userId, Date.now(), kind).changes);
      }
      this.db.prepare('INSERT INTO audit(user_id,action,details,created_at) VALUES(?,?,?,?)')
        .run(userId, 'prizes.import', JSON.stringify({ campaign_id: campaign.id, imported }), Date.now());
      this.db.exec('COMMIT');
      return { imported, remaining: this.campaigns().find((c) => c.id === campaign.id)?.remaining ?? 0 };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  claim(userId, campaignId) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const campaign = this.db.prepare('SELECT * FROM campaigns WHERE id=? AND deleted_at=0').get(campaignId);
      if (!campaign) throw Object.assign(new Error('谢礼尚未开放。'), { status: 404 });
      if (campaign.kind === 'weekly') throw Object.assign(new Error('周榜奖励会在结算后自动发放。'), { status: 403 });
      let prize = this.db.prepare('SELECT * FROM prizes WHERE campaign_id=? AND claimed_by=?').get(campaignId, userId);
      if (!prize) {
        if (Math.max(...this.profile(userId).unlocked) < campaign.min_level) {
          throw Object.assign(new Error('达到解锁等级后才能领取。'), { status: 403 });
        }
        prize = this.db.prepare(`SELECT * FROM prizes WHERE campaign_id=? AND claimed_by IS NULL
          AND (expired_time=0 OR expired_time>?) ORDER BY id LIMIT 1`).get(campaignId, Math.floor(Date.now() / 1000));
        if (!prize) throw Object.assign(new Error('这份谢礼已领完，等补货后再来。'), { status: 409 });
        const result = this.db.prepare('UPDATE prizes SET claimed_by=?,claimed_at=? WHERE id=? AND claimed_by IS NULL')
          .run(userId, Date.now(), prize.id);
        if (Number(result.changes) !== 1) throw Object.assign(new Error('奖品正在分配，请重试。'), { status: 409 });
        this.db.prepare('INSERT INTO audit(user_id,action,details,created_at) VALUES(?,?,?,?)')
          .run(userId, 'prize.claim', JSON.stringify({ campaign_id: campaignId, redemption_id: prize.redemption_id }), Date.now());
      }
      this.db.exec('COMMIT');
      return { campaign_id: campaignId, title: campaign.title, code: prize.code, quota: prize.quota, expired_time: prize.expired_time };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  deleteCampaign(userId, campaignId) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const campaign = this.db.prepare('SELECT id,deleted_at FROM campaigns WHERE id=?').get(campaignId);
      if (!campaign) throw Object.assign(new Error('该活动不存在。'), { status: 404 });
      if (campaign.deleted_at) throw Object.assign(new Error('该活动已删除。'), { status: 409 });
      const removed = this.db.prepare(`DELETE FROM prizes WHERE campaign_id=? AND claimed_by IS NULL
        AND NOT EXISTS (SELECT 1 FROM weekly_awards a WHERE a.prize_id=prizes.id)
        AND NOT EXISTS (SELECT 1 FROM weekly_settlements s WHERE s.prize_id=prizes.id)`).run(campaignId);
      const removedPrizes = Number(removed.changes);
      const retainedPrizes = Number(this.db.prepare('SELECT COUNT(*) AS count FROM prizes WHERE campaign_id=?').get(campaignId).count);
      const deletedAt = Date.now();
      this.db.prepare('UPDATE campaigns SET deleted_at=? WHERE id=? AND deleted_at=0').run(deletedAt, campaignId);
      this.db.prepare('INSERT INTO audit(user_id,action,details,created_at) VALUES(?,?,?,?)')
        .run(userId, 'campaign_delete', JSON.stringify({ campaign_id: campaignId, removed_prizes: removedPrizes, retained_prizes: retainedPrizes }), deletedAt);
      this.db.exec('COMMIT');
      return { removed_prizes: removedPrizes, retained_prizes: retainedPrizes, campaign_id: campaignId };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  close() { this.db.close(); }
}
