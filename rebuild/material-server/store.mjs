import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {canonical,sha,reject} from './json.mjs';
import {createValidator,createQueueValidator} from './validation.mjs';
import {PhonePresence} from './phone-presence.mjs';
import {DeviceRegistry} from './devices.mjs';
import {MaterialPairings} from './material-pairings.mjs';
import {SessionPairings,SESSION_SCOPES} from './session-pairings.mjs';
import {AgentSessionDirectory} from './agent-sessions.mjs';
import {MaterialTransfer,materialWire,MAX_MATERIAL_BYTES,cancelMaterial} from './material-transfer.mjs';
import {AudioArchive} from './audio.mjs';
import {TodoSuggestions} from './todo-suggestions.mjs';

const SCOPES=new Set(['audio:write','audio:read','materials:write','materials:read','changes:read','daily-summaries:read','tasks:write','tasks:read','tasks:update',
  'requests:write','requests:read','answers:write','messages:receive','messages:write','receipts:phone','receipts:agent','receipts:storage','operations:read','devices:pair']);
const iso=n=>new Date(n).toISOString();
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(s);
const timestamp=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
const MAX_BODY=262144,MAX_PAGE=1048576;
// Agent check-in watches (2026-10-23, user: any agent given the CLI must keep the wearer informed).
const WATCH_MAX_MS=7200000,WATCH_GRACE_MS=120000,WATCHDOG='io-server-watchdog';
const WATCH_ACTIVE=['queued','agent_received','running','waiting_answer'];
// P40 state machines: an event may only publish a state reachable from the
// current head state. "answered" is never publishable — only the answer
// transaction sets it, so a client cannot claim the user answered.
const TASK_TRANSITIONS={
  queued:['agent_received','cancel_requested','expired','failed','execution_unknown'],
  agent_received:['running','waiting_answer','cancel_requested','completed','failed','expired','execution_unknown'],
  running:['waiting_answer','cancel_requested','completed','failed','expired','execution_unknown','stop_requested'],
  waiting_answer:['running','cancel_requested','completed','failed','expired','execution_unknown','stop_requested'],
  cancel_requested:['cancelled','completed','failed','execution_unknown'],
  execution_unknown:['agent_received','running','waiting_answer','completed','failed','cancelled'],
  stop_requested:['stop_unconfirmed','stopped','completed','failed','execution_unknown','running'],
  stop_unconfirmed:['stop_requested','stopped','completed','failed','execution_unknown'],
  stopped:['resume_requested','cancelled'],
  resume_requested:['agent_received','stopped','failed','expired','execution_unknown'],
  cancelled:[],completed:[],failed:[],expired:[]};
const TASK_CONTROL_STATES=new Set(['stop_requested','stop_unconfirmed','stopped','resume_requested']);
const TASK_EXECUTION_PHASES={agent_received:['queued','sending','accepted'],running:['running','result_pending'],waiting_answer:['running'],
  execution_unknown:['outcome_unknown'],stop_requested:['running','stop_requested'],stop_unconfirmed:['stop_unconfirmed','outcome_unknown'],
  stopped:['stopped'],resume_requested:['stopped'],completed:['completed'],failed:['failed'],cancelled:['cancelled'],expired:['expired'],
  cancel_requested:['queued','sending','accepted','running','result_pending','outcome_unknown']};
const TASK_CLOSED_TO_ANSWERS=new Set(['cancel_requested','cancelled','completed','failed','expired','execution_unknown',...TASK_CONTROL_STATES]);
const equalOptional=(a,b)=>canonical(a??null)===canonical(b??null);
const REQUEST_PUBLISH={pending:['presented','withdrawn','expired'],presented:['pending','withdrawn','expired'],
  answered:[],withdrawn:[],expired:[]};
// A client may only report the stages its own identity can observe. server_stored
// and expired stay internal: the server, not a client, owns those facts.
const RECEIPT_SCOPES={phone_received:'receipts:phone',glasses_displayed:'receipts:phone',user_answered:'receipts:phone',
  agent_received:'receipts:agent',task_resumed:'receipts:agent',task_completed:'receipts:agent',cancel_requested:'receipts:agent',
  cancelled:'receipts:agent',failed:'receipts:agent',server_stored:'receipts:storage',expired:'receipts:storage'};
// Reading an object is allowed to whoever may write it (reconciliation needs the
// same view) or to a dedicated read scope.
const QUEUE_READ={task:['tasks:read','tasks:update'],request:['requests:read','requests:write'],message:['messages:receive','messages:write']};
const QUEUE_MISSING={task:'TASK_NOT_FOUND',request:'REQUEST_NOT_FOUND',message:'MESSAGE_NOT_FOUND'};

export class MaterialStore {
  constructor(path,{clock=Date.now}={}){
    this.clock=clock;this.validate=createValidator();this.validateQueue=createQueueValidator();this.db=new DatabaseSync(path);
    try{
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      const version=this.db.prepare('PRAGMA user_version').get().user_version;
      if(version!==0&&version!==1&&version!==2)throw new Error('UNSUPPORTED_DATABASE_VERSION');
      if(version===0){
        if(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get())throw new Error('UNRECOGNIZED_DATABASE');
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
          CREATE TABLE credentials(token_id TEXT PRIMARY KEY,digest TEXT UNIQUE NOT NULL,owner TEXT NOT NULL,
            producer TEXT NOT NULL,scopes TEXT NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0) STRICT;
          CREATE TABLE counters(owner TEXT PRIMARY KEY,seq INTEGER NOT NULL) STRICT;
          CREATE TABLE materials(owner TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,deleted INTEGER NOT NULL,
            PRIMARY KEY(owner,id)) STRICT;
          CREATE TABLE revisions(owner TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,
            schema_version TEXT NOT NULL,body_hash TEXT NOT NULL,seq INTEGER NOT NULL,stored_at TEXT NOT NULL,
            event_id TEXT NOT NULL,deleted INTEGER NOT NULL,started INTEGER NOT NULL,ended INTEGER NOT NULL,
            search_text TEXT NOT NULL,PRIMARY KEY(owner,id,revision),UNIQUE(owner,seq)) STRICT;
          CREATE INDEX revision_sequence ON revisions(owner,seq);
          CREATE TABLE events(owner TEXT NOT NULL,producer TEXT NOT NULL,idem TEXT NOT NULL,event_id TEXT NOT NULL,
            digest TEXT NOT NULL,response TEXT NOT NULL,expires INTEGER NOT NULL,
            PRIMARY KEY(owner,producer,idem),UNIQUE(owner,event_id)) STRICT;
          PRAGMA user_version=1;
          COMMIT;`);
      }
      // v2 adds the P40 queue without touching materials, credentials or events.
      if(this.db.prepare('PRAGMA user_version').get().user_version<2)this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE queue_counters(owner TEXT PRIMARY KEY,seq INTEGER NOT NULL) STRICT;
          CREATE TABLE queue_heads(owner TEXT NOT NULL,kind TEXT NOT NULL,object_id TEXT NOT NULL,revision INTEGER NOT NULL,
            state TEXT NOT NULL,route TEXT NOT NULL,PRIMARY KEY(owner,kind,object_id)) STRICT;
          CREATE TABLE queue_revisions(owner TEXT NOT NULL,kind TEXT NOT NULL,object_id TEXT NOT NULL,revision INTEGER NOT NULL,
            body TEXT NOT NULL,schema_version TEXT NOT NULL,body_hash TEXT NOT NULL,seq INTEGER NOT NULL,stored_at TEXT NOT NULL,
            event_id TEXT NOT NULL,expires INTEGER NOT NULL,state TEXT NOT NULL,
            PRIMARY KEY(owner,kind,object_id,revision)) STRICT;
          CREATE INDEX queue_sequence ON queue_revisions(owner,seq);
          PRAGMA user_version=2;
          COMMIT;`);
      // Additive table; older databases gain it without a version change.
      this.db.exec('CREATE TABLE IF NOT EXISTS watches(owner TEXT NOT NULL,task_id TEXT NOT NULL,producer TEXT NOT NULL,enabled INTEGER NOT NULL,next_at INTEGER,note TEXT NOT NULL,fired_at INTEGER,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,task_id)) STRICT;');
      this.tx(()=>{
        this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('cursor_secret',randomBytes(32).toString('hex'));
        this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('server_id',randomUUID());
      });
      this.cursorSecret=this.db.prepare('SELECT value FROM meta WHERE key=?').get('cursor_secret').value;
      this.sessionPairings=new SessionPairings(this);this.materialPairings=new MaterialPairings(this);this.devices=new DeviceRegistry(this);this.phones=new PhonePresence(this);this.agentSessions=new AgentSessionDirectory(this);this.transfer=new MaterialTransfer(this);this.todoSuggestions=new TodoSuggestions(this);
      this.audio=null;this.audioUnavailable=false;
      try{this.audio=new AudioArchive(this,path===':memory:'?path:path+'.audio.sqlite');this.audio.prune();}
      catch{this.audio?.close();this.audio=null;this.audioUnavailable=true;}
    }catch(e){this.audio?.close();this.db.close();throw e;}
  }
  close(){this.audio?.close();this.db.close();}
  async backupTo(destination){
    if(!path.isAbsolute(destination))reject(400,'EXPLICIT_ABSOLUTE_BACKUP_REQUIRED');
    // Reserve a private temporary file. Publish exclusively so an existing
    // database or backup can never be overwritten by sqlite.backup().
    const temporary=destination+'.'+randomUUID()+'.partial.sqlite';
    const fd=fs.openSync(temporary,'wx',0o600);fs.closeSync(fd);
    try{
      await backup(this.db,temporary);
      const check=new DatabaseSync(temporary,{readOnly:true});
      try{if(check.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('BACKUP_CHECK_FAILED');}finally{check.close();}
      const file=fs.openSync(temporary,'r+');try{fs.fsyncSync(file);}finally{fs.closeSync(file);}
      fs.linkSync(temporary,destination);
      if(process.platform!=='win32'){
        const dir=fs.openSync(path.dirname(destination),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
      }
      return {database_version:1,verified:true};
    }finally{fs.unlinkSync(temporary);}
  }
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){try{this.db.exec('ROLLBACK');}catch{}throw e;}}
  mint({owner,producer,scopes,ttlMs=3600000}){
    if(!id(owner)||!id(producer)||!Array.isArray(scopes)||!scopes.length||scopes.some(s=>!SCOPES.has(s))||
      !Number.isSafeInteger(ttlMs)||ttlMs<=0||ttlMs>86400000)reject(400,'INVALID_CREDENTIAL_CONFIG');
    const token=randomBytes(32).toString('base64url'),tokenId=randomUUID(),expires=this.clock()+ttlMs;
    this.db.prepare('INSERT INTO credentials(token_id,digest,owner,producer,scopes,expires) VALUES (?,?,?,?,?,?)')
      .run(tokenId,sha(token),owner,producer,JSON.stringify([...new Set(scopes)]),expires);
    return {token,token_id:tokenId,expires_at:iso(expires)};
  }
  revoke(tokenId){return this.db.prepare('UPDATE credentials SET revoked=1 WHERE token_id=?').run(tokenId).changes>0;}
  auth(token,scope=null){
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))reject(401,'UNAUTHENTICATED');
    const row=this.db.prepare('SELECT * FROM credentials WHERE digest=?').get(sha(token));
    if(!row||row.revoked||row.expires<=this.clock())reject(401,'UNAUTHENTICATED');
    const bound=this.db.prepare('SELECT route FROM session_bindings WHERE owner=? AND producer=?').get(row.owner,row.producer);
    if(bound){row.sessionRoute=bound.route;row.scopes=JSON.stringify(JSON.parse(row.scopes).filter(s=>SESSION_SCOPES.includes(s)));}
    if(scope&&!JSON.parse(row.scopes).includes(scope))reject(403,'FORBIDDEN');return row;
  }
  identity(token){
    const p=this.auth(token);return {schema_version:'1.0',server_id:this.db.prepare('SELECT value FROM meta WHERE key=?').get('server_id').value,
      owner_id:p.owner,producer_id:p.producer,scopes:JSON.parse(p.scopes),expires_at:iso(p.expires),capabilities:['request_lifecycle_v1','task_session_control_v1','agent_session_directory_v1','daily_summaries_v1','todo_suggestions_v1','material_transfer_v1','material_cancel_v1','primary_phone_v1',...(this.audio?['audio_archive_v1']:[])],
      material_schema_versions:['1.0','1.1','1.2']};
  }
  operations(token){
    const p=this.auth(token,'operations:read');
    const queue=this.db.prepare('SELECT kind,state,COUNT(*) AS count FROM queue_heads WHERE owner=? GROUP BY kind,state ORDER BY kind,state').all(p.owner);
    const receipts=this.db.prepare("SELECT json_extract(body,'$.stage') AS stage,COUNT(*) AS count FROM queue_revisions WHERE owner=? AND kind='receipt' GROUP BY stage ORDER BY stage").all(p.owner);
    const materials=this.db.prepare('SELECT deleted,COUNT(*) AS count FROM materials WHERE owner=? GROUP BY deleted').all(p.owner);
    const recent=this.db.prepare('SELECT kind,object_id,revision,state,stored_at,seq FROM queue_revisions WHERE owner=? ORDER BY seq DESC LIMIT 50').all(p.owner);
    return {server_time:iso(this.clock()),owner_id:p.owner,queue,receipts,materials,recent};
  }
  dailySummaryHead(token,input){
    const p=this.auth(token,'materials:write');
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||typeof input.material_id!=='string'||!/^daily-[a-f0-9]{64}$/.test(input.material_id))reject(400,'INVALID_DAILY_SUMMARY');
    const head=this.db.prepare('SELECT revision,deleted FROM materials WHERE owner=? AND id=?').get(p.owner,input.material_id);
    if(!head)return {material_id:input.material_id,body:null};
    const row=this.db.prepare('SELECT body FROM revisions WHERE owner=? AND id=? AND revision=?').get(p.owner,input.material_id,head.revision),body=JSON.parse(row.body);
    if(head.deleted)reject(410,'MATERIAL_DELETED');
    if(body.source!=='agent_analysis'||body.utterances.length||body.audio.state!=='not_retained'||!/^# \d{4}-\d{2}-\d{2} 每日 AI 总结/.test(body.full_text?.text??''))reject(404,'NOT_FOUND');
    return {material_id:input.material_id,body};
  }
  cancelMaterial(token,value){return cancelMaterial(this,token,value);}
  submit(token,event){return this.#submit(token,event,MAX_BODY);}
  submitAssembled(token,event){return this.#submit(token,event,MAX_MATERIAL_BYTES);}
  #submit(token,event,budget){
    // The ordinary event endpoint stays small; only verified assembled transfers use the larger budget.
    const encoded=canonical(event);if(Buffer.byteLength(encoded)>budget)reject(413,'PAYLOAD_TOO_LARGE');this.validate(event);
    return this.tx(()=>{
      const p=this.auth(token,'materials:write'),now=this.clock(),b=event.body;
      if(p.producer!==event.producer_id)reject(403,'FORBIDDEN');
      if(Date.parse(event.expires_at)<=now)reject(410,'EXPIRED');
      if(Date.parse(event.created_at)>now+300000||Date.parse(event.created_at)>=Date.parse(event.expires_at))reject(400,'INVALID_TIME_RANGE');
      const digest=sha(encoded),prior=this.db.prepare('SELECT * FROM events WHERE owner=? AND producer=? AND idem=?')
        .get(p.owner,p.producer,event.idempotency_key);
      if(prior){if(prior.digest.startsWith('cancelled:'))reject(409,'MATERIAL_EVENT_CANCELLED');if(prior.digest!==digest)reject(409,'IDEMPOTENCY_CONFLICT');return {status:200,body:JSON.parse(prior.response)};}
      if(this.db.prepare('SELECT 1 FROM events WHERE owner=? AND event_id=?').get(p.owner,event.event_id))reject(409,'EVENT_ID_CONFLICT');
      const bodyHash=sha(canonical(b));
      const existing=this.db.prepare('SELECT * FROM revisions WHERE owner=? AND id=? AND revision=?').get(p.owner,b.material_id,b.revision);
      // A newly issued upload envelope may acknowledge the same immutable revision.
      // It never rolls the current head back, including after a later tombstone.
      if(existing&&existing.schema_version===event.schema_version&&existing.body_hash===bodyHash){
        const response=this.receipt(event,existing.seq,existing.stored_at,existing.event_id);
        this.saveEvent(p,event,digest,response);return {status:200,body:response};
      }
      const head=this.db.prepare('SELECT * FROM materials WHERE owner=? AND id=?').get(p.owner,b.material_id);
      if(b.base_revision!==(head?.revision??0)||existing)reject(409,'REVISION_CONFLICT',{current_revision:head?.revision??0});
      if(head?.deleted)reject(409,'MATERIAL_DELETED',{current_revision:head.revision});
      const previous=head&&JSON.parse(this.db.prepare('SELECT body FROM revisions WHERE owner=? AND id=? AND revision=?').get(p.owner,b.material_id,head.revision).body);
      if(previous){
        // A new schema cannot silently discard a material's existing dictionary.
        if(previous.speakers!==undefined&&event.schema_version!=='1.2')reject(409,'SCHEMA_DOWNGRADE_REFUSED');
        const oldText=canonical({full_text:previous.full_text??null,utterances:previous.utterances,speakers:previous.speakers??null});
        const newText=canonical({full_text:b.full_text??null,utterances:b.utterances,speakers:b.speakers??null});
        if(b.text_revision<previous.text_revision||b.text_revision>previous.text_revision+1||
          (b.operation!=='delete'&&oldText!==newText&&b.text_revision!==previous.text_revision+1))reject(409,'TEXT_REVISION_CONFLICT',{current_revision:head.revision});
        if(event.schema_version==='1.2'&&b.operation!=='delete'&&b.processing.user_edited&&oldText!==newText){
          const words=v=>canonical(v.utterances.map(u=>({utterance_id:u.utterance_id,start_ms:u.start_ms,end_ms:u.end_ms,text:u.text,overlap:u.overlap})));
          // Editing a label or assignment cannot also claim newly recognized
          // audio. New ASR text/source growth remains an independent revision.
          if(words(previous)===words(b)&&(!sameMaterialSource(previous,b)||!sameProcessingCoverage(previous,b)))reject(400,'SPEAKER_EDIT_SOURCE_CHANGED');
        }
      }else if(b.text_revision>1)reject(409,'TEXT_REVISION_CONFLICT',{current_revision:0});
      if(event.schema_version==='1.2')this.validateSourceParents(p.owner,b,previous);
      this.db.prepare('INSERT INTO counters VALUES (?,1) ON CONFLICT(owner) DO UPDATE SET seq=seq+1').run(p.owner);
      const seq=this.ceiling(p.owner),storedAt=iso(now),deleted=b.operation==='delete'?1:0;
      const search=[b.full_text?.text??'',...b.utterances.map(u=>u.text)].join('\n').toLowerCase();
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(p.owner,b.material_id,b.revision,canonical(b),
        event.schema_version,bodyHash,seq,storedAt,event.event_id,deleted,Date.parse(b.started_at),Date.parse(b.ended_at),search);
      this.db.prepare('INSERT INTO materials VALUES (?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted')
        .run(p.owner,b.material_id,b.revision,deleted);
      const response=this.receipt(event,seq,storedAt);this.saveEvent(p,event,digest,response);
      return {status:201,body:response};
    });
  }
  receipt(e,seq,storedAt,duplicateOf=null){
    return {schema_version:e.schema_version,event_id:e.event_id,material_id:e.body.material_id,revision:e.body.revision,
      commit_seq:seq,stored_at:storedAt,duplicate_of:duplicateOf,receipt:{receipt_id:randomUUID(),subject_kind:'material',
        subject_id:e.body.material_id,subject_revision:e.body.revision,stage:'server_stored',actor_id:'server-storage',related_event_id:e.event_id,error:null}};
  }
  validateSourceParents(owner,b,previous){
    const parents=new Map();
    // Resolve only inside this owner's material. IDs never route to a different
    // material/owner, and the transaction makes validation and commit one fact.
    for(const u of b.utterances){
      const r=u.source_range;if(!r)continue;
      if(!parents.has(r.parent_revision)){
        const row=this.db.prepare('SELECT body FROM revisions WHERE owner=? AND id=? AND revision=?')
          .get(owner,b.material_id,r.parent_revision);
        if(!row)reject(400,'SOURCE_PARENT_NOT_FOUND');parents.set(r.parent_revision,JSON.parse(row.body));
      }
      const parent=parents.get(r.parent_revision),utterance=parent.utterances.find(v=>v.utterance_id===r.parent_utterance_id);
      if(!utterance)reject(400,'SOURCE_PARENT_NOT_FOUND');
      const range=utterance.start_ms===null?utterance.source_range:utterance;
      const prior=previous?.utterances.find(v=>v.utterance_id===u.utterance_id);
      // The original range anchors the source, rather than claiming that a
      // subsequent user correction still matches the ASR's literal text.
      // Only an already validated same-ID/range can carry corrected wording;
      // new wording must advance text_revision, and its times stay unchanged.
      const corrected=prior?.source_range&&canonical(prior.source_range)===canonical(r)&&
        prior.start_ms===u.start_ms&&prior.end_ms===u.end_ms&&b.processing.user_edited&&
        (prior.text===u.text||b.text_revision===previous.text_revision+1);
      // Wording corrections invalidate token timing. Later label/self changes
      // cannot restore the old parent's ASR boundary after it became unknown.
      if(((corrected&&prior.text!==u.text)||previous?.processing?.boundary==='unknown')&&
        b.processing.boundary!=='unknown')reject(400,'SOURCE_RANGE_SOURCE_CHANGED');
      if(!range||r.start_ms!==range.start_ms||r.end_ms!==range.end_ms||r.text_end>utterance.text.length||
        r.text_start>=utterance.text.length||(utterance.text.slice(r.text_start,r.text_end)!==u.text&&!corrected)||
        utf16PairBoundary(utterance.text,r.text_start)||utf16PairBoundary(utterance.text,r.text_end))reject(400,'INVALID_SOURCE_RANGE');
      if(!sameMaterialSource(parent,b)||!sameProcessingCoverage(parent,b)||
        (previous&&(!sameMaterialSource(previous,b)||!sameProcessingCoverage(previous,b)))||!b.processing.user_edited)reject(400,'SOURCE_RANGE_SOURCE_CHANGED');
    }
  }
  saveEvent(p,e,digest,response){this.db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?)').run(p.owner,p.producer,e.idempotency_key,e.event_id,digest,canonical(response),Date.parse(e.expires_at));}
  event(token,eventId){
    // Any authenticated producer may read back only its own accepted event.
    // A read scope alone cannot reach another producer's receipt.
    const p=this.auth(token);
    const row=this.db.prepare('SELECT response FROM events WHERE owner=? AND producer=? AND event_id=?').get(p.owner,p.producer,eventId);
    if(!row)reject(404,'EVENT_NOT_FOUND');return JSON.parse(row.response);
  }
  // ---- Check-in watches: the agent declares when it reports next; the server keeps the promise ----
  watchView(w){return {task_id:w.task_id,enabled:w.enabled===1,next_checkin_at:w.next_at===null?null:iso(w.next_at),note:w.note,fired_at:w.fired_at===null?null:iso(w.fired_at)};}
  watchGet(token,taskId){
    const p=this.auth(token,'messages:write'),w=this.db.prepare('SELECT * FROM watches WHERE owner=? AND task_id=?').get(p.owner,taskId);
    if(!w||w.producer!==p.producer)reject(404,'WATCH_NOT_FOUND');return this.watchView(w);
  }
  watchSet(token,taskId,input){
    return this.tx(()=>{
      const p=this.auth(token,'messages:write'),now=this.clock();
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join()!=='enabled,next_checkin_at,note'||typeof input.enabled!=='boolean'||typeof input.note!=='string'||input.note.length>600||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(input.note))reject(400,'INVALID');
      let next=null;
      if(input.enabled){if(!timestamp(input.next_checkin_at))reject(400,'INVALID');next=Date.parse(input.next_checkin_at);if(next<=now||next>now+WATCH_MAX_MS)reject(400,'INVALID_TIME_RANGE');}
      else if(input.next_checkin_at!==null)reject(400,'INVALID');
      const target=this.queueHead(p.owner,'task',taskId);if(!target||p.sessionRoute&&p.sessionRoute!==target.route)reject(404,'TASK_NOT_FOUND');
      const prior=this.db.prepare('SELECT producer FROM watches WHERE owner=? AND task_id=?').get(p.owner,taskId);if(prior&&prior.producer!==p.producer)reject(403,'FORBIDDEN');
      this.db.prepare('INSERT INTO watches VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner,task_id) DO UPDATE SET enabled=excluded.enabled,next_at=excluded.next_at,note=excluded.note,fired_at=NULL,updated_at=excluded.updated_at').run(p.owner,taskId,p.producer,input.enabled?1:0,next,input.note,null,now);
      return this.watchView(this.db.prepare('SELECT * FROM watches WHERE owner=? AND task_id=?').get(p.owner,taskId));
    });
  }
  /** One progress notice per overdue check-in, from the server itself, while the task is still active. */
  watchdogTick(){
    const now=this.clock();let fired=0;
    for(const w of this.db.prepare('SELECT * FROM watches WHERE enabled=1 AND fired_at IS NULL AND next_at<=?').all(now-WATCH_GRACE_MS))try{this.tx(()=>{
      const task=this.queueHead(w.owner,'task',w.task_id),expires=task?this.queueRevision(w.owner,'task',w.task_id,task.revision).expires:0;
      if(task&&WATCH_ACTIVE.includes(task.state)&&expires>now+60000){
        const id='notice-'+sha(JSON.stringify(['watchdog',w.task_id,w.next_at])),late=Math.max(1,Math.round((now-w.next_at)/60000));
        const text='已超过约定报到时间约 '+late+' 分钟，Agent 没有报告新进展，可能卡住或忘了提醒。'+(w.note?'它上次说的下一步：'+w.note:'');
        const event={schema_version:'1.0',event_id:'ev-'+id,idempotency_key:'idem-'+id,producer_id:WATCHDOG,kind:'message',created_at:iso(now),expires_at:iso(Math.min(now+1800000,expires)),body:{message_id:id,revision:1,task_id:w.task_id,route:JSON.parse(task.route),request_id:null,channel:'progress',text}};
        this.validateQueue(event,'message');
        if(!this.queueHead(w.owner,'message',id)){const stored=this.queueApply(w.owner,'message',id,event,now);this.saveEvent({owner:w.owner,producer:WATCHDOG},event,sha(canonical(event)),this.queueReceipt(event,'message',id,stored.revision,stored.seq,stored.storedAt));fired++;}
      }
      this.db.prepare('UPDATE watches SET fired_at=? WHERE owner=? AND task_id=?').run(now,w.owner,w.task_id);
    });}catch{/* One bad watch never stops the others. */}
    return fired;
  }
  // ---- P40 queue: immutable revisions, a live head state, per-identity scopes ----
  queueScope(kind,event){
    if(kind==='task')return event.body.revision===1?'tasks:write':'tasks:update';
    if(kind==='request')return 'requests:write';
    if(kind==='answer')return 'answers:write';
    if(kind==='message')return 'messages:write';
    return RECEIPT_SCOPES[event.body.stage]??'receipts:storage';
  }
  queueCeiling(owner){return this.db.prepare('SELECT seq FROM queue_counters WHERE owner=?').get(owner)?.seq??0;}
  queueHead(owner,kind,objectId){return this.db.prepare('SELECT * FROM queue_heads WHERE owner=? AND kind=? AND object_id=?').get(owner,kind,objectId);}
  queueRevision(owner,kind,objectId,revision){return this.db.prepare('SELECT * FROM queue_revisions WHERE owner=? AND kind=? AND object_id=? AND revision=?').get(owner,kind,objectId,revision);}
  queueItem(row,state){
    const item={kind:row.kind,object_id:row.object_id,revision:row.revision,schema_version:row.schema_version,
      body:JSON.parse(row.body),state:state??row.state,commit_seq:row.seq,stored_at:row.stored_at,event_id:row.event_id,
      expires_at:iso(row.expires)};
    // A status revision has its own delivery deadline. It must never renew the
    // original command's permission to start after an offline/busy interval.
    if(row.kind==='task')item.command_expires_at=iso(this.queueRevision(row.owner,'task',row.object_id,1).expires);
    return item;
  }
  queueObjectId(kind,b){return kind==='task'?b.task_id:kind==='request'?b.request_id:kind==='answer'?b.answer_id:kind==='message'?b.message_id:b.receipt_id;}
  queueReceipt(e,kind,objectId,revision,seq,storedAt){
    return {schema_version:e.schema_version,event_id:e.event_id,kind,object_id:objectId,revision,commit_seq:seq,stored_at:storedAt,duplicate_of:null,
      receipt:{receipt_id:randomUUID(),subject_kind:kind,subject_id:objectId,subject_revision:revision,stage:'server_stored',
        actor_id:'server-storage',related_event_id:e.event_id,error:null}};
  }
  queueSubmit(token,event,kind){
    const encoded=canonical(event);if(Buffer.byteLength(encoded)>MAX_BODY)reject(413,'PAYLOAD_TOO_LARGE');this.validateQueue(event,kind);
    return this.tx(()=>{
      const p=this.auth(token,this.queueScope(kind,event)),now=this.clock(),b=event.body;
      if(p.producer!==event.producer_id)reject(403,'FORBIDDEN');
      if(p.sessionRoute){const route=kind==='receipt'?this.queueHead(p.owner,b.subject_kind,b.subject_id)?.route:canonical(b.route);if(route!==p.sessionRoute)reject(403,'FORBIDDEN');}
      if(Date.parse(event.expires_at)<=now)reject(410,'EXPIRED');
      if(Date.parse(event.created_at)>now+300000)reject(400,'INVALID_TIME_RANGE');
      const digest=sha(encoded),prior=this.db.prepare('SELECT * FROM events WHERE owner=? AND producer=? AND idem=?').get(p.owner,p.producer,event.idempotency_key);
      if(prior){if(prior.digest!==digest)reject(409,'IDEMPOTENCY_CONFLICT');return {status:200,body:JSON.parse(prior.response)};}
      if(this.db.prepare('SELECT 1 FROM events WHERE owner=? AND event_id=?').get(p.owner,event.event_id))reject(409,'EVENT_ID_CONFLICT');
      const objectId=this.queueObjectId(kind,b),stored=this.queueApply(p.owner,kind,objectId,event,now,p);
      const response=stored.duplicate??this.queueReceipt(event,kind,objectId,stored.revision,stored.seq,stored.storedAt);
      this.saveEvent(p,event,digest,response);
      return {status:stored.duplicate?200:201,body:response};
    });
  }
  queueTaskControl(owner,b,prior,principal,now,event){
    if(!prior){if(b.execution||b.control)reject(409,'TASK_CONTROL_INVALID');return;}
    // Full task revisions cannot replace the original user instruction or
    // silently move a stopped command to another native session.
    if(b.command!==prior.command||b.allow_create_session!==prior.allow_create_session)reject(409,'TASK_COMMAND_IMMUTABLE');
    const extended=Boolean(b.execution||prior.execution||b.control||prior.control||TASK_CONTROL_STATES.has(b.state));
    if(!extended)return; // Keep the existing pre-extension task protocol.
    const agent=Boolean(principal&&JSON.parse(principal.scopes).includes('receipts:agent'));
    const ex=b.execution,old=prior.execution,control=b.control;
    if(!ex||!TASK_EXECUTION_PHASES[b.state]?.includes(ex.phase))reject(409,'TASK_EXECUTION_INVALID');
    if(['running','result_pending','stop_requested','stop_unconfirmed','stopped','completed'].includes(ex.phase)&&!ex.turn_id)
      reject(409,'TASK_EXECUTION_INVALID');
    if(['queued','sending','accepted'].includes(ex.phase)&&ex.turn_id!==null)reject(409,'TASK_EXECUTION_INVALID');
    if(ex.turn_id!==null&&!ex.turn_id.trim())reject(409,'TASK_EXECUTION_INVALID');
    const newControl=!equalOptional(control,prior.control);
    if(newControl){
      // "end" closes a proven-stopped turn: nothing runs, so only the phase moves to cancelled.
      const end=control?.kind==='end';
      if(!control||!old||!equalOptional(ex,end?{...old,phase:'cancelled'}:old))reject(409,'TASK_CONTROL_INVALID');
      if(control.expected_command_id!==old.command_id||control.expected_turn_id!==old.turn_id)reject(409,'TASK_CONTROL_STALE');
      const stop=control.kind==='stop';
      if(stop ? !(['running','waiting_answer'].includes(prior.state)&&old.phase==='running'&&b.state==='stop_requested') :
        !(prior.state==='stopped'&&old.phase==='stopped'&&b.state===(end?'cancelled':'resume_requested')))reject(409,'TASK_CONTROL_STALE');
      if(Date.parse(control.expires_at)<=now)reject(410,'CONTROL_EXPIRED');
      if(Date.parse(control.expires_at)>Date.parse(event.expires_at))reject(400,'TASK_CONTROL_DEADLINE_INVALID');
      if(control.kind==='resume'&&(!control.text?.trim()||Buffer.byteLength(control.text)>32768))reject(400,'TASK_CONTROL_TEXT_INVALID');
      if(this.db.prepare("SELECT 1 FROM queue_revisions WHERE owner=? AND kind='task' AND json_extract(body,'$.control.control_id')=? LIMIT 1").get(owner,control.control_id))
        reject(409,'TASK_CONTROL_ID_CONFLICT');
      if(this.db.prepare("SELECT 1 FROM queue_revisions WHERE owner=? AND kind='task' AND json_extract(body,'$.execution.command_id')=? LIMIT 1").get(owner,control.control_id))
        reject(409,'TASK_CONTROL_ID_CONFLICT');
      return; // A request never changes execution evidence.
    }
    if(!agent)reject(403,'FORBIDDEN');
    if(TASK_CONTROL_STATES.has(b.state)&&!control)reject(409,'TASK_CONTROL_INVALID');
    if(b.state==='resume_requested'&&(control.kind!=='resume'||control.expected_command_id!==ex.command_id||control.expected_turn_id!==ex.turn_id))
      reject(409,'TASK_CONTROL_INVALID');
    if(old){
      if(ex.command_id!==old.command_id){
        if(prior.state!=='resume_requested'||control?.kind!=='resume'||b.state!=='agent_received'||
          control.expected_command_id!==old.command_id||control.expected_turn_id!==old.turn_id||old.phase!=='stopped'||
          ex.command_id!==control.control_id||ex.turn_id!==null)reject(409,'TASK_EXECUTION_REBIND');
      }else if(old.turn_id!==null&&old.turn_id!==ex.turn_id)reject(409,'TASK_EXECUTION_REBIND');
      // A requested resume stays bound to the stopped command until a new
      // independently identified command is accepted by the original host.
      if(prior.state==='resume_requested'&&b.state==='agent_received'&&ex.command_id===old.command_id)
        reject(409,'TASK_EXECUTION_REBIND');
    }
    if(!old||ex.command_id!==old.command_id){
      if(this.db.prepare("SELECT 1 FROM queue_revisions WHERE owner=? AND kind='task' AND json_extract(body,'$.execution.command_id')=? LIMIT 1").get(owner,ex.command_id))
        reject(409,'TASK_EXECUTION_ID_CONFLICT');
    }
    if(['stop_requested','stop_unconfirmed','stopped'].includes(b.state)){
      // A resume rejected before dispatch may return to its original stopped
      // command; all other stop states must describe the current stop target.
      if(control.kind!=='stop'&&!(b.state==='stopped'&&prior.state==='resume_requested'&&equalOptional(ex,old)))reject(409,'TASK_CONTROL_INVALID');
      if(control.expected_command_id!==ex.command_id||control.expected_turn_id!==ex.turn_id)reject(409,'TASK_CONTROL_STALE');
    }
    if(prior.state==='stop_requested'&&b.state==='running'&&Date.parse(control.expires_at)>now)
      reject(409,'TASK_CONTROL_PENDING');
  }
  queueApply(owner,kind,objectId,event,now,principal=null){
    const b=event.body,route=canonical(b.route??null),head=this.queueHead(owner,kind,objectId);
    if(kind==='task'||kind==='request'||kind==='message'){
      if(head&&head.route!==route)reject(409,'ROUTE_MISMATCH');
      if(!head&&b.revision!==1)reject(409,'REVISION_CONFLICT',{current_revision:0});
      if(kind==='task'&&!head&&b.state!=='queued')reject(409,'STATE_CONFLICT',{current_state:null});
      if(kind==='task'&&!head)this.queueTaskControl(owner,b,null,principal,now,event);
      if(head){
        if(b.revision!==head.revision+1)reject(409,'REVISION_CONFLICT',{current_revision:head.revision});
        const prior=JSON.parse(this.queueRevision(owner,kind,objectId,head.revision).body);
        if(kind==='task'){
          const sameExtended=b.state===head.state&&Boolean(prior.execution)&&!['completed','failed','cancelled','expired','stopped'].includes(b.state);
          if(!sameExtended&&!TASK_TRANSITIONS[head.state].includes(b.state))reject(409,'STATE_CONFLICT',{current_state:head.state});
          this.queueTaskControl(owner,b,prior,principal,now,event);
        }
        if(kind==='request'){
          if(!REQUEST_PUBLISH[head.state].includes(b.state))reject(409,'STATE_CONFLICT',{current_state:head.state});
          if(prior.task_id!==b.task_id)reject(409,'ROUTE_MISMATCH');
        }
        if(kind==='message'&&(prior.task_id!==b.task_id||prior.request_id!==b.request_id))reject(409,'ROUTE_MISMATCH');
      }
      if(kind==='request'){
        const task=this.queueHead(owner,'task',b.task_id);if(!task)reject(404,'TASK_NOT_FOUND');
        if(task.route!==route)reject(409,'ROUTE_MISMATCH');
        if(b.mode==='choice'&&(b.options.length<2||new Set(b.options.map(o=>o.option_id)).size!==b.options.length))reject(400,'INVALID_OPTIONS');
        if(b.mode==='free_text'&&b.options.length)reject(400,'INVALID_OPTIONS');
        if(!head&&b.state!=='pending')reject(409,'STATE_CONFLICT');
      }
      if(kind==='message'){
        const task=this.queueHead(owner,'task',b.task_id);if(!task)reject(404,'TASK_NOT_FOUND');
        if(task.route!==route)reject(409,'ROUTE_MISMATCH');
        if(b.request_id!==null){
          const request=this.queueHead(owner,'request',b.request_id);if(!request)reject(404,'REQUEST_NOT_FOUND');
          if(request.route!==route||JSON.parse(this.queueRevision(owner,'request',b.request_id,request.revision).body).task_id!==b.task_id)reject(409,'ROUTE_MISMATCH');
        }
      }
    }else if(kind==='answer'){
      const request=this.queueHead(owner,'request',b.request_id);if(!request)reject(404,'REQUEST_NOT_FOUND');
      if(head)reject(409,'ANSWER_ID_CONFLICT');
      if(request.route!==route)reject(409,'ROUTE_MISMATCH');
      if(b.request_revision!==request.revision)reject(409,'STALE_REQUEST',{current_revision:request.revision});
      if(request.state==='answered')reject(409,'ANSWER_ALREADY_ACCEPTED');
      if(request.state==='withdrawn'||request.state==='expired')reject(410,'REQUEST_CLOSED');
      const published=this.queueRevision(owner,'request',b.request_id,b.request_revision);if(published.expires<=now)reject(410,'EXPIRED');
      const body=JSON.parse(published.body);
      if(b.task_id!==body.task_id)reject(409,'ROUTE_MISMATCH');
      const task=this.queueHead(owner,'task',body.task_id);if(!task)reject(404,'TASK_NOT_FOUND');
      if(task.route!==route)reject(409,'ROUTE_MISMATCH');
      if(TASK_CLOSED_TO_ANSWERS.has(task.state))reject(409,'TASK_CLOSED');
      if(b.option_id!==null&&!body.options.some(o=>o.option_id===b.option_id))reject(400,'INVALID_OPTIONS');
      if(b.option_id===null&&!b.text.trim())reject(400,'INVALID');
    }else if(kind==='receipt'){
      if(head){
        const row=this.queueRevision(owner,kind,objectId,1);
        if(row.body_hash!==sha(canonical(b)))reject(409,'IDEMPOTENCY_CONFLICT');
        const original=this.db.prepare('SELECT response FROM events WHERE owner=? AND event_id=?').get(owner,row.event_id);
        if(!original)reject(409,'IDEMPOTENCY_CONFLICT');
        return {revision:1,seq:row.seq,storedAt:row.stored_at,duplicate:JSON.parse(original.response)};
      }
      // A receipt must point at an object revision that really exists.
      const exists=b.subject_kind==='material'
        ?this.db.prepare('SELECT 1 FROM revisions WHERE owner=? AND id=? AND revision=?').get(owner,b.subject_id,b.subject_revision)
        :this.queueRevision(owner,b.subject_kind,b.subject_id,b.subject_revision);
      if(!exists)reject(404,'SUBJECT_NOT_FOUND');
    }
    const revision=kind==='answer'||kind==='receipt'?1:b.revision;
    // Only tasks and requests publish a state; answers, receipts and messages are facts/notices.
    const rowState=kind==='task'||kind==='request'?b.state:'recorded';
    this.db.prepare('INSERT INTO queue_counters VALUES (?,1) ON CONFLICT(owner) DO UPDATE SET seq=seq+1').run(owner);
    const seq=this.queueCeiling(owner),storedAt=iso(now);
    this.db.prepare('INSERT INTO queue_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(owner,kind,objectId,revision,canonical(b),
      event.schema_version,sha(canonical(b)),seq,storedAt,event.event_id,Date.parse(event.expires_at),rowState);
    const headState=kind==='answer'?'answered':rowState;
    this.db.prepare('INSERT INTO queue_heads VALUES (?,?,?,?,?,?) ON CONFLICT(owner,kind,object_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,route=excluded.route')
      .run(owner,kind,objectId,revision,headState,route);
    // The accepted answer is what makes a request answered; a client cannot publish that state.
    if(kind==='answer')this.db.prepare("UPDATE queue_heads SET state='answered' WHERE owner=? AND kind='request' AND object_id=?").run(owner,b.request_id);
    return {revision,seq,storedAt};
  }
  queueRead(token,kind){
    const allowed=QUEUE_READ[kind];if(!allowed)reject(400,'INVALID_QUERY');
    const p=this.auth(token),scopes=new Set(JSON.parse(p.scopes));
    if(!allowed.some(s=>scopes.has(s)))reject(403,'FORBIDDEN');
    return {p,scopes};
  }
  queueGet(token,kind,objectId){
    const {p}=this.queueRead(token,kind),head=this.queueHead(p.owner,kind,objectId);if(!head)reject(404,QUEUE_MISSING[kind]);
    if(kind==='request'&&JSON.parse(p.scopes).includes('receipts:phone')&&!this.phones.permits(p))reject(409,'PRIMARY_PHONE_REQUIRED');
    if(p.sessionRoute&&p.sessionRoute!==head.route)reject(404,QUEUE_MISSING[kind]);
    const item=this.queueItem(this.queueRevision(p.owner,kind,objectId,head.revision),head.state);
    const receiptsOf=(subjectKind,subject)=>this.db.prepare("SELECT body FROM queue_revisions WHERE owner=? AND kind='receipt' AND json_extract(body,'$.subject_kind')=? AND json_extract(body,'$.subject_id')=? ORDER BY seq")
      .all(p.owner,subjectKind,subject).map(r=>JSON.parse(r.body));
    // Each fact stays separate: the object lists only receipts about itself, and an
    // accepted answer carries its own ladder (user_answered → agent_received → …).
    // Preserve historical revision facts: their subject_revision remains explicit
    // and must not be interpreted as confirmation of the current head revision.
    item.receipts=receiptsOf(kind,objectId);
    if(kind==='request'){
      const answer=this.db.prepare("SELECT * FROM queue_revisions WHERE owner=? AND kind='answer' AND json_extract(body,'$.request_id')=? ORDER BY seq LIMIT 1").get(p.owner,objectId);
      item.answer=answer?{...this.queueItem(answer),receipts:receiptsOf('answer',answer.object_id)}:null;
    }
    return item;
  }
  reconcileRequest(token,requestId,command){
    if(!id(requestId)||!command||Object.keys(command).length!==2||command.schema_version!=='1.0'||
      !Number.isSafeInteger(command.request_revision)||command.request_revision<1)reject(400,'INVALID');
    return this.tx(()=>{
      const p=this.auth(token,'requests:write'),now=this.clock();
      const head=this.queueHead(p.owner,'request',requestId);if(!head||p.sessionRoute&&p.sessionRoute!==head.route)reject(404,'REQUEST_NOT_FOUND');
      if(head.revision!==command.request_revision)reject(409,'STALE_REQUEST',{current_revision:head.revision});
      let changed=false,reason=null;
      if(['pending','presented'].includes(head.state)){
        const row=this.queueRevision(p.owner,'request',requestId,head.revision),body=JSON.parse(row.body);
        const task=this.queueHead(p.owner,'task',body.task_id);if(!task||task.route!==head.route)reject(409,'ROUTE_MISMATCH');
        const closed=TASK_CLOSED_TO_ANSWERS.has(task.state);
        const state=closed?'withdrawn':row.expires<=now?'expired':null;
        if(state){
          // Like answer acceptance, closure is a server-owned fact about this
          // immutable question revision. It never edits the original envelope,
          // renews its deadline, or fabricates a task-cancelled receipt.
          this.db.prepare("UPDATE queue_heads SET state=? WHERE owner=? AND kind='request' AND object_id=? AND revision=?")
            .run(state,p.owner,requestId,head.revision);
          const key='lifecycle-'+sha(canonical([p.owner,requestId,head.revision,state]));
          const receipt={receipt_id:key,subject_kind:'request',subject_id:requestId,subject_revision:head.revision,
            stage:state==='expired'?'expired':'cancelled',actor_id:'server-lifecycle',related_event_id:row.event_id,error:null};
          const event={schema_version:'1.0',event_id:key,idempotency_key:key,kind:'receipt',producer_id:'server-lifecycle',
            created_at:iso(now),expires_at:iso(now+86400000),body:receipt};
          this.validateQueue(event,'receipt');
          const stored=this.queueApply(p.owner,'receipt',key,event,now);
          const response=this.queueReceipt(event,'receipt',key,1,stored.seq,stored.storedAt);
          this.saveEvent({owner:p.owner,producer:'server-lifecycle'},event,sha(canonical(event)),response);
          changed=true;reason=closed?'task_closed':'deadline';
        }
      }
      return {schema_version:'1.0',changed,reason,server_time:iso(now),item:this.queueGet(token,'request',requestId)};
    });
  }
  inbox(token,query={}){
    const p=this.auth(token),scopes=new Set(JSON.parse(p.scopes));
    const primary=this.phones.permits(p);
    const kinds=['task','request','message'].filter(k=>QUEUE_READ[k].some(s=>scopes.has(s))&&(primary||k==='task'));
    if(!kinds.length)reject(403,'FORBIDDEN');
    if(Object.keys(query).some(k=>k!=='cursor'&&k!=='limit'))reject(400,'INVALID_QUERY');
    const limit=query.limit===undefined?20:Number(query.limit);
    if(!Number.isSafeInteger(limit)||limit<1||limit>50||!/^\d+$/.test(String(query.limit??20)))reject(400,'INVALID_QUERY');
    const hash=sha(canonical(p.sessionRoute?{kinds,route:p.sessionRoute}:{kinds})),state=this.cursor(query.cursor,p.owner,'inbox',hash,()=>this.queueCeiling(p.owner));
    const rows=this.db.prepare(`SELECT * FROM queue_revisions WHERE owner=? AND seq<=? AND kind IN (${kinds.map(()=>'?').join(',')}) AND seq>? ${p.sessionRoute?"AND json_extract(body,'$.route')=?":''} ORDER BY seq LIMIT ?`)
      .all(p.owner,state.ceiling,...kinds,state.last,...(p.sessionRoute?[p.sessionRoute]:[]),limit+1);
    const items=[];let bytes=8192,last=state.last;
    for(const row of rows.slice(0,limit)){
      const head=this.queueHead(p.owner,row.kind,row.object_id),item=this.queueItem(row,head?.state);
      const size=Buffer.byteLength(JSON.stringify(item));if(bytes+size>MAX_PAGE)break;items.push(item);bytes+=size;last=row.seq;
    }
    const hasMore=rows.length>items.length;if(!hasMore)last=state.ceiling;
    const now=this.clock();return {items,has_more:hasMore,next_cursor:this.signCursor({v:1,owner:p.owner,kind:'inbox',filter:hash,last,
      ceiling:!hasMore?null:state.ceiling,expires:now+86400000}),server_time:iso(now),fresh_until:iso(now)};
  }
  ceiling(owner){return this.db.prepare('SELECT seq FROM counters WHERE owner=?').get(owner)?.seq??0;}
  get(token,materialId,revision=null){
    const p=this.auth(token,'materials:read');
    if(revision!==null&&(!Number.isSafeInteger(revision)||revision<1))reject(400,'INVALID_QUERY');
    const head=this.db.prepare('SELECT * FROM materials WHERE owner=? AND id=?').get(p.owner,materialId);
    if(!head)reject(404,'MATERIAL_NOT_FOUND');if(head.deleted)reject(410,'MATERIAL_DELETED');
    const row=this.db.prepare('SELECT * FROM revisions WHERE owner=? AND id=? AND revision=?').get(p.owner,materialId,revision??head.revision);
    if(!row)reject(404,'MATERIAL_NOT_FOUND');return this.item(row);
  }
  item(row){return {schema_version:row.schema_version,body:JSON.parse(row.body),commit_seq:row.seq,stored_at:row.stored_at};}
  signCursor(value){const payload=Buffer.from(canonical(value)).toString('base64url');return payload+'.'+createHmac('sha256',this.cursorSecret).update(payload).digest('base64url');}
  cursor(raw,owner,kind,filter,ceiling=()=>this.ceiling(owner)){
    if(!raw)return {last:0,ceiling:ceiling()};
    try{
      if(typeof raw!=='string'||raw.length>4096)throw 0;const parts=raw.split('.');if(parts.length!==2)throw 0;
      const mac=Buffer.from(parts[1],'base64url'),expected=createHmac('sha256',this.cursorSecret).update(parts[0]).digest();
      if(mac.length!==expected.length||!timingSafeEqual(mac,expected))throw 0;
      const v=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
      if(v.v!==1||v.owner!==owner||v.kind!==kind||v.filter!==filter||v.expires<=this.clock()||!Number.isSafeInteger(v.last)||v.last<0||
        (v.ceiling!==null&&(!Number.isSafeInteger(v.ceiling)||v.ceiling<v.last)))throw 0;
      const current=ceiling();
      if(v.last>current||(v.ceiling!==null&&v.ceiling>current))throw 0;
      return {last:v.last,ceiling:v.ceiling??current};
    }catch{reject(410,'CURSOR_RESET_REQUIRED');}
  }
  page(token,kind,query={}){
    const summaries=kind==='daily-summaries',p=this.auth(token,summaries?'daily-summaries:read':kind==='changes'?'changes:read':'materials:read');
    const allowed=summaries?['cursor','limit','from','to','keyword']:kind==='changes'?['cursor','limit','content']:['cursor','limit','from','to','keyword','speaker','content'];
    if(query.content!==undefined&&query.content!=='reference')reject(400,'INVALID_QUERY');
    if(Object.keys(query).some(k=>!allowed.includes(k)))reject(400,'INVALID_QUERY');
    const limit=query.limit===undefined?20:Number(query.limit);
    if(!Number.isSafeInteger(limit)||limit<1||limit>50||!/^\d+$/.test(String(query.limit??20)))reject(400,'INVALID_QUERY');
    const filters=query.content?{content:query.content}:{};for(const k of ['from','to','keyword','speaker'])if(query[k]!==undefined){
      if(typeof query[k]!=='string'||!query[k]||query[k].length>512)reject(400,'INVALID_QUERY');filters[k]=query[k];
    }
    if(summaries){
      for(const day of [filters.from,filters.to].filter(Boolean))if(!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)reject(400,'INVALID_QUERY');
      if(filters.from&&filters.to&&filters.to<filters.from)reject(400,'INVALID_QUERY');
    }else if((filters.from&&!timestamp(filters.from))||(filters.to&&!timestamp(filters.to))||
      (filters.from&&filters.to&&Date.parse(filters.to)<Date.parse(filters.from)))reject(400,'INVALID_QUERY');
    const hash=sha(canonical(filters)),state=this.cursor(query.cursor,p.owner,kind,hash),args=[p.owner,state.ceiling];
    let sql;
    if(kind==='changes')sql=`SELECT r.* FROM revisions r WHERE r.owner=? AND r.seq<=?
      AND (r.deleted=1 OR NOT EXISTS(SELECT 1 FROM materials m WHERE m.owner=r.owner AND m.id=r.id AND m.deleted=1))`;
    else sql=`WITH heads AS (SELECT id,MAX(revision) revision FROM revisions WHERE owner=? AND seq<=? GROUP BY id)
      SELECT r.* FROM heads h JOIN revisions r ON r.id=h.id AND r.revision=h.revision
      JOIN materials m ON m.owner=r.owner AND m.id=r.id WHERE r.owner=? AND r.deleted=0 AND m.deleted=0`;
    if(kind!=='changes')args.push(p.owner);
    sql+=' AND r.seq>?';args.push(state.last);
    // DailySummary.java owns this source projection. Never expose historical transcripts or audio
    // through a paired Agent's narrower daily-summary permission.
    if(summaries){
      sql+=" AND r.id LIKE 'daily-%' AND json_extract(r.body,'$.source')='agent_analysis' AND json_array_length(r.body,'$.utterances')=0 AND json_extract(r.body,'$.audio.state')='not_retained' AND json_extract(r.body,'$.full_text.format')='markdown' AND json_extract(r.body,'$.full_text.text') GLOB '# ????-??-?? 每日 AI 总结*'";
      if(filters.from){sql+=" AND substr(json_extract(r.body,'$.full_text.text'),3,10)>=?";args.push(filters.from);}
      if(filters.to){sql+=" AND substr(json_extract(r.body,'$.full_text.text'),3,10)<=?";args.push(filters.to);}
    }else{
      if(filters.from){sql+=' AND r.ended>=?';args.push(Date.parse(filters.from));}
      if(filters.to){sql+=' AND r.started<=?';args.push(Date.parse(filters.to));}
    }
    if(filters.keyword){sql+=' AND instr(r.search_text,?)>0';args.push(filters.keyword.toLowerCase());}
    if(filters.speaker){sql+=" AND EXISTS(SELECT 1 FROM json_each(r.body,'$.utterances') u WHERE json_extract(u.value,'$.speaker_id')=?)";args.push(filters.speaker);}
    sql+=' ORDER BY r.seq LIMIT ?';args.push(limit+1);
    const rows=this.db.prepare(sql).all(...args),items=[];let bytes=8192,last=state.last;
    for(const row of rows.slice(0,limit)){
      const material=this.item(row),body=material.body,item=summaries?{material_id:body.material_id,revision:body.revision,date:body.full_text.text.slice(2,12),text:body.full_text.text,started_at:body.started_at,ended_at:body.ended_at,stored_at:material.stored_at,source_ref:{server_id:this.devices.serverId(),material_id:body.material_id,revision:body.revision},content_role:'source_data'}:materialWire(material,query.content),size=Buffer.byteLength(JSON.stringify(item));
      if(bytes+size>MAX_PAGE)break;items.push(item);bytes+=size;last=row.seq;
    }
    const hasMore=rows.length>items.length;
    // Empty/final pages advance through nonmatching gaps. Changes release the
    // snapshot ceiling for the next poll; snapshot cursors keep their ceiling.
    if(!hasMore)last=state.ceiling;
    const now=this.clock();return {items,has_more:hasMore,next_cursor:this.signCursor({v:1,owner:p.owner,kind,filter:hash,last,
      ceiling:kind==='changes'&&!hasMore?null:state.ceiling,expires:now+86400000}),server_time:iso(now),fresh_until:iso(now),...(summaries?{coverage:{scope:'server_stored_daily_ai_summaries',phone_sync_status:'unknown'}}:{})};
  }
}

function utf16PairBoundary(text,index){
  return index>0&&index<text.length&&text.charCodeAt(index-1)>=0xD800&&text.charCodeAt(index-1)<=0xDBFF&&
    text.charCodeAt(index)>=0xDC00&&text.charCodeAt(index)<=0xDFFF;
}
function sameMaterialSource(a,b){
  const capture=v=>canonical({material_id:v.material_id,source:v.source,started_at:v.started_at,ended_at:v.ended_at,completeness:v.completeness});
  if(capture(a)!==capture(b))return false;
  if(canonical(a.audio)===canonical(b.audio))return true;
  // File availability may become honestly missing without changing the
  // original capture/extent. Do not allow restoring/replacing the audio here.
  return a.audio.state==='local'&&a.audio.object_id===null&&b.audio.state==='missing'&&b.audio.sha256===null&&b.audio.object_id===null;
}
function sameProcessingCoverage(a,b){
  const old=a.processing??{source_ms:null,covered_ms:null,transcription_state:'unknown',speaker:'unknown',recognition_channel:'unknown',boundary:'unknown'};
  return old.source_ms===b.processing.source_ms&&old.covered_ms===b.processing.covered_ms&&
    old.transcription_state===b.processing.transcription_state&&old.speaker===b.processing.speaker&&
    old.recognition_channel===b.processing.recognition_channel&&
    (b.processing.boundary===old.boundary||b.processing.boundary==='unknown');
}
