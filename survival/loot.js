export const RARITIES = Object.freeze([
  { id: 'common', label: '普通', color: '#cbd5e1', multiplier: 1 },
  { id: 'rare', label: '稀有', color: '#38bdf8', multiplier: 1.3 },
  { id: 'epic', label: '史诗', color: '#c084fc', multiplier: 1.65 },
  { id: 'legendary', label: '传说', color: '#fbbf24', multiplier: 2.1 },
]);

const BASE = [0.70, 0.23, 0.06, 0.01];
const LUCKY = [0.35, 0.35, 0.23, 0.07];

export function rarityWeights(luck = 0) {
  const t = Math.max(0, Math.min(100, Number.isFinite(luck) ? luck : 0)) / 100;
  return BASE.map((weight, i) => weight + (LUCKY[i] - weight) * t);
}

export function rollRarity(random01, luck = 0) {
  const value = Math.max(0, Math.min(1 - Number.EPSILON, Number.isFinite(random01) ? random01 : 0));
  const weights = rarityWeights(luck);
  let edge = 0;
  for (let i = 0; i < weights.length; i++) {
    edge += weights[i];
    if (value < edge) return RARITIES[i];
  }
  return RARITIES.at(-1);
}
