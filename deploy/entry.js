(() => {
  if (location.pathname.startsWith('/games/')) return;

  const runtimeKey = '__ouaGameLauncherV1';
  if (window[runtimeKey]) return;
  window[runtimeKey] = true;

  const LAUNCHER_ID = 'oua-fat-fish-entry'; // Keep the former floating-entry id for compatibility.
  const HOME_ID = 'oua-fat-fish-home-entry';
  const MENU_ID = 'oua-game-launcher-menu';
  const STORAGE_KEY = 'oua-game-launcher-position-v1';
  const games = [
    { href: '/games/', label: '小游戏大厅', icon: '🎮' },
    { href: '/games/fat-fish/', label: '合成大肥鱼', icon: '🐳' },
    { href: '/games/bumper/', label: '碰碰擂台', icon: '🛟' },
  ];
  let open = false;
  let activeAnchor = null;
  let position = null;
  let pointer = null;
  let consumeDragClick = false;
  let consumeClickTimer = 0;
  const launcherButtons = new Set();

  function viewport() {
    return {
      width: Math.max(0, document.documentElement.clientWidth || window.innerWidth || 0),
      height: Math.max(0, document.documentElement.clientHeight || window.innerHeight || 0),
    };
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function launcherButton(id, floating) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.textContent = floating ? '🎮 小游戏' : '🎮 小游戏';
    button.setAttribute('aria-label', '选择小游戏');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', MENU_ID);
    if (floating) {
      button.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:35;display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:104px;height:44px;padding:0 14px;border-radius:999px;background:#eef7fc;color:#17486c;border:1px solid #b5d2e5;box-shadow:0 3px 12px #123c5c1c;font:600 13px system-ui,sans-serif;cursor:grab;touch-action:none;user-select:none;';
    } else {
      button.className = 'btn ghost';
      button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;background:#eaf6fb;color:#17486c;border:1px solid #a7ccdf;font-weight:600;position:relative;cursor:pointer;';
    }
    return button;
  }

  function setExpanded(value) {
    for (const button of launcherButtons) button.setAttribute('aria-expanded', String(value));
  }

  function getMenu() { return document.getElementById(MENU_ID); }

  function closeMenu() {
    const menu = getMenu();
    if (menu) menu.remove();
    open = false;
    activeAnchor = null;
    setExpanded(false);
    document.removeEventListener('pointerdown', onOutsidePointerDown, true);
    document.removeEventListener('keydown', onMenuKeydown, true);
  }

  function positionMenu(menu, anchor) {
    const rect = anchor.getBoundingClientRect();
    const vp = viewport();
    const margin = 8;
    const width = Math.max(0, Math.min(220, vp.width - margin * 2));
    const height = menu.offsetHeight || 104;
    const gap = 8;
    let left;
    let top;

    if (rect.right + gap + width <= vp.width - margin) left = rect.right + gap;
    else if (rect.left - gap - width >= margin) left = rect.left - gap - width;
    else left = clamp(rect.left + rect.width / 2 - width / 2, margin, Math.max(margin, vp.width - margin - width));

    if (rect.bottom + gap + height <= vp.height - margin) top = rect.bottom + gap;
    else top = rect.top - gap - height;
    left = clamp(left, margin, Math.max(margin, vp.width - margin - width));
    top = clamp(top, margin, Math.max(margin, vp.height - margin - height));
    menu.style.width = `${width}px`;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function onOutsidePointerDown(event) {
    const menu = getMenu();
    if (menu && !menu.contains(event.target) && activeAnchor && !activeAnchor.contains(event.target)) closeMenu();
  }

  function onMenuKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      const anchor = activeAnchor;
      closeMenu();
      if (anchor && anchor.isConnected) anchor.focus();
    }
  }

  function toggleMenu(anchor) {
    if (open && activeAnchor === anchor) { closeMenu(); return; }
    closeMenu();
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '选择小游戏');
    menu.style.cssText = 'position:fixed;z-index:36;box-sizing:border-box;display:grid;gap:4px;padding:6px;border:1px solid #c9dce7;border-radius:14px;background:#fff;box-shadow:0 8px 24px #123c5c24;font:500 14px system-ui,sans-serif;';
    for (const game of games) {
      const link = document.createElement('a');
      link.href = game.href;
      link.setAttribute('role', 'menuitem');
      link.textContent = `${game.icon}  ${game.label}`;
      link.style.cssText = 'box-sizing:border-box;display:flex;align-items:center;min-height:44px;padding:0 12px;border-radius:10px;color:#17486c;text-decoration:none;white-space:nowrap;';
      menu.append(link);
    }
    document.body.append(menu);
    activeAnchor = anchor;
    open = true;
    positionMenu(menu, anchor);
    setExpanded(true);
    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    document.addEventListener('keydown', onMenuKeydown, true);
  }

  function loadPosition(button) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return;
      const vp = viewport();
      const rect = button.getBoundingClientRect();
      const maxLeft = Math.max(0, vp.width - rect.width);
      const maxTop = Math.max(0, vp.height - rect.height);
      position = { left: saved.x * maxLeft, top: saved.y * maxTop };
      applyPosition(button);
    } catch { /* Storage may be disabled; the launcher remains usable. */ }
  }

  function applyPosition(button) {
    if (!position) return;
    const vp = viewport();
    const rect = button.getBoundingClientRect();
    position.left = clamp(position.left, 8, Math.max(8, vp.width - rect.width - 8));
    position.top = clamp(position.top, 8, Math.max(8, vp.height - rect.height - 8));
    button.style.left = `${position.left}px`;
    button.style.top = `${position.top}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
  }

  function savePosition(button) {
    try {
      const vp = viewport();
      const rect = button.getBoundingClientRect();
      const maxLeft = Math.max(1, vp.width - rect.width);
      const maxTop = Math.max(1, vp.height - rect.height);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        x: clamp(position.left / maxLeft, 0, 1),
        y: clamp(position.top / maxTop, 0, 1),
      }));
    } catch { /* Storage may be disabled; dragging still works for this visit. */ }
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, dragging: false };
    if (button.setPointerCapture && event.pointerId !== undefined) {
      try { button.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional. */ }
    }
  }

  function onPointerMove(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (!pointer.dragging && Math.hypot(dx, dy) < 6) return;
    if (!pointer.dragging) {
      pointer.dragging = true;
      position = { left: pointer.left, top: pointer.top };
    }
    position.left = pointer.left + dx;
    position.top = pointer.top + dy;
    applyPosition(event.currentTarget);
  }

  function armDragClickSuppression() {
    consumeDragClick = true;
    if (consumeClickTimer) clearTimeout(consumeClickTimer);
    consumeClickTimer = setTimeout(() => { consumeDragClick = false; consumeClickTimer = 0; }, 0);
  }

  function onPointerUp(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const wasDrag = pointer.dragging;
    const button = event.currentTarget;
    if (wasDrag) {
      applyPosition(button);
      savePosition(button);
      armDragClickSuppression();
    }
    pointer = null;
    if (button.releasePointerCapture && event.pointerId !== undefined) {
      try { button.releasePointerCapture(event.pointerId); } catch { /* Pointer capture is optional. */ }
    }
  }

  function onPointerCancel(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    pointer = null;
    armDragClickSuppression();
  }

  function onLauncherClick(event) {
    if (consumeDragClick) {
      consumeDragClick = false;
      if (consumeClickTimer) clearTimeout(consumeClickTimer);
      consumeClickTimer = 0;
      event.preventDefault();
      return;
    }
    toggleMenu(event.currentTarget);
  }

  function ensureFloatingLauncher() {
    let button = document.getElementById(LAUNCHER_ID);
    if (button && button.tagName !== 'BUTTON') { button.remove(); button = null; }
    if (!button) {
      button = launcherButton(LAUNCHER_ID, true);
      button.addEventListener('pointerdown', onPointerDown);
      button.addEventListener('pointermove', onPointerMove);
      button.addEventListener('pointerup', onPointerUp);
      button.addEventListener('pointercancel', onPointerCancel);
      button.addEventListener('click', onLauncherClick);
      document.body.append(button);
      loadPosition(button);
    }
    launcherButtons.add(button);
    return button;
  }

  function ensureHomeLauncher(root, actions) {
    let button = root.getElementById(HOME_ID);
    if (button && button.tagName !== 'BUTTON') { button.remove(); button = null; }
    if (!button) {
      button = launcherButton(HOME_ID, false);
      button.addEventListener('click', onLauncherClick);
      actions.append(button);
    }
    launcherButtons.add(button);
  }

  let queued = false;
  const observedRoots = new WeakSet();
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; mount(); });
  });

  function watch(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, { childList: true, subtree: true });
  }

  function mount() {
    if (!document.body) return;
    ensureFloatingLauncher();
    // The homepage arrives after the station has loaded its saved content.
    // Keep its game chooser beside the existing actions, including SPA visits.
    const roots = [document, ...Array.from(document.querySelectorAll('.custom-home-content'), (host) => host.shadowRoot).filter(Boolean)];
    for (const root of roots) {
      if (root !== document) watch(root);
      const actions = root.querySelector('.wx-home .hero .actions');
      if (actions) ensureHomeLauncher(root, actions);
    }
  }

  document.addEventListener('click', (event) => {
    if (event.target && event.target.closest && event.target.closest(`#${MENU_ID} a`)) closeMenu();
  });
  window.addEventListener('resize', () => {
    const button = document.getElementById(LAUNCHER_ID);
    if (button && position) applyPosition(button);
    const menu = getMenu();
    if (menu && activeAnchor) positionMenu(menu, activeAnchor);
  });

  watch(document.getElementById('root') || document.body);
  mount();
  // The shadow root can attach after its host is inserted; bounded retries cover that handoff.
  setTimeout(mount, 300);
  setTimeout(mount, 1200);
})();
