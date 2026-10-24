import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { CHARACTER_SPRITES, STAGE_SPRITES, ASTRA_SPRITES, NEW_FISH_SPRITES, DOUBAO_SPRITES } from '../dist/character-art.js';

function extract(source, [x, y, width, height]) {
  const side = Math.max(width, height);
  const crop = new PNG({ width: side, height: side });
  crop.data.fill(0);
  const selected = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const alpha = (p) => source.data[((y + Math.floor(p / width)) * source.width + x + p % width) * 4 + 3];
  let seed = Math.floor(height / 2) * width + Math.floor(width / 2);
  if (alpha(seed) <= 8) {
    seed = -1;
    for (let p = 0; p < width * height; p++) if (alpha(p) > 8) { seed = p; break; }
  }
  if (seed < 0) throw new Error('Empty character sprite');
  let head = 0;
  let tail = 1;
  queue[0] = seed;
  selected[seed] = 1;
  while (head < tail) {
    const p = queue[head++];
    const px = p % width;
    const py = Math.floor(p / width);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const next = ny * width + nx;
      if (!selected[next] && alpha(next) > 8) { selected[next] = 1; queue[tail++] = next; }
    }
  }
  const ox = Math.floor((side - width) / 2);
  const oy = Math.floor((side - height) / 2);
  for (let p = 0; p < selected.length; p++) {
    if (!selected[p]) continue;
    const px = p % width;
    const py = Math.floor(p / width);
    const src = ((y + py) * source.width + x + px) * 4;
    const dst = ((oy + py) * side + ox + px) * 4;
    source.data.copy(crop.data, dst, src, src + 4);
  }
  return PNG.sync.write(crop, { colorType: 6 });
}

export async function prepareArt() {
  const root = new URL('../dist/assets/', import.meta.url);
  const [maids, stages, astra, newFish, doubao] = await Promise.all(['whale-maids.png', 'ai-stage-eggs.png', 'astra-stages.png', 'doubao-gemini-stages.png', 'doubao-stages.png']
    .map(async (name) => PNG.sync.read(await readFile(new URL(name, root)))));
  const images = new Map();
  CHARACTER_SPRITES.forEach((rect, i) => images.set(`maid:${i + 1}`, extract(maids, rect)));
  STAGE_SPRITES.forEach(([id, level, rect]) => images.set(`${id}:${level}`, extract(stages, rect)));
  ASTRA_SPRITES.forEach(([level, rect]) => images.set(`gpt-astra:${level}`, extract(astra, rect)));
  NEW_FISH_SPRITES.forEach(([id, level, rect]) => images.set(`${id}:${level}`, extract(newFish, rect)));
  DOUBAO_SPRITES.forEach(([level, rect]) => images.set(`doubao:${level}`, extract(doubao, rect)));
  return images;
}
