import test from 'node:test';
import assert from 'node:assert/strict';
import { getMissingTeamFactions } from '../../playroom/src/arena-room-ui.js';

test('team bot rosters must cover both factions while all characters remain valid', () => {
  assert.deepEqual(getMissingTeamFactions('ffa', ['astra']), []);
  assert.deepEqual(getMissingTeamFactions('teams', []), []);
  assert.deepEqual(getMissingTeamFactions('teams', ['astra', 'claude']), [0]);
  assert.deepEqual(getMissingTeamFactions('teams', ['doubao', 'qwen']), [1]);
  assert.deepEqual(getMissingTeamFactions('teams', ['doubao', 'astra']), []);
});
