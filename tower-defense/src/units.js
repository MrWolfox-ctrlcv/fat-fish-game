// One shared sheet per unit, never one decoded texture per instance.
export const UNIT_MODELS={
 silly:{name:'降智龙',family:'enemy',height:49,palette:'#bba4e4',silhouette:'短角、短翼、空白眼',weapon:'软头练习棒',motion:'摇晃小跑，挥棒后停顿'},
 cat:{name:'极其猫',family:'enemy',height:49,palette:'#c29bf1',silhouette:'猫耳、蓬尾、四色星',weapon:'爪击与闪现',motion:'前倾轻跑，闪现前收身'},
 awake:{name:'觉醒龙',family:'enemy',height:60,palette:'#b3a3dd',silhouette:'直立龙角、肩披、法杖',weapon:'晶杖',motion:'稳步推进，举杖后打击'},
 claude:{name:'克小姐',family:'enemy',height:57,palette:'#e3ad77',silhouette:'橙色长发、书、花饰',weapon:'护盾书',motion:'抱书缓行，展开书页释放护盾'},
 grok:{name:'黑曜姬',family:'enemy',height:71,palette:'#ba9872',silhouette:'黑金重甲、大斧、双马尾',weapon:'双刃斧',motion:'重步、后摆蓄力、斧击'},
 boss:{name:'星冕龙',family:'enemy',height:112,palette:'#d4b77b',silhouette:'星环冠、长袍、龙翼',weapon:'星杖与震地',motion:'沉重行进，抬杖预警后震地'},
 whale:{name:'大肥鱼',family:'tower',height:83,palette:'#72b9d7',silhouette:'蓝色鲸耳、女仆头饰、饭勺',weapon:'饭团炮',motion:'装填、递饭、抛出，鲸尾跟随'},
 glm:{name:'嘎啦嘛',family:'tower',height:88,palette:'#718ca5',silhouette:'黑发狐耳、白尾尖、眼罩',weapon:'长弓',motion:'拉弓、松弦、收弓，尾部跟随'},
 moon:{name:'月之嘉欣',family:'tower',height:83,palette:'#b1a4df',silhouette:'银发、月饰、长裙',weapon:'大型三棱镜',motion:'抬手聚光、指引光束、放松'},
 fan:{name:'千扇',family:'tower',height:83,palette:'#91b3df',silhouette:'蓝紫发、折扇、小帽',weapon:'纸扇召唤阵',motion:'合扇、展扇、指向集结点'},
 recruit:{name:'纸扇卫',family:'ally',height:47,palette:'#a3bfdc',silhouette:'短披风、折扇、轻护甲',weapon:'短扇刃',motion:'轻快巡行，近身横扫'},
 general:{name:'千扇大将',family:'ally',height:78,palette:'#bca66e',silhouette:'大扇、金蓝重甲、旗披',weapon:'重型战扇',motion:'重步、扇面拦截、挥扇震击'}
};
export const SHEET={columns:4,rows:6,frame:128};
export const ACTION_ROWS={idle:0,walk:1,attack:2,cast:3,hurt:4,death:5};
export function unitPose(unit,time,{death=false,age=0}={}){
 let action='idle',elapsed=time;
 if(death){action='death';elapsed=age;}
 else if(time-(unit.hurtAt??-1e6)<.24){action='hurt';elapsed=time-unit.hurtAt;}
 else if(unit.windup>0||unit.starWindup>0||unit.shieldWindup>0||time-(unit.castAt??-1e6)<.72){action='cast';elapsed=time-(unit.castAt??time);}
 else if(time-(unit.attackAt??-1e6)<.48){action='attack';elapsed=time-unit.attackAt;}
 else if(unit.moving){action='walk';elapsed=time+(unit.id||0)*.13;}
 const duration={attack:.48,cast:.72,hurt:.24,death:.72}[action];
 const frame=action==='idle'?1:action==='walk'?Math.floor(Math.max(0,elapsed)*9)%4:Math.min(3,Math.floor(Math.max(0,elapsed)/duration*4));
 return {action,row:ACTION_ROWS[action],frame};
}
export function createUnitAtlas(){
 const sheets=new Map(),pending=new Set();
 function request(key){if(sheets.has(key)||pending.has(key)||!UNIT_MODELS[key])return;pending.add(key);const img=new Image();img.decoding='async';img.onload=()=>{if(img.naturalWidth===SHEET.columns*SHEET.frame&&img.naturalHeight===SHEET.rows*SHEET.frame)sheets.set(key,img);};img.src=`/games/tower-defense/assets/units/${key}.webp`;}
 function draw(c,key,unit,time,x,y,height,options={}){
  request(key);const img=sheets.get(key);if(!img)return false;
  const p=options.turnaround!==undefined?{row:0,frame:options.turnaround}:unitPose(unit,time,options);c.save();c.translate(x,y);if(options.flip)c.scale(-1,1);
  // All frames share a cell pivot. No per-frame fitting (which would make units grow/shrink).
  c.drawImage(img,p.frame*SHEET.frame,p.row*SHEET.frame,SHEET.frame,SHEET.frame,-height*.5,-height,height,height);c.restore();return true;
 }
 return {draw,request,loaded:()=>sheets.size};
}
