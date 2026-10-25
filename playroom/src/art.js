// Pre-cropped originals: no atlas downloads or per-browser pixel extraction.
async function loadImage(relativePath) {
  const image = new Image();
  image.src = new URL(relativePath, import.meta.url).href;
  await image.decode();
  return image;
}

export async function loadArt() {
  const [deepseek, gptSilly, fakeClaude] = await Promise.all([
    loadImage('/games/fat-fish/api/sprites?level=1'),
    loadImage('/games/fat-fish/api/sprites?level=2&variant=gpt-silly'),
    loadImage('/games/fat-fish/api/sprites?level=5&variant=deepseek-claude'),
  ]);
  return { deepseek, gptSilly, fakeClaude };
}

export function drawAvatar(ctx, art, skin, x, y, size, rotation = 0, squash = 0) {
  const image = art?.[skin] || art?.deepseek;
  if (!image) return;
  ctx.save();
  ctx.translate(x, y);
  if (squash && typeof squash === "object") {
    const squeezeX = Math.max(-1, Math.min(1, Number(squash.x) || 0));
    const squeezeY = Math.max(-1, Math.min(1, Number(squash.y) || 0));
    ctx.scale(1 + squeezeX * 0.14, 1 + squeezeY * 0.1);
    ctx.rotate(Number(rotation) || 0);
  } else {
    const deform = Math.max(-1, Math.min(1, Number(squash) || 0));
    ctx.rotate(Number(rotation) || 0);
    ctx.scale(1 + deform * 0.1, 1 - Math.abs(deform) * 0.055);
  }
  const side = size * 1.06;
  ctx.drawImage(image, -side / 2, -side / 2, side, side);
  ctx.restore();
}
