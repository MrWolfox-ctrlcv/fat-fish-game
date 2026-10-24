import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { prepareArt } from '../backend/art.mjs';

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
