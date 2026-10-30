import { randomUUID, createHash } from 'node:crypto';
import { compactSnapshot, SAVE_MAX_BYTES } from './saves.mjs';

export function createAutoRecovery(db,{now=Date.now,physicsVersion=4,maxOwners=1000}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS auto_recovery (
    token TEXT PRIMARY KEY,owner TEXT NOT NULL,run_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
    meaningful INTEGER NOT NULL,updated INTEGER NOT NULL,expires INTEGER NOT NULL,physics_version INTEGER NOT NULL,payload TEXT NOT NULL,
    UNIQUE(owner,fingerprint));
    CREATE INDEX IF NOT EXISTS auto_recovery_owner ON auto_recovery(owner,updated DESC);
    CREATE INDEX IF NOT EXISTS auto_recovery_expiry ON auto_recovery(expires);`);
  function cleanup(){db.prepare('DELETE FROM auto_recovery WHERE expires<=?').run(now());}
  function save(owner,run){
    const fingerprint=createHash('sha256').update(JSON.stringify([run.id,run.state.stepIndex,run.hash,run.propRevision||0])).digest('hex');
    const prior=db.prepare('SELECT token,updated,expires FROM auto_recovery WHERE owner=? AND fingerprint=?').get(owner,fingerprint);
    if(prior&&prior.expires>now())return prior;
    if(prior)db.prepare('DELETE FROM auto_recovery WHERE owner=? AND fingerprint=?').run(owner,fingerprint);
    if(!db.prepare('SELECT 1 FROM auto_recovery WHERE owner=? LIMIT 1').get(owner)&&db.prepare('SELECT COUNT(DISTINCT owner) AS n FROM auto_recovery').get().n>=maxOwners){cleanup();if(db.prepare('SELECT COUNT(DISTINCT owner) AS n FROM auto_recovery').get().n>=maxOwners)throw Object.assign(Error('自动恢复存储繁忙，本机备份仍保留。'),{status:503,code:'AUTO_CAPACITY'});}
    const state=compactSnapshot(run.state),payload=JSON.stringify({id:run.id,userId:run.userId,username:run.username,lineageId:run.lineageId,weekId:run.weekId,
      state,summary:run.summary,hash:run.hash,moves:run.moves,propRevision:run.propRevision||0,propCount:run.propCount||0,usedProps:Boolean(run.usedProps),guest:Boolean(run.guest)});
    if(Buffer.byteLength(payload)>SAVE_MAX_BYTES)throw Object.assign(Error('自动恢复记录过大，本机备份仍保留。'),{status:413,code:'AUTO_TOO_LARGE'});
    const meaningful=Boolean(run.moves||state.bodies.length||state.score||run.usedProps),token=randomUUID(),updated=now(),expires=updated+86400000;
    db.exec('BEGIN IMMEDIATE');try{
      db.prepare('INSERT INTO auto_recovery VALUES(?,?,?,?,?,?,?,?,?)').run(token,owner,run.id,fingerprint,Number(meaningful),updated,expires,physicsVersion,payload);
      // Keep acknowledged bases for response-loss recovery; never let refreshes
      // of an empty board evict the last real game.
      for(const flag of [0,1])db.prepare(`DELETE FROM auto_recovery WHERE owner=? AND meaningful=? AND token NOT IN (
        SELECT token FROM auto_recovery WHERE owner=? AND meaningful=? ORDER BY updated DESC,rowid DESC LIMIT ?)`)
        .run(owner,flag,owner,flag,3);
      db.exec('COMMIT');return {token,updated,expires};
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function get(owner,token=null){const row=token
    ?db.prepare('SELECT * FROM auto_recovery WHERE owner=? AND token=? AND expires>?').get(owner,token,now())
    :db.prepare('SELECT * FROM auto_recovery WHERE owner=? AND meaningful=1 AND expires>? ORDER BY updated DESC,rowid DESC LIMIT 1').get(owner,now());
    return row&&row.physics_version===physicsVersion?{...row,run:JSON.parse(row.payload)}:null;
  }
  function metadata(owner){const row=get(owner);return row?{exists:true,token:row.token,updated_at:row.updated,expires_at:row.expires,score:row.run.state.score,over:row.run.state.over}: {exists:false};}
  return {save,get,metadata,cleanup};
}
