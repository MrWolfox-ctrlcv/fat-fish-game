export function createGameTelemetry({game,getSnapshot=()=>({}),enabled=()=>false,endpoint='/games/fat-fish/api/telemetry',fetchImpl=globalThis.fetch?.bind(globalThis)}={}){
  let player;try{player=localStorage.getItem('oua.game.analysis-id');if(!player){player=crypto.randomUUID();localStorage.setItem('oua.game.analysis-id',player);}}catch{player=crypto.randomUUID();}
  let run=crypto.randomUUID(),queue=[],busy=false;
  function record(kind,extra={}){if(!enabled())return;try{if(queue.length>=48)queue.shift();queue.push({id:crypto.randomUUID(),run,game,kind,...getSnapshot(),...extra});}catch{}}
  async function flush(){if(!enabled()){queue=[];return;}if(busy||!queue.length||globalThis.document?.hidden||!enabled()||!fetchImpl)return;busy=true;const events=queue.splice(0,12);try{await fetchImpl(endpoint,{method:'POST',keepalive:true,credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({player,events}),signal:AbortSignal.timeout(4000)});}catch{}finally{busy=false;}}
  const timer=setInterval(()=>{if(globalThis.document?.hidden)return;record('snapshot');void flush();},30000);timer.unref?.();
  return {record,flush,newRun(id){run=/^[a-f0-9-]{36}$/i.test(id||'')?id:crypto.randomUUID();record('start');},resume(id){run=/^[a-f0-9-]{36}$/i.test(id||'')?id:crypto.randomUUID();record('resume');},close(){clearInterval(timer);queue=[];}};
}
