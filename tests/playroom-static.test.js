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
    const hallRedirect = await fetch(`${base}/games`, { redirect: 'manual' });
    assert.equal(hallRedirect.status, 302);
    assert.equal(hallRedirect.headers.get('location'), '/games/');
    const hall = await fetch(`${base}/games/`);
    assert.equal(hall.status, 200);
    assert.match(await hall.text(), /href="\/games\/bumper\/#room-card"/);
    assert.equal((await fetch(`${base}/games/fat-fish/games-hub.css`)).status, 200);
    for (const id of ['deepseek', 'gptNormal', 'claude', 'gemini', 'doubao', 'qwen', 'kimi', 'grok']) {
      const portrait = await fetch(`${base}/games/bumper/portraits/${id}.png`);
      assert.equal(portrait.status, 200);
      assert.equal(portrait.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await portrait.arrayBuffer()).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    assert.equal((await fetch(`${base}/games/bumper/private/arena-portraits-atlas.png`)).status, 404);
    assert.equal((await fetch(`${base}/games/bumper/portraits/unknown.png`)).status, 404);
    const redirect = await fetch(`${base}/games/bumper`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/games/bumper/');
    const page = await fetch(`${base}/games/bumper/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /wardrobe-dialog/);
    assert.match(html, /id="companion-popover"/);
    assert.match(html, /src="\/games\/fat-fish\/companion-portrait\.png"/);
    assert.equal([...html.matchAll(/data-companion-output/g)].length, 1, 'the live companion output has one node');
    assert.match(html, /data-companion-squeak/);
    for (const name of ['companion-corner.css', 'src/floating-drag.js', 'src/wardrobe.js', 'src/companion-scene.js', 'src/companion-corner.js', 'src/modes/bumper.js', 'wardrobe.css']) {
      assert.equal((await fetch(`${base}/games/bumper/${name}`)).status, 200);
    }
    for (const name of ['server.mjs', '.env', 'backend/companion.mjs', 'assets/maids.png', 'data/game.sqlite']) {
      assert.equal((await fetch(`${base}/games/bumper/${name}`)).status, 404);
    }
    const fishPage = await fetch(`${base}/games/fat-fish/`);
    assert.equal(fishPage.status, 200);
    const fishHtml = await fishPage.text();
    assert.match(fishHtml, /id="companion-popover"/);
    assert.match(fishHtml, /src="\/games\/fat-fish\/companion-portrait\.png"/);
    assert.equal([...fishHtml.matchAll(/data-companion-output/g)].length, 1, 'the merge game uses the same single output bubble');
    const fishScript = await fetch(`${base}/games/fat-fish/game.js`);
    assert.match(await fishScript.text(), /from ['"]\.\/companion-corner\.js['"]/);
    for (const name of ['companion-corner.js', 'floating-drag.js', 'companion-corner.css']) {
      assert.equal((await fetch(`${base}/games/fat-fish/${name}`)).status, 200);
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
