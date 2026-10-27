// This UI is loaded only by the explicit loopback-only cheat flag.
import { chooseAutoDropX } from "./local-cheats.js";

export function setupLocalCheatUI({
  BASE_FIELD_HEIGHT, FIELD_WIDTH, MAX_LEVEL, awardForLevel, clamp, createGame,
  drawGame, drawMini, dropBody, mergeBodiesInLocalMode, registerCharacterImage,
  registerEasterImage, stepGame,
}) {
  const canvas = document.querySelector("#game-canvas");
  if (!canvas) return;
  document.querySelector(".topbar")?.setAttribute("hidden", "");
  document.querySelector(".side-column")?.setAttribute("hidden", "");
  document.querySelector("#companion")?.setAttribute("hidden", "");
  document.querySelector(".score-box.record span").textContent = "本局最高分";
  const wrapper = document.querySelector(".board-wrap");
  const controls = document.createElement("section");
  controls.className = "local-cheat-controls";
  controls.setAttribute("aria-label", "本地快乐模式");
  controls.innerHTML = `<strong>本地快乐模式</strong><label>下一条<select data-cheat-level>${Array.from({length: MAX_LEVEL}, (_, i) => `<option value="${i + 1}">${i + 1} 级</option>`).join("")}</select></label><button type="button" data-cheat-revive>复活继续</button><button type="button" data-cheat-clear>清除小鱼（1–3级）</button><label><input type="checkbox" data-cheat-auto> 自动投放</label><button type="button" data-cheat-net>捞鱼网 · 本地免费体验</button><button type="button" data-cheat-merge>牵线合成 · 本地免费体验</button><span data-cheat-hint>开启道具后，点击鱼缸里的鱼</span>`;
  wrapper.after(controls);
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "./local-cheats.css"; document.head.append(style);
  const ctx = canvas.getContext("2d");
  const score = document.querySelector("#score");
  const next = document.querySelector("#next-canvas");
  const overlay = document.querySelector("#overlay");
  let game = createGame({ height: BASE_FIELD_HEIGHT });
  let scale = 1, offsetX = 0, offsetY = 0, lastTime = 0, accumulator = 0;
  let toolMode = "", selectedToolFish = null;
  const toolHint = controls.querySelector("[data-cheat-hint]");
  const levelSelect = controls.querySelector("[data-cheat-level]");
  const resize = () => {
    const rect = wrapper.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    scale = Math.min(rect.width / FIELD_WIDTH, rect.height / BASE_FIELD_HEIGHT);
    offsetX = (rect.width - FIELD_WIDTH * scale) / 2; offsetY = (rect.height - BASE_FIELD_HEIGHT * scale) / 2;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
    game.width = FIELD_WIDTH; game.height = BASE_FIELD_HEIGHT;
  };
  const aim = (event) => {
    const rect = canvas.getBoundingClientRect();
    game.aimX = clamp((event.clientX - rect.left - offsetX) / scale, 30, FIELD_WIDTH - 30);
  };
  const drop = () => {
    if (game.over) return;
    game.currentLevel = Number(levelSelect.value);
    game.currentVariant = null;
    if (dropBody(game, game.aimX)) {
      game.currentLevel = Number(levelSelect.value);
      game.currentVariant = null;
    }
  };
  levelSelect.addEventListener("change", () => {
    game.currentLevel = Number(levelSelect.value);
    game.currentVariant = null;
    drawMini(next, game.currentLevel);
  });
  levelSelect.value = String(game.currentLevel);
  controls.querySelector("[data-cheat-revive]").addEventListener("click", () => {
    game.over = false; game.overTimer = 0;
    for (const body of game.bodies) body.dangerTime = 0;
    overlay.hidden = true;
  });
  controls.querySelector("[data-cheat-clear]").addEventListener("click", () => {
    game.bodies = game.bodies.filter((body) => body.level > 3);
    game.over = false; game.overTimer = 0;
    for (const body of game.bodies) body.dangerTime = 0;
    overlay.hidden = true;
  });
  controls.querySelector("[data-cheat-net]").addEventListener("click", () => {
    toolMode = toolMode === "net" ? "" : "net"; selectedToolFish = null;
    toolHint.textContent = toolMode ? "捞鱼网已就绪：点击一条鱼将它移走" : "道具已关闭";
  });
  controls.querySelector("[data-cheat-merge]").addEventListener("click", () => {
    toolMode = toolMode === "merge" ? "" : "merge"; selectedToolFish = null;
    toolHint.textContent = toolMode ? "牵线合成已就绪：依次点击两条同级鱼" : "道具已关闭";
  });
  canvas.addEventListener("pointermove", aim);
  canvas.addEventListener("pointerdown", (event) => {
    aim(event); event.preventDefault();
    if (toolMode) {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left - offsetX) / scale, y = (event.clientY - rect.top - offsetY) / scale;
      const body = [...game.bodies].reverse().find((fish) => Math.hypot(fish.x - x, fish.y - y) <= fish.r + 8);
      if (!body) return;
      if (toolMode === "net") {
        game.bodies = game.bodies.filter((fish) => fish !== body);
        toolHint.textContent = `已捞走 ${body.level} 级鱼`;
      } else if (!selectedToolFish) {
        selectedToolFish = body;
        toolHint.textContent = body.level >= MAX_LEVEL ? "顶级鱼不能合成，请选较低等级" : `已选 ${body.level} 级鱼，再选一条同级鱼`;
      } else {
        const result = mergeBodiesInLocalMode(game, selectedToolFish.id, body.id);
        toolHint.textContent = result ? `合成第 ${result.level} 级 +${awardForLevel(result.level)}` : "需要选择两条不同的同级鱼（顶级鱼不可合）";
        selectedToolFish = null;
      }
      return;
    }
    if (event.pointerType === "mouse") drop();
  });
  canvas.addEventListener("pointerup", (event) => { if (event.pointerType !== "mouse") { aim(event); drop(); } });
  canvas.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "Enter") { event.preventDefault(); drop(); }
    if (event.code === "ArrowLeft" || event.code === "ArrowRight") { event.preventDefault(); game.aimX = clamp(game.aimX + (event.code === "ArrowLeft" ? -24 : 24), 30, FIELD_WIDTH - 30); }
  });
  const restart = () => { game = createGame({ height: BASE_FIELD_HEIGHT }); levelSelect.value = String(game.currentLevel); overlay.hidden = true; };
  document.querySelector("#restart").addEventListener("click", restart);
  document.querySelector("#play-again").addEventListener("click", restart);
  const frame = (time) => {
    if (!lastTime) lastTime = time;
    accumulator += Math.min(.05, (time - lastTime) / 1000); lastTime = time;
    while (accumulator >= 1 / 60) {
      if (controls.querySelector("[data-cheat-auto]").checked && !game.over && game.dropCooldown <= 0) {
        game.aimX = chooseAutoDropX(game, game.currentLevel); drop();
      }
      const result = stepGame(game, 1 / 60);
      if (result.failed) {
        document.querySelector("#final-score").textContent = String(game.score);
        drawMini(document.querySelector("#gameover-avatar"), Math.max(...game.unlocked)); overlay.hidden = false;
      }
      accumulator -= 1 / 60;
    }
    score.textContent = String(game.score);
    document.querySelector("#best-score").textContent = String(game.best);
    drawMini(next, game.currentLevel);
    drawGame(ctx, game, { width: FIELD_WIDTH, height: game.height });
    if (selectedToolFish && game.bodies.includes(selectedToolFish)) {
      ctx.save(); ctx.strokeStyle = "#e28c38"; ctx.lineWidth = 4; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.arc(selectedToolFish.x, selectedToolFish.y, selectedToolFish.r + 5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    requestAnimationFrame(frame);
  };
  new ResizeObserver(resize).observe(wrapper); resize(); drawMini(document.querySelector("#brand-avatar"), 1); requestAnimationFrame(frame);
  void import("./character-art.js").then(async (art) => {
    await Promise.all([art.loadCharacterArt(registerCharacterImage), art.loadEasterArt(registerEasterImage)]);
    drawMini(document.querySelector("#brand-avatar"), 1);
    drawMini(next, game.currentLevel);
  }).catch((error) => console.info("本地素材暂不可用，使用占位形象。", error));
}

