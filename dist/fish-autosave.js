import { serializeGameState } from './fish-saves-ui.js';
import { PHYSICS_VERSION } from './physics-version.js';

export function createFishAutosave({account,guest,getGame,getRun,getJournal,getBase,getBlocked,client,apply,lockChanged=()=>{},storage}){
  if(!storage){try{storage=globalThis.localStorage;}catch{storage={getItem:()=>null,setItem:()=>{throw Error('storage unavailable');}};}}
  const status=document.querySelector('#autosave-status'),restoreButton=document.querySelector('#auto-restore'),cloudButton=document.querySelector('#auto-cloud-restore');
  let owner='',local=null,cloud=null,busy=false,pending=null,lastSignature='',lastCloud=null;
  const key=()=>`fat-fish:auto:v1:${account()?'u:'+account().id:'guest'}`;
  function read(){if(owner===key())return;owner=key();local=cloud=null;pending=null;busy=false;lastCloud=null;lastSignature='';lockChanged(false);try{const raw=storage.getItem(owner);if(raw&&raw.length<400000){const saved=JSON.parse(raw);if(saved.version===PHYSICS_VERSION&&saved.expires>Date.now()&&Array.isArray(saved.moves)&&saved.moves.length<=500)local=saved;}}catch{} }
  function render(message=null){
    restoreButton.hidden=!local?.token&&!cloud?.exists;
    cloudButton.hidden=!cloud?.exists||!local?.token;
    restoreButton.disabled=busy;cloudButton.disabled=busy;
    restoreButton.textContent=pending?'重试恢复进度':`恢复上次进度${local?.snapshot?.score!=null?' · '+local.snapshot.score+'分':''}`;
    if(message)status.textContent=message;
    else if(busy)status.textContent='正在核验并恢复进度，不会产生费用。';
    else if(pending)status.textContent='恢复结果待确认，本机记录已保留；请重试同一恢复请求。';
    else if(local)status.textContent=`本机已自动备份${lastCloud?' · 云端 '+new Date(lastCloud).toLocaleTimeString('zh-CN'):' · 云端恢复点保留24小时'}。`;
    else status.textContent='自动备份已开启 · 本机记录＋免费云端恢复点 · 保留24小时，不占手动档位。';
  }
  function capture(){
    read();const run=getRun(),game=getGame(),base=getBase();
    if(busy||pending||!run||!base.token||getBlocked()||(!game.bodies.length&&!game.score&&!getJournal().moves.length))return;
    const journal=getJournal(),step=journal.moves.length||journal.dirty?game.stepIndex:base.step;
    const signature=JSON.stringify([run.id,base.token,step,journal.moves]);if(signature===lastSignature)return;
    const record={version:PHYSICS_VERSION,token:base.token,runId:run.id,step,moves:journal.moves.map(m=>({...m})),snapshot:{...serializeGameState(game),particles:[]},at:Date.now(),expires:Date.now()+86400000};
    try{storage.setItem(owner,JSON.stringify(record));local=record;lastSignature=signature;render();}catch{render('本机空间不足；已核验的云端恢复点仍保留，请检查云端同步状态。');}
  }
  function confirmed(meta){if(meta?.token){lastCloud=meta.updated||Date.now();capture();render();}}
  async function refresh(){read();try{const expected=owner,result=await client.getAutoSave(guest());if(owner!==expected)return;cloud=result.autosave;if(cloud?.exists)lastCloud=cloud.updated_at;render();}catch{render('暂时无法读取云端恢复点，本机备份仍保留。');}}
  async function restore(cloudOnly=false){
    if(busy||getBlocked())return;read();
    if(!pending&&getGame().bodies.length&&!confirm('恢复会替换当前棋盘；自动恢复免费，继续？'))return;
    const expected=owner,isGuest=guest();
    if(!pending||cloudOnly)pending={physics_version:PHYSICS_VERSION,...(!cloudOnly&&local?.token?{token:local.token,step:local.step,moves:local.moves}:cloud?.token?{token:cloud.token}:{})};
    busy=true;lockChanged(true);render();
    try{
      if(!isGuest){const session=await client.getMe();if(!session?.user||`fat-fish:auto:v1:u:${session.user.id}`!==expected)throw Object.assign(Error('账户已变化，请切回原账户恢复。'),{status:401});}
      const result=await client.restoreAutoSave(pending,isGuest);
      if(key()!==expected)throw Object.assign(Error('账户已变化，未覆盖当前棋盘。'),{status:401});
      await apply(result);pending=null;busy=false;lockChanged(false);lastCloud=result.autosave?.updated;lastSignature='';capture();await refresh();render(result.tail_discarded?'已恢复已确认道具后的进度，未回退任何付费标记。':'进度已恢复，自动备份继续保护本局。');
    }catch(e){busy=false;if([401,404,409,422].includes(e.status)){pending=null;lockChanged(false);render((e.message||'无法恢复本机后续操作。')+' 原记录仍保留，可尝试“恢复云端进度”。');}else{render();}}
  }
  restoreButton.addEventListener('click',()=>void restore(false));cloudButton.addEventListener('click',()=>void restore(true));
  const onHide=()=>{if(document.hidden)capture();};document.addEventListener('visibilitychange',onHide);window.addEventListener('pagehide',capture);
  const timer=setInterval(capture,1000);render();
  return {capture,refresh,confirmed,isLocked:()=>busy||Boolean(pending),close(){clearInterval(timer);document.removeEventListener('visibilitychange',onHide);window.removeEventListener('pagehide',capture);}};
}
