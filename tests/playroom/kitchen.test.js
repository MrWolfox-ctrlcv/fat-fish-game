import assert from "node:assert/strict";
import { createGame, performAction, stepGame, getHud } from "../../playroom/src/modes/kitchen.js";

function advance(g, seconds) {
  const events = [];
  const ticks = Math.ceil(seconds * 60);
  for (let i = 0; i < ticks && g.phase === "playing"; i++) {
    events.push(...stepGame(g, {}, Math.min(1 / 60, seconds - i / 60)));
  }
  return events;
}

// A station click starts cooking; it cannot serve before the recipe is ready.
{
  const g = createGame({ seed: 17 });
  const initial = g.orders.length;
  const start = performAction(g, { type: "station", id: 0 });
  assert.equal(g.stations[0].state, "cooking");
  assert.ok(start.some((event) => event.type === "order"));
  const before = g.served;
  performAction(g, { type: "station", id: 0 });
  assert.equal(g.stations[0].state, "cooking", "second click cannot finish an active recipe");
  assert.equal(g.served, before);
  advance(g, 4);
  assert.equal(g.stations[0].state, "ready");
  performAction(g, { type: "station", id: 0 });
  assert.equal(g.served, before + 1);
  assert.equal(g.orders.length, initial - 1);
  assert.equal(g.score, 10);
}

// Serving uses the oldest matching order even if an older different dish is queued first.
{
  const g = createGame({ seed: 2 });
  const secondDish = g.orders[1].dish;
  const secondOrderId = g.orders[1].id;
  const third = g.orders[0].dish === secondDish ? "咖啡" : g.orders[0].dish;
  g.orders.unshift({ id: 999, dish: third, patience: 15, remaining: 15 });
  const id = ["寿司", "甜点", "咖啡"].indexOf(secondDish);
  performAction(g, { type: "station", id });
  advance(g, 4);
  performAction(g, { type: "station", id });
  assert.equal(g.orders.some((order) => order.id === secondOrderId), false);
  assert.equal(g.orders[0].id, 999);
  assert.equal(g.served, 1);
  assert.equal(g.score, 10, "correct service awards points");
}

// Cooldown blocks repeated rescue; rescue can launch and advance the most urgent order's recipe.
{
  const empty = createGame({ seed: 9 });
  empty.orders = [];
  performAction(empty, { type: "primary" });
  assert.equal(empty.rescueCooldown, 0, "rescue without an order does not spend cooldown");

  const g = createGame({ seed: 54 });
  const urgent = g.orders.reduce((best, order) => order.remaining < best.remaining ? order : best, g.orders[0]);
  const id = ["寿司", "甜点", "咖啡"].indexOf(urgent.dish);
  const first = performAction(g, { type: "primary" });
  assert.ok(first.some((event) => event.type === "order" || event.type === "dash"));
  assert.equal(g.rescueCooldown, 10);
  assert.equal(g.stations[id].state, "cooking");
  assert.ok(g.stations[id].progress > 0);
  const progress = g.stations[id].progress;
  const second = performAction(g, { type: "primary" });
  assert.equal(g.stations[id].progress, progress);
  assert.equal(second.length, 0);
  advance(g, 10);
  assert.equal(g.rescueCooldown, 0);
}

// Canvas taps map to stations and a ready item without a matching ticket is discarded with a penalty.
{
  const g = createGame({ seed: 5 });
  performAction(g, { type: "pointer", x: 365, y: 310 });
  assert.equal(g.stations[1].state, "cooking");
  advance(g, 4);
  g.orders = g.orders.filter((order) => order.dish !== "甜点");
  const points = g.score;
  performAction(g, { type: "pointer", x: 365, y: 310 });
  assert.equal(g.stations[1].state, "idle");
  assert.equal(g.score, points);
  assert.equal(g.combo, 0);
}

// Expired orders consume one patience mark and the fifth closes the kitchen exactly once.
{
  const g = createGame({ seed: 99 });
  g.orders = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, dish: "寿司", patience: 12, remaining: 0.03 }));
  g.nextOrderId = 5;
  const first = stepGame(g, {}, 1 / 30);
  assert.equal(g.mistakes, 4);
  assert.equal(g.phase, "playing");
  g.orders = [{ id: 8, dish: "咖啡", patience: 12, remaining: 0.01 }];
  const final = stepGame(g, {}, 1 / 30);
  assert.equal(g.phase, "lost");
  assert.equal(final.filter((event) => event.type === "end").length, 1);
  assert.equal(stepGame(g, {}, 1 / 30).length, 0);
  assert.equal(performAction(g, { type: "station", id: 0 }).length, 0);
  const time = g.time;
  advance(g, 2);
  assert.equal(g.time, time, "terminal game is frozen");
}

// A steady station rotation can keep up through the full 60-second shift and then win.
{
  const g = createGame({ seed: 198 });
  const events = [];
  for (let n = 0; n < 3600 && g.phase === "playing"; n++) {
    events.push(...stepGame(g, {}, 1 / 60));
    for (let id = 0; id < 3; id++) {
      const station = g.stations[id];
      const matchingOrder = g.orders.some((order) => order.dish === station.dish);
      if (station.state === "ready" && matchingOrder) events.push(...performAction(g, { type: "station", id }));
      else if (station.state === "idle" && matchingOrder) performAction(g, { type: "station", id });
    }
  }
  assert.equal(g.phase, "won");
  assert.ok(g.served >= 6);
  assert.ok(g.time >= 60 - 1e-8);
  assert.ok(g.orders.length <= 4);
  assert.ok(events.some((event) => event.type === "serve"));
  assert.ok(events.every((event) => [event.x, event.y].every((value) => value === undefined || Number.isFinite(value))));
  const frozen = { time: g.time, score: g.score, served: g.served };
  stepGame(g, {}, 1 / 30);
  performAction(g, { type: "primary" });
  assert.deepEqual({ time: g.time, score: g.score, served: g.served }, frozen);
}

// A neglected kitchen loses to expired customers; a calm shift still ends at 60 seconds.
{
  const g = createGame({ seed: 123 });
  advance(g, 60);
  assert.equal(g.phase, "lost");
  assert.equal(g.mistakes, 5);
  assert.match(getHud(g).stat2, /0\/5/);
}

// Same seed and action sequence remain reproducible and all order timers stay finite.
{
  const a = createGame({ seed: 741 });
  const b = createGame({ seed: 741 });
  for (let n = 0; n < 700 && a.phase === "playing"; n++) {
    if (n % 75 === 0) {
      performAction(a, { type: "station", id: (n / 75) % 3 });
      performAction(b, { type: "station", id: (n / 75) % 3 });
    }
    stepGame(a, {}, 1 / 60);
    stepGame(b, {}, 1 / 60);
  }
  assert.deepEqual(a, b);
  assert.ok(a.orders.length <= 4);
  assert.ok(a.orders.every((order) => Number.isFinite(order.remaining) && Number.isFinite(order.patience)));
  assert.equal(giveHud(a).time, a.time);
}

function giveHud(g) {
  return getHud(g);
}

console.log("kitchen tests passed");
