const ALLOWED_GAMES = new Set(['bumper', 'survival', 'kitchen', 'fat-fish']);
const MAX_AUTO_PER_GAME = 3;

export const canUseCompanion = (config, locallyEnabled) => Boolean(config?.enabled && locallyEnabled);

export function createRequestGuard() {
  let generation = 0;
  return {
    invalidate() { generation += 1; return generation; },
    begin() { generation += 1; return generation; },
    isCurrent(token) { return token === generation; },
  };
}

export function createCompanionRateLimit() {
  let lastAttemptAt = -Infinity;
  let inFlight = false;
  let activeId = 0;
  return {
    canAttempt(now, cooldownSeconds = 20) {
      return !inFlight && now - lastAttemptAt >= Math.max(20, cooldownSeconds) * 1000;
    },
    remainingSeconds(now, cooldownSeconds = 20) {
      return Math.max(0, Math.ceil((lastAttemptAt + Math.max(20, cooldownSeconds) * 1000 - now) / 1000));
    },
    begin(now) {
      if (inFlight) return false;
      inFlight = true;
      lastAttemptAt = now;
      activeId += 1;
      return activeId;
    },
    finish(id) { if (id === activeId) inFlight = false; },
    get busy() { return inFlight; },
    get lastAttemptAt() { return lastAttemptAt; },
  };
}

function boundedInt(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

export function makeCompanionPolicy() {
  let notable = 0;
  let autoCalls = 0;
  let ended = false;
  return {
    reset() { notable = 0; autoCalls = 0; ended = false; },
    choose(events = []) {
      if (ended) return null;
      let crossed = false;
      for (const event of events) {
        if (event?.type === 'end') ended = true;
        if (event?.type === 'kill' || event?.type === 'level') {
          notable += 1;
          if (notable >= 3 && notable % 3 === 0) crossed = true;
        }
      }
      if (events.some((event) => event?.type === 'end')) return 'end';
      return crossed ? 'milestone' : null;
    },
    canSendAuto() { return autoCalls < MAX_AUTO_PER_GAME; },
    recordAuto() { autoCalls += 1; },
    get autoCalls() { return autoCalls; },
    get notable() { return notable; },
  };
}

export function makeCompanionPayload(game, event, snapshot = {}) {
  const gameId = ALLOWED_GAMES.has(game) ? game : 'fat-fish';
  return {
    game: gameId,
    event: event === 'end' ? 'end' : 'milestone',
    score: boundedInt(snapshot.score, 0, Number.MAX_SAFE_INTEGER, 0),
    level: boundedInt(snapshot.level, 1, 11, 1),
    elapsed: boundedInt(snapshot.elapsed, 0, 3600, 0),
  };
}

export function createCompanion({ container, gameId, getSnapshot, endpoint = new URL('./api/companion', document.baseURI), fetchImpl = globalThis.fetch.bind(globalThis) }) {
  const policy = makeCompanionPolicy();
  const rateLimit = createCompanionRateLimit();
  const $ = (selector) => container.querySelector(selector);
  const status = $('[data-companion-status]');
  const output = $('[data-companion-output]');
  const form = $('[data-companion-form]');
  const input = $('[data-companion-input]');
  const enable = $('[data-companion-enable]');
  const refresh = $('[data-companion-refresh]');
  const sendButton = form.querySelector('button[type="submit"]');
  let config = null;
  let disposed = false;
  const requestGuard = createRequestGuard();
  const configGuard = createRequestGuard();
  let controller = null;
  let activeRateId = null;
  let locallyEnabled = false;

  const sayStatus = (message) => { status.textContent = message; };
  const currentGame = () => typeof gameId === 'function' ? gameId() : gameId;
  const updateSendAvailability = () => {
    sendButton.disabled = !canUseCompanion(config, locallyEnabled) || rateLimit.busy;
  };
  const abortPending = () => {
    requestGuard.invalidate();
    if (controller) { controller.abort(); rateLimit.finish(activeRateId); activeRateId = null; }
    controller = null;
    updateSendAvailability();
  };
  const loadConfig = async () => {
    abortPending();
    const token = configGuard.begin();
    config = null;
    sayStatus('正在读取陪玩服务配置…');
    try {
      const response = await fetchImpl(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`服务返回 ${response.status}`);
      const data = await response.json();
      if (disposed || !configGuard.isCurrent(token)) return;
      config = data?.success === true ? data : null;
      if (!config) throw new Error('服务配置格式不正确');
      const limits = config.limits || {};
      config.limits = {
        cooldown_seconds: boundedInt(limits.cooldown_seconds, 20, 3600, 20),
        daily_per_user: boundedInt(limits.daily_per_user, 0, 100000, 0),
        global_daily: boundedInt(limits.global_daily, 0, 100000, 0),
        max_message: boundedInt(limits.max_message, 1, 160, 160),
      };
      enable.disabled = !config.enabled;
      if (!config.enabled) { locallyEnabled = false; enable.checked = false; }
      input.disabled = !canUseCompanion(config, locallyEnabled);
      updateSendAvailability();
      if (!config.enabled) sayStatus('AI 陪玩当前由服务端关闭。');
      else sayStatus(`服务可用 · 每人每日 ${config.limits.daily_per_user} 次`);
    } catch (error) {
      if (disposed || !configGuard.isCurrent(token)) return;
      config = null;
      enable.disabled = true;
      input.disabled = true;
      updateSendAvailability();
      locallyEnabled = false;
      enable.checked = false;
      sayStatus(`陪玩服务暂不可用：${error.message || '连接失败'}。游戏仍可继续。`);
    }
  };

  const send = async (payload, { automatic = false } = {}) => {
    if (disposed || !canUseCompanion(config, locallyEnabled)) return false;
    if (automatic && !policy.canSendAuto()) return false;
    const now = Date.now();
    if (!rateLimit.canAttempt(now, config.limits.cooldown_seconds)) {
      if (!automatic) sayStatus(rateLimit.busy ? 'AI 正在回复，请稍候再发。' : `发送过快，请 ${rateLimit.remainingSeconds(now, config.limits.cooldown_seconds)} 秒后再试。`);
      return false;
    }
    const rateId = rateLimit.begin(now);
    if (!rateId) return false;
    activeRateId = rateId;
    if (automatic) policy.recordAuto();
    const token = requestGuard.begin();
    controller = new AbortController();
    const activeController = controller;
    updateSendAvailability();
    sayStatus('正在等待 AI 回应…');
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload), signal: activeController.signal,
      });
      if (!response.ok) {
        let detail = `服务返回 ${response.status}`;
        try {
          const body = await response.json();
          if (typeof body?.message === 'string' && body.message) detail = body.message.slice(0, 160);
          else if (body?.error) detail = String(body.error).slice(0, 160);
        } catch { /* Keep the HTTP status. */ }
        throw new Error(detail);
      }
      const data = await response.json();
      if (disposed || !requestGuard.isCurrent(token) || !locallyEnabled) return false;
      if (data?.success !== true) {
        const detail = typeof data?.message === 'string' ? data.message : typeof data?.error === 'string' ? data.error : '服务暂不可用';
        throw new Error(detail.slice(0, 160));
      }
      if (typeof data.text !== 'string') throw new Error('服务响应格式不正确');
      output.textContent = data.text.slice(0, config.limits.max_message);
      sayStatus(Number.isFinite(data.remaining) ? `AI 已回复 · 今日还可用 ${Math.max(0, Math.floor(data.remaining))} 次` : 'AI 已回复');
      return true;
    } catch (error) {
      if (error?.name === 'AbortError' || disposed || !requestGuard.isCurrent(token)) return false;
      sayStatus(`AI 暂时没有回应：${error.message || '请求失败'}。不会自动重试。`);
      return false;
    } finally {
      if (controller === activeController) controller = null;
      rateLimit.finish(rateId);
      if (activeRateId === rateId) activeRateId = null;
      updateSendAvailability();
    }
  };

  const observe = (events = []) => {
    const selected = policy.choose(events);
    if (!selected || !canUseCompanion(config, locallyEnabled) || !policy.canSendAuto()) return;
    const snap = getSnapshot?.() || {};
    const game = currentGame();
    const level = game === 'survival' || game === 'fat-fish' ? snap.level : 1;
    const payload = makeCompanionPayload(game, selected, { ...snap, level });
    void send(payload, { automatic: true });
  };

  enable.addEventListener('change', () => {
    locallyEnabled = enable.checked && Boolean(config?.enabled);
    input.disabled = !canUseCompanion(config, locallyEnabled);
    updateSendAvailability();
    if (!locallyEnabled) { abortPending(); sayStatus(config?.enabled ? 'AI 陪玩已关闭。' : 'AI 陪玩当前不可用。'); }
    else sayStatus('AI 陪玩已开启 · 每局最多 3 条关键事件');
  });
  refresh.addEventListener('click', () => { void loadConfig(); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || !locallyEnabled || !config?.enabled) return;
    const now = Date.now();
    if (!rateLimit.canAttempt(now, config.limits.cooldown_seconds)) {
      sayStatus(rateLimit.busy ? 'AI 正在回复，请稍候再发。' : `发送过快，请 ${rateLimit.remainingSeconds(now, config.limits.cooldown_seconds)} 秒后再试。`);
      return;
    }
    input.value = '';
    const game = currentGame();
    const snapshot = getSnapshot?.() || {};
    void send({
      game: ALLOWED_GAMES.has(game) ? game : 'fat-fish', event: 'chat',
      score: boundedInt(snapshot.score, 0, Number.MAX_SAFE_INTEGER, 0),
      level: boundedInt(game === 'survival' || game === 'fat-fish' ? snapshot.level : 1, 1, 11, 1),
      elapsed: boundedInt(snapshot.elapsed, 0, 3600, 0),
      message: message.slice(0, config.limits.max_message),
    });
  });
  container.addEventListener('keydown', (event) => event.stopPropagation());
  container.addEventListener('keyup', (event) => event.stopPropagation());
  void loadConfig();

  return {
    observe,
    reset() { abortPending(); policy.reset(); output.textContent = ''; },
    destroy() { disposed = true; abortPending(); },
  };
}
