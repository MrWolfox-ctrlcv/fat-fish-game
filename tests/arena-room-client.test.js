import test from 'node:test';
import assert from 'node:assert/strict';
import { createArenaRoomClient } from '../playroom/src/arena-room-client.js';

class Socket {
  static all = [];
  constructor() { this.readyState = 0; this.listeners = {}; this.sent = []; Socket.all.push(this); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, event = {}) { for (const fn of this.listeners[type] || []) fn(event); }
  open() { this.readyState = 1; this.emit('open'); }
  close() { this.readyState = 3; this.emit('close'); }
  send(text) { this.sent.push(JSON.parse(text)); }
}

function makeClient({ hidden = () => false } = {}) {
  const clock = { value: 0 };
  const timers = [];
  const client = createArenaRoomClient({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ room: { code: '123456', self_id: 0, phase: 'playing', seats: [] } }) }),
    WebSocketImpl: Socket, isHidden: hidden, now: () => clock.value,
    urlBase: () => 'https://example.test/',
    setTimer: (fn, delay) => { const timer = { fn, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimer: (timer) => { if (timer) timer.cleared = true; },
  });
  return { client, clock, timers };
}

test('input transitions are sent at the next 20Hz slot and keepalive timers repeat then clean up', async () => {
  Socket.all = [];
  const h = makeClient();
  await h.client.create('A');
  const socket = Socket.all[0];
  socket.open();
  h.clock.value = 60;
  h.client.setInput({ moveX: 1, aimX: 50, aimY: 20 });
  h.clock.value = 80;
  h.client.neutral();
  const due = h.timers.find((timer) => !timer.cleared);
  h.clock.value = 110;
  due.fn();
  assert.equal(socket.sent.length, 3);
  assert.equal(socket.sent.at(-1).moveX, 0);
  const keepalive = h.timers.find((timer) => !timer.cleared && timer !== due);
  assert.ok(keepalive);
  h.client.dispose();
  assert.ok(keepalive.cleared);
});

test('a deferred neutral is still sent when the page becomes hidden', async () => {
  Socket.all = [];
  let hidden = false;
  const h = makeClient({ hidden: () => hidden });
  await h.client.create('A');
  const socket = Socket.all[0];
  socket.open();
  h.clock.value = 60;
  h.client.setInput({ moveX: 1 });
  hidden = true;
  h.clock.value = 80;
  h.client.neutral();
  h.clock.value = 110;
  h.timers.find((timer) => !timer.cleared).fn();
  assert.equal(socket.sent.at(-1).moveX, 0);
  h.client.dispose();
});
