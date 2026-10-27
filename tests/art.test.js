import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { get, getArtCacheStats, prepareArt } from '../backend/art.mjs';
import { NEW_EASTER_SPRITES } from '../dist/character-art.js';

test('新生成彩蛋素材可按阶段独立读取，透明且每阶段图案不同', async () => {
  const images = await prepareArt();
  assert.equal(images.size, 39);
  const contents = new Set();
  const keys = ['doubao:2', 'doubao:4', 'doubao:6', 'gemini:3', 'gemini:5', 'gemini:7',
    'qwen:4', 'kimi:6', 'grok:7', 'claude-real:8', 'yellow-doubao:2', 'yellow-doubao:5', 'qwen:7', 'kimi:9'];
  for (const key of keys) {
    const image = images.get(key);
    assert.ok(image?.length > 1000, `missing ${key}`);
    contents.add(image.toString('base64'));
    const png = PNG.sync.read(image);
    assert.equal(png.width, png.height);
    assert.ok(png.data.some((value, i) => i % 4 === 3 && value === 0));
  }
  assert.equal(contents.size, 14);
  assert.deepEqual(NEW_EASTER_SPRITES.map(([id, level, rect]) => `${id}:${level}@${rect.join(',')}`), [
    'qwen:4@0,0,512,512', 'kimi:6@512,0,512,512', 'grok:7@0,512,512,512', 'claude-real:8@512,512,512,512',
    'yellow-doubao:2@0,1024,512,512', 'yellow-doubao:5@512,1024,512,512', 'qwen:7@0,1536,512,512', 'kimi:9@512,1536,512,512',
  ]);
});

test('预处理产物覆盖39张图，运行时按key加载且缓存有界', async () => {
  const images = await prepareArt();
  assert.equal(images.size, 39);
  const first = await get('maid:1');
  assert.ok(Buffer.isBuffer(first));
  assert.deepEqual(await get('maid:1'), first);
  const stats = getArtCacheStats();
  assert.ok(stats.bytes <= stats.limit);
  assert.ok(stats.limit < 2 * 1024 * 1024);
  await assert.rejects(get('not-allowed:1'), /Unknown art key/);
});

test('缓存拒绝过期坐标指纹', async () => {
  const manifestPath = fileURLToPath(new URL('../data/art-prepared/manifest.json', import.meta.url));
  const original = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(original);
  manifest.coordinateFingerprint = 'stale';
  await writeFile(manifestPath, JSON.stringify(manifest));
  try {
    const isolated = await import('../backend/art.mjs?stale-test');
    await assert.rejects(isolated.get('maid:2'), /stale or invalid/);
  } finally {
    await writeFile(manifestPath, original);
  }
});
