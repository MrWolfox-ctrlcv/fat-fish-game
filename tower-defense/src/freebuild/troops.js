import {towerStats,productionOptions} from './data.js';
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function queueProduction(g,id,choice){
 const t=g.towers.find(t=>t.id===id&&t.type==='qwen');if(!t||g.paused||['won','lost'].includes(g.phase))return false;
 const p=productionOptions(t).find(p=>p.id===choice);if(!p)return false;t.production??=[];
 const owned=g.allies.filter(a=>a.towerId===id&&a.hp>0&&a.kind!=='shield'&&(p.kind!=='large'||a.kind==='large')),cap=towerStats(t).unitCount;
 if(owned.length+t.production.length>=cap||t.production.length>=8||g.gold<p.productionCost||g.allies.length>=128)return false;
 if(p.kind==='large'&&(g.allies.some(a=>a.kind==='large'&&a.hp>0)||g.towers.some(t=>t.production?.some(q=>q.profile.kind==='large'))))return false;
 g.gold-=p.productionCost;g.stats.spent+=p.productionCost;g.stats.productionSpent=(g.stats.productionSpent||0)+p.productionCost;
 t.production.push({profile:{...p},remaining:p.productionSeconds});t.castAt=g.time;return true;
}
function spawn(g,t,p,extra={}){const a={id:g.id++,towerId:t.id,kind:p.kind,modelId:p.id,x:t.x,y:t.y,hp:p.hp,maxHp:p.hp,damage:p.damage,damagePenalty:t.coupon?.8:1,interval:p.interval,speed:p.speed,physicalResist:p.physicalResist,magicResist:p.magicResist,block:p.block,columns:p.columns,attackCooldown:0,executeCooldown:12,summonCooldown:12,rally:{...t.rally},...extra};g.allies.push(a);return a;}
export function orderTroops(g,ids,x,y){let n=0;for(const a of g.allies)if(ids.includes(a.id)&&a.kind!=='shield'){a.order={x:x+(n%3-1)*22,y:y+Math.floor(n/3)*24};n++;}return n;}
export function updateTroops(g,dt,{damageEnemy,executeEnemy,emit,effect}){
 for(const t of g.towers){const s=towerStats(t);
  if(t.type==='qwen'&&t.production?.length&&g.allies.length<128){const q=t.production[0];q.remaining-=dt;if(q.remaining<=0){spawn(g,t,q.profile);t.production.shift();emit(g,'summon-'+q.profile.kind,t.x);}}
  if(t.tech.x_shield){t.shieldCooldown-=dt;if(t.shieldCooldown<=0&&!g.allies.some(a=>a.towerId===t.id&&a.kind==='shield'&&a.hp>0)&&g.allies.length<128)spawn(g,t,{id:'shield',kind:'shield',hp:s.shieldHp,damage:0,interval:1,speed:65,physicalResist:0,magicResist:0,block:s.shieldBlock,columns:1},{damageStage:0});}
 }
 const engagement=new Map();
 for(const a of g.allies){if(a.hp<=0)continue;const t=g.towers.find(t=>t.id===a.towerId),shield=a.kind==='shield';if(shield&&!t){a.hp=0;continue;}
  if(!a.order&&t)a.rally={...t.rally};const rally=a.order||a.rally,reach=shield?140:100;
  const list=g.enemies.filter(e=>e.hp>0&&dist(e,rally)<reach).sort((x,y)=>shield?y.hp-x.hp:dist(x,a)-dist(y,a)),target=list[0];
  const angle=a.id*2.4,rad=target?target.radius+(shield?30:13):8+(a.id%3)*9,dest={x:(target||rally).x+Math.cos(angle)*rad,y:(target||rally).y+Math.sin(angle)*rad};
  const d=dist(a,dest),step=Math.min(d,(a.speed||65)*dt);a.moving=step>1;if(d){a.x+=(dest.x-a.x)/d*step;a.y+=(dest.y-a.y)/d*step;}a.facing=(dest.x-a.x)>=0?1:-1;
  const close=list.filter(e=>dist(a,e)<e.radius+(shield?42:28)),held=close.filter(e=>!e.blockedBy.length).slice(0,a.block);for(const e of held)e.blockedBy.push(a.id);
  if(shield)continue;a.attackCooldown-=dt;a.executeCooldown-=dt;a.summonCooldown-=dt;const victim=close.find(e=>(engagement.get(e.id)||0)<a.columns);if(victim)engagement.set(victim.id,(engagement.get(victim.id)||0)+1);
  if(victim&&a.attackCooldown<=0){damageEnemy(g,victim,a.damage*(a.damagePenalty||1)*(g.boost?.towerId===a.towerId?1.8:1),'physical',0,a.towerId);a.attackCooldown=a.interval;a.attackAt=g.time;}
  if(a.kind==='large'){
   if(victim&&victim.hp>0&&a.executeCooldown<=0){executeEnemy(g,victim,a.towerId);a.executeCooldown=12;a.castAt=g.time;effect(g,'splash',victim.x,victim.y,.4,{radius:35});}
   if(a.summonCooldown<=0&&g.allies.length<126){const count=g.allies.filter(v=>v.summonedBy===a.id&&v.hp>0).length,p={...towerStats({type:'qwen',level:3,tech:{}}).productionOptions[0]};for(let i=0;i<Math.min(2,6-count);i++)spawn(g,{id:a.towerId,x:a.x,y:a.y,rally,coupon:a.damagePenalty===.8},p,{summonedBy:a.id,order:a.order?{...a.order}:null});a.summonCooldown=12;emit(g,'summon-small',a.x);}
  }
 }
}
