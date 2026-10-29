/** Local effect definitions for explicit, backend-charged shop actions. */
export const SHOP_ITEMS = Object.freeze({
  medkit: Object.freeze({ id: 'medkit', name: '深海医疗包', icon: '🩹', description: '恢复最大生命值的 40%。', priceQuota: 5000, priceUsd: 0.01 }),
  supplies: Object.freeze({ id: 'supplies', name: '补给箱', icon: '📦', description: '获得当前角色道具 2 个；背包数量须不超过 7 个。', priceQuota: 5000, priceUsd: 0.01 }),
  pulse: Object.freeze({ id: 'pulse', name: '深海脉冲', icon: '💥', description: '对 420 范围内敌人造成 120 点伤害（首领 60 点），并击退 120。', priceQuota: 5000, priceUsd: 0.01 }),
  magnet: Object.freeze({ id: 'magnet', name: '经验磁场', icon: '🧲', description: '立即吸取场上已有的全部经验米粒。', priceQuota: 5000, priceUsd: 0.01 }),
});
