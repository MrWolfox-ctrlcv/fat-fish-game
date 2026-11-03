import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createSurvivorSaves} from '../backend/survivor-saves.mjs';
import {reviewSurvivorOrder} from '../backend/survivor-order-review.mjs';
import {createGame,applyShopItem} from '../survival/engine.js';

function fixture({uncertain=true}={}){
  const dir=mkdtempSync(join(tmpdir(),'survivor-iteration-')),dbPath=join(dir,'game.sqlite');let charges=0;
  const env={NEWAPI_URL:'http://127.0.0.1:3000',PROP_WALLET_ENABLED:'1',PROP_WALLET_ADMIN_ID:'99',PROP_WALLET_ADMIN_TOKEN:'mock-admin-only'};
  const app=createSurvivorSaves({supporterReader:async()=>({active:false}),dbPath,env,fetchImpl:async(input,options)=>{
    const path=new URL(input).pathname;
    if(path==='/api/user/self')return Response.json({success:true,data:{id:Number(options.headers.Authorization.split('-').at(-1)),status:1}});
    if(path==='/api/user/7')return Response.json({success:true,data:{id:7,status:1,quota:100000}});
    if(path==='/api/user/manage'){charges++;if(uncertain)throw Error('lost response');return Response.json({success:true});}
    throw Error(`Unexpected mock endpoint: ${path}`);
  }});
  async function call(path,payload,user=7,method='POST'){
    const req={method,headers:{authorization:`Bearer test-user-${user}`},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(payload)yield Buffer.from(JSON.stringify(payload));}};
    let result;await app.handle(req,{writeHead(status){result={status};},end(data){result.body=JSON.parse(data);}},new URL(path,'http://localhost'));return result;
  }
  const review=(requestId,decision='paid',extra={})=>reviewSurvivorOrder({dbPath,requestId,decision,userId:7,quota:5000,note:'已人工核对模拟账单及此订单的付款记录',reference:'mock-ledger-reference',dryRun:false,...extra});
  return {dbPath,app,call,review,get charges(){return charges;},close(){app.close();rmSync(dir,{recursive:true,force:true});}};
}

test('real service pending shop keeps product snapshot; review delivers once without a second debit',async()=>{
  const f=fixture();try{
    const input={request_id:crypto.randomUUID(),item_id:'medkit',confirm_quota:5000};
    assert.equal((await f.call('/api/shop/buy',input)).status,202);assert.equal(f.charges,1);
    const before=reviewSurvivorOrder({dbPath:f.dbPath,requestId:input.request_id});assert.equal(before.product.id,'medkit');assert.equal(before.product.quota,5000);
    assert.equal(f.review(input.request_id).status,'committed');assert.equal(f.review(input.request_id).replayed,true);
    assert.equal((await f.call('/api/shop/buy',input)).body.replayed,true);assert.equal(f.charges,1);
    assert.equal((await f.call('/api/shop/status',{})).body.deliveries[0].item_id,'medkit');
    assert.equal((await f.call('/api/shop/status',{},8)).body.deliveries.length,0);
  }finally{f.close();}
});

test('pending save write and extension retain original snapshots and can be fulfilled after expiry',async()=>{
  const f=fixture();try{
    const state=createGame({hero:'qwen'}),write={request_id:crypto.randomUUID(),slot:2,version:1,state,confirm_quota:5000};
    assert.equal((await f.call('/api/saves/write',write)).status,202);
    assert.equal(f.review(write.request_id).status,'committed');
    assert.equal((await f.call('/api/saves/load',{slot:2,campaign_version:3,balance_version:4})).body.state.heroId,'qwen');
    const extension={slot:2,request_id:crypto.randomUUID(),confirm_quota:5000};
    assert.equal((await f.call('/api/saves/extend',extension)).status,202);
    const later=Date.now()+10*86400000;
    assert.equal(f.review(extension.request_id,'paid',{now:()=>later}).status,'committed');
    const db=new DatabaseSync(f.dbPath,{readOnly:true});try{const row=db.prepare('SELECT * FROM survivor_saves WHERE user_id=7 AND slot=2').get();assert.equal(row.expires,later+7*86400000);assert.equal(JSON.parse(row.snapshot).heroId,'qwen');}finally{db.close();}
    assert.equal(f.charges,2);
  }finally{f.close();}
});

test('confirmed unpaid review unlocks future operations without creating a delivery',async()=>{
  const f=fixture();try{
    const request_id=crypto.randomUUID();await f.call('/api/shop/buy',{request_id,item_id:'pulse',confirm_quota:5000});
    f.review(request_id,'unpaid');const status=(await f.call('/api/shop/status',{})).body;
    assert.deepEqual(status.pending,[]);assert.deepEqual(status.deliveries,[]);assert.equal(f.charges,1);
    const free=await f.call('/api/saves/write',{request_id:crypto.randomUUID(),slot:1,version:1,state:createGame()});assert.equal(free.status,200);
  }finally{f.close();}
});

test('acknowledgement archives a recoverable delivery state, is owner-isolated and idempotent',async()=>{
  const f=fixture({uncertain:false});try{
    const request_id=crypto.randomUUID();await f.call('/api/shop/buy',{request_id,item_id:'medkit',confirm_quota:5000});
    const state=createGame();state.player.health=30;applyShopItem(state,'medkit',request_id);
    assert.equal((await f.call('/api/shop/ack',{request_id,state})).status,200);
    const saved=(await f.call('/api/shop/recovery',null,7,'GET')).body.state;assert.equal(saved.player.health,state.player.health);
    assert.equal((await f.call('/api/shop/recovery',null,8,'GET')).status,404);
    state.player.health=1;await f.call('/api/shop/ack',{request_id,state});
    assert.equal((await f.call('/api/shop/recovery',null,7,'GET')).body.state.player.health,saved.player.health);assert.equal(f.charges,1);
  }finally{f.close();}
});

test('acknowledgement refuses a missing receipt lineage and leaves the delivery claimable',async()=>{
  const f=fixture({uncertain:false});try{
    const request_id=crypto.randomUUID();await f.call('/api/shop/buy',{request_id,item_id:'medkit',confirm_quota:5000});
    assert.equal((await f.call('/api/shop/ack',{request_id,state:createGame()})).status,422);
    assert.equal((await f.call('/api/shop/status',{})).body.deliveries.length,1);
  }finally{f.close();}
});
