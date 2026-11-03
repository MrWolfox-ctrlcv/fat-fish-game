// Optional, aggregate-only product measurements. Never includes account IDs or text.
export function createAnalytics({endpoint=new URL('./api/metrics',import.meta.url),storage,fetchImpl=globalThis.fetch?.bind(globalThis)}={}){
  try{storage??=globalThis.localStorage;}catch{}
  let enabled=false;try{enabled=storage?.getItem('survivor.analytics-consent.v1')==='1';}catch{}
  const session=crypto.randomUUID();let queue=[],sending=false;
  function setEnabled(value){enabled=value===true;if(!enabled)queue=[];try{storage?.setItem('survivor.analytics-consent.v1',enabled?'1':'0');}catch{}}
  function record(event,game,extra={}){
    if(!enabled||!game)return;
    const entry={eventId:crypto.randomUUID(),event,hero:game.heroId,difficulty:game.difficulty,length:game.maxRounds,round:game.round,...extra};
    if(queue.length>=24)queue.shift();queue.push(entry);
  }
  async function flush(){
    if(!enabled||sending||!queue.length||globalThis.document?.hidden||!fetchImpl)return;
    sending=true;const events=queue.splice(0,12);
    try{await fetchImpl(endpoint,{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,events}),signal:AbortSignal.timeout(4000)});}catch{/* Measurements may be lost; gameplay and transactions never wait. */}finally{sending=false;}
  }
  const timer=setInterval(()=>{void flush();},30000);timer.unref?.();
  return {record,flush,setEnabled,get enabled(){return enabled;},close(){clearInterval(timer);queue=[];}};
}
