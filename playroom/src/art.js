import { ROSTER } from "./arena-roster.js";

const PORTRAIT_IDS = ["deepseek", "gptNormal", "claude", "gemini", "doubao", "qwen", "kimi", "grok"];
const characterById = new Map(ROSTER.map((character) => [character.id, character]));
const imageCache = new Map();
const MAX_CACHE = 12;

function portraitUrl(id) {
  const path = typeof location !== "undefined" && location.pathname.startsWith("/games/bumper/")
    ? `/games/bumper/portraits/${id}.png`
    : `/portraits/${id}.png`;
  return path;
}

function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const promise = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  imageCache.set(src, promise);
  while (imageCache.size > MAX_CACHE) imageCache.delete(imageCache.keys().next().value);
  return promise;
}

function portraitKey(character) {
  const item = typeof character === "string" ? characterById.get(character) : character?.art?.portrait ? character : characterById.get(character?.characterId || character?.id);
  return item?.art?.portrait || null;
}

function requestedPortraits(characters) {
  if (characters == null) return PORTRAIT_IDS;
  const result = new Set();
  for (const character of characters) {
    const id = typeof character === "string" ? character : character?.characterId || character?.id;
    const key = portraitKey(character) || (PORTRAIT_IDS.includes(character) ? character : null);
    if (key) result.add(key);
    if (id === "astra") result.add("gptNormal");
  }
  return [...result];
}

async function loadLegacyArt() {
  const entries = await Promise.all([
    ["deepseek", "/games/fat-fish/api/sprites?level=1"],
    ["gptSilly", "/games/fat-fish/api/sprites?level=2&variant=gpt-silly"],
    ["fakeClaude", "/games/fat-fish/api/sprites?level=5&variant=deepseek-claude"],
  ].map(async ([key, src]) => [key, await loadImage(src)]));
  return Object.fromEntries(entries.filter(([, image]) => image));
}

export async function ensureArt(art = {}, characters = []) {
  const keys = requestedPortraits(characters);
  const images = await Promise.all(keys.map(async (key) => [key, await loadImage(portraitUrl(key))]));
  for (const [key, image] of images) if (image) art[`portrait:${key}`] = image;
  // The original three skins still use the existing canonical starter-sprite endpoint.
  if (characters.some((character) => ["gptSilly", "fakeClaude", "astra"].includes(typeof character === "string" ? character : character?.characterId || character?.id))) {
    Object.assign(art, await loadLegacyArt());
  }
  // Astra remains an ordinary free character; reuse the public GPT portrait if no dedicated art exists.
  if (!art["portrait:astra"] && art["portrait:gptNormal"]) art["portrait:astra"] = art["portrait:gptNormal"];
  return art;
}

export async function loadArt({ characters } = {}) {
  const art = characters == null ? await loadLegacyArt() : {};
  return ensureArt(art, characters ?? PORTRAIT_IDS);
}

export function drawAvatar(ctx, art, skin, x, y, size, rotation = 0, squash = 0) {
  const image = art?.[skin] || (typeof skin === "string" && skin.startsWith("portrait:") ? null : art?.gptNormal) || art?.deepseek;
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
