import { seededRandom } from "./seeded-random.js";
import { PHYSICS_VERSION } from "./physics-version.js";

export const LOCAL_CHEAT_SAVE_KEY = "local-cheat-save-v1";
const MAX_SAVE_BYTES = 256 * 1024;

export function serializeGameState(game) {
  const state = {
    width: game.width, height: game.height, bodies: game.bodies, score: game.score, best: game.best,
    unlocked: [...game.unlocked], currentLevel: game.currentLevel, currentVariant: game.currentVariant,
    nextLevel: game.nextLevel, nextVariant: game.nextVariant, seenEggs: [...game.seenEggs],
    seenEggStages: [...game.seenEggStages], aimX: game.aimX, dropCooldown: game.dropCooldown,
    over: game.over, overTimer: game.overTimer, stepIndex: game.stepIndex, nextId: game.nextId,
    particles: game.particles, randomState: game.random?.getState?.() ?? 0,
    variantState: game.variantRandom?.getState?.() ?? 0,
  };
  const json = JSON.stringify(state);
  if (new TextEncoder().encode(json).byteLength > MAX_SAVE_BYTES) throw new Error("局面超过 256 KB，无法保存。");
  return JSON.parse(json);
}

export function validateGameState(input) {
  let state = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > MAX_SAVE_BYTES) throw new Error("存档超过 256 KB，已拒绝读取。");
    try { state = JSON.parse(input); } catch { throw new Error("存档内容损坏，无法读取。"); }
  } else if (new TextEncoder().encode(JSON.stringify(input ?? null)).byteLength > MAX_SAVE_BYTES) {
    throw new Error("存档超过 256 KB，已拒绝读取。");
  }
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  if (!state || typeof state !== "object" || Array.isArray(state) || !Array.isArray(state.bodies) || state.bodies.length > 250 ||
      !Number.isSafeInteger(state.stepIndex) || state.stepIndex < 0 || !Number.isSafeInteger(state.nextId) || state.nextId < 1 ||
      !Number.isFinite(state.score) || state.score < 0 || !Number.isInteger(state.currentLevel) || state.currentLevel < 1 || state.currentLevel > 11 ||
      !Number.isInteger(state.nextLevel) || state.nextLevel < 1 || state.nextLevel > 11 || !Array.isArray(state.unlocked) ||
      !Array.isArray(state.seenEggs) || !Array.isArray(state.seenEggStages)) throw new Error("存档结构或鱼等级不合法，已拒绝读取。");
  for (const body of state.bodies) {
    if (!body || !Number.isSafeInteger(body.id) || !Number.isInteger(body.level) || body.level < 1 || body.level > 11 ||
        !["x", "y", "r", "vx", "vy", "angle", "angularVelocity", "age", "mergeCooldown", "dangerTime"].every((key) => finite(body[key]))) {
      throw new Error("存档中的鱼数据不合法，已拒绝读取。");
    }
  }
  if (state.unlocked.some((level) => !Number.isInteger(level) || level < 1 || level > 11)) throw new Error("存档图鉴等级不合法，已拒绝读取。");
  return state;
}

export function hydrateGameState(state, { width = 480, height = 620, random = null, variantRandom = null } = {}) {
  const clean = validateGameState(state);
  return {
    ...structuredClone(clean), width, height,
    random: random ?? seededRandom(clean.randomState), variantRandom: variantRandom ?? seededRandom(clean.variantState),
    unlocked: new Set(clean.unlocked), seenEggs: new Set(clean.seenEggs), seenEggStages: new Set(clean.seenEggStages),
    propSelectionIds: [],
  };
}

const dataOf = (response) => response?.data ?? response;
const requestId = () => globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (slot) => {
  const value = Math.floor(Math.random() * 16);
  return (slot === "x" ? value : (value & 3) | 8).toString(16);
});
const expiryMillis = (value) => {
  if (!value) return 0;
  const result = typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(result) ? result : 0;
};
const displayDate = (value) => {
  if (!value) return "未知";
  const date = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString("zh-CN");
};
const errorText = (error) => error?.message || "请求失败，请检查网络后重试。";

export function setupFishSavesUI({
  account, activeRun, gameReady, getGame, setGame, client, flushCheckpoint, checkpointClean,
  updateRun, refreshGame, refreshLeaderboard, pauseChanged = () => {}, canOpen = () => true, settled = () => {}, physicsVersion = 2,
}) {
  const opener = document.querySelector("#saves-open");
  const dialog = document.querySelector("#saves-dialog");
  const list = document.querySelector("#saves-list");
  const status = document.querySelector("#saves-status");
  const close = document.querySelector("#saves-close");
  if (!opener || !dialog) return { isPaused: () => false, isLocked: () => false, hasPending: () => false };
  let saves = [], busy = false, paused = false, pending = null, priceQuota = 5000, priceUsd = "0.01", paidDays = 7, extensionDays = 7, maxDays = 30;
  const isLocked = () => Boolean(pending || busy);
  const pause = (value) => { paused = value; pauseChanged(value); };

  const render = () => {
    opener.disabled = busy;
    if (!list) return;
    list.replaceChildren();
    for (let slot = 1; slot <= 5; slot++) {
      const save = saves.find((item) => item.slot === slot) ?? { slot, kind: slot === 1 ? "free" : "paid", exists: false };
      const active = save.exists && (!save.expires_at || expiryMillis(save.expires_at) > Date.now());
      const card = document.createElement("article"); card.className = "save-slot";
      const head = document.createElement("div"); head.className = "save-slot-head";
      const title = document.createElement("strong"); title.textContent = slot === 1 ? "免费档 · 1" : `付费档 · ${slot}`;
      const expiresAt = expiryMillis(save.expires_at), expired = Boolean(save.expires_at && expiresAt <= Date.now());
      const expiry = document.createElement("span"); expiry.textContent = !save.exists ? "空档位" : !save.expires_at ? "有效期未知" : `${expired ? "已过期" : "有效至"} · ${displayDate(save.expires_at)}`;
      head.append(title, expiry);
      const details = document.createElement("p");
      details.textContent = save.exists ? `分数 ${save.score ?? 0} · 最高 ${save.max_level ?? 1} 级 · 道具标签：${save.used_props ? "使用过" : "未使用"}` :
        slot === 1 ? "保存当前局面，免费保留至少 24 小时；会保留已购买的更长有效期。" : active ? "有效档覆盖不收费，也不会缩短已购买的有效期。" : `首次启用或过期后重开 $${priceUsd}，保留 ${paidDays} 天。`;
      const actions = document.createElement("div"); actions.className = "save-slot-actions";
      const saveButton = document.createElement("button"); saveButton.type = "button"; saveButton.textContent = save.exists ? "覆盖保存" : "保存当前局";
      saveButton.dataset.action = "write"; saveButton.dataset.slot = String(slot);
      const loadButton = document.createElement("button"); loadButton.type = "button"; loadButton.textContent = "读取"; loadButton.dataset.action = "load"; loadButton.dataset.slot = String(slot);
      loadButton.disabled = !save.exists || (save.expires_at && expiryMillis(save.expires_at) <= Date.now());
      const extendButton = document.createElement("button"); extendButton.type = "button"; extendButton.textContent = `延长 ${extensionDays} 天 · $${priceUsd}`;
      extendButton.dataset.action = "extend"; extendButton.dataset.slot = String(slot); extendButton.hidden = !save.exists;
      const renewIcon = document.createElement("span"); renewIcon.className = "prop-icon prop-icon--renew"; renewIcon.setAttribute("aria-hidden", "true"); extendButton.prepend(renewIcon);
      actions.append(saveButton, loadButton, extendButton);
      card.append(head, details, actions); list.append(card);
    }
    list.querySelectorAll("button").forEach((button) => { button.disabled ||= busy || Boolean(pending) || !account(); });
  };

  const refresh = async () => {
    if (!account()) { saves = []; render(); status.textContent = "登录中转站账户后可使用云存档。登录前不会显示或触发收费操作。"; return; }
    const ownerId = account().id;
    try {
      const data = dataOf(await client.getSaves());
      if (account()?.id !== ownerId || (client.user?.id && client.user.id !== ownerId)) return;
      if (!Array.isArray(data.saves)) throw new Error("云存档列表格式暂不可用。");
      saves = data.saves; priceQuota = Number(data.price_quota) || 5000; priceUsd = data.price_usd || "0.01";
      paidDays = Number(data.limits?.paid_retention_days) || 7;
      extensionDays = Number(data.limits?.extension_days) || 7;
      maxDays = Number(data.limits?.max_retention_days) || 30;
      status.textContent = data.billing_enabled === false ? "云存档服务暂不可用，请稍后重试。" : `免费档保留至少 24 小时；额外档位与每次延长 ${extensionDays} 天均为 $${priceUsd}，最多保留未来 ${maxDays} 天。不会自动续费。`;
      render();
    } catch (error) {
      status.textContent = `${errorText(error)} 列表未刷新，请重试；不会产生费用。`;
      render();
    }
  };

  const isDefinitive = (error) => ["INVALID_SAVE", "SAVE_EXPIRED", "SAVE_LIMIT", "PAYMENT_REFUSED", "INSUFFICIENT_QUOTA", "SAVE_INVALID_RUN"].includes(error?.code) || [400, 403, 404, 410].includes(error?.status);
  const finishPending = () => { pending = null; busy = false; pause(false); render(); };

  const retryPending = async () => {
    if (!pending || busy) return;
    const ownerId = pending.ownerId;
    busy = true; pause(true); render();
    try {
      const session = client.user ? { user: client.user } : await client.getMe();
      if (session?.user?.id !== ownerId || account()?.id !== ownerId) {
        busy = false; render();
        status.textContent = "待确认的存档请求已保留。请登录发起请求的原账户，再用同一请求重试。";
        return;
      }
      const result = dataOf(pending.kind === "write" ? await client.writeSave(pending.payload) : await client.extendSave(pending.payload));
      if (account()?.id !== ownerId) { busy = false; render(); return; }
      if (result.pending) {
        busy = false; status.textContent = `支付仍在确认中。${result.receipt?.id ? `订单号：${result.receipt.id}。` : ""}请重试确认同一请求。`;
        render(); return;
      }
      if (result.success !== true || !Array.isArray(result.saves)) throw new Error("结果尚未明确，存档请求已保留并可安全重试。");
      saves = result.saves; finishPending();
      settled();
      status.textContent = result.receipt?.paid ? "存档已更新，收费 $0.01；不会自动续费。" : "免费存档已更新，有效期至少 24 小时。";
      render();
    } catch (error) {
      if (account()?.id !== ownerId) { busy = false; render(); return; }
      if (isDefinitive(error)) {
        finishPending(); status.textContent = `${errorText(error)} 本次操作已结束，可检查存档后重新操作。`;
      } else {
        busy = false; pause(true); status.textContent = `${errorText(error)} 结果未明确，已保留同一请求；重试不会新建订单。`;
      }
      render();
    }
  };

  const beginWrite = async (slot) => {
    if (!account() || !gameReady() || !activeRun() || isLocked() || !canOpen()) return;
    const saved = saves.find((item) => item.slot === slot && item.exists);
    const mustPay = slot > 1 && !(saved && (!saved.expires_at || expiryMillis(saved.expires_at) > Date.now()));
    if (mustPay && !window.confirm(`确认启用付费档 ${slot} 并保存当前局面？本次扣 $${priceUsd}（${priceQuota} quota），保留 ${paidDays} 天。取消不会扣费。之后覆盖有效存档不收费，也不会缩短已购买的有效期。`)) return;
    pause(true); busy = true; render(); status.textContent = "正在暂停并同步本局投放记录……";
    try {
      const ownerId = account().id, run = activeRun();
      if (!(await flushCheckpoint()) || account()?.id !== ownerId || activeRun()?.id !== run.id) throw new Error("当前局面未能同步，存档没有提交。请检查网络后重试。");
      const payload = { slot, run_id: run.id, step: getGame().stepIndex, moves: [], physics_version: physicsVersion, request_id: requestId() };
      if (mustPay) payload.confirm_quota = priceQuota;
      pending = { ownerId, kind: "write", payload }; busy = false;
      await retryPending();
    } catch (error) {
      if (pending) { busy = false; pause(true); status.textContent = `${errorText(error)} 存档请求已保留；请重试确认。`; }
      else { busy = false; pause(false); status.textContent = errorText(error); settled(); }
      render();
    }
  };

  const beginExtend = async (slot) => {
    if (!account() || isLocked() || !canOpen()) return;
    if (!window.confirm(`确认将档位 ${slot} 延长 ${extensionDays} 天并扣 $${priceUsd}（${priceQuota} quota）？最长保留未来 ${maxDays} 天；不会自动续费。取消不会扣费。`)) return;
    pending = { ownerId: account().id, kind: "extend", payload: { slot, request_id: requestId(), confirm_quota: priceQuota } };
    await retryPending();
  };

  const loadSlot = async (slot) => {
    const saved = saves.find((item) => item.slot === slot && item.exists);
    if (!account() || !saved || isLocked() || !canOpen()) return;
    if (saved.expires_at && expiryMillis(saved.expires_at) <= Date.now()) { status.textContent = "此存档已过期，不能读取。道具标签和原周信息仍保留。"; return; }
    if (!window.confirm("读取后，当前棋盘会被存档替换。当前局已同步的花费和道具标签不会回退；跨周的旧局不会计入新周榜。继续读取？")) return;
    const ownerId = account().id;
    busy = true; pause(true); render(); status.textContent = "正在同步当前局并读取存档……";
    try {
      const firstSession = client.user ? { user: client.user } : await client.getMe();
      if (firstSession?.user?.id !== ownerId || account()?.id !== ownerId) throw new Error("账户已切换，未读取存档。");
      const previousRun = activeRun();
      if (!(await flushCheckpoint()) || account()?.id !== ownerId || activeRun()?.id !== previousRun?.id) throw new Error("当前局未能同步，未读取存档。");
      const result = dataOf(await client.loadSave({ slot, physics_version: physicsVersion }));
      const currentSession = client.user ? { user: client.user } : await client.getMe();
      if (account()?.id !== ownerId || currentSession?.user?.id !== ownerId) throw new Error("账户已切换，未应用读取结果。");
      if (!result.run || !result.state) throw new Error("存档状态缺失，无法读取。");
      const snapshot = validateGameState(result.state);
      updateRun(result.run, result.play ?? null);
      checkpointClean(); setGame(snapshot);
      refreshGame({ profile: result.profile, rewards: result.rewards });
      refreshGame(result.play, true); refreshLeaderboard();
      status.textContent = "存档已读取。图鉴与领奖数据继续使用账户记录；已产生的花费、道具标签和原周信息不会回退。";
      busy = false; pause(false); render(); dialog.close();
      settled();
    } catch (error) {
      busy = false; pause(false); status.textContent = `${errorText(error)} 当前棋盘保持不变。`; render();
      settled();
    }
  };

  opener.addEventListener("click", () => {
    if (!canOpen()) return;
    dialog.showModal(); void refresh();
  });
  close?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  list?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]"); if (!button || isLocked()) return;
    const slot = Number(button.dataset.slot);
    if (button.dataset.action === "write") void beginWrite(slot);
    if (button.dataset.action === "extend") void beginExtend(slot);
    if (button.dataset.action === "load") void loadSlot(slot);
  });
  dialog.querySelector("[data-saves-retry]")?.addEventListener("click", () => pending ? void retryPending() : void refresh());
  client.onSessionChange?.(() => { saves = []; render(); });
  render();
  return { isPaused: () => paused, isLocked, hasPending: () => Boolean(pending), isOpen: () => dialog.open, refresh };
}

export function setupLocalCheatSaveUI({ controls, getGame, setGame }) {
  const wrap = document.createElement("div"); wrap.className = "local-save-controls";
  wrap.innerHTML = '<button type="button" data-local-save>本机保存（24 小时）</button><button type="button" data-local-load>读取本机存档</button><span data-local-save-status role="status"></span>';
  controls.append(wrap);
  const tell = (text) => { wrap.querySelector("[data-local-save-status]").textContent = text; };
  wrap.querySelector("[data-local-save]").addEventListener("click", () => {
    try {
      const game = getGame();
      const saved = { physics_version: PHYSICS_VERSION, createdAt: Date.now(), expiresAt: Date.now() + 24 * 60 * 60 * 1000, state: serializeGameState(game) };
      const raw = JSON.stringify(saved);
      if (new TextEncoder().encode(raw).byteLength > MAX_SAVE_BYTES) throw new Error("本机存档超过 256 KB，无法保存。");
      localStorage.setItem(LOCAL_CHEAT_SAVE_KEY, raw); tell("已保存在本机 24 小时；不连接账户或收费。");
    } catch (error) { tell(errorText(error)); }
  });
  wrap.querySelector("[data-local-load]").addEventListener("click", () => {
    try {
      const raw = localStorage.getItem(LOCAL_CHEAT_SAVE_KEY);
      if (!raw || new TextEncoder().encode(raw).byteLength > MAX_SAVE_BYTES) throw new Error("没有可用的本机存档。");
      const saved = JSON.parse(raw);
      if (!Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now()) throw new Error("本机存档已过期，不能读取。");
      if (saved.physics_version !== PHYSICS_VERSION) throw new Error("本机存档来自不兼容的游戏版本，无法继续读取。");
      const state = validateGameState(saved.state);
      setGame(hydrateGameState(state, { random: Math.random, variantRandom: Math.random }));
      tell("已读取本机棋盘；不连接账户，不改变图鉴、奖励或排行榜。");
    } catch (error) { tell(errorText(error)); }
  });
}
