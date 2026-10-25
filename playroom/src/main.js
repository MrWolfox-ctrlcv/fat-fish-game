import * as bumper from './modes/bumper.js';
import * as kitchen from './modes/kitchen.js';
import * as survival from './modes/survival.js';
import { loadArt, ensureArt, drawAvatar } from './art.js';
import { createAudio } from './audio.js';
import { createCompanion } from './companion.js';
import { makeBumperScene } from './companion-scene.js';
import { createArenaControls } from './arena-controls.js';
import { drawArenaFloor } from './arena-scene.js';
import { arenaViewport, worldPoint } from './arena-view.js';
import { createWardrobe } from './wardrobe.js';
import { createWardrobeClient } from './wardrobe-client.js';
import { createPersonalCompanion } from './personal-companion.js';
import { createCornerCompanion } from './companion-corner.js';
import { createArenaRoomClient } from './arena-room-client.js';
import { createArenaRoomUI } from './arena-room-ui.js';
import { ROSTER } from './arena-roster.js';
import { getTeamLabel } from './arena-teams.js';
import { attributeRoomEvents, getTeamEventText, isRoomEntryIntent, shouldResetRoomGame, teamOutcome } from './arena-room-state.js';

const modes = { bumper, kitchen, survival };
const ids = Object.keys(modes);
const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const wardrobeClient = createWardrobeClient();
const personalCompanion = createPersonalCompanion({ client: wardrobeClient });
const localPreview = location.pathname === '/';
const companion = createCompanion({
  container: $('companion'),
  gameId: () => id,
  personalClient: personalCompanion,
  getSnapshot: () => ({ score: game.score, level: game.level ?? 1, elapsed: game.time, scene: id === 'bumper' ? makeBumperScene(game) : undefined }),
  endpoint: new URL(localPreview ? '/api/companion' : '/games/fat-fish/api/companion', location.origin),
  fetchImpl: (url, options = {}) => options.method === 'POST' && !localPreview
    ? wardrobeClient.fetchAuthorized(String(url), options) : fetch(url, options),
});
const ctx = canvas.getContext('2d', { alpha: false });
const keys = new Set();
const arenaControls = createArenaControls();
const audio = createAudio();
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, value) => { try { localStorage.setItem(key, String(value)); } catch { /* Play without storage. */ } };
const number = (value) => new Intl.NumberFormat('zh-CN').format(value);
let id = ids.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'bumper';
if (!localPreview) {
  id = 'bumper';
  document.title = '碰碰擂台 · 保持 Q 弹';
  document.querySelector('.mode-tabs').hidden = true;
  document.querySelector('.brand i').hidden = true;
  document.querySelector('.tasting-card').hidden = true;
  const back = document.querySelector('.old-game');
  back.href = '/games/fat-fish/'; back.textContent = '合成大肥鱼 ↗';
} else {
  const hallURL = new URL('/games/', location.href);
  hallURL.port = '4184';
  $('hall-link').href = hallURL.href;
}
let mode = modes[id];
let practiceRule = read('wolfox.arena.practiceRule') === 'teams' ? 'teams' : 'ffa';
let practiceTeamId = Number(read('wolfox.arena.practiceTeam')) === 1 ? 1 : 0;
function createCurrentGame() {
  return id === 'bumper'
    ? bumper.createGame({ seed: 20261025, mode: practiceRule, teamId: practiceTeamId })
    : mode.createGame({ seed: 20261025 });
}
let game = createCurrentGame();
let onlineRoom = null;
let onlineSnapshot = null;
let roomSnapshotPair = [];
let onlineRoundEndSeen = false;
let onlineEndEventSeen = false;
let onlineNetworkStatus = 'idle';
let mobileOnlineFocusApplied = false;
let roomClient;
let roomUI;
let onlineInputPrimary = false;
let running = false;
let paused = false;
let ready = false;
let art;
let equippedImage = null;
const wardrobe = createWardrobe({ container: $('wardrobe-dialog'), client: wardrobeClient,
  onOpen: () => { clearInput(); if (running && !paused && !onlineRoom) pause(); },
  onEquip: (image) => { equippedImage = image; applyEquipped(); dirty = true; },
});
wardrobeClient.onSessionChange(() => { equippedImage = null; applyEquipped(); dirty = true; });
function applyEquipped() {
  if (art) art.playerSkin = equippedImage || art.deepseek;
  if (id === 'bumper' && game.player) game.player.skin = 'playerSkin';
}
let lastFrame = 0;
let accumulator = 0;
let viewTime = 0;
let dirty = true;
let pendingReload = false;
let sound = read('wolfox.lab.sound') === 'on';
let pointer = null;
let aim = { x: 360, y: 120 };
let effects = [];
let renderWidth = 0;
let renderHeight = 0;
let lastPaint = 0;
let lastStandings = '';
let floor = null;
let floorRadius = null;
let viewport = { x: 0, y: 0, width: mode.WIDTH, height: mode.HEIGHT };
const bestKey = () => `wolfox.lab.best.${id}${id === 'bumper' ? '.v2' : ''}`;
const bestScore = () => Math.max(0, Number(read(bestKey())) || 0);
const favorites = new Set(ids.filter((key) => read(`wolfox.lab.favorite.${key}`) === 'yes'));
const text = (key, value) => { const node = $(key); if (node.textContent !== String(value)) node.textContent = String(value); };

function saveScore() {
  if (game.score > bestScore()) store(bestKey(), game.score);
}

function clearInput() {
  keys.clear();
  for (const finger of arenaControls.sticks()) if (canvas.hasPointerCapture(finger.id)) canvas.releasePointerCapture(finger.id);
  arenaControls.clear();
  if (pointer && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id);
  pointer = null;
  accumulator = 0;
  if (onlineRoom) roomClient?.neutral();
}

$('companion').addEventListener('pointerdown', clearInput);
$('companion').addEventListener('focusin', clearInput);
createCornerCompanion({ container: $('companion'), trigger: $('companion-toggle'), panel: $('companion-popover'),
  onOpen: () => {
    clearInput();
    if (running && !paused && !onlineRoom) pause();
    else if (onlineRoom) roomUI?.setStatus('联机中聊天不会暂停对局。');
  },
});
$('wardrobe-open').addEventListener('click', () => { void wardrobe.open(); });

function getInput() {
  let x = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  let y = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  if (pointer) { x += pointer.dx; y += pointer.dy; }
  const arena = arenaControls.input(game.player);
  if (id === 'bumper') { x += arena.moveX; y += arena.moveY; }
  const size = Math.max(1, Math.hypot(x, y));
  return { moveX: x / size, moveY: y / size, ...(id === 'bumper' ? { aimX: arena.aimX, aimY: arena.aimY } : { aimX: aim.x, aimY: aim.y }) };
}

function consume(events = []) {
  for (const event of events) {
    const soundType = { kill: 'break', 'friendly-fire': 'hit', dash: 'launch', order: 'return', serve: 'round', level: 'party' }[event.type] || event.type;
    audio.play({ ...event, type: soundType });
    const notice = event.type === 'friendly-fire'
      ? getTeamEventText(event, game.player?.id)
      : event.text || getTeamEventText(event, game.player?.id);
    if (notice && Number.isFinite(event.x) && Number.isFinite(event.y)) {
      effects.push({ ...event, text: notice, age: 0, life: event.type === 'level' ? 1.5 : 0.9 });
      if (effects.length > 35) effects.shift();
    }
    if (event.type === 'end') {
      running = false;
      paused = false;
      clearInput();
      saveScore();
      $('announcer').textContent = `${mode.meta.name}：${game.result} 得分 ${game.score}。`;
    }
  }
  companion.observe(events);
  if (events.length) dirty = true;
}

function command(payload = { type: 'primary' }) {
  if (!running || paused || game.phase !== 'playing') return;
  if (onlineRoom) {
    if (payload.type !== 'primary') return;
    roomClient.setInput({ ...getInput(), primary: true });
    dirty = true;
    return;
  }
  consume(mode.performAction(game, { ...getInput(), ...payload }));
  dirty = true;
}

function reset() {
  if (onlineRoom) { void roomClient.leave(); return; }
  if (pendingReload) { location.reload(); return; }
  saveScore();
  companion.reset();
  clearInput();
  arenaControls.clear(true);
  game = createCurrentGame();
  applyEquipped();
  running = false;
  paused = false;
  effects = [];
  aim = { x: 360, y: 120 };
  dirty = true;
  updateHud();
  setFocusMode(id === 'bumper' && matchMedia('(max-width: 900px)').matches);
}

function chooseMode(next) {
  if (!modes[next]) return;
  const preserveRoomAnchor = next === 'bumper' && isRoomEntryIntent(location.hash, location.search);
  if (onlineRoom && next !== 'bumper') void roomClient.leave();
  saveScore();
  companion.reset();
  clearInput();
  id = next;
  mode = modes[id];
  arenaControls.clear(true);
  lastStandings = '';
  history.replaceState(null, '', `${location.pathname}${location.search}${preserveRoomAnchor ? '#room-card' : `#${id}`}`);
  document.body.dataset.mode = id;
  $('standings-card').hidden = id !== 'bumper';
  $('room-card').hidden = id !== 'bumper';
  $('practice-mode').hidden = id !== 'bumper';
  $('room-mode').hidden = id !== 'bumper';
  $('arena-ribbon').hidden = id !== 'bumper';
  text('page-heading', id === 'bumper' ? '保持 Q 弹，站稳擂台。' : '这次，换个玩法。');
  text('page-description', id === 'bumper' ? '找角度，抓空档。90 秒，把对手撞下去。' : '换个玩法，看看哪种快乐更适合你。');
  text('match-tag', id === 'bumper' ? '单人练习 · 6 人混战 · 90 秒' : '单人 · 60 秒');
  $('game-panel').setAttribute('aria-labelledby', `tab-${id}`);
  document.querySelectorAll('.mode-tabs [data-mode]').forEach((button) => {
    const selected = button.dataset.mode === id;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  text('game-name', mode.meta.name);
  text('mode-tagline', mode.meta.tagline);
  text('instructions', mode.meta.instructions);
  text('stat1-label', mode.meta.stats[0]);
  text('stat2-label', mode.meta.stats[1]);
  $('goals').replaceChildren(...mode.meta.goals.map((goal) => Object.assign(document.createElement('li'), { textContent: goal })));
  $('action').replaceChildren(document.createTextNode(mode.meta.actionLabel.replace(/space\s*/i, '') + ' '), Object.assign(document.createElement('span'), { textContent: 'SPACE / E' }));
  $('kitchen-controls').hidden = id !== 'kitchen';
  $('action').classList.toggle('compact', id === 'kitchen');
  text('input-hint', id === 'kitchen' ? '点工作台：开做 / 出餐 · 1 / 2 / 3 快捷操作 · 空格救急' : id === 'bumper' ? 'WASD 移动 · 鼠标瞄准 · 点击 / 空格冲刺 ｜ 触屏：左手移动，右手瞄准后松手冲刺' : 'WASD / 方向键移动 · 空格 / E 冲刺 · 触屏按住拖动');
  game = createCurrentGame();
  applyEquipped();
  running = false;
  paused = false;
  effects = [];
  aim = { x: 360, y: 120 };
  dirty = true;
  updateHud();
  setFocusMode(id === 'bumper' && matchMedia('(max-width: 900px)').matches && !preserveRoomAnchor);
  if (preserveRoomAnchor) requestAnimationFrame(() => $('room-card').scrollIntoView({ block: 'center', behavior: motion.matches ? 'instant' : 'smooth' }));
}

function start() {
  if (!ready) return;
  if (onlineRoom) {
    if (document.body.classList.contains('arena-focus')) setFocusMode(false);
    $('room-card').scrollIntoView({ block: 'center', behavior: motion.matches ? 'instant' : 'smooth' });
    roomUI.setStatus('联机对局由房间房主控制；可以在右侧房间卡片开始。');
    return;
  }
  if (pendingReload && !paused) { location.reload(); return; }
  if (game.phase !== 'playing') { companion.reset(); game = createCurrentGame(); applyEquipped(); }
  running = true;
  paused = false;
  clearInput();
  lastFrame = performance.now();
  void audio.unlock().catch(() => {});
  dirty = true;
  updateHud();
  canvas.focus({ preventScroll: true });
  if (!document.body.classList.contains('arena-focus')) $('game-panel').scrollIntoView({ block: 'start', behavior: motion.matches ? 'instant' : 'smooth' });
}

function pause() {
  if (!running || game.phase !== 'playing') return;
  if (onlineRoom) { roomClient.neutral(); roomUI.setStatus('联机对局不会暂停，已松开操作。'); return; }
  paused = !paused;
  clearInput();
  dirty = true;
  updateHud();
}

function updateHud() {
  const hud = mode.getHud(game);
  const teamMatch = id === 'bumper' && game.mode === 'teams';
  const teamRank = teamMatch ? bumper.getTeamStandings?.(game).find((row) => row.teamId === game.player?.teamId)?.rank : null;
  const ended = game.phase !== 'playing';
  const active = running && !paused && !ended;
  text('score', number(hud.score));
  const remaining = Math.max(0, Math.ceil(game.duration - hud.time));
  if ($('timer').textContent !== `${remaining} 秒`) {
    $('timer').replaceChildren(document.createTextNode(String(remaining)), Object.assign(document.createElement('small'), { textContent: ' 秒' }));
  }
  text('stat1', teamMatch ? `${hud.teamName || getTeamLabel(game.player?.teamId)} · 第${teamRank || hud.teamRank || 1}名` : hud.stat1);
  text('stat2', hud.stat2);
  text('best', number(bestScore()));
  text('game-message', pendingReload ? '新版本已就绪，下一局自动更新。' : hud.message || mode.meta.tagline);
  text('state-label', ended ? (game.phase === 'draw' || game.result === '阵营平局' ? '这局平手' : game.phase === 'won' ? '这局拿下' : '下局再来') : onlineRoom && !running
    ? (onlineNetworkStatus === 'reconnecting' || onlineNetworkStatus === 'retry-exhausted' ? '恢复连接' : onlineRoom.phase === 'waiting' ? '等待房主' : '同步对局')
    : paused ? '休息一下' : running ? '进行中' : '准备就绪');
  $('overlay').hidden = active;
  $('result-stats').hidden = !ended;
  $('next-mode').hidden = !ended;
  $('start').disabled = !ready || Boolean(onlineRoom && !ended);
  $('pause').disabled = !running || ended;
  if (onlineRoom && !ended) $('pause').disabled = false;
  $('pause').setAttribute('aria-label', onlineRoom ? '联机对局不能暂停' : paused ? '继续游戏' : '暂停游戏');
  $('pause').textContent = paused ? '▷' : 'Ⅱ';
  $('action').disabled = !active;
  $('touch-hints').hidden = id !== 'bumper' || !active;
  if (id === 'bumper') {
    const standings = bumper.getStandings(game);
    const teams = teamMatch
      ? bumper.getTeamStandings?.(game) || [0, 1].map((teamId) => ({ teamId, name: getTeamLabel(teamId), score: game.teamScores?.[teamId] || 0,
        rank: Number(game.teamScores?.[teamId] || 0) >= Number(game.teamScores?.[teamId === 0 ? 1 : 0] || 0) ? 1 : 2 }))
      : [];
    const signature = JSON.stringify({ standings, teams, mode: game.mode });
    if (signature !== lastStandings) {
      lastStandings = signature;
      $('standings').replaceChildren(...standings.map((fighter) => {
        const row = document.createElement('li');
        if (fighter.isPlayer) row.className = 'is-player';
        const name = teamMatch && (fighter.teamId === 0 || fighter.teamId === 1)
          ? `${getTeamLabel(fighter.teamId)} · ${fighter.isPlayer ? '你（玩家）' : fighter.name}`
          : fighter.isPlayer ? '你（玩家）' : fighter.name;
        for (const value of [fighter.rank, name, `${fighter.kills} / ${fighter.falls}`]) {
          const span = document.createElement('span'); span.textContent = value; row.append(span);
        }
        if (teamMatch && (fighter.teamId === 0 || fighter.teamId === 1)) row.classList.add(`team-${fighter.teamId}`);
        return row;
      }));
      $('arena-ribbon').replaceChildren(...standings.map((fighter) => {
        const badge = document.createElement('span'); badge.textContent = `${fighter.isPlayer ? '你' : fighter.name} ${fighter.kills}`;
        if (fighter.isPlayer) badge.className = 'is-player';
        badge.title = `第${fighter.rank}名 · ${fighter.falls}次落水`;
        return badge;
      }));
      $('team-standings').hidden = !teamMatch;
      $('team-standings').replaceChildren(...teams.map((team) => {
        const card = document.createElement('div'); card.className = `team-${team.teamId}`;
        const name = document.createElement('span'); name.textContent = team.name || getTeamLabel(team.teamId);
        const score = document.createElement('strong'); score.textContent = `${number(team.score || 0)} 分 · 第${team.rank || 1}名`;
        card.append(name, score); return card;
      }));
      $('standings-note').textContent = teamMatch
        ? '击飞对手为己方加分；击飞队友会扣分。阵营分相同时并列第一。'
        : '同分时，落水更少者领先。练习对手均为脚本人机。';
    }
    text('score-label', teamMatch ? '个人击飞' : '本局击飞');
  } else text('score-label', '这局得分');
  $('practice-team-card').hidden = Boolean(onlineRoom);
  const lockPracticeRule = Boolean(onlineRoom) || (running && game.phase === 'playing');
  practiceRuleSelect.disabled = lockPracticeRule;
  practiceTeamSelect.disabled = lockPracticeRule;
  document.querySelectorAll('[data-station]').forEach((button) => { button.disabled = !active; });
  if (ended) {
    text('overlay-kicker', game.phase === 'draw' ? 'A TEAM DRAW' : game.phase === 'won' ? 'ONE MORE ROUND?' : 'A NEW TRY, A NEW STORY');
    text('overlay-title', id === 'bumper' ? game.result : game.phase === 'won' ? '这局，有点意思！' : '刚刚那下，差一点。');
    text('overlay-copy', game.result || (game.phase === 'won' ? '挑战完成。再来一局，或者换个口味。' : '歇一秒，试试另一种走法。'));
    text('result-score', number(teamMatch ? game.teamScores?.[game.player?.teamId] || 0 : game.score));
    text('result-best', number(bestScore()));
    text('start', onlineRoom ? '查看房间' : '再来一局 ↗');
  } else if (paused) {
    text('overlay-kicker', 'TAKE A LITTLE BREAK');
    text('overlay-title', '歇一小会儿');
    text('overlay-copy', '时间停在这里，肥鱼等你回来。');
    text('start', '继续这一局 ▷');
  } else {
    text('overlay-kicker', id === 'bumper' ? '90 SECONDS · STAY BOUNCY' : 'ONE MINUTE, ONE MORE TRY');
    text('overlay-title', mode.meta.name);
    text('overlay-copy', onlineRoom
      ? onlineRoom.phase === 'waiting' ? '等待房主开始；空位会由人机补齐。' : onlineNetworkStatus === 'reconnecting' || onlineNetworkStatus === 'retry-exhausted' ? '联机连接中断，正在恢复对局状态。' : '正在同步服务器对局画面…'
      : mode.meta.tagline);
    text('start', onlineRoom ? onlineRoom.phase === 'waiting' ? '等待房主开始' : '正在同步对局…' : ready ? '开始这一局 ↗' : '正在准备…');
  }
  $('sound').setAttribute('aria-pressed', String(sound));
  $('sound').setAttribute('aria-label', sound ? '关闭声音' : '开启声音');
  text('sound-label', sound ? '声音开' : '声音关');
  dirty = false;
}

function finishArenaRound() {
  if (game.mode === 'teams') {
    const outcome = teamOutcome(game.teamScores, game.player?.teamId);
    const ownScore = game.teamScores?.[game.player?.teamId] ?? 0;
    game.phase = outcome === 'lost' ? 'lost' : outcome === 'draw' ? 'draw' : 'won';
    game.result = outcome === 'draw'
      ? '阵营平局'
      : `${getTeamLabel(game.player?.teamId)}${outcome === 'won' ? '获胜' : '落败'} · ${ownScore}分`;
    return;
  }
  const standings = bumper.getStandings(game);
  const row = standings.find((entry) => entry.isPlayer);
  game.phase = row?.rank === 1 ? 'won' : 'lost';
  game.result = `${row?.rank === 1 ? '第1名' : `第${row?.rank}名`} · ${game.score || 0}次击飞`;
}

function applyRoomSnapshot(snapshot) {
  if (!onlineRoom || id !== 'bumper' || !snapshot) return;
  const arrivedAt = performance.now();
  roomSnapshotPair.push({ snapshot, arrivedAt });
  if (roomSnapshotPair.length > 2) roomSnapshotPair.shift();
  onlineSnapshot = snapshot;
  const selfId = Number(onlineRoom.self_id);
  const byId = new Map((onlineRoom.seats || []).map((seat) => [Number(seat.id), seat]));
  game.arenaRadius = snapshot.radius;
  game.time = snapshot.time;
  game.mode = snapshot.mode || onlineRoom.mode || 'ffa';
  game.teamScores = snapshot.teamScores || [0, 0];
  game.duration = 90;
  game.phase = snapshot.phase === 'ended' ? 'ended' : 'playing';
  game.fighters = snapshot.fighters.map((wire) => {
    const fighter = game.fighters.find((item) => item.id === wire.id) || {};
    const roster = ROSTER[wire.characterId] || ROSTER[0];
    const seat = byId.get(wire.id);
    Object.assign(fighter, wire, {
      id: wire.id,
      characterId: roster.id,
      name: wire.id === selfId ? '你' : seat?.nickname || roster.name,
      skin: wire.id === selfId ? 'playerSkin' : roster.skin,
      teamId: wire.teamId ?? seat?.teamId ?? null,
      r: 26,
      isPlayer: wire.id === selfId,
      isHuman: wire.isHuman,
      invulnerable: wire.invulnerable ? 1 : 0,
      dashX: Math.cos(wire.facing), dashY: Math.sin(wire.facing),
      aimX: wire.x + Math.cos(wire.facing) * 100,
      aimY: wire.y + Math.sin(wire.facing) * 100,
    });
    return fighter;
  });
  game.player = game.fighters.find((fighter) => fighter.id === selfId) || game.fighters[0];
  if (game.player) { game.player.isPlayer = true; game.player.skin = 'playerSkin'; }
  game.score = game.player?.kills || 0;
  if (snapshot.phase === 'ended' && game.player) {
    finishArenaRound();
    onlineRoundEndSeen = true;
  }
  running = snapshot.phase === 'playing';
  onlineNetworkStatus = 'connected';
  paused = false;
  if (snapshot.phase === 'playing' && !mobileOnlineFocusApplied && matchMedia('(max-width: 900px)').matches) {
    mobileOnlineFocusApplied = true;
    if (!document.body.classList.contains('arena-focus')) setFocusMode(true);
  }
  dirty = true;
  updateHud();
}

function applyOnlineEvents(events) {
  if (!onlineRoom || !Array.isArray(events)) return;
  const selfId = Number(onlineRoom.self_id);
  const relevant = attributeRoomEvents(events, selfId);
  const converted = relevant.flatMap((event) => {
    if (event.type === 'end') {
      if (onlineEndEventSeen) return [];
      onlineEndEventSeen = true;
      onlineRoundEndSeen = true;
      finishArenaRound();
      running = false;
    }
    return [{
    ...event,
    type: event.type === 'end' ? 'end' : event.type,
    text: event.text || getTeamEventText(event, selfId) || ({ dash: '冲！', fall: '掉出台外' }[event.type] || ''),
    ...(game.player ? { x: Number.isFinite(event.x) ? event.x : game.player.x, y: Number.isFinite(event.y) ? event.y : game.player.y } : {}),
    }];
  });
  consume(converted);
}

function onRoomUpdate(room) {
  const previousRoom = onlineRoom;
  const wasOnline = Boolean(previousRoom);
  const nextRoom = room || null;
  if (!nextRoom) {
    onlineRoom = null;
    onlineNetworkStatus = 'idle';
    onlineSnapshot = null;
    roomSnapshotPair = [];
    onlineRoundEndSeen = false;
    onlineEndEventSeen = false;
    mobileOnlineFocusApplied = false;
  } else {
    if (!wasOnline || String(previousRoom.code) !== String(nextRoom.code)) onlineNetworkStatus = 'joining';
    if (id !== 'bumper') chooseMode('bumper');
    const resetGame = shouldResetRoomGame(previousRoom, nextRoom, game.phase, onlineSnapshot?.phase);
    onlineRoom = nextRoom;
    const seats = nextRoom.seats || [];
    const humanIds = seats.map((seat) => Number(seat.id)).filter(Number.isInteger);
    if (resetGame) {
      onlineSnapshot = null;
      roomSnapshotPair = [];
      onlineRoundEndSeen = false;
      onlineEndEventSeen = false;
      mobileOnlineFocusApplied = false;
      const humanTeams = Object.fromEntries(seats.filter((seat) => seat.teamId === 0 || seat.teamId === 1).map((seat) => [Number(seat.id), seat.teamId]));
      game = bumper.createGame({ humanIds: humanIds.length ? humanIds : [Number(nextRoom.self_id) || 0], mode: nextRoom.mode || 'ffa', humanTeams });
      game.phase = 'playing';
      game.score = 0;
      game.result = '';
      for (const fighter of game.fighters) {
        const seat = seats.find((item) => Number(item.id) === fighter.id);
        fighter.isPlayer = fighter.id === Number(nextRoom.self_id);
        if (seat) fighter.name = fighter.isPlayer ? '你' : seat.nickname || fighter.name;
        if (fighter.isPlayer) fighter.skin = 'playerSkin';
      }
      game.player = game.fighters.find((fighter) => fighter.isPlayer) || game.fighters[0];
      applyEquipped();
    } else {
      // Metadata refreshes may change nicknames or connection flags; keep scores and the latest snapshots.
      for (const fighter of game.fighters) {
        const seat = seats.find((item) => Number(item.id) === fighter.id);
        if (seat && fighter.id !== Number(nextRoom.self_id)) fighter.name = seat.nickname || fighter.name;
      }
    }
    if (art) void ensureArt(art, game.fighters).then(() => { dirty = true; });
    if (resetGame) { running = false; paused = false; clearInput(); }
  }
  if (!nextRoom && wasOnline) {
    clearInput();
    game = mode.createGame({ seed: 20261025 });
    applyEquipped();
    running = false;
    paused = false;
    effects = [];
    dirty = true;
  }
  roomUI?.update(onlineRoom);
  updateHud();
}

roomClient = createArenaRoomClient({
  basePath: '/games/bumper',
  onRoom: onRoomUpdate,
  onEvents: applyOnlineEvents,
  onSnapshot: applyRoomSnapshot,
  onStatus: (status) => {
    onlineNetworkStatus = status;
    if (['reconnecting', 'retry-exhausted', 'error'].includes(status) && onlineRoom) {
      running = false;
      clearInput();
    }
    const labels = { joining: '正在连接房间…', connected: '房间连接稳定。', reconnecting: '连接中断，正在重连…', 'retry-exhausted': '暂时无法重连。可手动重试，或离开房间。', 'snapshot-error': '收到无效的对局数据，请重新连接。', error: '房间连接失败，请稍后重试。' };
    if (onlineRoom && labels[status]) roomUI?.setStatus(labels[status], status === 'retry-exhausted' || status === 'error');
    if (onlineRoom) { dirty = true; updateHud(); }
  },
});
roomUI = createArenaRoomUI({ container: $('room-card'), client: roomClient });

const practiceRuleSelect = $('practice-rule');
const practiceTeamSelect = $('practice-team');
practiceRuleSelect.value = practiceRule;
practiceTeamSelect.value = String(practiceTeamId);
$('practice-team-field').hidden = practiceRule !== 'teams';
practiceRuleSelect.addEventListener('change', () => {
  if (running || onlineRoom) return;
  practiceRule = practiceRuleSelect.value === 'teams' ? 'teams' : 'ffa';
  store('wolfox.arena.practiceRule', practiceRule);
  $('practice-team-field').hidden = practiceRule !== 'teams';
  game = createCurrentGame();
  applyEquipped();
  effects = [];
  lastStandings = '';
  dirty = true;
  updateHud();
});
practiceTeamSelect.addEventListener('change', () => {
  if (running || onlineRoom) return;
  practiceTeamId = Number(practiceTeamSelect.value) === 1 ? 1 : 0;
  store('wolfox.arena.practiceTeam', practiceTeamId);
  if (practiceRule !== 'teams') return;
  game = createCurrentGame();
  applyEquipped();
  effects = [];
  lastStandings = '';
  dirty = true;
  updateHud();
});

function toPoint(event) {
  const box = canvas.getBoundingClientRect();
  return worldPoint(event.clientX, event.clientY, box, viewport);
}

canvas.addEventListener('pointerdown', (event) => {
  if (!running || paused || game.phase !== 'playing' || event.button !== 0) return;
  event.preventDefault();
  canvas.focus({ preventScroll: true });
  const point = toPoint(event);
  aim = point;
  if (id === 'bumper') {
    if (event.pointerType === 'mouse') { arenaControls.setMouseAim(point); command(); }
    else {
      const box = canvas.getBoundingClientRect();
      if (arenaControls.begin(event.pointerId, event.clientX - box.left, event.clientY - box.top, box.width)) canvas.setPointerCapture(event.pointerId);
    }
    return;
  }
  if (id === 'kitchen') { command({ type: 'pointer', ...point }); return; }
  pointer = { id: event.pointerId, baseX: point.x, baseY: point.y, x: point.x, y: point.y, dx: 0, dy: 0 };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  const point = toPoint(event);
  aim = point;
  if (id === 'bumper') {
    if (event.pointerType === 'mouse') arenaControls.setMouseAim(point);
    else { const box = canvas.getBoundingClientRect(); arenaControls.move(event.pointerId, event.clientX - box.left, event.clientY - box.top); }
    return;
  }
  if (!pointer || pointer.id !== event.pointerId) return;
  pointer.x = point.x;
  pointer.y = point.y;
  const dx = (point.x - pointer.baseX) / 60;
  const dy = (point.y - pointer.baseY) / 60;
  const magnitude = Math.max(1, Math.hypot(dx, dy));
  pointer.dx = dx / magnitude;
  pointer.dy = dy / magnitude;
});
const releasePointer = (event) => {
  if (id === 'bumper') {
    const dash = arenaControls.end(event.pointerId, event.type !== 'pointerup');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (dash) command();
    return;
  }
  if (pointer?.id !== event.pointerId) return;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  pointer = null;
};
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('lostpointercapture', (event) => { if (id === 'bumper') arenaControls.end(event.pointerId, true); else pointer = null; });
canvas.addEventListener('contextmenu', (event) => { if (id === 'bumper') event.preventDefault(); });

document.addEventListener('keydown', (event) => {
  if (event.target.closest('input,textarea,select,[contenteditable=true]')) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'escape') { if (running) { event.preventDefault(); pause(); } return; }
  if (!running || paused || game.phase !== 'playing') return;
  if (['w', 'a', 's', 'd', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
    event.preventDefault(); keys.add(key);
  } else if (['1', '2', '3'].includes(key) && id === 'kitchen') {
    event.preventDefault(); if (!event.repeat) command({ type: 'station', id: Number(key) - 1 });
  } else if ((key === ' ' || key === 'e') && event.target.tagName !== 'BUTTON') {
    event.preventDefault(); if (!event.repeat) command();
  }
});
document.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => { clearInput(); if (running && !paused && !onlineRoom) pause(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInput();
    if (running && !paused && !onlineRoom) pause();
    audio.setEnabled(false);
  } else { audio.setEnabled(sound); lastFrame = performance.now(); }
});
window.addEventListener('pagehide', saveScore);
$('start').addEventListener('click', start);
$('practice-mode').addEventListener('click', () => {
  if (onlineRoom) { void roomClient.leave(); return; }
  if (!running || game.phase !== 'playing') start();
  else $('game-panel').scrollIntoView({ block: 'start', behavior: motion.matches ? 'instant' : 'smooth' });
});
$('room-mode').addEventListener('click', () => {
  if (document.body.classList.contains('arena-focus')) setFocusMode(false);
  $('room-card').scrollIntoView({ block: 'center', behavior: motion.matches ? 'instant' : 'smooth' });
  $('room-card').querySelector('input[aria-label="6 位房间码"]')?.focus({ preventScroll: true });
});
$('pause').addEventListener('click', pause);
$('restart').addEventListener('click', reset);
$('action').addEventListener('click', () => command());

function setFocusMode(enabled) {
  document.body.classList.toggle('arena-focus', enabled);
  document.querySelectorAll('header,.intro,.mode-tabs,aside,footer').forEach((node) => { node.inert = enabled; });
  $('expand').setAttribute('aria-pressed', String(enabled));
  text('expand', enabled ? '返回页面 ↙' : '专注模式 ↗');
  clearInput();
  dirty = true;
}
$('expand').addEventListener('click', () => setFocusMode(!document.body.classList.contains('arena-focus')));
document.querySelectorAll('[data-station]').forEach((button) => button.addEventListener('click', () => command({ type: 'station', id: Number(button.dataset.station) })));
document.querySelectorAll('.mode-tabs [data-mode]').forEach((button) => {
  button.addEventListener('click', () => chooseMode(button.dataset.mode));
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next = ids[(ids.indexOf(id) + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
    chooseMode(next);
    $(`tab-${next}`).focus();
  });
});
$('next-mode').addEventListener('click', () => chooseMode(ids[(ids.indexOf(id) + 1) % ids.length]));
$('sound').addEventListener('click', async () => {
  sound = !sound;
  audio.setEnabled(sound);
  try { if (sound) { if (await audio.unlock()) audio.play({ type: 'round' }); else sound = false; } } catch { sound = false; }
  audio.setEnabled(sound);
  store('wolfox.lab.sound', sound ? 'on' : 'off');
  dirty = true;
  updateHud();
});
function renderFavorites() {
  document.querySelectorAll('[data-favorite]').forEach((button) => {
    const key = button.dataset.favorite;
    const favorite = favorites.has(key);
    button.setAttribute('aria-pressed', String(favorite));
    button.textContent = `${favorite ? '★' : '☆'} ${{ bumper: '擂台', kitchen: '厨房', survival: '幸存者' }[key]}`;
  });
}
document.querySelectorAll('[data-favorite]').forEach((button) => button.addEventListener('click', () => {
  const key = button.dataset.favorite;
  if (favorites.has(key)) favorites.delete(key); else favorites.add(key);
  store(`wolfox.lab.favorite.${key}`, favorites.has(key) ? 'yes' : 'no');
  renderFavorites();
}));

function resize() {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(3500000 / Math.max(1, rect.width * rect.height)));
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (width !== renderWidth || height !== renderHeight) {
    canvas.width = renderWidth = Math.max(1, width);
    canvas.height = renderHeight = Math.max(1, height);
  }
  if (id === 'bumper') {
    viewport = arenaViewport(rect.width, rect.height);
  } else viewport = { x: 0, y: 0, width: mode.WIDTH, height: mode.HEIGHT };
  ctx.setTransform(renderWidth / viewport.width, 0, 0, renderHeight / viewport.height, -viewport.x * renderWidth / viewport.width, -viewport.y * renderHeight / viewport.height);
}

function drawCrew() {
  const image = $('crew-art');
  const c = image.getContext('2d');
  c.clearRect(0, 0, 480, 130);
  ['gptSilly', 'deepseek', 'fakeClaude'].forEach((skin, index) => {
    const bob = motion.matches ? 0 : Math.sin(viewTime * 2 + index) * 3;
    drawAvatar(c, art, skin, 105 + index * 135, 66 + bob, index === 1 ? 105 : 88, index === 0 ? -.08 : index === 2 ? .08 : 0);
  });
}

function renderEffects() {
  for (const effect of effects) {
    const progress = effect.age / effect.life;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.font = `600 ${id === 'bumper' ? 22 : 14}px "Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = id === 'kitchen' ? '#976f4d' : '#fff3c4';
    ctx.shadowColor = '#13283f';
    ctx.shadowBlur = id === 'kitchen' ? 0 : 3;
    ctx.fillText(effect.text, effect.x, effect.y - 24 - progress * (motion.matches ? 0 : 20));
    ctx.restore();
  }
  if (id === 'bumper') {
    const rect = canvas.getBoundingClientRect();
    const scale = viewport.width / Math.max(1, rect.width);
    for (const finger of arenaControls.sticks()) {
      const x = viewport.x + finger.baseX * scale;
      const y = viewport.y + finger.baseY * scale;
      ctx.save(); ctx.strokeStyle = finger.role === 'move' ? '#99dfdcaa' : '#f3c69faa'; ctx.fillStyle = '#0a24334d'; ctx.lineWidth = 2 * scale;
      ctx.beginPath(); ctx.arc(x, y, 48 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = finger.role === 'move' ? '#b7eee0bb' : '#ffe1b7bb';
      ctx.beginPath(); ctx.arc(x + finger.dx * 35 * scale, y + finger.dy * 35 * scale, 16 * scale, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
  if (pointer && id !== 'kitchen') {
    ctx.save();
    ctx.globalAlpha = .55;
    ctx.strokeStyle = '#d7f3e6';
    ctx.fillStyle = '#d7f3e622';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(pointer.baseX, pointer.baseY, 45, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d7f3e6';
    ctx.beginPath(); ctx.arc(pointer.baseX + pointer.dx * 34, pointer.baseY + pointer.dy * 34, 13, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function frame(now) {
  if (document.hidden) { lastFrame = 0; requestAnimationFrame(frame); return; }
  // Deliver only the single still-fresh pending event, including after the match ends.
  companion.observe([]);
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .1) : 0;
  lastFrame = now;
  if (!document.hidden) {
    viewTime += dt;
    if (running && !paused && game.phase === 'playing' && onlineRoom) {
      roomClient.setInput(getInput());
      dirty = true;
    } else if (running && !paused && game.phase === 'playing') {
      accumulator += dt;
      while (accumulator + 1e-12 >= 1 / 60 && running && game.phase === 'playing') {
        accumulator -= 1 / 60;
        consume(mode.stepGame(game, getInput(), 1 / 60));
      }
      dirty = true;
    }
    if (!paused) {
      for (const effect of effects) effect.age += dt;
      effects = effects.filter((effect) => effect.age < effect.life);
    }
  }
  if ((!running || paused) && !dirty && now - lastPaint < 50) { requestAnimationFrame(frame); return; }
  lastPaint = now;
  resize();
  ctx.fillStyle = '#172a45'; ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  if (onlineRoom && roomSnapshotPair.length === 2) {
    const [previous, current] = roomSnapshotPair;
    const duration = Math.max(1, current.arrivedAt - previous.arrivedAt);
    const alpha = Math.max(0, Math.min(1, (now - 100 - previous.arrivedAt) / duration));
    const previousById = new Map(previous.snapshot.fighters.map((fighter) => [fighter.id, fighter]));
    const currentById = new Map(current.snapshot.fighters.map((fighter) => [fighter.id, fighter]));
    for (const fighter of game.fighters) {
      const before = previousById.get(fighter.id);
      const after = currentById.get(fighter.id);
      if (!before || !after) continue;
      for (const key of ['x', 'y', 'vx', 'vy', 'facing', 'dashCooldown', 'dashTimer']) {
        fighter[key] = before[key] + (after[key] - before[key]) * alpha;
      }
    }
  }
  if (id === 'bumper') {
    floor ??= document.createElement('canvas');
    if (!floor.width || floor.width !== bumper.WIDTH) { floor.width = bumper.WIDTH; floor.height = bumper.HEIGHT; }
    const radius = Math.round(game.arenaRadius / 2) * 2;
    if (radius !== floorRadius) { floorRadius = radius; drawArenaFloor(floor.getContext('2d'), radius); }
  }
  mode.renderGame(ctx, game, { art, time: viewTime, reducedMotion: motion.matches, effects, floor: id === 'bumper' ? floor : null });
  renderEffects();
  drawCrew();
  if (dirty) updateHud();
  requestAnimationFrame(frame);
}

chooseMode(id);
renderFavorites();
try {
  art = await loadArt();
  applyEquipped();
  drawAvatar($('brand-art').getContext('2d'), art, 'deepseek', 32, 32, 60);
  audio.setEnabled(sound);
  ready = true;
  void wardrobe.restore?.();
  updateHud();
  requestAnimationFrame(frame);
} catch (error) {
  text('overlay-title', '肥鱼还没集合好');
  text('overlay-copy', '请刷新页面，再召集一次。');
  console.error(error);
}

if (localPreview && location.port === '4179') {
  const updates = new EventSource('/__dev/events');
  updates.addEventListener('update', () => {
    if (!running || game.phase !== 'playing') location.reload();
    else { pendingReload = true; dirty = true; }
  });
}
