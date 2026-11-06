import {readFile} from 'node:fs/promises';
import {gzipSync,brotliCompressSync,constants} from 'node:zlib';
const MIME={js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',html:'text/html; charset=utf-8',png:'image/png',webp:'image/webp',svg:'image/svg+xml',mp3:'audio/mpeg'};
export async function createTowerAssets(root=new URL('../tower-defense/',import.meta.url)){
 let manifest;try{manifest=JSON.parse(await readFile(new URL('runtime-manifest.json',root),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
 const files=new Map(manifest.files.map(f=>[f.path,f])),cache=new Map();
 return async(req,res,path,headers)=>{
  const f=files.get(path);if(!f)return false;const extension=path.split('.').at(-1),text=['js','css','html','svg'].includes(extension),encoding=text&&/\bbr\b/.test(req.headers['accept-encoding']||'')?'br':text&&/\bgzip\b/.test(req.headers['accept-encoding']||'')?'gzip':null;
  const tag='"'+f.sha256+(encoding?'-'+encoding:'')+'"',out={...headers,'Content-Type':MIME[extension],'Cache-Control':text?'public, no-cache':'public, max-age=3600',ETag:tag,...(text?{Vary:'Accept-Encoding'}:{}),'Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"};
  if(req.headers['if-none-match']===tag){res.writeHead(304,out).end();return true;}
  if(req.method==='HEAD'){res.writeHead(200,out).end();return true;}
  let data;if(text){let entry=cache.get(path);if(!entry){const raw=await readFile(new URL(path,root));entry={raw,br:brotliCompressSync(raw,{params:{[constants.BROTLI_PARAM_QUALITY]:4}}),gzip:gzipSync(raw)};cache.set(path,entry);}data=entry[encoding||'raw'];}else data=await readFile(new URL(path,root));
  res.writeHead(200,{...out,'Content-Length':data.length,...(encoding?{'Content-Encoding':encoding}:{})});res.end(data);return true;
 };
}
