import {BALANCE as B} from './balance.js';
export const WORLD={width:1600,height:1000,cell:25,roadWidth:110,base:{x:1500,y:650}};
export const TOWERS={
 glm:{id:'glm',name:'GLM',size:2,color:'#57a484',sprite:'glm',unlock:1},
 kimi:{id:'kimi',name:'Kimi',size:3,color:'#a58be8',sprite:'moon',unlock:2},
 whale:{id:'whale',name:'大肥鱼',size:4,color:'#73bfdc',sprite:'whale',unlock:3},
 qwen:{id:'qwen',name:'Qwen',size:3,color:'#c3a976',sprite:'fan',cost:160,unlock:5}
};
export const BRANCHES={
 egg:{tower:'glm',minStage:4,name:'毒鸡蛋'},sticky:{tower:'whale',minStage:6,name:'糯米大炮'},
 x:{tower:'glm',minStage:7,name:'X方向'},giant:{tower:'whale',minStage:7,name:'鲸鱼巨炮'},
 small:{tower:'qwen',minStage:8,name:'小模型'},large:{tower:'qwen',minStage:8,name:'巨型Qwen'}
};
export const TECHS={
 egg_count:{name:'投出鸡蛋数',short:'鸡蛋数',branch:'egg',max:3},
 egg_venom:{name:'箭矢带毒',short:'毒箭',branch:'egg',max:3},
 egg_coupon:{name:'免费鸡蛋',short:'免费蛋',branch:'egg',max:1},
 sticky_side:{name:'糯米副炮',short:'副炮',branch:'sticky',max:3},
 sticky_burn:{name:'炙热糯米',short:'炙热',branch:'sticky',max:3},
 sticky_loader:{name:'好多鱼',short:'好多鱼',branch:'sticky',max:3},
 x_speed:{name:'高速射击',short:'射速',branch:'x',max:3},
 x_shield:{name:'召唤盾卫',short:'盾卫',branch:'x',max:3},
 x_pierce:{name:'穿甲箭矢',short:'穿甲',branch:'x',max:3},
 giant_cluster:{name:'子母弹',short:'子母弹',branch:'giant',max:3},
 giant_crush:{name:'骇然巨肥',short:'巨肥',branch:'giant',max:3},
 giant_bombard:{name:'白饭征集令',short:'征集令',branch:'giant',cost:B.bombard.pricePerUse,max:0,repeatable:true}
};
export const ENEMIES={
 silly:{family:'gpt',tier:'low',name:'GPT · 低级',sprite:'awake',radius:15},
 normal:{family:'gpt',tier:'mid',name:'GPT · 中级',sprite:'awake',radius:22},
 gpt_elite:{family:'gpt',tier:'elite',name:'GPT · 精英',sprite:'gpt-elite',radius:25},
 grok:{family:'grok',tier:'mid',name:'Grok · 重甲',sprite:'grok',radius:22},
 grok_elite:{family:'grok',tier:'elite',name:'Grok · 精英',sprite:'grok-elite',radius:26},
 gemma:{family:'gemini',tier:'mini',name:'Gemma',sprite:'gemini-mini',radius:9},
 cat:{family:'gemini',tier:'support',name:'Gemini',sprite:'cat',radius:18,auraRange:190,auraBoost:.8},
 claude:{family:'claude',tier:'special',name:'Claude',sprite:'claude',radius:25,absorbRange:230}
};
export const availableBranches=(type,stage)=>Object.entries(BRANCHES).filter(([,b])=>b.tower===type&&b.minStage<=stage);
const techEffect=(id,rank)=>B.research.find(r=>r.id===id&&r.rank===rank)?.effect||{};
const techInvest=(id,rank)=>B.research.find(r=>r.id===id&&r.rank===rank)?.cumulativeResearch||0;
export function productionOptions(t){const f=t.branch==='small'?B.branches.mass:t.branch==='large'?B.branches.large:B.factories[Math.min(2,t.level-1)];return f.options;}
export function towerStats(t){
 const i=Math.min(2,t.level-1),k=t.tech||{},factor=t.coupon?.8:1;
 const v=t.type==='glm'?B.glm[i]:t.type==='whale'?B.whale[i]:t.type==='kimi'?B.kimi[i]:B.factories[i];
 let s={damage:v.damage||0,interval:v.interval||1,range:v.range,damageType:t.type==='kimi'?'magic':t.type==='whale'?'mixed':'physical',splash:v.radius||0,penetration:0,retargetSeconds:t.type==='glm'?.25:0};
 if(t.type==='kimi')Object.assign(s,{damage:v.initialDpsPerBeam,beamPeak:v.peakDpsPerBeam,beamCount:v.beams,beamAimSeconds:v.aimSeconds,beamLowSeconds:v.lowFireSeconds,beamRampSeconds:v.rampEndFireSeconds,beamGrace:.3});
 if(t.type==='qwen'){const f=t.branch==='small'?B.branches.mass:t.branch==='large'?B.branches.large:v;Object.assign(s,{range:f.range,unitCount:f.fieldCap||1,productionOptions:f.options});}
 if(t.branch==='egg'){const b=B.branches.egg,e=techEffect('egg_count',k.egg_count);Object.assign(s,{eggCount:e.eggs||1,eggDps:e.dotDpsPerZone||b.dotDps,eggRadius:b.radius,eggRange:b.range,eggDuration:b.duration,eggInterval:b.interval,poisonDps:techEffect('egg_venom',k.egg_venom).poisonDps||0});}
 if(t.branch==='x'){const b=B.branches.x,pen=techEffect('x_pierce',k.x_pierce),speed=techEffect('x_speed',k.x_speed),cost=b.cost+techInvest('x_pierce',k.x_pierce)+techInvest('x_speed',k.x_speed),interval=speed.interval||b.interval,dps=cost/(b.coefficient*(pen.counterPremium||1));Object.assign(s,{damage:dps*interval,interval,range:b.range,penetration:pen.penetration||0});}
 if(t.branch==='sticky'){const b=B.branches.sticky,side=techEffect('sticky_side',k.sticky_side);Object.assign(s,{damage:b.damage,interval:techEffect('sticky_loader',k.sticky_loader).interval||b.interval,range:b.range,splash:b.radius,slow:b.slow,slowDuration:b.slowDuration,burnDps:techEffect('sticky_burn',k.sticky_burn).dotDps||0,sideDamage:side.hitDamage||0,sidePoison:side.poisonDpsPerLayer||0,sideInterval:side.interval||1});}
 if(t.branch==='giant'){const b=B.branches.giant,c=techEffect('giant_cluster',k.giant_cluster),r=techEffect('giant_crush',k.giant_crush);Object.assign(s,{damage:b.damage,interval:b.interval,range:b.range,splash:b.radius,cluster:c.children||0,clusterDamage:c.childDamage||0,clusterRadius:c.radius||0,crushRank:k.giant_crush||0,crushDamage:r.damage||0,crushInterval:r.interval||18});}
 const shield=techEffect('x_shield',k.x_shield);s.shieldHp=shield.hp||0;s.shieldBlock=shield.block||0;
 for(const key of ['damage','beamPeak','eggDps','poisonDps','burnDps','sideDamage','sidePoison','clusterDamage','crushDamage'])if(s[key])s[key]*=factor;
 s.size=TOWERS[t.type].size;return s;
}
export function upgradePrice(t,kind='level'){const k=t.tech||{};const cost=kind==='level'?TOWERS[t.type].upgrades[t.level-1]:BRANCHES[kind]?.cost??(B.research.find(r=>r.id===kind&&r.rank===(k[kind]||0)+1)?.price??Infinity);return Math.ceil(cost*(t.coupon?.75:1));}
export function effectiveDamage(e,amount,type='physical',penetration=0){const r=type==='magic'?(e.magicResist||0):(e.physicalResist||0);return Math.max(0,amount)*(1-Math.min(.95,Math.max(0,r*(1-penetration))));}

export const enemyType=(type,elite=false)=>elite?(type==='grok'?'grok_elite':type==='silly'||type==='normal'?'gpt_elite':type):type;

// Prices are not enemy threat budgets or production fees.
for(const type of ['glm','whale','kimi']){const a=B[type];TOWERS[type].cost=a[0].cost;TOWERS[type].upgrades=[a[1].cost-a[0].cost,a[2].cost-a[1].cost];}
TOWERS.qwen.cost=B.factories[0].cost;TOWERS.qwen.upgrades=[B.factories[1].cost-B.factories[0].cost,B.factories[2].cost-B.factories[1].cost];
for(const [id,k]of Object.entries(TECHS))k.cost??=B.research.find(r=>r.id===id&&r.rank===1)?.price;
for(const [id,b]of Object.entries(BRANCHES)){const v=B.branches[id==='small'?'mass':id];b.cost=v.upgradeCost??v.cost-B.factories[2].cost;}
const bounties={silly:6,normal:12,gpt_elite:55,grok:24,grok_elite:100,gemma:1,cat:3,claude:130};
for(const v of B.enemies)Object.assign(ENEMIES[v.id],{hp:v.hp,speed:v.speed,damage:v.damage,interval:v.interval,physicalResist:v.physicalResist,magicResist:v.magicResist,leak:v.leak,columns:v.columns,price:v.price,coins:bounties[v.id],tip:''});
Object.assign(ENEMIES.silly,{sprite:'awake'});Object.assign(ENEMIES.gpt_elite,{sprite:'gpt-elite'});Object.assign(ENEMIES.grok_elite,{sprite:'grok-elite'});Object.assign(ENEMIES.gemma,{sprite:'gemini-mini'});
for(const b of Object.values(BRANCHES))b.description='';for(const k of Object.values(TECHS))k.description='';
