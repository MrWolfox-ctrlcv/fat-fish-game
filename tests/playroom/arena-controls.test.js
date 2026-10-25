import test from 'node:test';
import assert from 'node:assert/strict';
import { createArenaControls } from '../../playroom/src/arena-controls.js';

test('two touch pointers move and aim independently; only releasing aim can dash', () => {
  const controls = createArenaControls();
  assert.equal(controls.begin(11, 50, 200, 400), 'move');
  assert.equal(controls.begin(22, 300, 200, 400), 'aim');
  assert.equal(controls.begin(33, 80, 200, 400), null);
  controls.move(11, 104, 200); controls.move(22, 300, 146);
  const input = controls.input({ x: 640, y: 450 });
  assert.equal(input.moveX, 1); assert.equal(input.moveY, 0);
  assert.equal(input.aimX, 640); assert.equal(input.aimY, 250);
  assert.equal(controls.end(22), true);
  assert.equal(controls.input({ x: 650, y: 450 }).moveX, 1);
  assert.equal(controls.end(11), false);
  assert.equal(controls.input().moveX, 0);
});

test('cancelled touches and taps do not trigger attacks; clearing input releases both fingers', () => {
  const controls = createArenaControls();
  controls.begin(1, 300, 200, 400); controls.move(1, 320, 200);
  assert.equal(controls.end(1, true), false);
  controls.begin(2, 300, 200, 400); controls.move(2, 303, 202);
  assert.equal(controls.end(2), false);
  controls.begin(3, 40, 100, 400); controls.begin(4, 300, 100, 400);
  controls.clear(true);
  assert.equal(controls.sticks().length, 0);
  assert.equal(controls.input().aimX, undefined);
});

test('mouse aim does not follow movement, and sticks keep the same strength across arena resolutions', () => {
  const controls = createArenaControls();
  controls.setMouseAim({ x: 900, y: 400 });
  controls.begin(1, 50, 100, 1200); controls.move(1, 50, 154);
  assert.deepEqual(controls.input({ x: 200, y: 200 }), { moveX: 0, moveY: 1, aimX: 900, aimY: 400 });
  assert.deepEqual(controls.input({ x: 300, y: 300 }), { moveX: 0, moveY: 1, aimX: 900, aimY: 400 });
});
