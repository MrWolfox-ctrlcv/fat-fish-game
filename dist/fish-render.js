// Game renderer and runtime art registry. The factory receives game rules so
// the rendering module stays independent of the physics implementation.
export function createFishRenderer({ MAX_LEVEL, FIELD_WIDTH, radiusForLevel, getEasterEgg, getEasterImageKey, isEasterEggId }) {
  const characterImages = new Map();
  const easterImages = new Map();

  function clearRegisteredArt() {
    characterImages.clear();
    easterImages.clear();
  }

  function registerCharacterImage(level, image) {
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new RangeError(`角色级别必须在 1 到 ${MAX_LEVEL} 之间`);
    if (!image || typeof image !== "object") throw new TypeError("请传入已加载的图片对象");
    characterImages.set(level, image);
  }

  function registerEasterImage(id, image, sourceRect = null, level = null) {
    if (!isEasterEggId(id)) throw new RangeError(`未知彩蛋角色：${id}`);
    if (!image || typeof image !== "object") throw new TypeError("请传入已加载的图片对象");
    const registeredLevel = level ?? getEasterEgg(id).previewLevel;
    const key = getEasterImageKey(id, registeredLevel);
    if (!key) throw new RangeError(`彩蛋 ${id} 没有第 ${registeredLevel} 级造型`);
    easterImages.set(key, { image, sourceRect, id, level: registeredLevel });
  }

  function getRegisteredEasterImage(id, level) {
    const key = getEasterImageKey(id, level);
    return key ? easterImages.get(key) ?? null : null;
  }

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function drawWhale(ctx, x, y, level, r, alpha = 1, angle = 0, variant = null, showEasterBadge = true) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    const eggArt = isEasterEggId(variant) ? getRegisteredEasterImage(variant, level) : null;
    const eggReady = eggArt && ("complete" in eggArt.image ? eggArt.image.complete && eggArt.image.naturalWidth > 0 : eggArt.image.width > 0);
    if (eggReady) {
      const rect = eggArt.sourceRect;
      if (rect) {
        const sx = rect.sx ?? rect.x ?? 0;
        const sy = rect.sy ?? rect.y ?? 0;
        const sw = rect.sw ?? rect.width;
        const sh = rect.sh ?? rect.height;
        const imageWidth = eggArt.image.naturalWidth || eggArt.image.width;
        const imageHeight = eggArt.image.naturalHeight || eggArt.image.height;
        const validRect = [sx, sy, sw, sh].every(Number.isFinite) && sx >= 0 && sy >= 0 && sw > 0 && sh > 0 && sx + sw <= imageWidth && sy + sh <= imageHeight;
        if (validRect) ctx.drawImage(eggArt.image, sx, sy, sw, sh, -r, -r, r * 2, r * 2);
        else ctx.drawImage(eggArt.image, -r, -r, r * 2, r * 2);
      } else ctx.drawImage(eggArt.image, -r, -r, r * 2, r * 2);
      ctx.restore();
      if (showEasterBadge && isEasterEggId(variant)) drawLevelBadge(ctx, x, y, r, level, alpha);
      return;
    }
    const image = isEasterEggId(variant) ? null : characterImages.get(level);
    const imageReady = image && ("complete" in image ? image.complete && image.naturalWidth > 0 : image.width > 0);
    if (imageReady) {
      ctx.drawImage(image, -r, -r, r * 2, r * 2);
      ctx.restore();
      if (showEasterBadge && isEasterEggId(variant)) drawLevelBadge(ctx, x, y, r, level, alpha);
      return;
    }
    ctx.fillStyle = "rgba(179, 207, 211, .58)";
    ctx.strokeStyle = "rgba(128, 165, 173, .72)";
    ctx.lineWidth = Math.max(1, r * .035);
    ctx.beginPath(); ctx.arc(0, 0, r * .76, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(91, 129, 139, .78)";
    for (const offset of [-r * .18, 0, r * .18]) {
      ctx.beginPath(); ctx.arc(offset, 0, Math.max(1, r * .045), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (showEasterBadge && isEasterEggId(variant)) drawLevelBadge(ctx, x, y, r, level, alpha);
  }

  function drawLevelBadge(ctx, x, y, r, level, alpha = 1) {
    const w = Math.max(18, r * 0.7);
    const h = Math.max(14, r * 0.52);
    const bx = x + r * 0.48;
    const by = y + r * 0.48;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#244d72";
    ctx.strokeStyle = "#fff9e9";
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.beginPath();
    ctx.roundRect(bx - w / 2, by - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fffdf4";
    ctx.font = `800 ${Math.max(9, Math.min(14, r * 0.38))}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(level), bx, by + 0.3);
    ctx.restore();
  }

  function drawGame(ctx, game, { width = FIELD_WIDTH, height = game.height, showAim = true } = {}) {
    ctx.clearRect(0, 0, width, height);
    const lineY = 96;
    ctx.save();
    ctx.setLineDash([5, 7]); ctx.strokeStyle = "rgba(239,153,130,.57)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(8, lineY); ctx.lineTo(width - 8, lineY); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(187,111,99,.68)"; ctx.font = "10px system-ui, sans-serif"; ctx.fillText("水面警戒线", 12, lineY - 7);
    if (showAim && !game.over) {
      const r = radiusForLevel(game.currentLevel);
      const x = clamp(game.aimX, r + 6, width - r - 6);
      ctx.strokeStyle = "rgba(71,163,164,.32)"; ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.moveTo(x, 60); ctx.lineTo(x, height - r - 8); ctx.stroke(); ctx.setLineDash([]);
      drawWhale(ctx, x, 48, game.currentLevel, r, .79, 0, game.currentVariant);
    }
    ctx.restore();

    for (const p of game.particles) {
      const alpha = 1 - p.age / p.life;
      ctx.save(); ctx.globalAlpha = alpha * .8; ctx.fillStyle = "#fff8df";
      for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 * i) / 5;
        const px = p.x + Math.cos(angle) * (8 + p.age * 38);
        const py = p.y + Math.sin(angle) * (8 + p.age * 38);
        ctx.beginPath(); ctx.arc(px, py, 2.5 * alpha, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    [...game.bodies].sort((a, b) => a.y - b.y).forEach((body) => {
      drawWhale(ctx, body.x, body.y, body.level, body.r, 1, body.angle, body.variant, false);
      drawLevelBadge(ctx, body.x, body.y, body.r, body.level);
      if (game.propSelectionIds?.includes(body.id)) {
        ctx.save(); ctx.strokeStyle = "#ffbd54"; ctx.lineWidth = 4; ctx.setLineDash([7, 4]);
        ctx.beginPath(); ctx.arc(body.x, body.y, body.r + 6, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
    });
  }

  function drawMini(canvas, level, locked = false, variant = null) {
    const ctx = canvas.getContext("2d");
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth || canvas.width;
    canvas.width = Math.round(size * ratio); canvas.height = Math.round(size * ratio);
    ctx.scale(ratio, ratio);
    if (locked) {
      ctx.fillStyle = "#d9e7e1"; ctx.beginPath(); ctx.arc(size / 2, size / 2, size * .19, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#afc1ba"; ctx.font = `${Math.max(10, size * .19)}px system-ui`; ctx.textAlign = "center"; ctx.fillText("?", size / 2, size * .57);
    } else drawWhale(ctx, size / 2, size / 2, level, size * .36, 1, 0, variant);
  }

  return { clearRegisteredArt, registerCharacterImage, registerEasterImage, getRegisteredEasterImage, drawGame, drawMini };
}
