export function beamMultiplierAt(s,time){return beamDps(s,time)/s.damage;}
function beamDps(s,t){return t<=s.beamLowSeconds?s.damage:s.damage+(s.beamPeak-s.damage)*Math.min(1,(t-s.beamLowSeconds)/(s.beamRampSeconds-s.beamLowSeconds));}
export function beamDamageDuring(s,charge,dt){const k=s.beamLowSeconds,r=s.beamRampSeconds,span=r-k,initial=s.damage,peak=s.beamPeak;const area=t=>{if(t<=k)return initial*t;const u=Math.min(span,t-k);return initial*k+initial*u+(peak-initial)*u*u/(2*span)+peak*Math.max(0,t-r);};return area(charge+dt)-area(charge);}
export function updateKimiBeams(g,t,s,list,dt,damageEnemy){
 t.beams??=[];t.beams.length=s.beamCount;const occupied=new Set(t.beams.filter(Boolean).map(b=>b.targetId).filter(Boolean));
 for(let i=0;i<s.beamCount;i++){
  const b=t.beams[i]??={targetId:null,charge:0,missing:0,aimElapsed:0,active:false};b.active=false;b.aiming=false;
  let e=g.enemies.find(e=>e.id===b.targetId&&e.hp>0),inside=e&&Math.hypot(e.x-t.x,e.y-t.y)<=s.range+e.radius;
  const acquired=e&&(b.aimElapsed||0)>=s.beamAimSeconds-1e-9;
  if(!e||(!inside&&!acquired)){
   if(e&&b.missing+dt<s.beamGrace){b.missing+=dt;continue;}
   occupied.delete(b.targetId);b.targetId=null;b.charge=0;b.missing=0;b.aimElapsed=0;b.sounded=false;
   e=list.find(e=>e.hp>0&&!occupied.has(e.id));if(!e)continue;b.targetId=e.id;occupied.add(e.id);
   const row=(g.stats.towerDamage??={})[t.id]??={physical:0,magic:0};row.beamContacts=(row.beamContacts||0)+1;
  }
  b.missing=0;t.aim=Math.atan2(e.y-t.y,e.x-t.x);
  const aimStep=Math.min(dt,Math.max(0,s.beamAimSeconds-(b.aimElapsed||0)));b.aimElapsed=(b.aimElapsed||0)+aimStep;
  const firingDt=dt-aimStep;b.aiming=firingDt<=1e-10;if(b.aiming)continue;
  b.active=true;t.attackAt=g.time;if(!b.sounded){if(g.events.length<64)g.events.push({type:'laser',x:t.x});b.sounded=true;}
  const before=e.hp,amount=beamDamageDuring(s,b.charge,firingDt)*(g.boost?.towerId===t.id?1.8:1);damageEnemy(g,e,amount,'magic',0,t.id);b.charge=Math.min(s.beamRampSeconds,b.charge+firingDt);
  const row=g.stats.towerDamage[t.id];row.beamSeconds=(row.beamSeconds||0)+firingDt;if(e.hp<=0)row.beamKills=(row.beamKills||0)+1;
  if(e.family==='grok'||e.type==='grok'){row.beamGrokSeconds=(row.beamGrokSeconds||0)+firingDt;row.beamGrokDamage=(row.beamGrokDamage||0)+Math.min(before,Math.max(0,before-e.hp));if(e.hp<=0)row.beamGrokKills=(row.beamGrokKills||0)+1;}
 }
}
