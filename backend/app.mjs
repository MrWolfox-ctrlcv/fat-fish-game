import { createServer } from 'node:http';
import { readdir } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { GameStore } from './store.mjs';
import { initialState } from './replay.mjs';
import * as preparedArt from './art.mjs';
import { createReplayVerifier } from './replay-verifier.mjs';
import { createStaticAssets, sendPrivateArt } from './http-assets.mjs';
import { createCompanion } from './companion.mjs';
import { previousWeek, publicName, weekFor } from './weekly.mjs';
import { PHYSICS_VERSION } from '../dist/physics-version.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const sha = (value) => createHash('sha256').update(value).digest('hex');
const seed = () => randomBytes(4).readUInt32LE() || 1;

function requireCurrentPhysics(input) {
  if (input?.physics_version !== PHYSICS_VERSION) {
    throw fail(409, '游戏已更新，请刷新页面后开始新一局。', 'GAME_UPDATED');
  }
}

export async function createGameServer(options = {}) {
  const base = options.base ?? '/games/fat-fish/';
  const upstream = options.upstream ?? process.env.NEWAPI_URL ?? 'http://127.0.0.1:3000';
  const origins = new Set(options.origins ?? (process.env.GAME_ORIGINS || 'http://127.0.0.1:4180,http://localhost:4180').split(','));
  const store = options.store ?? new GameStore(options.dbPath ?? process.env.GAME_DB ?? new URL('../data/game.sqlite', import.meta.url).pathname);
  const art = options.art ?? preparedArt;
  if (!options.art && process.env.NODE_ENV === 'production') await preparedArt.validatePreparedArt();
  const fetcher = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const staticRoot = new URL('../dist/', import.meta.url);
  const staticFiles = new Set((await readdir(staticRoot)).filter((name) => /^[a-z0-9-]+\.(js|css|html)$/.test(name)));
  const sendStatic = await createStaticAssets(staticRoot, staticFiles);
  const verifier = createReplayVerifier();
  const companion = createCompanion({ db: store.db, env: options.companionEnv ?? process.env, fetchImpl: options.companionFetch ?? fetch, now });
  const authCache = new Map();
  const runs = new Map();
  const currentRun = new Map();
  const guestRuns = new Map();
  const limits = new Map();

  function settleDueWeeks() {
    const current = weekFor(now());
    for (const weekId of store.dueWeeklySettlementWeeks(current.id)) store.settleWeek(weekId, now());
  }

  function rate(key, maximum, windowMs) {
    const time = now();
    let entry = limits.get(key);
    if (!entry || time - entry.start >= windowMs) { entry = { start: time, count: 0 }; limits.set(key, entry); }
    if (++entry.count > maximum) throw fail(429, '操作有点快，请稍后再试。', 'RATE_LIMIT');
  }

  async function api(path, authorization) {
    let response;
    try { response = await fetcher(new URL(path, upstream), { headers: { Authorization: authorization, Accept: 'application/json' }, signal: AbortSignal.timeout(6000) }); }
    catch { throw fail(503, '账户服务暂时繁忙，请稍后再试。'); }
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.success !== true) {
      const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 502;
      throw fail(status, status === 401 ? '请登录中转站后继续。' : status === 403 ? '当前账户没有管理权限。' : '中转站返回异常，请稍后重试。');
    }
    return result.data;
  }

  async function authenticate(request) {
    const authorization = request.headers.authorization || '';
    if (!/^Bearer [^\s]{8,4096}$/.test(authorization)) throw fail(401, '请登录中转站后保存进度和领取谢礼。');
    const key = sha(authorization);
    const cached = authCache.get(key);
    if (cached && cached.expires > now()) return { ...cached.user, authorization };
    const data = await api('/api/user/self', authorization);
    if (!Number.isSafeInteger(data?.id) || data.id <= 0 || !Number.isInteger(data.role)) throw fail(401, '账户信息无效，请重新登录。');
    const user = { id: data.id, username: String(data.display_name || data.username || ''), role: data.role };
    authCache.set(key, { user, expires: now() + 5000 });
    return { ...user, authorization };
  }

  function account(user) {
    return { success: true, user: { id: user.id, username: user.username, role: user.role }, admin: user.role >= 10,
      profile: { ...store.profile(user.id), user_id: user.id }, rewards: store.rewards(user.id),
      weekly_rewards: store.weeklyRewardRows(user.id),
      my_rank: store.weeklyRank(weekFor(now()).id, user.id),
      my_score: store.weeklyScore(weekFor(now()).id, user.id)?.score ?? null };
  }

  function getRun(user, id) {
    const run = runs.get(id);
    if (!run || run.userId !== user.id || now() - run.created > 1800000 || currentRun.get(user.id) !== id) {
      throw fail(409, '这局记录已失效，请重新开始。', 'RUN_EXPIRED');
    }
    return run;
  }

  function playPermission(run, id) {
    const stages = new Set(run.state.seenEggStages);
    if (run.state.currentVariant) stages.add(`${run.state.currentVariant}:${run.state.currentLevel}`);
    if (run.state.nextVariant) stages.add(`${run.state.nextVariant}:${run.state.nextLevel}`);
    return { run_id: id, levels: [...new Set([1, 2, 3, ...run.state.unlocked])], egg_stages: [...stages] };
  }

  function guestSession(request) {
    const value = (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('fat_fish_guest='))?.slice(15);
    return /^[a-f0-9]{32}$/.test(value || '') ? value : null;
  }

  function getGuestRun(request, id) {
    const session = guestSession(request);
    const run = runs.get(id);
    if (!session || !run?.guest || run.session !== session || guestRuns.get(session) !== id || now() - run.created > 1800000) {
      throw fail(409, '这局记录已失效，请重新开始。', 'RUN_EXPIRED');
    }
    return run;
  }

  async function checkpoint(run, input) {
    const digest = sha(JSON.stringify({ step: input.step, moves: input.moves }));
    if (run.hash === digest) return;
    if (run.busy) throw fail(409, '这局正在同步，请稍后再试。', 'RUN_BUSY');
    if (!Number.isSafeInteger(input.step) || input.step > Math.floor((now() - run.created) * 60 / 1000) + 180) throw fail(422, '对局时间不合法。', 'INVALID_REPLAY');
    if (!Array.isArray(input.moves) || run.moves + input.moves.length > 2000) throw fail(422, '这局已达记录上限，请重新开始。');
    run.busy = true;
    try {
      const result = await verifier.verify(run.state, input.moves, input.step);
      const verifiedAt = now();
      if (!run.guest) {
        store.saveProgress(run.userId, result.summary);
        if (run.weekId === weekFor(verifiedAt).id) store.recordWeeklyScore({ weekId: run.weekId, userId: run.userId,
          name: run.username, score: result.summary.score, maxLevel: result.summary.max_level,
          runId: run.id || '', attainedAt: verifiedAt });
      }
      run.state = result.state; run.hash = digest; run.summary = result.summary; run.moves += input.moves.length;
    } finally { run.busy = false; }
  }

  async function body(request) {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 65536) throw fail(413, '提交内容过长。');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch { throw fail(400, '提交内容格式错误。'); }
  }

  const server = createServer(async (request, response) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
    const json = (status, data) => { response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); };
    try {
      const url = new URL(request.url, 'http://game.internal');
      if (url.pathname === base.slice(0, -1)) { response.writeHead(302, { Location: base }); response.end(); return; }
      if (!url.pathname.startsWith(base)) throw fail(404, '页面不存在。');
      const path = url.pathname.slice(base.length);
      if (!path.startsWith('api/')) {
        const name = path || 'index.html';
        if (!['GET', 'HEAD'].includes(request.method) || !staticFiles.has(name)) throw fail(404, '页面不存在。');
        sendStatic(request, response, name, headers); return;
      }
      if (request.headers.origin && !origins.has(request.headers.origin)) throw fail(403, '来源校验失败。');
      if (path === 'api/health' && request.method === 'GET') { json(200, { success: true }); return; }
      const clientIP = request.headers['x-real-ip'] || request.socket.remoteAddress;
      rate(`ip:${clientIP}`, 600, 60000);
      if (path === 'api/companion' && request.method === 'GET') { json(200, companion.status()); return; }
      if (path === 'api/leaderboard' && request.method === 'GET') {
        const period = url.searchParams.get('period') || 'current';
        if (!['current', 'previous'].includes(period)) throw fail(400, '榜单周期不合法。');
        settleDueWeeks();
        const week = period === 'current' ? weekFor(now()) : previousWeek(now());
        const rows = store.weeklyRows(week.id, 20).map((row, index) => ({
          rank: index + 1, name: publicName(row.name, row.user_id), score: row.score, max_level: row.max_level,
        }));
        const settlement = period === 'previous' ? store.db.prepare('SELECT * FROM weekly_settlements WHERE week_id=?').get(week.id) : null;
        const winner = settlement?.winner_user_id ? { name: publicName(settlement.winner_name, settlement.winner_user_id), status: settlement.status } : null;
        json(200, { success: true, week: { id: week.id, start: week.start_at, end: week.end_at, label: week.label }, rows, total: store.weeklyCount(week.id), winner }); return;
      }
      if (path === 'api/leaderboard/me' && request.method === 'GET') {
        const user = await authenticate(request);
        settleDueWeeks();
        const week = weekFor(now());
        const score = store.weeklyScore(week.id, user.id);
        json(200, { success: true, week: { id: week.id, start: week.start_at, end: week.end_at, label: week.label },
          my_rank: store.weeklyRank(week.id, user.id), my_score: score?.score ?? null,
          weekly_rewards: store.weeklyRewardRows(user.id) }); return;
      }
      if (path === 'api/play/run' && request.method === 'POST') {
        requireCurrentPhysics(await body(request));
        rate(`guest-start:${clientIP}`, 60, 3600000);
        for (const [id, old] of runs) if (now() - old.created > 1800000) runs.delete(id);
        let session = guestSession(request);
        if (!session) {
          session = randomBytes(16).toString('hex');
          const secure = request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
          response.setHeader('Set-Cookie', `fat_fish_guest=${session}; Path=${base}; HttpOnly; SameSite=Lax${secure}`);
        }
        if (runs.size >= 200 && !guestRuns.has(session)) throw fail(503, '鱼缸有点拥挤，请稍后再来。');
        const previous = guestRuns.get(session);
        if (previous) runs.delete(previous);
        const id = randomUUID();
        const randomSeed = seed();
        const variantSeed = seed();
        const run = { guest: true, session, created: now(), state: initialState(randomSeed, variantSeed), hash: null, summary: null, busy: false, moves: 0 };
        runs.set(id, run); guestRuns.set(session, id);
        json(200, { success: true, run: { id, seed: randomSeed, variant_seed: variantSeed, width: 480, height: 620, guest: true }, play: playPermission(run, id) }); return;
      }
      if (path === 'api/play/checkpoint' && request.method === 'POST') {
        const input = await body(request);
        const run = getGuestRun(request, input.run_id);
        await checkpoint(run, input);
        json(200, { success: true, summary: run.summary, play: playPermission(run, input.run_id) }); return;
      }
      if (path === 'api/play/art' && request.method === 'GET') {
        const id = request.headers['x-game-run'] || url.searchParams.get('run_id');
        let run = runs.get(id);
        if (!run) throw fail(409, '这局记录已失效，请重新开始。', 'RUN_EXPIRED');
        if (run?.guest) run = getGuestRun(request, id);
        else run = getRun(await authenticate(request), id);
        const level = Number(url.searchParams.get('level'));
        const variant = url.searchParams.get('variant');
        const permission = playPermission(run, id);
        const key = `${variant || 'maid'}:${level}`;
        if (!(variant ? permission.egg_stages.includes(key) : permission.levels.includes(level))) throw fail(403, '这局还没有遇见这个模样。');
        await sendPrivateArt(request, response, art, key, headers); return;
      }
      const user = await authenticate(request);
      rate(`user:${user.id}`, 180, 60000);
      if (path === 'api/companion' && request.method === 'POST') {
        json(200, await companion.respond(`u:${user.id}`, await body(request))); return;
      }
      if (path === 'api/me' && request.method === 'GET') { settleDueWeeks(); json(200, account(user)); return; }
      if (path === 'api/art' && request.method === 'GET') {
        const level = Number(url.searchParams.get('level'));
        const variant = url.searchParams.get('variant');
        const profile = store.profile(user.id);
        const key = `${variant || 'maid'}:${level}`;
        const unlocked = variant ? profile.egg_stages.includes(key) : profile.unlocked.includes(level);
        if (!unlocked) throw fail(403, '遇见这个模样后才能解锁。');
        await sendPrivateArt(request, response, art, key, headers); return;
      }
      if (path === 'api/run' && request.method === 'POST') {
        requireCurrentPhysics(await body(request));
        rate(`start:${user.id}`, 30, 3600000);
        for (const [id, old] of runs) if (now() - old.created > 1800000) runs.delete(id);
        if (runs.size >= 200 && !currentRun.has(user.id)) throw fail(503, '鱼缸有点拥挤，请稍后再来。');
        const previous = currentRun.get(user.id);
        if (previous) runs.delete(previous);
        const id = randomUUID();
        const randomSeed = seed();
        const variantSeed = seed();
        const startedAt = now();
        runs.set(id, { id, userId: user.id, username: user.username, weekId: weekFor(startedAt).id, created: startedAt, state: initialState(randomSeed, variantSeed), hash: null, summary: null, busy: false, moves: 0 });
        currentRun.set(user.id, id);
        json(200, { success: true, run: { id, seed: randomSeed, variant_seed: variantSeed, width: 480, height: 620 }, play: playPermission(runs.get(id), id) }); return;
      }
      if (path === 'api/run/checkpoint' && request.method === 'POST') {
        const input = await body(request);
        const run = getRun(user, input.run_id);
        await checkpoint(run, input);
        json(200, { ...account(user), summary: run.summary, play: playPermission(run, input.run_id) });
        return;
      }
      if (path === 'api/rewards/claim' && request.method === 'POST') {
        const input = await body(request);
        const run = getRun(user, input.run_id);
        if (!run.summary) throw fail(409, '先同步这局记录，再领取谢礼。');
        rate(`claim:${user.id}`, 12, 60000);
        const reward = store.claim(user.id, String(input.campaign_id || ''));
        json(200, { success: true, reward }); return;
      }
      if (path.startsWith('api/admin/')) {
        if (user.role < 10) throw fail(403, '仅管理员可以管理奖品。');
        if (path === 'api/admin/prizes' && request.method === 'GET') {
          const campaignId = url.searchParams.get('campaign_id') || '';
          const page = Number(url.searchParams.get('page') || 1);
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(campaignId) || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw fail(400, '活动或页码不合法。');
          json(200, { success: true, ...store.campaignPrizes(campaignId, page) }); return;
        }
        if (path === 'api/admin/prizes/remove' && request.method === 'POST') {
          rate(`prizes-remove:${user.id}`, 20, 60000);
          const input = await body(request);
          const campaignId = typeof input.campaign_id === 'string' ? input.campaign_id : '';
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(campaignId) || !Array.isArray(input.ids) || !input.ids.length || input.ids.length > 100 ||
            input.ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw fail(400, '请选择当前活动内的 1～100 个兑换码。');
          const result = store.removePrizes(user.id, campaignId, [...new Set(input.ids)]);
          json(200, { success: true, ...result, campaigns: store.campaigns() }); return;
        }
        if (path === 'api/admin/campaigns' && request.method === 'GET') {
          json(200, { success: true, campaigns: store.campaigns() }); return;
        }
        if (path === 'api/admin/campaigns' && request.method === 'POST') {
          rate(`campaign-create:${user.id}`, 10, 60000);
          const input = await body(request);
          const title = typeof input.title === 'string' ? input.title.trim() : '';
          const kind = input.kind === undefined ? 'level' : input.kind;
          const minLevel = kind === 'weekly' ? 2 : input.min_level;
          if (!title || title.length > 80 || !['level', 'weekly'].includes(kind) || !Number.isInteger(minLevel) || minLevel < 2 || minLevel > 11 || (kind === 'weekly' && input.min_level !== undefined && input.min_level !== 2)) {
            throw fail(400, '请填写 1～80 字的活动名称，解锁等级须为 2～11 的整数。');
          }
          const campaign = store.createCampaign(user.id, { id: `fish-${randomUUID()}`, title, min_level: minLevel, kind });
          json(201, { success: true, campaign, campaigns: store.campaigns() }); return;
        }
        if (path === 'api/admin/campaigns/delete' && request.method === 'POST') {
          rate(`campaign-delete:${user.id}`, 10, 60000);
          const input = await body(request);
          if (typeof input.campaign_id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.campaign_id)) throw fail(400, '请选择要删除的活动。');
          const result = store.deleteCampaign(user.id, input.campaign_id);
          json(200, { success: true, ...result, campaigns: store.campaigns() }); return;
        }
        if (path === 'api/admin/candidates' && request.method === 'GET') {
          const keyword = (url.searchParams.get('keyword') || '').slice(0, 100);
          const data = await api(`/api/redemption/search?keyword=${encodeURIComponent(keyword)}&status=1&p=1&page_size=100`, user.authorization);
          const imported = store.importedIds();
          const rows = Array.isArray(data) ? data : data?.items || [];
          const time = Math.floor(Date.now() / 1000);
          const items = rows.filter((row) => row.status === 1 && !imported.has(row.id) && (!row.expired_time || row.expired_time > time))
            .map(({ id, name, quota, expired_time, status }) => ({ id, name, quota, expired_time, status }));
          json(200, { success: true, items, campaigns: store.campaigns() }); return;
        }
        if (path === 'api/admin/import' && request.method === 'POST') {
          rate(`import:${user.id}`, 10, 60000);
          const input = await body(request);
          const ids = [...new Set(input.ids || [])];
          if (!ids.length || ids.length > 100 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw fail(400, '请选择 1～100 个兑换码。');
          const campaign = { id: String(input.campaign_id || ''), title: String(input.title || '').trim(), min_level: input.min_level,
            ...(input.kind === undefined ? {} : { kind: input.kind }) };
          if (campaign.kind !== undefined && !['level', 'weekly'].includes(campaign.kind)) throw fail(400, '奖池类型不合法。');
          if (campaign.kind === 'weekly') campaign.min_level = 2;
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(campaign.id) || !campaign.title || campaign.title.length > 80 || !Number.isInteger(campaign.min_level) || campaign.min_level < 2 || campaign.min_level > 11) throw fail(400, '奖池名称、标识或解锁等级不合法。');
          const rows = [];
          for (const id of ids) {
            const row = await api(`/api/redemption/${id}`, user.authorization);
            if (row.id !== id || row.status !== 1 || row.used_user_id || (row.expired_time && row.expired_time <= Date.now() / 1000) ||
              !/^[a-zA-Z0-9-]{16,128}$/.test(row.key || '') || !Number.isSafeInteger(row.quota) || row.quota <= 0) continue;
            rows.push(row);
          }
          const result = store.importPrizes(user.id, campaign, rows);
          json(200, { success: true, ...result, skipped: ids.length - result.imported }); return;
        }
      }
      throw fail(404, '接口不存在。');
    } catch (error) {
      if (!response.headersSent) json(error.status || 500, { success: false, message: error.status ? error.message : '服务暂时繁忙，请稍后重试。', code: error.code || null });
      else response.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const cleanup = setInterval(() => {
    for (const [key, value] of limits) if (now() - value.start > 3600000) limits.delete(key);
    for (const [key, value] of authCache) if (value.expires < now()) authCache.delete(key);
    for (const [key, value] of runs) if (now() - value.created > 1800000) runs.delete(key);
    for (const [key, id] of currentRun) if (!runs.has(id)) currentRun.delete(key);
    for (const [key, id] of guestRuns) if (!runs.has(id)) guestRuns.delete(key);
    try { settleDueWeeks(); } catch { /* retried on the next cleanup or read */ }
  }, 60000).unref();
  server.on('close', () => { clearInterval(cleanup); void verifier.close(); });
  try { settleDueWeeks(); } catch { /* retried on the next cleanup or read */ }
  return { server, store };
}
