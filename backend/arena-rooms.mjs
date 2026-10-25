import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createGame, stepArena } from '../playroom/src/modes/bumper.js';
import { encodeArenaSnapshot } from '../playroom/src/arena-network.js';

const COOKIE = 'arena_session';
const MAX_SESSIONS = 128;
const MAX_BODY = 4096;
const MAX_WS_BUFFER = 64 * 1024;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const randomHex = (size = 32) => randomBytes(size).toString('hex');
const playerId = (value) => Number.isInteger(value) && value >= 0 && value < 6 ? value : null;
const validNickname = (value) => {
  const name = typeof value === 'string' ? [...value.replace(/[<>\u0000-\u001f\u007f]/g, '').trim()].slice(0, 12).join('') : '';
  return name || `玩家${Math.floor(Math.random() * 900 + 100)}`;
};
const cookieValue = (request) => {
  const found = (request.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(found || '') ? found : null;
};
const rejectUpgrade = (socket, status = 403) => {
  const label = ({ 403: 'Forbidden', 404: 'Not Found', 503: 'Service Unavailable' })[status] || 'Forbidden';
  socket.write(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
};

export function serializeArenaEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.filter((event) => ['kill', 'friendly-fire', 'fall', 'end'].includes(event?.type)).slice(0, 32).flatMap((event) => {
    if (event.type === 'end') return [{ type: 'end', id: 0, by: -1 }];
    const victimId = playerId(event.type === 'fall' ? event.victimId ?? event.id : event.victimId);
    if (victimId === null) return [];
    const attackerId = playerId(event.attackerId);
    const common = {
      type: event.type, id: victimId, by: attackerId ?? -1,
      ...(event.teamId === 0 || event.teamId === 1 ? { teamId: event.teamId } : {}),
      ...(event.teamScoreDelta === -1 || event.teamScoreDelta === 0 || event.teamScoreDelta === 1 ? { teamScoreDelta: event.teamScoreDelta } : {}),
    };
    return [event.type === 'fall' && typeof event.suicide === 'boolean' ? { ...common, suicide: event.suicide } : common];
  });
}

export function createArenaRooms({ origins = new Set(), env = process.env, production = env.NODE_ENV === 'production', now = Date.now,
  maxRooms = Number(env.ARENA_MAX_ROOMS || 2), setIntervalFn = setInterval, clearIntervalFn = clearInterval, server } = {}) {
  maxRooms = clamp(Number.isInteger(maxRooms) ? maxRooms : 2, 1, 8);
  const rooms = new Map();
  const sessions = new Map();
  const limits = new Map();
  const sockets = new Set();
  let timer = null;
  let gcTimer = null;
  let heartbeat = null;
  let closed = false;
  let tick = 0;
  let lastTick = now();
  let lastSnapshot = now();
  let accumulatedTime = 0;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });

  function throttle(key, max, windowMs) {
    const time = now();
    let entry = limits.get(key);
    if (!entry && limits.size >= 2048) {
      for (const [oldKey, old] of limits) if (time - old.start > 60000) limits.delete(oldKey);
      if (limits.size >= 2048) throw Object.assign(new Error('操作太频繁，请稍后再试。'), { status: 429 });
    }
    if (!entry || time - entry.start >= windowMs) { entry = { start: time, count: 0 }; limits.set(key, entry); }
    if (++entry.count > max) throw Object.assign(new Error('操作太频繁，请稍后再试。'), { status: 429 });
  }
  function originAllowed(origin) { return Boolean(origin) && (origins.has(origin) || (!production && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))); }
  function sameOrigin(request) {
    const origin = request.headers.origin;
    if (!originAllowed(origin)) throw Object.assign(new Error('来源校验失败。'), { status: 403 });
  }
  function cookieHeader(request, token) {
    const secure = request.headers['x-forwarded-proto'] === 'https' || request.socket.encrypted ? '; Secure' : '';
    return `${COOKIE}=${token}; Path=/games/bumper; HttpOnly; SameSite=Strict${secure}`;
  }
  function setSession(request, response) {
    let token = cookieValue(request);
    if (!token || !sessions.has(token)) token = randomHex(32);
    if (!sessions.has(token)) {
      if (sessions.size >= MAX_SESSIONS) throw Object.assign(new Error('房间暂时繁忙，请稍后再试。'), { status: 503 });
      sessions.set(token, { roomCode: null, seatId: null, lastSeen: now() });
    }
    sessions.get(token).lastSeen = now();
    response.setHeader('Set-Cookie', cookieHeader(request, token));
    return { token, session: sessions.get(token) };
  }
  function cleanCode(value) { return typeof value === 'string' ? value.trim().toUpperCase() : ''; }
  function findRoom(code) { return rooms.get(cleanCode(code)); }
  function roomView(room, token) {
    const session = sessions.get(token);
    return { code: room.code, self_id: session?.roomCode === room.code ? session.seatId : null, host_id: room.hostId,
      phase: room.phase, mode: room.mode, seats: [...room.seats.values()].map((s) => ({ id: s.id, nickname: s.nickname, characterId: s.characterId, teamId: s.teamId, isHuman: true, connected: s.connected })) };
  }
  function roomChanged(room) {
    for (const seat of room.seats.values()) {
      const message = JSON.stringify({ type: 'room', room: roomView(room, seat.token) });
      for (const ws of seat.connections) if (ws.readyState === WebSocket.OPEN) ws.send(message);
    }
  }
  function codeExists(code) { return rooms.has(code); }
  function newCode() {
    for (let i = 0; i < 16; i++) {
      const n = randomBytes(4).readUInt32BE() % 1000000;
      const code = String(n).padStart(6, '0');
      if (!codeExists(code)) return code;
    }
    throw Object.assign(new Error('房间暂时繁忙，请稍后再试。'), { status: 503 });
  }
  function removeSeat(room, seat) {
    room.seats.delete(seat.id);
    const session = sessions.get(seat.token);
    if (session) { session.roomCode = null; session.seatId = null; }
    if (room.hostId === seat.id) room.hostId = [...room.seats.values()].find((s) => s.connected)?.id ?? [...room.seats.keys()][0] ?? null;
    if (!room.seats.size) room.emptySince = now();
  }
  function disposeRoom(code, room) {
    for (const seat of room.seats.values()) {
      for (const ws of seat.connections) { sockets.delete(ws); try { ws.terminate(); } catch {} }
      seat.connections.clear();
      const session = sessions.get(seat.token);
      if (session) { session.roomCode = null; session.seatId = null; }
    }
    room.seats.clear(); rooms.delete(code);
  }
  function leaveSeat(room, seat) {
    if (room.phase === 'playing') {
      const fighter = room.game?.fighters?.find((item) => item.id === seat.id);
      if (fighter) fighter.isHuman = false;
    }
    for (const ws of seat.connections) { try { ws.close(1000, 'left'); } catch {} }
    seat.connections.clear(); removeSeat(room, seat); roomChanged(room);
  }
  function locateSession(request) {
    const token = cookieValue(request); const session = token && sessions.get(token);
    if (!session || !session.roomCode) return null;
    const room = findRoom(session.roomCode); const seat = room?.seats.get(session.seatId);
    if (!room || !seat || seat.token !== token) return null;
    session.lastSeen = now(); return { token, session, room, seat };
  }
  async function readJson(request) {
    const type = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw Object.assign(new Error('请使用 JSON 提交。'), { status: 415 });
    let size = 0; const chunks = [];
    for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(new Error('提交内容过长。'), { status: 413 }); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch { throw Object.assign(new Error('提交内容格式错误。'), { status: 400 }); }
  }
  function tickRooms() {
    if (closed) return;
    const time = now();
    accumulatedTime += clamp((time - lastTick) / 1000, 0, 0.05);
    const steps = Math.min(3, Math.floor(accumulatedTime * 60));
    accumulatedTime -= steps / 60;
    tick = (tick + steps) & 0xffff;
    for (const [code, room] of rooms) {
      if (!room.seats.size) continue;
      for (const seat of [...room.seats.values()]) {
        if (!seat.connected && seat.disconnectedAt && time - seat.disconnectedAt > 20000) {
          if (room.phase === 'playing') {
            seat.botReplacement = true;
            const fighter = room.game?.fighters?.find((item) => item.id === seat.id);
            if (fighter) fighter.isHuman = false;
            seat.disconnectedAt = 0;
          } else removeSeat(room, seat);
          if (!room.seats.size) room.emptySince = time;
        }
      }
      if (room.phase === 'playing') {
        if (![...room.seats.values()].some((seat) => seat.connections.size)) {
          room.phase = 'abandoned'; room.emptySince = time; continue;
        }
        for (let step = 0; step < steps; step++) {
          const inputs = {};
          for (const seat of room.seats.values()) {
            const fresh = seat.connected && time - seat.inputAt <= 250;
            inputs[seat.id] = fresh ? { ...seat.input, primary: seat.primaryPending === true } : { moveX: 0, moveY: 0, aimX: 640, aimY: 450, primary: false };
            seat.primaryPending = false;
          }
          const events = stepArena(room.game, inputs, 1 / 60) || [];
          const evs = serializeArenaEvents(events);
          if (room.game.phase === 'won' || room.game.phase === 'lost' || room.game.phase === 'draw') {
            room.phase = 'ended'; room.endedAt = time;
            broadcastSnapshot(room, 'ended');
            if (evs.length) broadcastEvents(room, evs);
            if (!evs.some((event) => event.type === 'end')) broadcastEvents(room, [{ type: 'end', id: 0, by: -1 }]);
            roomChanged(room); break;
          }
          if (evs.length) broadcastEvents(room, evs);
        }
      }
    }
    lastTick = time;
    if (time - lastSnapshot >= 100) {
      for (const room of rooms.values()) if (room.phase === 'playing' && room.game) broadcastSnapshot(room, room.phase);
      lastSnapshot = time;
    }
    if (![...rooms.values()].some((r) => r.phase === 'playing')) stopTimer();
  }
  function collectGarbage() {
    const time = now();
    for (const [code, room] of rooms) {
      if ((!room.seats.size || room.phase === 'abandoned') && room.emptySince && time - room.emptySince > 30000) disposeRoom(code, room);
      else if (room.phase === 'waiting' && time - room.created > 600000) {
        disposeRoom(code, room);
      } else if (room.phase === 'ended' && time - room.endedAt > 120000) {
        disposeRoom(code, room);
      }
    }
    for (const [token, session] of sessions) if (time - session.lastSeen > 1800000 && !session.roomCode) sessions.delete(token);
    for (const [key, value] of limits) if (time - value.start > 60000) limits.delete(key);
  }
  function ensureTimer() { if (!timer && !closed) { lastTick = now(); lastSnapshot = now(); accumulatedTime = 0; timer = setIntervalFn(tickRooms, 1000 / 60); timer.unref?.(); } }
  function stopTimer() { if (timer) { clearIntervalFn(timer); timer = null; } }
  function ensureHeartbeat() {
    if (!heartbeat && !closed) {
      heartbeat = setIntervalFn(() => {
        for (const ws of sockets) { if (ws.isAlive === false) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
        if (!sockets.size && heartbeat) { clearIntervalFn(heartbeat); heartbeat = null; }
      }, 30000);
      heartbeat.unref?.();
    }
  }
  function broadcastEvents(room, events) {
    const data = JSON.stringify({ type: 'events', events: events.slice(0, 32) });
    for (const seat of room.seats.values()) for (const ws of seat.connections) if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
  function broadcastSnapshot(room, phase = room.phase) {
    if (!room.game) return;
    const packet = encodeArenaSnapshot({ tick, time: room.game.time, phase, radius: room.game.arenaRadius,
      mode: room.game.mode ?? room.mode, teamScores: room.game.teamScores, fighters: room.game.fighters });
    for (const seat of room.seats.values()) for (const ws of seat.connections) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount > MAX_WS_BUFFER) { ws.slowCount++; if (ws.slowCount > 3) ws.terminate(); continue; }
      ws.slowCount = 0; ws.send(packet, { binary: true });
    }
  }
  function startRoom(room) {
    const humanIds = [...room.seats.keys()];
    room.seed = randomBytes(4).readUInt32BE() || 1;
    const humanTeams = Object.fromEntries([...room.seats.values()].filter((seat) => seat.teamId === 0 || seat.teamId === 1).map((seat) => [seat.id, seat.teamId]));
    room.game = createGame({ seed: room.seed, mode: room.mode, humanIds, humanTeams,
      humanCharacters: Object.fromEntries([...room.seats.values()].map((s) => [s.id, s.characterId])) });
    room.phase = 'playing'; room.startedAt = now(); room.endedAt = 0; room.emptySince = 0;
    for (const seat of room.seats.values()) {
      seat.input = { moveX: 0, moveY: 0, aimX: 640, aimY: 450, primary: false };
      seat.inputAt = 0; seat.primaryPending = false; seat.botReplacement = false;
    }
    ensureTimer(); roomChanged(room);
  }
  function attach(server) {
    server.on('upgrade', (request, socket, head) => {
      let path; try { path = new URL(request.url, 'http://local').pathname; } catch { return rejectUpgrade(socket, 404); }
      if (path !== '/games/bumper/socket') return rejectUpgrade(socket, 404);
      const found = locateSession(request);
      if (request.method !== 'GET' || !originAllowed(request.headers.origin) || !found) return rejectUpgrade(socket, 403);
      if (sockets.size >= maxRooms * 6 || found.seat.connections.size >= 1) return rejectUpgrade(socket, 503);
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    });
  }
  wss.on('connection', (ws, request) => {
    const found = locateSession(request);
    if (!found) { ws.close(1008, 'unauthorized'); return; }
    const { room, seat } = found;
    ensureHeartbeat();
    if (room.phase === 'abandoned' && room.game) { room.phase = 'playing'; room.emptySince = 0; ensureTimer(); }
    seat.connected = true; seat.disconnectedAt = 0; seat.connections.add(ws); sockets.add(ws);
    if (seat.botReplacement && room.game) {
      const fighter = room.game.fighters.find((item) => item.id === seat.id);
      if (fighter) fighter.isHuman = true;
      seat.botReplacement = false;
    }
    roomChanged(room);
    ws.binaryType = 'arraybuffer'; ws.isAlive = true; ws.slowCount = 0;
    let lastSeq = -1;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data, binary) => {
      if (binary || data.length > 1024 || room.phase !== 'playing') return;
      let message; try { message = JSON.parse(data.toString()); } catch { return; }
      if (message?.type !== 'input' || !Number.isSafeInteger(message.seq) || message.seq < 0 || message.seq > 0x7fffffff) return;
      try { throttle(`input:${found.token}`, 30, 1000); } catch { return; }
      if (message.seq <= lastSeq) return;
      lastSeq = message.seq;
      const norm = (x, y) => { let a = Number(x), b = Number(y); if (!Number.isFinite(a) || !Number.isFinite(b)) return [0, 0]; const l = Math.hypot(a, b); return l > 1 ? [a / l, b / l] : [a, b]; };
      const [moveX, moveY] = norm(message.moveX, message.moveY);
      const aimX = Number.isFinite(Number(message.aimX)) ? clamp(Number(message.aimX), 0, 1280) : 640;
      const aimY = Number.isFinite(Number(message.aimY)) ? clamp(Number(message.aimY), 0, 900) : 450;
      if (message.primary === true) seat.primaryPending = true;
      seat.input = { moveX, moveY, aimX, aimY, primary: false }; seat.inputAt = now();
    });
    ws.on('close', () => {
      sockets.delete(ws); seat.connections.delete(ws);
      if (!sockets.size && heartbeat) { clearIntervalFn(heartbeat); heartbeat = null; }
      if (!seat.connections.size) { seat.connected = false; seat.primaryPending = false; seat.disconnectedAt = now(); roomChanged(room); }
      if (room.phase === 'playing' && ![...room.seats.values()].some((item) => item.connections.size)) {
        room.phase = 'abandoned'; room.emptySince = now();
        if (![...rooms.values()].some((item) => item !== room && item.phase === 'playing')) stopTimer();
      }
    });
    ws.on('error', () => {});
    ws.send(JSON.stringify({ type: 'room', room: roomView(room, found.token) }));
    if (room.game && ['playing', 'ended'].includes(room.phase)) ws.send(encodeArenaSnapshot({ tick, time: room.game.time, phase: room.phase,
      radius: room.game.arenaRadius, mode: room.game.mode ?? room.mode, teamScores: room.game.teamScores, fighters: room.game.fighters }));
  });
  async function handleHttp(request, response, url) {
    const path = url.pathname;
    if (path !== '/games/bumper/api/rooms' && !path.startsWith('/games/bumper/api/rooms/')) return false;
    const send = (status, value) => { response.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    try {
      const suffix = path.slice('/games/bumper/api/rooms'.length) || '/';
      if (suffix === '/' && request.method === 'POST' || suffix === '/join' && request.method === 'POST' || suffix === '/start' && request.method === 'POST' || suffix === '/leave' && request.method === 'POST') sameOrigin(request);
      const clientIP = request.headers['x-real-ip'] || request.socket.remoteAddress || 'unknown';
      if (suffix === '/' && request.method === 'POST') {
        throttle(`create:${clientIP}`, 2, 60000);
        const input = await readJson(request);
        const mode = input.mode === undefined ? 'ffa' : input.mode;
        if (!['ffa', 'teams'].includes(mode)) throw Object.assign(new Error('对局模式不正确。'), { status: 400, code: 'invalid_mode' });
        if (mode === 'teams' && input.teamId !== 0 && input.teamId !== 1) throw Object.assign(new Error('请选择红队或蓝队。'), { status: 400, code: 'invalid_team' });
        if (rooms.size >= maxRooms) throw Object.assign(new Error('目前房间较多，请稍后再试。'), { status: 503, code: 'no_slots' });
        const { token, session } = setSession(request, response);
        if (session.roomCode) { const prev = findRoom(session.roomCode); const ps = prev?.seats.get(session.seatId); if (prev && ps) leaveSeat(prev, ps); }
        const teamId = mode === 'teams' ? input.teamId : null;
        const code = newCode(); const seat = { id: 0, token, nickname: validNickname(input.nickname), characterId: teamId === 1 ? 'gptNormal' : 'deepseek', teamId,
          connected: false, connections: new Set(), input: { moveX: 0, moveY: 0, aimX: 640, aimY: 450, primary: false }, inputAt: 0, disconnectedAt: 0 };
        const room = { code, hostId: 0, mode, seats: new Map([[0, seat]]), phase: 'waiting', created: now(), emptySince: 0, seed: randomBytes(4).readUInt32BE() || 1, game: null };
        rooms.set(code, room); session.roomCode = code; session.seatId = 0;
        send(201, { success: true, room: roomView(room, token) }); return true;
      }
      if (suffix === '/join' && request.method === 'POST') {
        throttle(`join:${clientIP}`, 10, 60000);
        const input = await readJson(request); const code = cleanCode(input.code);
        if (!/^\d{6}$/.test(code)) throw Object.assign(new Error('房间号格式不正确。'), { status: 400, code: 'invalid_code' });
        const room = findRoom(code);
        if (!room) throw Object.assign(new Error('房间不存在。'), { status: 404, code: 'room_not_found' });
        if (room.phase !== 'waiting' && room.phase !== 'ended') throw Object.assign(new Error('房间当前无法加入。'), { status: 409, code: 'room_not_started' });
        if (room.seats.size >= 6) throw Object.assign(new Error('房间已满。'), { status: 409, code: 'room_full' });
        let teamId = null;
        if (room.mode === 'teams') {
          if (input.teamId !== undefined && input.teamId !== 0 && input.teamId !== 1) throw Object.assign(new Error('队伍编号不正确。'), { status: 400, code: 'invalid_team' });
          const counts = [0, 0];
          for (const seat of room.seats.values()) if (seat.teamId === 0 || seat.teamId === 1) counts[seat.teamId]++;
          teamId = input.teamId === undefined ? (counts[0] <= counts[1] ? 0 : 1) : input.teamId;
          if (counts[teamId] >= 3) throw Object.assign(new Error('这支队伍已满。'), { status: 409, code: 'team_full' });
        }
        const { token, session } = setSession(request, response);
        if (session.roomCode) { const prev = findRoom(session.roomCode); const ps = prev?.seats.get(session.seatId); if (prev && ps) leaveSeat(prev, ps); }
        const id = [0, 1, 2, 3, 4, 5].find((i) => !room.seats.has(i));
        const seat = { id, token, nickname: validNickname(input.nickname), characterId: teamId === 1 ? 'gptNormal' : 'deepseek', teamId, connected: false, connections: new Set(), input: { moveX: 0, moveY: 0, aimX: 640, aimY: 450, primary: false }, inputAt: 0, disconnectedAt: 0 };
        room.seats.set(id, seat); session.roomCode = code; session.seatId = id; roomChanged(room);
        send(200, { success: true, room: roomView(room, token) }); return true;
      }
      if (suffix === '/me' && request.method === 'GET') {
        const token = cookieValue(request); const found = token && locateSession(request);
        if (!found) { send(200, { success: true, room: null }); return true; }
        send(200, { success: true, room: roomView(found.room, token) }); return true;
      }
      if (suffix === '/leave' && request.method === 'POST') {
        await readJson(request);
        const found = locateSession(request); if (!found) throw Object.assign(new Error('你当前不在房间中。'), { status: 409 });
        leaveSeat(found.room, found.seat); send(200, { success: true }); return true;
      }
      if (suffix === '/start' && request.method === 'POST') {
        await readJson(request);
        const found = locateSession(request); if (!found) throw Object.assign(new Error('你当前不在房间中。'), { status: 409 });
        if (found.seat.id !== found.room.hostId) throw Object.assign(new Error('只有房主可以开始。'), { status: 403 });
        if (!['waiting', 'ended'].includes(found.room.phase) || !found.room.seats.size) throw Object.assign(new Error('房间当前不能开始。'), { status: 409 });
        startRoom(found.room); send(200, { success: true, room: roomView(found.room, found.token) }); return true;
      }
      send(404, { success: false, message: '接口不存在。' }); return true;
    } catch (error) { send(error.status || 500, { success: false, message: error.status ? error.message : '服务暂时繁忙，请稍后重试。', code: error.code || null }); return true; }
  }
  function close() {
    if (closed) return; closed = true; stopTimer(); if (heartbeat) clearIntervalFn(heartbeat); if (gcTimer) clearIntervalFn(gcTimer);
    for (const ws of sockets) try { ws.terminate(); } catch {}
    sockets.clear(); rooms.clear(); sessions.clear(); limits.clear(); wss.close();
  }
  function metrics() { return { rooms: rooms.size, sessions: sessions.size, connections: sockets.size, playing: [...rooms.values()].filter((r) => r.phase === 'playing').length }; }
  if (server) attach(server);
  gcTimer = setIntervalFn(collectGarbage, 5000); gcTimer.unref?.();
  return { handleHttp, attach, close, metrics };
}
