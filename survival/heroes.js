// Prototype-only playable archetypes. Astra can be constructed for local UI previews;
// unlocking it is a separate achievement decision owned by the app.
export const HEROES = Object.freeze({
  deepseek: {
    id: 'deepseek', name: 'DeepSeek', faction: 'cn', itemKey: 'rice', itemName: '米饭', itemIcon: '🍚', itemDescription: '手动食用恢复生命并积累肥胖经验；也可能被自动偷吃。',
    skillName: '肉蛋冲击', stats: { health: 140, speed: 135, damage: 18, fireRate: 0.85, chargeDamage: 55 },
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
