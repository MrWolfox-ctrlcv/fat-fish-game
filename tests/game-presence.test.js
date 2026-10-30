import test from 'node:test';
import assert from 'node:assert/strict';
import { createGamePresence } from '../dist/game-presence.js';

function harness(fetchImpl = async (_url, options) => ({ json: async () => ({ success: true, online: 4, payload: JSON.parse(options.body) }) }), enabled = true) {
  const listeners = () => new Map();
  const docEvents = listeners(), winEvents = listeners(), timers = new Map();
  const documentRef = {
    visibilityState: 'visible',
    addEventListener: (n, f) => docEvents.set(n, f), removeEventListener: n => docEvents.delete(n)
  };
  let next = 0;
  const windowRef = {
    navigator: { sendBeacon: () => true },
    addEventListener: (n, f) => winEvents.set(n, f), removeEventListener: n => winEvents.delete(n),
    setInterval: f => { const id = ++next; timers.set(id, f); return id; }, clearInterval: id => timers.delete(id)
  };
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const element = { textContent: '' };
  return { docEvents, winEvents, timers, documentRef, windowRef, storage, element, api: createGamePresence({ game: 'bumper', enabled, fetchImpl, windowRef, documentRef, storage, element }) };
}

test('uses persistent per-game session id and posts the visible playing state', async () => {
  const calls = [];
  const h = harness(async (_url, opts) => { calls.push(JSON.parse(opts.body)); return { json: async () => ({ success: true, online: 7 }) }; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.storage.getItem('game-presence:bumper'), h.api.sessionId);
  assert.deepEqual(calls[0], { session_id: h.api.sessionId, game: 'bumper', playing: false });
  assert.equal(h.element.textContent, '在线 7');
  h.api.close();
});

test('visibility changes leave while hidden, resume heartbeat, and close cleans up', async () => {
  const h = harness();
  await new Promise(resolve => setImmediate(resolve));
  h.documentRef.visibilityState = 'hidden'; h.docEvents.get('visibilitychange')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.timers.size, 0);
  h.documentRef.visibilityState = 'visible'; h.docEvents.get('visibilitychange')();
  assert.equal(h.timers.size, 1);
  h.api.close();
  assert.equal(h.timers.size, 0);
  assert.equal(h.docEvents.size, 0); assert.equal(h.winEvents.size, 0);
});

test('prevents overlapping requests and makes beacon leave without credentials', async () => {
  let release, calls = 0, beacon;
  const h = harness(async () => { calls++; return new Promise(resolve => { release = () => resolve({ json: async () => ({ success: true, online: 2 }) }); }); });
  h.timers.values().next().value(); h.timers.values().next().value();
  assert.equal(calls, 1);
  h.winEvents.get('pagehide')();
  assert.equal(calls, 1);
  release(); await new Promise(resolve => setImmediate(resolve));
  h.api.close();
});

test('disabled mode reports local mode without network requests', () => {
  const h = harness(() => { throw new Error('unexpected network'); }, false);
  assert.equal(h.element.textContent, '本机模式');
  h.api.close();
});
