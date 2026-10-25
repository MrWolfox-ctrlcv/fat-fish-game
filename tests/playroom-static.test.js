import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
    for (const name of ['src/wardrobe.js', 'src/companion-scene.js', 'src/companion-corner.js', 'src/modes/bumper.js', 'wardrobe.css']) {
      assert.equal((await fetch(`${base}/games/bumper/${name}`)).status, 200);
    }
    for (const name of ['server.mjs', '.env', 'backend/companion.mjs', 'assets/maids.png', 'data/game.sqlite']) {
      assert.equal((await fetch(`${base}/games/bumper/${name}`)).status, 404);
    }
  } finally { await new Promise((resolve) => server.close(resolve)); store.close(); }
});

test('only the shared square companion cutout is public; original artwork stays private', async () => {
  const store = new GameStore(':memory:');
  const { server } = await createGameServer({ store });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/games/bumper/`);
    assert.match(await page.text(), /src="\/games\/fat-fish\/companion-portrait\.png"/);
    const portrait = await fetch(`${base}/games/fat-fish/companion-portrait.png`, { headers: { 'Accept-Encoding': 'br, gzip' } });
    assert.equal(portrait.status, 200);
    assert.equal(portrait.headers.get('content-type'), 'image/png');
    assert.equal(portrait.headers.get('content-encoding'), null);
    assert.equal(portrait.headers.get('cache-control'), 'public, no-cache');
    const expected = await readFile(fileURLToPath(new URL('../dist/companion-portrait.png', import.meta.url)));
    assert.deepEqual(Buffer.from(await portrait.arrayBuffer()), expected);
    const conditional = await fetch(`${base}/games/fat-fish/companion-portrait.png`, { headers: { 'If-None-Match': portrait.headers.get('etag') } });
    assert.equal(conditional.status, 304);
    assert.equal((await fetch(`${base}/games/fat-fish/maid-1.png`)).status, 404);
    assert.equal((await fetch(`${base}/games/fat-fish/assets/maids.png`)).status, 404);
    assert.equal((await fetch(`${base}/games/bumper/assets/maids.png`)).status, 404);
    assert.equal((await fetch(`${base}/games/fat-fish/api/sprites?level=6`)).status, 401);
  } finally { await new Promise((resolve) => server.close(resolve)); store.close(); }
});
