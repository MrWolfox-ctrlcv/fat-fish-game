import { EASTER_EGGS, EASTER_STAGE_COUNT, getAllowedVariants, getEasterEgg, getEasterImageKey, isEasterEggId, rollEasterVariant } from "./easter-eggs.js";
import { onlineClient, OnlineApiError } from "./online-client.js";
import { seededRandom } from "./seeded-random.js";
import { setupLeaderboard } from './leaderboard.js';
import { createCompanion } from './companion.js';
import { createFishDiscoveryTracker, fatFishSnapshot } from './companion-scene.js';
import { createWardrobeClient } from './wardrobe-client.js';
import { createPersonalCompanion } from './personal-companion.js';
import { createCornerCompanion } from './companion-corner.js';
import { isLocalCheatAllowed } from './local-cheats.js';
import { createFishPropsUI } from './fish-props-ui.js';
import { setupFishSavesUI, hydrateGameState } from './fish-saves-ui.js';
import { PHYSICS_VERSION } from './physics-version.js';
import { createFishRenderer } from './fish-render.js';

export const MAX_LEVEL = 11;
export const GIFT_LEVEL = 6;
export const FIELD_WIDTH = 480;
export const BASE_FIELD_HEIGHT = 620;
export const LEVEL_RADII = Object.freeze([0, 23, 30, 38, 47, 57, 68, 79, 90, 101, 112, 123]);

export function formatRewardQuota(quota) {
  const amount = Number(quota) / 500000;
  return Number.isFinite(amount) ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(amount) : "";
}

export function formatRewardExpiry(expiredTime) {
  const seconds = Number(expiredTime);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toLocaleString("zh-CN") : "";
}

export function isInvalidRunError(error) {
  return error instanceof OnlineApiError && ["RUN_EXPIRED", "RUN_INVALID", "RUN_NOT_FOUND"].includes(error.code);
}

export function ensureAdminCampaigns(campaigns, includeDefault = true) {
  const list = Array.isArray(campaigns) ? [...campaigns] : [];
  if (includeDefault && !list.some((campaign) => String(campaign.id) === "first-fat-fish-6")) {
    list.push({ id: "first-fat-fish-6", title: "首次合成谢礼", min_level: GIFT_LEVEL, remaining: 0, total: 0, isDefault: true });
  }
  return list;
}

export function toNumericCandidateIds(entries) {
  return [...entries]
    .filter(([, value]) => value.checkbox.checked)
    .map(([id]) => Number(id))
    .filter(Number.isSafeInteger);
}

export function galleryUnlocksFor(account, profile) {
  return account ? profile?.unlocked ?? [1] : [1];
}

export function easterUnlocksFor(account, profile) {
  return account ? profile?.egg_stages ?? [] : [];
}

const GRAVITY = 1120;
const FRICTION = 0.72;
const makeRequestUuid = () => globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (slot) => {
  const value = Math.floor(Math.random() * 16);
  return (slot === "x" ? value : (value & 0x3) | 0x8).toString(16);
});
export function radiusForLevel(level) {
  return LEVEL_RADII[Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)))] ?? LEVEL_RADII[1];
}

const fishRenderer = createFishRenderer({ MAX_LEVEL, FIELD_WIDTH, radiusForLevel, getEasterEgg, getEasterImageKey, isEasterEggId });
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
export const clearRegisteredArt = fishRenderer.clearRegisteredArt;
export const registerCharacterImage = fishRenderer.registerCharacterImage;
export const registerEasterImage = fishRenderer.registerEasterImage;
export const getRegisteredEasterImage = fishRenderer.getRegisteredEasterImage;
export const drawGame = fishRenderer.drawGame;
export const drawMini = fishRenderer.drawMini;

export function createGame({ width = FIELD_WIDTH, height = BASE_FIELD_HEIGHT, random = Math.random, variantRandom = Math.random, best = 0 } = {}) {
  const currentLevel = pickDropLevel(random);
  const currentVariant = rollEasterVariant(currentLevel, variantRandom);
  const nextLevel = pickDropLevel(random);
  const nextVariant = rollEasterVariant(nextLevel, variantRandom);
  return {
    width, height, random, variantRandom, bodies: [], score: 0, best, unlocked: new Set([1]),
    currentLevel, currentVariant, nextLevel, nextVariant, seenEggs: new Set(), seenEggStages: new Set(),
    aimX: width / 2, dropCooldown: 0, over: false, overTimer: 0,
    stepIndex: 0, nextId: 1, particles: [],
  };
}

export function pickDropLevel(random = Math.random) {
  const roll = random();
  return roll < 0.58 ? 1 : roll < 0.9 ? 2 : 3;
}

export function makeBody(game, level, x, y, options = {}) {
  const r = radiusForLevel(level);
  return {
    id: options.id ?? game.nextId++, level, x, y, r,
    vx: options.vx ?? 0, vy: options.vy ?? 0,
    angle: options.angle ?? 0, angularVelocity: options.angularVelocity ?? 0,
    variant: isEasterEggId(options.variant) ? options.variant : null,
    age: options.age ?? 0, mergeCooldown: options.mergeCooldown ?? 0,
    dangerTime: options.dangerTime ?? 0,
  };
}

export function dropBody(game, x = game.aimX) {
  if (game.over || game.dropCooldown > 0) return null;
  const r = radiusForLevel(game.currentLevel);
  const body = makeBody(game, game.currentLevel, clamp(x, r + 6, game.width - r - 6), 43, { variant: game.currentVariant });
  game.bodies.push(body);
  if (body.variant) {
    game.seenEggs.add(body.variant);
    game.seenEggStages.add(`${body.variant}:${body.level}`);
  }
  game.unlocked.add(body.level);
  game.currentLevel = game.nextLevel;
  game.currentVariant = game.nextVariant;
  game.nextLevel = pickDropLevel(game.random);
  game.nextVariant = rollEasterVariant(game.nextLevel, game.variantRandom ?? Math.random);
  game.dropCooldown = 0.36;
  return body;
}

function mergePair(game, a, b) {
  const massA = a.r * a.r;
  const massB = b.r * b.r;
  const mass = massA + massB;
  const level = a.level + 1;
  const x = (a.x * massA + b.x * massB) / mass;
  const y = (a.y * massA + b.y * massB) / mass;
  const vx = (a.vx * massA + b.vx * massB) / mass;
  const vy = (a.vy * massA + b.vy * massB) / mass;
  const angle = Math.atan2(massA * Math.sin(a.angle) + massB * Math.sin(b.angle), massA * Math.cos(a.angle) + massB * Math.cos(b.angle));
  const variant = rollEasterVariant(level, game.variantRandom ?? Math.random, "merge");
  const merged = makeBody(game, level, x, y,
    {
      vx, vy, angle, variant,
      mergeCooldown: 0.18,
    });
  const inertiaA = 0.5 * massA * a.r * a.r;
  const inertiaB = 0.5 * massB * b.r * b.r;
  const inertiaMerged = 0.5 * merged.r * merged.r * merged.r * merged.r;
  const angularMomentum = inertiaA * a.angularVelocity + inertiaB * b.angularVelocity +
    massA * ((a.x - x) * (a.vy - vy) - (a.y - y) * (a.vx - vx)) +
    massB * ((b.x - x) * (b.vy - vy) - (b.y - y) * (b.vx - vx));
  merged.angularVelocity = clamp(angularMomentum / inertiaMerged, -12, 12);
  game.unlocked.add(level);
  if (merged.variant) {
    game.seenEggs.add(merged.variant);
    game.seenEggStages.add(`${merged.variant}:${level}`);
  }
  game.score += level * 12;
  game.best = Math.max(game.best, game.score);
  game.particles.push({ x: merged.x, y: merged.y, age: 0, life: 0.48, level });
  return merged;
}

export function mergeBodiesInLocalMode(game, firstId, secondId) {
  const first = game.bodies.find((body) => body.id === firstId);
  const second = game.bodies.find((body) => body.id === secondId);
  if (!first || !second || first === second || first.level !== second.level || first.level >= MAX_LEVEL) return null;
  game.bodies = game.bodies.filter((body) => body !== first && body !== second);
  const merged = mergePair(game, first, second);
  game.bodies.push(merged);
  return merged;
}

// Applies a replayable account prop to a hydrated game state. The caller is
// responsible for pausing simulation and persisting the resulting snapshot.
export function applyFishProp(game, kind, bodyIds) {
  if (!game || !Array.isArray(game.bodies) || !Array.isArray(bodyIds) || new Set(bodyIds).size !== bodyIds.length) throw new RangeError("道具参数不合法");
  let selected;
  const chosen = bodyIds.map((id) => game.bodies.find((body) => body.id === id));
  if (kind === "remove") {
    if (bodyIds.length !== 1) throw new RangeError("捞鱼网需要选择一条鱼");
    selected = chosen[0];
    if (!selected) throw new RangeError("所选鱼已不存在");
    game.bodies = game.bodies.filter((body) => body !== selected);
  } else if (kind === "merge") {
    if (bodyIds.length !== 2 || bodyIds[0] === bodyIds[1]) throw new RangeError("牵线合成需要选择两条不同的鱼");
    const [first, second] = chosen;
    if (!first || !second || first === second || first.level !== second.level || first.level >= MAX_LEVEL) {
      throw new RangeError("请选择两条等级相同且低于 11 级的鱼");
    }
    game.bodies = game.bodies.filter((body) => body !== first && body !== second);
    selected = mergePair(game, first, second);
    game.bodies.push(selected);
  } else if (kind === "swap") {
    if (bodyIds.length !== 2 || bodyIds[0] === bodyIds[1]) throw new RangeError("交换位置需要选择两条不同的鱼");
    const [first, second] = chosen;
    if (!first || !second || first === second) throw new RangeError("所选鱼已不存在");
    const firstX = first.x, firstY = first.y;
    first.x = clamp(second.x, first.r + 4, game.width - first.r - 4);
    first.y = clamp(second.y, first.r + 4, game.height - 9 - first.r);
    second.x = clamp(firstX, second.r + 4, game.width - second.r - 4);
    second.y = clamp(firstY, second.r + 4, game.height - 9 - second.r);
    first.vx = first.vy = second.vx = second.vy = 0;
  } else if (kind === "pack") {
    if (bodyIds.length < 1 || bodyIds.length > 3) throw new RangeError("打包小鱼需要选择一到三条鱼");
    if (chosen.some((body) => !body) || chosen.some((body) => body.level < 1 || body.level > 3)) {
      throw new RangeError("打包只能选择 1 到 3 级鱼");
    }
    game.bodies = game.bodies.filter((body) => !chosen.includes(body));
  } else {
    throw new RangeError("未知道具");
  }
  game.over = false;
  game.overTimer = 0;
  for (const body of game.bodies) body.dangerTime = 0;
  return {
    kind,
    selectedIds: [...bodyIds],
    resultBodyId: kind === "merge" ? selected.id : null,
    summary: {
      score: game.score,
      max_level: Math.max(...game.unlocked),
      over: game.over,
      unlocked: [...game.unlocked],
      egg_stages: [...game.seenEggStages],
    },
  };
}

function resolveCollisions(game, delta) {
  const mergedThisStep = new Set();
  const mergedBodies = [];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < game.bodies.length; i++) {
      const a = game.bodies[i];
      for (let j = i + 1; j < game.bodies.length; j++) {
        const b = game.bodies[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        const overlap = a.r + b.r - distance;
        if (overlap <= 0) continue;
        if (distance < 0.001) { dx = 1; dy = 0; distance = 1; }
        const nx = dx / distance;
        const ny = dy / distance;
        if (a.level === b.level && a.level < MAX_LEVEL && a.mergeCooldown <= 0 && b.mergeCooldown <= 0 &&
            !mergedThisStep.has(a.id) && !mergedThisStep.has(b.id)) {
          const merged = mergePair(game, a, b);
          mergedThisStep.add(a.id);
          mergedThisStep.add(b.id);
          mergedThisStep.add(merged.id);
          game.bodies.splice(j, 1);
          game.bodies.splice(i, 1);
          game.bodies.push(merged);
          mergedBodies.push(merged);
          i--;
          break;
        }
        const massA = a.r * a.r;
        const massB = b.r * b.r;
        const inverseA = 1 / massA;
        const inverseB = 1 / massB;
        const inverseSum = inverseA + inverseB;
        const separation = overlap / inverseSum;
        a.x -= nx * separation * inverseA;
        a.y -= ny * separation * inverseA;
        b.x += nx * separation * inverseB;
        b.y += ny * separation * inverseB;

        let normalImpulse = 0;
        const relativeNormal = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (relativeNormal < 0) {
          normalImpulse = -(1 + 0.17) * relativeNormal / inverseSum;
          a.vx -= normalImpulse * inverseA * nx;
          a.vy -= normalImpulse * inverseA * ny;
          b.vx += normalImpulse * inverseB * nx;
          b.vy += normalImpulse * inverseB * ny;
        }

        // Tangential contact speed includes the angular velocity at each contact point.
        const tx = -ny;
        const ty = nx;
        const relativeTangent = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty - a.angularVelocity * a.r - b.angularVelocity * b.r;
        const inertiaA = 0.5 * massA * a.r * a.r;
        const inertiaB = 0.5 * massB * b.r * b.r;
        const tangentMass = inverseSum + (a.r * a.r) / inertiaA + (b.r * b.r) / inertiaB;
        const supportImpulse = (ny < 0 ? massB * -ny : massA * ny) * GRAVITY * delta / 3;
        const frictionLimit = FRICTION * Math.max(normalImpulse, supportImpulse);
        const tangentImpulse = clamp(-relativeTangent / tangentMass, -frictionLimit, frictionLimit);
        a.vx -= tangentImpulse * inverseA * tx;
        a.vy -= tangentImpulse * inverseA * ty;
        b.vx += tangentImpulse * inverseB * tx;
        b.vy += tangentImpulse * inverseB * ty;
        a.angularVelocity -= tangentImpulse * a.r / inertiaA;
        b.angularVelocity -= tangentImpulse * b.r / inertiaB;
      }
    }
  }
  return mergedBodies;
}

function applySurfaceFriction(body, tx, ty, armX, armY, maxImpulse) {
  if (maxImpulse <= 0) return;
  const mass = body.r * body.r;
  const inverseMass = 1 / mass;
  const inertia = 0.5 * mass * body.r * body.r;
  const torqueArm = armX * ty - armY * tx;
  const slipSpeed = body.vx * tx + body.vy * ty + body.angularVelocity * torqueArm;
  const effectiveInverseMass = inverseMass + (torqueArm * torqueArm) / inertia;
  const impulse = clamp(-slipSpeed / effectiveInverseMass, -maxImpulse, maxImpulse);
  body.vx += impulse * inverseMass * tx;
  body.vy += impulse * inverseMass * ty;
  body.angularVelocity += impulse * torqueArm / inertia;
}

function attractNearbyMatches(game, delta) {
  // Mutual nearest neighbours receive a bounded, symmetric pull. Each ball has
  // at most one partner, so a crowded group cannot multiply the attraction.
  const nearest = new Map();
  for (let i = 0; i < game.bodies.length; i++) {
    const a = game.bodies[i];
    if (a.level >= MAX_LEVEL || a.mergeCooldown > 0) continue;
    for (let j = i + 1; j < game.bodies.length; j++) {
      const b = game.bodies[j];
      if (a.level !== b.level || b.mergeCooldown > 0) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      const gap = distance - a.r - b.r;
      const range = clamp((a.r + b.r) * 0.45, 24, 56);
      if (gap < 0 || gap >= range || distance < 0.001) continue;
      if (!nearest.has(a) || gap < nearest.get(a).gap) nearest.set(a, { other: b, gap, range, distance });
      if (!nearest.has(b) || gap < nearest.get(b).gap) nearest.set(b, { other: a, gap, range, distance });
    }
  }
  const pulled = new Set();
  for (const [a, match] of nearest) {
    const b = match.other;
    if (pulled.has(a) || nearest.get(b)?.other !== a) continue;
    const nx = (b.x - a.x) / match.distance;
    const ny = (b.y - a.y) / match.distance;
    const closingSpeed = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    // Keep enough pull near the edge to overcome rolling friction, then ease
    // into contact. Limit only added speed; never slow an existing collision.
    const proximity = 1 - match.gap / match.range;
    const change = Math.min(360 * (0.35 + 0.65 * proximity) * delta, Math.max(0, 84 - closingSpeed) / 2);
    a.vx += nx * change; a.vy += ny * change;
    b.vx -= nx * change; b.vy -= ny * change;
    pulled.add(a); pulled.add(b);
  }
}

export function stepGame(game, dt) {
  if (game.over) return { merged: [], failed: false };
  const delta = Math.min(Math.max(0, dt), 0.05);
  game.stepIndex++;
  game.dropCooldown = Math.max(0, game.dropCooldown - delta);
  const floor = game.height - 9;
  attractNearbyMatches(game, delta);
  for (const body of game.bodies) {
    body.age += delta;
    body.mergeCooldown = Math.max(0, body.mergeCooldown - delta);
    body.angle += body.angularVelocity * delta;
    body.angularVelocity *= Math.exp(-0.18 * delta);
    body.vy = Math.min(980, body.vy + GRAVITY * delta);
    body.x += body.vx * delta;
    body.y += body.vy * delta;
    body.vx *= Math.pow(0.986, delta * 60);
    if (body.x - body.r < 4) {
      body.x = body.r + 4;
      const before = body.vx;
      body.vx = Math.abs(body.vx) * 0.34;
      const normalImpulse = body.r * body.r * Math.max(0, body.vx - before);
      applySurfaceFriction(body, 0, 1, -body.r, 0, FRICTION * normalImpulse);
    }
    if (body.x + body.r > game.width - 4) {
      body.x = game.width - body.r - 4;
      const before = body.vx;
      body.vx = -Math.abs(body.vx) * 0.34;
      const normalImpulse = body.r * body.r * Math.max(0, before - body.vx);
      applySurfaceFriction(body, 0, 1, body.r, 0, FRICTION * normalImpulse);
    }
    if (body.y + body.r > floor) {
      body.y = floor - body.r;
      const before = body.vy;
      body.vy = -Math.abs(body.vy) * 0.18;
      if (Math.abs(body.vy) < 28) body.vy = 0;
      const mass = body.r * body.r;
      const impactImpulse = Math.max(0, mass * (before - body.vy));
      const supportImpulse = mass * GRAVITY * delta;
      applySurfaceFriction(body, 1, 0, 0, body.r, FRICTION * Math.max(impactImpulse, supportImpulse));
    }
  }

  // A merged body gets a short settle window, and each body can participate once per step.
  const merged = resolveCollisions(game, delta);
  // Pair separation can push a ball through a wall; reapply the aquarium bounds afterward.
  for (const body of game.bodies) {
    const mass = body.r * body.r;
    if (body.x - body.r < 4) {
      body.x = body.r + 4;
      if (body.vx < 0) {
        const impulse = mass * -body.vx;
        body.vx = 0;
        applySurfaceFriction(body, 0, 1, -body.r, 0, FRICTION * impulse);
      }
    }
    if (body.x + body.r > game.width - 4) {
      body.x = game.width - body.r - 4;
      if (body.vx > 0) {
        const impulse = mass * body.vx;
        body.vx = 0;
        applySurfaceFriction(body, 0, 1, body.r, 0, FRICTION * impulse);
      }
    }
    if (body.y + body.r > floor) {
      body.y = floor - body.r;
      if (body.vy > 0) {
        const impulse = mass * body.vy;
        body.vy = 0;
        applySurfaceFriction(body, 1, 0, 0, body.r, FRICTION * Math.max(impulse, mass * GRAVITY * delta));
      }
    }
  }
  for (const p of game.particles) p.age += delta;
  game.particles = game.particles.filter((p) => p.age < p.life);

  const dangerLine = 96;
  let threatening = false;
  for (const body of game.bodies) {
    const aboveLine = body.y - body.r < dangerLine;
    // Young balls get a clear fall/settle grace period; persistence itself is the danger signal.
    body.dangerTime = aboveLine && body.age > 1.1 ? body.dangerTime + delta : 0;
    if (body.dangerTime >= 1.45) threatening = true;
  }
  game.overTimer = threatening ? game.overTimer + delta : 0;
  const failed = game.overTimer >= 0.15;
  if (failed) game.over = true;
  return { merged, failed };
}

export function awardForLevel(level) {
  return Math.max(1, Math.min(MAX_LEVEL, level)) * 12;
}

function setupUI() {
  if (typeof window !== "undefined" && isLocalCheatAllowed(window.location)) {
    void import("./local-cheats-ui.js").then(({ setupLocalCheatUI }) => setupLocalCheatUI({
      BASE_FIELD_HEIGHT, FIELD_WIDTH, MAX_LEVEL, awardForLevel, clamp, createGame, drawGame, drawMini, dropBody,
      mergeBodiesInLocalMode, registerCharacterImage, registerEasterImage, stepGame,
    }));
    return;
  }
  const canvas = document.querySelector("#game-canvas");
  const ctx = canvas.getContext("2d");
  const wrapper = document.querySelector(".board-wrap");
  const scoreEl = document.querySelector("#score");
  const bestEl = document.querySelector("#best-score");
  const nextCanvas = document.querySelector("#next-canvas");
  const brandCanvas = document.querySelector("#brand-avatar");
  const gameoverCanvas = document.querySelector("#gameover-avatar");
  const gallery = document.querySelector("#gallery");
  const easterCount = document.querySelector("#easter-count");
  const easterDialogCount = document.querySelector("#easter-dialog-count");
  const easterDialog = document.querySelector("#easter-dialog");
  const easterGrid = document.querySelector("#easter-grid");
  const overlay = document.querySelector("#overlay");
  const toast = document.querySelector("#toast");
  const giftCopy = document.querySelector("#gift-copy");
  const rewardList = document.querySelector("#reward-list");
  const giftDialog = document.querySelector("#gift-dialog");
  const giftDialogCopy = document.querySelector("#gift-dialog-copy");
  const rewardCodeLabel = document.querySelector("#reward-code-label");
  const rewardCode = document.querySelector("#reward-code");
  const copyReward = document.querySelector("#copy-reward");
  const walletLink = document.querySelector("#wallet-link");
  const loginLink = document.querySelector("#login-link");
  const adminOpen = document.querySelector("#admin-open");
  const adminDialog = document.querySelector("#admin-dialog");
  const adminStatus = document.querySelector("#admin-status");
  const adminCandidatesEl = document.querySelector("#admin-candidates");
  const adminCampaign = document.querySelector("#admin-campaign");
  const adminImport = document.querySelector("#admin-import");
  const adminSelectAll = document.querySelector("#admin-select-all");
  const adminSelectionCount = document.querySelector("#admin-selection-count");
  const adminNewCampaignForm = document.querySelector("#admin-new-campaign-form");
  const adminNewCampaignOpen = document.querySelector("#admin-new-campaign-open");
  const adminCreateCampaign = document.querySelector("#admin-create-campaign");
  const adminDeleteCampaign = document.querySelector('#admin-delete-campaign');
  const deleteDialog = document.querySelector('#campaign-delete-dialog');
  const deleteConfirm = document.querySelector('#campaign-delete-confirm');
  let deletingCampaign = false;
  let deleteTarget = null;
  const adminStockPanel = document.querySelector('#admin-stock-panel');
  const adminStockList = document.querySelector('#admin-stock-list');
  const adminStockStatus = document.querySelector('#admin-stock-status');
  const adminStockAll = document.querySelector('#admin-stock-select-all');
  const adminStockRemove = document.querySelector('#admin-stock-remove');
  const adminStockItems = new Map();
  let adminStockPage = 1;
  let adminStockTotal = 0;
  let adminStockLoading = false;
  let adminStockRemoving = false;
  let adminStockRequest = 0;
  const adminCandidateItems = new Map();
  let adminImporting = false;
  let adminSearching = false;
  let adminCreating = false;
  let game = createGame({ height: BASE_FIELD_HEIGHT });
  let account = null;
  let profile = null;
  let rewards = [];
  let adminAllowed = false;
  let accountState = "checking";
  let activeRun = null;
  let activePlay = null;
  let activeRunGuest = false;
  let gameReady = false;
  let deferredSessionKind = null;
  let pendingMoves = [];
  let checkpointFlight = null;
  let checkpointTimer = null;
  let fishSaves = null;
  let checkpointVersion = 0;
  let checkpointNeeded = false;
  let syncMessage = "";
  let gameScale = 1;
  let gameOffsetX = 0;
  let gameOffsetY = 0;
  let failedSyncPending = false;
  let muted = true;
  let audioContext = null;
  let lastTime = 0;
  let accumulator = 0;
  let toastTimeout;
  let lastMergeSound = 0;
  let aimingPointerId = null;
  let lastEggToast = -Infinity;
  let artGeneration = 0;
  let artLoadFlight = null;
  let artModule = null;
  let playGeneration = 0;
  let sessionGeneration = 0;
  let retryCheckpointPayload = null;
  let lastCheckpointAt = 0;
  const leaderboard = setupLeaderboard({ client: onlineClient, onReward: (details) => showRewardDialog(details) });
  const discoveries = createFishDiscoveryTracker();
  const companionAccount = createWardrobeClient();
  const personalCompanion = createPersonalCompanion({ client: companionAccount });
  const companion = createCompanion({ container: document.querySelector('#companion'), gameId: 'fat-fish',
    personalClient: personalCompanion,
    getSnapshot: () => fatFishSnapshot(game),
    fetchImpl: (url, options) => onlineClient.requestCompanion(url, options) });
  createCornerCompanion({ container: document.querySelector('#companion'), trigger: document.querySelector('#companion-toggle'),
    panel: document.querySelector('#companion-popover') });

  const renderGallery = () => {
    gallery.replaceChildren();
    const unlockedLevels = new Set(galleryUnlocksFor(account, profile));
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const unlocked = unlockedLevels.has(level);
      const cell = document.createElement("div");
      cell.className = `gallery-cell${unlocked ? "" : " locked"}`;
      cell.setAttribute("aria-label", unlocked ? `第 ${level} 级已解锁` : `第 ${level} 级尚未解锁`);
      const mini = document.createElement("canvas");
      cell.append(mini);
      const badge = document.createElement("span"); badge.textContent = `${level}`; cell.append(badge);
      renderGallery.pending.push([mini, level, !unlocked]);
      gallery.append(cell);
    }
    for (const [mini, level, locked] of renderGallery.pending) drawMini(mini, level, locked);
    renderGallery.pending = [];
    document.querySelector("#book-count").textContent = `${unlockedLevels.size} / ${MAX_LEVEL}`;
  };
  renderGallery.pending = [];

  const renderEasterGallery = () => {
    const unlockedStages = new Set(easterUnlocksFor(account, profile));
    const countText = account
      ? `账户已收录 ${unlockedStages.size} / ${EASTER_STAGE_COUNT}`
      : "登录后查看账户彩蛋图鉴";
    easterCount.textContent = countText;
    easterDialogCount.textContent = countText;
    easterGrid.replaceChildren();
    for (const egg of EASTER_EGGS) {
      const card = document.createElement("article");
      card.className = "egg-card";
      const textBox = document.createElement("div");
      textBox.className = "egg-card-head";
      const levels = Array.from({ length: MAX_LEVEL }, (_, index) => index + 1)
        .filter((level) => getAllowedVariants(level).includes(egg.id));
      const known = levels.some((level) => unlockedStages.has(`${egg.id}:${level}`));
      const name = document.createElement("h3"); name.textContent = known ? egg.name : "神秘角色";
      const description = document.createElement("p"); description.textContent = known ? egg.description : "尚未解锁，继续合成揭开模样。";
      const status = document.createElement("span");
      const seen = known;
      status.className = `egg-seen${seen ? " is-seen" : ""}`;
      status.textContent = seen ? "已收录" : "尚未解锁";
      const range = document.createElement("p");
      range.className = "egg-level-range";
      range.textContent = `对应等级：${levels.join("、")}`;
      textBox.append(name, description, range, status);
      const stageRow = document.createElement("div");
      stageRow.className = "egg-stage-row";
      for (const level of levels) {
        const stage = document.createElement("div");
        stage.className = "egg-stage";
        const artBox = document.createElement("div"); artBox.className = "egg-card-art";
        const stageUnlocked = unlockedStages.has(`${egg.id}:${level}`);
        const art = document.createElement("canvas"); art.width = art.height = 72; art.setAttribute("aria-label", stageUnlocked ? `${egg.name}第 ${level} 级` : `第 ${level} 级尚未解锁`);
        artBox.append(art);
        const label = document.createElement("span");
        label.textContent = `第 ${level} 级`;
        label.title = stageUnlocked ? `第 ${level} 级已解锁` : `第 ${level} 级尚未解锁`;
        stage.append(artBox, label);
        stageRow.append(stage);
        drawMini(art, level, !stageUnlocked, egg.id);
      }
      card.append(textBox, stageRow);
      easterGrid.append(card);
    }
  };

  const sayToast = (message) => {
    toast.textContent = message; toast.classList.add("show");
    clearTimeout(toastTimeout); toastTimeout = setTimeout(() => toast.classList.remove("show"), 950);
  };

  const sayEggToast = (id, now = performance.now()) => {
    const egg = getEasterEgg(id);
    if (!egg || now - lastEggToast < 1300) return false;
    lastEggToast = now;
    sayToast(`偶遇彩蛋：${egg.name}`);
    return true;
  };

  const clearImageCache = () => {
    clearRegisteredArt();
    artModule?.clearAccountArtCache?.();
  };

  function showRewardDialog({ reward = null, message = "谢礼状态已更新。" } = {}) {
    const code = reward?.code ? String(reward.code) : "";
    const details = [];
    if (reward?.quota !== undefined && reward.quota !== null) details.push(`额度 ${formatRewardQuota(reward.quota)}`);
    const expiry = formatRewardExpiry(reward?.expired_time);
    if (expiry) details.push(`有效期至 ${expiry}`);
    giftDialogCopy.textContent = [message, ...details].filter(Boolean).join(" · ");
    rewardCode.value = code;
    rewardCode.hidden = !code;
    rewardCodeLabel.hidden = !code;
    copyReward.hidden = !code;
    walletLink.hidden = !code;
    walletLink.href = onlineClient.walletUrl;
    if (!giftDialog.open) giftDialog.showModal();
  }

  async function claimReward(reward) {
    if (!account || !activeRun || !reward?.campaign_id) {
      syncMessage = "当前没有有效游戏记录，请重新开始后再领取。";
      renderRewards();
      return;
    }
    const claimButton = [...rewardList.querySelectorAll("button")].find((button) => button.textContent === "领取谢礼");
    if (claimButton) claimButton.disabled = true;
    try {
      if (!(await flushCheckpoint())) throw new Error("本局进度尚未同步，请稍后重试。");
      const result = await onlineClient.claimReward(reward.campaign_id, activeRun.id);
      const currentRun = activeRun;
      const accountData = await onlineClient.getMe();
      if (currentRun === activeRun && accountData) applyServerState(accountData);
      showRewardDialog({ reward: result.reward, message: "领取成功，谢礼已记入账户。" });
      syncMessage = "";
      renderRewards();
    } catch (error) {
      syncMessage = isInvalidRunError(error)
        ? "本局记录已失效，请重新开始后再领取。"
        : error.message || "领取失败，请稍后再试。";
      renderRewards();
      showRewardDialog({ message: syncMessage });
    }
  }

  document.querySelector("#copy-reward").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(rewardCode.value); giftDialogCopy.textContent = "领取码已复制。"; }
    catch { rewardCode.focus(); rewardCode.select(); giftDialogCopy.textContent = "请复制选中的领取码。"; }
  });

  const stageKeys = () => Object.keys(STAGE_VARIANTS).length + 3;

  const renderRewards = () => {
    rewardList.replaceChildren();
    if (!account) {
      giftCopy.textContent = accountState === "run_error"
        ? syncMessage || "本局暂时无法开始，请点击重新开始再试。"
        : accountState === "offline"
        ? "连接暂时不可用。登录后可保存图鉴并领取谢礼。"
        : "登录后可保存图鉴，并领取符合条件的谢礼。";
      const login = document.createElement("a");
      login.className = "reward-login";
      login.href = onlineClient.loginUrl;
      login.textContent = "前往登录";
      rewardList.append(login);
      return;
    }
    giftCopy.textContent = syncMessage || `你好，${account.username}。合成成长，收录模样，领取谢礼。`;
    if (rewards.length === 0) {
      const empty = document.createElement("p");
      empty.className = "reward-empty";
      empty.textContent = "谢礼补货中，先合个大的。";
      rewardList.append(empty);
      return;
    }
    for (const reward of rewards) {
      const item = document.createElement("article"); item.className = "reward-item";
      const title = document.createElement("h3"); title.textContent = reward.title || "女仆的谢礼";
      const status = document.createElement("span"); status.className = "reward-status";
      const minimum = Number(reward.min_level) || GIFT_LEVEL;
      if (reward.status === "available") status.textContent = "可以领取";
      else if (reward.status === "claimed") status.textContent = "已领取";
      else if (reward.status === "empty") status.textContent = "谢礼补货中";
      else status.textContent = `合成到第 ${minimum} 级解锁`;
      const detail = document.createElement("p");
      if (reward.status === "claimed") {
        detail.textContent = reward.code ? `领取码：${reward.code}` : "这份谢礼已记入账户。";
      } else if (reward.status === "empty") detail.textContent = "谢礼补货中，先合个大的。";
      else detail.textContent = `达到第 ${minimum} 级后可领取。`;
      item.append(title, status, detail);
      if (reward.status === "available") {
        const claim = document.createElement("button"); claim.type = "button"; claim.textContent = activeRun ? "领取谢礼" : "重新开始后可领取"; claim.disabled = !activeRun;
        claim.addEventListener("click", () => { void claimReward(reward); }); item.append(claim);
      } else if (reward.status === "claimed") {
        if (reward.code) {
          const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "复制领取码";
          copy.addEventListener("click", async () => {
            try { await navigator.clipboard.writeText(reward.code); sayToast("领取码已复制"); }
            catch { showRewardDialog({ reward, message: "请复制下方领取码。" }); }
          }); item.append(copy);
        }
        const wallet = document.createElement("a"); wallet.href = onlineClient.walletUrl; wallet.target = "_blank"; wallet.rel = "noopener"; wallet.textContent = "账户钱包"; item.append(wallet);
      }
      rewardList.append(item);
    }
  };

  const applyServerState = (payload) => {
    if (!payload) return;
    if (payload.user && activeRun && (activeRunGuest || (account && payload.user.id !== account.id))) {
      artGeneration++;
      playGeneration++;
      artLoadFlight = null;
      clearImageCache();
      if (checkpointTimer) clearTimeout(checkpointTimer);
      checkpointTimer = null;
      checkpointFlight = null;
      retryCheckpointPayload = null;
      activeRun = null;
      activePlay = null;
      activeRunGuest = false;
      gameReady = false;
      pendingMoves = [];
      checkpointNeeded = false;
      game = createGame({ height: BASE_FIELD_HEIGHT });
      overlay.hidden = true;
    }
    if (payload.profile) profile = {
      user_id: payload.user?.id ?? account?.id ?? null,
      best: Number(payload.profile.best) || 0,
      unlocked: Array.isArray(payload.profile.unlocked) ? payload.profile.unlocked.filter(Number.isInteger) : [1],
      egg_stages: Array.isArray(payload.profile.egg_stages) ? payload.profile.egg_stages.filter((key) => typeof key === "string") : [],
    };
    if (Array.isArray(payload.rewards)) rewards = payload.rewards;
    if (payload.user) account = payload.user;
    discoveries.sync(profile, account?.id ?? null);
    leaderboard.setAccount(account, payload.weekly_rewards);
    if (payload.user) accountState = "signed_in";
    adminAllowed = Number(account?.role) >= 10;
    if (!adminAllowed) resetAdminInventory();
    adminOpen.hidden = !adminAllowed;
    loginLink.hidden = Boolean(account);
    const accountLabel = document.querySelector("#account-label");
    accountLabel.hidden = !account;
    accountLabel.textContent = account ? `已登录：${account.username}` : "";
    renderRewards();
    renderGallery();
    renderEasterGallery();
    bestEl.textContent = String(account ? profile?.best ?? 0 : 0);
    if (account && profile) void loadAuthorizedArt();
  };

  const enterGuest = (state = "guest", reset = false) => {
    artGeneration++;
    playGeneration++;
    artLoadFlight = null;
    clearImageCache();
    if (checkpointTimer) clearTimeout(checkpointTimer);
    checkpointTimer = null;
    checkpointFlight = null;
    account = null; profile = null; rewards = []; adminAllowed = false;
    discoveries.sync(null, null);
    companion.reset();
    leaderboard.setAccount(null);
    if (giftDialog.open) giftDialog.close();
    rewardCode.value = '';
    resetAdminInventory();
    activeRun = null; activePlay = null; activeRunGuest = true; gameReady = false;
    pendingMoves = []; checkpointNeeded = false; retryCheckpointPayload = null; syncMessage = ""; accountState = state;
    adminOpen.hidden = true;
    loginLink.hidden = false;
    const accountLabel = document.querySelector("#account-label");
    accountLabel.hidden = true;
    if (reset) {
      game = createGame({ height: BASE_FIELD_HEIGHT, best: 0 });
      overlay.hidden = true;
    }
    updateHud();
  };

  const loadAuthorizedArt = async () => {
    if (!account || !profile) return;
    if (artLoadFlight) return artLoadFlight;
    const generation = artGeneration;
    const userId = account.id;
    const profileKey = JSON.stringify(profile);
    const flight = (async () => {
      try {
        const art = await import("./character-art.js");
        artModule = art;
        if (generation !== artGeneration || account?.id !== userId || typeof art.loadAccountArt !== "function") return;
        const fetchArt = async ({ level, variant } = {}) => {
          const blob = await onlineClient.requestArt({ level, variant });
          if (generation !== artGeneration || account?.id !== userId) throw new Error("账户已切换");
          return blob;
        };
        const registerCharacterForSession = (level, image) => {
          if (generation === artGeneration && account?.id === userId) registerCharacterImage(level, image);
        };
        const registerEasterForSession = (id, image, sourceRect, level) => {
          if (generation === artGeneration && account?.id === userId) registerEasterImage(id, image, sourceRect, level);
        };
        await art.loadAccountArt(profile, fetchArt, registerCharacterForSession, registerEasterForSession);
        if (generation === artGeneration && account?.id === userId) {
          canvas.dataset.art = "authorized";
          updateHud();
        }
      } catch (error) {
        if (generation === artGeneration) console.info("账户角色素材暂不可用，使用占位形象。", error);
      } finally {
        if (artLoadFlight === flight) {
          artLoadFlight = null;
          if (generation === artGeneration && account?.id === userId && JSON.stringify(profile) !== profileKey) {
            void loadAuthorizedArt();
          }
        }
      }
    })();
    artLoadFlight = flight;
    return flight;
  };

  const loadPlayingArtFor = async (play, run = activeRun, guest = activeRunGuest) => {
    if (!play || !run) return false;
    const generation = playGeneration;
    const runId = run.id;
    try {
      const art = artModule ?? await import("./character-art.js");
      artModule = art;
      if (generation !== playGeneration || activeRun?.id !== runId || typeof art.loadPlayingArt !== "function") return false;
      const isCurrentRun = () => generation === playGeneration && activeRun?.id === runId;
      const fetchArt = async ({ level, variant } = {}) => {
        const blob = await onlineClient.requestPlayingArt({ run_id: runId, level, variant, guest });
        if (!isCurrentRun()) throw new Error("游戏记录已切换");
        return blob;
      };
      const registerCharacterForRun = (level, image) => {
        if (isCurrentRun()) registerCharacterImage(level, image);
      };
      const registerEasterForRun = (id, image, sourceRect, level) => {
        if (isCurrentRun()) registerEasterImage(id, image, sourceRect, level);
      };
      await art.loadPlayingArt({ ...play, run_id: runId }, fetchArt, registerCharacterForRun, registerEasterForRun);
      if (isCurrentRun()) {
        updateHud();
        return true;
      }
      return false;
    } catch (error) {
      if (generation === playGeneration && activeRun?.id === runId) {
        console.info("本局角色图片暂不可用，等待重试。", error);
      }
      return false;
    }
  };

  const updatePlayingState = async (play, run = activeRun, guest = activeRunGuest) => {
    if (!play || !run || activeRun?.id !== run.id) return;
    activePlay = { ...play, run_id: run.id };
    await loadPlayingArtFor(activePlay, run, guest);
  };

  const startOnlineRun = async (generation = sessionGeneration) => {
    companion.reset();
    const guest = !account;
    activeRun = null;
    activePlay = null;
    activeRunGuest = guest;
    gameReady = false;
    playGeneration++;
    pendingMoves = [];
    retryCheckpointPayload = null;
    checkpointNeeded = false;
    game = createGame({ height: BASE_FIELD_HEIGHT, best: Number(profile?.best) || 0 });
    overlay.hidden = true;
    accountState = "starting_run";
    updateHud();
    renderRewards();
    try {
      if (guest) {
        clearImageCache();
      }
      const response = guest
        ? await onlineClient.startGuestRun()
        : await onlineClient.startRun(BASE_FIELD_HEIGHT);
      if (generation !== sessionGeneration) return false;
      if (!response.run?.id || response.run.seed === undefined || response.run.variant_seed === undefined) {
        throw new Error("游戏记录服务返回的数据不完整。");
      }
      const run = response.run;
      activeRun = run;
      activeRunGuest = guest || Boolean(run.guest);
      activePlay = response.play ? { ...response.play, run_id: run.id } : null;
      pendingMoves = [];
      retryCheckpointPayload = null;
      checkpointNeeded = false;
      game = createGame({
        height: BASE_FIELD_HEIGHT,
        best: Number(profile?.best) || 0,
        random: seededRandom(run.seed),
        variantRandom: seededRandom(run.variant_seed),
      });
      if (!activePlay || !(await loadPlayingArtFor(activePlay, run, activeRunGuest))) {
        throw new Error("本局角色图片暂不可用，请重试。");
      }
      if (generation !== sessionGeneration || activeRun?.id !== run.id) return false;
      gameReady = true;
      accountState = "signed_in";
      if (guest) accountState = "guest";
      syncMessage = "";
      failedSyncPending = false;
      overlay.hidden = true;
      updateHud();
      return true;
    } catch (error) {
      if (generation !== sessionGeneration) return false;
      playGeneration++;
      activeRun = null;
      activePlay = null;
      gameReady = false;
      accountState = "run_error";
      syncMessage = error.message || "游戏记录暂时无法建立，请重试。";
      renderRewards();
      sayToast(syncMessage);
      return false;
    }
  };

  const loadAccount = async (resetWhenGuest = false) => {
    const generation = sessionGeneration;
    try {
      const payload = await onlineClient.getMe();
      if (generation !== sessionGeneration) return;
      if (!payload?.user) {
        if (account || resetWhenGuest) enterGuest("guest", true);
        else { accountState = "guest"; updateHud(); }
        await startOnlineRun(generation);
        return;
      }
      const sameAccountWithRun = account?.id === payload.user.id && activeRun && gameReady;
      applyServerState(payload);
      if (sameAccountWithRun) return;
      await startOnlineRun(generation);
    } catch (error) {
      if (generation !== sessionGeneration) return;
      if (account || resetWhenGuest) enterGuest("offline", true);
      else { enterGuest("offline", true); syncMessage = error.message || "连接暂时不可用。"; updateHud(); }
      await startOnlineRun(generation);
    }
  };

  const updateHud = () => {
    scoreEl.textContent = String(game.score);
    game.best = Math.max(game.best, game.score);
    bestEl.textContent = String(account ? Math.max(profile?.best ?? 0, game.score) : 0);
    drawMini(brandCanvas, 1);
    if (!overlay.hidden) drawMini(gameoverCanvas, Math.max(...game.unlocked));
    drawMini(nextCanvas, game.nextLevel, false, game.nextVariant);
    renderRewards();
    renderGallery();
    renderEasterGallery();
    fishProps.render();
  };

  const flushCheckpoint = async () => {
    if (!activeRun) return pendingMoves.length === 0;
    if (checkpointTimer) { clearTimeout(checkpointTimer); checkpointTimer = null; }
    if (checkpointFlight) {
      const ok = await checkpointFlight;
      if (!ok) return false;
      if (pendingMoves.length) return flushCheckpoint();
      return true;
    }
    if (!pendingMoves.length && !checkpointNeeded) return true;
    const run = activeRun;
    const payload = retryCheckpointPayload ?? {
      run_id: run.id,
      step: game.stepIndex,
      moves: pendingMoves.slice(),
    };
    const moves = payload.moves;
    const sentVersion = checkpointVersion;
    const flight = (async () => {
      try {
        const response = activeRunGuest
          ? await onlineClient.checkpointGuest(payload)
          : await onlineClient.checkpoint(payload);
        if (activeRun !== run) return false;
        pendingMoves.splice(0, moves.length);
        retryCheckpointPayload = null;
        lastCheckpointAt = Date.now();
        if (checkpointVersion === sentVersion) checkpointNeeded = false;
        syncMessage = "";
        if (account) applyServerState(response);
        if (account) void leaderboard.refresh();
        if (response.play) void updatePlayingState(response.play, run, activeRunGuest);
        return true;
      } catch (error) {
        if (activeRun !== run) return false;
        const invalidRun = error instanceof OnlineApiError && (
          [404, 410].includes(error.status) || ["RUN_INVALID", "RUN_NOT_FOUND", "RUN_EXPIRED"].includes(error.code)
        );
        if (invalidRun) {
          playGeneration++;
          activeRun = null;
          activePlay = null;
          gameReady = false;
          pendingMoves = [];
          retryCheckpointPayload = null;
          syncMessage = "本局记录已失效，请重新开始。";
          sayToast(syncMessage);
        } else if (error instanceof OnlineApiError && error.status === 401 && !activeRunGuest) {
          enterGuest("guest", true);
          void startOnlineRun();
          return false;
        } else if (error instanceof OnlineApiError && error.status === 401) {
          playGeneration++;
          activeRun = null;
          activePlay = null;
          gameReady = false;
          pendingMoves = [];
          retryCheckpointPayload = null;
          syncMessage = "本局游戏记录已失效，请重新开始。";
          sayToast(syncMessage);
        } else {
          retryCheckpointPayload = payload;
          syncMessage = "进度同步失败，操作已保留，稍后会重试。";
        }
        renderRewards();
        return false;
      }
    })();
    checkpointFlight = flight;
    const success = await flight;
    if (checkpointFlight === flight) checkpointFlight = null;
    if (success && (pendingMoves.length || checkpointNeeded)) return flushCheckpoint();
    if (!success && (pendingMoves.length || checkpointNeeded) && activeRun === run && !checkpointTimer) {
      checkpointTimer = setTimeout(() => { checkpointTimer = null; void flushCheckpoint(); }, 4500);
    }
    return success;
  };

  const checkpointClean = () => {
    pendingMoves = []; checkpointNeeded = false; checkpointVersion++;
    retryCheckpointPayload = null;
    if (checkpointTimer) clearTimeout(checkpointTimer);
    checkpointTimer = null; checkpointFlight = null;
  };

  const fishProps = createFishPropsUI({
    account: () => account,
    activeRun: () => activeRun,
    guestRun: () => activeRunGuest,
    gameReady: () => gameReady,
    getGame: () => game,
    setGame: (snapshot) => {
      game = {
        ...structuredClone(snapshot), width: FIELD_WIDTH, height: BASE_FIELD_HEIGHT,
        random: seededRandom(snapshot.randomState), variantRandom: seededRandom(snapshot.variantState),
        unlocked: new Set(snapshot.unlocked ?? [1]), seenEggs: new Set(snapshot.seenEggs ?? []),
        seenEggStages: new Set(snapshot.seenEggStages ?? []), propSelectionIds: [],
      };
    },
    getCanvasScale: () => ({ scale: gameScale, offsetX: gameOffsetX, offsetY: gameOffsetY }),
    client: onlineClient,
    getBlocked: () => Boolean(fishSaves?.isLocked()),
    flushCheckpoint,
    checkpointClean,
    refreshGame: (payload, isPlay = false) => {
      if (isPlay) void updatePlayingState(payload, activeRun, false);
      else applyServerState(payload);
    },
    refreshLeaderboard: () => { void leaderboard.refresh(true); },
    toast: sayToast,
    renderFinal: (state) => {
      if (state.over) {
        document.querySelector("#final-score").textContent = String(state.score);
        drawMini(gameoverCanvas, Math.max(...state.unlocked));
      }
      updateHud();
    },
    focusCanvas: () => canvas.focus({ preventScroll: true }),
    settled: () => {
      const kind = deferredSessionKind;
      deferredSessionKind = null;
      if (!kind) return;
      if (kind === "signed_out") { enterGuest("guest", true); void startOnlineRun(); }
      else void loadAccount(true).then(() => { if (fishSaves?.isOpen()) void fishSaves.refresh(); });
    },
  });

  fishSaves = setupFishSavesUI({
    account: () => account,
    activeRun: () => activeRun,
    gameReady: () => gameReady,
    getGame: () => game,
    setGame: (state) => {
      game = hydrateGameState(state, { width: FIELD_WIDTH, height: BASE_FIELD_HEIGHT });
      overlay.hidden = !game.over;
      if (game.over) document.querySelector("#final-score").textContent = String(game.score);
      updateHud();
    },
    client: onlineClient,
    flushCheckpoint,
    checkpointClean,
    updateRun: (run, play) => {
      playGeneration++;
      activeRun = run; activeRunGuest = false; activePlay = play ? { ...play, run_id: run.id } : null;
      gameReady = true;
      pendingMoves = []; retryCheckpointPayload = null; checkpointNeeded = false;
      if (checkpointTimer) clearTimeout(checkpointTimer);
      checkpointTimer = null; checkpointFlight = null;
    },
    refreshGame: (payload, isPlay = false) => {
      if (isPlay) void updatePlayingState(payload, activeRun, false);
      else if (payload) applyServerState(payload);
    },
    refreshLeaderboard: () => { void leaderboard.refresh(true); },
    pauseChanged: (paused) => { if (paused) accumulator = 0; fishProps.render(); },
    canOpen: () => !fishProps.hasPending() && !fishProps.isSelecting(),
    settled: () => {
      const kind = deferredSessionKind;
      deferredSessionKind = null;
      if (!kind) return;
      if (kind === "signed_out") { enterGuest("guest", true); void startOnlineRun(); }
      else void loadAccount(true).then(() => { if (fishSaves?.isOpen()) void fishSaves.refresh(); });
    },
    physicsVersion: PHYSICS_VERSION,
  });

  const scheduleCheckpoint = () => {
    if (!activeRun || (!pendingMoves.length && !checkpointNeeded) || checkpointTimer) return;
    const delay = Math.max(500, 8000 - (Date.now() - lastCheckpointAt));
    checkpointTimer = setTimeout(() => { checkpointTimer = null; void flushCheckpoint(); }, delay);
  };

  const markCheckpointNeeded = () => {
    checkpointVersion++;
    checkpointNeeded = true;
    scheduleCheckpoint();
  };

  const populateCampaigns = (campaigns, preferredId = adminCampaign.value) => {
    adminCampaign.replaceChildren();
    for (const campaign of ensureAdminCampaigns(campaigns, false)) {
      const option = document.createElement("option");
      option.value = campaign.id;
      option.textContent = campaign.isDefault
        ? `${campaign.title} · 默认奖池（第 ${campaign.min_level} 级）`
        : `${campaign.title}${campaign.kind === 'weekly' ? ' · 周榜冠军' : ''} · ${campaign.remaining ?? 0}/${campaign.total ?? 0}`;
      option.dataset.title = campaign.title ?? "首次合成谢礼";
      option.dataset.level = String(campaign.min_level ?? GIFT_LEVEL);
      option.dataset.kind = campaign.kind || 'level';
      option.dataset.total = String(campaign.total || 0);
      adminCampaign.append(option);
    }
    const preferred = [...adminCampaign.options].find((option) => option.value === preferredId)
      ?? [...adminCampaign.options].find((option) => option.value === "first-fat-fish-6");
    if (preferred) adminCampaign.value = preferred.value;
    syncCampaignFields();
  };

  const syncCampaignFields = () => {
    const option = adminCampaign.selectedOptions[0];
    adminDeleteCampaign.disabled = !option || deletingCampaign;
    if (!option) {
      document.querySelector('#admin-campaign-title').value = '';
      document.querySelector('#admin-min-level').value = '';
      return;
    }
    document.querySelector("#admin-campaign-title").value = option.dataset.title || "首次合成谢礼";
    const weekly = option.dataset.kind === 'weekly';
    document.querySelector('#admin-rule-label').textContent = weekly ? '发奖条件' : '解锁等级';
    document.querySelector("#admin-min-level").value = weekly ? '每周榜一' : option.dataset.level || String(GIFT_LEVEL);
  };

  const refreshAdminSelection = () => {
    const total = adminCandidateItems.size;
    const selected = [...adminCandidateItems.values()].filter(({ checkbox }) => checkbox.checked).length;
    const busy = adminImporting || adminSearching || adminStockRemoving || deletingCampaign;
    adminImport.disabled = !adminAllowed || busy || adminCreating || selected === 0 || !adminCampaign.value;
    adminImport.textContent = adminImporting ? "正在导入……" : selected ? `导入所选奖品（${selected}）` : "导入所选奖品";
    adminSelectAll.disabled = !adminAllowed || busy || total === 0;
    adminSelectAll.checked = total > 0 && selected === total;
    adminSelectAll.indeterminate = selected > 0 && selected < total;
    adminSelectionCount.textContent = `已选 ${selected} / ${total}`;
    for (const { checkbox } of adminCandidateItems.values()) checkbox.disabled = busy;
    document.querySelector('#admin-search-form button').disabled = busy;
    adminCampaign.disabled = adminImporting || adminStockRemoving;
    adminNewCampaignOpen.disabled = adminImporting || adminCreating || adminStockRemoving;
    adminDeleteCampaign.disabled = !adminAllowed || busy || adminCreating || adminStockLoading || !adminCampaign.value;
    if (deletingCampaign) {
      adminCampaign.disabled = true;
      adminNewCampaignOpen.disabled = true;
    }
    document.querySelector('#admin-mode-import').disabled = adminImporting || adminStockRemoving;
    document.querySelector('#admin-mode-stock').disabled = adminImporting || adminStockRemoving;
    refreshAdminStockSelection();
  };

  const renderAdminCandidates = (items) => {
    adminCandidatesEl.replaceChildren();
    adminCandidateItems.clear();
    for (const item of items ?? []) {
      const row = document.createElement("label"); row.className = "admin-candidate";
      const main = document.createElement("span"); main.className = "admin-candidate-main";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = String(item.id);
      checkbox.addEventListener("change", refreshAdminSelection);
      const name = document.createElement("span"); name.textContent = item.name || `奖品 ${item.id}`;
      main.append(checkbox, name);
      const metadata = document.createElement("small");
      const quota = formatRewardQuota(item.quota) || "0";
      const expiry = formatRewardExpiry(item.expired_time) || "无到期时间";
      metadata.textContent = `额度 ${quota} · ${expiry} · 未使用`;
      row.append(main, metadata);
      adminCandidatesEl.append(row);
      adminCandidateItems.set(String(item.id), { item, checkbox });
    }
    refreshAdminSelection();
  };

  function refreshAdminStockSelection() {
    const eligible = [...adminStockItems.values()].filter(({ item }) => item.removable);
    const selected = eligible.filter(({ checkbox }) => checkbox.checked).length;
    const busy = adminStockLoading || adminStockRemoving || adminImporting || adminCreating;
    adminStockAll.disabled = !adminAllowed || busy || !eligible.length;
    adminStockAll.checked = eligible.length > 0 && selected === eligible.length;
    adminStockAll.indeterminate = selected > 0 && selected < eligible.length;
    document.querySelector('#admin-stock-count').textContent = `已选 ${selected} / ${eligible.length}`;
    for (const { item, checkbox } of adminStockItems.values()) checkbox.disabled = busy || !item.removable;
    adminStockRemove.disabled = !adminAllowed || busy || !selected;
    adminStockRemove.textContent = adminStockRemoving ? '正在移除……' : selected ? `从活动移除所选（${selected}）` : '从活动移除所选';
    document.querySelector('#admin-stock-prev').disabled = busy || adminStockPage <= 1;
    document.querySelector('#admin-stock-next').disabled = busy || adminStockPage * 100 >= adminStockTotal;
    document.querySelector('#admin-stock-refresh').disabled = busy;
    document.querySelector('#admin-stock-page').textContent = `第 ${adminStockPage} / ${Math.max(1, Math.ceil(adminStockTotal / 100))} 页`;
  }

  function resetAdminInventory() {
    adminStockRequest++;
    adminStockItems.clear();
    adminStockList.replaceChildren();
    adminStockLoading = false;
    adminStockTotal = 0;
    adminStockPage = 1;
    adminNewCampaignForm.hidden = true;
    renderAdminCandidates([]);
    if (adminDialog.open) adminDialog.close();
  }

  function renderAdminStock(items) {
    adminStockList.replaceChildren();
    adminStockItems.clear();
    for (const item of items) {
      const row = document.createElement('label');
      row.className = `admin-candidate${item.status === 'claimed' ? ' is-claimed' : ''}`;
      const main = document.createElement('span'); main.className = 'admin-candidate-main';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
      checkbox.addEventListener('change', refreshAdminStockSelection);
      const name = document.createElement('span'); name.textContent = `#${item.redemption_id} ${item.name || '兑换码'} · ${item.code_hint}`;
      const metadata = document.createElement('small');
      const state = item.status === 'claimed' ? '已领取 · 保留记录' : item.status === 'expired' ? '已过期' : '可发放';
      metadata.textContent = `额度 ${formatRewardQuota(item.quota)} · ${state}`;
      main.append(checkbox, name); row.append(main, metadata); adminStockList.append(row);
      adminStockItems.set(item.redemption_id, { item, checkbox });
    }
    refreshAdminStockSelection();
  }

  async function loadAdminStock(page = 1) {
    if (!adminAllowed || !adminCampaign.value) return;
    const userId = account.id;
    const campaignId = adminCampaign.value;
    const requestId = ++adminStockRequest;
    adminStockPage = page;
    adminStockTotal = 0;
    adminStockLoading = true;
    renderAdminStock([]);
    adminStockStatus.textContent = '正在加载活动内兑换码……';
    try {
      const response = await onlineClient.getAdminPrizes(campaignId, page);
      if (requestId !== adminStockRequest || account?.id !== userId || adminCampaign.value !== campaignId || !adminAllowed) return;
      if (page > 1 && !response.items.length) return await loadAdminStock(Math.max(1, Math.ceil(response.total / 100)));
      adminStockTotal = response.total;
      renderAdminStock(response.items);
      adminStockStatus.textContent = response.total ? `活动内共 ${response.total} 个兑换码，每页最多 100 个。` : '当前活动尚无兑换码，可在「导入奖品」中添加。';
    } catch (error) {
      if (requestId === adminStockRequest && account?.id === userId) adminStockStatus.textContent = error.message || '读取失败，请刷新列表。';
    } finally {
      if (requestId === adminStockRequest) {
        adminStockLoading = false;
        refreshAdminStockSelection();
      }
    }
  }

  const playTone = (level) => {
    if (muted) return;
    try {
      audioContext ||= new AudioContext();
      if (audioContext.state === "suspended") audioContext.resume();
      const now = audioContext.currentTime;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = "sine"; osc.frequency.setValueAtTime(410 + level * 42, now); osc.frequency.exponentialRampToValueAtTime(760 + level * 56, now + .12);
      gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.045, now + .015); gain.gain.exponentialRampToValueAtTime(.0001, now + .19);
      osc.connect(gain).connect(audioContext.destination); osc.start(now); osc.stop(now + .2);
    } catch { /* Browser audio may be unavailable; gameplay remains unaffected. */ }
  };

  const resizeCanvas = () => {
    const rect = wrapper.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    gameScale = Math.min(rect.width / FIELD_WIDTH, rect.height / BASE_FIELD_HEIGHT);
    gameOffsetX = (rect.width - FIELD_WIDTH * gameScale) / 2;
    gameOffsetY = (rect.height - BASE_FIELD_HEIGHT * gameScale) / 2;
    ctx.setTransform(dpr * gameScale, 0, 0, dpr * gameScale, dpr * gameOffsetX, dpr * gameOffsetY);
    game.width = FIELD_WIDTH; game.height = BASE_FIELD_HEIGHT;
    game.aimX = clamp(game.aimX, 30, FIELD_WIDTH - 30);
  };

  const aimFromEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left - gameOffsetX) / gameScale;
    game.aimX = clamp(x, radiusForLevel(game.currentLevel) + 7, FIELD_WIDTH - radiusForLevel(game.currentLevel) - 7);
  };
  const drop = () => {
    if (fishProps.isPaused() || fishSaves?.isPaused()) return;
    if (!activeRun || !gameReady) {
      sayToast(syncMessage || "游戏记录不可用，请重新开始。");
      return;
    }
    const move = { step: game.stepIndex, x: game.aimX };
    const body = dropBody(game, game.aimX);
    if (body) {
      companion.observe(discoveries.observe(game));
      pendingMoves.push(move);
      if (body.variant) {
        markCheckpointNeeded();
      } else scheduleCheckpoint();
      playTone(body.level);
      if (body.variant) sayEggToast(body.variant);
      updateHud();
    }
  };

  canvas.addEventListener("pointermove", aimFromEvent);
  canvas.addEventListener("pointerdown", (event) => {
    aimFromEvent(event);
    canvas.focus({ preventScroll: true });
    if (fishProps.isSelecting()) {
      event.preventDefault();
      fishProps.selectFish(event);
      return;
    }
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.preventDefault();
      aimingPointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    event.preventDefault();
    drop();
  });
  canvas.addEventListener("pointerup", (event) => {
    if (event.pointerId !== aimingPointerId) return;
    aimFromEvent(event);
    aimingPointerId = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drop();
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (event.pointerId !== aimingPointerId) return;
    aimingPointerId = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("keydown", (event) => {
    if (fishProps.handleKeyDown(event)) return;
    if (event.code === "Space") { event.preventDefault(); drop(); }
    else if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      event.preventDefault(); game.aimX = clamp(game.aimX + (event.code === "ArrowLeft" ? -24 : 24), 30, FIELD_WIDTH - 30);
    }
    else if (event.code === "Enter") { event.preventDefault(); drop(); }
  });
  canvas.addEventListener("pointerleave", () => {});
  document.querySelector("#restart").addEventListener("click", () => resetGame());
  document.querySelector("#play-again").addEventListener("click", () => resetGame());
  document.querySelector("#sound-toggle").addEventListener("click", (event) => {
    muted = !muted;
    const button = event.currentTarget;
    button.setAttribute("aria-pressed", String(!muted));
    button.setAttribute("aria-label", muted ? "开启音效" : "关闭音效");
    button.querySelector(".sound-label").textContent = muted ? "音效：关" : "音效：开";
    if (!muted) playTone(1);
  });
  document.querySelector("#close-gift").addEventListener("click", () => giftDialog.close());
  document.querySelector("#show-easter-eggs").addEventListener("click", () => easterDialog.showModal());
  document.querySelector("#close-easter-eggs").addEventListener("click", () => easterDialog.close());
  document.querySelector("#admin-close").addEventListener("click", () => adminDialog.close());
  adminDeleteCampaign.addEventListener('click', () => {
    if (!adminAllowed || deletingCampaign || adminImporting || adminCreating || adminStockRemoving || adminSearching) return;
    const option = adminCampaign.selectedOptions[0];
    if (!option) return;
    deleteTarget = { id: option.value, owner: account.id };
    document.querySelector('#campaign-delete-copy').textContent = `删除“${option.dataset.title}”？该活动内共 ${option.dataset.total} 个码。未领取且未分配周奖的码会解除奖池分配；已发奖励和领取记录保留。New API 原码不受影响。`;
    deleteConfirm.disabled = false;
    deleteDialog.showModal();
  });
  document.querySelector('#campaign-delete-cancel').addEventListener('click', () => deleteDialog.close());
  deleteConfirm.addEventListener('click', async () => {
    if (!deleteTarget || deletingCampaign || !adminAllowed || account?.id !== deleteTarget.owner) return;
    const target = deleteTarget;
    deletingCampaign = true;
    deleteConfirm.disabled = true;
    refreshAdminSelection();
    try {
      const response = await onlineClient.deleteAdminCampaign(target.id);
      if (!adminAllowed || account?.id !== target.owner) return;
      adminStockRequest++;
      adminStockLoading = false;
      adminStockTotal = 0;
      adminStockPage = 1;
      renderAdminStock([]);
      renderAdminCandidates([]);
      populateCampaigns(response.campaigns);
      adminStatus.textContent = `活动已删除，释放 ${response.removed_prizes} 个未发码，保留 ${response.retained_prizes} 个已发或已分配记录。`;
      adminStockStatus.textContent = adminCampaign.value ? '请选择刷新列表查看当前活动。' : '暂无活动，请先新建活动。';
      deleteDialog.close();
      const state = await onlineClient.getMe();
      if (state?.user?.id === target.owner && account?.id === target.owner) applyServerState(state);
    } catch (error) {
      if (account?.id === target.owner) document.querySelector('#campaign-delete-copy').textContent = error.message || '删除失败，请稍后重试。';
    } finally {
      deletingCampaign = false;
      deleteConfirm.disabled = false;
      refreshAdminSelection();
    }
  });
  adminOpen.addEventListener("click", async () => {
    if (!adminAllowed) return;
    adminDialog.showModal();
    const userId = account.id;
    try {
      const response = await onlineClient.getAdminCampaigns();
      if (account?.id === userId && adminAllowed) {
        populateCampaigns(response.campaigns);
        if (!adminStockPanel.hidden) void loadAdminStock();
      }
    } catch (error) {
      if (account?.id === userId) adminStatus.textContent = error.message || "活动列表加载失败，请重试。";
    }
  });
  adminCampaign.addEventListener("change", () => {
    syncCampaignFields();
    adminStockRequest++;
    renderAdminStock([]);
    if (!adminStockPanel.hidden) void loadAdminStock();
  });
  document.querySelector('#admin-mode-import').addEventListener('click', () => {
    if (adminStockRemoving) return;
    adminStockPanel.hidden = true;
    document.querySelector('#admin-import-panel').hidden = false;
    document.querySelector('#admin-mode-import').setAttribute('aria-pressed', 'true');
    document.querySelector('#admin-mode-stock').setAttribute('aria-pressed', 'false');
  });
  document.querySelector('#admin-mode-stock').addEventListener('click', () => {
    if (adminImporting) return;
    adminStockPanel.hidden = false;
    document.querySelector('#admin-import-panel').hidden = true;
    document.querySelector('#admin-mode-import').setAttribute('aria-pressed', 'false');
    document.querySelector('#admin-mode-stock').setAttribute('aria-pressed', 'true');
    adminStatus.textContent = '勾选可移除项后操作，已领取的码会保留记录。';
    void loadAdminStock();
  });
  adminStockAll.addEventListener('change', () => {
    for (const { item, checkbox } of adminStockItems.values()) if (item.removable) checkbox.checked = adminStockAll.checked;
    refreshAdminStockSelection();
  });
  document.querySelector('#admin-stock-prev').addEventListener('click', () => { void loadAdminStock(adminStockPage - 1); });
  document.querySelector('#admin-stock-next').addEventListener('click', () => { void loadAdminStock(adminStockPage + 1); });
  document.querySelector('#admin-stock-refresh').addEventListener('click', () => { void loadAdminStock(adminStockPage); });
  adminStockRemove.addEventListener('click', async () => {
    const ids = [...adminStockItems.values()].filter(({ item, checkbox }) => item.removable && checkbox.checked).map(({ item }) => item.redemption_id);
    if (!adminAllowed || !ids.length || adminStockLoading || adminStockRemoving || adminImporting || adminCreating) return;
    const userId = account.id;
    const campaignId = adminCampaign.value;
    adminStockRemoving = true;
    refreshAdminSelection();
    try {
      const response = await onlineClient.removeAdminPrizes({ campaign_id: campaignId, ids });
      if (account?.id !== userId || !adminAllowed) return;
      populateCampaigns(response.campaigns, campaignId);
      adminStatus.textContent = `已从活动移除 ${response.removed} 个${response.skipped ? `，${response.skipped} 个已领取或不在本活动，未移除` : ''}。New API 原码保留，可重新导入。`;
      renderAdminCandidates([]);
      await loadAdminStock(adminStockPage);
      const updated = await onlineClient.getMe();
      if (account?.id === userId && updated?.user?.id === userId) applyServerState(updated);
    } catch (error) {
      if (account?.id === userId) adminStatus.textContent = error.message || '移除失败，请刷新后重试。';
    } finally {
      adminStockRemoving = false;
      refreshAdminSelection();
    }
  });
  adminNewCampaignOpen.addEventListener("click", () => {
    adminNewCampaignForm.hidden = false;
    document.querySelector('#admin-new-title').focus();
  });
  document.querySelector('#admin-new-kind').addEventListener('change', () => {
    const weekly = document.querySelector('#admin-new-kind').value === 'weekly';
    document.querySelector('#admin-new-level-field').hidden = weekly;
    document.querySelector('#admin-new-min-level').disabled = weekly;
    document.querySelector('#admin-new-rule-copy').textContent = weekly
      ? '专用于周榜第一名，每周发一张。不会按合成等级发放；缺货时保留冠军资格，补货后自动补发。'
      : '每个账户达到该等级后，可领取本活动的一个兑换码。创建后再导入奖品。';
  });
  document.querySelector('#admin-cancel-campaign').addEventListener('click', () => {
    if (!adminCreating) adminNewCampaignForm.hidden = true;
  });
  adminNewCampaignForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!adminAllowed || adminCreating || adminImporting || adminStockRemoving) return;
    const userId = account.id;
    const title = document.querySelector('#admin-new-title').value.trim();
    const kind = document.querySelector('#admin-new-kind').value;
    const min_level = kind === 'weekly' ? 2 : Number(document.querySelector('#admin-new-min-level').value);
    if (!title || title.length > 80 || !Number.isInteger(min_level) || min_level < 2 || min_level > 11) {
      adminStatus.textContent = '请填写活动名称和 2～11 的整数解锁等级。';
      return;
    }
    adminCreating = true;
    adminCreateCampaign.disabled = true;
    adminCreateCampaign.textContent = '正在创建……';
    refreshAdminSelection();
    try {
      const response = await onlineClient.createAdminCampaign({ title, min_level, kind });
      if (account?.id !== userId || !adminAllowed) return;
      populateCampaigns(response.campaigns, response.campaign.id);
      if (!adminStockPanel.hidden) void loadAdminStock();
      adminNewCampaignForm.reset();
      document.querySelector('#admin-new-kind').dispatchEvent(new Event('change'));
      adminNewCampaignForm.hidden = true;
      adminStatus.textContent = `已创建「${response.campaign.title}」，勾选兑换码后即可导入。`;
      const updated = await onlineClient.getMe();
      if (updated?.user?.id === userId && account?.id === userId) applyServerState(updated);
    } catch (error) {
      if (account?.id === userId) adminStatus.textContent = error.message || '创建失败，请重试。';
    } finally {
      adminCreating = false;
      adminCreateCampaign.disabled = false;
      adminCreateCampaign.textContent = '创建活动';
      refreshAdminSelection();
    }
  });
  adminSelectAll.addEventListener('change', () => {
    for (const { checkbox } of adminCandidateItems.values()) checkbox.checked = adminSelectAll.checked;
    refreshAdminSelection();
  });
  document.querySelector("#admin-search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!adminAllowed) { adminStatus.textContent = "需要管理员账户。"; return; }
    if (adminSearching || adminImporting || adminStockRemoving) return;
    const userId = account.id;
    adminSearching = true;
    renderAdminCandidates([]);
    adminStatus.textContent = "正在搜索……";
    try {
      const response = await onlineClient.getAdminCandidates(document.querySelector("#admin-keyword").value.trim());
      if (account?.id !== userId || !adminAllowed) return;
      populateCampaigns(response.campaigns);
      renderAdminCandidates(response.items);
      adminStatus.textContent = response.items?.length ? `找到 ${response.items.length} 个可检查的奖品。` : "没有找到可用奖品。";
    } catch (error) {
      if (account?.id === userId) adminStatus.textContent = error.message || "搜索失败，请稍后重试。";
    } finally {
      adminSearching = false;
      refreshAdminSelection();
    }
  });
  adminImport.addEventListener("click", async () => {
    const ids = toNumericCandidateIds(adminCandidateItems.entries());
    const campaignId = adminCampaign.value;
    if (!adminAllowed || !ids.length || !campaignId || adminImporting || adminSearching || adminCreating || adminStockRemoving) return;
    const userId = account.id;
    adminImporting = true;
    refreshAdminSelection();
    adminStatus.textContent = "正在导入……";
    try {
      const response = await onlineClient.importAdminCandidates({
        ids,
        campaign_id: campaignId,
        kind: adminCampaign.selectedOptions[0]?.dataset.kind || 'level',
        title: document.querySelector("#admin-campaign-title").value.trim(),
        min_level: adminCampaign.selectedOptions[0]?.dataset.kind === 'weekly' ? 2 : Number(document.querySelector("#admin-min-level").value),
      });
      if (account?.id !== userId || !adminAllowed) return;
      adminStatus.textContent = `已导入 ${response.imported ?? 0} 个，跳过 ${response.skipped ?? 0} 个，剩余 ${response.remaining ?? 0} 个。`;
      const refreshed = await onlineClient.getAdminCandidates(document.querySelector("#admin-keyword").value.trim());
      if (account?.id !== userId || !adminAllowed) return;
      populateCampaigns(refreshed.campaigns); renderAdminCandidates(refreshed.items);
      const updatedAccount = await onlineClient.getMe();
      if (updatedAccount?.user?.id === userId && account?.id === userId) applyServerState(updatedAccount);
    } catch (error) {
      if (account?.id === userId) adminStatus.textContent = error.message || "导入失败，请稍后重试。";
    } finally {
      adminImporting = false;
      refreshAdminSelection();
    }
  });

  async function resetGame() {
    if (fishProps.hasPending() || fishSaves?.isLocked()) { sayToast("存档或道具请求结果确认前，本局已暂停。请先重试确认同一请求。"); return; }
    if (fishProps.isSelecting()) fishProps.cancelSelection();
    if (activeRun && (pendingMoves.length || checkpointNeeded) && !(await flushCheckpoint())) {
      sayToast(syncMessage || "进度未同步，请稍后重试。");
      return;
    }
    overlay.hidden = true;
    companion.reset();
    canvas.focus({ preventScroll: true });
    await startOnlineRun();
  }

  document.addEventListener("visibilitychange", () => { lastTime = 0; accumulator = 0; });

  const frame = (time) => {
    if (document.hidden) { lastTime = 0; accumulator = 0; requestAnimationFrame(frame); return; }
    if (fishProps.isPaused() || fishSaves?.isPaused()) {
      lastTime = time;
      accumulator = 0;
      drawGame(ctx, game, { width: FIELD_WIDTH, height: game.height });
      requestAnimationFrame(frame);
      return;
    }
    if (!lastTime) lastTime = time;
    accumulator += Math.min(.05, (time - lastTime) / 1000);
    lastTime = time;
    const fixedStep = 1 / 60;
    let changed = false;
    while (accumulator >= fixedStep) {
      const result = stepGame(game, fixedStep);
      if (result.merged.length) {
        changed = true;
        if (activeRun) {
          markCheckpointNeeded();
        }
        companion.observe(discoveries.observe(game));
        for (const body of result.merged) {
          if (time - lastMergeSound > 130) playTone(body.level);
          lastMergeSound = time;
          if (!body.variant || !sayEggToast(body.variant, time)) sayToast(`合成第 ${body.level} 级 +${awardForLevel(body.level)}`);
        }
      }
      if (result.failed) {
        companion.observe([{ type: 'end' }]);
        document.querySelector("#final-score").textContent = String(game.score);
        drawMini(gameoverCanvas, Math.max(...game.unlocked));
        overlay.hidden = false;
        if (activeRun) void flushCheckpoint();
      }
      accumulator -= fixedStep;
    }
    drawGame(ctx, game, { width: FIELD_WIDTH, height: game.height });
    companion.observe([]);
    if (changed) updateHud();
    requestAnimationFrame(frame);
  };

  new ResizeObserver(resizeCanvas).observe(wrapper);
  resizeCanvas(); updateHud(); void fishProps.load(); requestAnimationFrame(frame);
  onlineClient.onSessionChange((kind) => {
    sessionGeneration++;
    if (fishProps.hasPending() || fishSaves?.isLocked()) {
      deferredSessionKind = kind;
      return;
    }
    if (kind === "signed_out") {
      enterGuest("guest", true);
      void startOnlineRun().then(() => { if (fishSaves?.isOpen()) void fishSaves.refresh(); });
    }
    else void loadAccount(true).then(() => { if (fishSaves?.isOpen()) void fishSaves.refresh(); });
  });
  void loadAccount(false);
}

if (typeof document !== "undefined") setupUI();
