export const ARENA_DEFAULT_MAX_PLAYERS = 6;
export const ARENA_DEFAULT_FILL_BOTS = true;
export const ARENA_CHARACTER_IDS = Object.freeze([
  "deepseek", "gptNormal", "gptSilly", "astra", "claude", "fakeClaude",
  "gemini", "doubao", "qwen", "kimi", "grok",
]);
const DEFAULT_CONFIG = Object.freeze({
  maxPlayers: ARENA_DEFAULT_MAX_PLAYERS,
  fillBots: ARENA_DEFAULT_FILL_BOTS,
  botRoster: Object.freeze([...ARENA_CHARACTER_IDS]),
});
const FACTIONS = Object.freeze({
  deepseek: 0, fakeClaude: 0, qwen: 0, kimi: 0, doubao: 0,
  gptNormal: 1, gptSilly: 1, astra: 1, claude: 1, gemini: 1, grok: 1,
});

function settingsError(code, message) {
  return Object.assign(new Error(message), { code, status: 400 });
}

export function normalizeArenaConfig(input, { strict = false } = {}) {
  const fail = (code, message) => {
    if (strict) throw settingsError(code, message);
    return { ...DEFAULT_CONFIG, botRoster: [...DEFAULT_CONFIG.botRoster] };
  };
  if (input !== undefined && input !== null && (typeof input !== "object" || Array.isArray(input)))
    return fail("invalid_settings", "对局设置格式不正确。");
  const source = input || {};
  const maxPlayers = source.maxPlayers === undefined ? 6 : source.maxPlayers;
  const fillBots = source.fillBots === undefined ? true : source.fillBots;
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 6 || typeof fillBots !== "boolean")
    return fail("invalid_settings", "人数或人机补位设置不正确。");
  const mode = source.mode === undefined ? "ffa" : source.mode;
  if (!new Set(["ffa", "teams"]).has(mode)) return fail("invalid_settings", "对局模式不正确。");
  if (mode === "teams" && maxPlayers % 2 !== 0)
    return fail("invalid_settings", "组队模式人数必须为 2、4 或 6 人。");
  let botRoster = source.botRoster === undefined ? [...DEFAULT_CONFIG.botRoster] : source.botRoster;
  if (!Array.isArray(botRoster)) return fail("invalid_bot_roster", "人机角色列表格式不正确。");
  if (botRoster.some((id) => typeof id !== "string" || !Object.hasOwn(FACTIONS, id)))
    return fail("invalid_bot_roster", "人机角色列表包含无效角色。");
  // An empty list is the API's shorthand for the complete default pool.
  if (botRoster.length === 0) botRoster = [...DEFAULT_CONFIG.botRoster];
  if (mode === "teams") {
    for (const faction of [0, 1]) {
      if (!botRoster.some((id) => FACTIONS[id] === faction))
        return fail("invalid_bot_roster", "组队模式的人机角色列表必须同时包含两个阵营的角色。");
    }
  }
  return { maxPlayers, fillBots, botRoster: [...botRoster] };
}
