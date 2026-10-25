import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../backend/app.mjs';
import { GameStore } from '../backend/store.mjs';

test('bumper publishes only public shell and modules, sharing the existing game service', async () => {
  const store = new GameStore(':memory:');
  const { server } = await createGameServer({ store });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const redirect = await fetch(`${base}/games/bumper`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/games/bumper/');
    const page = await fetch(`${base}/games/bumper/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /wardrobe-dialog/);
    for (const name of ['src/wardrobe.js', 'src/companion-scene.js', 'src/modes/bumper.js', 'wardrobe.css']) {
      assert.equal((await fetch(`${base}/games/bumper/${name}`)).status, 200);
    }
    for (const name of ['server.mjs', '.env', 'backend/companion.mjs', 'assets/maids.png', 'data/game.sqlite']) {
      assert.equal((await fetch(`${base}/games/bumper/${name}`)).status, 404);
    }
  } finally { await new Promise((resolve) => server.close(resolve)); store.close(); }
});
