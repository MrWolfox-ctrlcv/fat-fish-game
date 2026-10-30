import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresence } from '../backend/presence.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('counts visitors and active players by game, deduplicating sessions', () => {
  const presence = createPresence();
  assert.equal(presence.touch({ sessionId: id(1), playing: false }), true);
  assert.equal(presence.touch({ sessionId: id(1), game: 'bumper', playing: true }), true);
  assert.equal(presence.touch({ sessionId: id(2), game: 'survivor' }), true);
  assert.deepEqual(presence.stats(), {
    online: 2, playing: 2,
    games: { 'fat-fish': { online: 0, playing: 0 }, bumper: { online: 1, playing: 1 }, survivor: { online: 1, playing: 1 } }
  });
});

test('expires sessions after ttl and supports leave', () => {
  let time = 1000;
  const presence = createPresence({ now: () => time, ttl: 90 });
  presence.touch({ sessionId: id(1) });
  time = 1089;
  assert.equal(presence.stats().online, 1);
  time = 1090;
  assert.equal(presence.stats().online, 0);
  presence.touch({ sessionId: id(2) });
  assert.equal(presence.leave(id(2)), true);
  assert.equal(presence.stats().online, 0);
});

test('rejects invalid sessions and games and refuses capacity overflow safely', () => {
  const presence = createPresence({ maxEntries: 1 });
  assert.equal(presence.touch({ sessionId: 'not-a-uuid' }), false);
  assert.equal(presence.touch({ sessionId: id(1), game: 'unknown' }), false);
  assert.equal(presence.touch({ sessionId: id(1) }), true);
  assert.equal(presence.touch({ sessionId: id(2) }), false);
  assert.equal(presence.stats().online, 1);
});
