const el = (tag, attrs = {}, text = '') => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.textContent = text;
  return node;
};

export function createArenaRoomUI({ container, client, onRoomChange = () => {}, onError = () => {} }) {
  const nickname = el('input', { maxlength: '16', autocomplete: 'nickname', placeholder: '你的名字', 'aria-label': '房间昵称' });
  const roomMode = el('select', { 'aria-label': '房间玩法' });
  roomMode.append(el('option', { value: 'ffa' }, '自由混战（默认）'), el('option', { value: 'teams' }, '阵营组队 3v3'));
  const roomTeam = el('select', { 'aria-label': '创建者阵营' });
  roomTeam.append(el('option', { value: '0' }, '国模队'), el('option', { value: '1' }, '美模队'));
  const joinTeam = el('select', { 'aria-label': '加入阵营，可自动平衡' });
  joinTeam.append(el('option', { value: 'auto' }, '自动平衡'), el('option', { value: '0' }, '国模队'), el('option', { value: '1' }, '美模队'));
  const create = el('button', { type: 'button', class: 'primary' }, '创建好友房');
  const code = el('input', { inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code', placeholder: '输入 6 位房间码', 'aria-label': '6 位房间码' });
  code.value = new URLSearchParams(location.search).get('room')?.replace(/\D/g, '').slice(0, 6) || '';
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
  const form = el('div', { class: 'room-form' });
  const row = el('div', { class: 'room-code-row' });
  const createControls = el('div', { class: 'room-team-controls' });
  const joinControls = el('div', { class: 'room-team-controls' });
  createControls.append(el('label', {}, '对局规则'), roomMode, el('label', {}, '你的阵营'), roomTeam);
  joinControls.append(el('label', {}, '加入阵营（可选）'), joinTeam);
  const createTeamLabel = createControls.querySelectorAll('label')[1];
  const setCreateTeamVisible = () => { roomTeam.hidden = roomMode.value !== 'teams'; createTeamLabel.hidden = roomMode.value !== 'teams'; };
  roomMode.addEventListener('change', setCreateTeamVisible);
  setCreateTeamVisible();
  row.append(code, join);
  form.append(nickname, createControls, create, joinControls, row, restore);
  roomInfo.append(el('span', { class: 'eyebrow' }, '好友房间'), codeLine, seats, invite, retry, start, leave);
  container.replaceChildren(el('p', { class: 'eyebrow' }, '一起开一局'), el('h2', {}, '好友房间'),
    el('p', { class: 'room-description' }, '自由混战默认开启；也可选阵营组队 3v3。创建后分享 6 位房间码，空位由人机补齐。'), form, roomInfo, status);

  let current = null;
  let busy = false;
  function setBusy(value) {
    busy = value;
    for (const button of [create, join, restore, start, retry, leave]) button.disabled = value;
    for (const control of [roomMode, roomTeam, joinTeam]) control.disabled = value;
  }
  function showError(error) {
    const message = ({ room_full: '房间已经坐满了。', team_full: '这个阵营已经满员，请选另一队或自动平衡。', no_slots: '暂时没有空房间，请稍后再试。', invalid_code: '没有找到这个房间码。', room_not_found: '没有找到这个房间码。', room_not_started: '房间还没开始。', invalid_mode: '这个玩法暂时不可用，请刷新后重试。', invalid_team: '请选择有效阵营。' })[error?.code]
      || (error?.status === 429 ? '房间现在比较忙，请稍后再试。' : error?.message || '连接房间失败，请重试。');
    status.textContent = message;
    onError(error);
  }
  async function run(action, done) {
    if (busy) return;
    setBusy(true);
    try { await action(); if (done) status.textContent = done; }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  create.addEventListener('click', () => run(() => client.create(nickname.value.trim() || '玩家', {
    mode: roomMode.value,
    ...(roomMode.value === 'teams' ? { teamId: Number(roomTeam.value) } : {}),
  }), '房间创建好了，把房间码发给朋友吧。'));
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
    const url = new URL(location.href);
    url.search = '';
    url.hash = 'room-card';
    url.searchParams.set('room', current.code);
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
      seats.textContent = room.mode === 'teams'
        ? `阵营组队 3v3 · 你在${room.seats?.find((seat) => String(seat.id) === String(room.self_id))?.teamId === 0 ? '国模队' : '美模队'} · 国模队 ${humans.filter((seat) => seat.teamId === 0).length}/3 · 美模队 ${humans.filter((seat) => seat.teamId === 1).length}/3 · 空位由人机补齐`
        : `自由混战 · 房间里 ${humans.length} 位玩家，最多 6 人 · 空位由人机补齐`;
      const host = String(room.self_id) === String(room.host_id);
      start.hidden = !host || !['waiting', 'ended'].includes(room.phase);
      start.textContent = room.phase === 'ended' ? '再来一局' : room.mode === 'teams' ? '开始 3v3 对局' : '开始对局';
      status.textContent = room.phase === 'playing'
        ? room.mode === 'teams' ? '正在进行阵营赛，击飞队友会让己方失分。' : '正在联机对局。'
        : room.phase === 'ended'
          ? '本局结束了，房主可以重新开始。'
          : '等朋友加入后，房主可以开始对局。';
    }
    onRoomChange(room);
  }
  return {
    update,
    setStatus(message, canRetry = false) { if (message) status.textContent = message; retry.hidden = !canRetry || !current; },
    destroy() { container.replaceChildren(); },
  };
}
