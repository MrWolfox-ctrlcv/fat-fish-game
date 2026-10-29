import {readFile,writeFile,mkdir,copyFile,readdir,lstat,realpath,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const parent=resolve(root,'artifacts'),out=join(parent,'survivor-itch');
await mkdir(parent,{recursive:true});
if(await realpath(parent)!==parent)throw Error('Linked output parent refused');
try{const st=await lstat(out);if(!st.isDirectory()||st.isSymbolicLink()||await readFile(join(out,'.itch-build-owner'),'utf8')!=='survivor-itch-v1')throw Error('Output is not owned by this builder');await rm(out,{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(out);await writeFile(join(out,'.itch-build-owner'),'survivor-itch-v1');
async function copy(from,to){await mkdir(dirname(join(out,to)),{recursive:true});await copyFile(join(root,from),join(out,to));}
for(const n of ['index.html','main.js','engine.js','render.js','maps.js','scene-render.js','roster.js','heroes.js','loot.js','music.js','shop-items.js','style.css'])await copy('survival/'+n,n);
for(const n of ['cloud-saves.js','shop.js','station-dialog.js'])await copy('survival/itch-adapters/'+n,n);
for(const [from,to] of [['data/art-prepared/01.png','survival-avatar.png'],['data/art-prepared/21.png','super-fat.png'],['survival/assets/map-floor.webp','map-floor.png'],['survival/assets/loot-sheet.webp','loot-sheet.png']])await copy(from,to);
for(let i=1;i<=11;i++)await copy(`data/art-prepared/${String(i).padStart(2,'0')}.png`,`fish-stage/${i}.png`);
const art={gptSilly:'12',gptNormal:'15',astra:'24',deepseekFull:'11'};
for(const [name,id]of Object.entries(art))await copy(`data/art-prepared/${id}.png`,`enemy/${name}.png`);
for(const name of ['deepseek','gemini','claude','doubao','qwen','kimi'])await copy(`playroom/portraits/${name}.png`,`enemy/${name}.png`);
for(const [alias,name]of Object.entries({sol:'gptNormal',opus:'claude',geminiFlash:'gemini',qwenMax:'qwen',kimiThinking:'kimi',deepseekReasoner:'deepseek',geminiFlashLite:'gemini'}))await copyFile(join(out,`enemy/${name}.png`),join(out,`enemy/${alias}.png`));
let html=await readFile(join(out,'index.html'),'utf8');
html=html.replace('>云存档</button>','>站内存档 ↗</button>').replace('>战斗补给</button>','>站内补给 ↗</button>');
html=html.replace('云存档可使用站内账户；额外档位与续期均需确认付费','此为独立浏览器版，战斗在本地运行。本版本不连接账户、扣费或云存档；如需这些功能，请前往站内版。页面关闭后本局进度不会保存');
html=html.replace(/<a\b([^>]*href="https:\/\/oua-cdn\.wolfoxlabs\.xyz[^>]*?)>/g,(all,attrs)=>attrs.includes('target=')?all:`<a${attrs} target="_blank" rel="noopener">`);
await writeFile(join(out,'index.html'),html);
await copy('LICENSE','LICENSE');
await writeFile(join(out,'CREDITS.txt'),'肥鱼幸存者 / Fat Fish Survivor\nCode: Wolfox Labs contributors, MIT (see LICENSE).\nCharacter art: AI-generated / prepared game assets and community-inspired AI character designs used by this project. No separate blanket art license is granted by this package.\nMusic: procedural Web Audio composition shipped in music.js; no external recordings.\nBrand names belong to their respective owners. This is an independent fan game.\nhttps://github.com/MrWolfox-ctrlcv/fat-fish-game\n');
await writeFile(join(out,'UPLOAD-ITCH.md'),'# itch.io 上传说明\n\n上传配套 ZIP，项目类型选择 HTML，勾选 This file will be played in the browser。ZIP 根目录必须是 index.html。建议启用全屏按钮和 Mobile friendly；显示区域可设置 1280 × 800，并允许滚动条。\n\n无需部署服务器，不需要填写 API Key。先测试桌面键盘、触屏移动、音量、专注模式。音频必须在用户点击后才会播放。\n\n本独立版不支持账户、扣费和云存档；站内补给与存档入口会说明并打开站内版，当前局面不会自动迁移。Astra 解锁仅保存在当前浏览器，iframe 的存储限制可能影响保留。关闭页面会结束未保存的对局。\n\n小游戏不以盈利为目的。上架页面请使用免费游玩；自愿支持可联系站长：微信 MusterChief / QQ 1176114181 / 1176114181@qq.com。\n\n官方指南：https://itch.io/docs/creators/html5\n');
const files=[];async function walk(dir){for(const x of await readdir(dir,{withFileTypes:true})){if(x.isSymbolicLink())throw Error('Unexpected symlink');if(x.isDirectory())await walk(join(dir,x.name));else files.push(join(dir,x.name));}}await walk(out);
if(files.some(x=>/\.(sqlite|env|key|pem)$|online-client|backend/i.test(x)))throw Error('Private or online runtime in standalone build');
console.log(JSON.stringify({output:out,files:files.length,standalone:true}));
