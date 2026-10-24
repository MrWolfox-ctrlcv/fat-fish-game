export const STAGE_VARIANTS = Object.freeze({
  1: "gpt-silly",
  2: "gpt-silly",
  3: "gpt-silly",
  4: "gpt-normal",
  5: "deepseek-claude",
  6: "gpt-normal",
  7: "deepseek-claude",
  8: "super-whale",
  9: "super-whale",
  10: "super-whale",
  11: "super-whale",
});

const ASTRA_LEVELS = Object.freeze([9, 10, 11]);
const EXTRA_STAGES = Object.freeze({ 2: 'doubao', 3: 'gemini', 4: 'doubao', 5: 'gemini', 6: 'doubao', 7: 'gemini' });

export const EASTER_EGGS = Object.freeze([
  Object.freeze({ id: "gpt-silly", name: "降智版 GPT", description: "脑袋放空，先滚再说。", previewLevel: 3 }),
  Object.freeze({ id: "gpt-normal", name: "正常 GPT", description: "这次终于开始认真思考了。", previewLevel: 6 }),
  Object.freeze({ id: "deepseek-claude", name: "伪装成 Claude 的 DeepSeek", description: "衣服借到了，鲸尾还没藏好。", previewLevel: 7 }),
  Object.freeze({ id: "super-whale", name: "超级大肥鱼", description: "鱼缸：你先别再长了。", previewLevel: 11 }),
  Object.freeze({ id: "gpt-astra", name: "满血 Astra", description: "思路在线，星图展开。", previewLevel: 10 }),
  Object.freeze({ id: 'doubao', name: '迷糊豆包', description: '脑袋放空，先眨眨眼再说。', previewLevel: 4 }),
  Object.freeze({ id: 'gemini', name: '莽撞 Gemini', description: '懂了！先冲，回头再想。', previewLevel: 5 }),
]);

const eggIds = new Set(EASTER_EGGS.map((egg) => egg.id));

export function isEasterEggId(id) {
  return eggIds.has(id);
}

export function getEasterEgg(id) {
  return EASTER_EGGS.find((egg) => egg.id === id) ?? null;
}

// Normal variants are bound to the exact stage; Astra is an additional merge-only look.
export function getAllowedVariants(level) {
  const allowed = STAGE_VARIANTS[level] ? [STAGE_VARIANTS[level]] : [];
  if (EXTRA_STAGES[level]) allowed.push(EXTRA_STAGES[level]);
  if (ASTRA_LEVELS.includes(level)) allowed.push("gpt-astra");
  return allowed;
}

export function getEasterImageKey(id, level) {
  return getAllowedVariants(level).includes(id) ? `${id}:${level}` : null;
}

// Low, middle, and high stages use deliberately restrained total encounter rates.
export function rollEasterVariant(level, random = Math.random, source = "spawn") {
  if (source === "merge" && ASTRA_LEVELS.includes(level) && random() < 0.02) return "gpt-astra";
  if (level === 11) return "super-whale";

  const chance = level <= 3 ? 0.03 : level <= 7 ? 0.04 : level <= 10 ? 0.03 : 0;
  const roll = random();
  if (chance === 0 || roll >= chance) return null;
  if (EXTRA_STAGES[level] && roll >= chance / 2) return EXTRA_STAGES[level];
  return STAGE_VARIANTS[level] ?? null;
}

export const EASTER_STAGE_COUNT = Array.from({ length: 11 }, (_, index) => getAllowedVariants(index + 1).length).reduce((sum, count) => sum + count, 0);
