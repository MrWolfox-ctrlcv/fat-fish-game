import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeRoomEvents, isRoomEntryIntent, shouldResetRoomGame } from '../../playroom/src/arena-room-state.js';

test('room invitations keep the friend form open without joining automatically', () => {
  assert.equal(isRoomEntryIntent('', '?room=123456'), true);
  assert.equal(isRoomEntryIntent('#room-card', ''), true);
  assert.equal(isRoomEntryIntent('', '?room=12345'), false);
  assert.equal(isRoomEntryIntent('', '?room=123456&other=ignored'), true);
});

test('metadata changes for the same room keep the current match, but a new room or rematch resets it', () => {
  const playing = { code: '123456', phase: 'playing' };
  assert.equal(shouldResetRoomGame(playing, { ...playing, seats: [] }, 'playing', 'playing'), false);
  assert.equal(shouldResetRoomGame(playing, { ...playing, phase: 'ended' }, 'ended', 'ended'), false);
  assert.equal(shouldResetRoomGame(playing, { code: '654321', phase: 'playing' }, 'playing', 'playing'), true);
  assert.equal(shouldResetRoomGame({ ...playing, phase: 'ended' }, playing, 'ended', 'ended'), true);
});

test('kill credit follows the attacker, not the victim id', () => {
  const events = [
    { type: 'kill', id: 2, by: 4 },
    { type: 'fall', id: 4 },
    { type: 'fall', id: 2 },
  ];
  assert.deepEqual(attributeRoomEvents(events, 2), [{ type: 'fall', id: 2, playerFall: true }]);
  assert.deepEqual(attributeRoomEvents(events, 4), [
    { type: 'kill', id: 2, by: 4, playerKill: true, attackerId: 4, victimId: 2 },
    { type: 'fall', id: 4, playerFall: true },
  ]);
});

test('self-attributed kills retain engine fields for the companion policy', () => {
  assert.deepEqual(attributeRoomEvents([{ type: 'kill', attackerId: 1, victimId: 3 }], 1), [
    { type: 'kill', attackerId: 1, victimId: 3, playerKill: true },
  ]);
});
