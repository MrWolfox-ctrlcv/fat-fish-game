const length = (x, y) => Math.hypot(x, y);
const dot = (ax, ay, bx, by) => ax * bx + ay * by;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const unit = (x, y) => { const d = length(x, y) || 1; return [x / d, y / d]; };
const expert = (kind) => kind === "astra" || kind === "claude";
const weak = (kind) => kind === "gptSilly" || kind === "doubao";

export function getBotThinkInterval(characterId) {
  if (expert(characterId)) return 0.1;
  if (weak(characterId)) return 0.25;
  return 0.14;
}

function isEnemy(game, bot, other) {
  return other.id !== bot.id && other.alive &&
    (game.mode !== "teams" || bot.teamId !== other.teamId);
}

function friendlyInDashLane(game, bot, aimX, aimY, distance) {
  const [dx, dy] = unit(aimX - bot.x, aimY - bot.y);
  return game.fighters.some((other) => {
    if (other.id === bot.id || !other.alive || other.teamId !== bot.teamId) return false;
    const rx = other.x - bot.x, ry = other.y - bot.y;
    const along = dot(rx, ry, dx, dy);
    const across = Math.abs(dx * ry - dy * rx);
    return along > 0 && along < Math.min(distance, bot.dashSpeed * bot.dashDuration) && across < bot.r + other.r + 12;
  });
}

// Pure with respect to the game: randomness is provided only by its seeded RNG.
export function decideBotInput(g, f, random = Math.random) {
  if (!f.alive) return {};
  const kind = f.characterId;
  const advanced = expert(kind);
  const live = g.fighters.filter((other) => isEnemy(g, f, other));
  if (!live.length) return {};

  // Experts prioritize vulnerable enemies already drifting toward the rim;
  // everyone else mostly closes on the nearest valid target.
  let target = live[0], best = Infinity;
  for (const candidate of live) {
    const d = length(candidate.x - f.x, candidate.y - f.y);
    const rim = length(candidate.x - 640, candidate.y - 450);
    const vulnerable = candidate.knockoutTimer > 0 ? 42 : 0;
    const edgeValue = advanced ? Math.max(0, rim - (g.arenaRadius - 170)) * 0.38 : 0;
    const value = d - vulnerable - edgeValue -
      (kind === "fakeClaude" && candidate.lastHitAt > g.time - 1 ? 55 : 0);
    if (value < best) { best = value; target = candidate; }
  }

  const dx = target.x - f.x, dy = target.y - f.y;
  const d = length(dx, dy) || 1;
  const [toX, toY] = [dx / d, dy / d];
  const relativeX = f.x - target.x, relativeY = f.y - target.y;
  const relativeLength = length(relativeX, relativeY) || 1;
  const targetAimsAtUs = target.dashTimer > 0 &&
    dot(target.dashX, target.dashY, relativeX / relativeLength, relativeY / relativeLength) > 0.28;
  const edge = length(f.x + f.vx * (advanced ? 0.48 : 0.35) - 640, f.y + f.vy * (advanced ? 0.48 : 0.35) - 450);
  const safe = g.arenaRadius - (advanced ? 120 : 130);
  let mx = toX, my = toY;

  if (edge > safe) {
    const [rx, ry] = unit(640 - f.x, 450 - f.y);
    mx = mx * 0.06 + rx * (weak(kind) ? 0.8 : 2.5);
    my = my * 0.06 + ry * (weak(kind) ? 0.8 : 2.5);
  } else if (advanced && targetAimsAtUs) {
    // Step perpendicular to an incoming dash, then turn back for a counter.
    const sign = f.id % 2 ? 1 : -1;
    const dodge = [target.dashX, target.dashY];
    mx = -dodge[1] * sign * 1.05 + (640 - f.x) * 0.001;
    my = dodge[0] * sign * 1.05 + (450 - f.y) * 0.001;
  } else if (kind === "claude") {
    // Claude closes during an opponent's recovery, but keeps a circling exit
    // when the rival can still dash. This avoids passive waiting at range.
    const side = f.id % 2 ? 1 : -1;
    if (d > 145 || target.dashCooldown > 0.3 || target.knockoutTimer > 0) {
      mx = toX * 0.82 - toY * 0.42 * side;
      my = toY * 0.82 + toX * 0.42 * side;
    } else {
      mx = -toX * 0.12 - toY * 0.8 * side;
      my = -toY * 0.12 + toX * 0.8 * side;
    }
  } else if (kind === "qwen") {
    const sign = f.id % 2 ? 1 : -1;
    mx = toX * 0.25 - toY * sign * 1.25;
    my = toY * 0.25 + toX * sign * 1.25;
  } else if (kind === "kimi") {
    const sign = f.id % 2 ? 1 : -1;
    mx = toX * 0.35 - toY * sign * 0.85;
    my = toY * 0.35 + toX * sign * 0.85;
  } else if (kind === "fakeClaude") {
    const side = f.id % 2 ? 1 : -1;
    mx = toX * 0.25 - toY * side * 0.9;
    my = toY * 0.25 + toX * side * 0.9;
  } else if (kind === "gemini" && d > 70) {
    mx += toX * 0.45;
    my += toY * 0.45;
  } else if (kind === "deepseek" && d < 110) {
    mx = -toX * 0.65;
    my = -toY * 0.65;
  } else if (kind === "grok") {
    mx *= 1.25;
    my *= 1.25;
  }

  if (kind === "gptSilly") {
    mx += (random() - 0.5) * 1.1;
    my += (random() - 0.5) * 1.1;
  }
  let distracted = false;
  if (kind === "doubao" && random() < 0.18) {
    mx = (random() - 0.5) * 0.2;
    my = (random() - 0.5) * 0.2;
    distracted = true;
  }
  const [moveX, moveY] = distracted ? [mx, my] : unit(mx, my);

  const leadTime = advanced
    ? clamp(d / Math.max(250, f.dashSpeed + target.speed), 0.14, 0.42)
    : kind === "grok" ? 0.36 : weak(kind) ? 0.04 : 0.2;
  let aimX = target.x + target.vx * leadTime;
  let aimY = target.y + target.vy * leadTime;
  if (advanced && target.dashTimer > 0) {
    aimX += target.dashX * Math.min(48, target.dashTimer * target.dashSpeed * 0.42);
    aimY += target.dashY * Math.min(48, target.dashTimer * target.dashSpeed * 0.42);
  }
  if (weak(kind)) {
    aimX += (random() - 0.5) * 44;
    aimY += (random() - 0.5) * 44;
  }

  let [dashX, dashY] = unit(aimX - f.x, aimY - f.y);
  const dashDistance = f.dashSpeed * f.dashDuration;
  const dashRisk = length(f.x + dashX * dashDistance - 640, f.y + dashY * dashDistance - 450) > g.arenaRadius - f.r;
  const targetEdge = length(target.x - 640, target.y - 450);
  const targetOutward = dot(target.vx, target.vy, target.x - 640, target.y - 450) > 0;
  const edgeFinish = targetEdge > g.arenaRadius - 150 && targetOutward;
  let chance = advanced ? (kind === "astra" ? 0.09 : 0.075)
    : kind === "grok" ? 0.095
      : kind === "fakeClaude" ? 0.04
        : kind === "gemini" ? 0.07
          : kind === "deepseek" ? 0.05
            : kind === "gptNormal" ? 0.05
              : kind === "kimi" ? 0.035
                : kind === "qwen" ? 0.045
                  : weak(kind) ? 0.018 : 0.035;
  if (advanced && targetAimsAtUs && d < 190) chance = 0.24;
  if (kind === "claude") {
    if (targetAimsAtUs && d < 190) chance = 0.22;
    else if (target.knockoutTimer > 0 && d < 155) chance = 0.16;
    else if (target.dashCooldown > 0.3 && d < 215) chance = 0.11;
    else chance = d < 170 ? 0.035 : 0;
  }
  if (kind === "kimi") chance = targetAimsAtUs && d < 165 ? 0.15 : target.knockoutTimer > 0 && d < 125 ? 0.08 : 0;
  if (edgeFinish) chance = advanced ? 0.34 : Math.min(0.22, chance + 0.1);
  const laneBlocked = advanced && g.mode === "teams" && friendlyInDashLane(g, f, aimX, aimY, d);
  const recklessGemini = kind === "gemini" && edge < safe - 60;
  const primary = f.dashCooldown <= 0 && d > 36 && d < (advanced ? 230 : 205) &&
    (!dashRisk || recklessGemini) && !laneBlocked && random() < chance;
  return { moveX, moveY, aimX, aimY, primary };
}
