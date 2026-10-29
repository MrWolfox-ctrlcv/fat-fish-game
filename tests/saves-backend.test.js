import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore } from '../backend/store.mjs';
import { createGameServer } from '../backend/app.mjs';
import { initialState } from '../backend/replay.mjs';
import { PHYSICS_VERSION } from '../dist/physics-version.js';
import { weekFor } from '../backend/weekly.mjs';
import { FREE_TTL, PAID_TTL, SAVE_EXTENSION, SAVE_MAX_BYTES, isValidSnapshot, saveFingerprint } from '../backend/saves.mjs';

const tokens = new Map([
  ['Bearer save-user-one-token', { id: 42, username: 'fish-one', display_name: 'fish-one', role: 1 }],
  ['Bearer save-user-two-token', { id: 7, username: 'fish-two', display_name: 'fish-two', role: 1 }],
]);
const fakeAuth = async (_url, options) => {
  const data = tokens.get(options.headers.Authorization);
  return data ? Response.json({ success: true, data }) : Response.json({ success: false }, { status: 401 });
};

async function serverFixture(t, { path = ':memory:', now = () => Date.now(), wallet, verifier } = {}) {
  const store = new GameStore(path);
  let currentStore = store;
  const start = async () => {
    const app = await createGameServer({ store: currentStore, fetchImpl: fakeAuth, now, ...(verifier ? { verifier } : {}),
      ...(wallet ? { propWallet: wallet } : {}) });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}/games/fat-fish/`;
    return { app, request: (endpoint, payload, token = 'Bearer save-user-one-token') => fetch(base + endpoint, {
      method: payload === undefined ? 'GET' : 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }) };
  };
  let fixture = await start();
  t.after(async () => {
    if (fixture?.app.server.listening) {
      const closed = new Promise((resolve) => fixture.app.server.close(resolve));
      fixture.app.server.closeAllConnections?.();
      await closed;
    }
    currentStore?.close();
  });
  return {
    store: () => currentStore,
    current: () => fixture,
    restart: async () => {
      const closed = new Promise((resolve) => fixture.app.server.close(resolve));
      fixture.app.server.closeAllConnections?.();
      await closed;
      currentStore.close();
      currentStore = new GameStore(path);
      fixture = await start();
    },
  };
}

async function newRun(request) {
  const response = await request('api/run', { physics_version: PHYSICS_VERSION });
  assert.equal(response.status, 200);
  return (await response.json()).run;
}

function writePayload(run, slot = 1, requestId = 'save-write-request-1', extra = {}) {
  return { slot, run_id: run.id, step: 0, moves: [], physics_version: PHYSICS_VERSION,
    request_id: requestId, ...extra };
}

test('physics 3 paid saves migrate to the new warning line without losing time, RNG, score or failed status', async (t) => {
  let charges = 0;
  const { current, store } = await serverFixture(t, { wallet: { enabled: true, debit: async () => { charges++; } } });
  const { request } = current();
  const run = await newRun(request);
  await request('api/saves/write', writePayload(run, 2, 'legacy-paid-save', { confirm_quota: 5000 }));
  const saved = store().activeSave(42, 2, Date.now());
  const original = structuredClone(saved.state); original.score = 120; original.overTimer = 1.4;
  original.bodies = [{ id: 1, level: 1, r: 23, x: 200, y: 100, vx: 0, vy: 0, age: 4, angle: 0, angularVelocity: 0, mergeCooldown: 0, dangerTime: 1.4 }];
  for (const ended of [false, true]) {
    original.over = ended;
    store().db.prepare('UPDATE game_saves SET physics_version=3,state=? WHERE user_id=42 AND slot=2').run(JSON.stringify(original));
    const response = await request('api/saves/load', { slot: 2, physics_version: PHYSICS_VERSION });
    assert.equal(response.status, 200);
    const loaded = await response.json();
    assert.equal(loaded.state.over, ended);
    assert.equal(loaded.state.overTimer, ended ? 1.4 : 0);
    assert.equal(loaded.state.bodies[0].dangerTime, ended ? 1.4 : 0);
    for (const key of ['randomState', 'variantState', 'score', 'stepIndex']) assert.deepEqual(loaded.state[key], original[key]);
    assert.equal(store().activeSave(42, 2, Date.now()).expires_at, saved.expires_at);
  }
  assert.equal(charges, 1);
});

test('save listing is authenticated, account-isolated, and expired saves cannot be loaded', async (t) => {
  let at = 1_800_000_000_000;
  const { current } = await serverFixture(t, { now: () => at });
  const { request } = current();
  assert.equal((await request('api/saves', undefined, '')).status, 401);
  const run = await newRun(request);
  const written = await request('api/saves/write', writePayload(run));
  assert.equal(written.status, 200);
  const result = await written.json();
  assert.equal(result.saves[0].exists, true);
  assert.equal(result.saves[0].kind, 'free');
  assert.equal(result.saves[0].expires_at, at + FREE_TTL);
  const metadata = await (await request('api/saves')).json();
  assert.deepEqual(metadata.limits, { free_slots: 1, max_slots: 5, free_retention_hours: 24,
    paid_retention_days: 7, extension_days: 7, max_retention_days: 30 });
  assert.equal((await request('api/saves', undefined, 'Bearer save-user-two-token')).status, 200);
  const other = await (await request('api/saves', undefined, 'Bearer save-user-two-token')).json();
  assert.equal(other.saves[0].exists, false);
  const cannotRead = await request('api/saves/load', { slot: 1, physics_version: PHYSICS_VERSION }, 'Bearer save-user-two-token');
  assert.equal(cannotRead.status, 404);
  at += FREE_TTL + 1;
  const expired = await (await request('api/saves')).json();
  assert.equal(expired.saves[0].exists, false);
  assert.equal((await request('api/saves/load', { slot: 1, physics_version: PHYSICS_VERSION })).status, 404);
});

test('free overwrites keep paid extension time and free writes are idempotent', async (t) => {
  let at = 1_800_000_000_000;
  let debits = 0;
  const { current } = await serverFixture(t, { now: () => at, wallet: { enabled: true, debit: async () => { debits++; } } });
  const { request } = current();
  const run = await newRun(request);
  const first = writePayload(run);
  const saved = await (await request('api/saves/write', first)).json();
  const firstExpiry = saved.receipt.expires_at;
  const extension = await request('api/saves/extend', { slot: 1, request_id: 'save-extend-request-1', confirm_quota: 5000 });
  assert.equal(extension.status, 200);
  const extendedExpiry = (await extension.json()).receipt.expires_at;
  assert.equal(extendedExpiry, firstExpiry + SAVE_EXTENSION);
  const duplicate = await (await request('api/saves/write', first)).json();
  assert.equal(duplicate.receipt.expires_at, firstExpiry);
  const overwrite = await (await request('api/saves/write', writePayload(run, 1, 'save-write-request-2'))).json();
  assert.equal(overwrite.receipt.expires_at, extendedExpiry);
  assert.equal(debits, 1);
});

test('paid slots require explicit confirmation, bill once, and overwrites do not extend expiry', async (t) => {
  let at = 1_800_000_000_000;
  let debits = 0;
  const { current } = await serverFixture(t, { now: () => at, wallet: { enabled: true, debit: async () => { debits++; } } });
  const { request } = current();
  const run = await newRun(request);
  assert.equal((await request('api/saves/write', writePayload(run, 2))).status, 422);
  assert.equal(debits, 0);
  const payload = writePayload(run, 2, 'paid-save-request-1', { confirm_quota: 5000 });
  const savedResponse = await request('api/saves/write', payload);
  assert.equal(savedResponse.status, 200, await savedResponse.clone().text());
  const saved = await savedResponse.json();
  assert.equal(saved.receipt.paid, true);
  assert.equal(saved.receipt.expires_at, at + PAID_TTL);
  const expiry = saved.receipt.expires_at;
  const overwrite = await (await request('api/saves/write', writePayload(run, 2, 'paid-save-request-2'))).json();
  assert.equal(overwrite.receipt.expires_at, expiry);
  assert.equal(debits, 1);
  assert.equal((await request('api/saves/load', { slot: 2, physics_version: PHYSICS_VERSION })).status, 200);
});

test('unknown payment remains pending and retries never debit again or write a save', async (t) => {
  let debits = 0;
  const { current } = await serverFixture(t, { wallet: { enabled: true, debit: async () => {
    debits++;
    throw Object.assign(new Error('uncertain'), { code: 'PAYMENT_PENDING' });
  } } });
  const { request } = current();
  const run = await newRun(request);
  const payload = writePayload(run, 2, 'unknown-save-request', { confirm_quota: 5000 });
  const first = await request('api/saves/write', payload);
  assert.equal(first.status, 202);
  assert.equal((await first.json()).pending, true);
  const retry = await request('api/saves/write', payload);
  assert.equal(retry.status, 202);
  assert.equal(debits, 1);
  assert.equal((await (await request('api/saves')).json()).saves[1].exists, false);
  assert.equal((await request('api/saves/load', { slot: 2, physics_version: PHYSICS_VERSION })).status, 409);
});

test('version and invalid snapshot checks happen before any payment', async (t) => {
  let debits = 0;
  const { current } = await serverFixture(t, { wallet: { enabled: true, debit: async () => { debits++; } } });
  const { request } = current();
  const run = await newRun(request);
  const invalidVersion = await request('api/saves/write', { ...writePayload(run, 2, 'bad-version-request', { confirm_quota: 5000 }), physics_version: PHYSICS_VERSION - 1 });
  assert.equal(invalidVersion.status, 409);
  assert.equal((await request('api/saves/load', { slot: 1, physics_version: PHYSICS_VERSION - 1 })).status, 409);
  assert.equal(debits, 0);
  assert.equal(isValidSnapshot({ ...initialState(1, 2), bodies: Array.from({ length: 251 }, () => ({})) }), false);
  assert.equal(isValidSnapshot({ ...initialState(1, 2), optional: 'x'.repeat(SAVE_MAX_BYTES) }), false);
});

test('seven-day extensions stop before the 30-day rolling cap and do not debit beyond the cap', async (t) => {
  let debits = 0;
  const { current } = await serverFixture(t, { wallet: { enabled: true, debit: async () => { debits++; } } });
  const { request } = current();
  const run = await newRun(request);
  await request('api/saves/write', writePayload(run));
  for (let index = 0; index < 4; index++) {
    const response = await request('api/saves/extend', { slot: 1, request_id: `save-extension-${index}-request`, confirm_quota: 5000 });
    assert.equal(response.status, 200);
  }
  const capped = await request('api/saves/extend', { slot: 1, request_id: 'save-extension-cap-request', confirm_quota: 5000 });
  assert.equal(capped.status, 409);
  assert.equal((await capped.json()).code, 'SAVE_RETENTION_LIMIT');
  assert.equal(debits, 4);
});

test('saved state and committed prop lineage survive a backend restart; loading invalidates old run IDs', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'fatfish-saves-'));
  const path = join(directory, 'game.sqlite');
  t.after(() => { try { rmSync(directory, { recursive: true, force: true }); } catch { /* closed by the fixture hook */ } });
  let at = 1_800_000_000_000;
  const fixture = await serverFixture(t, { path, now: () => at });
  let { request } = fixture.current();
  const original = await newRun(request);
  await request('api/saves/write', writePayload(original));
  const persistedState = fixture.store().activeSave(42, 1, at).state;
  const lineage = fixture.store().db.prepare('SELECT lineage_id FROM game_saves WHERE user_id=42 AND slot=1').get().lineage_id;
  const weekId = weekFor(at).id;
  fixture.store().createPropReceipt({ requestId: 'lineage-prop-request', userId: 42, runId: original.id,
    lineageId: lineage, fingerprint: 'fingerprint', receiptId: 'lineage-prop-operation', kind: 'remove',
    bodyIds: ['body-id'], step: 0, now: at, weekId, name: 'fish-one', state: initialState(1, 2),
    summary: { score: 10, max_level: 1, over: false, unlocked: [1], egg_stages: [] }, profile: { best: 10, unlocked: [1], egg_stages: [] },
    rewards: [], play: { run_id: original.id, levels: [1], egg_stages: [] } });
  fixture.store().commitPropReceipt({ requestId: 'lineage-prop-request', now: at, state: initialState(1, 2),
    summary: { score: 10, max_level: 1, over: false, unlocked: [1], egg_stages: [] }, profile: {}, rewards: [],
    play: {}, week: weekId, userId: 42, name: 'fish-one', runId: original.id, usedProps: true });
  const runScoreCount = fixture.store().db.prepare('SELECT COUNT(*) AS count FROM weekly_run_scores WHERE user_id=42 AND run_id=?').get(lineage).count;
  await fixture.restart();
  ({ request } = fixture.current());
  const loadedResponse = await request('api/saves/load', { slot: 1, physics_version: PHYSICS_VERSION });
  assert.equal(loadedResponse.status, 200);
  const loaded = await loadedResponse.json();
  assert.notEqual(loaded.run.id, original.id);
  assert.equal(loaded.receipt.lineage_id, lineage);
  assert.equal(loaded.receipt.week_id, weekId);
  assert.equal(loaded.receipt.used_props, true);
  assert.deepEqual(loaded.state, persistedState);
  const stale = await request('api/run/checkpoint', { run_id: original.id, step: 0, moves: [] });
  assert.equal(stale.status, 409);
  assert.equal(fixture.store().lineagePropCount(42, lineage), 1);
  assert.equal(fixture.store().db.prepare('SELECT COUNT(*) AS count FROM weekly_run_scores WHERE user_id=42 AND run_id=?').get(lineage).count, runScoreCount);
});

test('a pending zero-quota write commits idempotently after restart; paid pending orders remain pending', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'fatfish-free-save-recovery-'));
  const path = join(directory, 'game.sqlite');
  t.after(() => { try { rmSync(directory, { recursive: true, force: true }); } catch { /* closed by fixture hook */ } });
  const at = 1_800_000_000_000;
  let debits = 0;
  const fixture = await serverFixture(t, { path, now: () => at,
    wallet: { enabled: true, debit: async () => { debits++; } } });
  let { request } = fixture.current();
  const run = await newRun(request);
  const payload = writePayload(run, 1, 'free-pending-recovery-request');
  const state = initialState(run.seed, run.variant_seed);
  fixture.store().createSaveOrder({ requestId: payload.request_id, userId: 42, slot: 1,
    fingerprint: saveFingerprint(payload), operationId: 'free-pending-recovery-operation', operation: 'write', now: at,
    payload: { allow_payment: false, save: { state, summary: { score: 0, max_level: 1, over: false,
      unlocked: [1], egg_stages: [] }, lineage_id: run.id, week_id: weekFor(at).id,
      physics_version: PHYSICS_VERSION, expires_at: at + FREE_TTL } } });
  await fixture.restart();
  ({ request } = fixture.current());
  const recovered = await request('api/saves/write', payload);
  assert.equal(recovered.status, 200, await recovered.clone().text());
  assert.equal((await recovered.json()).saves[0].exists, true);
  assert.equal(debits, 0);
  assert.equal(fixture.store().saveOrder(payload.request_id).status, 'committed');
});

test('simultaneous paid-save requests share one reservation and same-request retries are idempotent', async (t) => {
  let debits = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered;
  const inWallet = new Promise((resolve) => { entered = resolve; });
  const { current } = await serverFixture(t, { wallet: { enabled: true, debit: async () => { debits++; entered(); await gate; } } });
  const { request } = current();
  const run = await newRun(request);
  const payload = writePayload(run, 3, 'parallel-save-request', { confirm_quota: 5000 });
  const first = request('api/saves/write', payload);
  await inWallet;
  const second = await request('api/saves/write', payload);
  assert.equal(second.status, 202);
  assert.equal(debits, 1);
  release();
  assert.equal((await first).status, 200);
  assert.equal(debits, 1);
});

test('a paid overwrite that expires during server verification cannot turn into an unconfirmed purchase', async (t) => {
  let at = 1_800_000_000_000;
  let verifyCount = 0;
  let entered;
  let release;
  const secondVerifyEntered = new Promise((resolve) => { entered = resolve; });
  const holdSecondVerify = new Promise((resolve) => { release = resolve; });
  let debits = 0;
  const verifier = { verify: async (state, _moves, target) => {
    verifyCount++;
    if (verifyCount === 2) { entered(); await holdSecondVerify; }
    const next = { ...structuredClone(state), stepIndex: target };
    return { state: next, summary: { score: next.score, max_level: Math.max(...next.unlocked), over: next.over,
      unlocked: [...next.unlocked], egg_stages: [...next.seenEggStages] } };
  }, close: async () => {} };
  const { current } = await serverFixture(t, { now: () => at, verifier,
    wallet: { enabled: true, debit: async () => { debits++; } } });
  const { request } = current();
  const run = await newRun(request);
  const first = await (await request('api/saves/write', writePayload(run, 2, 'expiry-paid-save-01', { confirm_quota: 5000 }))).json();
  assert.equal(first.receipt.paid, true);
  const expiry = first.receipt.expires_at;
  const overwrite = request('api/saves/write', { ...writePayload(run, 2, 'expiry-paid-save-02'), step: 1 });
  await secondVerifyEntered;
  at = expiry + 1;
  release();
  const response = await overwrite;
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'SAVE_CONFIRM_REQUIRED');
  assert.equal(debits, 1);
  assert.equal((await (await request('api/saves')).json()).saves[1].exists, false);
});

test('an extension paid before expiry restores its save if it expires while wallet confirmation is pending', async (t) => {
  let at = 1_800_000_000_000;
  let entered;
  let release;
  const walletEntered = new Promise((resolve) => { entered = resolve; });
  const walletGate = new Promise((resolve) => { release = resolve; });
  const { current, store } = await serverFixture(t, { now: () => at, wallet: { enabled: true, debit: async () => {
    entered(); await walletGate;
  } } });
  const { request } = current();
  const run = await newRun(request);
  await request('api/saves/write', writePayload(run));
  const expiresAt = (await (await request('api/saves')).json()).saves[0].expires_at;
  at = expiresAt - 1;
  const extending = request('api/saves/extend', { slot: 1, request_id: 'extension-near-expiry', confirm_quota: 5000 });
  await walletEntered;
  at = expiresAt + 1;
  assert.equal(store().cleanupExpiredSaves(at), 0);
  release();
  const response = await extending;
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.saves[0].exists, true);
  assert.ok(result.receipt.expires_at > at);
  assert.ok(store().activeSave(42, 1, at));
});
