const WARDROBE_URL = '/games/fat-fish/api/wardrobe';
const REFRESH_URL = '/api/user/auth/refresh';
const CHANNEL_NAME = 'new-api:auth-session';
const STARTER_IDS = new Set(['maid:1', 'gpt-silly:2', 'deepseek-claude:5']);
const STARTER = { id: 'maid:1', name: '女仆', level: 1, variant: null, unlocked: true, source: 'starter' };
const PREVIEWS = [
  STARTER,
  { id: 'gpt-silly:2', name: 'GPT 搞怪', level: 2, variant: null, unlocked: false, source: null },
  { id: 'deepseek-claude:5', name: 'DeepSeek × Claude', level: 5, variant: null, unlocked: false, source: null },
];

function tokenFrom(payload) {
  const token = payload?.data?.access_token ?? payload?.data?.accessToken ?? payload?.data?.token ?? payload?.access_token ?? payload?.accessToken ?? payload?.token;
  return typeof token === 'string' && token ? token : null;
}

function sessionIdentity(data) {
  const message = data?.data ?? data;
  const kind = message?.kind ?? message?.type;
  return kind === 'signed_out' || kind === 'authenticated' ? kind : null;
}

export function createWardrobeClient({ fetchImpl = globalThis.fetch.bind(globalThis), baseUrl = '' } = {}) {
  let token = null;
  let owner = null;
  let lastOwner = null;
  let disposed = false;
  let sessionGeneration = 0;
  let refreshFlight = null;
  const listeners = new Set();
  const controllers = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;
  const emit = (event) => { for (const listener of listeners) listener(event); };
  const clearSession = (reason = 'signed_out', source = 'local') => {
    const hadSession = token !== null || owner !== null || lastOwner !== null;
    const shouldEmit = hadSession || (source === 'broadcast' && reason === 'authenticated');
    if (!hadSession && source !== 'broadcast') return;
    sessionGeneration += 1;
    token = null;
    owner = null;
    if (reason === 'signed_out') lastOwner = null;
    refreshFlight = null;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    if (shouldEmit) emit({ type: reason, owner: null, source });
  };
  if (channel) channel.onmessage = ({ data }) => {
    const kind = sessionIdentity(data);
    if (kind) clearSession(kind, 'broadcast');
  };

  function refreshToken() {
    if (disposed) return Promise.reject(new Error('Wardrobe client is disposed'));
    if (token) return Promise.resolve(token);
    if (refreshFlight) return refreshFlight.promise;
    const generation = sessionGeneration;
    const flight = { promise: null };
    const perform = async () => {
      const locked = async () => {
        for (const delay of [0, 80, 200, 500]) {
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          if (generation !== sessionGeneration || disposed) throw new DOMException('Session changed', 'AbortError');
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(new DOMException('Refresh timeout', 'TimeoutError')), 8000);
          try {
            const response = await fetchImpl(`${baseUrl}${REFRESH_URL}`, {
              method: 'POST', credentials: 'include', headers: { Accept: 'application/json' },
              signal: controller.signal,
            });
            if (!response.ok) {
              if (response.status === 401 || response.status === 403) clearSession('signed_out');
              if (response.status === 409 || response.status === 429 || response.status === 503) continue;
              throw Object.assign(new Error(`Authentication refresh failed (${response.status})`), { status: response.status });
            }
            const body = await response.json();
            if (generation !== sessionGeneration || disposed) throw new DOMException('Session changed', 'AbortError');
            const payload = body?.data;
            const freshToken = tokenFrom(body);
            const nextOwner = payload?.user?.id ?? body?.user?.id;
            if (body?.success !== true || !freshToken || typeof nextOwner !== 'number' || !Number.isSafeInteger(nextOwner)) {
              throw new Error('Authentication refresh response is invalid');
            }
            const nextOwnerString = String(Number(nextOwner));
            if (lastOwner && lastOwner !== nextOwnerString) {
              token = null; owner = null;
              for (const pending of controllers) pending.abort();
              controllers.clear();
              emit({ type: 'account_changed', owner: nextOwnerString });
            } else if (!lastOwner) emit({ type: 'authenticated', owner: nextOwnerString, source: 'refresh' });
            token = freshToken;
            owner = nextOwnerString;
            lastOwner = owner;
            return token;
          } catch (error) {
            if (error?.name === 'AbortError' && controller.signal.aborted && !disposed && generation === sessionGeneration) {
              throw new Error('Authentication refresh timed out');
            }
            if (error.status !== 409 && error.status !== 429 && error.status !== 503) throw error;
          } finally { clearTimeout(timeout); }
        }
        throw new Error('Authentication refresh is busy');
      };
      return globalThis.navigator?.locks?.request
        ? navigator.locks.request('new-api:auth-refresh', locked)
        : locked();
    };
    flight.promise = perform().finally(() => { if (refreshFlight === flight) refreshFlight = null; });
    refreshFlight = flight;
    return flight.promise;
  }

  async function fetchAuthorized(url, options = {}) {
    if (disposed) throw new Error('Wardrobe client is disposed');
    let activeToken = token || await refreshToken();
    const controller = new AbortController();
    controllers.add(controller);
    const externalSignal = options.signal;
    const abort = () => controller.abort(externalSignal.reason);
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) abort();
    const signal = controller.signal;
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${activeToken}`);
    headers.set('Accept', headers.get('Accept') || 'application/json');
    const request = () => fetchImpl(`${baseUrl}${url}`, { ...options, headers, signal, credentials: 'include' });
    try {
      let response = await request();
      if (response.status === 401) {
        controllers.delete(controller);
        externalSignal?.removeEventListener('abort', abort);
        clearSession('token_expired');
        activeToken = await refreshToken();
        headers.set('Authorization', `Bearer ${activeToken}`);
        const retryController = new AbortController();
        controllers.add(retryController);
        const retryAbort = () => retryController.abort(externalSignal.reason);
        externalSignal?.addEventListener('abort', retryAbort, { once: true });
        try { return await fetchImpl(`${baseUrl}${url}`, { ...options, headers, signal: retryController.signal, credentials: 'include' }); }
        finally { controllers.delete(retryController); externalSignal?.removeEventListener('abort', retryAbort); }
      }
      return response;
    } finally { controllers.delete(controller); externalSignal?.removeEventListener('abort', abort); }
  }

  async function requestJson(url, options) {
    const response = await fetchAuthorized(url, options);
    if (!response.ok) throw Object.assign(new Error(`Request failed (${response.status})`), { status: response.status });
    return response.json();
  }
  async function get() {
    try { return await requestJson(WARDROBE_URL, { cache: 'no-cache' }); }
    catch (error) {
      if (error.status === 401 || error.status === 403) return { success: true, catalog: PREVIEWS, equipped: STARTER.id, unlocked_count: 1, total: 31, purchases_enabled: false, guest: true };
      throw error;
    }
  }
  async function equip(skinId) {
    if (skinId === STARTER.id && !token) return { success: true, catalog: PREVIEWS, equipped: STARTER.id, unlocked_count: 1, total: 31, purchases_enabled: false, guest: true };
    return requestJson(`${WARDROBE_URL}/equip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skin_id: skinId }) });
  }
  async function art(skin, { signal } = {}) {
    const params = new URLSearchParams({ level: String(skin.level) });
    if (skin.variant) params.set('variant', skin.variant);
    const url = `/games/fat-fish/api/sprites?${params}`;
    if (STARTER_IDS.has(skin.id)) return fetchImpl(`${baseUrl}${url}`, { headers: { Accept: 'image/*' }, cache: 'no-cache', signal });
    return fetchAuthorized(url, { cache: 'no-cache', headers: { Accept: 'image/*' }, signal });
  }
  function onSessionChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }

  return {
    fetchAuthorized, onSessionChange, get, equip, art,
    get owner() { return owner; },
    destroy() { disposed = true; clearSession('signed_out'); channel?.close(); listeners.clear(); },
  };
}
