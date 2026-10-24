// Image-generated originals. Coordinates describe the unmodified transparent atlas.
const SPRITES = [
  [51, 121, 256, 256], [330, 92, 287, 285], [642, 79, 282, 298],
  [938, 83, 284, 294], [16, 484, 294, 305], [318, 474, 294, 320],
  [608, 453, 316, 347], [930, 473, 319, 323], [9, 878, 308, 312],
  [321, 846, 299, 343], [610, 819, 366, 376],
];

const EASTER_SPRITES = [
  ["gpt-silly", 1, [11, 14, 349, 346]],
  ["gpt-silly", 2, [374, 19, 341, 341]],
  ["gpt-silly", 3, [723, 16, 359, 344]],
  ["gpt-normal", 4, [1101, 10, 338, 350]],
  ["deepseek-claude", 5, [9, 370, 360, 343]],
  ["gpt-normal", 6, [372, 364, 354, 351]],
  ["deepseek-claude", 7, [720, 366, 368, 348]],
  ["super-whale", 8, [1092, 366, 354, 347]],
  ["super-whale", 9, [8, 722, 358, 349]],
  ["super-whale", 10, [368, 718, 356, 357]],
  ["super-whale", 11, [724, 718, 387, 357]],
];
const ASTRA_SPRITES = [
  [9, [11, 29, 701, 679]],
  [10, [722, 11, 726, 700]],
  [11, [1454, 7, 715, 709]],
];
const NEW_FISH_SPRITES = [
  ['gemini', 3, [28, 572, 449, 409]],
  ['gemini', 5, [490, 535, 471, 454]],
  ['gemini', 7, [973, 513, 550, 487]],
];
const DOUBAO_SPRITES = [
  [2, [63, 113, 504, 583]],
  [4, [723, 49, 527, 655]],
  [6, [1450, 11, 578, 693]],
];

function spriteFromAtlas(image, [x, y, width, height]) {
  const crop = document.createElement("canvas");
  crop.width = width;
  crop.height = height;
  const context = crop.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, x, y, width, height, 0, 0, width, height);

  // Some fins overlap their neighbours' rectangular bounds. Keep only this
  // character's connected alpha region so another sprite can never bleed in.
  const pixels = context.getImageData(0, 0, width, height);
  const rgba = pixels.data;
  const selected = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let seed = Math.floor(height / 2) * width + Math.floor(width / 2);
  if (rgba[seed * 4 + 3] <= 8) {
    seed = -1;
    for (let p = 0; p < width * height; p++) {
      if (rgba[p * 4 + 3] > 8) { seed = p; break; }
    }
  }
  if (seed < 0) throw new Error("角色素材为空");
  let head = 0;
  let tail = 1;
  queue[0] = seed;
  selected[seed] = 1;
  while (head < tail) {
    const p = queue[head++];
    const px = p % width;
    const py = Math.floor(p / width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (!selected[next] && rgba[next * 4 + 3] > 8) {
          selected[next] = 1;
          queue[tail++] = next;
        }
      }
    }
  }
  for (let p = 0; p < selected.length; p++) {
    if (!selected[p]) rgba[p * 4 + 3] = 0;
  }
  context.putImageData(pixels, 0, 0);

  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = Math.max(width, height);
  sprite.getContext("2d").drawImage(crop, (sprite.width - width) / 2, (sprite.height - height) / 2);
  return sprite;
}

export async function loadCharacterArt(register) {
  const image = new Image();
  image.src = new URL("./assets/whale-maids.png", import.meta.url).href;
  await image.decode();
  SPRITES.forEach((rectangle, index) => register(index + 1, spriteFromAtlas(image, rectangle)));
}

export async function loadEasterArt(register) {
  const stages = new Image();
  const astra = new Image();
  const newFish = new Image();
  const doubao = new Image();
  stages.src = new URL("./assets/ai-stage-eggs.png", import.meta.url).href;
  astra.src = new URL("./assets/astra-stages.png", import.meta.url).href;
  newFish.src = new URL('./assets/doubao-gemini-stages.png', import.meta.url).href;
  doubao.src = new URL('./assets/doubao-stages.png', import.meta.url).href;
  await Promise.all([stages.decode(), astra.decode(), newFish.decode(), doubao.decode()]);
  EASTER_SPRITES.forEach(([id, level, rectangle]) => register(id, spriteFromAtlas(stages, rectangle), null, level));
  ASTRA_SPRITES.forEach(([level, rectangle]) => register("gpt-astra", spriteFromAtlas(astra, rectangle), null, level));
  NEW_FISH_SPRITES.forEach(([id, level, rectangle]) => register(id, spriteFromAtlas(newFish, rectangle), null, level));
  DOUBAO_SPRITES.forEach(([level, rectangle]) => register('doubao', spriteFromAtlas(doubao, rectangle), null, level));
}

// Production retrieves only individually authorised images, never the atlases.
const accountArt = new Map();
const playingArt = new Map();
export function clearAccountArtCache() { accountArt.clear(); playingArt.clear(); }

export async function loadPlayingArt(play, fetchArt, registerCharacter, registerEaster) {
  const tasks = (play?.levels || []).map((level) => ({ level }));
  for (const stage of play?.egg_stages || []) {
    const split = stage.lastIndexOf(":");
    tasks.push({ variant: stage.slice(0, split), level: Number(stage.slice(split + 1)) });
  }
  await Promise.all(tasks.map(async (item) => {
    const key = `${play.run_id}:${item.variant || "maid"}:${item.level}`;
    if (!playingArt.has(key)) playingArt.set(key, (async () => {
      const blob = await fetchArt(item);
      const url = URL.createObjectURL(blob);
      try { const image = new Image(); image.src = url; await image.decode(); return image; }
      finally { URL.revokeObjectURL(url); }
    })().catch((error) => { playingArt.delete(key); throw error; }));
    const image = await playingArt.get(key);
    if (item.variant) registerEaster(item.variant, image, null, item.level);
    else registerCharacter(item.level, image);
  }));
}

export async function loadAccountArt(profile, fetchArt, registerCharacter, registerEaster) {
  const account = profile.user_id ?? profile.account_id;
  const tasks = (profile.unlocked || []).map((level) => ({ level }));
  for (const stage of profile.egg_stages || []) {
    const split = stage.lastIndexOf(":");
    tasks.push({ variant: stage.slice(0, split), level: Number(stage.slice(split + 1)) });
  }
  await Promise.all(tasks.map(async (item) => {
    const key = `${account ?? "session"}:${item.variant || "maid"}:${item.level}`;
    if (!accountArt.has(key)) {
      accountArt.set(key, (async () => {
        const blob = await fetchArt(item);
        const url = URL.createObjectURL(blob);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          return image;
        } finally { URL.revokeObjectURL(url); }
      })().catch((error) => { accountArt.delete(key); throw error; }));
    }
    const image = await accountArt.get(key);
    if (item.variant) registerEaster(item.variant, image, null, item.level);
    else registerCharacter(item.level, image);
  }));
}

export { SPRITES as CHARACTER_SPRITES, EASTER_SPRITES as STAGE_SPRITES, ASTRA_SPRITES, NEW_FISH_SPRITES, DOUBAO_SPRITES };
