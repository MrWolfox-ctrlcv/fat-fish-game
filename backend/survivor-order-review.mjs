import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { SHOP_ITEMS } from '../survival/shop-items.js';

// Offline operator tool. Verify the wallet ledger first; this tool never debits.
export function reviewSurvivorOrder({dbPath,requestId,decision,note,reference,userId,quota,dryRun=true,now=Date.now}) {
  if(!existsSync(dbPath))throw Error('数据库不存在，拒绝创建空数据库。');
  const db=new DatabaseSync(dbPath,{readOnly:dryRun});
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const get=()=>db.prepare('SELECT * FROM survivor_orders WHERE request_id=?').get(requestId);
    let row=get();if(!row)throw Error('订单不存在。');
    const summary=r=>({request_id:r.request_id,user_id:r.user_id,status:r.status,kind:r.kind,slot:r.slot,created:r.created,product:r.product_snapshot?JSON.parse(r.product_snapshot):null});
    if(!decision)return summary(row);
    if(!['paid','unpaid'].includes(decision)||typeof note!=='string'||note.trim().length<8||note.length>1000)throw Error('需要 paid/unpaid 决定及至少 8 字的证据备注。');
    if(userId!==row.user_id||quota!==5000)throw Error('必须明确确认订单账户和 5000 quota。');
    if(decision==='paid'&&(typeof reference!=='string'||reference.trim().length<3||reference.length>200))throw Error('确认已扣款必须填写可核对的付款凭证 reference。');
    const product=row.product_snapshot?JSON.parse(row.product_snapshot):null;
    if(decision==='paid'){
      if(!product||product.version!==1||product.quota!==5000||product.quantity!==1)throw Error('缺少可信商品快照，须先人工查证，不能自动补发。');
      if(row.kind==='shop'&&!Object.values(SHOP_ITEMS).some(i=>i.id===product.id))throw Error('商品已无法识别，不能自动补发。');
      if(!['shop','write','extend'].includes(row.kind))throw Error('订单类型无法补发。');
      if(row.kind!=='shop'&&row.status==='pending'&&(!row.snapshot||row.slot<1||row.slot>5))throw Error('缺少原存档，不能补发。');
    }
    if(dryRun)return {...summary(row),dry_run:true,decision};
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('CREATE TABLE IF NOT EXISTS survivor_order_reviews(request_id TEXT PRIMARY KEY,decision TEXT NOT NULL,note TEXT NOT NULL,reference TEXT,created_at INTEGER NOT NULL)');
      row=get();
      const previous=db.prepare('SELECT * FROM survivor_order_reviews WHERE request_id=?').get(requestId);
      if(previous){if(previous.decision!==decision)throw Error('订单已按相反决定处理。');db.exec('COMMIT');return {...summary(row),replayed:true};}
      if(row.status!=='pending')throw Error('只允许复核 pending 订单。');
      let receipt=null;
      if(decision==='paid'){
        const t=now();
        if(row.kind!=='shop'){
          const current=db.prepare('SELECT * FROM survivor_saves WHERE user_id=? AND slot=?').get(row.user_id,row.slot);
          if(current&&current.updated>row.created)throw Error('档位已有较新的数据，拒绝覆盖，请人工处理。');
          if(row.kind==='extend'&&!Number.isFinite(row.prior_expires))throw Error('续期缺少原到期时间。');
          const expires=Math.max(t,row.kind==='extend'?row.prior_expires:0)+7*86400000;
          db.prepare('INSERT INTO survivor_saves(user_id,slot,snapshot,updated,expires,paid) VALUES(?,?,?,?,?,1) ON CONFLICT(user_id,slot) DO UPDATE SET snapshot=excluded.snapshot,updated=excluded.updated,expires=excluded.expires,paid=1').run(row.user_id,row.slot,row.snapshot,t,expires);
        }
        receipt={request_id:row.request_id,...(row.kind==='shop'?{item_id:product.id}:{}),quota:product.quota,committed_at:t,reference:reference.trim(),manual_review:true};
      }
      db.prepare("UPDATE survivor_orders SET status=?,receipt=?,review_note=?,snapshot=NULL WHERE request_id=? AND status='pending'").run(decision==='paid'?'committed':'failed',receipt?JSON.stringify(receipt):null,note.trim(),requestId);
      db.prepare('INSERT INTO survivor_order_reviews(request_id,decision,note,reference,created_at) VALUES(?,?,?,?,?)').run(requestId,decision,note.trim(),reference||null,now());
      db.exec('COMMIT');return {...summary(get()),reviewed:true};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }finally{db.close();}
}
