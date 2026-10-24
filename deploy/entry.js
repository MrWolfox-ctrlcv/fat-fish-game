(() => {
  if (location.pathname.startsWith('/games/fat-fish')) return;

  function makeLink(id) {
    const link = document.createElement('a');
    link.id = id;
    link.href = '/games/fat-fish/';
    link.textContent = '🐳 合成大肥鱼';
    link.setAttribute('aria-label', '打开合成大肥鱼小游戏');
    return link;
  }

  let queued = false;
  const observedRoots = new WeakSet();
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; mount(); });
  });

  function watch(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, { childList: true, subtree: true });
  }

  function mount() {
    if (!document.getElementById('oua-fat-fish-entry')) {
      const link = makeLink('oua-fat-fish-entry');
      link.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:35;display:inline-flex;align-items:center;padding:9px 15px;border-radius:999px;background:#eef7fc;color:#17486c;border:1px solid #b5d2e5;box-shadow:0 3px 12px #123c5c1c;font:600 13px system-ui,sans-serif;text-decoration:none;';
      document.body.append(link);
    }

    // The homepage arrives after the station has loaded its saved content.
    // Keep the main entry alongside its existing actions, including SPA visits.
    const roots = [document, ...Array.from(document.querySelectorAll('.custom-home-content'), (host) => host.shadowRoot).filter(Boolean)];
    for (const root of roots) {
      if (root !== document) watch(root);
      const actions = root.querySelector('.wx-home .hero .actions');
      if (actions && !root.getElementById('oua-fat-fish-home-entry')) {
        const link = makeLink('oua-fat-fish-home-entry');
        link.className = 'btn ghost';
        link.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#eaf6fb;color:#17486c;border:1px solid #a7ccdf;font-weight:600;position:relative;';
        actions.append(link);
      }
    }
  }

  watch(document.getElementById('root') || document.body);
  mount();
  // A shadow root can be attached after its host's insertion without another
  // light-DOM mutation. These bounded retries cover that initial handoff.
  setTimeout(mount, 300);
  setTimeout(mount, 1200);
})();
