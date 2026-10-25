import { PHYSICS_VERSION } from './physics-version.js';

const REFRESH_LOCK = "new-api:auth-refresh";
const REFRESH_DELAYS = [80, 200, 500];

export class OnlineApiError extends Error {
  constructor(message, { status = 0, code = null, payload = null } = {}) {
    super(message);
    this.name = "OnlineApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export function createOnlineClient({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  navigatorRef = globalThis.navigator,
  BroadcastChannelRef = globalThis.BroadcastChannel,
  moduleUrl = import.meta.url,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("当前环境不支持 fetch");
  let accessToken = null;
  let user = null;
  let refreshPromise = null;
  const listeners = new Set();
  const apiUrl = (path) => new URL(`./api/${path}`, moduleUrl);
  const refreshUrl = new URL("/api/user/auth/refresh", moduleUrl);
  const loginUrl = new URL("/sign-in?redirect=%2Fgames%2Ffat-fish%2F", moduleUrl).href;
  const walletUrl = new URL("/wallet", moduleUrl).href;
  let channel = null;

  if ((typeof window !== "undefined" || BroadcastChannelRef !== globalThis.BroadcastChannel) && typeof BroadcastChannelRef === "function") {
    channel = new BroadcastChannelRef("new-api:auth-session");
    channel.addEventListener?.("message", (event) => {
      const type = typeof event.data === "string" ? event.data : event.data?.kind;
      if (type !== "signed_out" && type !== "authenticated") return;
      accessToken = null;
      user = null;
      for (const listener of listeners) listener(type);
    });
  }

  async function parseResponse(response) {
    const payload = await response.json().catch(() => null);
    const code = payload?.code ?? payload?.error?.code ?? null;
    if (!response.ok || payload?.success !== true) {
      throw new OnlineApiError(payload?.message ?? payload?.error?.message ?? `请求失败 (${response.status})`, {
        status: response.status,
        code,
        payload,
      });
    }
    return payload;
  }

  async function performRefresh() {
    for (let attempt = 0; attempt <= REFRESH_DELAYS.length; attempt++) {
      const response = await fetchImpl(refreshUrl, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 409 && payload?.code === "AUTH_REFRESH_RACE") {
        if (attempt < REFRESH_DELAYS.length) {
          await wait(REFRESH_DELAYS[attempt]);
          continue;
        }
        throw new OnlineApiError("登录状态正在同步，请稍后重试。", { status: 409, code: payload.code, payload });
      }
      if (response.status === 401) {
        accessToken = null;
        user = null;
        return null;
      }
      if (!response.ok || payload?.success !== true || typeof payload?.data?.access_token !== "string" || !payload.data.user) {
        throw new OnlineApiError(payload?.message ?? "登录状态暂时无法验证。", {
          status: response.status,
          code: payload?.code ?? null,
          payload,
        });
      }
      accessToken = payload.data.access_token;
      user = payload.data.user;
      return user;
    }
    return null;
  }

  function refresh() {
    if (refreshPromise) return refreshPromise;
    const lockedRefresh = () => {
      const locks = navigatorRef?.locks;
      return locks?.request
        ? locks.request(REFRESH_LOCK, { mode: "exclusive" }, performRefresh)
        : performRefresh();
    };
    refreshPromise = Promise.resolve().then(lockedRefresh).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function request(path, { method = "GET", body, withBearer = true, retryUnauthorized = true } = {}) {
    const url = apiUrl(path);
    const send = () => {
      const headers = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (withBearer && accessToken) headers.Authorization = `Bearer ${accessToken}`;
      return fetchImpl(url, {
        method,
        credentials: "include",
        cache: "no-store",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    };
    let response = await send();
    if (response.status === 401 && retryUnauthorized) {
      const refreshedUser = await refresh();
      if (refreshedUser) response = await send();
    }
    return parseResponse(response);
  }

  async function requestBlob(path, { authorized = true, retryUnauthorized = authorized } = {}) {
    const url = apiUrl(path);
    const send = () => fetchImpl(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: authorized && accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    let response = await send();
    if (response.status === 401 && retryUnauthorized) {
      const refreshedUser = await refresh();
      if (refreshedUser) response = await send();
    }
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch { /* Image errors may not contain JSON. */ }
      throw new OnlineApiError(payload?.message ?? "角色图片暂时无法加载。", {
        status: response.status,
        code: payload?.code ?? null,
        payload,
      });
    }
    return response.blob();
  }

  return {
    loginUrl,
    walletUrl,
    get user() { return user; },
    getMe: async () => {
      try { return await request("me"); }
      catch (error) { if (error instanceof OnlineApiError && error.status === 401) return null; throw error; }
    },
    getLeaderboard: (period = 'current') => request(`leaderboard?period=${encodeURIComponent(period)}`, { withBearer: false, retryUnauthorized: false }),
    getWeeklyMe: () => request('leaderboard/me'),
    startRun: (height = 620) => request("run", { method: "POST", body: { height, physics_version: PHYSICS_VERSION } }),
    startGuestRun: () => request("play/run", { method: "POST", body: { physics_version: PHYSICS_VERSION }, withBearer: false, retryUnauthorized: false }),
    checkpoint: (payload) => request("run/checkpoint", { method: "POST", body: payload }),
    checkpointGuest: (payload) => request("play/checkpoint", { method: "POST", body: payload, withBearer: false, retryUnauthorized: false }),
    claimReward: (campaign_id, run_id) => request("rewards/claim", { method: "POST", body: { campaign_id, run_id } }),
    getAdminCandidates: (keyword) => request(`admin/candidates?keyword=${encodeURIComponent(keyword)}`),
    getAdminCampaigns: () => request('admin/campaigns'),
    createAdminCampaign: (payload) => request('admin/campaigns', { method: 'POST', body: payload }),
    getAdminPrizes: (campaign_id, page = 1) => request(`admin/prizes?campaign_id=${encodeURIComponent(campaign_id)}&page=${page}`),
    removeAdminPrizes: (payload) => request('admin/prizes/remove', { method: 'POST', body: payload }),
    importAdminCandidates: (payload) => request("admin/import", { method: "POST", body: payload }),
    requestArt: ({ level, variant } = {}) => {
      const query = new URLSearchParams({ level: String(level) });
      if (variant) query.set("variant", variant);
      return requestBlob(`art?${query}`, { authorized: true, retryUnauthorized: true });
    },
    requestPlayingArt: ({ run_id, level, variant, guest = false } = {}) => {
      const query = new URLSearchParams({ run_id: String(run_id), level: String(level) });
      if (variant) query.set("variant", variant);
      return requestBlob(`play/art?${query}`, { authorized: !guest, retryUnauthorized: !guest });
    },
    onSessionChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    clearLocalSession() { accessToken = null; user = null; },
    close() { channel?.close?.(); listeners.clear(); },
  };
}

export const onlineClient = createOnlineClient();
