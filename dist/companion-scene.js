import { getEasterImageKey } from './easter-eggs.js';

// Sample only when an event/chat needs it: never stream frames to the model.
export function fatFishSnapshot(game) {
  const settled = game.bodies.filter((body) => body.age > 1.1);
  const top = settled.length ? Math.min(...settled.map((body) => body.y - body.r)) : game.height;
  return {
    score: game.score, level: Math.max(1, ...game.unlocked), elapsed: Math.floor(game.stepIndex / 60),
    scene: {
      balls: [...game.bodies].sort((a, b) => a.y - b.y).slice(0, 12).map((body) => ({
        level: body.level, x: Math.round(body.x), y: Math.round(body.y), variant: body.variant || null,
      })),
      ball_count: game.bodies.length,
      stack_height: Math.round(Math.max(0, game.height - top)),
      danger: settled.some((body) => body.dangerTime > 0),
      highest_level: Math.max(1, ...game.unlocked),
    },
  };
}

export function createFishDiscoveryTracker() {
  let owner = null;
  let levels = new Set([1]);
  let stages = new Set();
  return {
    sync(profile, nextOwner = null) {
      if (owner !== nextOwner) { owner = nextOwner; levels = new Set([1]); stages = new Set(); }
      for (const level of profile?.unlocked || []) if (Number.isInteger(level)) levels.add(level);
      for (const stage of profile?.egg_stages || []) if (typeof stage === 'string') stages.add(stage);
    },
    observe(game) {
      const events = [];
      for (const level of game.unlocked) if (!levels.has(level)) {
        levels.add(level); events.push({ type: 'new_level', detail: { level } });
      }
      for (const key of game.seenEggStages) if (!stages.has(key)) {
        const [variant, rawLevel] = key.split(':');
        const level = Number(rawLevel);
        if (!getEasterImageKey(variant, level)) continue;
        stages.add(key); events.push({ type: 'new_easter', detail: { level, variant } });
      }
      return events;
    },
  };
}
