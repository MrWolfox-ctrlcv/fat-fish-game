import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore } from '../backend/store.mjs';
import { createWardrobe } from '../backend/wardrobe.mjs';

function withStore(run) {
  const store = new GameStore(':memory:');
  try { run(store); } finally { store.close(); }
}

test('catalogue contains the 39 actual art keys; only starter is initially unlocked', () => withStore((store) => {
  const wardrobe = createWardrobe({ store });
  const result = wardrobe.get(1);
  assert.equal(result.total, 39);
  assert.equal(result.catalog.length, 39);
  assert.equal(result.catalog.filter((skin) => skin.unlocked).length, 1);
  assert.equal(result.catalog.find((skin) => skin.id === 'maid:1').source, 'starter');
  assert.equal(result.catalog.every((skin) => skin.id === 'maid:1' || skin.source === 'merge'), true);
  assert.equal(result.equipped, 'maid:1');
  assert.equal(result.purchases_enabled, false);
  assert.equal(result.catalog.every((skin) => !('url' in skin) && !('image_url' in skin)), true);
}));

test('stage variant access requires the exact earned stage key', () => withStore((store) => {
  store.saveProgress(1, { score: 50, unlocked: [1, 4, 6], egg_stages: ['gpt-normal:4'] });
  const skins = createWardrobe({ store }).get(1).catalog;
  assert.equal(skins.find((skin) => skin.id === 'gpt-normal:4').unlocked, true);
  assert.equal(skins.find((skin) => skin.id === 'gpt-normal:6').unlocked, false);
  assert.equal(skins.find((skin) => skin.id === 'gpt-silly:4'), undefined);
}));

test('client-supplied unlock claims are ignored; unknown and unowned skins are rejected', () => withStore((store) => {
  const wardrobe = createWardrobe({ store });
  assert.equal(wardrobe.get(1, { unlocked: ['gpt-normal:4'] }).catalog.find((skin) => skin.id === 'gpt-normal:4').unlocked, false);
  assert.throws(() => wardrobe.equip(1, 'gpt-normal:4'), { status: 403 });
  assert.throws(() => wardrobe.equip(1, 'not-a-skin'), { status: 400 });
}));

test('equip is idempotent, persists across store restarts, and remains account isolated', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fatfish-wardrobe-'));
  const filename = join(directory, 'game.sqlite');
  try {
    let store = new GameStore(filename);
    store.saveProgress(10, { score: 10, unlocked: [1, 4], egg_stages: ['gpt-normal:4'] });
    store.saveProgress(11, { score: 10, unlocked: [1], egg_stages: [] });
    let wardrobe = createWardrobe({ store });
    assert.deepEqual(wardrobe.equip(10, 'gpt-normal:4'), { equipped: 'gpt-normal:4' });
    assert.deepEqual(wardrobe.equip(10, 'gpt-normal:4'), { equipped: 'gpt-normal:4' });
    assert.equal(wardrobe.get(11).equipped, 'maid:1');
    store.close();

    store = new GameStore(filename);
    wardrobe = createWardrobe({ store });
    assert.equal(wardrobe.get(10).equipped, 'gpt-normal:4');
    assert.equal(wardrobe.get(11).equipped, 'maid:1');
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('stale saved selection falls back without writing on GET and legacy gameprogress remains intact', () => withStore((store) => {
  store.db.exec('CREATE TABLE gameprogress(id INTEGER PRIMARY KEY, value TEXT)');
  store.db.prepare('INSERT INTO gameprogress(id,value) VALUES(1,?)').run('untouched');
  store.db.exec('CREATE TABLE equipped_skins(user_id INTEGER PRIMARY KEY, skin_id TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  store.db.prepare('INSERT INTO equipped_skins(user_id,skin_id,updated_at) VALUES(?,?,?)').run(5, 'maid:7', 100);
  const wardrobe = createWardrobe({ store });
  assert.equal(wardrobe.get(5).equipped, 'maid:1');
  assert.equal(store.db.prepare('SELECT skin_id,updated_at FROM equipped_skins WHERE user_id=5').get().skin_id, 'maid:7');
  const legacy = store.db.prepare('SELECT * FROM gameprogress').get();
  assert.equal(legacy.id, 1);
  assert.equal(legacy.value, 'untouched');
}));
