import test from 'node:test';
import assert from 'node:assert/strict';
import { createFishDiscoveryTracker, fatFishSnapshot } from '../dist/companion-scene.js';

test('discoveries respect account history, exact egg stage and account switch', () => {
  const tracker = createFishDiscoveryTracker();
  tracker.sync({ unlocked: [1, 2], egg_stages: ['gpt-silly:2'] }, 10);
  const game = { unlocked: new Set([1, 2, 3]), seenEggStages: new Set(['gpt-silly:2', 'gpt-silly:3']) };
  assert.deepEqual(tracker.observe(game), [
    { type: 'new_level', detail: { level: 3 } },
    { type: 'new_easter', detail: { level: 3, variant: 'gpt-silly' } },
  ]);
  assert.deepEqual(tracker.observe(game), []);
  tracker.sync({ unlocked: [1, 2], egg_stages: [] }, 10);
  assert.deepEqual(tracker.observe(game), []);
  tracker.sync(null, 11);
  assert.equal(tracker.observe(game).length, 4);
});

test('scene samples twelve visible balls with no account data and ignores falling ball danger', () => {
  const game = { score: 10, stepIndex: 120, unlocked: new Set([1, 3]), height: 620,
    username: 'private', bodies: Array.from({ length: 20 }, (_, i) => ({ level: 2, x: 25, y: 50 + i * 20, r: 30, age: i ? 2 : .1, dangerTime: i ? 0 : 1, variant: null })) };
  const snapshot = fatFishSnapshot(game);
  assert.equal(snapshot.scene.balls.length, 12);
  assert.equal(snapshot.scene.ball_count, 20);
  assert.equal(snapshot.scene.danger, false);
  assert.equal(snapshot.scene.stack_height, 580);
  assert.equal(snapshot.elapsed, 2);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
});
