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

test('input changes and forced neutral wait only for the next 20Hz slot; keepalive reschedules', async () => {
  FakeSocket.instances = [];
  const h = harness(async () => response({ room: { code: '123456', self_id: 0, host_id: 0, seats: [], phase: 'playing' } }));
  await h.client.create('玩家');
  const socket = FakeSocket.instances[0];
  socket.open();
  h.clock.value = 60;
  h.client.setInput({ moveX: 1, aimX: 90, aimY: 40 });
  h.clock.value = 80;
  h.client.neutral();
  assert.equal(socket.sent.length, 2);
  const due = h.timers.find((item) => !item.cleared);
  assert.equal(due.delay, 100);
  h.clock.value = 110;
  due.fn();
  assert.equal(socket.sent.length, 3);
  assert.equal(socket.sent.at(-1).moveX, 0);
  assert.equal(socket.sent.at(-1).primary, false);
  const keepalive = h.timers.find((item) => !item.cleared && item !== due);
  assert.ok(keepalive, 'periodic keepalive should remain scheduled');
  h.client.dispose();
  assert.ok(keepalive.cleared, 'disposing the client clears the recurring timer');
});

test('team create sends the host faction and team join sends only an explicit preference', async () => {
  FakeSocket.instances = [];
  const calls = [];
  const h = harness(async (url, options) => {
    calls.push({ url, body: options?.body ? JSON.parse(options.body) : null });
    return response({ room: { code: '123456', self_id: 0, host_id: 0, phase: 'waiting', mode: 'teams', seats: [] } });
  });
  await h.client.create('房主', { mode: 'teams', teamId: 1 });
  assert.deepEqual(calls[0].body, { nickname: '房主', mode: 'teams', maxPlayers: 6, fillBots: true, botRoster: [], teamId: 1 });
  await h.client.join('123456', '队友');
  assert.deepEqual(calls[1].body, { code: '123456', nickname: '队友' });
  await h.client.join('123456', '选队', { teamId: 0 });
  assert.deepEqual(calls[2].body, { code: '123456', nickname: '选队', teamId: 0 });
  h.client.dispose();
});

test('invalid local mode or faction values cannot be sent as team requests', async () => {
  FakeSocket.instances = [];
  const calls = [];
  const h = harness(async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return response({ room: { code: '123456', self_id: 0, host_id: 0, phase: 'waiting', mode: 'ffa', seats: [] } });
  });
  await h.client.create('玩家', { mode: 'invalid', teamId: 8 });
  await h.client.join('123456', '玩家', { teamId: 9 });
  assert.deepEqual(calls, [
    { nickname: '玩家', mode: 'ffa', maxPlayers: 6, fillBots: true, botRoster: [] },
    { code: '123456', nickname: '玩家' },
  ]);
  h.client.dispose();
});

test('create sends explicit match settings and host settings use POST /settings', async () => {
  FakeSocket.instances = [];
  const calls = [];
  const h = harness(async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    return response({ room: { code: '123456', self_id: 0, host_id: 0, phase: 'waiting', mode: 'ffa', maxPlayers: 4, fillBots: false, botRoster: ['astra', 'claude'], seats: [] } });
  });
  await h.client.create('房主', { mode: 'ffa', maxPlayers: 4, fillBots: false, botRoster: ['astra', 'claude'] });
  assert.deepEqual(calls[0].body, { nickname: '房主', mode: 'ffa', maxPlayers: 4, fillBots: false, botRoster: ['astra', 'claude'] });
  await h.client.updateSettings({ mode: 'teams', maxPlayers: 4, fillBots: true, botRoster: ['deepseek', 'astra'] });
  assert.equal(calls[1].url, '/games/bumper/api/rooms/settings');
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(calls[1].body, { mode: 'teams', maxPlayers: 4, fillBots: true, botRoster: ['deepseek', 'astra'] });
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

test('a throttled neutral remains forced when its scheduled send runs in a hidden tab', async () => {
  FakeSocket.instances = [];
  let hidden = false;
  const h = harness(async () => response({ room: { code: '123456', self_id: 0, host_id: 0, seats: [], phase: 'playing' } }), { isHidden: () => hidden });
  await h.client.create('玩家');
  const socket = FakeSocket.instances[0];
  socket.open();
  h.clock.value = 60;
  h.client.setInput({ moveX: 1, aimX: 90, aimY: 40 });
  hidden = true;
  h.clock.value = 80;
  h.client.neutral();
  assert.equal(socket.sent.length, 2);
  h.clock.value = 110;
  const due = h.timers.find((item) => !item.cleared);
  due.fn();
  assert.equal(socket.sent.length, 3);
  assert.equal(socket.sent.at(-1).moveX, 0);
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
