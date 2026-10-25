import test from "node:test";
import assert from "node:assert/strict";
import { createCornerCompanion } from "../../playroom/src/companion-corner.js";

class Target {
  listeners = new Map();
  addEventListener(type, fn) { const items = this.listeners.get(type) || new Set(); items.add(fn); this.listeners.set(type, items); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatch(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
}

test("corner companion toggles compact panel, closes outside and consumes Escape", () => {
  const priorDocument = globalThis.document;
  const doc = new Target(); globalThis.document = doc;
  try {
    const container = new Target();
    const trigger = new Target(); trigger.attributes = {}; trigger.setAttribute = (key, value) => { trigger.attributes[key] = value; };
    trigger.focus = () => { trigger.focused = true; };
    const close = new Target();
    const panel = new Target(); panel.hidden = true; panel.querySelector = () => close;
    const inside = {};
    container.contains = (target) => target === inside || target === trigger;
    let opened = 0;
    const mounted = createCornerCompanion({ container, trigger, panel, onOpen: () => opened++ });

    trigger.dispatch("click");
    assert.equal(panel.hidden, false);
    assert.equal(trigger.attributes["aria-expanded"], "true");
    assert.equal(opened, 1);
    doc.dispatch("pointerdown", { target: inside });
    assert.equal(panel.hidden, false);
    doc.dispatch("pointerdown", { target: {} });
    assert.equal(panel.hidden, true);

    mounted.open();
    let stopped = false, prevented = false;
    doc.dispatch("keydown", { key: "Escape", stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
    assert.equal(panel.hidden, true);
    assert.equal(stopped, true);
    assert.equal(prevented, true);
    assert.equal(trigger.focused, true);
    mounted.open();
    mounted.destroy();
    doc.dispatch("pointerdown", { target: {} });
    assert.equal(panel.hidden, false, "destroy removes document listeners");
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});
