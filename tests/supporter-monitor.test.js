import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createSupporter,createSupporterReader} from '../backend/supporter.mjs';
import {createGameMonitor} from '../backend/game-monitor.mjs';
import {createPresence} from '../backend/presence.mjs';
import {createSurvivorSaves} from '../backend/survivor-saves.mjs';
import {createGame} from '../survival/engine.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('one dollar grants three 30-day slots, retries are idempotent and renewal is explicit',async()=>{
  const db=new DatabaseSync(':memory:');let time=1000000,calls=0;
  const service=createSupporter({db,now:()=>time,wallet:{enabled:true,async debit(input){calls++;assert.equal(input.quota,500000);return {reference:input.operationId};}}});
  try{
    const input={request_id:crypto.randomUUID(),action:'buy',confirm_quota:500000,expected_user_id:7};
    const first=await service.buy(7,input);assert.equal(first.supporter.slots,3);assert.equal(first.supporter.expires_at,time+30*86400000);
    assert.equal((await service.buy(7,input)).replayed,true);assert.equal(calls,1);
    await assert.rejects(service.buy(8,input),{code:'INVALID_SUPPORTER'});
    await assert.rejects(service.buy(7,{...input,request_id:crypto.randomUUID()}),{code:'ALREADY_OWNED'});assert.equal(calls,1);
    const renewed=await service.buy(7,{...input,request_id:crypto.randomUUID(),action:'renew'});assert.equal(renewed.supporter.expires_at,time+60*86400000);assert.equal(calls,2);
    time+=61*86400000;assert.equal(service.status(7).active,false);
  }finally{db.close();}
});

test('unknown supporter debit remains pending; manual review grants only once without recharging',async()=>{
  const db=new DatabaseSync(':memory:');let calls=0;
  const service=createSupporter({db,wallet:{enabled:true,async debit(){calls++;throw Object.assign(Error('uncertain'),{code:'PAYMENT_PENDING'});}}});
  try{
    const input={request_id:crypto.randomUUID(),action:'buy',confirm_quota:500000,expected_user_id:7};assert.equal((await service.buy(7,input)).pending,true);assert.equal((await service.buy(7,input)).pending,true);assert.equal(calls,1);assert.equal(service.status(7).active,false);
    const review={request_id:input.request_id,user_id:7,quota:500000,decision:'paid',note:'已核对测试账单与本次订单流水',reference:'mock-ledger-1'};
    assert.equal(service.review(review).supporter.active,true);const expires=service.status(7).expires_at;assert.equal(service.review(review).replayed,true);assert.equal(service.status(7).expires_at,expires);assert.equal(calls,1);
    assert.throws(()=>service.review({...review,decision:'unpaid'}),{code:'REVIEW_CONFLICT'});
  }finally{db.close();}
});

test('survivor receives shared entitlements and saves its first three slots for 30 days without debit',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'oua-support-'));let charged=0,active=true;
  const app=createSurvivorSaves({dbPath:join(dir,'db.sqlite'),supporterReader:async()=>({active,expires_at:Date.now()+10000}),env:{PROP_WALLET_ENABLED:'0'},fetchImpl:async()=>{charged++;return Response.json({success:true,data:{id:7,status:1}});}});
  async function call(path,payload){let r;await app.handle({method:'POST',headers:{authorization:'Bearer mock-user-7'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(payload));}},{writeHead(s){r={status:s};},end(d){r.body=JSON.parse(d);}},new URL(path,'http://localhost'));return r;}
  try{
    for(let slot=1;slot<=3;slot++){const before=Date.now(),result=await call('/api/saves/write',{slot,version:1,request_id:crypto.randomUUID(),state:createGame()});assert.equal(result.status,200);assert.equal(result.body.supporter_save,true);assert.ok(result.body.expires_at>=before+30*86400000);}
    assert.equal(charged,3);active=false;
    const saved=await call('/api/saves/write',{slot:2,version:1,request_id:crypto.randomUUID(),state:createGame()});assert.equal(saved.body.free_overwrite,true);
    const result=await call('/api/saves/write',{slot:4,version:1,request_id:crypto.randomUUID(),state:createGame()});assert.equal(result.status,402);
  }finally{app.close();rmSync(dir,{recursive:true,force:true});}
});

test('shared entitlement reader checks owner and fails closed when central service is unavailable',async()=>{
  const read=createSupporterReader({fetchImpl:async()=>Response.json({success:true,user_id:7,supporter:{active:true,expires_at:Date.now()+10000}})});
  assert.equal((await read({id:7},'Bearer test')).active,true);
  await assert.rejects(read({id:8},'Bearer other'),{code:'SUPPORTER_UNAVAILABLE'});
});

test('daily freebies reset at Beijing midnight, stay separate per game, and never debit again',async()=>{
  const db=new DatabaseSync(':memory:');let time=Date.UTC(2026,10,2,15,59,59,900),charges=0;
  const service=createSupporter({db,now:()=>time,wallet:{enabled:true,async debit(){charges++;return {reference:'test-only'};}}});
  try{
    await service.buy(7,{request_id:crypto.randomUUID(),action:'buy',confirm_quota:500000,expected_user_id:7});
    const day=service.status(7).daily.day,first={request_id:crypto.randomUUID(),expected_user_id:7,game:'fat-fish',day,item_id:'remove'};
    assert.equal(service.claimDaily(7,first).quota,0);assert.equal(service.claimDaily(7,first).replayed,true);
    service.claimDaily(7,{...first,request_id:crypto.randomUUID()});
    assert.throws(()=>service.claimDaily(7,{...first,request_id:crypto.randomUUID()}),{code:'DAILY_EMPTY'});
    assert.equal(service.status(7).daily.games.survivor.remaining,2);
    time+=200;assert.equal(service.status(7).daily.games['fat-fish'].remaining,2);
    assert.ok(service.claimDaily(7,first).expires_at<=time);assert.equal(service.status(7).daily.games['fat-fish'].used,0);assert.equal(charges,1);
  }finally{db.close();}
});

test('survivor daily delivery retries share the central allowance and expire without accumulating',async()=>{
  const db=new DatabaseSync(':memory:'),dir=mkdtempSync(join(tmpdir(),'oua-daily-'));let time=Date.UTC(2026,10,3,10),calls=0;
  const central=createSupporter({db,now:()=>time,wallet:{enabled:false}});
  db.prepare('INSERT INTO supporter_accounts(user_id,expires,activated) VALUES(7,?,?)').run(time+30*86400000,time);
  const app=createSurvivorSaves({dbPath:join(dir,'db.sqlite'),now:()=>time,supporterReader:async()=>central.status(7),env:{PROP_WALLET_ENABLED:'0'},fetchImpl:async(url,options)=>{
    if(new URL(url).pathname==='/api/user/self')return Response.json({success:true,data:{id:7,status:1}});
    calls++;try{return Response.json({success:true,receipt:central.claimDaily(7,JSON.parse(options.body))});}catch(e){return Response.json({success:false,code:e.code,message:e.message},{status:e.status||500});}
  }});
  const call=async(path,payload={})=>{let r;await app.handle({method:'POST',headers:{authorization:'Bearer test-user-7'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(payload));}},{writeHead(status){r={status};},end(data){r.body=JSON.parse(data);}},new URL(path,'http://localhost'));return r;};
  try{
    const input={request_id:crypto.randomUUID(),item_id:'medkit',confirm_quota:0,day:central.status(7).daily.day};
    assert.equal((await call('/api/shop/free',input)).body.receipt.quota,0);
    assert.equal((await call('/api/shop/free',input)).body.replayed,true);assert.equal(calls,1);
    assert.equal((await call('/api/shop/status')).body.deliveries.length,1);
    time+=86400000;assert.equal((await call('/api/shop/status')).body.deliveries.length,0);
    assert.equal(central.status(7).daily.games.survivor.remaining,2);
  }finally{app.close();db.close();rmSync(dir,{recursive:true,force:true});}
});

test('online samples and detailed upgrades survive database queries without storing raw player IDs',()=>{
  const db=new DatabaseSync(':memory:');let t=100000;const presence=createPresence({now:()=>t}),monitor=createGameMonitor({db,presence,now:()=>t});
  try{
    presence.touch({sessionId:crypto.randomUUID(),game:'survivor'});t+=60000;monitor.sample();
    const player=crypto.randomUUID(),run=crypto.randomUUID(),entry={id:crypto.randomUUID(),run,game:'survivor',kind:'upgrade-pick',hero:'qwen',choice:'damage',rarity:'epic',values:{damage:28,level:4}};
    assert.equal(monitor.ingest({player,events:[entry]}).accepted,1);assert.equal(monitor.ingest({player,events:[entry]}).accepted,0);
    const report=monitor.report();assert.equal(report.current.online,1);assert.equal(report.events[0].summary.damage,28);assert.ok(report.minutes.length>=4);
    const raw=db.prepare('SELECT * FROM game_play_events').get();assert.notEqual(raw.player_key,player);assert.notEqual(raw.run_key,run);
    assert.throws(()=>monitor.ingest({player,events:[{...entry,id:crypto.randomUUID(),values:{chat:'private'}}]}),{status:422});
  }finally{monitor.close();db.close();}
});
