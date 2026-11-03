import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSurvivorSaves } from '../backend/survivor-saves.mjs';

const env={PROP_WALLET_ENABLED:'0',NEWAPI_URL:'http://127.0.0.1:3000'};
function fixture({fetchImpl,now=Date.now}={}){
 const dir=mkdtempSync(join(tmpdir(),'survivor-auth-')),dbPath=join(dir,'db.sqlite');
 const app=createSurvivorSaves({supporterReader:async()=>({active:false}),dbPath,env,now,fetchImpl});
 async function call(token){const req={method:'GET',url:'/api/me',headers:{authorization:token},socket:{remoteAddress:'127.0.0.1'}};let out;await app.handle(req,{writeHead(s){out={status:s};},end(b){out.body=JSON.parse(b);}},new URL('http://local/api/me'));return out;}
 return {app,call,close(){app.close();rmSync(dir,{recursive:true,force:true});}};
}
const ok=async()=>Response.json({success:true,data:{id:7,status:1}});

test('token fingerprint throttle happens before upstream auth',async()=>{
 let calls=0;const f=fixture({fetchImpl:async()=>{calls++;return ok();}});
 try {for(let i=0;i<30;i++)assert.equal((await f.call('Bearer token-identical-123')).status,200);assert.equal((await f.call('Bearer token-identical-123')).status,429);assert.equal(calls,30);}
 finally{f.close();}
});

test('distinct tokens behind one loopback proxy do not share a small token bucket',async()=>{
 let calls=0;const f=fixture({fetchImpl:async(_u,o)=>{calls++;return Response.json({success:true,data:{id:7,status:1}});}});
 try {for(let i=0;i<40;i++)assert.equal((await f.call(`Bearer user-token-${i}`)).status,200);assert.equal(calls,40);}
 finally{f.close();}
});

test('upstream auth concurrency is bounded and released after errors',async()=>{
 let active=0,max=0,release;const gate=new Promise(r=>release=r);let entered;const seen=new Promise(r=>entered=r);
 const f=fixture({fetchImpl:async()=>{active++;max=Math.max(max,active);entered();await gate;active--;throw Error('upstream fail');}});
 try {
  const pending=Array.from({length:8},(_,i)=>f.call(`Bearer parallel-token-${i}`));
  await seen;await new Promise(r=>setTimeout(r,20));
  assert.equal(max,8);assert.equal((await f.call('Bearer overflow-token-1')).status,429);
  release();const results=await Promise.all(pending);assert.ok(results.every(x=>x.status===503));
  assert.equal((await f.call('Bearer after-error-token-1')).status,503);assert.equal(max,8);
 } finally{release?.();f.close();}
});
