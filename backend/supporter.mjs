import {createHash} from 'node:crypto';

export const SUPPORTER_QUOTA=500000;
export const SUPPORTER_DAYS=30;
const MONTH=SUPPORTER_DAYS*86400000;
const error=(status,message,code)=>Object.assign(new Error(message),{status,code});

export function createSupporter({db,wallet,now=Date.now}){
  db.exec(`CREATE TABLE IF NOT EXISTS supporter_accounts(user_id INTEGER PRIMARY KEY,expires INTEGER NOT NULL,activated INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS supporter_orders(request_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL,action TEXT NOT NULL,quota INTEGER NOT NULL,days INTEGER NOT NULL,prior_expires INTEGER NOT NULL,created INTEGER NOT NULL,receipt TEXT);
    CREATE INDEX IF NOT EXISTS supporter_pending ON supporter_orders(user_id,status);
    CREATE TABLE IF NOT EXISTS supporter_reviews(request_id TEXT PRIMARY KEY,decision TEXT NOT NULL,note TEXT NOT NULL,reference TEXT,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS supporter_daily(request_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,game TEXT NOT NULL,day INTEGER NOT NULL,item TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS supporter_daily_account ON supporter_daily(user_id,game,day);`);
  if(!db.prepare('PRAGMA table_info(supporter_accounts)').all().some(c=>c.name==='activated'))db.exec('ALTER TABLE supporter_accounts ADD COLUMN activated INTEGER NOT NULL DEFAULT 0');
  const extendExisting=(userId,expires)=>{if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_saves'").get())db.prepare('UPDATE game_saves SET expires_at=MAX(expires_at,?) WHERE user_id=? AND slot<=3 AND expires_at>?').run(expires,userId,now());};
  const busy=new Set();
  const order=id=>db.prepare('SELECT * FROM supporter_orders WHERE request_id=?').get(id);
  function daily(userId){const day=Math.floor((now()+8*3600000)/86400000),active=(db.prepare('SELECT expires FROM supporter_accounts WHERE user_id=?').get(userId)?.expires||0)>now();return {day,reset_at:(day+1)*86400000-8*3600000,per_game:2,games:Object.fromEntries(['fat-fish','survivor'].map(game=>{const used=db.prepare('SELECT COUNT(*) AS n FROM supporter_daily WHERE user_id=? AND game=? AND day=?').get(userId,game,day).n;return [game,{used,remaining:active?Math.max(0,2-used):0}];}))};}
  function status(userId){const account=db.prepare('SELECT expires,activated FROM supporter_accounts WHERE user_id=?').get(userId),expires=account?.expires||0;
    return {active:expires>now(),activated_at:account?.activated||null,expires_at:expires||null,slots:3,retention_days:30,days:30,price_usd:'1.00',price_quota:SUPPORTER_QUOTA,billing_enabled:wallet.enabled,
      daily:daily(userId),pending:db.prepare("SELECT request_id,created FROM supporter_orders WHERE user_id=? AND status='pending' LIMIT 1").get(userId)||null};}
  function claimDaily(userId,input){
    if(!input||!/^[a-zA-Z0-9_-]{8,128}$/.test(input.request_id||'')||input.expected_user_id!==userId||!['fat-fish','survivor'].includes(input.game)||!Number.isSafeInteger(input.day))throw error(422,'每日道具请求无效。','INVALID_DAILY');
    const allowed=input.game==='fat-fish'?['remove','merge','swap','pack','revive']:['medkit','supplies','pulse','magnet'];if(!allowed.includes(input.item_id))throw error(422,'该道具不适用。','INVALID_DAILY');
    db.exec('SAVEPOINT daily_claim');try{
      const old=db.prepare('SELECT * FROM supporter_daily WHERE request_id=?').get(input.request_id);
      if(old){if(old.user_id!==userId||old.game!==input.game||old.item!==input.item_id||old.day!==input.day)throw error(409,'免费请求编号已用于其他领取。','DAILY_CONFLICT');db.exec('RELEASE daily_claim');return {request_id:old.request_id,item_id:old.item,quota:0,free_daily:true,expires_at:(old.day+1)*86400000-8*3600000,replayed:true};}
      const rights=status(userId);if(!rights.active)throw error(403,'支持者权益已到期或未开通。','SUPPORTER_REQUIRED');
      if(input.day!==rights.daily.day)throw error(409,'每日次数已经重置，请刷新后重新确认。','DAILY_RESET');
      if(!rights.daily.games[input.game].remaining)throw error(409,'今天的免费次数已用完，不会转为付费。','DAILY_EMPTY');
      db.prepare('INSERT INTO supporter_daily VALUES(?,?,?,?,?,?)').run(input.request_id,userId,input.game,input.day,input.item_id,now());
      db.exec('RELEASE daily_claim');return {request_id:input.request_id,item_id:input.item_id,quota:0,free_daily:true,expires_at:rights.daily.reset_at};
    }catch(e){db.exec('ROLLBACK TO daily_claim; RELEASE daily_claim');throw e;}
  }
  function transact(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
  function commit(row,reference){return transact(()=>{
    const current=order(row.request_id);if(current.status==='committed')return JSON.parse(current.receipt);
    if(current.status!=='pending')throw error(409,'该订单已关闭。','ORDER_CLOSED');
    // A delayed verified debit still receives a full month; never shorten an existing term.
    const expires=Math.max(now(),current.prior_expires,status(current.user_id).expires_at||0)+MONTH;
    db.prepare('INSERT INTO supporter_accounts(user_id,expires,activated) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET expires=MAX(expires,excluded.expires),activated=excluded.activated').run(current.user_id,expires,now());extendExisting(current.user_id,expires);
    const receipt={request_id:row.request_id,quota:row.quota,days:row.days,expires_at:expires,reference,committed_at:now()};
    db.prepare("UPDATE supporter_orders SET status='committed',receipt=? WHERE request_id=?").run(JSON.stringify(receipt),row.request_id);return receipt;
  });}
  async function buy(userId,input){
    if(!input||!/^[a-f0-9-]{36}$/i.test(input.request_id||'')||input.confirm_quota!==SUPPORTER_QUOTA||input.expected_user_id!==userId||!['buy','renew'].includes(input.action))throw error(422,'请确认 $1 和支持者方案。','INVALID_SUPPORTER');
    const fp=createHash('sha256').update(JSON.stringify({userId,quota:SUPPORTER_QUOTA,action:input.action,days:30,slots:3})).digest('hex');
    const previous=order(input.request_id);
    if(previous){if(previous.user_id!==userId||previous.fingerprint!==fp)throw error(409,'订单编号已用于其他操作。','ORDER_CONFLICT');if(previous.status==='pending')return {pending:true,request_id:previous.request_id};if(previous.status==='failed')throw error(409,'订单已关闭。','ORDER_CLOSED');return {receipt:JSON.parse(previous.receipt),replayed:true,supporter:status(userId)};}
    if(busy.has(userId)||status(userId).pending)throw error(409,'上一笔支持者订单仍在处理或核对。','PAYMENT_PENDING');
    const rights=status(userId);
    if(rights.active&&input.action!=='renew')throw error(409,'已拥有支持者权益，请明确选择续期。','ALREADY_OWNED');
    if(!rights.active&&input.action==='renew')throw error(409,'权益已到期，请重新购买。','NOT_ACTIVE');
    if((rights.expires_at||0)>now()+60*86400000)throw error(409,'当前权益已超过两个月，暂不继续预购。','RETENTION_LIMIT');
    if(!wallet.enabled)throw error(503,'支持者购买暂未开放。','BILLING_DISABLED');
    busy.add(userId);
    try{
      db.prepare("INSERT INTO supporter_orders VALUES(?,?,?,'pending',?,?,30,?,?,NULL)").run(input.request_id,userId,fp,input.action,SUPPORTER_QUOTA,Math.max(now(),rights.expires_at||0),now());
      let payment;
      try{payment=await wallet.debit({userId,quota:SUPPORTER_QUOTA,operationId:input.request_id});}
      catch(e){if(e.code==='PAYMENT_PENDING')return {pending:true,request_id:input.request_id};db.prepare("UPDATE supporter_orders SET status='failed' WHERE request_id=?").run(input.request_id);throw e;}
      const receipt=commit(order(input.request_id),payment.reference);return {receipt,supporter:status(userId)};
    }finally{busy.delete(userId);}
  }
  function review(input){
    const row=order(input?.request_id);if(!row||row.user_id!==input.user_id||input.quota!==SUPPORTER_QUOTA)throw error(422,'订单账户或额度不匹配。','REVIEW_INVALID');
    if(!['paid','unpaid'].includes(input.decision)||typeof input.note!=='string'||input.note.trim().length<8||input.note.length>1000)throw error(422,'需要明确决定及证据备注。','REVIEW_INVALID');
    const previous=db.prepare('SELECT decision FROM supporter_reviews WHERE request_id=?').get(row.request_id);
    if(previous){if(previous.decision!==input.decision)throw error(409,'该订单已按相反决定处理。','REVIEW_CONFLICT');return {replayed:true,supporter:status(row.user_id)};}
    if(row.status!=='pending'||busy.has(row.user_id))throw error(409,'仅能复核不在处理中的待核对订单。','REVIEW_CONFLICT');
    if(input.decision==='paid'&&(typeof input.reference!=='string'||input.reference.length<3||input.reference.length>200))throw error(422,'需要真实扣款凭证编号。','REVIEW_INVALID');
    // Run the grant and audit in a single outer transaction using a savepoint.
    db.exec('SAVEPOINT supporter_review');
    try{
      let receipt;
      if(input.decision==='paid'){
        // commit() is transaction-owning, so perform the same idempotent grant inline.
        const expires=Math.max(now(),row.prior_expires,status(row.user_id).expires_at||0)+MONTH;
        db.prepare('INSERT INTO supporter_accounts(user_id,expires,activated) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET expires=MAX(expires,excluded.expires),activated=excluded.activated').run(row.user_id,expires,now());extendExisting(row.user_id,expires);
        receipt={request_id:row.request_id,quota:row.quota,days:30,expires_at:expires,reference:input.reference,committed_at:now()};
        db.prepare("UPDATE supporter_orders SET status='committed',receipt=? WHERE request_id=?").run(JSON.stringify(receipt),row.request_id);
      }else db.prepare("UPDATE supporter_orders SET status='failed' WHERE request_id=?").run(row.request_id);
      db.prepare('INSERT INTO supporter_reviews VALUES(?,?,?,?,?)').run(row.request_id,input.decision,input.note.trim(),input.reference||null,now());
      db.exec('RELEASE supporter_review');return {receipt,supporter:status(row.user_id)};
    }catch(e){db.exec('ROLLBACK TO supporter_review; RELEASE supporter_review');throw e;}
  }
  return {status,buy,review,claimDaily};
}

export function createSupporterReader({fetchImpl=fetch,base='http://127.0.0.1:4180/games/fat-fish/api/supporter',now=Date.now,enabled=true}={}){
  const endpoint=new URL(base);if(!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.protocol!=='http:')throw Error('Supporter source must be a loopback HTTP service');
  const cache=new Map();
  return async function read(user,authorization,force=false){
    if(!enabled)return {active:false};
    const key=createHash('sha256').update(`${user.id}:${authorization}`).digest('hex'),prior=cache.get(key);
    if(!force&&prior&&prior.until>now())return {...prior.value,active:prior.value.expires_at>now()};
    let data;try{const r=await fetchImpl(endpoint,{headers:{Authorization:authorization,Accept:'application/json'},signal:AbortSignal.timeout(3000),redirect:'error'});data=await r.json();if(!r.ok||!data.success||data.user_id!==user.id||typeof data.supporter?.active!=='boolean'||(data.supporter.expires_at!==null&&!Number.isFinite(data.supporter.expires_at)))throw Error('invalid response');}catch{throw error(503,'暂时无法核验支持者权益，未保存也未扣款，请稍后重试。','SUPPORTER_UNAVAILABLE');}
    if(data.supporter.active){if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,{until:now()+15000,value:data.supporter});}return data.supporter;
  };
}

export async function claimSharedDaily({userId,authorization,input,fetchImpl=fetch,endpoint='http://127.0.0.1:4180/games/fat-fish/api/supporter'}){
  const url=new URL(endpoint);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw error(503,'权益源配置无效。','DAILY_UNAVAILABLE');url.pathname+='/daily';
  let response,data;try{response=await fetchImpl(url,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({expected_user_id:userId,request_id:input.request_id,game:'survivor',day:input.day,item_id:input.item_id}),signal:AbortSignal.timeout(3000),redirect:'error'});data=await response.json();}catch{throw error(202,'免费领取结果待确认，请用同一请求重试。','DAILY_PENDING');}
  if(!response.ok||!data.success){if(response.status>=500)throw error(202,'免费领取结果待确认。','DAILY_PENDING');throw error(response.status,data.message||'不能领取今日道具。',data.code||'DAILY_REFUSED');}
  if(data.receipt?.request_id!==input.request_id||data.receipt.item_id!==input.item_id||data.receipt.quota!==0||!Number.isFinite(data.receipt.expires_at))throw error(202,'免费领取结果待确认。','DAILY_PENDING');
  return data.receipt;
}
