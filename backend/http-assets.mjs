import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

export const contentTag = (data) => `"${createHash('sha256').update(data).digest('hex')}"`;
export const matchesTag = (header, tag) => String(header || '').split(',').some((value) => value.trim().replace(/^W\//, '') === tag || value.trim() === '*');

function accepts(header, name) {
  return String(header || '').split(',').some((item) => {
    const [encoding, ...params] = item.trim().split(';');
    return encoding === name && !params.some((p) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(p));
  });
}

// Small immutable release files only. User data and private artwork never enter this cache.
export async function createStaticAssets(root, names) {
  const entries = new Map();
  for (const name of names) {
    const data = await readFile(new URL(name, root));
    entries.set(name, { data, tag: contentTag(data), gzip: gzipSync(data),
      br: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) });
  }
  return (request, response, name, headers) => {
    const entry = entries.get(name);
    if (!entry) return false;
    const encoding = accepts(request.headers['accept-encoding'], 'br') ? 'br' : accepts(request.headers['accept-encoding'], 'gzip') ? 'gzip' : null;
    const data = encoding ? entry[encoding] : entry.data;
    const tag = encoding ? entry.tag.slice(0, -1) + `-${encoding}"` : entry.tag;
    const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
    const cacheHeaders = { ...headers, 'Cache-Control': 'public, no-cache', ETag: tag, Vary: 'Accept-Encoding',
      'Content-Type': `${type}; charset=utf-8`,
      'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" };
    if (encoding) cacheHeaders['Content-Encoding'] = encoding;
    if (matchesTag(request.headers['if-none-match'], tag)) { response.writeHead(304, cacheHeaders).end(); return true; }
    response.writeHead(200, { ...cacheHeaders, 'Content-Length': data.length });
    response.end(request.method === 'HEAD' ? undefined : data);
    return true;
  };
}

export async function sendPrivateArt(request, response, art, key, headers, publicAsset = false) {
  // Caller MUST check account/run permission before this function, including 304 responses.
  let image;
  image = await art.get(key);
  if (!image) throw Object.assign(new Error('这个模样暂未收录。'), { status: 404 });
  const tag = contentTag(image);
  const privateHeaders = { ...headers, 'Cache-Control': publicAsset ? 'public, no-cache' : 'private, no-cache',
    ...(publicAsset ? {} : { Vary: 'Authorization, Cookie' }), ETag: tag, 'Content-Type': 'image/png' };
  if (matchesTag(request.headers['if-none-match'], tag)) { response.writeHead(304, privateHeaders).end(); return; }
  image ??= await art.get(key);
  response.writeHead(200, { ...privateHeaders, 'Content-Length': image.length });
  response.end(image);
}
