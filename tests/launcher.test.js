import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../deploy/entry.js', import.meta.url), 'utf8');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = new Map();
    this.style = new Proxy({ cssText: '' }, { set: (target, key, value) => {
      target[key] = value;
      if (key === 'cssText') for (const rule of String(value).split(';')) {
        const colon = rule.indexOf(':');
        if (colon > 0) target[rule.slice(0, colon).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = rule.slice(colon + 1).trim();
      }
      return true;
    } });
    this.textContent = '';
    this.className = '';
    this.href = '';
    this.type = '';
    this.offsetHeight = 104;
    this.isConnected = false;
  }
  set id(value) { this._id = value; }
  get id() { return this._id || ''; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, handler) { const items = this.listeners.get(name) || []; items.push(handler); this.listeners.set(name, items); }
  removeEventListener(name, handler) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== handler)); }
  dispatch(name, extra = {}) {
    const event = { type: name, target: this, currentTarget: this, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const handler of this.listeners.get(name) || []) handler(event);
    return event;
  }
  append(child) { child.parentNode = this; child.isConnected = true; this.children.push(child); }
  remove() { if (!this.parentNode) return; this.parentNode.children = this.parentNode.children.filter((item) => item !== this); this.parentNode = null; this.isConnected = false; }
  contains(node) { if (node === this) return true; return this.children.some((child) => child.contains(node)); }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() { this.focused = true; }
  getBoundingClientRect() {
    const width = this.id === 'oua-fat-fish-entry' ? 104 : this.id === 'oua-game-launcher-menu' ? 220 : 120;
    const height = this.id === 'oua-fat-fish-entry' ? 44 : this.offsetHeight;
    const left = Number.parseFloat(this.style.left) || 0;
    const top = this.style.top ? Number.parseFloat(this.style.top) : 736;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  closest(selector) { return selector === '#oua-game-launcher-menu a' && this.tagName === 'A' ? this : null; }
}

class TestDocument {
  constructor() {
    this.body = new Element('body');
    this.body.isConnected = true;
    this.documentElement = { clientWidth: 400, clientHeight: 800 };
    this.listeners = new Map();
  }
  createElement(tag) { return new Element(tag); }
  find(root, id) { if (root.id === id) return root; for (const child of root.children) { const found = this.find(child, id); if (found) return found; } return null; }
  getElementById(id) { return this.find(this.body, id); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener(name, handler) { const items = this.listeners.get(name) || []; items.push(handler); this.listeners.set(name, items); }
  removeEventListener(name, handler) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== handler)); }
  dispatch(name, event) { for (const handler of this.listeners.get(name) || []) handler(event); }
}

function run(pathname = '/', { storageThrows = false, seed = {} } = {}) {
  const document = new TestDocument();
  const data = new Map();
  for (const [key, value] of Object.entries(seed)) data.set(key, value);
  const localStorage = {
    getItem(key) { if (storageThrows) throw Error('disabled'); return data.get(key) ?? null; },
    setItem(key, value) { if (storageThrows) throw Error('disabled'); data.set(key, value); },
  };
  const windowListeners = new Map();
  const window = { innerWidth: 400, innerHeight: 800, addEventListener(name, handler) { windowListeners.set(name, handler); }, __ouaGameLauncherV1: false };
  const timers = new Map(); let nextTimer = 1;
  class MutationObserver { observe() {} }
  const context = vm.createContext({ document, window, location: { pathname }, localStorage, MutationObserver,
    requestAnimationFrame: (fn) => fn(), setTimeout: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id), Math, Number, JSON, Array, String });
  vm.runInContext(script, context);
  return { document, window, windowListeners, localStorage, data, timers, flushTimers() { for (const [id, fn] of timers) { timers.delete(id); fn(); } } };
}

const launcher = (page) => page.document.getElementById('oua-fat-fish-entry');
const menu = (page) => page.document.getElementById('oua-game-launcher-menu');

test('launcher opens the hall and game menu, toggles with click, and supports Escape', () => {
  const page = run();
  const button = launcher(page);
  assert.ok(button);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  button.dispatch('click');
  assert.ok(menu(page));
  assert.deepEqual(menu(page).children.map((link) => [link.textContent, link.href]), [
    ['🎮  小游戏大厅', '/games/'],
    ['🐳  合成大肥鱼', '/games/fat-fish/'], ['🛟  碰碰擂台', '/games/bumper/'],
  ]);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  page.document.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(menu(page), null);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('pointer movement below six pixels remains a normal click; dragging does not open the menu', () => {
  const page = run();
  const button = launcher(page);
  button.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 24, clientY: 740 });
  button.dispatch('pointermove', { pointerId: 1, clientX: 28, clientY: 743 });
  button.dispatch('pointerup', { pointerId: 1 });
  button.dispatch('click');
  assert.ok(menu(page), 'sub-threshold movement is treated as a click');

  page.document.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  button.dispatch('pointerdown', { button: 0, pointerId: 2, clientX: 24, clientY: 740 });
  button.dispatch('pointermove', { pointerId: 2, clientX: 90, clientY: 610 });
  button.dispatch('pointerup', { pointerId: 2 });
  button.dispatch('click');
  assert.equal(menu(page), null, 'the click generated by a drag is consumed');
  assert.ok(page.data.has('oua-game-launcher-position-v1'));
  page.flushTimers();
  button.dispatch('click');
  assert.ok(menu(page), 'a later ordinary click still opens the menu');
});

test('pointer cancellation never opens the chooser', () => {
  const page = run();
  const button = launcher(page);
  button.dispatch('pointerdown', { button: 0, pointerId: 3, clientX: 24, clientY: 740 });
  button.dispatch('pointermove', { pointerId: 3, clientX: 80, clientY: 680 });
  button.dispatch('pointercancel', { pointerId: 3 });
  button.dispatch('click');
  assert.equal(menu(page), null);
});

test('saved proportional coordinates are clamped when the viewport shrinks', () => {
  const page = run();
  const button = launcher(page);
  button.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 24, clientY: 740 });
  button.dispatch('pointermove', { pointerId: 1, clientX: 900, clientY: 900 });
  button.dispatch('pointerup', { pointerId: 1 });
  const stored = JSON.parse(page.data.get('oua-game-launcher-position-v1'));
  assert.ok(stored.x >= 0 && stored.x <= 1);
  assert.ok(stored.y >= 0 && stored.y <= 1);
  const second = run('/', { seed: { 'oua-game-launcher-position-v1': JSON.stringify({ x: 1, y: 1 }) } });
  assert.ok(launcher(second));
  assert.equal(launcher(second).style.right, 'auto');
  second.document.documentElement.clientWidth = 150;
  second.document.documentElement.clientHeight = 120;
  second.windowListeners.get('resize')();
  assert.equal(launcher(second).style.left, '38px');
  assert.equal(launcher(second).style.top, '68px');
});

test('blocked localStorage does not break click or drag interactions', () => {
  const page = run('/', { storageThrows: true });
  const button = launcher(page);
  button.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 24, clientY: 740 });
  button.dispatch('pointermove', { pointerId: 1, clientX: 40, clientY: 720 });
  button.dispatch('pointerup', { pointerId: 1 });
  assert.ok(button.style.left);
  page.flushTimers();
  button.dispatch('click');
  assert.ok(menu(page));
});

test('all game routes skip the launcher, and non-game pages get the legacy floating id', () => {
  assert.equal(launcher(run('/games/fat-fish/')), null);
  assert.equal(launcher(run('/games/bumper/')), null);
  assert.ok(launcher(run('/')));
});
