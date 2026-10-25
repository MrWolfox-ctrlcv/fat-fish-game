import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildArt, ART_VERSION } from '../backend/art-source.mjs';

const outputDir = fileURLToPath(new URL('../data/art-prepared/', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const built = await buildArt();
await mkdir(outputDir, { recursive: true });
const entries = {};
let totalBytes = 0;
let index = 0;
for (const [key, bytes] of built.images) {
  const file = `${String(++index).padStart(2, '0')}.png`;
  await writeFile(new URL(`../data/art-prepared/${file}`, import.meta.url), bytes);
  entries[key] = { file, size: bytes.length, sha256: hash(bytes) };
  totalBytes += bytes.length;
}
const manifest = {
  version: ART_VERSION,
  keys: [...built.images.keys()],
  coordinateFingerprint: built.coordinateFingerprint,
  sources: built.sourceHashes,
  entries,
  totalBytes,
};
await writeFile(new URL('../data/art-prepared/manifest.json', import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`);
const sourceBytes = Object.values(built.sourceHashes).reduce((sum, item) => sum + item.size, 0);
const ratio = sourceBytes ? ((1 - totalBytes / sourceBytes) * 100).toFixed(1) : '0.0';
console.log(`Prepared ${index} art PNGs (${totalBytes.toLocaleString()} bytes); source atlases ${sourceBytes.toLocaleString()} bytes; image payload reduction ${ratio}%.`);
