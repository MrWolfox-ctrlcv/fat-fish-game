// Isolated local browser QA. No requests or credentials reach the real station.
import { createServer } from 'node:http';
import { createGameServer } from '../backend/app.mjs';
import { GameStore } from '../backend/store.mjs';
import { weekFor, previousWeek } from '../backend/weekly.mjs';

const store = new GameStore(':memory:');
store.saveProgress(901, { score: 1200, unlocked: [1, 2, 3, 4, 5, 6], egg_stages: ['gpt-normal:6'] });
const user = { id: 901, username: 'QA管理员', role: 100 };
const records = [1701, 1702, 1703].map((id) => ({ id, key: `fixture-code-only-${id}-not-redeemable`, name: '联动验证',
  status: 1, used_user_id: 0, quota: 51200, expired_time: Math.floor(Date.now() / 1000) + 86400 }));
if (process.env.FAT_FISH_QA_STOCK === '1') {
  const campaign = { id: 'first-fat-fish-6', title: '首次合成谢礼', min_level: 6 };
  store.importPrizes(901, campaign, records);
  store.claim(901, campaign.id);
}
if (process.env.FAT_FISH_QA_WEEKLY === '1') {
  const current = weekFor(Date.now());
  const previous = previousWeek(Date.now());
  store.saveProgress(901, { score: 1800, unlocked: [1, 2, 3, 4, 5, 6, 7], egg_stages: ['gpt-normal:6', 'doubao:2', 'doubao:4', 'doubao:6', 'gemini:3', 'gemini:5', 'gemini:7'] });
  const campaign = { id: 'qa-weekly', title: '周榜冠军谢礼（验证）', min_level: 2, kind: 'weekly' };
  store.createCampaign(901, campaign);
  store.importPrizes(901, campaign, records.map((item) => ({ ...item, id: item.id + 100, key: `fixture-weekly-code-only-${item.id}-not-redeemable` })));
  for (const [userId, name, score] of [[901, 'QA管理员', 1800], [902, '鲸鱼团子', 1200], [903, '咕噜咕噜', 960]]) {
    store.recordWeeklyScore({ weekId: current.id, userId, name, score, maxLevel: 7, runId: `qa-${userId}`, attainedAt: current.start + 3600000 });
  }
  store.recordWeeklyScore({ weekId: previous.id, userId: 901, name: 'QA管理员', score: 2000, maxLevel: 8, runId: 'previous-qa', attainedAt: previous.start + 3600000 });
}
const mockFetch = async (url, options) => {
  if (options.headers.Authorization !== 'Bearer fixture-administrator-token') return Response.json({ success: false }, { status: 401 });
  const path = new URL(url).pathname;
  return Response.json({ success: true, data: path === '/api/user/self' ? user : path.endsWith('/search') ? { items: records } : records.find((r) => r.id === Number(path.split('/').at(-1))) });
};
const { server: backend } = await createGameServer({ store, fetchImpl: mockFetch, origins: ['http://127.0.0.1:4182'] });
await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
let personalToken = null;
const personalStats = { created: 0, chats: 0, disabled: 0 };
const wrapper = createServer(async (request, response) => {
  const qaUrl = new URL(request.url, 'http://127.0.0.1:4182');
  const sendQa = (data) => response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
  const readQa = async () => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || '{}'); };
  if (qaUrl.pathname === '/__qa/personal-stats') { sendQa(personalStats); return; }
  if (qaUrl.pathname === '/api/user/self/groups') { sendQa({ success: true, data: { default: { ratio: 1, desc: '隔离测试分组' }, flash: { ratio: 0.5, desc: '隔离测试低倍率' } } }); return; }
  if (qaUrl.pathname === '/api/pricing') { sendQa({ success: true, data: [{ model_name: 'deepseek/deepseek-v4.1-flash', enable_groups: ['default', 'flash'] }] }); return; }
  if (qaUrl.pathname === '/api/token/' && request.method === 'POST') {
    personalToken = { ...await readQa(), id: 7001, user_id: 901, status: 1, used_quota: 0 };
    personalStats.created++; sendQa({ success: true }); return;
  }
  if (qaUrl.pathname === '/api/token/search') { sendQa({ success: true, data: { items: personalToken ? [personalToken] : [] } }); return; }
  if (qaUrl.pathname === '/api/token/7001') { sendQa({ success: true, data: personalToken }); return; }
  if (qaUrl.pathname === '/api/token/7001/key') { sendQa({ success: true, data: { key: 'sk-fixture-only-never-a-real-key' } }); return; }
  if (qaUrl.pathname === '/api/token/' && request.method === 'PUT') {
    const patch = await readQa(); personalToken = { ...personalToken, ...patch };
    if (patch.status === 2) personalStats.disabled++;
    sendQa({ success: true, data: personalToken }); return;
  }
  if (qaUrl.pathname === '/v1/chat/completions') {
    await readQa(); personalStats.chats++;
    sendQa({ choices: [{ message: { content: '【隔离测试回复】已验证专用 Key 聊天通路，本测试未调用真实模型或扣费。' } }] }); return;
  }
  if (request.url === '/api/user/auth/refresh') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ success: true, data: { access_token: 'fixture-administrator-token', user, session: { sid: 'qa-only' }, access_expires_at: Date.now() / 1000 + 1800 } }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const upstream = await fetch(`http://127.0.0.1:${backend.address().port}${request.url}`, {
    method: request.method, headers: { ...request.headers, 'accept-encoding': 'identity' },
    ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: Buffer.concat(chunks) }),
  });
  response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
  response.end(Buffer.from(await upstream.arrayBuffer()));
});
wrapper.listen(4182, '127.0.0.1', () => console.log('Isolated QA at http://127.0.0.1:4182/games/fat-fish/'));
process.on('SIGTERM', () => { wrapper.close(); backend.close(); });
