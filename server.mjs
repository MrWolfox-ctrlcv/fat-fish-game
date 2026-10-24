import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const distDir = resolve(projectDir, "dist");
const realDist = await realpath(distDir);
const host = "127.0.0.1";
const port = Number(process.env.PORT || process.argv[2] || 4177);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname); }
  catch { response.writeHead(400).end("Bad request"); return; }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(distDir, relativePath);
  const rel = relative(distDir, filePath);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const actualPath = await realpath(filePath);
    const actualRelative = relative(realDist, actualPath);
    if (isAbsolute(actualRelative) || actualRelative === ".." || actualRelative.startsWith(`..${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const data = await readFile(actualPath);
    response.writeHead(200, {
      "Content-Type": mime[extname(actualPath).toLowerCase()] || "application/octet-stream",
      "Content-Length": data.length,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    if (request.method === "HEAD") response.end(); else response.end(data);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, host, () => {
  process.stdout.write(`合成大肥鱼已启动：http://${host}:${port}\n按 Ctrl+C 停止。\n`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
