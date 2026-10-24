import test from "node:test";
import assert from "node:assert/strict";
import { createOnlineClient } from "../dist/online-client.js";

const jsonResponse = (status, payload) => ({ status, ok: status >= 200 && status < 300, json: async () => payload });

test("/api/me uses the relative game path and performs one locked refresh retry", async () => {
  const calls = [];
  const locks = [];
  const replies = [
    jsonResponse(401, { success: false }),
    jsonResponse(200, { success: true, data: { access_token: "memory-token", user: { id: 7, username: "fish", role: 1 } } }),
    jsonResponse(200, { success: true, user: { id: 7, username: "fish", role: 1 }, profile: { best: 0 }, rewards: [], admin: false }),
  ];
  const client = createOnlineClient({
    moduleUrl: "https://example.test/games/fat-fish/online-client.js",
    BroadcastChannelRef: null,
    navigatorRef: { locks: { request: async (name, options, callback) => { locks.push([name, options.mode]); return callback(); } } },
    fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return replies.shift(); },
  });

  const result = await client.getMe();
  assert.equal(result.user.id, 7);
  assert.equal(calls[0].url, "https://example.test/games/fat-fish/api/me");
  assert.equal(calls[1].url, "https://example.test/api/user/auth/refresh");
  assert.equal(calls[1].options.credentials, "include");
  assert.equal(calls[2].options.headers.Authorization, "Bearer memory-token");
  assert.deepEqual(locks, [["new-api:auth-refresh", "exclusive"]]);
  assert.equal(client.loginUrl, "https://example.test/sign-in?redirect=%2Fgames%2Ffat-fish%2F");
  assert.equal(client.walletUrl, "https://example.test/wallet");
  client.close();
});

test("AUTH_REFRESH_RACE waits briefly inside the refresh flow and retries", async () => {
  const calls = [];
  const waits = [];
  const replies = [
    jsonResponse(401, {}),
    jsonResponse(409, { code: "AUTH_REFRESH_RACE" }),
    jsonResponse(200, { success: true, data: { access_token: "fresh", user: { id: 3, username: "a", role: 1 } } }),
    jsonResponse(200, { success: true, user: { id: 3 }, profile: {}, rewards: [], admin: false }),
  ];
  const client = createOnlineClient({
    moduleUrl: "https://example.test/games/fat-fish/online-client.js",
    BroadcastChannelRef: null,
    wait: async (ms) => waits.push(ms),
    fetchImpl: async (url) => { calls.push(String(url)); return replies.shift(); },
  });
  const me = await client.getMe();
  assert.equal(me.user.id, 3);
  assert.deepEqual(waits, [80]);
  assert.equal(calls.length, 4);
  client.close();
});

test("匿名刷新返回 401 时 getMe 返回 null，不触发登出端点", async () => {
  const calls = [];
  const client = createOnlineClient({
    moduleUrl: "https://example.test/games/fat-fish/online-client.js",
    BroadcastChannelRef: null,
    fetchImpl: async (url) => { calls.push(String(url)); return jsonResponse(401, { success: false }); },
  });
  assert.equal(await client.getMe(), null);
  assert.equal(calls.length, 2);
  assert.equal(calls.some((url) => url.includes("logout")), false);
  client.close();
});

test("只响应 new-api:auth-session 的 kind 字段并清理内存令牌", async () => {
  let channel;
  class FakeBroadcastChannel {
    constructor(name) { this.name = name; channel = this; }
    addEventListener(type, listener) { this.listener = listener; }
    close() {}
  }
  const client = createOnlineClient({
    moduleUrl: "https://example.test/games/fat-fish/online-client.js",
    BroadcastChannelRef: FakeBroadcastChannel,
    fetchImpl: async () => jsonResponse(200, { success: true, data: { access_token: "memory", user: { id: 9 } } }),
  });
  const changes = [];
  client.onSessionChange((kind) => changes.push(kind));
  await client.getMe();
  channel.listener({ data: { type: "signed_out" } });
  assert.deepEqual(changes, []);
  channel.listener({ data: { kind: "signed_out" } });
  assert.deepEqual(changes, ["signed_out"]);
  assert.equal(client.user, null);
  client.close();
});

test("角色图片只通过带账户令牌的相对 API 路径读取", async () => {
  const calls = [];
  const image = new Blob(["png"]);
  const client = createOnlineClient({
    moduleUrl: "https://example.test/games/fat-fish/online-client.js",
    BroadcastChannelRef: null,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/api/user/auth/refresh")) {
        return jsonResponse(200, { success: true, data: { access_token: "art-token", user: { id: 4 } } });
      }
      if (String(url).includes("/api/art?") && !options.headers.Authorization) return jsonResponse(401, {});
      if (String(url).includes("/api/art?")) return { status: 200, ok: true, blob: async () => image };
      return jsonResponse(401, {});
    },
  });
  const result = await client.requestArt({ level: 6, variant: "gpt-normal" });
  assert.equal(result, image);
  assert.equal(calls[2].url, "https://example.test/games/fat-fish/api/art?level=6&variant=gpt-normal");
  assert.equal(calls[2].options.headers.Authorization, "Bearer art-token");
  client.close();
});

test("访客使用独立 play API 和 cookie，401 不触发 new-api 刷新", async () => {
  const calls = [];
  const image = new Blob(["png"]);
  const client = createOnlineClient({
    moduleUrl: "https://example.test/games/fat-fish/online-client.js",
    BroadcastChannelRef: null,
    fetchImpl: async (url, options) => {
      const path = String(url);
      calls.push({ path, options });
      if (path.endsWith("/api/me") && !options.headers.Authorization) return jsonResponse(401, {});
      if (path.endsWith("/api/me")) return jsonResponse(200, { success: true, user: { id: 8 }, profile: {}, rewards: [], admin: false });
      if (path.endsWith("/api/user/auth/refresh")) return jsonResponse(200, { success: true, data: { access_token: "account-token", user: { id: 8 } } });
      if (path.endsWith("/api/play/run")) return jsonResponse(200, { success: true, run: { id: "guest-run", seed: 13, variant_seed: 17, guest: true }, play: { run_id: "guest-run", levels: [1, 2, 3], egg_stages: [] } });
      if (path.endsWith("/api/play/checkpoint")) return jsonResponse(401, { success: false, message: "访客记录已失效" });
      if (path.includes("/api/play/art?") && path.includes("level=2")) return jsonResponse(401, { success: false, message: "访客素材已失效" });
      if (path.includes("/api/play/art?")) return { status: 200, ok: true, blob: async () => image };
      return jsonResponse(404, { success: false });
    },
  });
  await client.getMe();
  const started = await client.startGuestRun();
  assert.equal(started.run.id, "guest-run");
  const runCall = calls.find((call) => call.path.endsWith("/api/play/run"));
  assert.equal(runCall.options.method, "POST");
  assert.equal(runCall.options.body, "{}");
  assert.equal(runCall.options.credentials, "include");
  assert.equal(runCall.options.headers.Authorization, undefined);

  await assert.rejects(client.checkpointGuest({ run_id: "guest-run", step: 2, moves: [] }), { status: 401 });
  const refreshCount = calls.filter((call) => call.path.endsWith("/api/user/auth/refresh")).length;
  assert.equal(refreshCount, 1, "guest 401 must not refresh the account session");

  const art = await client.requestPlayingArt({ run_id: "guest-run", level: 1, guest: true });
  assert.equal(art, image);
  const artCall = calls.at(-1);
  assert.match(artCall.path, /\/api\/play\/art\?run_id=guest-run&level=1$/);
  assert.equal(artCall.options.credentials, "include");
  assert.equal(artCall.options.headers.Authorization, undefined);
  await assert.rejects(client.requestPlayingArt({ run_id: "guest-run", level: 2, guest: true }), { status: 401 });
  assert.equal(calls.filter((call) => call.path.endsWith("/api/user/auth/refresh")).length, 1);
  client.close();
});

test("登录账户的 play/art 使用 Bearer 并只在 401 时刷新后重试", async () => {
  const calls = [];
  const image = new Blob(["png"]);
  let artAttempts = 0;
  const client = createOnlineClient({
    moduleUrl: "https://example.test/games/fat-fish/online-client.js",
    BroadcastChannelRef: null,
    fetchImpl: async (url, options) => {
      const path = String(url);
      calls.push({ path, options });
      if (path.endsWith("/api/me") && !options.headers.Authorization) return jsonResponse(401, {});
      if (path.endsWith("/api/user/auth/refresh")) return jsonResponse(200, { success: true, data: { access_token: "account-token", user: { id: 8 } } });
      if (path.endsWith("/api/me")) return jsonResponse(200, { success: true, user: { id: 8 }, profile: {}, rewards: [], admin: false });
      if (path.includes("/api/play/art?") && artAttempts++ === 0) return jsonResponse(401, {});
      if (path.includes("/api/play/art?")) return { status: 200, ok: true, blob: async () => image };
      return jsonResponse(404, { success: false });
    },
  });
  await client.getMe();
  assert.equal(await client.requestPlayingArt({ run_id: "account-run", level: 4, variant: "gpt-normal" }), image);
  const artCalls = calls.filter((call) => call.path.includes("/api/play/art?"));
  assert.equal(artCalls.length, 2);
  assert.match(artCalls[0].path, /run_id=account-run&level=4&variant=gpt-normal$/);
  assert.equal(artCalls[0].options.headers.Authorization, "Bearer account-token");
  assert.equal(artCalls[1].options.headers.Authorization, "Bearer account-token");
  assert.equal(calls.filter((call) => call.path.endsWith("/api/user/auth/refresh")).length, 2);
  client.close();
});

test("登录账户继续使用普通 run/checkpoint 接口并提交固定场地尺寸", async () => {
  const calls = [];
  const client = createOnlineClient({
    moduleUrl: "https://example.test/games/fat-fish/online-client.js",
    BroadcastChannelRef: null,
    fetchImpl: async (url, options) => {
      const path = String(url);
      calls.push({ path, options });
      if (path.endsWith("/api/me") && !options.headers.Authorization) return jsonResponse(401, {});
      if (path.endsWith("/api/user/auth/refresh")) return jsonResponse(200, { success: true, data: { access_token: "account-token", user: { id: 8 } } });
      if (path.endsWith("/api/me")) return jsonResponse(200, { success: true, user: { id: 8 }, profile: {}, rewards: [], admin: false });
      if (path.endsWith("/api/run")) return jsonResponse(200, { success: true, run: { id: "account-run", seed: 13, variant_seed: 17, width: 480, height: 620 }, play: { run_id: "account-run", levels: [1, 2, 3], egg_stages: [] } });
      if (path.endsWith("/api/run/checkpoint")) return jsonResponse(200, { success: true, profile: {}, summary: {}, rewards: [], play: { run_id: "account-run", levels: [1, 2, 3], egg_stages: [] } });
      return jsonResponse(404, { success: false });
    },
  });
  await client.getMe();
  const started = await client.startRun(620);
  assert.equal(started.run.id, "account-run");
  await client.checkpoint({ run_id: "account-run", step: 4, moves: [{ step: 1, x: 200 }] });
  const runCall = calls.find((call) => call.path.endsWith("/api/run"));
  const checkpointCall = calls.find((call) => call.path.endsWith("/api/run/checkpoint"));
  assert.equal(runCall.options.body, JSON.stringify({ height: 620 }));
  assert.equal(runCall.options.headers.Authorization, "Bearer account-token");
  assert.equal(checkpointCall.options.headers.Authorization, "Bearer account-token");
  assert.equal(calls.some((call) => call.path.endsWith("/api/play/run")), false);
  assert.equal(calls.some((call) => call.path.endsWith("/api/play/checkpoint")), false);
  client.close();
});
