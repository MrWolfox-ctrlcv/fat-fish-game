import { createWardrobeClient } from './wardrobe-client.js';

const STARTER_ID = 'maid:1';
const PER_PAGE = 6;
const STARTER = { id: STARTER_ID, name: '女仆', level: 1, variant: null, unlocked: true, source: 'starter' };

export function shouldRefreshWardrobeForSessionEvent(event) {
  return ['account_changed', 'signed_out'].includes(event?.type)
    || (event?.type === 'authenticated' && event.source === 'broadcast');
}

function normalizeCatalog(data) {
  const list = (Array.isArray(data?.catalog) ? data.catalog : []).filter((item) => item && typeof item.id === 'string').map((item, order) => ({
    id: item.id, name: String(item.name || '未知造型'), level: Math.max(1, Number(item.level) || 1),
    variant: typeof item.variant === 'string' ? item.variant : null, unlocked: item.unlocked === true,
    source: item.source === 'starter' || item.source === 'merge' ? item.source : null, order,
  }));
  if (!list.some((item) => item.id === STARTER_ID)) list.unshift({ ...STARTER, order: -1 });
  return list.sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || a.order - b.order);
}

export function createWardrobe({ container, client, onEquip = () => {}, onOpen = () => {}, fetchImpl } = {}) {
  if (!container) throw new TypeError('Wardrobe requires a dialog container');
  const ownsClient = !client;
  const apiClient = client || createWardrobeClient({ fetchImpl });
  const root = document.createElement('section'); root.className = 'wardrobe'; root.setAttribute('aria-label', '造型衣柜');
  const heading = document.createElement('h2'); heading.className = 'wardrobe__title'; heading.textContent = '衣柜';
  const closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.className = 'wardrobe__close'; closeButton.textContent = '关闭'; closeButton.setAttribute('aria-label', '关闭衣柜'); closeButton.autofocus = true;
  const status = document.createElement('p'); status.className = 'wardrobe__status'; status.setAttribute('aria-live', 'polite');
  const grid = document.createElement('div'); grid.className = 'wardrobe__grid';
  const pager = document.createElement('div'); pager.className = 'wardrobe__pager';
  const prev = document.createElement('button'); prev.type = 'button'; prev.textContent = '上一页'; prev.setAttribute('aria-label', '上一页造型');
  const pageLabel = document.createElement('span'); pageLabel.className = 'wardrobe__page';
  const next = document.createElement('button'); next.type = 'button'; next.textContent = '下一页'; next.setAttribute('aria-label', '下一页造型');
  pager.append(prev, pageLabel, next);
  const detail = document.createElement('p'); detail.className = 'wardrobe__detail'; detail.textContent = '造型不影响对战数值';
  const login = document.createElement('a'); login.className = 'wardrobe__login'; login.textContent = '登录并同步衣柜'; login.hidden = true;
  const host = globalThis.location?.hostname;
  login.href = host === 'localhost' || host === '127.0.0.1'
    ? 'https://oua-cdn.wolfoxlabs.xyz/games/bumper/'
    : '/sign-in?redirect=%2Fgames%2Fbumper%2F';
  root.append(heading, closeButton, status, grid, pager, detail, login); container.append(root);

  let items = [];
  let equipped = STARTER_ID;
  let page = 0;
  let generation = 0;
  let controller = null;
  let open = false;
  let disposed = false;
  let objectUrls = [];
  let selectedImageUrl = null;
  let equipBusy = false;
  const $ = (tag, cls) => { const node = document.createElement(tag); node.className = cls; return node; };
  const releaseImages = () => {
    for (const url of objectUrls) if (url !== selectedImageUrl) URL.revokeObjectURL(url);
    objectUrls = selectedImageUrl ? [selectedImageUrl] : [];
  };
  const releaseSelectedImage = () => {
    if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl);
    selectedImageUrl = null;
  };
  const cancelWork = () => { generation += 1; controller?.abort(); controller = null; releaseImages(); grid.replaceChildren(); };

  function updatePager() {
    const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
    page = Math.min(Math.max(0, page), pages - 1);
    pageLabel.textContent = `${page + 1} / ${pages}`;
    prev.disabled = page === 0; next.disabled = page >= pages - 1;
  }

  async function loadCardImage(item, image, button, visual, ticket, signal) {
    try {
      const response = await apiClient.art(item, { signal });
      if (!response.ok) throw new Error(`Sprite ${response.status}`);
      const blob = await response.blob();
      if (disposed || ticket !== generation || signal.aborted) return;
      const url = URL.createObjectURL(blob); objectUrls.push(url);
      image.src = url;
      await image.decode();
      if (disposed || ticket !== generation || signal.aborted) { if (url !== selectedImageUrl) URL.revokeObjectURL(url); return; }
      visual.replaceChildren(image);
      button.textContent = item.id === equipped ? '已装备' : '装备';
      button.setAttribute('aria-label', `${item.name}：${button.textContent}`);
      button.disabled = equipBusy;
      button.dataset.ready = 'true';
    } catch (error) {
      if (error?.name === 'AbortError' || ticket !== generation || signal.aborted) return;
      visual.replaceChildren(Object.assign($('span', 'wardrobe__question'), { textContent: '?' }));
      button.textContent = '图片暂不可用';
      button.disabled = true;
    }
  }

  function renderPage() {
    controller?.abort(); controller = null;
    releaseImages(); grid.replaceChildren(); updatePager();
    const slice = items.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
    const currentController = new AbortController(); controller = currentController;
    const ticket = generation;
    const jobs = [];
    for (const item of slice) {
      const card = $('article', `wardrobe__card${item.unlocked ? '' : ' is-locked'}${item.id === equipped ? ' is-equipped' : ''}`);
      card.dataset.skinId = item.id;
      const visual = $('div', 'wardrobe__visual');
      const title = $('strong', 'wardrobe__name'); title.textContent = item.name;
      if (item.unlocked) {
        const placeholder = $('span', 'wardrobe__loading'); placeholder.textContent = '…'; visual.append(placeholder);
      } else visual.append(Object.assign($('span', 'wardrobe__question'), { textContent: '?' }));
      card.append(visual, title);
      if (item.unlocked && item.source === 'merge') { const source = $('span', 'wardrobe__source'); source.textContent = '大肥鱼解锁'; card.append(source); }
      const button = $('button', 'wardrobe__choose'); button.type = 'button'; button.dataset.skinId = item.id;
      button.textContent = item.id === equipped ? '已装备' : item.unlocked ? '加载中…' : '未解锁';
      button.disabled = !item.unlocked || equipBusy;
      button.setAttribute('aria-label', `${item.name}：${button.textContent}`);
      button.addEventListener('click', () => { void choose(item); });
      card.append(button); grid.append(card);
      if (item.unlocked) {
        const image = document.createElement('img'); image.alt = item.name; image.decoding = 'async';
        jobs.push(loadCardImage(item, image, button, visual, ticket, currentController.signal));
      }
    }
    void Promise.allSettled(jobs);
  }

  async function refresh() {
    if (!open || disposed) return;
    cancelWork(); const ticket = generation;
    status.textContent = '正在读取衣柜…'; login.hidden = true;
    try {
      const data = await apiClient.get();
      if (!open || disposed || ticket !== generation) return;
      items = normalizeCatalog(data); equipped = items.some((x) => x.id === data.equipped && x.unlocked) ? data.equipped : STARTER_ID;
      login.hidden = !data.guest;
      status.textContent = data.guest ? '访客预览 · 女仆造型可用' : `已解锁 ${Number(data.unlocked_count) || 0} / 31 款`;
      renderPage();
    } catch {
      if (!open || disposed || ticket !== generation) return;
      items = [{ ...STARTER, unlocked: true }]; equipped = STARTER_ID; login.hidden = true;
      status.textContent = '衣柜暂不可用 · 可继续使用默认造型'; renderPage();
    }
  }

  async function choose(item) {
    if (!item.unlocked || !open || disposed || equipBusy) return;
    const card = [...grid.children].find((node) => node.dataset.skinId === item.id);
    const image = card?.querySelector('img');
    const button = card?.querySelector('.wardrobe__choose');
    if (!image || !image.complete || !image.naturalWidth || button?.dataset.ready !== 'true') return;
    equipBusy = true;
    for (const candidate of grid.querySelectorAll('.wardrobe__choose')) candidate.disabled = true;
    const ticket = generation; status.textContent = '正在装备…';
    try {
      let result;
      if (item.id === STARTER_ID && !apiClient.owner) result = { success: true, equipped: STARTER_ID };
      else result = await apiClient.equip(item.id);
      if (!open || disposed || ticket !== generation) return;
      if (result?.success !== true || result.equipped !== item.id) throw new Error('Equip rejected');
      equipped = item.id;
      const nextUrl = image.src;
      onEquip(image, item.id);
      if (selectedImageUrl && selectedImageUrl !== nextUrl) URL.revokeObjectURL(selectedImageUrl);
      selectedImageUrl = nextUrl;
      status.textContent = '造型已装备';
      renderPage();
    } catch {
      if (ticket === generation) status.textContent = '装备失败 · 请稍后重试';
    } finally {
      equipBusy = false;
      if (ticket === generation) for (const candidate of grid.querySelectorAll('.wardrobe__choose')) {
        candidate.disabled = candidate.dataset.ready !== 'true';
      }
    }
  }

  async function restore() {
    if (disposed) return;
    cancelWork(); const ticket = generation;
    const currentController = new AbortController(); controller = currentController;
    try {
      const data = await apiClient.get();
      if (disposed || ticket !== generation) return;
      const catalog = normalizeCatalog(data);
      const item = catalog.find((entry) => entry.id === data.equipped && entry.unlocked) || STARTER;
      const response = await apiClient.art(item, { signal: currentController.signal });
      if (!response.ok) throw new Error(`Sprite ${response.status}`);
      const blob = await response.blob();
      if (disposed || ticket !== generation || currentController.signal.aborted) return;
      const url = URL.createObjectURL(blob); objectUrls.push(url);
      const image = document.createElement('img'); image.alt = item.name; image.src = url;
      await image.decode();
      if (disposed || ticket !== generation || currentController.signal.aborted) { URL.revokeObjectURL(url); return; }
      const previous = selectedImageUrl;
      selectedImageUrl = url;
      onEquip(image, item.id);
      if (previous && previous !== url) URL.revokeObjectURL(previous);
      equipped = item.id;
    } catch {
      if (ticket === generation && !disposed) {
        releaseSelectedImage();
        onEquip(null, STARTER_ID);
      }
    }
  }

  prev.addEventListener('click', () => { page -= 1; cancelWork(); renderPage(); });
  next.addEventListener('click', () => { page += 1; cancelWork(); renderPage(); });
  closeButton.addEventListener('click', () => { if (typeof container.close === 'function') container.close(); else { open = false; cancelWork(); } });
  for (const eventName of ['keydown', 'keyup', 'keypress']) container.addEventListener(eventName, (event) => event.stopPropagation());
  container.addEventListener('close', () => { open = false; cancelWork(); });
  container.addEventListener('cancel', () => { open = false; cancelWork(); });
  const unsubscribe = apiClient.onSessionChange?.((event) => {
    if (!shouldRefreshWardrobeForSessionEvent(event)) return;
    equipped = STARTER_ID; page = 0; cancelWork(); releaseSelectedImage(); onEquip(null, STARTER_ID);
    if (open) void refresh();
    else { items = [{ ...STARTER }]; status.textContent = '账户已切换 · 将使用默认造型'; }
  });

  return {
    async open() {
      if (disposed) return;
      if (!open) { open = true; onOpen(); if (!container.open && typeof container.showModal === 'function') container.showModal(); }
      await refresh();
    },
    refresh,
    restore,
    reset() { equipped = STARTER_ID; page = 0; cancelWork(); releaseSelectedImage(); onEquip(null, STARTER_ID); if (open) void refresh(); },
    close() { open = false; cancelWork(); if (container.open && typeof container.close === 'function') container.close(); },
    destroy() { disposed = true; open = false; cancelWork(); releaseSelectedImage(); unsubscribe?.(); if (ownsClient) apiClient.destroy?.(); container.removeChild(root); },
  };
}
