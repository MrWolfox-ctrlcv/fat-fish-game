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
  const handleRect = () => handle.getBoundingClientRect?.() || rect();
  const limits = () => {
    const bounds = rect();
    const active = handleRect();
    const offsetX = active.left - bounds.left, offsetY = active.top - bounds.top;
    return { minLeft: -offsetX, maxLeft: viewport.innerWidth - offsetX - active.width,
      minTop: -offsetY, maxTop: viewport.innerHeight - offsetY - active.height };
  };
  const applyPosition = (left, top) => {
    const { minLeft, maxLeft, minTop, maxTop } = limits();
    const bounds = rect();
    const x = clamp(left, minLeft, Math.max(minLeft, maxLeft));
    const y = clamp(top, minTop, Math.max(minTop, maxTop));
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
    const { minLeft, maxLeft, minTop, maxTop } = limits();
    applyPosition(minLeft + savedRatio.x * Math.max(0, maxLeft - minLeft), minTop + savedRatio.y * Math.max(0, maxTop - minTop));
  };
  const persist = () => {
    const bounds = rect(), { minLeft, maxLeft, minTop, maxTop } = limits();
    const left = clamp(bounds.left, minLeft, Math.max(minLeft, maxLeft));
    const top = clamp(bounds.top, minTop, Math.max(minTop, maxTop));
    savedRatio = { x: maxLeft > minLeft ? (left - minLeft) / (maxLeft - minLeft) : 0,
      y: maxTop > minTop ? (top - minTop) / (maxTop - minTop) : 0 };
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
  if (savedRatio) applySaved();
  else { const bounds = rect(); applyPosition(bounds.left, bounds.top); }
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
