import { getCharacter } from "./arena-roster.js";

const length = (x, y) => Math.hypot(x, y);
const unit = (x, y) => { const d = length(x, y) || 1; return [x / d, y / d]; };

// Pure with respect to the game: all randomness is supplied by its seeded RNG.
export function decideBotInput(g, f, random = Math.random) {
  if (!f.alive) return {};
  const character = getCharacter(f.characterId);
  const kind = f.characterId;
  const live = g.fighters.filter((x) => x.id !== f.id && x.alive);
  if (!live.length) return {};
  let target = live[0], best = Infinity;
  for (const candidate of live) {
    const d = length(candidate.x - f.x, candidate.y - f.y);
    const value = d - (kind === "fakeClaude" && candidate.lastHitAt > g.time - 1 ? 80 : 0);
    if (value < best) { best = value; target = candidate; }
  }
  const dx = target.x - f.x, dy = target.y - f.y, d = length(dx, dy) || 1;
  const threatX = f.x - target.x, threatY = f.y - target.y;
  const threatLength = length(threatX, threatY) || 1;
  const targetAimsAtUs = target.dashTimer > 0 &&
    (target.dashX * threatX + target.dashY * threatY) / threatLength > 0.35;
  let mx = dx / d, my = dy / d;
  const edge = length(f.x + f.vx * 0.35 - 640, f.y + f.vy * 0.35 - 450), safe = g.arenaRadius - 130;
  if (edge > safe) {
    const [rx, ry] = unit(640 - f.x, 450 - f.y);
    mx = mx * 0.08 + rx * (kind === "gptSilly" ? 0.9 : 2.5);
    my = my * 0.08 + ry * (kind === "gptSilly" ? 0.9 : 2.5);
  } else if (kind === "fakeClaude") {
    const side = f.id % 2 ? 1 : -1, ox = mx;
    mx = mx * 0.25 - my * side * 0.9; my = my * 0.25 + ox * side * 0.9;
  } else if (kind === "gemini" && d > 70) {
    mx += dx / d * 0.45; my += dy / d * 0.45;
  } else if (kind === "deepseek" && d < 110) {
    mx = -mx * 0.65; my = -my * 0.65;
  } else if (kind === "claude" && targetAimsAtUs) {
    // A cautious counter stance backs away from an incoming dash, then waits for recovery.
    mx = -mx * 0.95; my = -my * 0.95;
  } else if (kind === "qwen") {
    const ox = mx, sign = f.id % 2 ? 1 : -1;
    mx = ox * 0.25 - my * sign * 1.25;
    my = my * 0.25 + ox * sign * 1.25;
  } else if (kind === "kimi") {
    const ox = mx, sign = f.id % 2 ? 1 : -1;
    mx = ox * 0.35 - my * sign * 0.85;
    my = my * 0.35 + ox * sign * 0.85;
  } else if (kind === "grok") {
    mx *= 1.25; my *= 1.25;
  }
  if (kind === "gptSilly") { mx += (random() - 0.5) * 0.9; my += (random() - 0.5) * 0.9; }
  const distracted = kind === "doubao" && random() < 0.13;
  if (distracted) { mx = (random() - 0.5) * 0.2; my = (random() - 0.5) * 0.2; }
  const [moveX, moveY] = distracted ? [mx, my] : unit(mx, my);
  const lead = kind === "astra" ? 0.5 : kind === "grok" ? 0.48 : kind === "claude" ? 0.35 : kind === "gptSilly" ? 0 : 0.2;
  const aimX = target.x + target.vx * lead, aimY = target.y + target.vy * lead;
  const [dashX, dashY] = unit(aimX - f.x, aimY - f.y);
  const dashRisk = length(f.x + dashX * 130 - 640, f.y + dashY * 130 - 450) > g.arenaRadius - 36;
  let chance = kind === "astra" ? 0.055 : kind === "grok" ? 0.09 : kind === "fakeClaude" ? 0.035 : kind === "gemini" ? 0.065 : kind === "deepseek" ? 0.05 : kind === "gptNormal" ? 0.045 : kind === "claude" ? 0.025 : kind === "kimi" ? 0.022 : kind === "qwen" ? 0.04 : kind === "doubao" ? 0.018 : 0.035;
  if (kind === "fakeClaude" && target.lastHitAt > g.time - 1) chance = 0.085;
  if (kind === "astra" && d < 150) chance = 0.09;
  if (kind === "gptSilly") chance = 0.008;
  if (kind === "claude") chance = targetAimsAtUs && d < 190 ? 0.18 : 0;
  if (kind === "kimi") chance = targetAimsAtUs && d < 165 ? 0.16 : target.knockoutTimer > 0 && d < 125 ? 0.08 : 0;
  const primary = f.dashCooldown <= 0 && d > 40 && d < 205 && (!dashRisk || kind === "gemini" && edge < safe - 60) && random() < chance;
  return { moveX, moveY, aimX, aimY, primary };
}
