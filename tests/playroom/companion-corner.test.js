import test from "node:test";
import assert from "node:assert/strict";
import { createCornerCompanion } from "../../playroom/src/companion-corner.js";
import { createFloatingDrag, COMPANION_POSITION_KEY } from "../../playroom/src/floating-drag.js";

class Target {
  listeners = new Map();
  addEventListener(type, fn) { const items = this.listeners.get(type) || []; items.push(fn); this.listeners.set(type, items); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== fn)); }
  dispatch(type, event = {}) {
    const payload = Object.assign(event, {
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    });
    for (const fn of this.listeners.get(type) || []) { fn(payload); if (payload.propagationStopped) break; }
    return payload;
  }
}

class ClassList {
  values = new Set();
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

function box(target, { left = 100, top = 80, width = 100, height = 100 } = {}) {
  target.style ||= {};
  target.getBoundingClientRect = () => {
    const x = target.style.left && target.style.left !== "auto" ? Number.parseFloat(target.style.left) : left;
    const y = target.style.top && target.style.top !== "auto" ? Number.parseFloat(target.style.top) : top;
    return { left: x, top: y, right: x + width, bottom: y + height, width, height };
  };
  return target;
}

test("floating drag captures pointer, ignores sub-threshold movement and saves only a completed drag", () => {
  const viewport = new Target(); viewport.innerWidth = 400; viewport.innerHeight = 300;
  const values = new Map(), writes = [];
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => { writes.push([key, value]); values.set(key, value); } };
  const container = box(new Target()); container.classList = new ClassList();
  const handle = new Target(); handle.captured = new Set();
  handle.setPointerCapture = (id) => handle.captured.add(id);
  handle.hasPointerCapture = (id) => handle.captured.has(id);
  handle.releasePointerCapture = (id) => handle.captured.delete(id);
  const drag = createFloatingDrag({ container, handle, viewport, storage });
  assert.equal(writes.length, 0, "mount does not persist a position");

  handle.dispatch("pointerdown", { isPrimary: true, pointerType: "mouse", button: 0, pointerId: 1, clientX: 100, clientY: 80 });
  assert.equal(handle.captured.has(1), true);
  handle.dispatch("pointermove", { pointerId: 1, clientX: 104, clientY: 84 });
  handle.dispatch("pointerup", { pointerId: 1, clientX: 104, clientY: 84 });
  assert.equal(writes.length, 0, "movement below six pixels is a click, not a drag");

  handle.dispatch("pointerdown", { isPrimary: true, pointerType: "touch", pointerId: 2, clientX: 100, clientY: 80 });
  handle.dispatch("pointermove", { pointerId: 2, clientX: 130, clientY: 125 });
  assert.equal(drag.dragging, true);
  assert.equal(container.classList.contains("is-dragging"), true);
  handle.dispatch("pointerup", { pointerId: 2, clientX: 130, clientY: 125 });
  assert.equal(drag.dragging, false);
  assert.equal(container.classList.contains("is-dragging"), false);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], COMPANION_POSITION_KEY);
  assert.deepEqual(JSON.parse(writes[0][1]), { x: 130 / 300, y: 125 / 200 });
  const suppressed = container.dispatch("click", { detail: 1 });
  assert.equal(suppressed.defaultPrevented, true, "drag release cannot also activate the companion");
  assert.equal(suppressed.propagationStopped, true);

  handle.dispatch("pointerdown", { isPrimary: true, pointerType: "touch", pointerId: 3, clientX: 130, clientY: 125 });
  handle.dispatch("pointermove", { pointerId: 3, clientX: 390, clientY: 290 });
  handle.dispatch("pointercancel", { pointerId: 3 });
  assert.equal(writes.length, 1, "pointercancel never commits a stored position");
  viewport.innerWidth = 150; viewport.innerHeight = 125;
  viewport.dispatch("resize");
  const afterResize = container.getBoundingClientRect();
  assert.ok(afterResize.left >= 0 && afterResize.right <= viewport.innerWidth);
  assert.ok(afterResize.top >= 0 && afterResize.bottom <= viewport.innerHeight);
  const normalClick = container.dispatch("click", { detail: 1 });
  assert.equal(normalClick.defaultPrevented, undefined, "a later click still works");
  drag.destroy();
});

test("portrait stays inside the viewport when the corner container is wider than the avatar", () => {
  const viewport = new Target(); viewport.innerWidth = 1366; viewport.innerHeight = 900;
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const container = box(new Target(), { left: 800, top: 700, width: 360, height: 128 }); container.classList = new ClassList();
  const handle = new Target();
  handle.getBoundingClientRect = () => {
    const bounds = container.getBoundingClientRect();
    return { left: bounds.left + 232, top: bounds.top + 8, right: bounds.left + 360, bottom: bounds.top + 136, width: 128, height: 128 };
  };
  handle.setPointerCapture = () => {}; handle.hasPointerCapture = () => false;
  const drag = createFloatingDrag({ container, handle, viewport, storage });
  handle.dispatch("pointerdown", { isPrimary: true, pointerType: "mouse", button: 0, pointerId: 1, clientX: 900, clientY: 800 });
  handle.dispatch("pointermove", { pointerId: 1, clientX: 1900, clientY: 1800 });
  handle.dispatch("pointerup", { pointerId: 1, clientX: 1900, clientY: 1800 });
  let portrait = handle.getBoundingClientRect();
  assert.ok(portrait.left >= 0 && portrait.right <= viewport.innerWidth);
  assert.ok(portrait.top >= 0 && portrait.bottom <= viewport.innerHeight);
  viewport.innerWidth = 759; viewport.innerHeight = 800; viewport.dispatch("resize");
  portrait = handle.getBoundingClientRect();
  assert.ok(portrait.left >= 0 && portrait.right <= viewport.innerWidth);
  assert.ok(portrait.top >= 0 && portrait.bottom <= viewport.innerHeight);
  drag.destroy();
});

test("corner opens inward, keyboard and click activate it, and squeak is local and muteable", () => {
  const priorDocument = globalThis.document, priorWindow = globalThis.window;
  const documentRef = new Target(); documentRef.visibilityState = "visible";
  let contextCount = 0, squeaks = 0, closed = 0, resumed = 0, suspended = 0;
  class AudioContextStub {
    constructor() { contextCount++; this.state = "running"; this.currentTime = 1; this.destination = {}; }
    createOscillator() { return { type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() { squeaks++; } }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    resume() { resumed++; return Promise.resolve(); }
    suspend() { suspended++; this.state = "suspended"; return Promise.resolve(); }
    close() { closed++; this.state = "closed"; return Promise.resolve(); }
  }
  const windowRef = new Target(); windowRef.innerWidth = 400; windowRef.innerHeight = 300; windowRef.AudioContext = AudioContextStub;
  globalThis.document = documentRef; globalThis.window = windowRef;
  try {
    const container = box(new Target(), { left: 80, top: 70, width: 160, height: 80 }); container.classList = new ClassList();
    const trigger = new Target(); trigger.attributes = {}; trigger.classList = new ClassList(); trigger.offsetWidth = 160;
    trigger.setAttribute = (key, value) => { trigger.attributes[key] = value; };
    trigger.focus = () => { trigger.focused = true; };
    const image = new Target(); image.captured = new Set();
    image.setPointerCapture = (id) => image.captured.add(id);
    image.hasPointerCapture = (id) => image.captured.has(id);
    image.releasePointerCapture = (id) => image.captured.delete(id);
    trigger.querySelector = (selector) => selector === "img" ? image : null;
    const closeButton = new Target(), soundToggle = new Target(); soundToggle.checked = true;
    const panel = box(new Target(), { left: 0, top: 0, width: 320, height: 250 });
    panel.hidden = true; panel.scrollHeight = 250; panel.querySelector = (selector) => selector === ".companion-close" ? closeButton : null;
    let opens = 0;
    const mounted = createCornerCompanion({ container, trigger, panel, soundToggle, windowRef, documentRef, onOpen: () => opens++ });

    image.dispatch("pointerdown", { isPrimary: true, pointerType: "touch", pointerId: 7, clientX: 120, clientY: 100 });
    image.dispatch("pointermove", { pointerId: 7, clientX: 150, clientY: 128 });
    image.dispatch("pointerup", { pointerId: 7, clientX: 150, clientY: 128 });
    const dragReleaseClick = container.dispatch("click", { detail: 1 });
    assert.equal(dragReleaseClick.defaultPrevented, true);
    assert.equal(panel.hidden, true, "dragging the portrait does not open the panel");
    assert.equal(contextCount, 0, "dragging never creates or plays the squeak context");

    trigger.dispatch("click", { detail: 1 });
    assert.equal(panel.hidden, false);
    assert.equal(trigger.attributes["aria-expanded"], "true");
    assert.equal(contextCount, 1);
    assert.equal(squeaks, 1);
    assert.equal(opens, 1);
    assert.equal(Number.parseFloat(panel.style.left) + 320 <= windowRef.innerWidth - 12, true);
    assert.equal(Number.parseFloat(panel.style.top) + 250 <= windowRef.innerHeight - 12, true);

    documentRef.visibilityState = "hidden";
    documentRef.dispatch("visibilitychange");
    assert.equal(suspended, 1);
    soundToggle.checked = false; soundToggle.dispatch("change");
    trigger.dispatch("click", { detail: 0 });
    assert.equal(panel.hidden, true, "keyboard activation still toggles the panel");
    assert.equal(squeaks, 1, "muted clicks do not produce another squeak");
    mounted.open();
    const escape = documentRef.dispatch("keydown", { key: "Escape" });
    assert.equal(panel.hidden, true);
    assert.equal(escape.defaultPrevented, true); assert.equal(escape.propagationStopped, true); assert.equal(trigger.focused, true);
    mounted.destroy();
    assert.equal(closed, 1);
  } finally {
    if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
    if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow;
  }
});
