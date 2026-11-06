import {getMap} from './levels.js';
export function recordTowerDamage(g,id,amount,type){if(!id||amount<=0)return;const all=g.stats.towerDamage??={},row=all[id]??={physical:0,magic:0};row[type==='magic'?'magic':'physical']+=amount;}
export function measurePressure(g){
 const all=g.stats.waveMetrics??={},routes=getMap(g.levelId).routes;
 for(const row of Object.values(all)){row.alive=0;row.remainingHp=0;row.threat=0;row.lateEnemies=0;}
 for(const e of g.enemies){if(!e.wave)continue;const row=all[e.wave]??={wave:e.wave,alive:0,remainingHp:0,threat:0,lateEnemies:0,peakAlive:0,peakHp:0,peakThreat:0,peakLate:0,furthest:routes.map(()=>0),leaks:0,baseLost:0},progress=Math.min(1,e.progress/routes[e.route].length);
  row.furthest[e.route]=Math.max(row.furthest[e.route],progress);
  if(e.escaped){row.leaks++;row.baseLost+=e.leak;}
  else if(e.hp>0){row.alive++;row.remainingHp+=e.hp;row.threat+=(e.hp/e.maxHp)*e.leak*Math.max(0,2*progress-1);if(progress>=.75)row.lateEnemies++;}
 }
 for(const row of Object.values(all)){row.peakAlive=Math.max(row.peakAlive,row.alive);row.peakHp=Math.max(row.peakHp,row.remainingHp);row.peakThreat=Math.max(row.peakThreat,row.threat);row.peakLate=Math.max(row.peakLate,row.lateEnemies);}
}
