import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getArtRects } from './art-map.mjs';

const ART_VERSION = 1;

const preparedDir = new URL('../data/art-prepared/', import.meta.url);
const manifestUrl = new URL('manifest.json', preparedDir);
const expectedKeys = [...getArtRects().keys()];
const keyIndex = new Map(expectedKeys.map((key, index) => [key, index]));
const cache = new Map();
const CACHE_LIMIT = 1536 * 1024;
const isProductionEntry = process.argv[1] === fileURLToPath(new URL('../production.mjs', import.meta.url));
let cachedBytes = 0;
let manifestPromise;
let fallbackPromise;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function loadManifest() {
  if (!manifestPromise) manifestPromise = (async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
    if (manifest.version !== ART_VERSION || manifest.keys?.length !== expectedKeys.length ||
        expectedKeys.some((key, i) => manifest.keys[i] !== key) ||
        typeof manifest.coordinateFingerprint !== 'string' ||
        manifest.coordinateFingerprint !== createHash('sha256').update(JSON.stringify({ version: ART_VERSION, rects: [...getArtRects()] })).digest('hex')) {
      throw new Error('Prepared art cache is stale or invalid; run npm run prepare:art.');
    }
    return manifest;
  })().catch((error) => { manifestPromise = undefined; throw error; });
  return manifestPromise;
}

async function fallbackArt() {
  if (process.env.NODE_ENV === 'production' || isProductionEntry) throw new Error('Prepared art cache is required in production; run npm run prepare:art.');
  if (!fallbackPromise) fallbackPromise = import('./art-source.mjs').then((mod) => mod.buildArt()).then((built) => built.images);
  return fallbackPromise;
}

export async function get(key) {
  if (!keyIndex.has(key)) throw new Error(`Unknown art key: ${key}`);
  if (cache.has(key)) return cache.get(key);
  let manifest;
  try { manifest = await loadManifest(); }
  catch (error) {
    if (error.code === 'ENOENT') return (await fallbackArt()).get(key);
    throw error;
  }
  const entry = manifest.entries?.[key];
  const fileName = `${String(keyIndex.get(key) + 1).padStart(2, '0')}.png`;
  if (!entry || entry.file !== fileName || !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > CACHE_LIMIT || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw new Error(`Prepared art entry is invalid for ${key}; run npm run prepare:art.`);
  }
  const bytes = await readFile(new URL(fileName, preparedDir));
  if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) throw new Error(`Prepared art file failed integrity check: ${key}`);
  if (bytes.length <= CACHE_LIMIT) {
    while (cachedBytes + bytes.length > CACHE_LIMIT && cache.size) {
      const oldest = cache.keys().next().value;
      cachedBytes -= cache.get(oldest).length;
      cache.delete(oldest);
    }
    if (!cache.has(key)) { cache.set(key, bytes); cachedBytes += bytes.length; }
  }
  return bytes;
}

// Kept for legacy callers and source-based tests. Production code should use get().
export async function prepareArt() {
  const { buildArt } = await import('./art-source.mjs');
  return (await buildArt()).images;
}

export function getArtCacheStats() { return { entries: cache.size, bytes: cachedBytes, limit: CACHE_LIMIT }; }
export async function validatePreparedArt() { await loadManifest(); }
