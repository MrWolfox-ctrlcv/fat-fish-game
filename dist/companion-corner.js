import { createFloatingDrag } from "./floating-drag.js";

const SOUND_KEY = "fat-fish:companion-corner-sound";

function safeStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function createDuckSqueak({ toggle, storage = safeStorage(), windowRef = globalThis.window, documentRef = globalThis.document }) {
  let context = null;
  let alive = true;
  let enabled = true;
  try { enabled = storage?.getItem(SOUND_KEY) !== "off"; } catch { /* Sound remains enabled by default. */ }
  if (toggle) toggle.checked = enabled;

  const onToggle = () => {
    enabled = toggle.checked;
    try { storage?.setItem(SOUND_KEY, enabled ? "on" : "off"); } catch { /* The preference is optional. */ }
  };
  const suspendWhenHidden = () => {
    if (documentRef?.visibilityState === "hidden" && context?.state === "running") void context.suspend().catch(() => {});
  };
  const closeOnPageHide = () => {
    alive = false;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  };
  toggle?.addEventListener("change", onToggle);
  documentRef?.addEventListener("visibilitychange", suspendWhenHidden);
  windowRef?.addEventListener("pagehide", closeOnPageHide);

  return {
    play() {
      if (!enabled || !alive) return;
      const AudioContextClass = windowRef?.AudioContext || windowRef?.webkitAudioContext;
      if (!AudioContextClass) return;
      try {
        context ||= new AudioContextClass();
        if (context.state === "suspended") void context.resume().catch(() => {});
        const now = context.currentTime;
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(1180, now);
        oscillator.frequency.exponentialRampToValueAtTime(440, now + 0.105);
        envelope.gain.setValueAtTime(0.0001, now);
        envelope.gain.exponentialRampToValueAtTime(0.085, now + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.105);
        oscillator.connect(envelope);
        envelope.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.11);
      } catch { /* Audio is a small enhancement; the companion remains usable without it. */ }
    },
    destroy() {
      alive = false;
      toggle?.removeEventListener("change", onToggle);
      documentRef?.removeEventListener("visibilitychange", suspendWhenHidden);
      windowRef?.removeEventListener("pagehide", closeOnPageHide);
      if (context && context.state !== "closed") void context.close().catch(() => {});
    },
  };
}

function placePopover(container, panel, viewport) {
  if (panel.hidden) return;
  const anchor = container.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const width = Math.min(panelRect.width || panel.offsetWidth || 390, Math.max(0, viewport.innerWidth - 24));
  const height = Math.min(panelRect.height || panel.offsetHeight || panel.scrollHeight || 320, Math.max(0, viewport.innerHeight - 24));
  const opensRight = anchor.left + anchor.width / 2 < viewport.innerWidth / 2;
  const opensDown = anchor.top + anchor.height / 2 < viewport.innerHeight / 2;
  let left = opensRight ? anchor.right + 8 : anchor.left - width - 8;
  let top = opensDown ? anchor.bottom + 8 : anchor.top - height - 8;
  left = Math.max(12, Math.min(viewport.innerWidth - width - 12, left));
  top = Math.max(12, Math.min(viewport.innerHeight - height - 12, top));
  panel.style.position = "fixed";
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

/** Mount the shared corner buddy, draggable portrait, compact panel, and opt-in local click sound. */
export function createCornerCompanion({
  container,
  trigger,
  panel,
  onOpen = () => {},
  soundToggle = panel?.querySelector("[data-companion-squeak]"),
  handle = trigger?.querySelector("img"),
  windowRef = globalThis.window,
  documentRef = globalThis.document,
}) {
  if (!container || !trigger || !panel || !handle || !windowRef) throw new TypeError("陪玩角落需要 container、trigger、panel、图片和 viewport");
  const closeButton = panel.querySelector(".companion-close");
  const safeLocalStorage = safeStorage();
  const squeak = createDuckSqueak({ toggle: soundToggle, storage: safeLocalStorage, windowRef, documentRef });
  let destroyed = false;

  const updatePopoverPosition = () => placePopover(container, panel, windowRef);
  const drag = createFloatingDrag({ container, handle, storage: safeLocalStorage, viewport: windowRef, onPosition: updatePopoverPosition });
  const setOpen = (open, { restoreFocus = false } = {}) => {
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) { updatePopoverPosition(); onOpen(); }
    else if (restoreFocus) trigger.focus();
  };
  const bounce = () => {
    trigger.classList.remove("companion-bounce");
    void trigger.offsetWidth;
    trigger.classList.add("companion-bounce");
  };
  const onAnimationEnd = (event) => {
    if (event.animationName === "companion-bounce") trigger.classList.remove("companion-bounce");
  };
  const onToggle = () => {
    bounce();
    squeak.play();
    setOpen(panel.hidden);
  };
  const onClose = () => setOpen(false);
  const onOutside = (event) => { if (!panel.hidden && !container.contains(event.target)) setOpen(false); };
  const onKeydown = (event) => {
    if (event.key !== "Escape" || panel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false, { restoreFocus: true });
  };

  trigger.addEventListener("click", onToggle);
  trigger.addEventListener("animationend", onAnimationEnd);
  closeButton?.addEventListener("click", onClose);
  documentRef.addEventListener("pointerdown", onOutside);
  documentRef.addEventListener("keydown", onKeydown, true);
  return {
    open() { setOpen(true); },
    close() { setOpen(false); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      trigger.removeEventListener("click", onToggle);
      trigger.removeEventListener("animationend", onAnimationEnd);
      closeButton?.removeEventListener("click", onClose);
      documentRef.removeEventListener("pointerdown", onOutside);
      documentRef.removeEventListener("keydown", onKeydown, true);
      drag.destroy();
      squeak.destroy();
    },
  };
}
