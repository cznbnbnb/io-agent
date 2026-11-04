import {canonical,sha,reject} from './json.mjs';

const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const stamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/.test(v)&&date(v.slice(0,10));
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const fields=(v,required,optional=[])=>v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const text=(v,max=65536)=>typeof v==='string'&&v.length<=max&&!v.includes('\u0000');
const iso=n=>new Date(n).toISOString();
const DAILY="r.id LIKE 'daily-%' AND json_extract(r.body,'$.source')='agent_analysis' AND json_array_length(r.body,'$.utterances')=0 AND json_extract(r.body,'$.audio.state')='not_retained' AND json_extract(r.body,'$.full_text.text') GLOB '# ????-??-?? 每日 AI 总结*'";

/** Phone observations and Agent edits have independent immutable histories.
 * Only the effective projection is returned by ordinary daily/search reads. */
export class LifelogText {
 constructor(store){this.store=store;this.db=store.db;this.db.exec(`
  CREATE TABLE IF NOT EXISTS lifelog_sources(owner TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,date TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(owner,id)) STRICT;
  CREATE TABLE IF NOT EXISTS lifelog_source_versions(owner TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,producer TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(owner,id,revision)) STRICT;
  CREATE TABLE IF NOT EXISTS lifelog_edits(owner TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,request_id TEXT NOT NULL,digest TEXT NOT NULL,source_revision INTEGER NOT NULL,producer TEXT NOT NULL,agent TEXT NOT NULL,reason TEXT NOT NULL,evidence TEXT NOT NULL,operation TEXT NOT NULL,overlay TEXT NOT NULL,changes TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(owner,id,revision),UNIQUE(owner,request_id)) STRICT;
  CREATE INDEX IF NOT EXISTS lifelog_source_days ON lifelog_sources(owner,date);`);}
 head(token,input){const p=this.store.auth(token,'materials:write');
  if(!fields(input,['id'])||!/^text-[a-f0-9]{64}$/.test(input.id??''))reject(400,'INVALID_LIFELOG_SOURCE');
  const row=this.db.prepare('SELECT v.revision,v.hash FROM lifelog_sources h JOIN lifelog_source_versions v ON v.owner=h.owner AND v.id=h.id AND v.revision=h.revision WHERE h.owner=? AND h.id=?').get(p.owner,input.id);
  return {id:input.id,revision:row?.revision??0,hash:row?.hash??null};
 }
 upload(token,input){const p=this.store.auth(token,'materials:write');
  if(!fields(input,['base_revision','source'])||!integer(input.base_revision))reject(400,'INVALID_LIFELOG_SOURCE');
  const s=input.source;
  if(!fields(s,['id','date','timezone','kind','started_at','ended_at','blocks','related_ids'])||!/^text-[a-f0-9]{64}$/.test(s.id??'')||!date(s.date)||!text(s.timezone,80)||!['segment','transcript'].includes(s.kind)||!stamp(s.started_at)||!stamp(s.ended_at)||Date.parse(s.started_at)>Date.parse(s.ended_at)||!Array.isArray(s.blocks)||!s.blocks.length||s.blocks.length>10002||!Array.isArray(s.related_ids)||s.related_ids.length>256||!s.related_ids.every(id)||new Set(s.related_ids).size!==s.related_ids.length)reject(400,'INVALID_LIFELOG_SOURCE');
  // This is the only boundary that accepts phone text. Audio/location and arbitrary extra fields are rejected.
  const seen=new Set();for(const b of s.blocks){if(!fields(b,['id','kind','text'],['started_at','ended_at','speaker'])||!id(b.id)||seen.has(b.id)||!['title','summary','outline','utterance'].includes(b.kind)||!text(b.text,262144)||b.speaker!==undefined&&!text(b.speaker,80)||b.started_at!==undefined&&!stamp(b.started_at)||b.ended_at!==undefined&&!stamp(b.ended_at))reject(400,'INVALID_LIFELOG_SOURCE');seen.add(b.id);}
  const encoded=canonical(s);if(Buffer.byteLength(encoded)>4*1048576)reject(413,'LIFELOG_SOURCE_TOO_LARGE');
  const hash=sha(encoded);return this.store.tx(()=>{
   const old=this.db.prepare('SELECT v.* FROM lifelog_sources h JOIN lifelog_source_versions v ON v.owner=h.owner AND v.id=h.id AND v.revision=h.revision WHERE h.owner=? AND h.id=?').get(p.owner,s.id);
   if(old?.hash===hash)return {id:s.id,revision:old.revision,hash,server_stored:true,unchanged:true};
   if((old?.revision??0)!==input.base_revision)reject(409,'LIFELOG_SOURCE_CONFLICT',{current_revision:old?.revision??0});
   if(old){const before=JSON.parse(old.body);if(before.kind!==s.kind||before.date!==s.date||before.timezone!==s.timezone)reject(409,'LIFELOG_SOURCE_IDENTITY_CHANGED');}
   const revision=input.base_revision+1;this.db.prepare('INSERT INTO lifelog_source_versions VALUES (?,?,?,?,?,?,?)').run(p.owner,s.id,revision,encoded,hash,p.producer,iso(this.store.clock()));
   this.db.prepare('INSERT INTO lifelog_sources VALUES (?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET revision=excluded.revision').run(p.owner,s.id,revision,s.date,s.kind);
   return {id:s.id,revision,hash,server_stored:true,unchanged:false};
  });
 }
 sources(owner,range={}){
  const from=range.from??'0000-01-01',to=range.to??'9999-12-31';
  const rows=this.db.prepare('SELECT v.* FROM lifelog_sources h JOIN lifelog_source_versions v ON v.owner=h.owner AND v.id=h.id AND v.revision=h.revision WHERE h.owner=? AND h.date>=? AND h.date<=?').all(owner,from,to).map(r=>({...JSON.parse(r.body),source_revision:r.revision,stored_at:r.at}));
  for(const row of this.db.prepare(`SELECT r.* FROM materials m JOIN revisions r ON r.owner=m.owner AND r.id=m.id AND r.revision=m.revision WHERE m.owner=? AND m.deleted=0 AND ${DAILY} AND substr(json_extract(r.body,'$.full_text.text'),3,10)>=? AND substr(json_extract(r.body,'$.full_text.text'),3,10)<=?`).all(owner,from,to)){
   const b=JSON.parse(row.body);rows.push({id:row.id,date:b.full_text.text.slice(2,12),timezone:null,kind:'summary',started_at:b.started_at,ended_at:b.ended_at,blocks:[{id:'summary',kind:'summary',text:b.full_text.text}],related_ids:[],source_revision:row.revision,stored_at:row.stored_at});
  }return rows;
 }
 edits(owner){return new Map(this.db.prepare('SELECT e.* FROM lifelog_edits e JOIN (SELECT id,max(revision) revision FROM lifelog_edits WHERE owner=? GROUP BY id) h ON h.id=e.id AND h.revision=e.revision WHERE e.owner=?').all(owner,owner).map(r=>[r.id,{...r,overlay:JSON.parse(r.overlay)}]));}
 /** A summary is based on its actual recording dependencies; daily summaries cover the whole day. */
 dependencies(source,sources,edits){const dependencies=sources.filter(s=>s.id!==source.id&&s.kind==='transcript'&&(source.kind==='summary'?s.date===source.date:source.related_ids.includes(s.id)));
  return {version:sha(canonical(dependencies.map(s=>[s.id,s.source_revision,edits.get(s.id)?.revision??0]).sort((a,b)=>a[0].localeCompare(b[0])))),edited:dependencies.some(s=>Object.keys(edits.get(s.id)?.overlay.blocks??{}).length>0)};
 }
 effective(owner,source,edit,sources,edits){
  const overlay=edit?.overlay??{blocks:{},notes:[]},conflicts=[],blocks=source.blocks.map(b=>{
   const correction=overlay.blocks[b.id];if(!correction)return b;
   if(b.text!==correction.base_text&&b.text!==correction.text)conflicts.push(b.id);
   return {...b,text:correction.text,corrected:true};
  });
  for(const [key,c] of Object.entries(overlay.blocks))if(!source.blocks.some(b=>b.id===key)){blocks.push({...c.original,text:c.text,corrected:true,source_missing:true});conflicts.push(key);}
  const dependencies=this.dependencies(source,sources,edits),stale=source.kind!=='transcript'&&dependencies.edited&&overlay.based_on!==dependencies.version;
  const visible=stale?blocks.filter(b=>!['summary','outline','title'].includes(b.kind)):blocks;
  return {material_id:source.id,date:source.date,timezone:source.timezone,kind:source.kind,revision:source.source_revision,correction_revision:edit?.revision??0,corrected:Object.keys(overlay.blocks).length>0,needs_review:conflicts.length>0,conflict_blocks:conflicts,summary_stale:stale,dependencies_version:dependencies.version,started_at:source.started_at,ended_at:source.ended_at,stored_at:source.stored_at,blocks:visible,text:visible.map(b=>b.text).join('\n'),notes:overlay.notes,source_ref:{server_id:this.store.devices.serverId(),material_id:source.id,revision:source.source_revision},content_role:'source_data'};
 }
 query(owner,query={},view={}){
  if(!fields(query,[],['from','to','keyword','kind','limit','cursor'])||[query.from,query.to].some(v=>v!==undefined&&!date(v))||query.from&&query.to&&query.from>query.to||query.kind&&!['summary','segment','transcript'].includes(query.kind)||query.keyword!==undefined&&(!text(query.keyword,512)||!query.keyword)||query.cursor!==undefined&&!text(query.cursor,4096))reject(400,'INVALID_QUERY');
  const limit=Number(query.limit??50);if(!Number.isSafeInteger(limit)||limit<1||limit>100)reject(400,'INVALID_QUERY');
  const sources=this.sources(owner,query),edits=this.edits(owner),version=sha(canonical(sources.map(s=>[s.id,s.source_revision,edits.get(s.id)?.revision??0]).sort((a,b)=>a[0].localeCompare(b[0])))),filters={...query};delete filters.cursor;delete filters.limit;
  const hash=sha(canonical({filters,version}));let offset=view.offset??0;
  if(query.cursor){const c=this.store.cursor(query.cursor,owner,'lifelog-text',hash,()=>Number.MAX_SAFE_INTEGER);offset=c.last;}
  const all=sources.filter(s=>(!query.from||s.date>=query.from)&&(!query.to||s.date<=query.to)&&(!query.kind||s.kind===query.kind)).map(s=>this.effective(owner,s,edits.get(s.id),sources,edits)).filter(s=>!query.keyword||[s.text,...s.notes.map(n=>n.text)].join('\n').toLowerCase().includes(query.keyword.toLowerCase())).sort((a,b)=>a.date.localeCompare(b.date)||a.started_at.localeCompare(b.started_at)||a.material_id.localeCompare(b.material_id));
  if(view.descending)all.reverse();
  const items=[];let bytes=8192;for(const full of all.slice(offset,offset+limit)){const item=view.preview?{...full,blocks:undefined,notes:undefined,text:full.text.slice(0,240)}:full;const size=Buffer.byteLength(JSON.stringify(item));if(bytes+size>8*1048576)break;items.push(item);bytes+=size;}
  if(!items.length&&offset<all.length)reject(413,'DAILY_RECORD_TOO_LARGE');
  const hasMore=offset+items.length<all.length,now=this.store.clock();
  return {items,total:all.length,has_more:hasMore,next_cursor:hasMore?this.store.signCursor({v:1,owner,kind:'lifelog-text',filter:hash,last:offset+items.length,ceiling:Number.MAX_SAFE_INTEGER,expires:now+3600000}):null,server_time:iso(now),fresh_until:iso(now),version,coverage:{scope:'server_stored_lifelog_text',phone_sync_status:'unknown',audio_available:false,originals_included:false},complete:!hasMore};
 }
 read(token,query){const owner=this.store.auth(token,'lifelog:read').owner,result=this.query(owner,query);return{...result,context:this.store.dayContext.query(owner,{from:query.from,to:query.to})};}
 history(owner,input){
  if(!fields(input,['material_id'],['before','source_revision'])||!id(input.material_id)||input.source_revision!==undefined&&(!integer(input.source_revision)||input.source_revision<1)||input.before!==undefined&&!integer(input.before))reject(400,'INVALID_CORRECTION');
  const source=this.sources(owner).find(s=>s.id===input.material_id);if(!source)reject(404,'MATERIAL_NOT_FOUND');
  if(input.source_revision!==undefined){const row=source.kind==='summary'?this.db.prepare('SELECT body FROM revisions WHERE owner=? AND id=? AND revision=?').get(owner,source.id,input.source_revision):this.db.prepare('SELECT body FROM lifelog_source_versions WHERE owner=? AND id=? AND revision=?').get(owner,source.id,input.source_revision);if(!row)reject(404,'SOURCE_REVISION_NOT_FOUND');return {original:JSON.parse(row.body),source_revision:input.source_revision,content_role:'source_data'};}
  const rows=this.db.prepare('SELECT * FROM lifelog_edits WHERE owner=? AND id=? AND revision<? ORDER BY revision DESC LIMIT 51').all(owner,source.id,input.before??Number.MAX_SAFE_INTEGER);
  const items=[];let bytes=Buffer.byteLength(JSON.stringify(source))+4096;for(const r of rows.slice(0,50)){const item={revision:r.revision,source_revision:r.source_revision,agent:r.agent,producer:r.producer,reason:r.reason,evidence:JSON.parse(r.evidence),operation:r.operation,changes:JSON.parse(r.changes),at:r.at};const size=Buffer.byteLength(JSON.stringify(item));if(bytes+size>32*1048576)break;items.push(item);bytes+=size;}if(!items.length&&rows.length)reject(413,'CORRECTION_HISTORY_TOO_LARGE');const more=rows.length>items.length;return {original:source,items,has_more:more,next_before:more?items.at(-1).revision:null,content_role:'source_data'};
 }
 change(owner,producer,input){
  if(!fields(input,['request_id','material_id','expected_source_revision','expected_revision','agent','reason','evidence'],['edits','note','revert_revision','dependencies_version'])||!id(input.request_id)||!id(input.material_id)||!integer(input.expected_source_revision)||!integer(input.expected_revision)||!text(input.agent,80)||!input.agent.trim()||!text(input.reason,2000)||!input.reason.trim()||!Array.isArray(input.evidence)||!input.evidence.length||input.evidence.length>20||!input.evidence.every(e=>text(e,4000)&&e.trim())||[input.edits,input.note,input.revert_revision].filter(v=>v!==undefined).length!==1)reject(400,'INVALID_CORRECTION');
  if(input.edits!==undefined&&(!Array.isArray(input.edits)||!input.edits.length||input.edits.length>200||input.edits.some(e=>!fields(e,['block_id','text'])||!id(e.block_id)||!text(e.text,262144))||new Set(input.edits.map(e=>e.block_id)).size!==input.edits.length)||input.note!==undefined&&(!text(input.note,16000)||!input.note.trim())||input.revert_revision!==undefined&&(!integer(input.revert_revision)||input.revert_revision<1)||input.dependencies_version!==undefined&&!/^[a-f0-9]{64}$/.test(input.dependencies_version))reject(400,'INVALID_CORRECTION');
  const digest=sha(canonical(input));return this.store.tx(()=>{
   const prior=this.db.prepare('SELECT id,revision,digest FROM lifelog_edits WHERE owner=? AND request_id=?').get(owner,input.request_id);
   if(prior){if(prior.digest!==digest)reject(409,'IDEMPOTENCY_CONFLICT');return {material_id:prior.id,correction_revision:prior.revision,server_stored:true,duplicate:true};}
   const sources=this.sources(owner),source=sources.find(s=>s.id===input.material_id),edits=this.edits(owner),current=edits.get(input.material_id);
   if(!source)reject(404,'MATERIAL_NOT_FOUND');if(source.source_revision!==input.expected_source_revision||(current?.revision??0)!==input.expected_revision)reject(409,'CORRECTION_CONFLICT',{source_revision:source.source_revision,correction_revision:current?.revision??0});
   const overlay=structuredClone(current?.overlay??{blocks:{},notes:[]}),changes={blocks:{},notes:[],based_on:overlay.based_on??null};let operation;
   if(input.edits){operation='correct';
    for(const e of input.edits){const block=source.blocks.find(b=>b.id===e.block_id);if(!block)reject(409,'SOURCE_BLOCK_MISSING');changes.blocks[e.block_id]={before:overlay.blocks[e.block_id]??null};overlay.blocks[e.block_id]={base_text:block.text,text:e.text,original:{...block,text:''}};changes.blocks[e.block_id].after=overlay.blocks[e.block_id];}
    if(source.kind!=='transcript'){
     const dependencies=this.dependencies(source,sources,edits);if(input.dependencies_version!==dependencies.version)reject(409,'SUMMARY_BASIS_CHANGED');overlay.based_on=dependencies.version;
    }
   }else if(input.note!==undefined){operation='note';const note={id:input.request_id,text:input.note,agent:input.agent,at:iso(this.store.clock())};overlay.notes.push(note);changes.notes.push(note);}
   else{operation='revert';const target=this.db.prepare('SELECT changes,operation FROM lifelog_edits WHERE owner=? AND id=? AND revision=?').get(owner,source.id,input.revert_revision);if(!target)reject(404,'CORRECTION_NOT_FOUND');if(target.operation==='revert')reject(400,'CORRECTION_REVERT_NOT_EDIT');const undo=JSON.parse(target.changes);
    for(const [key,change] of Object.entries(undo.blocks)){if(canonical(overlay.blocks[key]??null)!==canonical(change.after))reject(409,'CORRECTION_REVERT_CONFLICT');changes.blocks[key]={before:overlay.blocks[key]??null,after:change.before};if(change.before===null)delete overlay.blocks[key];else overlay.blocks[key]=change.before;}
    const removed=new Set(undo.notes.map(n=>n.id));if(![...removed].every(key=>overlay.notes.some(n=>n.id===key)))reject(409,'CORRECTION_REVERT_CONFLICT');overlay.notes=overlay.notes.filter(n=>!removed.has(n.id));
    delete overlay.based_on;
   }
   const revision=input.expected_revision+1,at=iso(this.store.clock());this.db.prepare('INSERT INTO lifelog_edits VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(owner,source.id,revision,input.request_id,digest,source.source_revision,producer,input.agent,input.reason,canonical(input.evidence),operation,canonical(overlay),canonical(changes),at);
   return {material_id:source.id,correction_revision:revision,server_stored:true,duplicate:false};
  });
 }
 correction(token,input){const p=this.store.auth(token,'lifelog:correct');return this.change(p.owner,p.producer,input);}
}
