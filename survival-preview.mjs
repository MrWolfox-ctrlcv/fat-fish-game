import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const port=Number(process.env.PORT||process.argv[2]||4185);
const base=process.env.SURVIVOR_BASE||'/';
if(!/^\/(?:[a-z-]+\/)*$/.test(base))throw new Error('Invalid survivor base');
const paths=new Map([
 ['/', ['survival/index.html','text/html']],
 ...['main.js','engine.js','render.js','roster.js','heroes.js','loot.js','cloud-saves.js','music.js','shop.js','shop-items.js','style.css'].map(n=>['/'+n,['survival/'+n,n.endsWith('.css')?'text/css':'text/javascript']]),
 ['/online-client.js',['dist/online-client.js','text/javascript']],
 ['/physics-version.js',['dist/physics-version.js','text/javascript']],
 ['/survival-avatar.png',['data/art-prepared/01.png','image/png']],
 ['/super-fat.png',['data/art-prepared/21.png','image/png']],
 ['/map-floor.png',['survival/assets/map-floor.webp','image/webp']],
 ['/loot-sheet.png',['survival/assets/loot-sheet.webp','image/webp']],
]);
for(let stage=1;stage<=11;stage++)paths.set(`/fish-stage/${stage}.png`,[`data/art-prepared/${String(stage).padStart(2,'0')}.png`,'image/png']);
const stagedPortraits={gptSilly:'12',gptNormal:'15',astra:'24',deepseekFull:'11'};
for(const [name,index] of Object.entries(stagedPortraits))paths.set(`/enemy/${name}.png`,[`data/art-prepared/${index}.png`,'image/png']);
for(const name of ['deepseek','gemini','claude','doubao','qwen','kimi'])paths.set(`/enemy/${name}.png`,[`playroom/portraits/${name}.png`,'image/png']);
for(const [alias,key]of Object.entries({sol:'gptNormal',opus:'claude',geminiFlash:'gemini',qwenMax:'qwen',kimiThinking:'kimi',deepseekReasoner:'deepseek',geminiFlashLite:'gemini'}))paths.set(`/enemy/${alias}.png`,paths.get(`/enemy/${key}.png`));
let saveService,saveServicePromise;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith(base)&&/^api\/(me|saves|shop)(\/|$)/.test(url.pathname.slice(base.length))){
    if(!saveServicePromise)saveServicePromise=import('./backend/survivor-saves.mjs').then(({createSurvivorSaves})=>saveService=createSurvivorSaves({dbPath:process.env.SURVIVOR_DB||fileURLToPath(new URL('./data/survivor.sqlite',import.meta.url))})).catch(error=>{saveServicePromise=null;throw error;});
    await saveServicePromise;
    if(await saveService.handle(req,res,url))return;
  }
 }catch{res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({success:false,message:'云存档服务暂不可用。'}));return;}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
 let entry;try{
   const path=new URL(req.url,'http://localhost').pathname;
   if(base!=='/'&&path===base.slice(0,-1)){res.writeHead(302,{Location:base}).end();return;}
   if(path==='/games/'){entry=['survival/hub.html','text/html'];}
   else if(!path.startsWith(base)){res.writeHead(404).end();return;}
   else if(path.slice(base.length)==='api/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({success:true,game:'survivor'}));return;}
   else entry=paths.get('/'+path.slice(base.length));
 }catch{res.writeHead(400).end();return;}
 if(!entry){res.writeHead(404).end();return;}
 try{
   const data=await readFile(new URL(entry[0],import.meta.url));const etag='"'+createHash('sha256').update(data).digest('hex')+'"';
   const headers={'Content-Type':entry[1]+'; charset=utf-8','Cache-Control':entry[1].startsWith('image/')?'public, max-age=86400':'public, no-cache','ETag':etag,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
   if(req.headers['if-none-match']===etag){res.writeHead(304,headers).end();return;}
   res.writeHead(200,{...headers,'Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404).end();}
});
server.listen(port,'127.0.0.1',()=>console.log(`肥鱼幸存者：http://127.0.0.1:${port}/`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{saveService?.close();process.exit(0);}));
