export const ROSTER = [
  { id: "deepseek", name: "DeepSeek", skin: "deepseek", art: { portrait: "deepseek" }, brain: { difficulty: 3, label: "稳健" } },
  { id: "gptNormal", name: "GPT", skin: "gptNormal", art: { portrait: "gptNormal" }, brain: { difficulty: 3, label: "均衡" } },
  { id: "gptSilly", name: "GPT Silly", skin: "gptSilly", art: { level: 2, variant: 2 }, brain: { difficulty: 1, label: "迷糊" } },
  { id: "astra", name: "Astra", skin: "astra", art: { level: 10, variant: 10 }, brain: { difficulty: 5, label: "敏锐" } },
  { id: "claude", name: "Claude", skin: "claude", art: { portrait: "claude" }, brain: { difficulty: 4, label: "谨慎" } },
  { id: "fakeClaude", name: "假 Claude", skin: "fakeClaude", art: { level: 5, variant: 5 }, brain: { difficulty: 4, label: "侧袭" } },
  { id: "gemini", name: "Gemini", skin: "gemini", art: { portrait: "gemini" }, brain: { difficulty: 2, label: "莽撞" } },
  { id: "doubao", name: "豆包", skin: "doubao", art: { portrait: "doubao" }, brain: { difficulty: 1, label: "走神" } },
  { id: "qwen", name: "Qwen", skin: "qwen", art: { portrait: "qwen" }, brain: { difficulty: 3, label: "走位" } },
  { id: "kimi", name: "Kimi", skin: "kimi", art: { portrait: "kimi" }, brain: { difficulty: 3, label: "耐心" } },
  { id: "grok", name: "Grok", skin: "grok", art: { portrait: "grok" }, brain: { difficulty: 3, label: "挑衅" } },
];
export function getCharacter(id) { return ROSTER.find((c) => c.id === id) || ROSTER[0]; }
