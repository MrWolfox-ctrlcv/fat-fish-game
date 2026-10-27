export const TEAM_IDS = Object.freeze([0, 1]);
export const TEAM_LABELS = Object.freeze(["国模队", "美模队"]);

export const CHARACTER_FACTION = Object.freeze({
  deepseek: 0,
  fakeClaude: 0,
  qwen: 0,
  kimi: 0,
  doubao: 0,
  gptNormal: 1,
  gptSilly: 1,
  astra: 1,
  claude: 1,
  gemini: 1,
  grok: 1,
});

export function getCharacterFaction(characterId) {
  return Object.hasOwn(CHARACTER_FACTION, characterId) ? CHARACTER_FACTION[characterId] : null;
}

export function getTeamLabel(teamId) {
  return TEAM_LABELS[teamId] || "未分队";
}

// Explicit team picks are honored; all remaining humans are assigned to the
// currently smaller team, breaking ties toward team 0 for repeatability.
export function balanceHumanTeams(humanIds = [0], humanTeams = {}, teamCapacity = 3) {
  teamCapacity = Number.isInteger(teamCapacity) && teamCapacity > 0 ? teamCapacity : 3;
  const counts = [0, 0], assignments = {};
  const ids = [...new Set(humanIds.map(Number))]
    .filter((id) => Number.isInteger(id) && id >= 0 && id < 6)
    .sort((a, b) => a - b);
  for (const id of ids) {
    const explicit = humanTeams?.[id];
    const requested = TEAM_IDS.includes(explicit) && counts[explicit] < teamCapacity ? explicit : null;
    const available = TEAM_IDS.filter((teamId) => counts[teamId] < teamCapacity);
    const teamId = requested ?? available.sort((a, b) => counts[a] - counts[b] || a - b)[0];
    if (teamId === undefined) continue;
    assignments[id] = teamId;
    counts[teamId] += 1;
  }
  return assignments;
}
