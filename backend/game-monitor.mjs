import {createHash} from 'node:crypto';
const DAY=86400000,GAMES=new Set(['fat-fish','bumper','survivor']);
const TYPES=new Set(['start','snapshot','upgrade-offer','upgrade-pick','round-end','end','resume']);
const NUMBERS={level:40,round:20,score:1e8,kills:1e6,health:1e5,maxHealth:1e5,damage:1e6,fireRate:100,shots:144,speed:10000,armor:10000,luck:100,energy:1000,compute:1000,xp:1e7,xpNeed:1e7,seconds:14400,fatLevel:30,fatXp:1000,enemyCount:112,rank:6,knockouts:10000,deaths:10000};
const CHOICES=new Set(['damage','fireRate','maxHealth','vampirism','multishot','piercing','crit','speed','magnet','chargeCooldown','fortune','energyGain','energyMax','efficiency','transformedDamage','ricebox','armor','thrust','regen','impact','frost','ricochet','orbit','nova']);
const fault=(status,message)=>Object.assign(Error(message),{status});

export function createGameMonitor({db,presence,now=Date.now}){
  db.exec(`CREATE TABLE IF NOT EXISTS game_monitor_minutes(minute INTEGER NOT NULL,game TEXT NOT NULL,online INTEGER NOT NULL,playing INTEGER NOT NULL,peak_online INTEGER NOT NULL,peak_playing INTEGER NOT NULL,rss INTEGER NOT NULL,uptime INTEGER NOT NULL,PRIMARY KEY(minute,game));
    CREATE TABLE IF NOT EXISTS game_monitor_daily(day INTEGER NOT NULL,game TEXT NOT NULL,peak_online INTEGER NOT NULL,peak_playing INTEGER NOT NULL,samples INTEGER NOT NULL,online_sum INTEGER NOT NULL,playing_sum INTEGER NOT NULL,PRIMARY KEY(day,game));
    CREATE TABLE IF NOT EXISTS game_play_events(id TEXT PRIMARY KEY,player_key TEXT NOT NULL,run_key TEXT NOT NULL,game TEXT NOT NULL,kind TEXT NOT NULL,created INTEGER NOT NULL,summary TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS game_play_events_time ON game_play_events(created);
    CREATE INDEX IF NOT EXISTS game_play_events_run ON game_play_events(run_key,created);`);
  const rateMap=new Map();let lastMinute=-1,lastPrune=-1,window=-1,total=0,lastCap=-1;const peaks={};
  function observe(){const s=presence.stats();for(const[k,v]of Object.entries({all:s,...s.games})){const old=peaks[k]||{online:0,playing:0};peaks[k]={online:Math.max(old.online,v.online),playing:Math.max(old.playing,v.playing)};}}
  function sample(){
    const t=now(),minute=Math.floor(t/60000);if(minute===lastMinute)return;lastMinute=minute;
    observe();const stats=presence.stats(),rows={all:stats,...stats.games},rss=process.memoryUsage().rss,uptime=Math.floor(process.uptime());
    db.exec('BEGIN IMMEDIATE');try{
      for(const [game,n]of Object.entries(rows)){
        db.prepare('INSERT OR REPLACE INTO game_monitor_minutes VALUES(?,?,?,?,?,?,?,?)').run(minute,game,n.online,n.playing,peaks[game].online,peaks[game].playing,rss,uptime);
        db.prepare('INSERT INTO game_monitor_daily VALUES(?,?,?,?,1,?,?) ON CONFLICT(day,game) DO UPDATE SET peak_online=MAX(peak_online,excluded.peak_online),peak_playing=MAX(peak_playing,excluded.peak_playing),samples=samples+1,online_sum=online_sum+excluded.online_sum,playing_sum=playing_sum+excluded.playing_sum').run(Math.floor(t/DAY),game,peaks[game].online,peaks[game].playing,n.online,n.playing);
        peaks[game]={online:n.online,playing:n.playing};
      }
      if(lastPrune!==Math.floor(t/DAY)){
        db.prepare('DELETE FROM game_monitor_minutes WHERE minute<?').run(minute-30*1440);
        db.prepare('DELETE FROM game_monitor_daily WHERE day<?').run(Math.floor(t/DAY)-180);
        db.prepare('DELETE FROM game_play_events WHERE created<?').run(t-30*DAY);lastPrune=Math.floor(t/DAY);
      }
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function ingest(input){
    if(!input||!/^[a-f0-9-]{36}$/i.test(input.player||'')||!Array.isArray(input.events)||input.events.length<1||input.events.length>12)throw fault(422,'游玩数据格式不正确。');
    const t=now(),minute=Math.floor(t/60000),hash=x=>createHash('sha256').update(x).digest('hex');
    const player=hash(input.player);if(window!==minute){window=minute;total=0;}
    const previous=rateMap.get(player),count=previous?.minute===minute?previous.count:0;
    if(total+input.events.length>1200||count+input.events.length>120)throw fault(429,'统计上传过于频繁。');
    const clean=input.events.map(e=>{
      if(!e||!/^[a-f0-9-]{36}$/i.test(e.id||'')||!/^[a-f0-9-]{36}$/i.test(e.run||'')||!GAMES.has(e.game)||!TYPES.has(e.kind))throw fault(422,'游玩事件无效。');
      const summary={};
      if(e.values){if(typeof e.values!=='object'||Array.isArray(e.values))throw fault(422,'属性格式无效。');for(const[k,v]of Object.entries(e.values)){if(!Object.hasOwn(NUMBERS,k)||!Number.isFinite(v)||v<0||v>NUMBERS[k])throw fault(422,'属性超出统计范围。');summary[k]=v;}}
      if(e.hero!==undefined){if(!['deepseek','gpt','gemini','doubao','qwen','kimi','astra'].includes(e.hero))throw fault(422,'角色无效。');summary.hero=e.hero;}
      if(e.difficulty!==undefined){if(!['relaxed','standard','hard'].includes(e.difficulty))throw fault(422,'难度无效。');summary.difficulty=e.difficulty;}
      if(e.length!==undefined){if(![5,10,20].includes(e.length))throw fault(422,'局长无效。');summary.length=e.length;}
      if(e.balance!==undefined){if(!Number.isInteger(e.balance)||e.balance<1||e.balance>100)throw fault(422,'版本无效。');summary.balance=e.balance;}
      if(e.choice!==undefined){if(!CHOICES.has(e.choice))throw fault(422,'升级无效。');summary.choice=e.choice;}
      if(e.rarity!==undefined){if(!['common','rare','epic','legendary'].includes(e.rarity))throw fault(422,'品质无效。');summary.rarity=e.rarity;}
      if(e.result!==undefined){if(!['won','lost','abandoned'].includes(e.result))throw fault(422,'结局无效。');summary.result=e.result;}
      return {id:e.id,run:hash(e.run),game:e.game,kind:e.kind,summary:JSON.stringify(summary)};
    });
    if(rateMap.size>=2048)rateMap.delete(rateMap.keys().next().value);rateMap.set(player,{minute,count:count+clean.length});total+=clean.length;
    db.exec('BEGIN IMMEDIATE');try{
      if(lastCap!==minute){const count=db.prepare('SELECT COUNT(*) AS n FROM game_play_events').get().n;if(count>250000)db.prepare('DELETE FROM game_play_events WHERE id IN(SELECT id FROM game_play_events ORDER BY created LIMIT ?)').run(Math.min(10000,count-249000));lastCap=minute;}
      let accepted=0;const insert=db.prepare('INSERT OR IGNORE INTO game_play_events VALUES(?,?,?,?,?,?,?)');
      for(const e of clean)accepted+=Number(insert.run(e.id,player,e.run,e.game,e.kind,t,e.summary).changes);
      db.exec('COMMIT');return {accepted};
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function report(){sample();return {current:presence.stats(),resources:{rss:process.memoryUsage().rss,uptime_seconds:Math.floor(process.uptime())},minutes:db.prepare('SELECT * FROM game_monitor_minutes WHERE minute>=? ORDER BY minute DESC,game LIMIT 1444').all(Math.floor(now()/60000)-360),daily:db.prepare('SELECT * FROM game_monitor_daily ORDER BY day DESC,game LIMIT 120').all(),events:db.prepare('SELECT id,run_key,game,kind,created,summary FROM game_play_events ORDER BY created DESC LIMIT 200').all().map(e=>({...e,summary:JSON.parse(e.summary)})),totals:db.prepare('SELECT game,kind,COUNT(*) AS count FROM game_play_events GROUP BY game,kind').all()};}
  sample();
  const timer=setInterval(()=>{try{sample();}catch{/* Monitoring must not stop games. */}},60000);timer.unref();
  return {sample,observe,ingest,report,close(){clearInterval(timer);}};
}
