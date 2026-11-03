import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSurvivorMetrics, report } from '../backend/survivor-metrics.mjs';

function fixture() { const db = new DatabaseSync(':memory:'); let time = Date.UTC(2026, 0, 1); return { db, metrics: createSurvivorMetrics({ db, now: () => time }), setTime(v) { time = v; } }; }
const event = (over = {}) => ({ eventId: 'event-000001', event: 'round-end', hero: 'qwen', difficulty: 'standard', length: 10, round: 2, kills: 3, ...over });

test('accepts and aggregates allowlisted metrics only; duplicate event ids are ignored', () => {
  const f = fixture();
  assert.deepEqual(f.metrics.accept([event(), event({ eventId: 'event-000002', kills: 5 })], 'local-source'), { accepted: 2 });
  assert.deepEqual(f.metrics.accept([event()], 'other-source'), { accepted: 0 });
  const rows = report(f.db);
  assert.equal(rows.length, 1); assert.equal(rows[0].count, 2); assert.equal(rows[0].kills_sum, 8);
  assert.equal(rows[0].version, 4); f.db.close();
});
test('rejects invalid schema, unbounded text, unknown choices, and batches over twelve', () => {
  const f = fixture();
  for (const bad of [event({ extra: 'free text' }), event({ event: 'arbitrary' }), event({ hero: 'unknown' }), event({ choiceId: 'anything' }), event({ frameMs: Infinity })]) assert.throws(() => f.metrics.accept([bad], 'source'), { status: 422 });
  assert.throws(() => f.metrics.accept(Array.from({ length: 13 }, (_, i) => event({ eventId: `event-${String(i).padStart(6, '0')}` })), 'source'), { status: 422 });
  f.db.close();
});
test('enforces per source and global rate caps', () => {
  const f = fixture(), batch = n => Array.from({ length: n }, (_, i) => event({ eventId: `event-${String(Math.random()).slice(2, 10)}-${i}` }));
  for(let i=0;i<5;i++)f.metrics.accept(batch(12), 'source-a');
  assert.throws(() => f.metrics.accept(batch(12), 'source-a'), { status: 429 });
  for (let i = 0; i < 15; i++) f.metrics.accept(batch(12), `source-${i + 3}`);
  assert.throws(() => f.metrics.accept(batch(1), 'last-source'), { status: 429 });
  f.db.close();
});
test('retention cleanup is daily and report supports bounded date filters', () => {
  const f = fixture();
  f.metrics.accept([event()], 'a');
  f.setTime(Date.UTC(2026, 1, 1));
  f.metrics.accept([event({ eventId: 'event-000002' })], 'a');
  assert.equal(report(f.db).length, 2);
  assert.equal(report(f.db, { from: '2026-02-01' }).length, 1);
  f.db.close();
});
