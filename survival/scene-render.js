import { mapForRound, ventPhase } from './maps.js';

export function createScenePainter(ctx) {
  const tile=document.createElement('canvas');tile.width=tile.height=384;
  const c=tile.getContext('2d');let key='',pattern=null;
  function floor(game,image,x,y,w,h) {
    const map=mapForRound(game.round),ready=image.complete&&image.naturalWidth>0,nextKey=map.id+ready;
    if(nextKey!==key){
      key=nextKey;c.fillStyle=map.floor;c.fillRect(0,0,384,384);
      if(ready){c.globalAlpha=.19;c.drawImage(image,0,0,384,384);c.globalAlpha=1;}
      c.strokeStyle=map.tint;c.globalAlpha=.22;c.lineWidth=2;
      for(let i=0;i<16;i++){const px=(i*137)%384,py=(i*83)%384;c.beginPath();c.ellipse(px,py,18+i%4*8,8+i%3*3,i*.7,0,Math.PI*2);c.stroke();}
      c.globalAlpha=.09;c.strokeStyle=map.accent;for(let i=0;i<=384;i+=96){c.beginPath();c.moveTo(i,0);c.lineTo(i,384);c.stroke();}
      c.globalAlpha=1;pattern=ctx.createPattern(tile,'repeat');
    }
    ctx.fillStyle=pattern||map.floor;ctx.fillRect(x,y,w,h);
  }
  function scenery(game,visible) {
    const map=mapForRound(game.round);
    for(const t of map.terrain){if(!visible(t,t.radius))continue;
      ctx.save();ctx.translate(t.x,t.y);ctx.fillStyle=map.foliage;ctx.globalAlpha=.16;ctx.beginPath();ctx.arc(0,0,t.radius,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=.35;ctx.strokeStyle=map.accent;ctx.lineWidth=2;ctx.setLineDash([5,10]);ctx.stroke();ctx.setLineDash([]);
      for(let i=0;i<14;i++){const a=i*2.4,r=t.radius*(.3+(i%4)*.15),x=Math.cos(a)*r,y=Math.sin(a)*r;ctx.beginPath();ctx.moveTo(x,y+10);ctx.quadraticCurveTo(x-14,y-7,x+3,y-24);ctx.stroke();}
      ctx.globalAlpha=.72;ctx.fillStyle=map.accent;ctx.font='12px system-ui';ctx.textAlign='center';ctx.fillText(map.terrainName+' · 双方减速',0,t.radius+18);ctx.restore();
    }
    for(const d of map.decorations){if(!visible(d,d.size*2))continue;
      ctx.save();ctx.translate(d.x,d.y);ctx.globalAlpha=.75;ctx.fillStyle='rgba(5,13,28,.2)';ctx.beginPath();ctx.ellipse(0,10,d.size*1.2,9,0,0,Math.PI*2);ctx.fill();ctx.lineWidth=6;ctx.strokeStyle=map.rock;
      if(map.decor==='coral'){for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(0,10);ctx.quadraticCurveTo(i*26,-5,i*d.size*.7,-d.size);ctx.stroke();ctx.beginPath();ctx.moveTo(i*12,-6);ctx.lineTo(i*30,-d.size*.6);ctx.stroke();}}
      else if(map.decor==='mushroom'){ctx.fillStyle=map.foliage;ctx.fillRect(-5,-d.size*.7,10,d.size);ctx.fillStyle=map.rock;ctx.beginPath();ctx.ellipse(0,-d.size*.7,d.size,d.size*.4,0,Math.PI,Math.PI*2);ctx.fill();ctx.fillStyle=map.accent;for(let i=-1;i<=1;i++){ctx.beginPath();ctx.arc(i*12,-d.size*.8,3,0,7);ctx.fill();}}
      else if(map.decor==='cargo'){ctx.rotate((d.variant-1)*.2);ctx.fillStyle=map.rock;ctx.fillRect(-d.size,-d.size*.5,d.size*2,d.size);ctx.strokeStyle=map.accent;ctx.lineWidth=2;ctx.strokeRect(-d.size,-d.size*.5,d.size*2,d.size);for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(i*d.size*.6,-d.size*.5);ctx.lineTo(i*d.size*.6,d.size*.5);ctx.stroke();}}
      else {ctx.fillStyle=map.rock;ctx.beginPath();ctx.moveTo(-d.size*.6,10);ctx.lineTo(-d.size*.3,-d.size);ctx.lineTo(d.size*.3,-d.size*.8);ctx.lineTo(d.size*.7,10);ctx.closePath();ctx.fill();ctx.strokeStyle=map.accent;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-4,-d.size*.6);ctx.lineTo(3,-d.size*.2);ctx.lineTo(-2,5);ctx.stroke();}
      ctx.restore();
    }
    for(const vent of map.vents){if(!visible(vent,vent.radius+30))continue;const phase=ventPhase(game.time||0,vent),active=phase==='active',warning=phase==='warning';
      ctx.save();ctx.translate(vent.x,vent.y);ctx.fillStyle='#172733';ctx.beginPath();ctx.ellipse(0,0,26,18,0,0,7);ctx.fill();ctx.strokeStyle=active?'#ff9576':warning?'#ffdc8a':map.accent;ctx.lineWidth=active?5:2;ctx.globalAlpha=active?.7:warning?.65:.28;
      ctx.beginPath();ctx.arc(0,0,vent.radius,0,7);if(active){ctx.fillStyle='#fa7858';ctx.globalAlpha=.18;ctx.fill();ctx.globalAlpha=.8;}ctx.setLineDash(warning?[8,7]:[]);ctx.stroke();ctx.setLineDash([]);
      if(active)for(let i=0;i<4;i++){ctx.globalAlpha=.55;const r=12+((game.time*30+i*18)%65);ctx.beginPath();ctx.arc(0,-r*.3,r*.55,0,7);ctx.stroke();}
      ctx.globalAlpha=.9;ctx.fillStyle=warning?'#ffdc8a':active?'#ffb19a':map.accent;ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillText(active?'喷流 · 双方受伤':warning?'即将喷发':'间歇喷流',0,vent.radius+16);ctx.restore();
    }
    for(const node of game.scene?.nodes||[]){if(node.hp<=0||!visible(node,40))continue;ctx.save();ctx.translate(node.x,node.y);
      ctx.fillStyle=map.accent;ctx.strokeStyle='#f4fff6';ctx.lineWidth=2;
      for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(i*14-11,8);ctx.lineTo(i*14-8,-18-Math.abs(i)*6);ctx.lineTo(i*14+3,-29+Math.abs(i)*8);ctx.lineTo(i*14+12,-8);ctx.lineTo(i*14+6,10);ctx.closePath();ctx.fill();ctx.stroke();}
      ctx.fillStyle='#132c38';ctx.fillRect(-22,22,44,4);ctx.fillStyle=map.accent;ctx.fillRect(-22,22,44*node.hp/node.maxHp,4);ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillText('经验晶簇',0,40);ctx.restore();
    }
  }
  return {floor,scenery};
}
