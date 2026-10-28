import { WIDTH, HEIGHT } from './engine.js';
const assetUrl = (path) => new URL(path, import.meta.url).href;
export function createRenderer(canvas, { portraitUrl = '/survival-avatar.png' } = {}) {
  const ctx = canvas?.getContext?.('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D context is required');
  const world = { width: WIDTH, height: HEIGHT };
  const floorImage = new Image(); floorImage.decoding = 'async'; floorImage.src = assetUrl('./map-floor.png');
  const lootImage = new Image(); lootImage.decoding = 'async'; lootImage.src = assetUrl('./loot-sheet.png');
  const bg = document.createElement('canvas'); bg.width = 384; bg.height = 384;
  const bctx = bg.getContext('2d');
  const image = new Image(); image.decoding = 'async'; image.src = assetUrl(portraitUrl === '/survival-avatar.png' ? './survival-avatar.png' : portraitUrl);
  const enemyImages = new Map();
  const growthImages = new Map();
  let floorPattern = null, fallbackPattern = null;
  let width = 1, height = 1, scale = 1, ox = 0, oy = 0, mobile = false;
  let pixelRatio = 1, backingWidth = 0, backingHeight = 0, lastPlayer = null;
  const n = (v, d = 0) => Number.isFinite(v) ? v : d;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function enemyImage(key) {
    const aliases = { gptSilly:'gptSilly', gemini:'gemini', claude:'claude', gptNormal:'gptNormal', astra:'astra', doubao:'doubao', qwen:'qwen', kimi:'kimi', deepseek:'deepseek', deepseekFull:'deepseekFull', sol:'sol', opus:'opus', geminiFlash:'geminiFlash', qwenMax:'qwenMax', kimiThinking:'kimiThinking', deepseekReasoner:'deepseekReasoner' };
    key = aliases[key] || key;
    if (!key) return null;
    let entry = enemyImages.get(key);
    if (!entry) {
      if (enemyImages.size >= 20) return null;
      const img = new Image(); img.decoding = 'async';
      entry = { img, failed: false };
      img.onerror = () => { entry.failed = true; };
      enemyImages.set(key, entry);
      img.src = assetUrl(`./enemy/${encodeURIComponent(key)}.png`);
    }
    return entry.failed ? null : entry.img;
  }
  function growthImage(stage) {
    stage=Math.min(11,Math.max(1,Math.floor(Number(stage)||1)));
    if(stage===1)return image;
    if(!growthImages.has(stage)){
      const img=new Image();img.decoding='async';img.src=assetUrl(`./fish-stage/${stage}.png`);growthImages.set(stage,img);
      if(growthImages.size>2){const oldest=growthImages.keys().next().value;growthImages.get(oldest).src='';growthImages.delete(oldest);}
    }
    return growthImages.get(stage);
  }
  function lootSprite(index, x, y, w, h) {
    if (!lootImage.complete || !lootImage.naturalWidth) return false;
    const cols = 3, rows = 2, sw = lootImage.naturalWidth / cols, sh = lootImage.naturalHeight / rows;
    ctx.drawImage(lootImage, (index % cols) * sw, Math.floor(index / cols) * sh, sw, sh, x, y, w, h);
    return true;
  }
  function background() {
    const g = bctx.createLinearGradient(0, 0, 384, 384); g.addColorStop(0, '#123d48'); g.addColorStop(.55, '#205b60'); g.addColorStop(1, '#174550'); bctx.fillStyle = g; bctx.fillRect(0,0,384,384);
    bctx.strokeStyle = 'rgba(174,236,216,.09)'; bctx.lineWidth = 1;
    for(let x=0;x<=384;x+=64){bctx.beginPath();bctx.moveTo(x,0);bctx.lineTo(x,384);bctx.stroke();}
    for(let y=0;y<=384;y+=64){bctx.beginPath();bctx.moveTo(0,y);bctx.lineTo(384,y);bctx.stroke();}
  }
  background();
  function resize(){const r=canvas.getBoundingClientRect(); width=Math.max(1,r.width);height=Math.max(1,r.height);pixelRatio=Math.min(window.devicePixelRatio||1,1.75,Math.sqrt(2e6/(width*height)));backingWidth=Math.round(width*pixelRatio);backingHeight=Math.round(height*pixelRatio);if(canvas.width!==backingWidth||canvas.height!==backingHeight){canvas.width=backingWidth;canvas.height=backingHeight;}ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);mobile=height>width;const vw=width/Math.max(width/1280,height/900);const vh=height/Math.max(width/1280,height/900);scale=width/vw;const p=lastPlayer;ox=clamp(n(p?.x,WIDTH/2)-vw/2,0,world.width-vw);oy=clamp(n(p?.y,HEIGHT/2)-vh/2,0,world.height-vh);}
  function screenToWorld(clientX,clientY){const r=canvas.getBoundingClientRect();return{x:(clientX-r.left)/scale+ox,y:(clientY-r.top)/scale+oy};}
  function draw(game={}){lastPlayer=game.player||null;resize();const p=game.player||{};ox=clamp(n(p.x,WIDTH/2)-width/scale/2,0,world.width-width/scale);oy=clamp(n(p.y,HEIGHT/2)-height/scale/2,0,world.height-height/scale);ctx.fillStyle='#123d48';ctx.fillRect(0,0,width,height);ctx.save();ctx.scale(scale,scale);ctx.translate(-ox,-oy);if(floorImage.complete&&floorImage.naturalWidth){floorPattern ||= ctx.createPattern(floorImage,'repeat');ctx.fillStyle=floorPattern;}else{fallbackPattern ||= ctx.createPattern(bg,'repeat');ctx.fillStyle=fallbackPattern;}ctx.fillRect(0,0,world.width,world.height);ctx.fillStyle='rgba(15,53,57,.17)';ctx.fillRect(0,0,world.width,world.height);ctx.strokeStyle='#8de0bf';ctx.lineWidth=10;ctx.strokeRect(5,5,world.width-10,world.height-10);
    const circ=(x,y,r,c)=>{ctx.fillStyle=c;ctx.beginPath();ctx.arc(n(x),n(y),Math.max(1,n(r,5)),0,Math.PI*2);ctx.fill();};
    for(const c of game.chests||[]){const x=n(c.x),y=n(c.y),r=n(c.radius,20);if(!lootSprite(c.open?1:0,x-r,y-r,r*2,r*2)){ctx.fillStyle='#9b613b';ctx.fillRect(x-r,y-r*.65,r*2,r*1.3);ctx.fillStyle='#e0b66b';ctx.fillRect(x-r,y-r*.65,r*2,5);ctx.fillRect(x-3,y-r*.65,6,r*1.3);ctx.fillStyle='#f4d789';ctx.fillRect(x-4,y-3,8,9);}if(c.maxHp>0){ctx.fillStyle='#381f20';ctx.fillRect(x-r,y-r-9,r*2,4);ctx.fillStyle='#f2c96e';ctx.fillRect(x-r,y-r-9,r*2*clamp(n(c.hp)/c.maxHp,0,1),4);}}
    for(const o of game.orbs||[]){const x=n(o.x),y=n(o.y);if(!lootSprite(o.value>=10?3:2,x-12,y-12,24,24)){ctx.fillStyle=o.value>=10?'#efc765':'#88f5cf';ctx.beginPath();ctx.moveTo(x,y-9);ctx.lineTo(x+7,y);ctx.lineTo(x,y+9);ctx.lineTo(x-7,y);ctx.closePath();ctx.fill();}}
    for(const b of game.bullets||[]){const x=n(b.x),y=n(b.y),r=n(b.radius,6);ctx.fillStyle=b.hostile?'#ff796e':(b.kind==='enemy'?'#ff796e':'#b8f4ef');ctx.beginPath();ctx.ellipse(x,y,r*.7,r*1.3,0,0,Math.PI*2);ctx.fill();}
    for (const e of game.enemies || []) {
      if (e.dead) continue;
      const x = n(e.x), y = n(e.y), r = n(e.radius, 18);
      const color = e.color || (e.kind === 'chaser' || e.kind === 'bug' ? '#ac80c6' : e.kind === 'dash' || e.kind === 'timeout' ? '#efaa5e' : e.kind === 'ranged' || e.kind === 'error' ? '#e87d79' : e.kind === 'boss' ? '#d28ca4' : '#87b2d4');
      if (e.telegraph > 0 || e.dashWindup > 0) { ctx.strokeStyle = '#fbd09b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = e.flash > 0 || e.hitFlash > 0 ? '#fff1c9' : color;
      ctx.beginPath();
      if (e.kind === 'dash' || e.kind === 'timeout') { ctx.moveTo(x, y-r); ctx.lineTo(x+r, y); ctx.lineTo(x, y+r); ctx.lineTo(x-r, y); ctx.closePath(); }
      else if(e.kind === 'ranged') {ctx.rect(x-r*.8,y-r*.8,r*1.6,r*1.6);}
      else ctx.ellipse(x,y,r*1.1,r*.85,0,0,Math.PI*2);
      ctx.fill();
      const portrait = enemyImage(e.portrait || e.modelId);
      if (portrait?.complete && portrait.naturalWidth) {
        ctx.save(); ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.clip();
        ctx.drawImage(portrait,x-r,y-r,r*2,r*2); ctx.restore();
      } else { circ(x-r*.3,y-2,3,'#253a49'); circ(x+r*.3,y-2,3,'#253a49'); }
      ctx.strokeStyle = e.slowTimer>0?'#a9edff':color; ctx.lineWidth = e.slowTimer>0?4:2; ctx.beginPath(); ctx.arc(x,y,r+1,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle='rgba(18,35,47,.82)';ctx.beginPath();ctx.arc(x+r*.68,y+r*.68,8,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff4dc';ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(clamp(n(e.tier,1),1,5)),x+r*.68,y+r*.68);
      if (e.name && e.kind!=='boss' && e.kind!=='elite') {ctx.font=`${Math.max(10,11/scale)}px system-ui`;const tw=ctx.measureText(e.name).width;ctx.fillStyle='rgba(18,48,53,.8)';ctx.fillRect(x-tw/2-4,y+r+4,tw+8,15/scale);ctx.fillStyle='#fff4dc';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(e.name,x,y+r+5);}
      if (e.kind === 'boss' || e.kind === 'elite') {
        ctx.fillStyle='#382b3c';ctx.fillRect(x-r,y-r-13,r*2,5);
        ctx.fillStyle='#ffc8b8';ctx.fillRect(x-r,y-r-13,r*2*clamp(n(e.hp)/Math.max(1,n(e.maxHp,1)),0,1),5);
        ctx.fillStyle='#fff0d1';ctx.font='bold 13px system-ui';ctx.textAlign='center';ctx.fillText(e.name || (e.kind==='boss'?'大魔王':'精英'),x,y-r-20);
      }
    }
    for(const q of game.pickups||[]){const x=n(q.x),y=n(q.y);if(q.kind==='chromeOrb'){for(let i=0;i<3;i++){ctx.fillStyle=['#e45b51','#ebc65a','#6da66a'][i];ctx.beginPath();ctx.moveTo(x,y);ctx.arc(x,y,15,i*Math.PI*2/3,(i+1)*Math.PI*2/3);ctx.closePath();ctx.fill();}circ(x,y,7,'#fff');circ(x,y,5,'#60a8dd');continue;}if(q.kind==='resetScroll'){ctx.fillStyle='#fff2d2';ctx.fillRect(x-10,y-13,20,26);ctx.strokeStyle='#9a80ba';ctx.lineWidth=2;ctx.strokeRect(x-10,y-13,20,26);ctx.beginPath();ctx.moveTo(x-5,y-3);ctx.lineTo(x+5,y-3);ctx.moveTo(x-5,y+3);ctx.lineTo(x+5,y+3);ctx.stroke();continue;}if(!lootSprite(q.kind==='astraCore'?5:4,x-14,y-14,28,28)){ctx.fillStyle='#fff4df';ctx.beginPath();ctx.ellipse(x,y+3,12,6,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f4e8c8';ctx.beginPath();ctx.arc(x,y,9,Math.PI,0);ctx.fill();ctx.fillStyle='#e6a84e';circ(x,y,3,'#e6a84e');}}
    for(const z of game.particles||[]){ctx.globalAlpha=clamp(n(z.life,1),0,1);circ(z.x,z.y,n(z.radius,3),z.color||'#d7fff0');}ctx.globalAlpha=1;
    const x=n(p.x,WIDTH/2),y=n(p.y,HEIGHT/2),r=n(p.radius,28),hero=game.heroId||p.heroId||'deepseek',gemini=hero==='gemini',gpt=hero==='gpt',astra=hero==='astra',transformed=!!p.transformed,stage=Math.max(1,Math.min(11,Math.floor(n(p.fishStage,1)))),fat=hero==='deepseek'&&p.superFat===true,growth=growthImage(stage);if(gemini&&(n(p.chromeShieldCharges)>0&&n(p.chromeShieldTimer)>0)){ctx.strokeStyle='rgba(91,219,255,.78)';ctx.lineWidth=5;ctx.beginPath();ctx.arc(x,y,r+14,0,Math.PI*2);ctx.stroke();}else if(gpt&&transformed){ctx.strokeStyle='rgba(255,196,127,.75)';ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y,r+10,0,Math.PI*2);ctx.stroke();}else if(astra){ctx.strokeStyle='rgba(190,164,255,.68)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,r+11,0,Math.PI*2);ctx.stroke();}if(p.toolNodeTimer>0){ctx.strokeStyle='rgba(244,194,115,.65)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,r+40,0,Math.PI*2);ctx.stroke();}if(p.slideTimer>0){ctx.strokeStyle='rgba(180,246,255,.38)';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(x,y+r*.55,r*1.4,9,0,0,Math.PI*2);ctx.stroke();}ctx.fillStyle='rgba(0,0,0,.28)';ctx.beginPath();ctx.ellipse(x,y+r*.72,r*1.05,Math.max(8,r*.34),0,0,Math.PI*2);ctx.fill();ctx.save();ctx.translate(x,y);ctx.scale(p.dashTimer>0?1.12:1,p.dashTimer>0?.84:1);let heroImg;if(gemini)heroImg=enemyImage('gemini');else if(gpt)heroImg=enemyImage(transformed?'gptNormal':'gptSilly');else if(astra)heroImg=enemyImage('astra');else if(fat){heroImg=superImage();if(!heroImg?.naturalWidth)heroImg=growth;}else heroImg=growth;if(heroImg?.complete&&heroImg.naturalWidth)ctx.drawImage(heroImg,-r-10,-r-10,r*2+20,r*2+20);else{circ(0,0,r,'#f4d1ad');circ(0,-10,r*.75,'#fff0d6');ctx.fillStyle='#38474a';ctx.fillRect(-22,-19,44,8);ctx.fillStyle='#c15e72';ctx.fillRect(-22,16,44,18);}ctx.restore();ctx.save();ctx.translate(x,y);ctx.rotate(n(p.facing));ctx.fillStyle='#e9d6a6';ctx.beginPath();ctx.moveTo(r+13,-5);ctx.lineTo(r+23,0);ctx.lineTo(r+13,5);ctx.fill();ctx.restore();
    if(game.effects?.orbit>0){for(let i=0;i<3;i++){const a=n(p.orbitAngle)+i*Math.PI*2/3;const bx=x+Math.cos(a)*145,by=y+Math.sin(a)*145;circ(bx,by,7,'#80ecdc');circ(bx,by,3,'#f6fff2');}}
    const hp=clamp(n(p.health,1)/Math.max(1,n(p.maxHealth,1)),0,1);ctx.fillStyle='#392d36';ctx.fillRect(x-25,y-r-12,50,5);ctx.fillStyle='#ff8580';ctx.fillRect(x-25,y-r-12,50*hp,5);
    ctx.restore();
    ctx.fillStyle='rgba(18,48,53,.72)';ctx.fillRect(10,10,110,72);
    ctx.strokeStyle='#d4ebe0';ctx.lineWidth=1;ctx.strokeRect(10,10,110,72);
    ctx.fillStyle='#7fe4c8';ctx.fillRect(10+ox/world.width*110,10+oy/world.height*72,width/scale/world.width*110,height/scale/world.height*72);
    ctx.fillStyle='#fff4ce';ctx.beginPath();ctx.arc(10+x/world.width*110,10+y/world.height*72,3,0,7);ctx.fill();
    for(const e of game.enemies||[])if(e.kind==='boss'||e.kind==='elite'){ctx.fillStyle='#d66b70';ctx.fillRect(8+e.x/world.width*110,8+e.y/world.height*72,4,4);}
  }
  let superImageCache=null;function superImage(){if(!superImageCache){superImageCache=new Image();superImageCache.decoding='async';superImageCache.src=assetUrl('./super-fat.png');}return superImageCache;}
  function destroy(){image.src='';for(const img of growthImages.values())img.src='';growthImages.clear();floorImage.src='';lootImage.src='';if(superImageCache)superImageCache.src='';for(const {img} of enemyImages.values())img.src='';enemyImages.clear();}
  return {draw,screenToWorld,resize,destroy};
}
