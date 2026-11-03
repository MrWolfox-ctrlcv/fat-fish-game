import { createHash } from 'node:crypto';
import { HEROES as HERO_CONFIG } from '../survival/heroes.js';
import { DIFFICULTIES as DIFFICULTY_CONFIG, CATALOG } from '../survival/engine.js';

const VERSION = 4, WINDOW = 60_000, MAX_MAP = 2_000, RETENTION = 180 * 86_400_000;
const EVENTS = new Set(['run-start', 'round-end', 'choice', 'run-end', 'performance', 'error']);
const HEROES = new Set(Object.keys(HERO_CONFIG));
const DIFFICULTIES = new Set(Object.keys(DIFFICULTY_CONFIG));
const LENGTHS = new Set([5,10,20]);
const CHOICES = new Set(Object.keys(CATALOG));
const FIELDS = ['level', 'kills', 'damageTaken', 'activeSeconds', 'frameMs'];
const LIMITS = { level: [0, 100], kills: [0, 100_000], damageTaken: [0, 10_000_000], activeSeconds: [0, 86_400], frameMs: [0, 60_000] };

function boundedSet(map, key, value, cap = MAX_MAP) {
  if (!map.has(key) && map.size >= cap) map.delete(map.keys().next().value);
  map.set(key, value);
}
function validInt(v, min, max) { return Number.isInteger(v) && v >= min && v <= max; }
function validate(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.eventId !== 'string' || !/^[\w-]{8,80}$/.test(event.eventId) || !EVENTS.has(event.event)) return null;
  const allowed = new Set(['eventId', 'event', 'hero', 'difficulty', 'length', 'round', 'choiceId', 'result', ...FIELDS]);
  if (Object.keys(event).some(key => !allowed.has(key))) return null;
  if (!HEROES.has(event.hero) || !DIFFICULTIES.has(event.difficulty) || !LENGTHS.has(event.length)) return null;
  if (event.round !== undefined && !validInt(event.round, 1, event.length)) return null;
  if (event.choiceId !== undefined && !CHOICES.has(event.choiceId)) return null;
  if(event.result!==undefined&&!['won','lost','abandoned','recovered'].includes(event.result))return null;
  const values = {};
  for (const key of FIELDS) {
    if (event[key] === undefined) continue;
    const [min, max] = LIMITS[key];
    if (typeof event[key] !== 'number' || !Number.isFinite(event[key]) || event[key] < min || event[key] > max) return null;
    values[key] = event[key];
  }
  return { event: event.event, hero: event.hero, difficulty: event.difficulty, length: event.length, round: event.round ?? -1, choiceId: event.choiceId ?? '', result:event.result||'', values };
}

export function createSurvivorMetrics({ db, now = () => Date.now() }) {
  if (!db?.exec || !db?.prepare) throw new TypeError('db must be a SQLite database');
  db.exec(`CREATE TABLE IF NOT EXISTS survivor_metrics_daily (
    day TEXT NOT NULL, version INTEGER NOT NULL, hero TEXT NOT NULL, difficulty TEXT NOT NULL,
    length INTEGER NOT NULL, event TEXT NOT NULL, round INTEGER NOT NULL, choice_id TEXT NOT NULL,result TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0, level_sum REAL NOT NULL DEFAULT 0, kills_sum REAL NOT NULL DEFAULT 0,
    damage_taken_sum REAL NOT NULL DEFAULT 0, active_seconds_sum REAL NOT NULL DEFAULT 0, frame_ms_sum REAL NOT NULL DEFAULT 0,
    PRIMARY KEY(day,version,hero,difficulty,length,event,round,choice_id,result))`);
  const insert = db.prepare(`INSERT INTO survivor_metrics_daily(day,version,hero,difficulty,length,event,round,choice_id,result,count,level_sum,kills_sum,damage_taken_sum,active_seconds_sum,frame_ms_sum)
    VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,?) ON CONFLICT(day,version,hero,difficulty,length,event,round,choice_id,result) DO UPDATE SET count=count+1,level_sum=level_sum+excluded.level_sum,kills_sum=kills_sum+excluded.kills_sum,damage_taken_sum=damage_taken_sum+excluded.damage_taken_sum,active_seconds_sum=active_seconds_sum+excluded.active_seconds_sum,frame_ms_sum=frame_ms_sum+excluded.frame_ms_sum`);
  const sources = new Map(), ids = new Map(); let globalWindow = 0, globalCount = 0, lastCleanup = -Infinity;
  function accept(batch, source) {
    const time = now();
    if (!Array.isArray(batch) || batch.length<1 || batch.length > 12) throw Object.assign(Error('Invalid metrics batch'), { status: 422 });
    if (typeof source !== 'string' || !source || source.length > 512) throw Object.assign(Error('Invalid source'), { status: 422 });
    const events = batch.map(validate);
    if (events.some(x => !x)) throw Object.assign(Error('Invalid metrics event'), { status: 422 });
    const fingerprint = createHash('sha256').update(source).digest('hex');
    const prior = sources.get(fingerprint);
    const sourceCount = prior && time - prior.start < WINDOW ? prior.count : 0;
    if (sourceCount + batch.length > 60 || (time - globalWindow >= WINDOW && (globalWindow = time, globalCount = 0), globalCount + batch.length > 240)) throw Object.assign(Error('Metrics rate limit exceeded'), { status: 429 });
    boundedSet(sources, fingerprint, { start: prior && time - prior.start < WINDOW ? prior.start : time, count: sourceCount + batch.length });
    let accepted = 0;
    db.exec('BEGIN IMMEDIATE');
    try{for (let i = 0; i < batch.length; i++) {
      const raw = batch[i], e = events[i];
      if (ids.has(raw.eventId)) continue;
      boundedSet(ids, raw.eventId, time);
      if (time - lastCleanup >= 86_400_000) {
        db.prepare('DELETE FROM survivor_metrics_daily WHERE day < ?').run(new Date(time - RETENTION).toISOString().slice(0, 10));
        lastCleanup = time;
      }
      const day = new Date(time).toISOString().slice(0, 10), v = e.values;
      insert.run(day, VERSION, e.hero, e.difficulty, e.length, e.event, e.round, e.choiceId,e.result, v.level ?? 0, v.kills ?? 0, v.damageTaken ?? 0, v.activeSeconds ?? 0, v.frameMs ?? 0);
      accepted++; globalCount++;
    }
    db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    return { accepted };
  }
  return Object.freeze({ accept });
}

export function report(db, { from, to } = {}) {
  const clauses = ['version=?'], args = [VERSION];
  if (from) { clauses.push('day>=?'); args.push(from); }
  if (to) { clauses.push('day<=?'); args.push(to); }
  return db.prepare(`SELECT day,version,hero,difficulty,length,event,round,choice_id,result,count,level_sum,kills_sum,damage_taken_sum,active_seconds_sum,frame_ms_sum FROM survivor_metrics_daily WHERE ${clauses.join(' AND ')} ORDER BY day,hero,difficulty,length,event,round,choice_id`).all(...args);
}
