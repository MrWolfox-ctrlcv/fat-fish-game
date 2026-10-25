import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createArenaRooms } from '../backend/arena-rooms.mjs';
import { decodeArenaSnapshot } from '../playroom/src/arena-network.js';

const ORIGIN = 'http://localhost:4180';
async function request(port, path, { method = 'GET', body, cookie, origin = ORIGIN } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  const setCookie = response.headers.get('set-cookie')?.split(';')[0];
  return { response, data, cookie: setCookie || cookie };
}
async function fixture(t, { maxRooms = 2, fakeClock = false } = {}) {
  const origins = new Set([ORIGIN]);
  let clockNow = Date.now();
  const intervals = [];
  const service = createArenaRooms({ origins, production: false, maxRooms,
    ...(fakeClock ? { now: () => clockNow,
      setIntervalFn: (fn, ms) => { const item = { fn, ms, cleared: false, unref() {} }; intervals.push(item); return item; },
      clearIntervalFn: (item) => { if (item) item.cleared = true; } } : {}) });
  const server = createServer(async (req, res) => {
    if (!await service.handleHttp(req, res, new URL(req.url, 'http://local'))) { res.writeHead(404).end(); }
  });
  service.attach(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  t.after(async () => { service.close(); server.close(); await once(server, 'close').catch(() => {}); });
  return { port, service, intervals, advance: (ms) => { clockNow += ms; } };
}

test('rooms authenticate by cookie and origin, enforce host start, and stream authoritative binary state', async (t) => {
  const { port } = await fixture(t);
  const created = await request(port, '/games/bumper/api/rooms', { method: 'POST', body: { nickname: 'Guest <one>' } });
  assert.equal(created.response.status, 201);
  assert.match(created.cookie, /^arena_session=[a-f0-9]{64}$/);
  const code = created.data.room.code;
  assert.equal(created.data.room.seats[0].nickname, 'Guest one');
  const joined = await request(port, '/games/bumper/api/rooms/join', { method: 'POST', body: { code, nickname: 'Guest two' } });
  assert.equal(joined.response.status, 200);
  const forbidden = await request(port, '/games/bumper/api/rooms/start', { method: 'POST', body: {}, cookie: joined.cookie });
  assert.equal(forbidden.response.status, 403);
  const started = await request(port, '/games/bumper/api/rooms/start', { method: 'POST', body: {}, cookie: created.cookie });
  assert.equal(started.response.status, 200);
  assert.equal(started.data.room.phase, 'playing');
  const wrongOrigin = await request(port, '/games/bumper/api/rooms/leave', { method: 'POST', body: {}, cookie: joined.cookie, origin: 'https://attacker.example' });
  assert.equal(wrongOrigin.response.status, 403);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/games/bumper/socket`, { headers: { Cookie: created.cookie, Origin: ORIGIN } });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  const duplicate = new WebSocket(`ws://127.0.0.1:${port}/games/bumper/socket`, { headers: { Cookie: created.cookie, Origin: ORIGIN } });
  duplicate.on('error', () => {});
  const [, duplicateResponse] = await once(duplicate, 'unexpected-response');
  assert.equal(duplicateResponse.statusCode, 503, 'a cookie cannot open unbounded duplicate sockets');
  duplicate.terminate();
  const packets = [];
  ws.on('message', (data, binary) => packets.push({ data, binary }));
  ws.send(JSON.stringify({ type: 'input', seq: 1, moveX: 1, moveY: 0, aimX: 950, aimY: 450, primary: true, x: -10000, kills: 9999 }));
  const deadline = Date.now() + 1500;
  while (!packets.some((packet) => packet.binary) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  const packet = packets.find((entry) => entry.binary);
  assert.ok(packet, 'a binary snapshot should arrive');
  const snapshot = decodeArenaSnapshot(packet.data);
  assert.equal(snapshot.phase, 'playing');
  assert.equal(snapshot.fighters.length, 6);
  assert.equal(snapshot.fighters.filter((fighter) => fighter.isHuman).length, 2);
  assert.ok(snapshot.fighters.every((fighter) => Number.isFinite(fighter.x) && Number.isFinite(fighter.y)));
  const self = snapshot.fighters.find((fighter) => fighter.id === 0);
  assert.notEqual(self.kills, 9999, 'client score fields are ignored');
  assert.ok(self.x > 600, 'the authoritative simulation consumes movement input');
  const me = await request(port, '/games/bumper/api/rooms/me', { cookie: created.cookie });
  assert.equal(me.data.room.self_id, 0);
});

test('room mutations reject missing or foreign Origin and leave clears the cookie session seat', async (t) => {
  const { port } = await fixture(t);
  const missing = await request(port, '/games/bumper/api/rooms', { method: 'POST', body: {}, origin: null });
  assert.equal(missing.response.status, 403);
  const created = await request(port, '/games/bumper/api/rooms', { method: 'POST', body: { nickname: 'A' } });
  const left = await request(port, '/games/bumper/api/rooms/leave', { method: 'POST', body: {}, cookie: created.cookie });
  assert.equal(left.response.status, 200);
  const me = await request(port, '/games/bumper/api/rooms/me', { cookie: created.cookie });
  assert.equal(me.data.room, null);
});

test('room capacity, invalid codes, and attacker-chosen cookie values stay bounded', async (t) => {
  const { port } = await fixture(t, { maxRooms: 1 });
  const fixed = 'arena_session=' + 'a'.repeat(64);
  const created = await request(port, '/games/bumper/api/rooms', { method: 'POST', body: { nickname: 'abcdefghijklmnop' }, cookie: fixed });
  assert.equal(created.response.status, 201);
  assert.notEqual(created.cookie, fixed, 'unknown client-chosen session values are replaced');
  assert.equal(created.data.room.seats[0].nickname, 'abcdefghijkl');
  const full = await request(port, '/games/bumper/api/rooms', { method: 'POST', body: {} });
  assert.equal(full.response.status, 503);
  assert.equal(full.data.code, 'no_slots');
  assert.equal(full.cookie, undefined, 'failed room creation does not allocate a session');
  const invalid = await request(port, '/games/bumper/api/rooms/join', { method: 'POST', body: { code: '12x' } });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.data.code, 'invalid_code');
});

test('multiple rooms advance the same number of fixed physics steps', async (t) => {
  const { port } = await fixture(t);
  const left = await request(port, '/games/bumper/api/rooms', { method: 'POST', body: { nickname: 'Left' } });
  const right = await request(port, '/games/bumper/api/rooms', { method: 'POST', body: { nickname: 'Right' } });
  for (const host of [left, right]) {
    const started = await request(port, '/games/bumper/api/rooms/start', { method: 'POST', body: {}, cookie: host.cookie });
    assert.equal(started.response.status, 200);
  }
  const clients = [left, right].map((host) => new WebSocket(`ws://127.0.0.1:${port}/games/bumper/socket`, { headers: { Cookie: host.cookie, Origin: ORIGIN } }));
  t.after(() => clients.forEach((ws) => ws.terminate()));
  await Promise.all(clients.map((ws) => once(ws, 'open')));
  const latest = [[], []];
  clients.forEach((ws, index) => ws.on('message', (data, binary) => { if (binary) latest[index].push(decodeArenaSnapshot(data)); }));
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.ok(latest[0].length && latest[1].length);
  assert.equal(latest[0].at(-1).time, latest[1].at(-1).time);
});

test('an explicit mid-match leave hands that fighter back to the bot brain', async (t) => {
  const { port } = await fixture(t);
  const host = await request(port, '/games/bumper/api/rooms', { method: 'POST', body: { nickname: 'Host' } });
  const guest = await request(port, '/games/bumper/api/rooms/join', { method: 'POST', body: { code: host.data.room.code, nickname: 'Guest' } });
  await request(port, '/games/bumper/api/rooms/start', { method: 'POST', body: {}, cookie: host.cookie });
  const left = await request(port, '/games/bumper/api/rooms/leave', { method: 'POST', body: {}, cookie: guest.cookie });
  assert.equal(left.response.status, 200);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/games/bumper/socket`, { headers: { Cookie: host.cookie, Origin: ORIGIN } });
  t.after(() => ws.terminate());
  const snapshots = [];
  ws.on('message', (data, binary) => { if (binary) snapshots.push(decodeArenaSnapshot(data)); });
  await once(ws, 'open');
  const deadline = Date.now() + 500;
  while (!snapshots.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  const snapshot = snapshots.at(-1);
  assert.ok(snapshot);
  assert.equal(snapshot.fighters.find((fighter) => fighter.id === 1).isHuman, false);
});

test('ended rooms send a final binary snapshot and reconnect restores it', async (t) => {
  const { port, intervals, advance } = await fixture(t, { fakeClock: true });
  const host = await request(port, '/games/bumper/api/rooms', { method: 'POST', body: { nickname: 'Host' } });
  const started = await request(port, '/games/bumper/api/rooms/start', { method: 'POST', body: {}, cookie: host.cookie });
  assert.equal(started.response.status, 200);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/games/bumper/socket`, { headers: { Cookie: host.cookie, Origin: ORIGIN } });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  const snapshots = [];
  const events = [];
  ws.on('message', (data, binary) => binary ? snapshots.push(decodeArenaSnapshot(data)) : events.push(JSON.parse(data.toString())));
  for (let i = 0; i < 5500; i++) {
    advance(17);
    for (const interval of intervals) if (!interval.cleared && interval.ms < 100) interval.fn();
    if (i % 60 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshots.at(-1)?.phase, 'ended');
  assert.ok(events.some((message) => message.type === 'events' && message.events.some((event) => event.type === 'end')));
  ws.terminate();
  await once(ws, 'close');
  const reconnected = new WebSocket(`ws://127.0.0.1:${port}/games/bumper/socket`, { headers: { Cookie: host.cookie, Origin: ORIGIN } });
  t.after(() => reconnected.terminate());
  const replay = [];
  reconnected.on('message', (data, binary) => { if (binary) replay.push(decodeArenaSnapshot(data)); });
  await once(reconnected, 'open');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(replay[0]?.phase, 'ended');
  const rematch = await request(port, '/games/bumper/api/rooms/start', { method: 'POST', body: {}, cookie: host.cookie });
  assert.equal(rematch.response.status, 200);
  assert.equal(rematch.data.room.phase, 'playing');
});

test('an abandoned playing room suspends physics, reconnects during grace, and is collected', async (t) => {
  const { port, service, intervals, advance } = await fixture(t, { fakeClock: true });
  const host = await request(port, '/games/bumper/api/rooms', { method: 'POST', body: { nickname: 'Host' } });
  await request(port, '/games/bumper/api/rooms/start', { method: 'POST', body: {}, cookie: host.cookie });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/games/bumper/socket`, { headers: { Cookie: host.cookie, Origin: ORIGIN } });
  await once(ws, 'open');
  ws.terminate(); await once(ws, 'close'); await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(service.metrics().playing, 0);
  const abandoned = await request(port, '/games/bumper/api/rooms/me', { cookie: host.cookie });
  assert.equal(abandoned.data.room.phase, 'abandoned');
  const retry = new WebSocket(`ws://127.0.0.1:${port}/games/bumper/socket`, { headers: { Cookie: host.cookie, Origin: ORIGIN } });
  t.after(() => retry.terminate());
  await once(retry, 'open');
  assert.equal(service.metrics().playing, 1);
  retry.terminate(); await once(retry, 'close'); await new Promise((resolve) => setTimeout(resolve, 10));
  advance(31000);
  for (const interval of intervals) if (!interval.cleared && interval.ms >= 5000) interval.fn();
  assert.equal(service.metrics().rooms, 0);
  const cleared = await request(port, '/games/bumper/api/rooms/me', { cookie: host.cookie });
  assert.equal(cleared.data.room, null);
});
