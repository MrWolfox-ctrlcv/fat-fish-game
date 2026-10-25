export const COMPANION_POSITION_KEY = "fat-fish:companion-corner-position";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const browserStorage = () => { try { return globalThis.localStorage; } catch { return null; } };

/** Drag a fixed-position UI node and persist normalized position only after a completed drag. */
export function createFloatingDrag({
  container,
  handle,
  onPosition = () => {},
  storageKey = COMPANION_POSITION_KEY,
  storage = browserStorage(),
  viewport = globalThis.window,
  threshold = 6,
}) {
  if (!container || !handle || !viewport) throw new TypeError("floating drag needs a container, handle, and viewport");
  let pointer = null;
  let dragged = false;
  let swallowClick = false;
  let savedRatio = null;

  const rect = () => container.getBoundingClientRect();
  const limits = () => {
    const bounds = rect();
    return { maxLeft: Math.max(0, viewport.innerWidth - bounds.width), maxTop: Math.max(0, viewport.innerHeight - bounds.height) };
  };
  const applyPosition = (left, top) => {
    const { maxLeft, maxTop } = limits();
    const bounds = rect();
    const x = clamp(left, 0, maxLeft), y = clamp(top, 0, maxTop);
    container.style.position = "fixed";
    container.style.left = `${x}px`;
    container.style.top = `${y}px`;
    container.style.right = "auto";
    container.style.bottom = "auto";
    onPosition({ left: x, top: y, width: bounds.width, height: bounds.height });
  };
  const readSaved = () => {
    try {
      const parsed = JSON.parse(storage?.getItem(storageKey) || "null");
      if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) savedRatio = { x: clamp(parsed.x, 0, 1), y: clamp(parsed.y, 0, 1) };
    } catch { savedRatio = null; }
  };
  const applySaved = () => {
    if (!savedRatio) return;
    const { maxLeft, maxTop } = limits();
    applyPosition(savedRatio.x * maxLeft, savedRatio.y * maxTop);
  };
  const persist = () => {
    const bounds = rect(), { maxLeft, maxTop } = limits();
    const left = clamp(bounds.left, 0, maxLeft), top = clamp(bounds.top, 0, maxTop);
    savedRatio = { x: maxLeft ? left / maxLeft : 0, y: maxTop ? top / maxTop : 0 };
    try { storage?.setItem(storageKey, JSON.stringify(savedRatio)); } catch { /* Dragging still works when storage is unavailable. */ }
  };
  const release = (pointerId) => {
    try { if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId); } catch { /* Capture may already be gone. */ }
  };
  const clearPointer = (releaseCapture = false) => {
    const previous = pointer;
    pointer = null;
    if (releaseCapture && previous) release(previous.id);
    container.classList.remove("is-dragging");
    dragged = false;
  };
  const onPointerDown = (event) => {
    swallowClick = false;
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const bounds = rect();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
    dragged = false;
    try { handle.setPointerCapture?.(event.pointerId); } catch { /* The pointer may no longer be active. */ }
  };
  const onPointerMove = (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (!dragged && Math.hypot(dx, dy) < threshold) return;
    if (!dragged) { dragged = true; container.classList.add("is-dragging"); }
    event.preventDefault();
    applyPosition(pointer.left + dx, pointer.top + dy);
  };
  const onPointerUp = (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    onPointerMove(event);
    const didDrag = dragged;
    clearPointer(true);
    if (didDrag) { persist(); swallowClick = true; }
  };
  const onPointerCancel = (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    clearPointer(true);
    swallowClick = false;
  };
  const onClickCapture = (event) => {
    if (!swallowClick || event.detail === 0) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const onLostCapture = (event) => {
    if (pointer && event.pointerId === pointer.id) onPointerCancel(event);
  };
  const onResize = () => {
    if (savedRatio) applySaved();
    else if (container.style.left && container.style.top) {
      const bounds = rect();
      applyPosition(bounds.left, bounds.top);
    } else onPosition(rect());
  };
  const preventNativeImageDrag = (event) => event.preventDefault();

  readSaved();
  applySaved();
  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerCancel);
  handle.addEventListener("lostpointercapture", onLostCapture);
  handle.addEventListener("dragstart", preventNativeImageDrag);
  container.addEventListener("click", onClickCapture, true);
  viewport.addEventListener("resize", onResize);

  return {
    get dragging() { return dragged; },
    refresh() { onPosition(rect()); },
    destroy() {
      clearPointer(true);
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerCancel);
      handle.removeEventListener("lostpointercapture", onLostCapture);
      handle.removeEventListener("dragstart", preventNativeImageDrag);
      container.removeEventListener("click", onClickCapture, true);
      viewport.removeEventListener("resize", onResize);
    },
  };
}
