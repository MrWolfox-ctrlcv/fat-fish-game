// Isolated loopback-only browser fixture for the game launcher UI.
// No proxy, accounts, credentials, or upstream site requests are involved.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const entryPath = fileURLToPath(new URL('../deploy/entry.js', import.meta.url));
const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>隔离测试 · 小游戏入口</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #f4f8fa; color: #244354; font: 15px/1.6 system-ui, sans-serif; }
    header { padding: 18px 24px; background: #fff; border-bottom: 1px solid #dce8ed; }
    main { width: min(880px, calc(100% - 32px)); margin: 32px auto; }
    .fixture-note { margin-bottom: 18px; color: #567181; font-size: 13px; }
    custom-home-content { display: block; }
  </style>
</head>
<body>
  <header><strong>隔离测试站</strong>　<span>小游戏入口检查</span></header>
  <main>
    <p class="fixture-note">本页面仅用于检查浮动入口拖动、菜单定位和首页 shadow-root 按钮，不连接真实站点。</p>
    <custom-home-content></custom-home-content>
  </main>
  <script>
    const host = document.querySelector('custom-home-content');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = ` + '`' + `
      <style>
        .wx-home { min-height: 320px; padding: clamp(22px, 6vw, 52px); border: 1px solid #d9e8ef; border-radius: 24px; background: linear-gradient(145deg, #fff, #eef8fc); box-shadow: 0 12px 36px #17486c12; }
        .hero { max-width: 620px; }
        h1 { margin: 0 0 12px; color: #17486c; font-size: clamp(27px, 5vw, 42px); line-height: 1.2; }
        p { margin: 0; color: #5b7280; }
        .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
        .btn { padding: 10px 18px; border-radius: 12px; font: 600 14px system-ui, sans-serif; }
        .primary { border: 1px solid #27698b; background: #27698b; color: #fff; }
        .ghost { border: 1px solid #c6dce7; background: #fff; color: #315a70; }
      </style>
      <section class="wx-home">
        <div class="hero">
          <h1>欢迎来到小游戏测试页</h1>
          <p>你可以点首页动作按钮或左下角浮动按钮打开选择菜单；拖动左下角按钮后应保持位置且不误打开菜单。</p>
          <div class="actions"><button class="btn primary" type="button">站点首页动作</button></div>
        </div>
      </section>
    ` + '`' + `;
  </script>
  <script src="/fat-fish-entry.js"></script>
</body>
</html>`;

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4183');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : page);
    return;
  }
  if (url.pathname === '/fat-fish-entry.js') {
    try {
      const source = await readFile(entryPath);
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : source);
    } catch {
      response.writeHead(500).end('Launcher script unavailable');
    }
    return;
  }
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
});

server.listen(4183, '127.0.0.1', () => console.log('Isolated launcher QA at http://127.0.0.1:4183/'));
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
