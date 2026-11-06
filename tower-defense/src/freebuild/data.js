export const WORLD={width:1600,height:1000,cell:25,roadWidth:110,base:{x:1500,y:650}};
export const TOWERS={
 glm:{id:'glm',name:'GLM',subtitle:'嘎啦嘛 · 箭塔',size:2,color:'#57a484',sprite:'glm',cost:70,upgrades:[60,95],unlock:1},
 kimi:{id:'kimi',name:'Kimi',subtitle:'月之嘉欣 · 聚焦激光',size:3,color:'#a58be8',sprite:'moon',cost:140,upgrades:[100,160],unlock:2},
 whale:{id:'whale',name:'大肥鱼',subtitle:'饭团范围炮',size:4,color:'#73bfdc',sprite:'whale',cost:180,upgrades:[120,200],unlock:3},
 qwen:{id:'qwen',name:'Qwen',subtitle:'千扇 · 模型兵营',size:3,color:'#c3a976',sprite:'fan',cost:160,upgrades:[120,180],unlock:5}
};
export const BRANCHES={
 egg:{tower:'glm',minStage:4,name:'毒鸡蛋',cost:110,description:'小狐狸投掷范围持续法伤与减速毒鸡蛋。'},
 sticky:{tower:'whale',minStage:6,name:'糯米大炮',cost:450,description:'炮弹范围减速，进一步研究副炮、炙热糯米与装填手。'},
 x:{tower:'glm',minStage:7,name:'X方向',cost:3200,description:'极昂贵：620超大射程、240伤害、0.32秒间隔。'},
 giant:{tower:'whale',minStage:7,name:'鲸鱼巨炮',cost:4600,description:'极昂贵：650射程、900物伤、190爆炸半径。'},
 small:{tower:'qwen',minStage:8,name:'小模型',cost:750,description:'每0.45秒产出一名小模型，最多14名，快速补员。'},
 large:{tower:'qwen',minStage:8,name:'中大模型',cost:1200,description:'同时部署3名中大模型，高血量并可阻挡2个敌人。'}
};
export const TECHS={
 egg_count:{name:'投出鸡蛋数',short:'鸡蛋数',branch:'egg',cost:100,max:3,description:'每级额外投出一枚，覆盖不同落点。'},
 egg_venom:{name:'箭矢带毒',short:'毒箭',branch:'egg',cost:120,max:3,description:'箭矢附加持续法伤，每级增加8/秒。'},
 egg_coupon:{name:'免费鸡蛋',short:'免费蛋',branch:'egg',cost:120,max:1,description:'指定另一座塔：后续升级优惠25%，攻击力永久降低20%。'},
 sticky_side:{name:'糯米副炮',short:'副炮',branch:'sticky',cost:240,max:3,description:'攻击血量最高的敌人，低物伤，命中增加可叠加的6秒毒伤。'},
 sticky_burn:{name:'炙热糯米',short:'炙热',branch:'sticky',cost:260,max:3,description:'糯米炮弹落点留下4秒持续法伤区域。'},
 sticky_loader:{name:'好多鱼',short:'好多鱼',branch:'sticky',cost:280,max:3,description:'增加装填手，每级提高30%射速。'},
 x_speed:{name:'高速射击',short:'射速',branch:'x',cost:900,max:3,description:'每级额外提高25%射速。'},
 x_shield:{name:'召唤盾卫',short:'盾卫',branch:'x',cost:1200,max:3,description:'巨型黑盾卫：2200/3600/5200生命，阻挡2/3/4个敌人。'},
 x_pierce:{name:'穿甲箭矢',short:'穿甲',branch:'x',cost:1000,max:3,description:'每级忽略25%物抗，最多75%。'},
 giant_cluster:{name:'子母弹',short:'子母弹',branch:'giant',cost:1100,max:3,description:'主炮爆炸后分裂2/4/6枚小型范围炮弹。'},
 giant_crush:{name:'骇然巨肥',short:'巨肥',branch:'giant',cost:1500,max:3,description:'周期发射超级大肥鱼碾压沿途敌人，物伤法伤7:3。'},
 giant_bombard:{name:'白饭征集令',short:'征集令',branch:'giant',cost:1500,max:0,repeatable:true,description:'每次支付1500金币，对全图敌人造成2500物理伤害。'}
};
export const ENEMIES={
 silly:{family:'gpt',tier:'low',name:'GPT · 低级',sprite:'silly',hp:85,speed:55,physicalResist:0,magicResist:0,damage:7,interval:1.1,coins:8,leak:1,radius:15,tip:'基础敌人，GLM箭塔即可应对。'},
 grok:{family:'grok',tier:'mid',name:'Grok · 重甲',sprite:'grok',hp:420,speed:38,physicalResist:.6,magicResist:.05,damage:80,interval:1.3,coins:22,leak:2,radius:22,tip:'物抗60%、法抗5%，用Kimi持续法伤应对。'},
 gemma:{name:'猫仔 · Gemma',sprite:null,hp:24,speed:42,physicalResist:0,magicResist:0,damage:3,interval:1.2,coins:2,leak:1,radius:9,tip:'低速低血，数量很多，适合范围攻击。'},
 cat:{family:'gemini',tier:'support',name:'Gemini',sprite:'cat',hp:220,speed:68,physicalResist:.1,magicResist:.1,damage:12,interval:.9,coins:22,leak:2,radius:18,auraRange:190,auraBoost:.8,tip:'190范围内猫仔加速80%，光环不叠加。'},
 normal:{family:'gpt',tier:'mid',name:'GPT · 中级',sprite:'awake',hp:650,speed:58,physicalResist:.1,magicResist:.1,damage:28,interval:1,coins:65,leak:3,radius:22,tip:'生命、速度、双抗和攻击均中高，配合兵营阻挡与集中火力。'},
 gpt_elite:{family:'gpt',tier:'elite',name:'GPT · 精英',sprite:'awake',hp:2100,speed:40,physicalResist:.35,magicResist:.35,damage:100,interval:1.3,coins:100,leak:3,radius:25,tip:''},
 grok_elite:{family:'grok',tier:'elite',name:'Grok · 精英',sprite:'grok',hp:1600,speed:30,physicalResist:.8,magicResist:.05,damage:3000,interval:2.4,coins:110,leak:4,radius:26,tip:''},
 claude:{family:'claude',tier:'special',name:'Claude',sprite:'claude',hp:12000,speed:30,physicalResist:0,magicResist:0,damage:18,interval:1.6,coins:260,leak:4,radius:25,absorbRange:230,tip:'无双抗的纯血牛，吸收230范围内友军受到的全部伤害；承伤耗尽后余伤回到原目标。'}
};
export const availableBranches=(type,stage)=>Object.entries(BRANCHES).filter(([,b])=>b.tower===type&&b.minStage<=stage);
export function towerStats(t){
 const b=TOWERS[t.type],i=Math.min(2,t.level-1),k=t.tech||{},factor=t.coupon?.8:1;
 let s=t.type==='glm'?{damage:[12,20,32][i],interval:[.6,.55,.5][i],range:[230,250,275][i],damageType:'physical'}:
 t.type==='kimi'?{damage:[24,41,66][i],interval:0,range:[250,275,300][i],damageType:'magic',beamCount:i+1,beamRampMax:2.5,beamRampSeconds:18,beamGrace:.3}:
 t.type==='whale'?{damage:[52,82,128][i],interval:[1.9,1.8,1.7][i],range:[245,265,285][i],splash:[70,85,100][i],damageType:'physical'}:
 {damage:[12,21,34][i],interval:1.1,range:[230,250,275][i],damageType:'physical',unitCount:[2,3,4][i],unitHp:[130,230,360][i],unitDamage:[12,21,34][i],unitInterval:1.1,unitSpeed:95,unitBlock:1,respawn:[5,4.5,4][i],unitKind:'small'};
 if(t.branch==='egg')Object.assign(s,{eggCount:1+(k.egg_count||0),eggDps:18*factor,eggRadius:75,eggDuration:4,eggInterval:3.5,poisonDps:(k.egg_venom||0)*8*factor});
 if(t.branch==='sticky')Object.assign(s,{damage:140,interval:1.8/(1+(k.sticky_loader||0)*.3),range:320,splash:110,slow:.35,slowDuration:3,burnDps:(k.sticky_burn||0)*16*factor,sideDamage:12*factor,sidePoison:(k.sticky_side||0)*9*factor,sideInterval:Math.max(1.5,2.6-(k.sticky_side||0)*.3)});
 if(t.branch==='x')Object.assign(s,{damage:240,interval:.32/(1+(k.x_speed||0)*.25),range:620,penetration:(k.x_pierce||0)*.25});
 if(t.branch==='giant')Object.assign(s,{damage:900,interval:3.8,range:650,splash:190,cluster:(k.giant_cluster||0)*2,crushRank:k.giant_crush||0,crushDamage:[0,2400,3600,5000][k.giant_crush||0]*factor,crushInterval:Math.max(12,21-(k.giant_crush||0)*3)});
 if(t.branch==='small')Object.assign(s,{unitCount:14,unitHp:120,unitDamage:12,unitInterval:.65,unitSpeed:135,unitBlock:1,respawn:.45,unitKind:'small',range:300});
 if(t.branch==='large')Object.assign(s,{unitCount:3,unitHp:2200,unitDamage:100,unitInterval:1.2,unitSpeed:75,unitBlock:2,respawn:4,unitKind:'large',range:320});
 s.damage*=factor;if(s.unitDamage)s.unitDamage*=factor;s.penetration??=0;s.size=b.size;return s;
}
export function upgradePrice(t,kind='level'){const k=t.tech||{};const cost=kind==='level'?TOWERS[t.type].upgrades[t.level-1]:BRANCHES[kind]?.cost??(TECHS[kind]?Math.round(TECHS[kind].cost*(1+(k[kind]||0)*.5)):Infinity);return Math.ceil(cost*(t.coupon?.75:1));}
export function effectiveDamage(e,amount,type='physical',penetration=0){const r=type==='magic'?(e.magicResist||0):(e.physicalResist||0);return Math.max(0,amount)*(1-Math.min(.95,Math.max(0,r*(1-penetration))));}

export const enemyType=(type,elite=false)=>elite?(type==='grok'?'grok_elite':type==='silly'||type==='normal'?'gpt_elite':type):type;
