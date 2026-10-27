export function createFishPropsUI({
  account, activeRun, guestRun, gameReady, getGame, setGame, getCanvasScale,
  client, flushCheckpoint, checkpointClean, refreshGame, refreshLeaderboard, toast, getBlocked = () => false,
  renderFinal, focusCanvas, settled,
}) {
  let enabled = false, reason = "正在确认道具服务状态。", mode = "", selection = [];
  let pending = null, busy = false, paused = false;
  const removeButton = document.querySelector("#prop-remove");
  const mergeButton = document.querySelector("#prop-merge");
  const swapButton = document.querySelector("#prop-swap");
  const packButton = document.querySelector("#prop-pack");
  const packFinishButton = document.querySelector("#prop-pack-finish");
  const retryButton = document.querySelector("#prop-retry");
  const status = document.querySelector("#prop-status");
  const overlay = document.querySelector("#overlay");
  const selected = (game) => { game.propSelectionIds = [...selection]; };

  const render = () => {
    const canUse = Boolean(enabled && account() && gameReady() && !guestRun() && !getBlocked());
    removeButton.hidden = !canUse; mergeButton.hidden = !canUse; swapButton.hidden = !canUse; packButton.hidden = !canUse;
    packFinishButton.hidden = mode !== "pack"; retryButton.hidden = !pending;
    removeButton.disabled = busy || Boolean(pending); mergeButton.disabled = busy || Boolean(pending);
    swapButton.disabled = busy || Boolean(pending); packButton.disabled = busy || Boolean(pending);
    packFinishButton.disabled = busy || Boolean(pending) || selection.length < 1 || selection.length > 3;
    retryButton.disabled = busy;
    if (pending) status.textContent = busy
      ? "正在确认同一笔道具请求，请稍候。"
      : `道具结果暂未确认。游戏已暂停；使用同一请求重试。${pending.receiptId ? `订单号：${pending.receiptId}` : `请求号：${pending.payload.request_id}`}`;
    else if (getBlocked()) status.textContent = "存档请求尚未确认，游戏与道具操作暂时锁定。请先确认同一请求。";
    else if (mode === "remove") status.textContent = selection.length ? "已选中一条鱼，确认后扣款并移除。" : "游戏已暂停，请点击要移走的鱼。";
    else if (mode === "merge") status.textContent = selection.length ? "已选中一条鱼，请再选一条同级鱼。" : "游戏已暂停，请选择两条同级鱼。";
    else if (mode === "swap") status.textContent = selection.length ? "已选中一条鱼，请再选任意另一条鱼交换位置。" : "游戏已暂停，请选择两条鱼交换位置。";
    else if (mode === "pack") status.textContent = `已选 ${selection.length}/3 条。请选择 1–3 级小鱼，再按“确认打包所选鱼”。`;
    else if (!account()) status.textContent = "登录中转站账户后可使用付费道具。";
    else if (!enabled) status.textContent = reason || "道具暂不可用。";
    else if (!gameReady()) status.textContent = "本局就绪后可用，每次从中转站账户扣 $0.01；每局最多 20 次。";
    else status.textContent = "每次从中转站账户扣 $0.01；每局最多 20 次。";
    selected(getGame());
  };

  const load = async () => {
    try {
      const response = await client.getProps(), data = response?.data ?? response;
      enabled = data.enabled === true; reason = data.reason || "道具暂不可用。";
    } catch (error) { enabled = false; reason = error.message || "道具服务暂时无法确认，请稍后刷新。"; }
    render();
  };

  const clearSelection = () => {
    mode = ""; selection = []; paused = Boolean(pending); overlay.hidden = !getGame().over; render();
  };

  const submit = async () => {
    if (!pending || busy) return;
    busy = true; render();
    try {
      const session = client.user ? { user: client.user } : await client.getMe();
      if (session?.user?.id !== pending.ownerId || account()?.id !== pending.ownerId) {
        busy = false; render();
        status.textContent = "这笔道具请求仍保留。请登录发起订单的原账户，再用同一请求确认。";
        return;
      }
      const response = await client.useProp(pending.payload), data = response?.data ?? response;
      if (data.expired) {
        pending = null; busy = false; mode = ""; selection = []; paused = false;
        overlay.hidden = !getGame().over; render();
        toast("道具已扣款，但原对局已失效，无法恢复本局。请重新开始。", { paid: true }); settled(); return;
      }
      if (data.pending || !data.state) {
        pending.receiptId = data.receipt?.id ?? pending.receiptId;
        busy = false; render(); return;
      }
      const snapshot = data.state;
      if (!Array.isArray(snapshot.bodies) || !Number.isSafeInteger(snapshot.stepIndex)) throw new Error("状态尚未确认");
      const sameOwner = account()?.id === pending.ownerId;
      const sameRun = sameOwner && activeRun()?.id === pending.runId;
      if (!sameRun) {
        if (sameOwner && (data.profile || data.rewards)) refreshGame({ profile: data.profile, rewards: data.rewards });
        pending = null; busy = false; mode = ""; selection = []; paused = false;
        overlay.hidden = !getGame().over; render();
        toast("道具已扣款，但它属于已切换的对局；当前画面已保留，请重新开始。", { paid: true }); settled(); return;
      }
      setGame(snapshot);
      checkpointClean();
      if (data.user || data.profile || data.rewards) refreshGame(data);
      if (data.play) refreshGame(data.play, true);
      pending = null; busy = false; mode = ""; selection = []; paused = false;
      overlay.hidden = !getGame().over;
      renderFinal(getGame()); render(); refreshLeaderboard();
      toast(data.receipt?.message || (data.summary?.over === false ? "道具已生效，鱼缸获救了！" : "道具已生效。"));
      settled();
    } catch (error) {
      const code = Number(error?.status) || 0;
      const errorCode = error?.code;
      if (errorCode === "STALE_PROP_RECEIPT") {
        pending = null; busy = false; mode = ""; selection = []; paused = false;
        overlay.hidden = !getGame().over; render();
        toast("道具已扣款，但原对局已继续；当前画面保留，请重新开始。", { paid: true }); settled();
      } else if (code === 401) {
        busy = false; render(); status.textContent = "道具请求仍保留。请登录发起订单的原账户，再用同一请求确认。";
      } else if (["INVALID_PROP", "PROPS_DISABLED", "PAYMENT_REFUSED", "WALLET_REJECTED", "WALLET_UNAVAILABLE", "WALLET_BUSY",
        "WALLET_DISABLED", "WALLET_INPUT", "PROP_RUN_LIMIT", "INSUFFICIENT_QUOTA", "PROP_REQUEST_FAILED"].includes(errorCode)) {
        pending = null; busy = false; mode = ""; selection = []; paused = false;
        overlay.hidden = !getGame().over; render(); toast(error.message || "道具没有生效，本次未扣费。");
        settled();
      } else { busy = false; render(); }
    }
  };

  const confirmSelection = async () => {
    const kind = mode, bodyIds = [...selection];
    if (!kind || !bodyIds.length || (kind !== "remove" && bodyIds.length !== 2 && kind !== "pack") ||
        (kind === "pack" && (bodyIds.length < 1 || bodyIds.length > 3))) return;
    const label = ({ remove: "捞鱼网", merge: "牵线合成", swap: "交换位置", pack: "打包小鱼" })[kind];
    const action = ({ remove: "移走这条鱼", merge: "合成这两条鱼", swap: "交换这两条鱼的位置", pack: `打包所选 ${bodyIds.length} 条小鱼` })[kind];
    if (!window.confirm(`确认使用“${label}”${action}？本次从中转站账户扣 $0.01；未成功生效不收费。`)) { clearSelection(); return; }
    const run = activeRun();
    pending = { ownerId: account().id, runId: run.id, receiptId: null, payload: { run_id: run.id, step: getGame().stepIndex, moves: [],
      request_id: globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (slot) => {
        const value = Math.floor(Math.random() * 16); return (slot === "x" ? value : (value & 3) | 8).toString(16);
    }), kind, body_ids: bodyIds, confirm_quota: 5000 } };
    mode = ""; selection = []; paused = true; busy = false; render();
    if (!(await flushCheckpoint())) {
      pending = null; paused = false; overlay.hidden = !getGame().over; render();
      toast("本局进度未同步，道具没有扣款。请稍后重试。"); settled(); return;
    }
    pending.payload.step = getGame().stepIndex;
    await submit();
  };

  const begin = (kind) => {
    if (pending) { void submit(); return; }
    if (!enabled || !account() || !gameReady() || guestRun() || busy || getBlocked()) return;
    mode = kind; selection = []; paused = true; overlay.hidden = true; render(); focusCanvas();
  };

  const selectFish = (event) => {
    if (!mode || pending || busy) return;
    const { scale, offsetX, offsetY } = getCanvasScale(), rect = document.querySelector("#game-canvas").getBoundingClientRect();
    const x = (event.clientX - rect.left - offsetX) / scale, y = (event.clientY - rect.top - offsetY) / scale;
    const game = getGame(), fish = [...game.bodies].reverse().find((body) => Math.hypot(body.x - x, body.y - y) <= body.r + 8);
    if (!fish) return;
    if (mode === "remove") { selection = [fish.id]; render(); void confirmSelection(); return; }
    if (mode === "pack") {
      if (fish.level < 1 || fish.level > 3) { status.textContent = "打包只能选择 1–3 级小鱼。"; return; }
      if (selection.includes(fish.id)) { selection = selection.filter((id) => id !== fish.id); render(); return; }
      if (selection.length >= 3) { status.textContent = "最多打包 3 条小鱼；移除已选鱼后再选。"; return; }
      selection.push(fish.id); render(); return;
    }
    if (!selection.length) {
      if (mode === "merge" && fish.level >= 11) { status.textContent = "11 级鱼无法继续合成，请选择其他鱼。"; return; }
      selection = [fish.id]; render(); return;
    }
    const first = game.bodies.find((body) => body.id === selection[0]);
    if (!first || first.id === fish.id || (mode === "merge" && (first.level !== fish.level || fish.level >= 11))) {
      if (mode === "swap" && first && first.id !== fish.id) { selection.push(fish.id); render(); void confirmSelection(); return; }
      status.textContent = mode === "merge" ? "请选择另一条等级相同且低于 11 级的鱼。" : "请选择另一条不同的鱼。"; return;
    }
    selection.push(fish.id); render(); void confirmSelection();
  };

  removeButton.addEventListener("click", () => begin("remove"));
  mergeButton.addEventListener("click", () => begin("merge"));
  swapButton.addEventListener("click", () => begin("swap"));
  packButton.addEventListener("click", () => begin("pack"));
  packFinishButton.addEventListener("click", () => { if (mode === "pack" && selection.length >= 1 && selection.length <= 3) void confirmSelection(); });
  retryButton.addEventListener("click", () => { void submit(); });
  render();
  return {
    load, render, begin, selectFish, retry: submit, cancelSelection: clearSelection, isPaused: () => paused,
    isSelecting: () => Boolean(mode), hasPending: () => Boolean(pending),
    handleKeyDown(event) {
      if (!paused) return false;
      event.preventDefault(); if (mode && event.code === "Escape") clearSelection(); return true;
    },
  };
}
