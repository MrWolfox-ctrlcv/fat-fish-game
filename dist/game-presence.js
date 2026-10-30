export function createGamePresence({
  game, getPlaying = () => false, element = null,
  endpoint = '/games/fat-fish/api/presence',
  enabled = globalThis.location?.protocol === 'https:',
  fetchImpl = fetch, windowRef = window, documentRef = document,
  storage, intervalMs = 30000
} = {}) {
  let sessionId;
  try {
    storage ||= globalThis.sessionStorage;
    const key = `game-presence:${game}`;
    sessionId = storage.getItem(key);
    if (!sessionId) {
      sessionId = globalThis.crypto.randomUUID();
      storage.setItem(key, sessionId);
    }
  } catch { sessionId = globalThis.crypto.randomUUID(); }

  let closed = false, busy = false, timer = null, controller = null;
  const setText = text => { if (element) element.textContent = text; };
  const visible = () => documentRef.visibilityState === 'visible';
  const body = leave => ({ session_id: sessionId, ...(leave ? { leave: true } : { game, playing: visible() && Boolean(getPlaying()) }) });
  const sendLeave = () => {
    if (!enabled) return;
    const nav = windowRef.navigator;
    try { nav?.sendBeacon?.(endpoint, new Blob([JSON.stringify(body(true))], { type: 'application/json' })); } catch {}
  };
  const heartbeat = async () => {
    if (closed || !enabled || !visible() || busy) return;
    busy = true;
    let timeout;
    try {
      controller = typeof AbortController === 'undefined' ? null : new AbortController();
      if(controller){timeout=setTimeout(()=>controller?.abort(),6000);timeout.unref?.();}
      const response = await fetchImpl(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body(false)), ...(controller ? { signal: controller.signal } : {})
      });
      const result = await response.json();
      if (!result?.success) throw new Error('presence unavailable');
      setText(Number.isFinite(result.online) ? `在线 ${result.online}` : '在线人数暂不可用');
    } catch { if (!closed) setText('在线人数暂不可用'); }
    finally { clearTimeout(timeout);busy = false; controller = null; }
  };
  const start = () => {
    if (closed) return;
    if (!enabled) { setText('本机模式'); return; }
    if (visible()) void heartbeat();
    if (timer === null) timer = windowRef.setInterval(() => void heartbeat(), intervalMs);
  };
  const onVisibility = () => {
    if (visible()) start();
    else {
      if (timer !== null) windowRef.clearInterval(timer);
      timer = null;
      controller?.abort();
      if (enabled) void fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(true)) }).catch(() => {});
    }
  };
  const onPageHide = () => {if(timer!==null)windowRef.clearInterval(timer);timer=null;controller?.abort();sendLeave();};
  const onPageShow = () => start();
  documentRef.addEventListener('visibilitychange', onVisibility);
  windowRef.addEventListener('pagehide', onPageHide);
  windowRef.addEventListener('pageshow', onPageShow);
  start();
  return {
    sessionId,
    close() {
      if (closed) return;
      closed = true;
      if (timer !== null) windowRef.clearInterval(timer);
      timer = null;
      controller?.abort();
      documentRef.removeEventListener('visibilitychange', onVisibility);
      windowRef.removeEventListener('pagehide', onPageHide);
      windowRef.removeEventListener('pageshow', onPageShow);
      if (enabled) void fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(true)) }).catch(() => {});
    }
  };
}
