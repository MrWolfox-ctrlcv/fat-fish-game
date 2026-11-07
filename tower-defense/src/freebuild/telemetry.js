import {getLevel} from './levels.js';
export const BALANCE_VERSION=12;
const round=n=>Math.round((n||0)*100)/100;
export function towerSummary(g,t){const d=g.stats.towerDamage?.[t.id]||{};return {id:t.id,type:t.type,level:t.level,branch:t.branch||'',tech:{...t.tech},cellX:t.cellX,cellY:t.cellY,spent:t.spent,physical:round(d.physical),magic:round(d.magic),beamSeconds:round(d.beamSeconds),beamContacts:d.beamContacts||0,beamKills:d.beamKills||0,beamGrokSeconds:round(d.beamGrokSeconds),beamGrokDamage:round(d.beamGrokDamage),beamGrokKills:d.beamGrokKills||0,coupon:!!t.coupon,rallyX:round(t.rally?.x),rallyY:round(t.rally?.y)};}
export function towerSnapshot(g,full=true){return {stage:getLevel(g.levelId).order,difficulty:g.difficulty||'normal',map:getLevel(g.levelId).map,wave:g.wave,phase:g.phase,seconds:round(g.time),gold:round(g.gold),earned:round(g.stats.earned),spent:round(g.stats.spent),productionSpent:round(g.stats.productionSpent),unitLosses:g.stats.unitLosses||0,lives:g.lives,kills:g.stats.kills,earlyGold:g.stats.earlyGold,bombards:g.stats.bombards,physical:round(g.stats.physical),magic:round(g.stats.magic),alive:g.enemies.length,queued:g.spawnQueue.length,allies:g.allies.length,speed:g.speed,paused:!!g.paused,...(full?{towers:g.towers.map(t=>towerSummary(g,t)),waves:Object.values(g.stats.waveMetrics||{}).map(row=>({...row,remainingHp:round(row.remainingHp),threat:round(row.threat),peakHp:round(row.peakHp),peakThreat:round(row.peakThreat),furthest:row.furthest.map(n=>round(n*100))}))}:{})};}
export function createTowerTelemetry({getGame,enabled,presenceEnabled=enabled,fetchImpl=globalThis.fetch?.bind(globalThis),storage=globalThis.localStorage,windowRef=globalThis.window,documentRef=globalThis.document}){
 let player;try{player=storage.getItem('oua.tower.analysis-id');if(!player){player=crypto.randomUUID();storage.setItem('oua.tower.analysis-id',player);}}catch{player=crypto.randomUUID();}
 let game=null,prior=null,queue=[],busy=false,lastSample=0,ended=false;
 const active=()=>enabled()&&!documentRef?.hidden;
 const emit=(kind,extra={},full=false)=>{if(!game||!enabled())return;if(queue.length>=180)queue.shift();queue.push({id:crypto.randomUUID(),run:game.analysisRun,game:'tower-defense',kind,balance:BALANCE_VERSION,td:{...towerSnapshot(game,full),...extra}});};
 async function flush(beacon=false){if(!enabled()){queue=[];return;}if(busy||!queue.length)return;
  let events=[];while(queue.length&&events.length<12){const item=queue[0];if(events.length&&JSON.stringify({player,events:[...events,item]}).length>44000)break;events.push(queue.shift());}
  const body=JSON.stringify({player,events});if(beacon&&windowRef?.navigator?.sendBeacon){if(windowRef.navigator.sendBeacon('/games/fat-fish/api/telemetry',new Blob([body],{type:'application/json'})))return;}
  if(!fetchImpl)return;busy=true;try{const response=await fetchImpl('/games/fat-fish/api/telemetry',{method:'POST',credentials:'omit',keepalive:true,headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(4000)});if(!response.ok&&response.status>=500)queue.unshift(...events);}catch{queue.unshift(...events);}finally{busy=false;if(queue.length>180)queue=queue.slice(-180);}
 }
 function poll(){if(!active())return;const current=getGame();if(!current)return;
  if(current!==game){if(game&&!ended&&game.wave>0)emit('end',{result:'abandoned'},true);game=current;const resumed=!!game.analysisRun;game.analysisRun??=crypto.randomUUID();prior=null;ended=false;lastSample=game.time;emit(resumed?'resume':'start',{},true);}
  const now={wave:game.wave,lives:game.lives,bombards:game.stats.bombards,early:game.stats.earlyGold,cleared:new Set(game.cleared),towers:new Map(game.towers.map(t=>[t.id,towerSummary(game,t)]))};
  if(prior){for(const [id,t]of now.towers){const old=prior.towers.get(id);if(!old)emit('build',{tower:t});else if(old.level!==t.level||old.branch!==t.branch||JSON.stringify(old.tech)!==JSON.stringify(t.tech))emit('upgrade',{tower:t});else if(old.rallyX!==t.rallyX||old.rallyY!==t.rallyY)emit('rally',{tower:t});}
   for(const [id,t]of prior.towers)if(!now.towers.has(id))emit('sell',{tower:t});
   if(now.wave!==prior.wave)emit('wave-start',{bonus:now.early-prior.early},true);
   for(const wave of now.cleared)if(!prior.cleared.has(wave))emit('wave-end',{clearedWave:wave},true);
   if(now.lives<prior.lives)emit('leak',{baseLost:prior.lives-now.lives},true);
   if(now.bombards>prior.bombards)emit('bombard',{},true);
  }else{for(const t of now.towers.values())if(game.wave===0)emit('build',{tower:t});}
  prior=now;if(!ended&&['won','lost'].includes(game.phase)){emit('end',{result:game.phase},true);ended=true;void flush();}
  if(!ended&&game.time-lastSample>=10){emit('snapshot',{},true);lastSample=game.time;}void flush();
 }
 const heartbeat=()=>{if(!presenceEnabled())return;const current=getGame();fetchImpl?.('/games/fat-fish/api/presence',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sessionId,game:'tower-defense',playing:!!current&&current.phase==='battle'&&!current.paused})}).catch(()=>{});};
 const sessionId=crypto.randomUUID(),timer=setInterval(poll,1000),presenceTimer=setInterval(()=>{if(!documentRef?.hidden)heartbeat();},30000);
 const leave=()=>{if(game&&enabled()){emit('suspend',{},true);void flush(true);}if(!presenceEnabled())return;windowRef?.navigator?.sendBeacon?.('/games/fat-fish/api/presence',new Blob([JSON.stringify({session_id:sessionId,leave:true})],{type:'application/json'}));};
 const visibility=()=>{if(documentRef.hidden)leave();else heartbeat();};
 windowRef?.addEventListener('pagehide',leave);documentRef?.addEventListener('visibilitychange',visibility);if(active())heartbeat();
 return {poll,flush,close(){clearInterval(timer);clearInterval(presenceTimer);windowRef?.removeEventListener('pagehide',leave);documentRef?.removeEventListener('visibilitychange',visibility);queue=[];}};
}
