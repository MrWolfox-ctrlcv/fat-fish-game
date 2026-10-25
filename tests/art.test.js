import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { get, getArtCacheStats, prepareArt } from '../backend/art.mjs';

test('六张新生成彩蛋素材可独立读取，透明且每阶段图案不同', async () => {
  const images = await prepareArt();
  assert.equal(images.size, 31);
  const contents = new Set();
  for (const [id, levels] of [['doubao', [2, 4, 6]], ['gemini', [3, 5, 7]]]) {
    for (const level of levels) {
      const image = images.get(`${id}:${level}`);
      assert.ok(image?.length > 1000);
      contents.add(image.toString('base64'));
      const png = PNG.sync.read(image);
      assert.equal(png.width, png.height);
      assert.ok(png.data.some((value, i) => i % 4 === 3 && value === 0));
    }
  }
  assert.equal(contents.size, 6);
});

test('预处理产物覆盖31张图，运行时按key加载且缓存有界', async () => {
  const images = await prepareArt();
  assert.equal(images.size, 31);
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
