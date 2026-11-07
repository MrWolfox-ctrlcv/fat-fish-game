import {getMap} from './levels.js';
export const defaultPriority=type=>type==='kimi'?'strong':type==='whale'?'cluster':'first';
export const priorityName={first:'最前',strong:'强敌',cluster:'密集',support:'支援'};
export const priorityHelp={first:'优先离终点最近的敌人',strong:'优先当前生命最高的敌人',cluster:'优先炮弹爆炸能覆盖最多敌人的落点',support:'优先Claude、Gemini等支援单位'};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function predictedEnemy(g,e,seconds){const route=getMap(g.levelId).routes[e.route],speed=e.blockedBy?.length?0:e.speed*(e.boosted?1.8:1)*(1-(e.slow||0)),p=route.atDistance(e.progress+speed*seconds),lateral=e.lateral||0;return {x:p.x-Math.sin(p.angle)*lateral,y:p.y+Math.cos(p.angle)*lateral,e};}
function denseCenter(points,radius,fallback){
 const maxRadius=Math.max(0,...points.map(p=>p.e.radius)),cell=Math.max(32,2*(radius+maxRadius)),bins=new Map(),key=(x,y)=>x+':'+y;
 for(const p of points){const k=key(Math.floor(p.x/cell),Math.floor(p.y/cell));if(!bins.has(k))bins.set(k,[]);bins.get(k).push(p);}
 const neighbors=p=>{const a=[],x=Math.floor(p.x/cell),y=Math.floor(p.y/cell);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)a.push(...(bins.get(key(x+dx,y+dy))||[]));return a;};
 let best={...fallback,hits:0,lead:Infinity,targetId:fallback.e.id};
 function score(p){const hit=neighbors(p).filter(v=>distance(v,p)<=radius+v.e.radius),lead=Math.min(...hit.map(v=>v.e.remaining)),offset=distance(p,fallback);if(hit.length>best.hits||hit.length===best.hits&&(lead<best.lead||lead===best.lead&&offset<(best.offset??Infinity)))best={x:p.x,y:p.y,hits:hit.length,lead,offset,targetId:hit.sort((a,b)=>a.e.remaining-b.e.remaining)[0]?.e.id||fallback.e.id};}
 for(const p of points){score(p);const near=neighbors(p).filter(v=>v!==p&&distance(v,p)<=2*radius+p.e.radius+v.e.radius).sort((a,b)=>distance(a,p)-distance(b,p)||a.e.id-b.e.id).slice(0,3);for(const q of near)score({x:(p.x+q.x)/2,y:(p.y+q.y)/2});if(near.length>=2)score({x:(p.x+near[0].x+near[1].x)/3,y:(p.y+near[0].y+near[1].y)/3});}
 return best;
}
export function cannonAim(g,t,s,list){
 const speed=t.branch==='giant'?440:550,first=list[0];let duration=Math.max(.25,distance(t,first)/speed),aim;
 for(let pass=0;pass<2;pass++){
  const points=list.map(e=>{const p=predictedEnemy(g,e,duration);return {...p,e:{...e,remaining:getMap(g.levelId).routes[e.route].length-e.progress}};});
  aim=t.priority==='cluster'?denseCenter(points,s.splash,points[0]):{...points[0],targetId:first.id};duration=Math.max(.25,distance(t,aim)/speed);
 }
 return {x:aim.x,y:aim.y,targetId:aim.targetId,duration};
}
