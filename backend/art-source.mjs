import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { getArtRects } from './art-map.mjs';

export const ART_VERSION = 1;
const sources = [
  ['maids', 'whale-maids.png'], ['stages', 'ai-stage-eggs.png'], ['astra', 'astra-stages.png'],
  ['newFish', 'doubao-gemini-stages.png'], ['doubao', 'doubao-stages.png'],
  ['newEaster', 'new-easter-eggs.png'],
];
const hash = (data) => createHash('sha256').update(data).digest('hex');

function extract(source, rect) {
  const [x, y, width, height] = rect;
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

export async function buildArt() {
  const root = new URL('../dist/assets/', import.meta.url);
  const loaded = new Map(await Promise.all(sources.map(async ([id, name]) => {
    const bytes = await readFile(new URL(name, root));
    return [id, { name, bytes, sha256: hash(bytes), png: PNG.sync.read(bytes) }];
  })));
  const rects = getArtRects();
  const images = new Map();
  for (const [key, [sourceId, rect]] of rects) images.set(key, extract(loaded.get(sourceId).png, rect));
  const descriptor = JSON.stringify({ version: ART_VERSION, rects: [...rects] });
  return { images, sourceHashes: Object.fromEntries([...loaded].map(([id, v]) => [id, { name: v.name, sha256: v.sha256, size: v.bytes.length }])), coordinateFingerprint: hash(descriptor) };
}
