// Keep logical game coordinates independent of browser zoom, GPU context
// restoration and canvas backing-store resets. No layout read on normal frames.
export function createFishViewport(canvas, ctx, { width = 480, height = 620, pixelRatio = () => globalThis.devicePixelRatio || 1 } = {}) {
  let state = { scale: 1, offsetX: 0, offsetY: 0, backingWidth: width, backingHeight: height, ratioX: 1, ratioY: 1 };
  function sync() {
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return state;
    const dpr = Math.max(1, Math.min(Number(pixelRatio()) || 1, 2));
    const backingWidth = Math.max(1, Math.round(rect.width * dpr));
    const backingHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    const scale = Math.min(rect.width / width, rect.height / height);
    state = { scale, offsetX: (rect.width - width * scale) / 2, offsetY: (rect.height - height * scale) / 2,
      backingWidth, backingHeight, ratioX: backingWidth / rect.width, ratioY: backingHeight / rect.height };
    apply();
    return state;
  }
  function apply() {
    if (canvas.width !== state.backingWidth || canvas.height !== state.backingHeight) { sync(); return; }
    ctx.setTransform(state.ratioX * state.scale, 0, 0, state.ratioY * state.scale, state.ratioX * state.offsetX, state.ratioY * state.offsetY);
  }
  return { sync, apply, get state() { return state; } };
}
