const el = (tag, attrs = {}, text = '') => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.textContent = text;
  return node;
};

export function createArenaRoomUI({ container, client, onRoomChange = () => {}, onError = () => {} }) {
  const nickname = el('input', { maxlength: '16', autocomplete: 'nickname', placeholder: '你的名字', 'aria-label': '房间昵称' });
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
  row.append(code, join);
  form.append(nickname, create, row, restore);
  roomInfo.append(el('span', { class: 'eyebrow' }, '好友房间'), codeLine, seats, invite, retry, start, leave);
  container.replaceChildren(el('p', { class: 'eyebrow' }, '一起开一局'), el('h2', {}, '好友房间'),
    el('p', { class: 'room-description' }, '创建房间后把 6 位房间码发给朋友。空位会由人机补齐。'), form, roomInfo, status);

  let current = null;
  let busy = false;
  function setBusy(value) {
    busy = value;
    for (const button of [create, join, restore, start, retry, leave]) button.disabled = value;
  }
  function showError(error) {
    const message = ({ room_full: '房间已经坐满了。', no_slots: '暂时没有空房间，请稍后再试。', invalid_code: '没有找到这个房间码。', room_not_found: '没有找到这个房间码。', room_not_started: '房间还没开始。' })[error?.code]
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
  create.addEventListener('click', () => run(() => client.create(nickname.value.trim() || '玩家'), '房间创建好了，把房间码发给朋友吧。'));
  join.addEventListener('click', () => run(() => client.join(code.value, nickname.value.trim() || '玩家')));
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
      seats.textContent = `房间里 ${room.seats?.filter((seat) => seat.isHuman).length || 0} 位玩家 · 最多 6 人，空位由人机补齐`;
      const host = String(room.self_id) === String(room.host_id);
      start.hidden = !host || !['waiting', 'ended'].includes(room.phase);
      start.textContent = room.phase === 'ended' ? '再来一局' : '开始对局';
      status.textContent = room.phase === 'playing'
        ? '正在联机对局。'
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
