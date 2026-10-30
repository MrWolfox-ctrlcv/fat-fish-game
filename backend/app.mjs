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
import { createWardrobe } from './wardrobe.mjs';
import { createArenaRooms } from './arena-rooms.mjs';
import { applyProp, propInputFingerprint, PROP_PRICE_QUOTA, PROP_PRICE_USD, validatePropInput, validatePropBodies } from './props.mjs';
import { createPropWallet } from './prop-wallet.mjs';
import { createAutoRecovery } from './auto-recovery.mjs';
import { createPresence } from './presence.mjs';
import { FREE_TTL, PAID_TTL, SAVE_EXTENSION, SAVE_LIMITS, SAVE_MAX_BYTES, SAVE_MAX_RETENTION, SAVE_PRICE_QUOTA, SAVE_PRICE_USD,
  compactSnapshot, isValidSnapshot, saveFingerprint, validateSaveExtension, validateSaveLoad, validateSaveRequest } from './saves.mjs';

// These three already-visible starter/NPC portraits are shared by both games.
// Seeing an NPC does not grant permission to equip its outfit.
const STARTER_SPRITES = new Set(['maid:1', 'gpt-silly:2', 'deepseek-claude:5']);

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
  const propWallet = options.propWallet ?? createPropWallet({ fetchImpl: fetcher });
  const now = options.now ?? Date.now;
  const staticRoot = new URL('../dist/', import.meta.url);
  const staticFiles = new Set((await readdir(staticRoot)).filter((name) => /^[a-z0-9-]+\.(js|css|html)$/.test(name) || ['companion-portrait.png', 'prop-icons.png'].includes(name)));
  const sendStatic = await createStaticAssets(staticRoot, staticFiles);
  const playroomRoot = options.playroomRoot ?? new URL('../playroom/', import.meta.url);
  let sendPlayroom = null;
  try {
    const names = (await readdir(playroomRoot, { recursive: true })).filter((name) => /^(index\.html|style\.css|wardrobe\.css|companion-account\.css|companion-corner\.css|src\/(?:modes\/)?[a-z-]+\.js|portraits\/(?:deepseek|gptNormal|claude|gemini|doubao|qwen|kimi|grok)\.png)$/.test(name.replaceAll('\\', '/'))).map((name) => name.replaceAll('\\', '/'));
    sendPlayroom = await createStaticAssets(playroomRoot, names);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const wardrobe = createWardrobe({ store });
  const verifier = options.verifier ?? createReplayVerifier();
  const companion = createCompanion({ db: store.db, env: options.companionEnv ?? process.env, fetchImpl: options.companionFetch ?? fetch, now });
  const arenaRooms = createArenaRooms({ origins, production: process.env.NODE_ENV === 'production', now, maxRooms: options.arenaMaxRooms, accepting:()=>!draining });
  const authCache = new Map();
  const runs = new Map();
  const currentRun = new Map();
  const guestRuns = new Map();
  const limits = new Map();
  const autoRecovery=createAutoRecovery(store.db,{now,physicsVersion:PHYSICS_VERSION});
  const presence=createPresence({now});
  let draining=false;
  const autoOwner=run=>run.guest?'g:'+sha(run.session):'u:'+run.userId;
  const persistAuto=run=>{if(!run)return null;const meta=autoRecovery.save(autoOwner(run),run);run.autoToken=meta.token;return {...meta,step:run.state.stepIndex};};

  async function restoreAuto(owner,input,user=null,session=null){
    requireCurrentPhysics(input);
    if(user&&store.hasPendingPayment(user.id))throw fail(409,'付费订单仍在确认，自动恢复不会回退或重扣订单。','PAYMENT_PENDING');
    const row=autoRecovery.get(owner,input.token||null);
    if(!row)throw fail(404,'自动恢复档已过期或不存在。','AUTO_NOT_FOUND');
    const source=row.run;let discardTail=false;
    if(user&&store.lineagePropCount(user.id,source.lineageId||source.id)>(source.propRevision||0)){
      const paid=store.db.prepare("SELECT request_id FROM prop_receipts WHERE user_id=? AND lineage_id=? AND status='committed' ORDER BY prop_revision DESC LIMIT 1").get(user.id,source.lineageId||source.id);
      const receipt=paid&&store.propReceipt(paid.request_id);
      if(!receipt?.state)throw fail(409,'请先确认已支付道具的结果，原记录仍保留。','PAYMENT_PENDING');
      source.state=receipt.state;source.summary=receipt.summary;source.hash=null;source.moves=receipt.move_count;source.propRevision=receipt.prop_revision;source.propCount=store.lineagePropCount(user.id,source.lineageId||source.id);source.usedProps=true;discardTail=true;
    }
    const target=!discardTail&&input.step!==undefined?input.step:source.state.stepIndex;
    const moves=!discardTail&&input.moves!==undefined?input.moves:[];
    if(!Number.isSafeInteger(target)||target-source.state.stepIndex>Math.floor((now()-row.updated)*60/1000)+180)throw fail(422,'本机恢复记录时间不合法，云端恢复档仍保留。','AUTO_INVALID');
    let result;try{result=await verifier.verify(source.state,moves,target);}catch{throw fail(422,'本机后续记录无法合并，可选择恢复最近云端进度。','AUTO_INVALID');}
    if(user&&(store.hasPendingPayment(user.id)||store.lineagePropCount(user.id,source.lineageId||source.id)>(source.propRevision||0)))throw fail(409,'道具记录刚刚变化，请重试恢复以保留已确认的道具效果。','PAYMENT_PENDING');
    const id=randomUUID(),started=now(),previous=user?currentRun.get(user.id):guestRuns.get(session);
    if(runs.get(previous)?.busy)throw fail(409,'当前局正在同步，请稍后恢复。','RUN_BUSY');
    const run={...source,id,userId:user?.id,username:user?.username,session,guest:!user,state:result.state,summary:result.summary,
      created:started,stepBase:result.state.stepIndex,busy:false,hash:null,moves:(source.moves||0)+moves.length};
    if(run.moves>2000)throw fail(422,'本局投放记录已达到上限。','AUTO_INVALID');
    if(user){run.usedProps=store.lineageUsedProps(user.id,run.lineageId||source.id);run.propCount=store.lineagePropCount(user.id,run.lineageId||source.id);store.saveProgress(user.id,result.summary);
      if(run.weekId===weekFor(started).id)store.recordWeeklyScore({weekId:run.weekId,userId:user.id,name:user.username,score:result.summary.score,maxLevel:result.summary.max_level,runId:run.lineageId||source.id,attainedAt:started,usedProps:run.usedProps});}
    const autosave=persistAuto(run);
    if(previous)runs.delete(previous);runs.set(id,run);if(user)currentRun.set(user.id,id);else guestRuns.set(session,id);
    return {success:true,run:{id,seed:run.state.randomState,variant_seed:run.state.variantState,width:480,height:620,resumed:true,guest:!user,autosave_token:autosave.token},
      state:run.state,summary:run.summary,play:playPermission(run,id),autosave,tail_discarded:discardTail,...(user?account(user):{})};
  }

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
    run.lastActivity=now();return run;
  }

  function checkCommittedPropRun(user, receipt) {
    const run = runs.get(receipt.run_id);
    if (!run || run.userId !== user.id || currentRun.get(user.id) !== run.id || now() - run.created > 1800000) return 'expired';
    if (!receipt.state || run.state.stepIndex > receipt.step || run.moves > receipt.move_count ||
        run.propRevision > receipt.prop_revision) return 'stale';
    if (run.propRevision === receipt.prop_revision) return run.propReceiptId === receipt.receipt_id ? 'current' : 'stale';
    if (run.propRevision !== receipt.prop_revision - 1 || run.state.stepIndex !== receipt.step || run.moves !== receipt.move_count) return 'stale';
    run.state = receipt.state; run.summary = receipt.summary; run.usedProps = true;
    run.propRevision = receipt.prop_revision; run.propReceiptId = receipt.receipt_id; run.hash = null;
    run.propCount = Math.max(run.propCount || 0, store.lineagePropCount(user.id, run.lineageId || run.id));
    return 'restored';
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
    run.lastActivity=now();return run;
  }

  async function checkpoint(run, input, held = false) {
    const digest = sha(JSON.stringify({ step: input.step, moves: input.moves, propRevision: run.propRevision || 0 }));
    if (run.hash === digest) { persistAuto(run); return; }
    if (!held && run.busy) throw fail(409, '这局正在同步，请稍后再试。', 'RUN_BUSY');
    if (!Number.isSafeInteger(input.step) || input.step - (run.stepBase || 0) > Math.floor((now() - run.created) * 60 / 1000) + 180) throw fail(422, '对局时间不合法。', 'INVALID_REPLAY');
    if (!Array.isArray(input.moves) || run.moves + input.moves.length > 2000) throw fail(422, '这局已达记录上限，请重新开始。');
    if (!held) run.busy = true;
    try {
      const result = await verifier.verify(run.state, input.moves, input.step);
      const verifiedAt = now();
      if (!run.guest) {
        store.saveProgress(run.userId, result.summary);
        if (run.weekId === weekFor(verifiedAt).id) store.recordWeeklyScore({ weekId: run.weekId, userId: run.userId,
          name: run.username, score: result.summary.score, maxLevel: result.summary.max_level,
          runId: run.lineageId || run.id || '', attainedAt: verifiedAt, usedProps: Boolean(run.usedProps) });
      }
      run.state = result.state; run.hash = digest; run.summary = result.summary; run.moves += input.moves.length;
      persistAuto(run);
    } finally { if (!held) run.busy = false; }
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
      if (await arenaRooms.handleHttp(request, response, url)) return;
      if (url.pathname === '/games') { response.writeHead(302, { Location: '/games/' }).end(); return; }
      if (url.pathname === '/games/') {
        if (!['GET', 'HEAD'].includes(request.method) || !staticFiles.has('games-index.html')) throw fail(404, '页面不存在。');
        sendStatic(request, response, 'games-index.html', headers); return;
      }
      if (url.pathname === '/games/bumper') { response.writeHead(302, { Location: '/games/bumper/' }).end(); return; }
      if (url.pathname.startsWith('/games/bumper/')) {
        const name = url.pathname.slice('/games/bumper/'.length) || 'index.html';
        if (!['GET', 'HEAD'].includes(request.method) || !sendPlayroom || !sendPlayroom(request, response, name, headers)) throw fail(404, '页面不存在。');
        return;
      }
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
      if(path==='api/presence'&&['GET','POST'].includes(request.method)){
        if(request.method==='POST'){const input=await body(request);if(input.leave)presence.leave(input.session_id);else if(!presence.touch({sessionId:input.session_id,game:input.game,playing:input.playing}))throw fail(429,'在线统计暂时繁忙。');}
        json(200,{success:true,...presence.stats()});return;
      }
      if(draining&&['api/run','api/play/run','api/autosave/load','api/play/autosave/load','api/saves/load'].includes(path))throw fail(503,'小游戏正在更新，请稍后重试，自动恢复记录仍保留。','GAME_UPDATING');
      if(path==='api/play/autosave'&&request.method==='GET'){const session=guestSession(request);json(200,{success:true,autosave:session?autoRecovery.metadata('g:'+sha(session)):{exists:false}});return;}
      if(path==='api/play/autosave/load'&&request.method==='POST'){const session=guestSession(request);if(!session)throw fail(404,'游客恢复记录不存在。','AUTO_NOT_FOUND');rate('auto-guest:'+sha(session),12,60000);json(200,await restoreAuto('g:'+sha(session),await body(request),null,session));return;}
      const propsEnabled = propWallet?.enabled === true && typeof propWallet?.debit === 'function';
      if (path === 'api/props' && request.method === 'GET') {
        json(200, { success: true, enabled: propsEnabled, price_usd: PROP_PRICE_USD, price_quota: PROP_PRICE_QUOTA,
          ...(!propsEnabled ? { reason: '道具付费功能暂不可用。' } : {}) }); return;
      }
      if (path === 'api/companion' && request.method === 'GET') { json(200, companion.status()); return; }
      if (path === 'api/sprites' && request.method === 'GET') {
        const level = Number(url.searchParams.get('level'));
        const variant = url.searchParams.get('variant');
        const key = `${variant || 'maid'}:${level}`;
        if (!Number.isInteger(level) || level < 1 || level > 11 || (variant && !/^[a-z-]{1,32}$/.test(variant))) throw fail(400, '造型编号不正确。');
        if (!STARTER_SPRITES.has(key)) {
          const runId = request.headers['x-game-run'];
          if (runId) {
            const candidate = runs.get(runId);
            const run = candidate?.guest ? getGuestRun(request, runId) : getRun(await authenticate(request), runId);
            const permission = playPermission(run, runId);
            if (!(variant ? permission.egg_stages.includes(key) : permission.levels.includes(level))) throw fail(403, '这局还没有遇见这个模样。');
          } else {
            const owner = await authenticate(request);
            const profile = store.profile(owner.id);
            if (!(variant ? profile.egg_stages.includes(key) : profile.unlocked.includes(level))) throw fail(403, '合成大肥鱼中解锁后即可使用。');
          }
        }
        await sendPrivateArt(request, response, art, key, headers, STARTER_SPRITES.has(key)); return;
      }
      if (path === 'api/leaderboard' && request.method === 'GET') {
        const period = url.searchParams.get('period') || 'current';
        if (!['current', 'previous'].includes(period)) throw fail(400, '榜单周期不合法。');
        settleDueWeeks();
        const week = period === 'current' ? weekFor(now()) : previousWeek(now());
        const rows = store.weeklyRows(week.id, 20, null).map((row, index) => ({
          rank: index + 1, name: publicName(row.name, row.user_id), score: row.score, max_level: row.max_level, used_props: Boolean(row.used_props),
        }));
        const settlement = period === 'previous' ? store.db.prepare('SELECT * FROM weekly_settlements WHERE week_id=?').get(week.id) : null;
        const winner = settlement?.winner_user_id ? { name: publicName(settlement.winner_name, settlement.winner_user_id), status: settlement.status } : null;
        json(200, { success: true, week: { id: week.id, start: week.start_at, end: week.end_at, label: week.label }, rows, total: store.weeklyCount(week.id, null), winner }); return;
      }
      if (path === 'api/leaderboard/me' && request.method === 'GET') {
        const user = await authenticate(request);
        settleDueWeeks();
        const week = weekFor(now());
        const score = store.weeklyScore(week.id, user.id);
        json(200, { success: true, week: { id: week.id, start: week.start_at, end: week.end_at, label: week.label },
          my_rank: store.weeklyRank(week.id, user.id), my_score: score?.score ?? null,
          my_entries: [false, true].map((usedProps) => { const row = store.weeklyScore(week.id, user.id, usedProps); return row ? { score: row.score,
            max_level: row.max_level, attained_at: row.attained_at, used_props: usedProps,
            rank: store.weeklyMixedRank(week.id, user.id, usedProps) } : null; }).filter(Boolean),
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
        const run = { id,guest: true, session, created: now(), state: initialState(randomSeed, variantSeed), hash: null, summary: null, busy: false, moves: 0 };
        runs.set(id, run); guestRuns.set(session, id);
        const autosave=persistAuto(run);
        json(200, { success: true, run: { id, seed: randomSeed, variant_seed: variantSeed, width: 480, height: 620, guest: true,autosave_token:autosave.token }, play: playPermission(run, id),autosave }); return;
      }
      if (path === 'api/play/checkpoint' && request.method === 'POST') {
        const input = await body(request);
        const run = getGuestRun(request, input.run_id);
        await checkpoint(run, input);
        json(200, { success: true, summary: run.summary, play: playPermission(run, input.run_id),autosave:persistAuto(run) }); return;
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
      if(path==='api/admin/online'&&request.method==='GET'){
        if(user.role<10)throw fail(403,'需要管理员权限。');
        json(200,{success:true,...presence.stats(),rooms:arenaRooms.metrics(),recent_runs:[...runs.values()].filter(r=>now()-(r.lastActivity||r.created)<90000).length,draining});return;
      }
      if(path==='api/admin/drain'&&request.method==='POST'){
        if(user.role<10)throw fail(403,'需要管理员权限。');
        const input=await body(request),stats=presence.stats(),metrics=arenaRooms.metrics();
        if(input.enabled&& (stats.online||metrics.connections||[...runs.values()].some(r=>now()-(r.lastActivity||r.created)<90000)))throw fail(409,'仍有人在线或刚刚游玩，不能切换版本。','PLAYERS_ONLINE');
        draining=input.enabled===true;json(200,{success:true,draining});return;
      }
      if(path==='api/autosave'&&request.method==='GET'){json(200,{success:true,autosave:autoRecovery.metadata('u:'+user.id)});return;}
      if(path==='api/autosave/load'&&request.method==='POST'){rate(`auto-load:${user.id}`,12,60000);json(200,await restoreAuto('u:'+user.id,await body(request),user));return;}
      rate(`user:${user.id}`, 180, 60000);
      if (path === 'api/saves' && request.method === 'GET') {
        json(200, { success: true, saves: store.saveListing(user.id, now()), price_usd: SAVE_PRICE_USD,
          price_quota: SAVE_PRICE_QUOTA, limits: SAVE_LIMITS, billing_enabled: propsEnabled }); return;
      }
      if (path === 'api/saves/write' && request.method === 'POST') {
        rate(`save-write:${user.id}`, 20, 60000);
        const input = await body(request);
        requireCurrentPhysics(input);
        validateSaveRequest(input, PHYSICS_VERSION);
        const fingerprint = saveFingerprint(input);
        const existing = store.saveOrder(input.request_id);
        if (existing) {
          if (existing.user_id !== user.id || existing.fingerprint !== fingerprint) throw fail(409, '请求编号已用于其他存档操作。', 'SAVE_REQUEST_CONFLICT');
          if (existing.status === 'committed') { json(200, { success: true, saves: store.saveListing(user.id, now()), receipt: existing.result }); return; }
          if (existing.status === 'pending' && existing.quota === 0 && existing.operation === 'write') {
            const committed = store.commitSaveOrder(input.request_id, now());
            json(200, { success: true, saves: store.saveListing(user.id, now()),
              receipt: { id: committed.operation_id, ...committed.result, quota: 0, paid: false } }); return;
          }
          if (existing.status === 'pending') { json(202, { success: true, pending: true,
            receipt: { id: existing.operation_id, slot: existing.slot, quota: existing.quota, paid: existing.quota > 0 } }); return; }
          throw fail(409, '这次存档请求已结束，请重新保存。', 'SAVE_REQUEST_FAILED');
        }
        if (store.propReceipt(input.request_id)) throw fail(409, '请求编号已用于其他操作。', 'SAVE_REQUEST_CONFLICT');
        const activeBefore = store.activeSave(user.id, input.slot, now());
        if (input.slot > 1 && input.confirm_quota !== SAVE_PRICE_QUOTA && !activeBefore) {
          throw fail(422, '创建付费存档需要确认额度。', 'SAVE_CONFIRM_REQUIRED');
        }
        const pendingProp = store.pendingPropReceipt(user.id);
        if (pendingProp) { json(202, { success: true, pending: true,
          receipt: { id: pendingProp.receipt_id, quota: pendingProp.quota, used_props: true } }); return; }
        const pendingSave = store.pendingSaveOrder(user.id);
        if (pendingSave) { json(202, { success: true, pending: true,
          receipt: { id: pendingSave.operation_id, slot: pendingSave.slot, quota: pendingSave.quota, paid: pendingSave.slot > 1 } }); return; }
        const run = getRun(user, input.run_id);
        if (run.busy) throw fail(409, '这局正在同步，请稍后再试。', 'RUN_BUSY');
        if (store.hasPendingPayment(user.id)) throw fail(409, '上一笔付费订单仍在确认，请先确认订单再继续。', 'PAYMENT_PENDING');
        run.busy = true;
        try {
          await checkpoint(run, { step: input.step, moves: input.moves }, true);
          const savedState = compactSnapshot(run.state);
          if (Buffer.byteLength(JSON.stringify(savedState), 'utf8') > SAVE_MAX_BYTES) throw fail(422, '存档数据过大，未写入也未扣款。', 'SAVE_TOO_LARGE');
          if (!isValidSnapshot(savedState)) throw fail(422, '存档内容超出安全范围。', 'INVALID_SAVE');
          const at = now();
          const active = store.activeSave(user.id, input.slot, at);
          const expiry = input.slot === 1 ? Math.max(active?.expires_at || 0, at + FREE_TTL)
            : active ? active.expires_at : at + PAID_TTL;
          if (input.slot > 1 && !active && !propsEnabled) throw fail(503, '存档付费功能暂不可用。', 'PROPS_DISABLED');
          const operationId = randomUUID();
          const prepared = store.createSaveOrder({ requestId: input.request_id, userId: user.id, slot: input.slot,
            fingerprint, operationId, operation: 'write', now: at, payload: { allow_payment: input.confirm_quota === SAVE_PRICE_QUOTA, save: { state: savedState,
              summary: run.summary || { score: run.state.score, max_level: Math.max(...run.state.unlocked), over: run.state.over,
                unlocked: run.state.unlocked, egg_stages: run.state.seenEggStages }, lineage_id: run.lineageId || run.id,
              week_id: run.weekId, physics_version: PHYSICS_VERSION, expires_at: expiry } } });
          if (!prepared.created) {
            if (prepared.fingerprint !== fingerprint || prepared.user_id !== user.id) throw fail(409, '请求编号已用于其他存档操作。', 'SAVE_REQUEST_CONFLICT');
            if (prepared.status === 'committed') { json(200, { success: true, saves: store.saveListing(user.id, now()), receipt: prepared.result }); return; }
            json(202, { success: true, pending: true,
              receipt: { id: prepared.operation_id, slot: prepared.slot, quota: prepared.quota, paid: prepared.slot > 1 } }); return;
          }
          if (prepared.requiresPayment) {
            try { await propWallet.debit({ userId: user.id, quota: SAVE_PRICE_QUOTA, operationId: prepared.operation_id }); }
            catch (error) {
              if (error?.code === 'PAYMENT_PENDING') { json(202, { success: true, pending: true,
                receipt: { id: prepared.operation_id, slot: prepared.slot, quota: prepared.quota, paid: true } }); return; }
              store.failSaveOrder(input.request_id, now());
              throw fail(402, error?.code === 'INSUFFICIENT_QUOTA' ? '账户额度不足 $0.01，存档没有写入。' : '账户额度扣减未完成，存档没有写入。', error?.code || 'PAYMENT_REFUSED');
            }
          }
          const committed = store.commitSaveOrder(input.request_id, now());
          json(200, { success: true, saves: store.saveListing(user.id, now()),
            receipt: { id: committed.operation_id, ...committed.result, quota: committed.quota, paid: prepared.requiresPayment } }); return;
        } finally { run.busy = false; }
      }
      if (path === 'api/saves/extend' && request.method === 'POST') {
        rate(`save-extend:${user.id}`, 12, 60000);
        const input = validateSaveExtension(await body(request));
        const fingerprint = saveFingerprint(input, 'extend');
        const existing = store.saveOrder(input.request_id);
        if (existing) {
          if (existing.user_id !== user.id || existing.fingerprint !== fingerprint) throw fail(409, '请求编号已用于其他存档操作。', 'SAVE_REQUEST_CONFLICT');
          if (existing.status === 'committed') { json(200, { success: true, saves: store.saveListing(user.id, now()), receipt: existing.result }); return; }
          if (existing.status === 'pending') { json(202, { success: true, pending: true,
            receipt: { id: existing.operation_id, slot: existing.slot, quota: existing.quota, paid: true } }); return; }
          throw fail(409, '这次存档请求已结束，请重新延长。', 'SAVE_REQUEST_FAILED');
        }
        if (store.propReceipt(input.request_id)) throw fail(409, '请求编号已用于其他操作。', 'SAVE_REQUEST_CONFLICT');
        const pendingProp = store.pendingPropReceipt(user.id);
        if (pendingProp) { json(202, { success: true, pending: true,
          receipt: { id: pendingProp.receipt_id, quota: pendingProp.quota, used_props: true } }); return; }
        const pendingSave = store.pendingSaveOrder(user.id);
        if (pendingSave) { json(202, { success: true, pending: true,
          receipt: { id: pendingSave.operation_id, slot: pendingSave.slot, quota: pendingSave.quota, paid: true } }); return; }
        if (!propsEnabled) throw fail(503, '存档付费功能暂不可用。', 'PROPS_DISABLED');
        const at = now();
        const save = store.activeSave(user.id, input.slot, at);
        if (!save) throw fail(409, '这个存档已过期或不存在。', 'SAVE_EXPIRED');
        const expiry = Math.max(save.expires_at, at) + SAVE_EXTENSION;
        if (expiry > at + SAVE_MAX_RETENTION) throw fail(409, '存档有效期不能超过30天。', 'SAVE_RETENTION_LIMIT');
        const operationId = randomUUID();
        const prepared = store.createSaveOrder({ requestId: input.request_id, userId: user.id, slot: input.slot,
          fingerprint, operationId, operation: 'extend', now: at, payload: { allow_payment: true, expires_at: expiry,
            save: { kind: save.kind, state: compactSnapshot(save.state), summary: save.summary, lineage_id: save.lineage_id,
              week_id: save.week_id, physics_version: save.physics_version } } });
        if (!prepared.created) {
          if (prepared.fingerprint !== fingerprint || prepared.user_id !== user.id) throw fail(409, '请求编号已用于其他存档操作。', 'SAVE_REQUEST_CONFLICT');
          if (prepared.status === 'committed') { json(200, { success: true, saves: store.saveListing(user.id, now()), receipt: prepared.result }); return; }
          json(202, { success: true, pending: true,
            receipt: { id: prepared.operation_id, slot: prepared.slot, quota: prepared.quota, paid: true } }); return;
        }
        try { await propWallet.debit({ userId: user.id, quota: SAVE_PRICE_QUOTA, operationId: prepared.operation_id }); }
        catch (error) {
          if (error?.code === 'PAYMENT_PENDING') { json(202, { success: true, pending: true,
            receipt: { id: prepared.operation_id, slot: prepared.slot, quota: prepared.quota, paid: true } }); return; }
          store.failSaveOrder(input.request_id, now());
          throw fail(402, error?.code === 'INSUFFICIENT_QUOTA' ? '账户额度不足 $0.01，存档没有延长。' : '账户额度扣减未完成，存档没有延长。', error?.code || 'PAYMENT_REFUSED');
        }
        const committed = store.commitSaveOrder(input.request_id, now());
        json(200, { success: true, saves: store.saveListing(user.id, now()),
          receipt: { id: committed.operation_id, ...committed.result, quota: committed.quota, paid: true } }); return;
      }
      if (path === 'api/saves/load' && request.method === 'POST') {
        rate(`save-load:${user.id}`, 20, 60000);
        const input = validateSaveLoad(await body(request), PHYSICS_VERSION);
        if (store.hasPendingPayment(user.id)) throw fail(409, '付费订单仍在确认，请先确认订单再读档。', 'PAYMENT_PENDING');
        const saved = store.activeSave(user.id, input.slot, now());
        if (!saved) throw fail(404, '这个存档已过期或不存在。', 'SAVE_EXPIRED');
        const migrateWarningLine = saved.physics_version === 3 && PHYSICS_VERSION === 4;
        if (saved.physics_version !== PHYSICS_VERSION && !migrateWarningLine) throw fail(409, '游戏已更新，当前存档与此版本不兼容。', 'GAME_UPDATED');
        if (!isValidSnapshot(saved.state)) throw fail(409, '存档数据无法读取。', 'INVALID_SAVE');
        if (migrateWarningLine && !saved.state.over) {
          saved.state.overTimer = 0;
          for (const fish of saved.state.bodies) fish.dangerTime = 0;
        }
        const oldId = currentRun.get(user.id);
        if (oldId) runs.delete(oldId);
        const id = randomUUID();
        const startedAt = now();
        const lineageId = saved.lineage_id;
        const usedProps = store.lineageUsedProps(user.id, lineageId);
        const propCount = store.lineagePropCount(user.id, lineageId);
        const run = { id, userId: user.id, username: user.username, lineageId, weekId: saved.week_id,
          created: startedAt, stepBase: saved.state.stepIndex, state: saved.state, hash: null,
          propRevision: propCount, propCount, usedProps, summary: saved.summary, busy: false, moves: 0 };
        runs.set(id, run); currentRun.set(user.id, id);
        const autosave=persistAuto(run);
        json(200, { success: true, run: { id, seed: saved.state.randomState, variant_seed: saved.state.variantState,
          width: 480, height: 620, resumed: true,autosave_token:autosave.token }, state: saved.state, summary: saved.summary,autosave,
          play: playPermission(run, id), profile: { ...store.profile(user.id), user_id: user.id },
          rewards: store.rewards(user.id), receipt: { slot: input.slot, lineage_id: lineageId,
            week_id: saved.week_id, used_props: usedProps } }); return;
      }
      if (path === 'api/wardrobe' && request.method === 'GET') { json(200, { success: true, ...wardrobe.get(user.id) }); return; }
      if (path === 'api/wardrobe/equip' && request.method === 'POST') {
        rate(`equip:${user.id}`, 30, 60000);
        const input = await body(request);
        wardrobe.equip(user.id, input.skin_id);
        json(200, { success: true, ...wardrobe.get(user.id) }); return;
      }
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
        runs.set(id, { id, userId: user.id, username: user.username, lineageId: id, weekId: weekFor(startedAt).id,
          created: startedAt, stepBase: 0, state: initialState(randomSeed, variantSeed), hash: null, propRevision: 0,
          usedProps: false, summary: null, busy: false, moves: 0 });
        currentRun.set(user.id, id);
        const autosave=persistAuto(runs.get(id));
        json(200, { success: true, run: { id, seed: randomSeed, variant_seed: variantSeed, width: 480, height: 620,autosave_token:autosave.token }, play: playPermission(runs.get(id), id),autosave }); return;
      }
      if (path === 'api/run/checkpoint' && request.method === 'POST') {
        const input = await body(request);
        const run = getRun(user, input.run_id);
        if (store.pendingPropReceipt(user.id)?.run_id === run.id || store.pendingSaveOrder(user.id)) {
          throw fail(409, '付费订单仍在确认，请先确认订单再继续。', 'PAYMENT_PENDING');
        }
        await checkpoint(run, input);
        json(200, { ...account(user), summary: run.summary, play: playPermission(run, input.run_id),autosave:persistAuto(run) });
        return;
      }
      if (path === 'api/run/prop' && request.method === 'POST') {
        rate(`prop:${user.id}`, 5, 60000);
        const input = await body(request);
        const requestId = input?.request_id;
        if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw fail(422, '道具选择无效。', 'INVALID_PROP');
        const fingerprint = propInputFingerprint(input);
        const previous = store.propReceipt(requestId);
        if (previous) {
          if (previous.user_id !== user.id || previous.fingerprint !== fingerprint) throw fail(409, '请求编号已用于其他操作。', 'PROP_REQUEST_CONFLICT');
          if (previous.status === 'committed') {
            const runStatus = checkCommittedPropRun(user, previous);
            if (runStatus === 'stale') throw fail(409, '这笔道具结果已过期，请不要覆盖当前对局。', 'STALE_PROP_RECEIPT');
            if (runStatus === 'expired') { json(200, { success: true, expired: true,
              receipt: { id: previous.receipt_id, quota: previous.quota, used_props: true } }); return; }
            json(200, { success: true, state: previous.state, summary: previous.summary, profile: previous.profile,
              rewards: previous.rewards, play: previous.play, autosave:persistAuto(runs.get(previous.run_id)),receipt: { id: previous.receipt_id, quota: previous.quota, used_props: true } }); return;
          }
          if (previous.status === 'pending') { json(202, { success: true, pending: true,
            receipt: { id: previous.receipt_id, quota: previous.quota, used_props: true } }); return; }
          throw fail(409, '这次道具请求已结束，请重新选择道具。', 'PROP_REQUEST_FAILED');
        }
        if (store.saveOrder(requestId)) throw fail(409, '请求编号已用于其他操作。', 'PROP_REQUEST_CONFLICT');
        const prop = validatePropInput(input);
        const pendingForAccount = store.pendingPropReceipt(user.id);
        if (pendingForAccount) {
          json(202, { success: true, pending: true, receipt: { id: pendingForAccount.receipt_id,
            quota: pendingForAccount.quota, used_props: true } }); return;
        }
        const pendingSave = store.pendingSaveOrder(user.id);
        if (pendingSave) { json(202, { success: true, pending: true,
          receipt: { id: pendingSave.operation_id, slot: pendingSave.slot, quota: pendingSave.quota, used_props: false } }); return; }
        if (!propsEnabled) throw fail(503, '道具付费功能暂不可用。', 'PROPS_DISABLED');
        const run = getRun(user, prop.runId);
        if (run.busy) throw fail(409, '这局正在同步，请稍后再试。', 'RUN_BUSY');
        if ((run.propCount || 0) >= 20) throw fail(429, '这局的道具次数已达上限。', 'PROP_RUN_LIMIT');
        run.busy = true;
        try {
          await checkpoint(run, { step: prop.step, moves: prop.moves }, true);
          validatePropBodies(run.state, prop.kind, prop.bodyIds);
          const applied = await applyProp(run.state, prop.kind, prop.bodyIds);
          const summary = applied.summary;
          const preparedPlay = playPermission({ ...run, state: applied.state }, run.id);
          const preparedProfile = { ...store.previewProgress(user.id, summary), user_id: user.id };
          const preparedRewards = store.rewards(user.id, preparedProfile);
          const receiptId = randomUUID();
          const prepared = store.createPropReceipt({ requestId: prop.requestId, userId: user.id, runId: run.id,
            fingerprint, receiptId, kind: prop.kind, bodyIds: prop.bodyIds, step: prop.step, now: now(), weekId: run.weekId, name: user.username,
            moveCount: run.moves, propRevision: Math.max(run.propRevision || 0, run.propCount || 0) + 1,
            lineageId: run.lineageId || run.id,
            state: applied.state, summary, profile: preparedProfile, rewards: preparedRewards, play: preparedPlay });
          if (prepared.fingerprint !== fingerprint) throw fail(409, '请求编号已用于其他操作。', 'PROP_REQUEST_CONFLICT');
          if (!prepared.created) {
            if (prepared.status === 'committed') {
              const runStatus = checkCommittedPropRun(user, prepared);
              if (runStatus === 'stale') throw fail(409, '这笔道具结果已过期，请不要覆盖当前对局。', 'STALE_PROP_RECEIPT');
              if (runStatus === 'expired') { json(200, { success: true, expired: true,
                receipt: { id: prepared.receipt_id, quota: prepared.quota, used_props: true } }); return; }
              json(200, { success: true, state: prepared.state, summary: prepared.summary, profile: prepared.profile,
                rewards: prepared.rewards, play: prepared.play,autosave:persistAuto(runs.get(prepared.run_id)), receipt: { id: prepared.receipt_id, quota: prepared.quota, used_props: true } }); return;
            }
            if (prepared.status === 'pending') { json(202, { success: true, pending: true,
              receipt: { id: prepared.receipt_id, quota: prepared.quota, used_props: true } }); return; }
            throw fail(409, '这次道具请求已结束，请重新选择道具。', 'PROP_REQUEST_FAILED');
          }
          if (prepared.status !== 'pending') throw fail(409, '这次道具请求状态已变化。', 'PROP_RECEIPT_CONFLICT');
          try {
            await propWallet.debit({ userId: user.id, quota: PROP_PRICE_QUOTA, operationId: prepared.receipt_id });
          } catch (error) {
            if (error?.code === 'PAYMENT_PENDING') {
              json(202, { success: true, pending: true, receipt: { id: prepared.receipt_id, quota: prepared.quota, used_props: true } }); return;
            }
            store.failPropReceipt(prop.requestId, now());
            throw fail(402, '账户额度扣减未完成，道具没有生效。', error?.code || 'PAYMENT_REFUSED');
          }
          const committedAt = now();
          const receipt = store.commitPropReceipt({ requestId: prop.requestId, now: committedAt, state: applied.state,
            summary, profile: preparedProfile, rewards: preparedRewards, play: preparedPlay,
            week: run.weekId, userId: user.id, name: user.username, runId: run.id, usedProps: true });
          run.state = applied.state; run.summary = summary; run.usedProps = true; run.propRevision = prepared.prop_revision; run.propReceiptId = receipt.receipt_id; run.hash = null;
          run.propCount = Math.max(run.propCount || 0, store.lineagePropCount(user.id, run.lineageId || run.id));
          const autosave=persistAuto(run);
          json(200, { success: true, state: receipt.state, summary: receipt.summary, profile: receipt.profile,
            rewards: receipt.rewards, play: receipt.play,autosave, receipt: { id: receipt.receipt_id, quota: receipt.quota, used_props: true } }); return;
        } finally { run.busy = false; }
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
  arenaRooms.attach(server);
  const cleanup = setInterval(() => {
    for (const [key, value] of limits) if (now() - value.start > 3600000) limits.delete(key);
    for (const [key, value] of authCache) if (value.expires < now()) authCache.delete(key);
    for (const [key, value] of runs) if (now() - value.created > 1800000) runs.delete(key);
    for (const [key, id] of currentRun) if (!runs.has(id)) currentRun.delete(key);
    for (const [key, id] of guestRuns) if (!runs.has(id)) guestRuns.delete(key);
    try { store.cleanupExpiredSaves(now()); store.cleanupFreeSaveOrders(now());autoRecovery.cleanup(); } catch { /* retried on the next cleanup or read */ }
    try { settleDueWeeks(); } catch { /* retried on the next cleanup or read */ }
  }, 60000).unref();
  server.on('close', () => { clearInterval(cleanup); arenaRooms.close(); void verifier.close(); });
  try { settleDueWeeks(); } catch { /* retried on the next cleanup or read */ }
  return { server, store, arenaRooms };
}
