import test from 'node:test';
import assert from 'node:assert/strict';
import { createArenaRoomClient } from '../../playroom/src/arena-room-client.js';

class FakeSocket {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; this.sent = []; FakeSocket.instances.push(this); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, event = {}) { for (const fn of this.listeners[type] || []) fn(event); }
  open() { this.readyState = 1; this.emit('open'); }
  close() { this.readyState = 3; this.emit('close'); }
  send(message) { this.sent.push(JSON.parse(message)); }
}

function harness(fetchImpl, extra = {}) {
  const timers = [];
  const client = createArenaRoomClient({
    fetchImpl,
    WebSocketImpl: FakeSocket,
    basePath: '/games/bumper',
    urlBase: () => 'https://example.test/games/bumper/',
    isHidden: () => false,
    ...extra,
    now: () => clock.value,
    setTimer: (fn, delay) => { const item = { fn, delay, cleared: false }; timers.push(item); return item; },
    clearTimer: (item) => { if (item) item.cleared = true; },
  });
  const clock = { value: 0 };
  return { client, timers, clock };
}

const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

test('changed inputs are capped at 20Hz and a primary press is sent once', async () => {
  FakeSocket.instances = [];
  const h = harness(async () => response({ room: { code: '123456', self_id: 0, host_id: 0, seats: [], phase: 'playing' } }));
  await h.client.create('玩家');
  const socket = FakeSocket.instances[0];
  socket.open();
  for (let i = 1; i <= 40; i++) {
    h.clock.value = i * 10;
    h.client.setInput({ moveX: i / 40, moveY: 0, aimX: i, aimY: 2, primary: i === 1 });
  }
  const inputs = socket.sent;
  assert.ok(inputs.length <= 9, `expected at most 9 sends across 400ms, got ${inputs.length}`);
  assert.equal(inputs.filter((input) => input.primary).length, 1);
  assert.ok(inputs.every((input, index) => index === 0 || input.seq > inputs[index - 1].seq));
  h.client.dispose();
});

test('late room response cannot replace a newer room after disposal', async () => {
  FakeSocket.instances = [];
  let resolveCreate;
  const h = harness((url) => url.endsWith('/api/rooms')
    ? new Promise((resolve) => { resolveCreate = resolve; })
    : Promise.resolve(response({ room: { code: '654321', self_id: 1, host_id: 0, seats: [], phase: 'waiting' } })));
  let lastRoom = null;
  h.client.dispose();
  const createPromise = h.client.create('старый');
  const joinPromise = h.client.join('654321', 'новый');
  await joinPromise;
  resolveCreate(response({ room: { code: '111111', self_id: 0, host_id: 0, seats: [], phase: 'waiting' } }));
  await createPromise;
  lastRoom = h.client.room;
  assert.equal(lastRoom.code, '654321');
  assert.equal(FakeSocket.instances.length, 1);
  h.client.dispose();
});

test('restore with no room and leave both cleanly dispose the socket', async () => {
  FakeSocket.instances = [];
  const calls = [];
  const h = harness(async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/me') ? response({ success: true, room: null }) : response({ success: true });
  });
  assert.equal(await h.client.restore(), null);
  assert.equal(h.client.room, null);
  assert.equal(calls[0].options.credentials, 'include');
  await h.client.leave();
  assert.ok(calls.some(({ url }) => url.endsWith('/leave')));
  h.client.dispose();
});

test('hidden tabs stop movement, while the visibility neutral is sent once', async () => {
  FakeSocket.instances = [];
  let hidden = false;
  const h = harness(async () => response({ room: { code: '123456', self_id: 0, host_id: 0, seats: [], phase: 'playing' } }), { isHidden: () => hidden });
  await h.client.create('玩家');
  const socket = FakeSocket.instances[0];
  socket.open();
  h.clock.value = 60;
  h.client.setInput({ moveX: 1, aimX: 20, aimY: 30 });
  hidden = true;
  h.clock.value = 120;
  h.client.setInput({ moveX: 1, aimX: 30, aimY: 40 });
  assert.equal(socket.sent.at(-1).moveX, 1);
  h.client.neutral();
  assert.equal(socket.sent.at(-1).moveX, 0);
  assert.equal(socket.sent.at(-1).primary, false);
  h.client.dispose();
});

test('reconnect attempts back off and stop after three retries', async () => {
  FakeSocket.instances = [];
  const statuses = [];
  const h = harness(async () => response({ room: { code: '123456', self_id: 0, host_id: 0, seats: [], phase: 'playing' } }));
  h.client.dispose();
  const retryClient = createArenaRoomClient({
    fetchImpl: async () => response({ room: { code: '123456', self_id: 0, host_id: 0, seats: [], phase: 'playing' } }),
    WebSocketImpl: FakeSocket, basePath: '/games/bumper', urlBase: () => 'https://example.test/', isHidden: () => false,
    setTimer: (fn, delay) => { const item = { fn, delay }; h.timers.push(item); return item; },
    clearTimer: (item) => { if (item) item.cleared = true; }, onStatus: (value) => statuses.push(value),
  });
  await retryClient.create('玩家');
  for (const delay of [1000, 2000, 5000]) {
    const socket = FakeSocket.instances.at(-1);
    socket.open();
    socket.close();
    const retry = h.timers.find((item) => item.delay === delay && !item.used && !item.cleared);
    assert.ok(retry, `missing ${delay}ms retry`);
    retry.used = true;
    retry.fn();
  }
  FakeSocket.instances.at(-1).open();
  FakeSocket.instances.at(-1).close();
  assert.equal(statuses.at(-1), 'retry-exhausted');
  retryClient.dispose();
});
