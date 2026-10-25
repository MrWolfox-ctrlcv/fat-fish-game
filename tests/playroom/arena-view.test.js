import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaViewport, worldPoint } from '../../playroom/src/arena-view.js';

test('portrait, landscape and desktop keep the whole arena visible without stretching', () => {
  for (const [width, height] of [[390, 520], [844, 250], [1250, 520], [1920, 900]]) {
    const view = arenaViewport(width, height);
    assert.ok(view.x <= 250 && view.x + view.width >= 1030);
    assert.ok(view.y <= 60 && view.y + view.height >= 840);
    assert.ok(Math.abs(width / view.width - height / view.height) < 1e-10);
    const point = worldPoint(10 + width / 2, 25 + height / 2, { left: 10, top: 25, width, height }, view);
    assert.equal(point.x, 640); assert.equal(point.y, 450);
    const expectedX = 640 + 130;
    const screenX = 10 + (expectedX - view.x) * width / view.width;
    assert.ok(Math.abs(worldPoint(screenX, 25 + height / 2, { left: 10, top: 25, width, height }, view).x - expectedX) < 1e-8);
  }
});
