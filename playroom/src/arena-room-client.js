import { decodeArenaSnapshot } from './arena-network.js';

const cleanRoom = (payload) => {
  if (payload && Object.hasOwn(payload, 'room')) return payload.room;
  if (payload?.data && Object.hasOwn(payload.data, 'room')) return payload.data.room;
  return payload?.data ?? payload;
};
const sameInput = (a, b) => ['moveX', 'moveY', 'aimX', 'aimY', 'primary'].every((key) => a[key] === b[key]);

export function createArenaRoomClient({
  fetchImpl = fetch,
  WebSocketImpl = globalThis.WebSocket,
  basePath = '/games/bumper',
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => Date.now(),
  urlBase = () => globalThis.location?.href || 'http://localhost/',
  isHidden = () => Boolean(globalThis.document?.hidden),
  onRoom = () => {},
  onEvents = () => {},
  onSnapshot = () => {},
  onStatus = () => {},
} = {}) {
  let generation = 0;
  let room = null;
  let socket = null;
  let retryTimer = null;
  let retryCount = 0;
  let disposed = false;
  let seq = 0;
  let nextPrimary = false;
  let lastSent = null;
  let lastSentAt = 0;
  let currentInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, primary: false };
  let inputTimer = null;
  let online = false;

  async function request(path, body) {
    const response = await fetchImpl(`${basePath}/api/rooms${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let result = {};
    try { result = await response.json(); } catch { /* A friendly HTTP error below is enough. */ }
    if (!response.ok) {
      const detail = result.error;
      const error = new Error(result.message || (typeof detail === 'string' ? detail : detail?.message) || `请求失败（${response.status}）`);
      error.status = response.status;
      error.code = result.code || detail?.code;
      throw error;
    }
    return result;
  }

  function stopSocket() {
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
    if (inputTimer !== null) clearTimer(inputTimer);
    inputTimer = null;
    const old = socket;
    socket = null;
    if (old && old.readyState < 2) old.close(1000, 'room changed');
  }

  function notifyRoom(value) {
    room = cleanRoom(value);
    if (room) onRoom(room);
  }

  function connect(expectedGeneration) {
    if (disposed || expectedGeneration !== generation || !room || !WebSocketImpl) return;
    stopSocket();
    const url = new URL(`${basePath}/socket`, urlBase());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try { ws = new WebSocketImpl(url.href); }
    catch { scheduleRetry(expectedGeneration); return; }
    socket = ws;
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      if (expectedGeneration !== generation || socket !== ws) return;
      online = true;
      lastSent = null;
      lastSentAt = 0;
      onStatus('connected');
      sendInputNow();
      inputTimer = setTimer(sendInputNow, 50);
    });
    ws.addEventListener('message', (event) => {
      if (expectedGeneration !== generation || socket !== ws) return;
      try {
        if (typeof event.data === 'string') {
          const message = JSON.parse(event.data);
          if (message.type === 'room') notifyRoom(message);
          else if (message.type === 'events') onEvents(Array.isArray(message.events) ? message.events : []);
          else if (message.type === 'event') onEvents([message.event || message]);
        } else if (event.data instanceof ArrayBuffer || ArrayBuffer.isView(event.data)) {
          onSnapshot(decodeArenaSnapshot(event.data));
        }
      } catch { onStatus('snapshot-error'); }
    });
    ws.addEventListener('close', () => {
      if (expectedGeneration !== generation || socket !== ws) return;
      socket = null;
      online = false;
      if (inputTimer !== null) clearTimer(inputTimer);
      inputTimer = null;
      onStatus('reconnecting');
      scheduleRetry(expectedGeneration);
    });
    ws.addEventListener('error', () => { if (expectedGeneration === generation) onStatus('reconnecting'); });
  }

  function scheduleRetry(expectedGeneration) {
    if (disposed || expectedGeneration !== generation || retryCount >= 3 || retryTimer !== null) {
      if (retryCount >= 3) onStatus('retry-exhausted');
      return;
    }
    const delay = [1000, 2000, 5000][retryCount++];
    retryTimer = setTimer(() => { retryTimer = null; connect(expectedGeneration); }, delay);
  }

  function sendInputNow(force = false) {
    if (!online || !socket || socket.readyState !== 1 || (isHidden() && !force)) return;
    const primary = nextPrimary;
    const input = { ...currentInput, primary };
    const at = now();
    if (lastSent && at - lastSentAt < 50) return;
    if (sameInput(input, lastSent || {}) && at - lastSentAt < 200) return;
    try {
      socket.send(JSON.stringify({ type: 'input', seq: ++seq, ...input }));
      lastSent = input;
      lastSentAt = at;
      if (primary) nextPrimary = false;
    } catch { /* Socket close handler owns recovery. */ }
  }

  async function enter(path, data) {
    const mine = ++generation;
    disposed = false;
    stopSocket();
    onStatus('joining');
    const result = await request(path, data);
    if (mine !== generation || disposed) return room;
    retryCount = 0;
    notifyRoom(result);
    connect(mine);
    return room;
  }

  return {
    create: (nickname) => enter('', { nickname }),
    join: (code, nickname) => enter('/join', { code: String(code).replace(/\D/g, '').slice(0, 6), nickname }),
    restore: async () => {
      const mine = ++generation;
      disposed = false;
      stopSocket();
      onStatus('joining');
      try {
        const result = await request('/me');
        if (mine !== generation || disposed) return null;
        notifyRoom(result);
        if (!room) { onStatus('idle'); return null; }
        retryCount = 0;
        connect(mine);
        return room;
      } catch (error) {
        if (mine === generation) onStatus(error.status === 404 ? 'idle' : 'error');
        if (error.status === 404) return null;
        throw error;
      }
    },
    start: async () => {
      const mine = generation;
      const result = await request('/start', {});
      if (mine === generation && !disposed) notifyRoom(result);
      return room;
    },
    leave: async () => {
      ++generation;
      disposed = true;
      stopSocket();
      room = null;
      online = false;
      onRoom(null);
      try { await request('/leave', {}); } finally { onStatus('idle'); }
    },
    setInput(input = {}) {
      currentInput = {
        moveX: Number(input.moveX) || 0, moveY: Number(input.moveY) || 0,
        aimX: Number(input.aimX) || 0, aimY: Number(input.aimY) || 0, primary: false,
      };
      if (input.primary) nextPrimary = true;
      sendInputNow();
    },
    neutral() { currentInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, primary: false }; nextPrimary = false; sendInputNow(true); },
    retry() { if (!room || disposed) return; retryCount = 0; stopSocket(); onStatus('joining'); connect(generation); },
    get room() { return room; },
    get connected() { return online; },
    dispose() { ++generation; disposed = true; stopSocket(); online = false; room = null; onRoom(null); onStatus('idle'); },
  };
}
