export const ARENA_SNAPSHOT_BUFFER_SIZE = 8;
export const ARENA_REMOTE_INTERPOLATION_DELAY = 0.1;
export const ARENA_MAX_EXTRAPOLATION = 0.08;

const TAU = Math.PI * 2;
const angleDelta = (from, to) => ((to - from + Math.PI) % TAU + TAU) % TAU - Math.PI;

export function pushArenaSnapshot(buffer, snapshot, receivedAt = 0, limit = ARENA_SNAPSHOT_BUFFER_SIZE) {
  if (!Array.isArray(buffer) || !snapshot || !Number.isFinite(snapshot.time)) return buffer;
  const last = buffer.at(-1);
  if (last && snapshot.time <= last.snapshot.time) {
    if (snapshot.time === last.snapshot.time) buffer[buffer.length - 1] = { snapshot, receivedAt };
    return buffer;
  }
  buffer.push({ snapshot, receivedAt });
  if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
  return buffer;
}

function canInterpolate(a, b, dt, maxDistance) {
  if (a.alive !== b.alive || a.respawn > 0 !== (b.respawn > 0)) return false;
  return Math.hypot(b.x - a.x, b.y - a.y) <= Math.max(maxDistance, Math.hypot(a.vx, a.vy) * dt + 60);
}

function interpolateFighter(before, after, alpha, dt, maxDistance) {
  if (!before) return { ...after };
  if (!after || !canInterpolate(before, after, dt, maxDistance)) return { ...after };
  const lerp = (a, b) => a + (b - a) * alpha;
  return {
    ...after,
    x: lerp(before.x, after.x), y: lerp(before.y, after.y),
    vx: lerp(before.vx, after.vx), vy: lerp(before.vy, after.vy),
    facing: before.facing + angleDelta(before.facing, after.facing) * alpha,
  };
}

export function sampleArenaSnapshots(buffer, targetTime, {
  maxExtrapolation = ARENA_MAX_EXTRAPOLATION,
  teleportDistance = 180,
} = {}) {
  if (!Array.isArray(buffer) || !buffer.length) return null;
  if (targetTime <= buffer[0].snapshot.time) return buffer[0].snapshot;
  let left = buffer[0];
  let right = null;
  for (const entry of buffer) {
    if (entry.snapshot.time <= targetTime) left = entry;
    if (entry.snapshot.time >= targetTime) { right = entry; break; }
  }

  if (right && right !== left) {
    const dt = right.snapshot.time - left.snapshot.time;
    const alpha = dt > 0 ? Math.max(0, Math.min(1, (targetTime - left.snapshot.time) / dt)) : 1;
    const beforeById = new Map(left.snapshot.fighters.map((fighter) => [fighter.id, fighter]));
    return {
      ...right.snapshot,
      fighters: right.snapshot.fighters.map((fighter) => interpolateFighter(beforeById.get(fighter.id), fighter, alpha, dt, teleportDistance)),
    };
  }

  const latest = buffer.at(-1).snapshot;
  const ahead = Math.max(0, Math.min(maxExtrapolation, targetTime - latest.time));
  if (!ahead || latest !== left.snapshot) return latest;
  const prior = buffer.length > 1 ? buffer.at(-2).snapshot : null;
  const priorById = new Map((prior?.fighters || []).map((fighter) => [fighter.id, fighter]));
  return {
    ...latest,
    fighters: latest.fighters.map((fighter) => {
      const previous = priorById.get(fighter.id);
      if (!previous || !canInterpolate(previous, fighter, latest.time - prior.time, teleportDistance)) return { ...fighter };
      return { ...fighter, x: fighter.x + fighter.vx * ahead, y: fighter.y + fighter.vy * ahead };
    }),
  };
}
