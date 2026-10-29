// Prototype-only playable archetypes. Astra can be constructed for local UI previews;
// unlocking it is a separate achievement decision owned by the app.
export const HEROES = Object.freeze({
  deepseek: {
    id: 'deepseek', name: 'DeepSeek', faction: 'cn', itemKey: 'rice', itemName: '米饭', itemIcon: '🍚', itemDescription: '手动食用恢复生命并积累肥胖经验；也可能被自动偷吃。',
    skillName: '肉蛋冲击', stats: { health: 140, speed: 135, damage: 18, fireRate: 0.85, chargeDamage: 55 },
  },
  doubao: {
    id: 'doubao', name: '豆包', faction: 'cn', itemKey: 'doubaoSnack', itemName: '豆包点心', itemIcon: '🥟', itemDescription: '恢复 25 点生命。',
    skillName: '护盾弹开', skillCooldown: 8, shieldDuration: 3, shieldCharges: 2, pushRadius: 180, pushDistance: 180,
    stats: { health: 120, speed: 140, damage: 12, fireRate: .8, chargeDamage: 0 },
  },
  qwen: {
    id: 'qwen', name: 'Qwen', faction: 'cn', itemKey: 'computeCell', itemName: '算力电池', itemIcon: '🔋', itemDescription: '恢复 40 点算力，最多 100。',
    skillName: '召唤小兵', secondarySkillName: '召唤 Qwen Max', computeMax: 100, computeRegen: 6, smallCost: 12, maxCost: 60,
    stats: { health: 125, speed: 135, damage: 16, fireRate: .9, chargeDamage: 0 },
  },
  kimi: {
    id: 'kimi', name: 'Kimi', faction: 'cn', itemKey: 'kimiLens', itemName: '聚焦镜片', itemIcon: '🔭', itemDescription: '立即重置聚焦光束冷却。',
    skillName: '聚焦光束', skillCooldown: 8,
    stats: { health: 80, speed: 95, damage: 58, fireRate: 1.7, piercing: 3, chargeDamage: 0 },
  },
  gemini: {
    id: 'gemini', name: 'Gemini', nickname: '故障机器猫', faction: 'us', itemKey: 'chromeOrb', itemName: 'Chrome 能量球', itemIcon: '🔮', itemDescription: '启用 8 秒护盾，可抵挡 3 次命中。',
    skillName: '闪现', skillCooldown: 4, stats: { health: 105, speed: 165, damage: 14, fireRate: 0.55, chargeDamage: 0 },
  },
  gpt: {
    id: 'gpt', name: '降智 GPT', faction: 'us', itemKey: 'resetScroll', itemName: '重置卷轴', itemIcon: '📜', itemDescription: '将能量补满，不恢复生命。',
    skillName: '切换形态 / 工具调用', stats: { health: 90, speed: 110, damage: 6, fireRate: 1.1, chargeDamage: 0 },
  },
  astra: {
    id: 'astra', name: 'GPT Astra', faction: 'us', itemKey: 'astraCore', itemName: '超新星核心', itemIcon: '🌟', itemDescription: '立即重置星爆冷却。',
    skillName: '星爆', skillCooldown: 7, stats: { health: 220, speed: 115, damage: 45, fireRate: 0.4, chargeDamage: 300 },
  },
});
