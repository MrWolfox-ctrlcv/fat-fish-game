import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore } from '../backend/store.mjs';
import { createGameServer } from '../backend/app.mjs';
import { initialState, replayCheckpoint } from '../backend/replay.mjs';
import { applyFishProp, createGame, dropBody, stepGame } from '../dist/game.js';
import { seededRandom } from '../dist/seeded-random.js';
import { PHYSICS_VERSION } from '../dist/physics-version.js';
import { propInputFingerprint } from '../backend/props.mjs';
import { weekFor } from '../backend/weekly.mjs';

const token = 'Bearer prop-test-token';
const fakeAuth = async (_url, options) => options.headers.Authorization === token
  ? Response.json({ success: true, data: { id: 42, username: 'fish', display_name: 'fish', role: 1 } })
  : Response.json({ success: false }, { status: 401 });

async function fixture(t, extra = {}) {
  const store = new GameStore(':memory:');
  const { server } = await createGameServer({ store, fetchImpl: fakeAuth, ...extra });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/games/fat-fish/`;
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); });
  const request = (path, payload, auth = true) => fetch(base + path, {
    method: payload === undefined ? 'GET' : 'POST', headers: { ...(auth ? { Authorization: token } : {}), 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return { store, request };
}

test('legacy weekly scores migrate to normal entries and each account keeps separate normal/prop records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fatfish-prop-'));
  const path = join(directory, 'game.sqlite');
  try {
    let store = new GameStore(path);
    store.db.prepare(`INSERT INTO weekly_scores(week_id,user_id,name,score,max_level,attained_at,run_id)
      VALUES('2026-10-26',42,'fish',800,4,1793000000000,'old-run')`).run();
    store.close();
    store = new GameStore(path);
    assert.equal(store.weeklyScore('2026-10-26', 42).score, 800);
    assert.equal(store.weeklyScore('2026-10-26', 42).used_props, 0);
    store.recordWeeklyScore({ weekId: '2026-10-26', userId: 42, name: 'fish', score: 900, maxLevel: 5,
      runId: 'old-run', attainedAt: 1793000001000, usedProps: true });
    assert.equal(store.weeklyScore('2026-10-26', 42), null); // using a prop removes that run's normal entry
    assert.equal(store.weeklyScore('2026-10-26', 42, true).score, 900);
    store.recordWeeklyScore({ weekId: '2026-10-26', userId: 42, name: 'fish', score: 700, maxLevel: 4,
      runId: 'other-run', attainedAt: 1793000002000 });
    store.recordWeeklyScore({ weekId: '2026-10-26', userId: 7, name: 'other', score: 800, maxLevel: 4,
      runId: 'other-user-run', attainedAt: 1793000001500 });
    assert.equal(store.weeklyScore('2026-10-26', 42).score, 700);
    assert.deepEqual(store.weeklyRows('2026-10-26', 20, null).map((row) => [row.score, Boolean(row.used_props)]), [[900, true], [800, false], [700, false]]);
    assert.equal(store.weeklyRank('2026-10-26', 42), 2);
    assert.equal(store.weeklyRank('2026-10-26', 42, true), 1);
    assert.equal(store.weeklyMixedRank('2026-10-26', 42, false), 3);
    // Simulate a stale legacy row being left behind by an older writer. Migration must honor the durable prop marker.
    store.db.prepare(`INSERT INTO weekly_scores(week_id,user_id,name,score,max_level,attained_at,run_id)
      VALUES('2026-10-26',42,'fish',850,4,1793000003000,'old-run')
      ON CONFLICT(week_id,user_id) DO UPDATE SET score=excluded.score,run_id=excluded.run_id`).run();
    store.close();
    store = new GameStore(path);
    assert.equal(store.weeklyScore('2026-10-26', 42).score, 700);
    assert.equal(store.weeklyScore('2026-10-26', 42, true).score, 900);
    assert.equal(store.weeklyMixedRank('2026-10-26', 42, false), 3);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('prop endpoint validates before debit, persists receipts idempotently, and continues replay from the prop state', async (t) => {
  let debitCount = 0;
  const { request } = await fixture(t, { propWallet: { enabled: true, debit: async ({ quota, operationId }) => {
    debitCount++;
    assert.equal(quota, 5000);
    return { id: operationId };
  } } });
  const config = await (await request('api/props', undefined, false)).json();
  assert.deepEqual([config.enabled, config.price_usd, config.price_quota], [true, '0.01', 5000]);
  const started = await (await request('api/run', { physics_version: PHYSICS_VERSION })).json();
  const initial = initialState(started.run.seed, started.run.variant_seed);
  const seeded = replayCheckpoint(initial, [{ step: 0, x: 210 }], 0).state;
  const base = { run_id: started.run.id, step: 0, moves: [{ step: 0, x: 210 }], request_id: 'prop-request-0001',
    kind: 'remove', body_ids: ['missing-body'], confirm_quota: 5000 };
  assert.equal((await request('api/run/prop', base)).status, 422);
  assert.equal(debitCount, 0);
  const valid = { ...base, body_ids: [seeded.bodies[0].id] };
  const response = await request('api/run/prop', valid);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(debitCount, 1);
  assert.equal(body.receipt.quota, 5000);
  assert.equal(body.receipt.used_props, true);
  assert.equal(body.state.bodies.length, 0);
  assert.equal(body.summary.over, false);
  const repeated = await request('api/run/prop', valid);
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), body);
  assert.equal(debitCount, 1);
  assert.equal((await request('api/run/prop', { ...valid, kind: 'merge' })).status, 409);
  assert.equal(debitCount, 1);
  const next = await request('api/run/checkpoint', { run_id: started.run.id, step: 30, moves: [{ step: 30, x: 270 }] });
  assert.equal(next.status, 200);
  assert.equal((await request('api/run/prop', valid)).status, 409); // old receipt cannot roll this advanced run back
  const afterStale = await request('api/run/checkpoint', { run_id: started.run.id, step: 60, moves: [{ step: 60, x: 270 }] });
  assert.equal(afterStale.status, 200);
});

test('unknown debit status stays pending without retry; disabled mode fails closed', async (t) => {
  let debitCount = 0;
  const { request } = await fixture(t, { propWallet: { enabled: true, debit: async () => {
    debitCount++;
    throw Object.assign(new Error('unknown'), { code: 'PAYMENT_PENDING' });
  } } });
  const started = await (await request('api/run', { physics_version: PHYSICS_VERSION })).json();
  const state = replayCheckpoint(initialState(started.run.seed, started.run.variant_seed), [{ step: 0, x: 200 }], 0).state;
  const payload = { run_id: started.run.id, step: 0, moves: [{ step: 0, x: 200 }], request_id: 'prop-request-pending',
    kind: 'remove', body_ids: [state.bodies[0].id], confirm_quota: 5000 };
  assert.equal((await request('api/run/prop', payload)).status, 202);
  assert.equal((await request('api/run/prop', payload)).status, 202);
  assert.equal(debitCount, 1);
  const blockedCheckpoint = await request('api/run/checkpoint', { run_id: started.run.id, step: 1, moves: [] });
  assert.equal(blockedCheckpoint.status, 409);
  assert.equal((await blockedCheckpoint.json()).code, 'PAYMENT_PENDING');

  const disabled = await fixture(t);
  t.after(async () => { /* fixture owns its own cleanup */ });
  const status = await (await disabled.request('api/props', undefined, false)).json();
  assert.equal(status.enabled, false);
  assert.equal((await disabled.request('api/run/prop', payload)).status, 503);
});

test('parallel prop requests on one run are serialized and a definitive refusal is never charged twice', async (t) => {
  let debitCount = 0;
  const { request } = await fixture(t, { propWallet: { enabled: true, debit: async () => {
    debitCount++;
    throw Object.assign(new Error('refused'), { code: 'INSUFFICIENT_QUOTA' });
  } } });
  const started = await (await request('api/run', { physics_version: PHYSICS_VERSION })).json();
  const state = replayCheckpoint(initialState(started.run.seed, started.run.variant_seed), [{ step: 0, x: 200 }], 0).state;
  const payload = { run_id: started.run.id, step: 0, moves: [{ step: 0, x: 200 }], request_id: 'prop-request-refusal',
    kind: 'remove', body_ids: [state.bodies[0].id], confirm_quota: 5000 };
  const responses = await Promise.all([request('api/run/prop', payload), request('api/run/prop', payload)]);
  const statuses = responses.map((response) => response.status);
  assert.equal(statuses.filter((status) => status === 402).length, 1);
  assert.ok(statuses.every((status) => [202, 402, 409].includes(status)));
  assert.equal(debitCount, 1);
  assert.equal((await request('api/run/prop', payload)).status, 409);
  assert.equal(debitCount, 1);
});

test('prop unlock progress remains claimable after a durable prop receipt', () => {
  const store = new GameStore(':memory:');
  try {
    store.importPrizes(1, { id: 'prop-gift', title: '道具谢礼', min_level: 6 }, [
      { id: 1, key: 'a'.repeat(32), name: 'gift', quota: 5000, expired_time: 0 },
    ]);
    const now = Date.now();
    store.createPropReceipt({ requestId: 'claim-after-prop', userId: 42, runId: 'run', fingerprint: 'f',
      receiptId: 'receipt', kind: 'remove', bodyIds: [1], step: 10, now });
    const receipt = store.commitPropReceipt({ requestId: 'claim-after-prop', now,
      state: { stepIndex: 10, bodies: [], randomState: 1, variantState: 2 },
      summary: { score: 250, max_level: 6, over: false, unlocked: [1, 6], egg_stages: [] },
      play: { run_id: 'run', levels: [1, 6], egg_stages: [] }, week: '2099-01-05', userId: 42,
      name: 'fish', runId: 'run', usedProps: true });
    assert.equal(receipt.profile.unlocked.includes(6), true);
    assert.equal(receipt.rewards[0].status, 'available');
    assert.equal(store.claim(42, 'prop-gift').quota, 5000);
  } finally { store.close(); }
});

test('committed purchase receipts replay after a backend restart without another wallet call', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'fatfish-receipt-'));
  const path = join(directory, 'game.sqlite');
  const payload = { run_id: 'finished-run', step: 10, moves: [], request_id: 'durable-receipt-01',
    kind: 'remove', body_ids: [7], confirm_quota: 5000 };
  let store = new GameStore(path);
  const summary = { score: 30, max_level: 2, over: false, unlocked: [1, 2], egg_stages: [] };
  const state = { stepIndex: 10, bodies: [], randomState: 11, variantState: 12, unlocked: [1, 2], seenEggs: [], seenEggStages: [] };
  const profile = { user_id: 42, best: 30, unlocked: [1, 2], egg_stages: [] };
  const play = { run_id: payload.run_id, levels: [1, 2], egg_stages: [] };
  store.createPropReceipt({ requestId: payload.request_id, userId: 42, runId: payload.run_id,
    fingerprint: propInputFingerprint(payload), receiptId: 'durable-operation-01', kind: payload.kind,
    bodyIds: payload.body_ids, step: payload.step, now: Date.now(), state, summary, profile, rewards: [], play });
  store.commitPropReceipt({ requestId: payload.request_id, now: Date.now(), state, summary, profile,
    rewards: [], play, week: '2099-01-05', userId: 42, name: 'fish', runId: payload.run_id, usedProps: true });
  store.close();
  store = new GameStore(path);
  let debitCount = 0;
  const { server } = await createGameServer({ store, dbPath: path, fetchImpl: fakeAuth,
    propWallet: { enabled: true, debit: async () => { debitCount++; } } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/games/fat-fish/api/run/prop`, {
    method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  assert.equal(response.status, 200);
  const received = await response.json();
  assert.equal(received.receipt.id, 'durable-operation-01');
  assert.equal(received.expired, true);
  assert.equal(received.state, undefined);
  assert.equal(debitCount, 0);
});

test('the engine validates selected bodies and preserves replay random state in the snapshot', () => {
  const game = createGame({ random: seededRandom(11), variantRandom: seededRandom(22) });
  assert.ok(dropBody(game, 80));
  for (let i = 0; i < 30; i++) stepGame(game, 1 / 60);
  assert.ok(dropBody(game, 400));
  for (const body of game.bodies) { body.level = 2; body.radius = 32; }
  game.unlocked.add(2);
  const ids = game.bodies.map((body) => body.id);
  const expectedVariantState = game.variantRandom.getState();
  const outcome = applyFishProp(game, 'merge', ids);
  assert.equal(outcome.kind, 'merge');
  assert.deepEqual(outcome.selectedIds, ids);
  assert.equal(game.bodies.length, 1);
  assert.equal(game.bodies[0].level, 3);
  assert.notEqual(game.variantRandom.getState(), expectedVariantState);
  assert.throws(() => applyFishProp(game, 'merge', [game.bodies[0].id, 999]), RangeError);
});

test('leaderboard rows and my_entries use ranks from the combined score-desc, time-asc list', async (t) => {
  const { store, request } = await fixture(t);
  const attainedAt = Date.now();
  const weekId = weekFor(attainedAt).id;
  store.recordWeeklyScore({ weekId, userId: 42, name: 'fish', score: 500, maxLevel: 4, runId: 'normal', attainedAt });
  store.recordWeeklyScore({ weekId, userId: 42, name: 'fish', score: 800, maxLevel: 5, runId: 'props', attainedAt: attainedAt + 1, usedProps: true });
  store.recordWeeklyScore({ weekId, userId: 9, name: 'other', score: 700, maxLevel: 4, runId: 'other', attainedAt: attainedAt + 2 });
  const mine = await (await request('api/leaderboard/me')).json();
  assert.deepEqual(mine.my_entries.map((row) => [row.used_props, row.score, row.rank]), [[false, 500, 3], [true, 800, 1]]);
  const leaderboard = await (await request('api/leaderboard')).json();
  assert.deepEqual(leaderboard.rows.map((row) => [row.score, row.used_props, row.rank]), [[800, true, 1], [700, false, 2], [500, false, 3]]);
  assert.equal(leaderboard.total, 3);
});
