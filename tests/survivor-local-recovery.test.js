import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRecovery, LOCAL_RECOVERY_MAX_BYTES, LOCAL_RECOVERY_TTL_MS } from '../survival/local-recovery.js';

function fixture({ fail = false } = {}) {
  const data = new Map();
  const storage = { getItem(k) { if (fail) throw Error('blocked'); return data.get(k) ?? null; }, setItem(k, v) { if (fail) throw Error('blocked'); data.set(k, v); }, removeItem(k) { if (fail) throw Error('blocked'); data.delete(k); } };
  let time = 1000;
  return { data, storage, clock: () => time, advance(ms) { time += ms; } };
}
const snapshot = (phase = 'playing') => ({ phase, runId: 'run-1', score: 4, progress: { level: 2 } });

test('owner isolation and save returns an independent JSON-safe snapshot', () => {
  const f = fixture(), api = createLocalRecovery({ storage: f.storage, now: f.clock }), s = snapshot();
  assert.equal(api.save('account:42', s, { runId: 'run-1' }), true);
  s.score = 99;
  assert.equal(api.load('account:42').score, 4);
  assert.equal(api.load('account:43'), null);
  assert.equal(api.load('guest'), null);
});
test('only explicit guest/account owners are accepted; unknown identity cannot use guest slot implicitly', () => {
  const f = fixture(), api = createLocalRecovery({ storage: f.storage, now: f.clock });
  for (const owner of [null, undefined, '', 'unknown', 'account:0', 'account:42x', 42]) assert.equal(api.save(owner, snapshot(), { runId: 'x' }), false);
  assert.equal(f.data.size, 0);
});
test('phase restrictions, terminal cleanup, expiry, and malformed/version-mismatched records', () => {
  const f = fixture(), api = createLocalRecovery({ storage: f.storage, now: f.clock });
  assert.equal(api.save('guest', snapshot('reward'), { runId: 'x' }), true);
  assert.equal(api.save('guest', snapshot('lost'), { runId: 'x' }), false);
  assert.equal(api.load('guest'), null);
  assert.equal(api.save('guest', snapshot('rest'), { runId: 'x' }), true);
  f.advance(LOCAL_RECOVERY_TTL_MS + 1);
  assert.equal(api.load('guest'), null);
  const key = [...f.data.keys()][0];
  f.data.set(key, JSON.stringify({ version: 99 }));
  assert.equal(api.load('guest'), null);
});
test('oversize snapshots, NaN, cycles and prototype pollution keys are rejected', () => {
  const f = fixture(), api = createLocalRecovery({ storage: f.storage, now: f.clock });
  assert.equal(api.save('guest', { ...snapshot(), blob: 'x'.repeat(LOCAL_RECOVERY_MAX_BYTES) }, { runId: 'x' }), false);
  assert.equal(api.save('guest', { ...snapshot(), bad: NaN }, { runId: 'x' }), false);
  const cycle = snapshot(); cycle.self = cycle;
  assert.equal(api.save('guest', cycle, { runId: 'x' }), false);
  const polluted = JSON.parse('{"phase":"playing","__proto__":{"polluted":true}}');
  assert.equal(api.save('guest', polluted, { runId: 'x' }), false);
  assert.equal({}.polluted, undefined);
});
test('storage failures are contained and return safe defaults', () => {
  const api = createLocalRecovery({ storage: fixture({ fail: true }).storage });
  assert.equal(api.save('guest', snapshot(), { runId: 'x' }), false);
  assert.equal(api.load('guest'), null);
  assert.equal(api.clear('guest'), false);
});
