const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const alive = entity => entity && (entity.hp ?? entity.health) > 0 && Number.isFinite(entity.x) && Number.isFinite(entity.y);

export function beginBossArena(g, boss, { width = 2560, height = 1600 } = {}) {
  const player = g.player || {};
  g.bossArena = {
    bossId: boss.id,
    cx: clamp(Number(player.x) || width / 2, 700, width - 700),
    cy: clamp(Number(player.y) || height / 2, 600, height - 600),
    age: 0,
    radius: 760,
    width,
    height
  };
  g.bossHazards = [];
  return g.bossArena;
}

function list(g, key) {
  const value = g[key];
  return Array.isArray(value) ? value : value ? Object.values(value) : [];
}

function constrain(entity, arena) {
  const dx = entity.x - arena.cx, dy = entity.y - arena.cy;
  const distance = Math.hypot(dx, dy);
  const limit = Math.max(0, arena.radius - (Number(entity.radius) || 0));
  if (distance > limit && distance > 0) {
    entity.x = arena.cx + dx / distance * limit;
    entity.y = arena.cy + dy / distance * limit;
  }
  const r = Math.max(0, Number(entity.radius) || 0);
  entity.x = clamp(entity.x, r, arena.width - r);
  entity.y = clamp(entity.y, r, arena.height - r);
}

export function updateBossPressure(g, dt, { hurtPlayer, spawnAdds, addHostileBullet } = {}) {
  const arena = g.bossArena;
  if (!arena) return;
  const boss = list(g, 'enemies').find(e => e?.id === arena.bossId && alive(e));
  if (g.phase !== 'playing') return;
  if (!boss) {
    g.bossArena = null;
    g.bossHazards = [];
    return;
  }
  dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
  arena.age += dt;
  arena.radius = 760 - 280 * clamp(arena.age / 20, 0, 1);
  for (const key of ['player', 'enemies', 'allies']) {
    const entities = key === 'player' ? [g.player] : list(g, key);
    for (const entity of entities) if (alive(entity)) constrain(entity, arena);
  }

  const hazards = Array.isArray(g.bossHazards) ? g.bossHazards : (g.bossHazards = []);
  const model = String(boss.modelId || boss.type || '').toLowerCase();
  if (model === 'fable' && arena.age >= (arena.nextAdds ?? 7)) {
    spawnAdds?.(2);
    arena.nextAdds = arena.age + 7;
  }
  if (model === 'astra' && arena.age >= (arena.nextVolley ?? 8)) {
    for (let i = 0; i < 8; i++) {
      const angle = Math.PI * 2 * i / 8;
      addHostileBullet?.({ x: boss.x, y: boss.y, vx: Math.cos(angle) * 180, vy: Math.sin(angle) * 180, damage: 10, radius: 7, life: 3, hostile: true, hitIds: [] });
    }
    arena.nextVolley = arena.age + 8;
  }
  if (arena.age >= (arena.nextHazard ?? 3.5)) {
    const count = arena.age >= 12 ? 3 : 1;
    const player = g.player || arena;
    const speed = Math.hypot(Number(player.vx) || 0, Number(player.vy) || 0);
    const ux = speed ? player.vx / speed : 1, uy = speed ? player.vy / speed : 0;
    const px = clamp(player.x + (speed ? ux * 110 : 0), arena.cx - arena.radius, arena.cx + arena.radius);
    const py = clamp(player.y + (speed ? uy * 110 : 0), arena.cy - arena.radius, arena.cy + arena.radius);
    for (let i = 0; i < count && hazards.length < 12; i++) {
      const offset = count === 3 ? i - 1 : 0;
      const x = clamp(px + -uy * offset * 100, arena.cx - arena.radius, arena.cx + arena.radius);
      const y = clamp(py + ux * offset * 100, arena.cy - arena.radius, arena.cy + arena.radius);
      hazards.push({ x, y, radius: 90, age: 0, windup: 1.1, duration: 0.35, damage: 18, hit: false });
    }
    arena.nextHazard = arena.age + 3.5;
  }
  for (let i = hazards.length - 1; i >= 0; i--) {
    const zone = hazards[i];
    zone.age += dt;
    if (!zone.hit && zone.age >= zone.windup) {
      zone.hit = true;
      const player = g.player;
      if (alive(player) && Math.hypot(player.x - zone.x, player.y - zone.y) <= zone.radius + (Number(player.radius) || 0)) hurtPlayer?.(zone.damage);
    }
    if (zone.age >= zone.windup + zone.duration) hazards.splice(i, 1);
  }
}
