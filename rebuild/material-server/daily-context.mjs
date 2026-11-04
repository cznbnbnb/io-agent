import {canonical,sha,reject} from './json.mjs';

const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const fields=(v,required,optional=[])=>v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!v.includes('\0');
const time=v=>Number.isSafeInteger(v)&&v>=1000000000000&&v<10000000000000;
const number=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;

/** Read existing official observations. This endpoint never asks a phone to collect location. */
export class DailyContext {
 constructor(store){this.store=store;this.db=store.db;this.db.exec(`CREATE TABLE IF NOT EXISTS daily_context_versions(
  owner TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,date TEXT NOT NULL,timezone TEXT NOT NULL,
  body TEXT NOT NULL,hash TEXT NOT NULL,producer TEXT NOT NULL,stored_at INTEGER NOT NULL,
  PRIMARY KEY(owner,id,revision)) STRICT;CREATE INDEX IF NOT EXISTS daily_context_dates ON daily_context_versions(owner,date);`);}
 head(token,input){const p=this.store.auth(token,'materials:write');if(!fields(input,['id'])||!/^context-[a-f0-9]{64}$/.test(input.id??''))reject(400,'INVALID_DAILY_CONTEXT');
  const row=this.db.prepare('SELECT revision,hash FROM daily_context_versions WHERE owner=? AND id=? ORDER BY revision DESC LIMIT 1').get(p.owner,input.id);
  return{id:input.id,revision:row?.revision??0,hash:row?.hash??null};
 }
 upload(token,input){const p=this.store.auth(token,'materials:write');
  if(!fields(input,['base_revision','source'])||!Number.isSafeInteger(input.base_revision)||input.base_revision<0)reject(400,'INVALID_DAILY_CONTEXT');
  const s=input.source;
  if(!fields(s,['id','date','timezone','origin','coordinate_system','coverage','category','events','trail'])||!/^context-[a-f0-9]{64}$/.test(s.id??'')||!date(s.date)||!text(s.timezone,80)||!s.timezone||s.origin!=='official_lifelog'||s.coordinate_system!=='source_unspecified'||s.coverage!=='source_snapshot'||!['activity','calendar'].includes(s.category)||!Array.isArray(s.events)||s.events.length>3000||!Array.isArray(s.trail)||s.trail.length>20000)reject(400,'INVALID_DAILY_CONTEXT');
  try{new Intl.DateTimeFormat('en',{timeZone:s.timezone});}catch{reject(400,'INVALID_DAILY_CONTEXT');}
  const seen=new Set();for(const e of s.events){
   if(!fields(e,['id','kind','started_at_ms','ended_at_ms','title'],['content','location','poi_name','poi_address','distance_m','travel_mode'])||!text(e.id,160)||!e.id||seen.has(e.id)||!['stayPoint','trajectory','schedule'].includes(e.kind)||(s.category==='calendar')!==(e.kind==='schedule')||!time(e.started_at_ms)||!time(e.ended_at_ms)||e.ended_at_ms<e.started_at_ms||!text(e.title,2000)||['content','location','poi_name','poi_address','travel_mode'].some(k=>e[k]!==undefined&&!text(e[k],16000))||e.distance_m!==undefined&&!number(e.distance_m,0,1e8))reject(400,'INVALID_DAILY_CONTEXT');seen.add(e.id);
  }
  if(s.category==='calendar'&&s.trail.length)reject(400,'INVALID_DAILY_CONTEXT');
  for(const t of s.trail)if(!fields(t,['at_ms','lat_e6','lng_e6','kind','event_id'],['accuracy_m','stay_start_ms','stay_end_ms'])||!time(t.at_ms)||!Number.isSafeInteger(t.lat_e6)||Math.abs(t.lat_e6)>90000000||!Number.isSafeInteger(t.lng_e6)||Math.abs(t.lng_e6)>180000000||!['rawPoint','stayPoint','unknown'].includes(t.kind)||!text(t.event_id,160)||t.accuracy_m!==undefined&&!number(t.accuracy_m,0,1e6)||['stay_start_ms','stay_end_ms'].some(k=>t[k]!==undefined&&!time(t[k]))||t.stay_start_ms!==undefined&&t.stay_end_ms!==undefined&&t.stay_end_ms<t.stay_start_ms)reject(400,'INVALID_DAILY_CONTEXT');
  const body=canonical(s);if(Buffer.byteLength(body)>4*1048576)reject(413,'DAILY_CONTEXT_TOO_LARGE');const hash=sha(body);
  return this.store.tx(()=>{const old=this.db.prepare('SELECT * FROM daily_context_versions WHERE owner=? AND id=? ORDER BY revision DESC LIMIT 1').get(p.owner,s.id);
   if(old?.hash===hash)return{id:s.id,revision:old.revision,hash,server_stored:true,unchanged:true};
   if((old?.revision??0)!==input.base_revision)reject(409,'DAILY_CONTEXT_CONFLICT');
   if(old&&(old.date!==s.date||old.timezone!==s.timezone))reject(409,'DAILY_CONTEXT_IDENTITY_CONFLICT');
   const revision=(old?.revision??0)+1;this.db.prepare('INSERT INTO daily_context_versions VALUES (?,?,?,?,?,?,?,?,?)').run(p.owner,s.id,revision,s.date,s.timezone,body,hash,p.producer,this.store.clock());
   return{id:s.id,revision,hash,server_stored:true,unchanged:false};
  });
 }
 query(owner,{from,to,include_points=false,limit=31,cursor}={}){
  const filter=sha(canonical({from:from??null,to:to??null,include_points})),now=this.store.clock();
  const offset=cursor?this.store.cursor(cursor,owner,'daily-context',filter,()=>Number.MAX_SAFE_INTEGER).last:0;
  const rows=this.db.prepare(`SELECT d.* FROM daily_context_versions d JOIN (SELECT id,MAX(revision) revision FROM daily_context_versions WHERE owner=? GROUP BY id) h ON h.id=d.id AND h.revision=d.revision WHERE d.owner=? AND (? IS NULL OR d.date>=?) AND (? IS NULL OR d.date<=?) ORDER BY d.date DESC,d.id LIMIT ? OFFSET ?`).all(owner,owner,from??null,from??null,to??null,to??null,limit+1,offset);
  const page=rows.slice(0,limit),items=page.map(r=>{const s=JSON.parse(r.body);return{...s,revision:r.revision,stored_at:new Date(r.stored_at).toISOString(),point_count:s.trail.length,trail:include_points?s.trail:undefined,unavailable_metrics:['step_count','calories'],calendar_represents:'planned_events_not_attendance'};});
  if(Buffer.byteLength(JSON.stringify(items))>8*1048576)reject(413,'DAILY_CONTEXT_NARROW_RANGE');
  const hasMore=rows.length>limit;
  return{items,has_more:hasMore,next_cursor:hasMore?this.store.signCursor({v:1,owner,kind:'daily-context',filter,last:offset+page.length,ceiling:Number.MAX_SAFE_INTEGER,expires:now+3600000}):null,coverage:'server_stored_official_observations',coordinate_system:'source_unspecified',details_command:'daily-context',audio_available:false};
 }
 read(token,input){const p=this.store.auth(token,'lifelog:read');
  if(!fields(input,[],['date','from','to','include_points','limit','cursor'])||input.date!==undefined&&(!date(input.date)||input.from!==undefined||input.to!==undefined)||[input.from,input.to].some(v=>v!==undefined&&!date(v))||input.from&&input.to&&input.from>input.to||input.include_points!==undefined&&typeof input.include_points!=='boolean'||input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>31)||input.cursor!==undefined&&!text(input.cursor,4096))reject(400,'INVALID_QUERY');
  return this.query(p.owner,{...input,...(input.date?{from:input.date,to:input.date}:{})});
 }
}
