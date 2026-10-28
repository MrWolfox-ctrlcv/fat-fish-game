// The names here are fictional opponents in this game, not model evaluations.
const cnOpponents = {
  chaser: { modelId: 'gptSilly', name: 'GPT降智版', tier: 1, portrait: 'gptSilly', color: '#8794b8' },
  dash: { modelId: 'geminiFlashLite', name: 'Gemini Flash Lite', tier: 2, portrait: 'gemini', color: '#42c7d8' },
  ranged: { modelId: 'claude', name: 'Claude Sonnet', tier: 3, portrait: 'claude', color: '#d98554' },
  elite: { modelId: 'gptNormal', name: '正常GPT', tier: 4, portrait: 'gptNormal', color: '#8773d7' },
  boss: { modelId: 'astra', name: 'GPT Astra', tier: 5, portrait: 'astra', color: '#f0bf55' },
};
const usOpponents = {
  chaser: { modelId: 'doubao', name: '豆包轻量版', tier: 1, portrait: 'doubao', color: '#e5a36b' },
  dash: { modelId: 'qwen', name: 'Qwen 快速版', tier: 2, portrait: 'qwen', color: '#6cc990' },
  ranged: { modelId: 'kimi', name: 'Kimi 推理版', tier: 3, portrait: 'kimi', color: '#6688db' },
  elite: { modelId: 'deepseek', name: 'DeepSeek 常规版', tier: 4, portrait: 'deepseek', color: '#438ed0' },
  boss: { modelId: 'deepseekFull', name: 'DeepSeek 满血版', tier: 5, portrait: 'deepseekFull', color: '#245ac3' },
};

export const ENEMY_ROSTERS = Object.freeze({ cn: cnOpponents, us: usOpponents });

export const ELITE_ROSTERS = Object.freeze({
  cn: [
    { modelId: 'gptSol', name: 'GPT sol', tier: 4, portrait: 'sol', color: '#8a75dd', behavior: 'sniper' },
    { modelId: 'claudeOpus', name: 'Claude Opus', tier: 4, portrait: 'opus', color: '#d77e53', behavior: 'tank' },
    { modelId: 'geminiFlash', name: 'Gemini Flash', tier: 4, portrait: 'gemini', color: '#36bfd0', behavior: 'burst' },
  ],
  us: [
    { modelId: 'qwenMax', name: 'Qwen Max', tier: 4, portrait: 'qwen', color: '#68bd8c', behavior: 'sniper' },
    { modelId: 'kimiThinking', name: 'Kimi Thinking', tier: 4, portrait: 'kimi', color: '#6688db', behavior: 'burst' },
    { modelId: 'deepseekReasoner', name: 'DeepSeek Reasoner', tier: 4, portrait: 'deepseek', color: '#438ed0', behavior: 'tank' },
  ],
});

export function opposingRoster(playerFaction) {
  return ENEMY_ROSTERS[playerFaction === 'us' ? 'us' : 'cn'];
}
