import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PNG } from "pngjs";

if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: node scripts/prepare-arena-art.mjs <transparent-2x4-atlas.png> <portrait-output-directory>");
}
const input = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const names = ["deepseek", "gptNormal", "claude", "gemini", "doubao", "qwen", "kimi", "grok"];
const atlas = PNG.sync.read(await readFile(input));
if (atlas.width % 2 || atlas.height % 4) throw new Error(`Expected a 2x4 atlas; got ${atlas.width}x${atlas.height}`);
const cellW = atlas.width / 2, cellH = atlas.height / 4, outputSize = 256;
let atlasHasAlpha = false;
for (let i = 3; i < atlas.data.length; i += 4) if (atlas.data[i] < 255) { atlasHasAlpha = true; break; }
if (!atlasHasAlpha) throw new Error("The source atlas has no transparent alpha channel; use a transparent 2x4 atlas.");

function extractCell(source, x0, y0, width, height) {
  const cell = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * source.width + x0) * 4;
    source.data.copy(cell.data, y * width * 4, from, from + width * 4);
  }
  return cell;
}

function bounds(png) {
  let left = png.width, top = png.height, right = -1, bottom = -1;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    if (!png.data[(y * png.width + x) * 4 + 3]) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error("A cell contains no visible character after background removal.");
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function fitSquare(source) {
  const box = bounds(source), scale = Math.min(224 / box.width, 224 / box.height);
  const w = Math.max(1, Math.round(box.width * scale)), h = Math.max(1, Math.round(box.height * scale));
  const out = new PNG({ width: outputSize, height: outputSize, colorType: 6 });
  const offsetX = Math.floor((outputSize - w) / 2), offsetY = Math.floor((outputSize - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = box.left + (x + 0.5) * box.width / w - 0.5;
    const sy = box.top + (y + 0.5) * box.height / h - 0.5;
    const x1 = Math.max(box.left, Math.min(box.left + box.width - 1, Math.floor(sx)));
    const y1 = Math.max(box.top, Math.min(box.top + box.height - 1, Math.floor(sy)));
    const x2 = Math.min(box.left + box.width - 1, x1 + 1), y2 = Math.min(box.top + box.height - 1, y1 + 1);
    const fx = Math.max(0, Math.min(1, sx - x1)), fy = Math.max(0, Math.min(1, sy - y1));
    const samples = [[x1,y1,(1-fx)*(1-fy)],[x2,y1,fx*(1-fy)],[x1,y2,(1-fx)*fy],[x2,y2,fx*fy]];
    let alpha = 0, channels = [0,0,0];
    for (const [px,py,weight] of samples) {
      const i = (py * source.width + px) * 4, a = source.data[i + 3] / 255 * weight;
      alpha += a; for (let c = 0; c < 3; c++) channels[c] += source.data[i + c] * a;
    }
    const i = ((offsetY + y) * outputSize + offsetX + x) * 4;
    out.data[i + 3] = Math.round(alpha * 255);
    if (alpha) for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(channels[c] / alpha);
  }
  return PNG.sync.write(out, { deflateLevel: 9, deflateStrategy: 3, filterType: 4 });
}

// The current atlas keeps Qwen in cell 1 and the corrected DeepSeek art in cell 6.
const atlasIndex = [5, 1, 2, 3, 4, 0, 6, 7];
await mkdir(output, { recursive: true });
let total = 0;
for (let i = 0; i < names.length; i++) {
  const cell = extractCell(atlas, (atlasIndex[i] % 2) * cellW, Math.floor(atlasIndex[i] / 2) * cellH, cellW, cellH);
  const bytes = fitSquare(cell);
  total += bytes.length;
  await writeFile(resolve(output, `${names[i]}.png`), bytes);
}
console.log(`Prepared ${names.length} RGBA portraits at ${outputSize}x${outputSize}: ${total} bytes in ${output}`);
if (total > 700 * 1024) console.warn("Portrait total exceeds the 700 KiB target.");
