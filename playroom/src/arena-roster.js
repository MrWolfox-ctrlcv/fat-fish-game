export const ROSTER = [
  { id: "deepseek", name: "DeepSeek", skin: "deepseek", faction: 0, art: { portrait: "deepseek" }, brain: { difficulty: 3, label: "稳健" } },
  { id: "gptNormal", name: "GPT", skin: "gptNormal", faction: 1, art: { portrait: "gptNormal" }, brain: { difficulty: 3, label: "均衡" } },
  { id: "gptSilly", name: "GPT Silly", skin: "gptSilly", faction: 1, art: { level: 2, variant: 2 }, brain: { difficulty: 1, label: "迷糊" } },
  { id: "astra", name: "Astra·满血", skin: "astra", faction: 1, art: { level: 10, variant: 10 }, brain: { difficulty: 5, label: "专家" } },
  { id: "claude", name: "Claude·认真", skin: "claude", faction: 1, art: { portrait: "claude" }, brain: { difficulty: 5, label: "专家" } },
  { id: "fakeClaude", name: "假 Claude", skin: "fakeClaude", faction: 0, art: { level: 5, variant: 5 }, brain: { difficulty: 3, label: "侧袭" } },
  { id: "gemini", name: "Gemini", skin: "gemini", faction: 1, art: { portrait: "gemini" }, brain: { difficulty: 2, label: "莽撞" } },
  { id: "doubao", name: "豆包", skin: "doubao", faction: 0, art: { portrait: "doubao" }, brain: { difficulty: 1, label: "走神" } },
  { id: "qwen", name: "Qwen", skin: "qwen", faction: 0, art: { portrait: "qwen" }, brain: { difficulty: 3, label: "走位" } },
  { id: "kimi", name: "Kimi", skin: "kimi", faction: 0, art: { portrait: "kimi" }, brain: { difficulty: 3, label: "耐心" } },
  { id: "grok", name: "Grok", skin: "grok", faction: 1, art: { portrait: "grok" }, brain: { difficulty: 3, label: "挑衅" } },
];
export function getCharacter(id) { return ROSTER.find((c) => c.id === id) || ROSTER[0]; }
