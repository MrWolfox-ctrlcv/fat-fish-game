import { ROSTER } from './arena-roster.js';
import { getCharacterFaction } from './arena-teams.js';

const PRESETS = {
  all: [],
  strong: ['astra', 'claude'],
  silly: ['gptSilly', 'doubao'],
};
const factionName = (id) => id === 0 ? '国模队' : '美模队';
export function getMissingTeamFactions(mode, botRoster) {
  if (mode !== 'teams' || !Array.isArray(botRoster) || botRoster.length === 0) return [];
  return [0, 1].filter((team) => !botRoster.some((id) => getCharacterFaction(id) === team));
}
const el = (tag, attrs = {}, text = '') => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.textContent = text;
  return node;
};

export function createArenaSettingsEditor({ prefix, initialMode = 'ffa' }) {
  const root = el('div', { class: 'arena-settings' });
  const mode = el('select', { 'aria-label': `${prefix}玩法` });
  mode.append(el('option', { value: 'ffa' }, '自由混战'), el('option', { value: 'teams' }, '阵营组队'));
  mode.value = initialMode;
  const count = el('select', { 'aria-label': `${prefix}总人数` });
  const updateCounts = () => {
    const max = mode.value === 'teams' ? [2, 4, 6] : [2, 3, 4, 5, 6];
    const current = Number(count.value) || 6;
    count.replaceChildren(...max.map((value) => el('option', { value: String(value) }, `${value} 人`)));
    count.value = String(max.includes(current) ? current : 6);
  };
  count.value = '6';
  mode.addEventListener('change', updateCounts);
  updateCounts();
  const fill = el('input', { type: 'checkbox', 'aria-label': `${prefix}补位人机` });
  fill.checked = true;
  const fillLabel = el('label', { class: 'arena-fill-label' });
  fillLabel.append(fill, document.createTextNode('空位由人机补齐'));
  const roster = el('fieldset', { class: 'arena-roster' });
  roster.append(el('legend', {}, '可加入的人机角色'));
  const presets = el('div', { class: 'arena-presets', role: 'group', 'aria-label': '人机角色预设' });
  const checks = new Map();
  const rosterHint = el('p', { class: 'arena-settings-hint', role: 'status', 'aria-live': 'polite' });
  const presetsRow = el('div', { class: 'arena-preset-buttons' });
  for (const [key, label] of [['all', '全员'], ['strong', '高手'], ['silly', '迷糊']]) {
    const button = el('button', { type: 'button', 'data-roster-preset': key }, label);
    button.addEventListener('click', () => {
      for (const [id, checkbox] of checks) checkbox.checked = key === 'all' || PRESETS[key].includes(id);
      refresh();
    });
    presetsRow.append(button);
  }
  roster.append(presetsRow);
  for (const character of ROSTER) {
    const checkbox = el('input', { type: 'checkbox', value: character.id, 'aria-label': character.name });
    checkbox.checked = true;
    checkbox.addEventListener('change', refresh);
    const label = el('label', { class: 'arena-roster-option' });
    label.append(checkbox, document.createTextNode(`${character.name} · ${character.brain.label}`));
    checks.set(character.id, checkbox);
    roster.append(label);
  }
  presets.append(roster);
  root.append(el('label', {}, `${prefix}玩法`), mode, el('label', {}, '总人数（含房主）'), count, fillLabel, presets, rosterHint);

  function settings() {
    const selected = [...checks].filter(([, checkbox]) => checkbox.checked).map(([id]) => id);
    return { mode: mode.value, maxPlayers: Number(count.value), fillBots: fill.checked,
      botRoster: selected.length === ROSTER.length ? [] : selected };
  }
  function refresh() {
    if (![...checks.values()].some((checkbox) => checkbox.checked)) {
      for (const checkbox of checks.values()) checkbox.checked = true;
    }
    const value = settings();
    const missing = getMissingTeamFactions(value.mode, value.botRoster);
    rosterHint.textContent = missing.length
      ? `组队模式的角色名单还缺少${missing.map(factionName).join('和')}，请选择该阵营角色后再保存。`
      : value.botRoster.length ? `已选择 ${value.botRoster.length} 种人机角色。` : '全员可加入。';
    root.dataset.invalidTeams = String(missing.length > 0);
    return value;
  }
  return { root, mode, count, fill, checks, settings, refresh, set(settings = {}) {
    mode.value = settings.mode === 'teams' ? 'teams' : 'ffa';
    updateCounts();
    if (settings.maxPlayers) count.value = String(settings.maxPlayers);
    fill.checked = settings.fillBots !== false;
    const ids = Array.isArray(settings.botRoster) ? settings.botRoster : [];
    for (const [id, checkbox] of checks) checkbox.checked = !ids.length || ids.includes(id);
    refresh();
  } };
}

export function createArenaRoomUI({ container, client, onRoomChange = () => {}, onError = () => {} }) {
  const nickname = el('input', { maxlength: '16', autocomplete: 'nickname', placeholder: '你的名字', 'aria-label': '房间昵称' });
  const code = el('input', { inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code', placeholder: '输入 6 位房间码', 'aria-label': '6 位房间码' });
  code.value = new URLSearchParams(location.search).get('room')?.replace(/\D/g, '').slice(0, 6) || '';
  const joinTeam = el('select', { 'aria-label': '加入阵营，可自动平衡' });
  joinTeam.append(el('option', { value: 'auto' }, '自动平衡'), el('option', { value: '0' }, '国模队'), el('option', { value: '1' }, '美模队'));
  const create = el('button', { type: 'button', class: 'primary' }, '创建好友房');
  const join = el('button', { type: 'button' }, '加入房间');
  const restore = el('button', { type: 'button' }, '恢复上次房间');
  const status = el('p', { role: 'status', 'aria-live': 'polite', class: 'room-status' }, '邀请好友一起玩；也可以继续单人练习。');
  const roomInfo = el('div', { class: 'room-info', hidden: '' });
  const codeLine = el('strong', { class: 'room-code' });
  const seats = el('p', { class: 'room-seats' });
  const invite = el('button', { type: 'button' }, '复制邀请链接');
  const start = el('button', { type: 'button', class: 'primary', hidden: '' }, '开始对局');
  const retry = el('button', { type: 'button', hidden: '' }, '重新连接');
  const leave = el('button', { type: 'button', class: 'quiet-button' }, '离开房间');
  const saveSettings = el('button', { type: 'button', class: 'primary' }, '保存房间设置');
  const form = el('div', { class: 'room-form' });
  const row = el('div', { class: 'room-code-row' });
  const createSettings = createArenaSettingsEditor({ prefix: '创建房间' });
  const roomSettings = createArenaSettingsEditor({ prefix: '房间' });
  const createTeam = el('select', { 'aria-label': '创建者阵营' });
  createTeam.append(el('option', { value: '0' }, '国模队'), el('option', { value: '1' }, '美模队'));
  const createTeamField = el('label', {}, '你的阵营'); createTeamField.append(createTeam);
  createSettings.root.append(createTeamField);
  createSettings.mode.addEventListener('change', () => { createTeamField.hidden = createSettings.mode.value !== 'teams'; });
  createTeamField.hidden = createSettings.mode.value !== 'teams';
  const joinControls = el('div', { class: 'room-team-controls' });
  joinControls.append(el('label', {}, '加入阵营（可选）'), joinTeam);
  row.append(code, join);
  form.append(nickname, createSettings.root, create, joinControls, row, restore);
  const roomSettingsPanel = el('div', { class: 'room-settings-panel' });
  roomSettingsPanel.append(roomSettings.root, saveSettings);
  roomInfo.append(el('span', { class: 'eyebrow' }, '好友房间'), codeLine, seats, roomSettingsPanel, invite, retry, start, leave);
  container.replaceChildren(el('p', { class: 'eyebrow' }, '一起开一局'), el('h2', {}, '好友房间'),
    el('p', { class: 'room-description' }, '选择 2–6 人对局，也可指定人机角色。创建后分享房间码给朋友。'), form, roomInfo, status);

  let current = null;
  let busy = false;
  function setBusy(value) {
    busy = value;
    for (const button of [create, join, restore, start, retry, leave, saveSettings]) button.disabled = value;
    for (const control of [createSettings.mode, createSettings.count, createSettings.fill, ...createSettings.checks.values(), createTeam, joinTeam]) control.disabled = value;
    if (!current || (String(current.self_id) !== String(current.host_id) || !['waiting', 'ended'].includes(current.phase))) {
      for (const control of [roomSettings.mode, roomSettings.count, roomSettings.fill, ...roomSettings.checks.values()]) control.disabled = value || Boolean(current);
    }
  }
  function showError(error) {
    const message = ({ room_full: '房间已经坐满了。', team_full: '这个阵营已经满员，请选另一队或自动平衡。', no_slots: '暂时没有空房间，请稍后再试。', invalid_code: '没有找到这个房间码。', room_not_found: '没有找到这个房间码。', room_not_started: '房间还没开始。', invalid_mode: '这个玩法暂时不可用，请刷新后重试。', invalid_team: '请选择有效阵营。', invalid_bot_roster: '组队的人机名单必须同时包含国模队和美模队角色。', invalid_settings: '请检查总人数与组队人数设置。', host_only: '只有房主可以修改设置。', not_host: '只有房主可以修改设置。', room_not_editable: '对局进行中，设置暂时锁定。', settings_locked: '对局进行中，设置暂时锁定。', settings_below_occupancy: '总人数不能少于当前房间人数或队伍人数。' })[error?.code]
      || (error?.status === 429 ? '房间现在比较忙，请稍后再试。' : error?.message || '连接房间失败，请重试。');
    status.textContent = message;
    onError(error);
  }
  async function run(action, done) {
    if (busy) return;
    setBusy(true);
    try { await action(); if (done) status.textContent = done; }
    catch (error) { showError(error); }
    finally { setBusy(false); update(current); }
  }
  create.addEventListener('click', () => {
    const settings = createSettings.refresh();
    if (createSettings.root.dataset.invalidTeams === 'true') { status.textContent = createSettings.root.querySelector('.arena-settings-hint').textContent; return; }
    void run(() => client.create(nickname.value.trim() || '玩家', { ...settings, teamId: Number(createTeam.value) }), '房间创建好了，把房间码发给朋友吧。');
  });
  saveSettings.addEventListener('click', () => {
    const settings = roomSettings.refresh();
    if (roomSettings.root.dataset.invalidTeams === 'true') { status.textContent = roomSettings.root.querySelector('.arena-settings-hint').textContent; return; }
    void run(() => client.updateSettings(settings), '房间设置已保存。');
  });
  join.addEventListener('click', () => run(() => client.join(code.value, nickname.value.trim() || '玩家',
    joinTeam.value === 'auto' ? {} : { teamId: Number(joinTeam.value) })));
  restore.addEventListener('click', () => run(async () => {
    const room = await client.restore();
    if (!room) status.textContent = '没有找到可恢复的房间。';
  }));
  start.addEventListener('click', () => run(() => client.start(), '对局开始！'));
  retry.addEventListener('click', () => { client.retry(); status.textContent = '正在重新连接…'; });
  leave.addEventListener('click', () => run(() => client.leave(), '已离开房间，可以继续单人练习。'));
  code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); });
  invite.addEventListener('click', async () => {
    if (!current) return;
    const url = new URL(location.href); url.search = ''; url.hash = 'room-card'; url.searchParams.set('room', current.code);
    try { await navigator.clipboard.writeText(url.href); status.textContent = '邀请链接已复制。打开后还要点“加入房间”。'; }
    catch { status.textContent = `房间码 ${current.code}，复制链接失败，可以手动分享页面地址和房间码。`; }
  });

  function update(room) {
    current = room;
    retry.hidden = true;
    roomInfo.hidden = !room;
    form.hidden = Boolean(room);
    if (room) {
      codeLine.textContent = room.code || '------';
      const humans = room.seats?.filter((seat) => seat.isHuman) || [];
      const max = Number(room.maxPlayers) || 6;
      const bots = room.fillBots === false ? 0 : Math.max(0, max - humans.length);
      seats.textContent = room.mode === 'teams'
        ? `阵营组队 ${max / 2}v${max / 2} · 国模队 ${humans.filter((seat) => seat.teamId === 0).length}/${max / 2} · 美模队 ${humans.filter((seat) => seat.teamId === 1).length}/${max / 2} · 人机 ${bots} 位`
        : `自由混战 · 玩家 ${humans.length}/${max} · 人机 ${bots} 位`;
      const host = String(room.self_id) === String(room.host_id);
      const editable = host && ['waiting', 'ended'].includes(room.phase);
      roomSettingsPanel.hidden = false;
      roomSettings.set({ mode: room.mode, maxPlayers: max, fillBots: room.fillBots, botRoster: room.botRoster });
      for (const control of [roomSettings.mode, roomSettings.count, roomSettings.fill, ...roomSettings.checks.values()]) control.disabled = !editable || busy;
      saveSettings.hidden = !editable;
      start.hidden = !editable;
      start.textContent = room.phase === 'ended' ? '再来一局' : room.mode === 'teams' ? `开始 ${max / 2}v${max / 2} 对局` : '开始对局';
      status.textContent = room.phase === 'playing'
        ? room.mode === 'teams' ? '正在进行阵营赛，击飞队友会让己方失分。' : '正在联机对局。'
        : room.phase === 'ended' ? '本局结束了，房主可以调整设置或重新开始。' : host ? '房间设置仅房主可修改，准备好后即可开始。' : '等待房主开始；当前房间设置仅供查看。';
    } else {
      roomSettingsPanel.hidden = true;
      saveSettings.hidden = true;
    }
    onRoomChange(room);
  }
  return {
    update,
    setStatus(message, canRetry = false) { if (message) status.textContent = message; retry.hidden = !canRetry || !current; },
    destroy() { container.replaceChildren(); },
  };
}
