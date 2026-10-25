import { mountCompanionAccountUI } from "./companion-account-ui.js";

const ALLOWED_GAMES = new Set(["bumper", "survival", "kitchen", "fat-fish"]);
const MAX_AUTO_PER_GAME = 3;
const EVENT_TYPES = new Set([
  "new_level",
  "new_easter",
  "double_kill",
  "kill_streak",
  "death_streak",
  "survivor",
  "end",
]);
const PRIORITY = {
  survivor: 1,
  new_level: 2,
  new_easter: 3,
  kill_streak: 4,
  double_kill: 5,
  death_streak: 6,
  end: 7,
  milestone: 0,
};
const EASTER_VARIANTS = new Set([
  "gpt-silly",
  "gpt-normal",
  "deepseek-claude",
  "super-whale",
  "gpt-astra",
  "doubao",
  "gemini",
]);

export const canUseCompanion = (config, locallyEnabled) =>
  Boolean(config?.enabled && locallyEnabled);
export function createRequestGuard() {
  let generation = 0;
  return {
    invalidate() {
      generation += 1;
      return generation;
    },
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
  };
}
export function createCompanionRateLimit(minimumCooldownSeconds = 20) {
  let lastAttemptAt = -Infinity,
    inFlight = false,
    activeId = 0;
  return {
    canAttempt(now, cooldownSeconds = 20) {
      return (
        !inFlight && now - lastAttemptAt >= Math.max(minimumCooldownSeconds, cooldownSeconds) * 1000
      );
    },
    remainingSeconds(now, cooldownSeconds = 20) {
      return Math.max(
        0,
        Math.ceil(
          (lastAttemptAt + Math.max(minimumCooldownSeconds, cooldownSeconds) * 1000 - now) / 1000,
        ),
      );
    },
    begin(now) {
      if (inFlight) return false;
      inFlight = true;
      lastAttemptAt = now;
      activeId += 1;
      return activeId;
    },
    finish(id) {
      if (id === activeId) inFlight = false;
    },
    get busy() {
      return inFlight;
    },
    get lastAttemptAt() {
      return lastAttemptAt;
    },
  };
}
function boundedInt(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, Math.floor(number)))
    : fallback;
}
const eventKey = (event) => {
  const detail =
    event.detail && typeof event.detail === "object" ? event.detail : {};
  return `${event.type}:${event.id ?? ""}:${event.attackerId ?? ""}:${event.victimId ?? ""}:${event.fallCount ?? ""}:${event.count ?? detail.count ?? ""}:${event.level ?? detail.level ?? ""}:${event.variant ?? detail.variant ?? ""}:${event.x ?? ""}:${event.y ?? ""}`;
};
function normalizeScene(game, scene) {
  if (!scene || typeof scene !== "object" || Array.isArray(scene))
    return undefined;
  if (game === "fat-fish") {
    if (!Array.isArray(scene.balls) || typeof scene.danger !== "boolean")
      return undefined;
    const balls = scene.balls
      .slice(0, 12)
      .map((ball) => {
        if (!ball || typeof ball !== "object" || Array.isArray(ball))
          return null;
        const variant =
          ball.variant === null || EASTER_VARIANTS.has(ball.variant)
            ? ball.variant
            : null;
        return {
          level: boundedInt(ball.level, 1, 11),
          x: boundedInt(ball.x, -2048, 4096),
          y: boundedInt(ball.y, -2048, 4096),
          variant,
        };
      })
      .filter(Boolean);
    return {
      balls,
      ball_count: boundedInt(scene.ball_count, 0, 300),
      stack_height: boundedInt(scene.stack_height, 0, 2048),
      danger: scene.danger,
      highest_level: boundedInt(scene.highest_level, 1, 11),
    };
  }
  if (game !== "bumper") return undefined;
  const teams = scene.mode === 'teams';
  if (teams && (!Array.isArray(scene.team_scores) || scene.team_scores.length !== 2 ||
    scene.team_scores.some(score => !Number.isSafeInteger(score)) || ![0, 1].includes(scene.player?.team_id) || !Array.isArray(scene.opponents) ||
    scene.opponents.slice(0, 5).some(other => ![0, 1].includes(other?.team_id)))) return undefined;
  const point = (p) =>
    p && typeof p === "object"
      ? {
          x: boundedInt(p.x, 0, 1280),
          y: boundedInt(p.y, 0, 900),
          alive: Boolean(p.alive),
          ...(teams ? { team_id: p.team_id } : {}),
        }
      : undefined;
  const player = point(scene.player);
  if (!player) return undefined;
  Object.assign(player, {
    edge_distance: boundedInt(scene.player.edge_distance, 0, 1000),
    dash_ready: Boolean(scene.player.dash_ready),
    kills: boundedInt(scene.player.kills, 0, 10000),
    falls: boundedInt(scene.player.falls, 0, 10000),
    rank: boundedInt(scene.player.rank, 1, 6),
  });
  return {
    player,
    opponents: (Array.isArray(scene.opponents)
      ? scene.opponents.slice(0, 5)
      : []
    )
      .map(point)
      .filter(Boolean),
    arena_radius: boundedInt(scene.arena_radius, 0, 1000),
    remaining: boundedInt(scene.remaining, 0, 3600),
    ...(teams ? { mode: 'teams', team_scores: scene.team_scores.map(score => boundedInt(score, -1000, 1000)) } : {}),
  };
}

export function makeCompanionPolicy() {
  let autoCalls = 0,
    ended = false,
    pending = null,
    legacyNotable = 0,
    streakKills = 0,
    playerFalls = 0;
  const seen = new Set();
  const clearPending = () => {
    pending = null;
  };
  const make = (type, detail = {}) => ({
    event: type,
    detail: Object.fromEntries(
      ["level", "variant", "count"]
        .filter((key) => detail[key] !== undefined)
        .map((key) => [key, detail[key]]),
    ),
  });
  const remember = (key) => {
    if (seen.has(key)) return false;
    if (seen.size >= 200) seen.delete(seen.values().next().value);
    seen.add(key);
    return true;
  };
  return {
    reset() {
      autoCalls = 0;
      ended = false;
      pending = null;
      legacyNotable = 0;
      streakKills = 0;
      playerFalls = 0;
      seen.clear();
    },
    choose(
      events = [],
      now = Date.now(),
      canSend = true,
      queueIfUnavailable = true,
    ) {
      if (ended && !pending) return null;
      if (ended) {
        if (pending.expiresAt <= now) {
          pending = null;
          return null;
        }
        if (!canSend) return null;
        const result = { event: pending.event, detail: pending.detail };
        pending = null;
        return result;
      }
      const candidates = [];
      for (const raw of events) {
        if (!raw || typeof raw.type !== "string") continue;
        const rawKey = eventKey(raw);
        const deduplicable =
          raw.id !== undefined ||
          raw.victimId !== undefined ||
          raw.fallCount !== undefined ||
          EVENT_TYPES.has(raw.type);
        if (deduplicable && !remember(rawKey)) continue;
        let e = raw;
        if (raw.type === "kill") {
          if (
            raw.attackerId === undefined ||
            raw.attackerId === 0 ||
            raw.playerKill === true
          ) {
            legacyNotable += 1;
            streakKills += 1;
            playerFalls = 0;
            if (raw.playerKill === true || raw.attackerId === 0) {
              if (raw.doubleKill)
                candidates.push(make("double_kill", { count: 2 }));
              if (raw.killStreak)
                candidates.push(make("kill_streak", { count: raw.killStreak }));
            }
            if (legacyNotable % 3 === 0)
              candidates.push(make("milestone", { count: legacyNotable }));
          }
          continue;
        }
        if (raw.type === "fall" && (raw.playerFall === true || raw.id === 0)) {
          streakKills = 0;
          playerFalls += 1;
          if (playerFalls >= 2)
            candidates.push(make("death_streak", { count: playerFalls }));
          continue;
        }
        if (raw.type === "level") {
          legacyNotable += 1;
          candidates.push(
            make("new_level", { level: boundedInt(raw.level, 1, 99, 1) }),
          );
          continue;
        }
        if (raw.type === "easter") {
          candidates.push(
            make("new_easter", {
              variant: String(raw.variant || "unknown").slice(0, 32),
            }),
          );
          continue;
        }
        if (EVENT_TYPES.has(raw.type))
          e = make(raw.type, {
            ...raw,
            ...(raw.detail && typeof raw.detail === "object" ? raw.detail : {}),
          });
        else continue;
        candidates.push(e);
      }
      if (events.some((e) => e?.type === "end")) {
        ended = true;
        pending = { ...make("end"), expiresAt: now + 8000 };
        if (!queueIfUnavailable) {
          pending = null;
          return null;
        }
        if (!canSend) return null;
        pending = null;
        return make("end");
      }
      candidates.sort(
        (a, b) => (PRIORITY[b.event] || 0) - (PRIORITY[a.event] || 0),
      );
      let chosen = candidates[0] || null;
      if (!queueIfUnavailable) pending = null;
      else if (chosen) {
        const ttl = ["new_level", "new_easter"].includes(chosen.event)
          ? 15000
          : 8000;
        if (
          !pending ||
          (PRIORITY[chosen.event] || 0) > (PRIORITY[pending.event] || 0)
        )
          pending = { ...chosen, expiresAt: now + ttl };
      }
      if (pending && pending.expiresAt <= now) pending = null;
      if (!canSend || !pending) return null;
      const result = { event: pending.event, detail: pending.detail };
      pending = null;
      return result;
    },
    canSendAuto() {
      return autoCalls < MAX_AUTO_PER_GAME;
    },
    recordAuto() {
      autoCalls += 1;
    },
    clearPending,
    get pending() {
      return (
        pending && {
          event: pending.event,
          detail: pending.detail,
          expiresAt: pending.expiresAt,
        }
      );
    },
    get autoCalls() {
      return autoCalls;
    },
    get notable() {
      return legacyNotable;
    },
  };
}

export function makeCompanionPayload(game, selected, snapshot = {}) {
  const gameId = ALLOWED_GAMES.has(game) ? game : "fat-fish";
  const choice =
    typeof selected === "string"
      ? { event: selected, detail: {} }
      : selected || {};
  const event = EVENT_TYPES.has(choice.event)
    ? choice.event
    : choice.event === "end"
      ? "end"
      : "milestone";
  const payload = {
    game: gameId,
    event,
    score: boundedInt(snapshot.score, 0, Number.MAX_SAFE_INTEGER, 0),
    level: boundedInt(snapshot.level, 1, 11, 1),
    elapsed: boundedInt(snapshot.elapsed, 0, 3600, 0),
  };
  const detail = choice.detail || {};
  if (event === "new_level")
    payload.detail = { level: boundedInt(detail.level, 1, 11, payload.level) };
  if (event === "new_easter")
    payload.detail = {
      level: boundedInt(detail.level, 1, 11, payload.level),
      variant: EASTER_VARIANTS.has(detail.variant)
        ? detail.variant
        : "deepseek-claude",
    };
  if (["double_kill", "kill_streak", "death_streak"].includes(event))
    payload.detail = { count: boundedInt(detail.count, 2, 100, 2) };
  const scene = normalizeScene(gameId, snapshot.scene);
  if (scene) payload.scene = scene;
  return payload;
}

export function createCompanion({
  container,
  gameId,
  getSnapshot,
  endpoint = new URL("./api/companion", document.baseURI),
  fetchImpl = globalThis.fetch.bind(globalThis),
  personalClient = null,
}) {
  const policy = makeCompanionPolicy(),
    rateLimit = createCompanionRateLimit(personalClient ? 5 : 20);
  const $ = (selector) => container.querySelector(selector),
    status = $("[data-companion-status]"),
    output = $("[data-companion-output]"),
    form = $("[data-companion-form]"),
    input = $("[data-companion-input]"),
    enable = $("[data-companion-enable]"),
    refresh = $("[data-companion-refresh]"),
    sendButton = form.querySelector('button[type="submit"]');
  let config = null,
    disposed = false,
    controller = null,
    activeRateId = null,
    locallyEnabled = false;
  const accountUI = personalClient
    ? mountCompanionAccountUI({ container, client: personalClient, onStateChange: () => {
        if (mode() === "personal" && locallyEnabled && !accountUI?.connected) {
          locallyEnabled = false;
          enable.checked = false;
          abortPending();
          policy.clearPending();
          output.textContent = "";
          sayStatus("个人额度专用 Key 已不可用，陪玩已关闭。");
        }
        updateSendAvailability();
      }, onModeChange: () => {
        abortPending();
        policy.clearPending();
        locallyEnabled = false;
        enable.checked = false;
        output.textContent = "";
        updateSendAvailability();
        sayStatus("已切换陪玩模式；请确认开启陪玩后再发送。");
      } })
    : null;
  const mode = () => accountUI?.mode || "free";
  const activeReady = () => mode() === "personal"
    ? Boolean(personalClient && accountUI?.connected && locallyEnabled)
    : canUseCompanion(config, locallyEnabled);
  const requestGuard = createRequestGuard(),
    configGuard = createRequestGuard();
  const sayStatus = (message) => {
      status.textContent = message;
    },
    currentGame = () => (typeof gameId === "function" ? gameId() : gameId);
  const updateSendAvailability = () => {
    input.maxLength = mode() === "personal" ? 320 : 160;
    input.placeholder = mode() === "personal" ? "聊聊本局，最多 320 字" : "说句话，最多 160 字";
    if (typeof accountUI !== "undefined") {
      const ready = mode() === "personal"
        ? Boolean(personalClient && accountUI?.connected)
        : Boolean(config?.enabled);
      enable.disabled = !ready;
      input.disabled = !ready || !locallyEnabled;
      sendButton.disabled = !ready || !locallyEnabled || rateLimit.busy;
    } else sendButton.disabled = !canUseCompanion(config, locallyEnabled) || rateLimit.busy;
  };
  const abortPending = () => {
    requestGuard.invalidate();
    if (controller) {
      controller.abort();
      rateLimit.finish(activeRateId);
      activeRateId = null;
    }
    controller = null;
    updateSendAvailability();
  };
  const loadConfig = async () => {
    abortPending();
    const token = configGuard.begin();
    config = null;
    sayStatus("正在读取陪玩服务配置…");
    try {
      const response = await fetchImpl(endpoint, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`服务返回 ${response.status}`);
      const data = await response.json();
      if (disposed || !configGuard.isCurrent(token)) return;
      config = data?.success === true ? data : null;
      if (!config) throw new Error("服务配置格式不正确");
      const limits = config.limits || {};
      config.limits = {
        cooldown_seconds: boundedInt(limits.cooldown_seconds, 20, 3600, 20),
        daily_per_user: boundedInt(limits.daily_per_user, 0, 100000, 0),
        global_daily: boundedInt(limits.global_daily, 0, 100000, 0),
        max_message: boundedInt(limits.max_message, 1, 160, 160),
      };
      enable.disabled = !config.enabled && mode() === "free";
      if (!config.enabled && mode() === "free") {
        locallyEnabled = false;
        enable.checked = false;
        policy.clearPending();
      }
      updateSendAvailability();
      sayStatus(mode() === "personal"
        ? "个人额度陪玩按实际用量计费 · 每局最多 3 条关键事件"
        : !config.enabled
          ? "限量免费旁白当前由服务端关闭。"
          : `免费旁白服务可用 · 每人每日 ${config.limits.daily_per_user} 次`);
    } catch (error) {
      if (disposed || !configGuard.isCurrent(token)) return;
      config = null;
      enable.disabled = mode() === "free";
      updateSendAvailability();
      if (mode() === "free") {
        locallyEnabled = false;
        enable.checked = false;
        policy.clearPending();
      }
      sayStatus(mode() === "personal"
        ? "免费旁白服务暂不可用；个人额度陪玩仍可单独使用。"
        : `陪玩服务暂不可用：${error.message || "连接失败"}。游戏仍可继续。`);
    }
  };
  const send = async (payload, { automatic = false } = {}) => {
    if (disposed || !activeReady()) return false;
    if (automatic && !policy.canSendAuto()) return false;
    const cooldown = mode() === "personal" ? 5 : config?.limits?.cooldown_seconds || 20;
    const now = Date.now();
    if (!rateLimit.canAttempt(now, cooldown)) {
      if (!automatic)
        sayStatus(
          rateLimit.busy
            ? "AI 正在回复，请稍候再发。"
            : `发送过快，请 ${rateLimit.remainingSeconds(now, cooldown)} 秒后再试。`,
        );
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
    sayStatus("正在等待 AI 回应…");
    try {
      let data;
      if (mode() === "personal") {
        data = await personalClient.chat(payload, { signal: activeController.signal });
        if (typeof data === "string") data = { success: true, text: data };
      } else {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: activeController.signal,
      });
      if (!response.ok) {
        let detail = `服务返回 ${response.status}`;
        try {
          const body = await response.json();
          if (typeof body?.message === "string" && body.message)
            detail = body.message.slice(0, 160);
          else if (body?.error) detail = String(body.error).slice(0, 160);
        } catch {}
        throw new Error(detail);
      }
      data = await response.json();
      }
      if (disposed || !requestGuard.isCurrent(token) || !locallyEnabled)
        return false;
      if (data?.success !== true)
        throw new Error(
          (typeof data?.message === "string"
            ? data.message
            : typeof data?.error === "string"
              ? data.error
              : "服务暂不可用"
          ).slice(0, 160),
        );
      if (typeof data.text !== "string") throw new Error("服务响应格式不正确");
      output.textContent = data.text.slice(0, mode() === "personal" ? 320 : config.limits.max_message);
      sayStatus(mode() === "personal"
        ? "AI 已回复 · 从本人账户按实际用量计费"
        : Number.isFinite(data.remaining)
          ? `AI 已回复 · 今日还可用 ${Math.max(0, Math.floor(data.remaining))} 次`
          : "AI 已回复");
      return true;
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        disposed ||
        !requestGuard.isCurrent(token)
      )
        return false;
      sayStatus(
        `AI 暂时没有回应：${error.message || "请求失败"}。不会自动重试。`,
      );
      return false;
    } finally {
      if (controller === activeController) controller = null;
      rateLimit.finish(rateId);
      if (activeRateId === rateId) activeRateId = null;
      updateSendAvailability();
    }
  };
  const observe = (events = []) => {
    const now = Date.now(),
      cooldown = mode() === "personal" ? 5 : config?.limits?.cooldown_seconds || 20,
      available =
        rateLimit.canAttempt(now, cooldown) &&
        activeReady() &&
        policy.canSendAuto();
    const canQueue =
      activeReady() && policy.canSendAuto();
    const selected = policy.choose(events, now, available, canQueue);
    if (!selected || !available) return;
    const snap = getSnapshot?.() || {},
      game = currentGame(),
      level = game === "survival" || game === "fat-fish" ? snap.level : 1;
    void send(makeCompanionPayload(game, selected, { ...snap, level }), {
      automatic: true,
    });
  };
  enable.addEventListener("change", () => {
    locallyEnabled = enable.checked && (mode() === "personal" ? Boolean(accountUI?.connected) : Boolean(config?.enabled));
    updateSendAvailability();
    policy.clearPending();
    if (!locallyEnabled) {
      abortPending();
      output.textContent = "";
      sayStatus(config?.enabled ? "AI 陪玩已关闭。" : "AI 陪玩当前不可用。");
    } else sayStatus(mode() === "personal" ? "AI 陪玩已开启 · 从本人账户按实际用量计费" : "AI 陪玩已开启 · 每局最多 3 条关键事件");
  });
  refresh.addEventListener("click", () => {
    void loadConfig();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || !activeReady()) return;
    const maxMessage = mode() === "personal" ? 320 : config.limits.max_message;
    if (!locallyEnabled) return;
    const now = Date.now();
    const cooldown = mode() === "personal" ? 5 : config.limits.cooldown_seconds;
    if (!rateLimit.canAttempt(now, cooldown)) {
      sayStatus(
        rateLimit.busy
          ? "AI 正在回复，请稍候再发。"
          : `发送过快，请 ${rateLimit.remainingSeconds(now, cooldown)} 秒后再试。`,
      );
      return;
    }
    input.value = "";
    const game = currentGame(),
      snapshot = getSnapshot?.() || {};
    void send({
      ...makeCompanionPayload(game, "chat", {
        ...snapshot,
        level: game === "survival" || game === "fat-fish" ? snapshot.level : 1,
      }),
      event: "chat",
      message: message.slice(0, maxMessage),
    });
  });
  container.addEventListener("keydown", (event) => event.stopPropagation());
  container.addEventListener("keyup", (event) => event.stopPropagation());
  void loadConfig();
  return {
    observe,
    reset() {
      abortPending();
      policy.reset();
      output.textContent = "";
    },
    destroy() {
      disposed = true;
      abortPending();
      policy.clearPending();
      accountUI?.destroy();
    },
  };
}
