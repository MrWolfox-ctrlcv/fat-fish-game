import { drawAvatar } from "../art.js";

export const WIDTH = 720;
export const HEIGHT = 480;

const DISHES = ["寿司", "甜点", "咖啡"];
const COLORS = ["#ed8a69", "#d58eb2", "#9c7758"];
const STATION_X = [155, 360, 565];
const MAX_ORDERS = 4;

export const meta = {
  id: "kitchen",
  name: "女仆厨房",
  tagline: "三台并行，趁热上桌！",
  instructions: "点工作台开始制作；亮起「可出餐」后再点，送出最早的同款订单。Space 可救急。",
  actionLabel: "Space 救急",
  stats: ["已出餐", "容错"],
  goals: ["60 秒内出餐 6 份", "留意订单耐心", "善用三台并行制作"],
};

function nextRandom(g) {
  let x = g.rng >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  g.rng = x >>> 0;
  return g.rng / 0x100000000;
}

function makeOrder(g, dish) {
  const patience = 12 + nextRandom(g) * 6;
  return {
    id: g.nextOrderId++,
    dish,
    patience,
    remaining: patience,
  };
}

function addOrder(g, dish) {
  if (g.orders.length >= MAX_ORDERS) return false;
  g.orders.push(makeOrder(g, dish));
  return true;
}

export function createGame({ seed = 20261025 } = {}) {
  const cleanSeed = Number.isFinite(seed) ? (Math.floor(seed) >>> 0) : 20261025;
  const g = {
    phase: "playing",
    score: 0,
    time: 0,
    duration: 60,
    result: "",
    rng: cleanSeed || 0x6d2b79f5,
    nextOrderId: 1,
    orders: [],
    stations: DISHES.map((dish) => ({ dish, state: "idle", progress: 0, duration: 0 })),
    spawnIn: 5.5,
    served: 0,
    mistakes: 0,
    combo: 0,
    bestCombo: 0,
    rescueCooldown: 0,
    message: "先看订单：寿司、甜点、咖啡各有对应工作台。",
    messageTime: 4,
    endEmitted: false,
  };
  addOrder(g, "寿司");
  let secondDish = Math.floor(nextRandom(g) * 2) + 1;
  addOrder(g, DISHES[secondDish]);
  return g;
}

function endGame(g, won, text, events) {
  if (g.phase !== "playing") return;
  g.phase = won ? "won" : "lost";
  g.result = text;
  g.message = text;
  if (!g.endEmitted) {
    events.push({ type: "end", won, text });
    g.endEmitted = true;
  }
}

function stationIdFromPointer(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || y < 215 || y > 435) return -1;
  if (x < 260) return 0;
  if (x < 465) return 1;
  return 2;
}

function startCooking(g, id, events) {
  const station = g.stations[id];
  if (!station || station.state !== "idle" || g.phase !== "playing") return;
  station.state = "cooking";
  station.progress = 0;
  station.duration = 1.65 + id * 0.28 + nextRandom(g) * 0.5;
  g.message = `${station.dish}开始制作！可以去安排另一台。`;
  g.messageTime = 2;
  events.push({ type: "order", x: STATION_X[id], y: 365, text: `${station.dish} 开始制作` });
}

function serveFrom(g, id, events) {
  const station = g.stations[id];
  if (!station || g.phase !== "playing") return;
  if (station.state === "idle") {
    startCooking(g, id, events);
    return;
  }
  if (station.state === "cooking") {
    g.message = `${station.dish}还在制作，进度 ${Math.floor((station.progress / station.duration) * 100)}%。`;
    g.messageTime = 1.5;
    return;
  }
  const orderIndex = g.orders.findIndex((order) => order.dish === station.dish);
  station.state = "idle";
  station.progress = 0;
  station.duration = 0;
  if (orderIndex < 0) {
    g.score = Math.max(0, g.score - 2);
    g.combo = 0;
    g.message = `暂时没有人点${station.dish}，这份先记作损耗。`;
    g.messageTime = 2.5;
    events.push({ type: "serve", x: STATION_X[id], y: 352, text: "制作损耗 -2" });
    return;
  }
  const [order] = g.orders.splice(orderIndex, 1);
  g.served += 1;
  g.combo += 1;
  g.bestCombo = Math.max(g.bestCombo, g.combo);
  const points = 10 + Math.min(10, (g.combo - 1) * 2);
  g.score += points;
  g.message = `${order.dish}送达！${g.combo > 1 ? ` 连单 x${g.combo}，` : ""}+${points} 分`;
  g.messageTime = 2.2;
  events.push({ type: "serve", x: STATION_X[id], y: 350, text: `${order.dish} +${points}` });
}

export function performAction(g, command = { type: "primary" }) {
  const events = [];
  if (!g || g.phase !== "playing") return events;
  let id = -1;
  if (command.type === "station") id = Number.isInteger(command.id) ? command.id : -1;
  if (command.type === "pointer") id = stationIdFromPointer(command.x, command.y);
  if (id >= 0 && id <= 2) {
    serveFrom(g, id, events);
    return events;
  }
  if (command.type !== "primary") return events;
  if (g.rescueCooldown > 0) {
    g.message = `救急还要等 ${g.rescueCooldown.toFixed(1)} 秒。`;
    g.messageTime = 1.5;
    return events;
  }
  const urgent = g.orders.reduce((best, order) => !best || order.remaining < best.remaining ? order : best, null);
  if (!urgent) {
    g.message = "暂时没有待处理订单，救急已准备好。";
    g.messageTime = 1.5;
    return events;
  }
  g.rescueCooldown = 10;
  const idForOrder = DISHES.indexOf(urgent.dish);
  const station = g.stations[idForOrder];
  if (station.state === "idle") startCooking(g, idForOrder, events);
  if (station.state === "cooking") {
    station.progress = Math.min(station.duration, station.progress + 0.8);
    g.message = `救急！${urgent.dish}加速制作，订单多等 1 秒。`;
    g.messageTime = 2;
    events.push({ type: "dash", x: STATION_X[idForOrder], y: 365, text: "救急加速" });
  } else {
    g.message = `${urgent.dish}已经做好，快去对应工作台出餐！订单多等 1 秒。`;
    g.messageTime = 2;
  }
  urgent.remaining = Math.min(urgent.patience, urgent.remaining + 1);
  return events;
}

export function stepGame(g, input = {}, dt = 1 / 60) {
  const events = [];
  if (!g || g.phase !== "playing") return events;
  const elapsed = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 1 / 30) : 0;
  if (elapsed <= 0) return events;
  g.time = Math.min(g.duration, g.time + elapsed);
  g.rescueCooldown = Math.max(0, g.rescueCooldown - elapsed);
  g.messageTime = Math.max(0, g.messageTime - elapsed);
  for (const station of g.stations) {
    if (station.state !== "cooking") continue;
    station.progress = Math.min(station.duration, station.progress + elapsed);
    if (station.progress >= station.duration) {
      station.state = "ready";
      g.message = `${station.dish}做好了！点亮起的工作台出餐。`;
      g.messageTime = 2.5;
      events.push({ type: "order", x: STATION_X[g.stations.indexOf(station)], y: 365, text: `${station.dish} 可出餐` });
    }
  }
  for (let i = g.orders.length - 1; i >= 0; i--) {
    const order = g.orders[i];
    order.remaining -= elapsed;
    if (order.remaining <= 0) {
      g.orders.splice(i, 1);
      g.mistakes += 1;
      g.combo = 0;
      g.message = `一位客人等不及离开了（${g.mistakes}/5）。`;
      g.messageTime = 2.5;
      events.push({ type: "hit", text: `订单超时 ${g.mistakes}/5` });
    }
  }
  if (g.mistakes >= 5) {
    endGame(g, false, "客人都等急了，厨房暂时打烊。", events);
    return events;
  }
  g.spawnIn -= elapsed;
  if (g.spawnIn <= 0) {
    if (g.orders.length < MAX_ORDERS) {
      const dish = DISHES[Math.floor(nextRandom(g) * DISHES.length)];
      addOrder(g, dish);
      events.push({ type: "order", text: `新订单：${dish}` });
      if (g.messageTime <= 0.1) {
        g.message = `新订单来了：${dish}。查看队列并安排对应工作台。`;
        g.messageTime = 2.5;
      }
    }
    g.spawnIn = 4.8 + nextRandom(g) * 1.8;
  }
  if (g.time >= g.duration - 1e-8) endGame(g, g.served >= 6, g.served >= 6 ? "打烊啦！今天出餐达标。" : "打烊时间到，今天还差几份订单。", events);
  return events;
}

export function getHud(g) {
  return {
    score: g.score,
    time: g.time,
    stat1: `${g.served} 份`,
    stat2: `${Math.max(0, 5 - g.mistakes)}/5`,
    message: g.message,
  };
}

function roundedRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export function renderGame(ctx, g, view = {}) {
  ctx.fillStyle = "#fff5e7";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#f5e3ca";
  ctx.fillRect(0, 0, WIDTH, 75);
  ctx.fillStyle = "#4e3931";
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.fillText("今日订单", 22, 25);
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = "#8b7162";
  ctx.fillText("最早的同款订单优先出餐", 22, 47);
  const cardWidth = 122;
  const gap = 7;
  const total = g.orders.length * cardWidth + Math.max(0, g.orders.length - 1) * gap;
  const startX = Math.max(195, 710 - total);
  for (let i = 0; i < g.orders.length; i++) {
    const order = g.orders[i];
    const x = startX + i * (cardWidth + gap);
    const ratio = Math.max(0, order.remaining / order.patience);
    roundedRect(ctx, x, 10, cardWidth, 54, 10, "#fffaf2", "#e7d5bd");
    ctx.fillStyle = COLORS[DISHES.indexOf(order.dish)];
    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.fillText(`${String(i + 1).padStart(2, "0")}  ${order.dish}`, x + 11, 31);
    ctx.fillStyle = "#efe4d6";
    ctx.fillRect(x + 11, 43, cardWidth - 22, 7);
    ctx.fillStyle = ratio < 0.3 ? "#db6257" : "#86ad78";
    ctx.fillRect(x + 11, 43, (cardWidth - 22) * ratio, 7);
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = "#76665a";
    ctx.fillText(`${Math.ceil(order.remaining)} 秒`, x + cardWidth - 41, 39);
  }
  ctx.fillStyle = "#fffaf1";
  ctx.fillRect(0, 75, WIDTH, 39);
  ctx.fillStyle = "#604b3f";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText(g.message || "查看订单，安排工作台。", 20, 99, 440);
  ctx.textAlign = "right";
  ctx.fillStyle = "#977e68";
  ctx.fillText(`救急 ${g.rescueCooldown > 0 ? `${g.rescueCooldown.toFixed(1)}s` : "就绪"} · 连单 x${g.combo}`, 700, 99);
  ctx.textAlign = "left";

  ctx.fillStyle = "#f8ead8";
  ctx.fillRect(0, 114, WIDTH, 366);
  ctx.fillStyle = "#e6caa7";
  ctx.fillRect(0, 190, WIDTH, 10);
  ctx.fillStyle = "#ead3b8";
  ctx.fillRect(0, 443, WIDTH, 37);
  for (let i = 0; i < 3; i++) {
    const x = STATION_X[i];
    const station = g.stations[i];
    const left = x - 82;
    roundedRect(ctx, left, 222, 164, 201, 18, "#fff8ed", "#e5c8a6");
    roundedRect(ctx, left + 11, 231, 142, 35, 12, COLORS[i], null);
    ctx.textAlign = "center";
    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.fillStyle = "#fffaf3";
    ctx.fillText(["寿司工作台", "甜点工作台", "咖啡工作台"][i], x, 254);
    ctx.textAlign = "left";
    roundedRect(ctx, left + 16, 281, 132, 54, 12, "#f1dfc6", "#dcc1a0");
    ctx.fillStyle = "#bc9772";
    ctx.fillRect(left + 22, 331, 120, 7);
    if (station.state === "cooking") {
      const p = Math.min(1, station.progress / station.duration);
      ctx.fillStyle = "#e6a363";
      ctx.fillRect(left + 22, 331, 120 * p, 7);
    } else if (station.state === "ready") {
      ctx.fillStyle = "#76a86e";
      ctx.fillRect(left + 22, 331, 120, 7);
    }
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    if (station.state === "idle") {
      ctx.fillStyle = "#765d4d";
      ctx.fillText("点一下 · 开始制作", x, 304);
    } else if (station.state === "cooking") {
      ctx.fillStyle = "#765d4d";
      ctx.fillText(`制作中 ${Math.floor((station.progress / station.duration) * 100)}%`, x, 304);
    } else {
      ctx.fillStyle = "#4f8155";
      ctx.fillText("✓ 可出餐 · 再点一下", x, 304);
    }
    ctx.textAlign = "left";
    if (view.art) drawAvatar(ctx, view.art, ["deepseek", "gptSilly", "fakeClaude"][i], x, 383, 58, 0, station.state === "ready" ? 0.12 : 0);
    else {
      ctx.beginPath();
      ctx.arc(x, 383, 25, 0, Math.PI * 2);
      ctx.fillStyle = ["#f2c5a3", "#ead0dd", "#d8c3a7"][i];
      ctx.fill();
      ctx.fillStyle = "#75574a";
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("女仆", x, 387);
      ctx.textAlign = "left";
    }
    if (station.state === "ready") {
      ctx.fillStyle = "#6b9b62";
      ctx.beginPath();
      ctx.arc(x + 62, 284, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = "#8b7463";
    ctx.textAlign = "center";
    ctx.fillText(i === 0 ? "1 键" : i === 1 ? "2 键" : "3 键", x, 413);
    ctx.textAlign = "left";
  }
  ctx.fillStyle = "#755f50";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText("点击大工作台或按 1 / 2 / 3：先开做，完成后再点出餐。", 20, 463);
  ctx.textAlign = "right";
  ctx.fillText(`已出餐 ${g.served}/6  ·  客人耐心 ${5 - g.mistakes}/5  ·  ${Math.ceil(Math.max(0, g.duration - g.time))}s`, 700, 463);
  ctx.textAlign = "left";
  if (g.phase !== "playing") {
    ctx.fillStyle = "rgba(54, 39, 32, 0.62)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    roundedRect(ctx, 135, 170, 450, 138, 20, "#fff8ec", "#f4d3a9");
    ctx.textAlign = "center";
    ctx.fillStyle = g.phase === "won" ? "#527c4f" : "#a44f47";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillText(g.phase === "won" ? "今日营业达标！" : "厨房打烊了", 360, 220);
    ctx.fillStyle = "#685447";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText(g.result, 360, 256);
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(`出餐 ${g.served} 份 · 得分 ${g.score}`, 360, 285);
    ctx.textAlign = "left";
  }
}
