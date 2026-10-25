import { getArtRects } from './art-map.mjs';
import { getEasterEgg } from '../dist/easter-eggs.js';

const STARTER_ID = 'maid:1';

function wardrobeError(status, message) {
  return Object.assign(new Error(message), { status });
}

function buildCatalog() {
  return [...getArtRects().keys()].map((id) => {
    const separator = id.lastIndexOf(':');
    const variant = id.slice(0, separator);
    const level = Number(id.slice(separator + 1));
    const egg = getEasterEgg(variant);
    return {
      id,
      name: egg?.name ?? `女仆鲸鱼 ${level}`,
      level,
      variant: egg ? variant : null,
      source: id === STARTER_ID ? 'starter' : 'merge',
    };
  });
}

export function createWardrobe({ store }) {
  if (!store?.db || typeof store.profile !== 'function') throw new TypeError('A GameStore is required');
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS equipped_skins (
    user_id INTEGER PRIMARY KEY, skin_id TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`);
  const catalog = buildCatalog();
  const byId = new Map(catalog.map((skin) => [skin.id, skin]));

  const ownedIds = (userId) => {
    const profile = store.profile(userId);
    const levels = new Set(Array.isArray(profile.unlocked) ? profile.unlocked.filter(Number.isSafeInteger) : []);
    const seenEggs = new Set(Array.isArray(profile.egg_stages) ? profile.egg_stages.filter((key) => typeof key === 'string') : []);
    return new Set(catalog.filter((skin) => skin.id === STARTER_ID || (skin.variant === null
      ? levels.has(skin.level)
      : seenEggs.has(skin.id))).map((skin) => skin.id));
  };

  function get(userId) {
    const owned = ownedIds(userId);
    const saved = db.prepare('SELECT skin_id FROM equipped_skins WHERE user_id=?').get(userId)?.skin_id;
    const equipped = saved && owned.has(saved) ? saved : STARTER_ID;
    return {
      catalog: catalog.map(({ id, name, level, variant, source }) => ({
        id, name, level, variant, source, unlocked: owned.has(id),
      })),
      equipped,
      unlocked_count: owned.size,
      total: catalog.length,
      purchases_enabled: false,
    };
  }

  function equip(userId, skinId) {
    const skin = byId.get(skinId);
    if (!skin) throw wardrobeError(400, '未知的衣柜外观。');
    if (!ownedIds(userId).has(skinId)) throw wardrobeError(403, '合成大肥鱼中解锁后即可使用。');
    const updatedAt = Date.now();
    db.prepare(`INSERT INTO equipped_skins(user_id,skin_id,updated_at) VALUES(?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET skin_id=excluded.skin_id,updated_at=excluded.updated_at`)
      .run(userId, skinId, updatedAt);
    return { equipped: skinId };
  }

  return { get, equip };
}
