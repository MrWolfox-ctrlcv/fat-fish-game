import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAutoRecovery } from '../backend/auto-recovery.mjs';
import { GameStore } from '../backend/store.mjs';
import { createGameServer } from '../backend/app.mjs';
import { initialState, replayCheckpoint } from '../backend/replay.mjs';
import { PHYSICS_VERSION } from '../dist/physics-version.js';

test('automatic recovery retains real progress across empty refreshes, deduplicates and expires without charging',()=>{
  const db=new DatabaseSync(':memory:');let time=1000;
  try{const auto=createAutoRecovery(db,{now:()=>time,maxOwners:2});
    const run={id:'original',state:initialState(1,2),moves:1,hash:'a'};
    const first=auto.save('u:1',run);time+=1000;
    assert.deepEqual({...auto.save('u:1',run)},first);
    for(let i=0;i<10;i++)auto.save('u:1',{...run,id:'empty'+i,moves:0});
    assert.equal(auto.get('u:1').token,first.token);
    assert.equal(auto.get('u:2',first.token),null);
    assert.ok(db.prepare('SELECT count(*) AS n FROM auto_recovery').get().n<=4);
    auto.save('u:2',{...run,id:'two'});
    assert.throws(()=>auto.save('u:3',run),{code:'AUTO_CAPACITY'});
    time+=86400001;assert.equal(auto.get('u:1'),null);
    const renewed=auto.save('u:1',run);assert.notEqual(renewed.token,first.token);assert.ok(renewed.expires>time);
    time+=86400001;auto.cleanup();assert.equal(auto.metadata('u:1').exists,false);
  }finally{db.close();}
});

async function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'fish-auto-')),path=join(dir,'game.sqlite');let store,app,time=Date.now(),charges=0;
  const start=async()=>{store=new GameStore(path);app=await createGameServer({store,now:()=>time,
    propWallet:{enabled:true,debit:async()=>{charges++;}},
    fetchImpl:async(_url,options)=>Response.json({success:true,data:{id:Number(options.headers.Authorization.split('-').at(-1)),role:1,username:'test'}})});
    await new Promise(r=>app.server.listen(0,'127.0.0.1',r));};
  const stop=async()=>{const p=new Promise(r=>app.server.close(r));app.server.closeAllConnections();await p;store.close();};
  await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
  const call=async(path,input,user=42,cookie)=>{const r=await fetch(`http://127.0.0.1:${app.server.address().port}/games/fat-fish/`+path,{
    method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer auto-test-'+user}:{}),...(cookie?{Cookie:cookie}:{})},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  return {call,advance:n=>time+=n,restart:async()=>{await stop();await start();},charges:()=>charges,getStore:()=>store};
}

test('server restart and an unacknowledged checkpoint recover the exact journal, RNG and account ownership',async t=>{
  const f=await fixture(t),started=await f.call('api/run',{physics_version:PHYSICS_VERSION}),run=started.body.run;
  f.advance(5000);const moves=[{step:0,x:200},{step:60,x:270}],payload={run_id:run.id,step:120,moves};
  const checked=await f.call('api/run/checkpoint',payload);assert.equal(checked.status,200);
  const expected=replayCheckpoint(initialState(run.seed,run.variant_seed),moves,120);
  await f.restart();
  const wrong=await f.call('api/autosave/load',{physics_version:PHYSICS_VERSION,token:run.autosave_token,step:120,moves},7);
  assert.equal(wrong.status,404);
  const restored=await f.call('api/autosave/load',{physics_version:PHYSICS_VERSION,token:run.autosave_token,step:120,moves});
  assert.equal(restored.status,200,JSON.stringify(restored.body));
  for(const key of ['bodies','score','randomState','variantState','stepIndex'])assert.deepEqual(restored.body.state[key],expected.state[key]);
  assert.equal(f.charges(),0);
  const impossible=await f.call('api/autosave/load',{physics_version:PHYSICS_VERSION,token:restored.body.autosave.token,step:999999,moves:[]});
  assert.equal(impossible.status,422);assert.equal((await f.call('api/autosave')).body.autosave.exists,true);
});

test('restoring an older automatic base preserves committed paid props and their leaderboard label, with no extra debit',async t=>{
  const f=await fixture(t),started=await f.call('api/run',{physics_version:PHYSICS_VERSION}),run=started.body.run;
  f.advance(3000);assert.equal((await f.call('api/run/checkpoint',{run_id:run.id,step:60,moves:[{step:0,x:220}]})).status,200);
  const pre=(await f.call('api/autosave')).body.autosave;
  const state=replayCheckpoint(initialState(run.seed,run.variant_seed),[{step:0,x:220}],60).state;
  const paid=await f.call('api/run/prop',{run_id:run.id,step:60,moves:[],request_id:'auto-paid-remove-001',kind:'remove',body_ids:[state.bodies[0].id],confirm_quota:5000});
  assert.equal(paid.status,200,JSON.stringify(paid.body));assert.equal(f.charges(),1);
  await f.restart();
  const recovered=await f.call('api/autosave/load',{physics_version:PHYSICS_VERSION,token:pre.token,step:60,moves:[]});
  assert.equal(recovered.status,200,JSON.stringify(recovered.body));assert.equal(recovered.body.tail_discarded,true);
  assert.deepEqual(recovered.body.state.bodies,paid.body.state.bodies);assert.equal(f.charges(),1);
  assert.equal(f.getStore().lineageUsedProps(42,run.id),true);
  const marker=f.getStore().db.prepare('SELECT 1 AS present FROM weekly_prop_runs WHERE user_id=42 AND run_id=?').get(run.id);assert.equal(marker.present,1);
});

test('guest recovery uses an HttpOnly cookie owner and does not expose another guest or authenticated account',async t=>{
  const f=await fixture(t),start=await f.call('api/play/run',{physics_version:PHYSICS_VERSION},null),run=start.body.run;
  assert.equal(start.status,200);assert.ok(start.cookie);
  f.advance(2000);const check=await f.call('api/play/checkpoint',{run_id:run.id,step:60,moves:[{step:0,x:230}]},null,start.cookie);assert.equal(check.status,200);
  await f.restart();
  assert.equal((await f.call('api/play/autosave/load',{physics_version:PHYSICS_VERSION,token:check.body.autosave.token},null)).status,404);
  const restored=await f.call('api/play/autosave/load',{physics_version:PHYSICS_VERSION},null,start.cookie);
  assert.equal(restored.status,200,JSON.stringify(restored.body));assert.equal(restored.body.run.guest,true);assert.equal(restored.body.state.bodies.length,1);assert.equal(f.charges(),0);
});
