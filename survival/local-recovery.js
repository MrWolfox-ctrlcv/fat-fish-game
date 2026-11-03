export const LOCAL_RECOVERY_VERSION = 1;
export const LOCAL_RECOVERY_MAX_BYTES = 400 * 1024;
export const LOCAL_RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'fat-fish:survivor:local-recovery:v1:';
const phases = new Set(['playing', 'trait', 'reward', 'rest']);
const byteLength = value => typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(value).length : value.length;

function validOwner(owner) {
  return owner === 'guest' || (typeof owner === 'string' && /^account:[1-9]\d*$/.test(owner));
}
function safeJson(value) {
  const seen = new Set();
  function visit(v,depth=0) {
    if(depth>24)throw Error('too deep');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw Error('non-finite number'); return; }
    if (typeof v !== 'object' || seen.has(v)) throw Error('not JSON-safe');
    seen.add(v);
    if (Array.isArray(v)) { for (const item of v) visit(item,depth+1); }
    else {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw Error('unsafe object');
      for (const key of Object.keys(v)) { if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw Error('unsafe key'); visit(v[key],depth+1); }
    }
    seen.delete(v);
  }
  visit(value);
  return JSON.parse(JSON.stringify(value));
}

export function createLocalRecovery({ storage, now = () => Date.now() } = {}) {
  if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
  const keyFor = owner => `${KEY_PREFIX}${encodeURIComponent(owner)}`;
  function load(owner) {
    if (!validOwner(owner) || !storage) return null;
    try {
      const raw = storage.getItem(keyFor(owner));
      if (!raw || byteLength(raw) > LOCAL_RECOVERY_MAX_BYTES) return null;
      const record = JSON.parse(raw);
      if (!record || record.version !== LOCAL_RECOVERY_VERSION || record.owner !== owner || !Number.isFinite(record.updatedAt) || now() - record.updatedAt < 0 || now() - record.updatedAt > LOCAL_RECOVERY_TTL_MS || typeof record.runId !== 'string' || !record.runId || !phases.has(record.snapshot?.phase)) return null;
      return safeJson(record.snapshot);
    } catch { return null; }
  }
  function save(owner, snapshot, { runId } = {}) {
    if (!validOwner(owner) || !storage || typeof runId !== 'string' || !runId) return false;
    try {
      if (!phases.has(snapshot?.phase)) { if (snapshot?.phase === 'lost' || snapshot?.phase === 'won') clear(owner); return false; }
      const copy = safeJson(snapshot);
      const record = { version: LOCAL_RECOVERY_VERSION, owner, runId, updatedAt: now(), snapshot: copy };
      const raw = JSON.stringify(record);
      if (byteLength(raw) > LOCAL_RECOVERY_MAX_BYTES) return false;
      storage.setItem(keyFor(owner), raw);
      return true;
    } catch { return false; }
  }
  function clear(owner) {
    if (!validOwner(owner) || !storage) return false;
    try { storage.removeItem(keyFor(owner)); return true; } catch { return false; }
  }
  return Object.freeze({ save, load, clear });
}
