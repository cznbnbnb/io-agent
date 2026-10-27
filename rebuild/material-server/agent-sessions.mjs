import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical,sha,reject} from './json.mjs';

export const SESSION_LEASE_MS=60000;
export const SESSION_HEARTBEAT_MS=15000;
export const MAX_AGENT_SESSIONS=128;
export const SESSION_ACK_RETENTION_MS=7*86400000;
const iso=n=>new Date(n).toISOString();
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fields=(v,names)=>object(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(v);
const controls=/[\u0000-\u001f\u007f]/;
const routeValid=r=>fields(r,['computer_id','agent_id','project_id','session_id'])&&
  ['computer_id','agent_id','project_id'].every(k=>identifier(r[k]))&&uuid(r.session_id);
const labelValid=v=>typeof v==='string'&&v.length>=1&&v.length<=64&&Buffer.byteLength(v)<=256&&v.trim()===v&&!controls.test(v);
const reasonValid=v=>v===null||typeof v==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(v);
const workspaceValid=v=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=2048&&!controls.test(v)&&
  (path.posix.isAbsolute(v)&&!v.includes('\\')&&path.posix.normalize(v)===v&&(v==='/'||!v.endsWith('/'))||
   /^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+(?:\\|$))/.test(v)&&path.win32.isAbsolute(v)&&!v.includes('/')&&path.win32.normalize(v)===v&&
   (v===path.win32.parse(v).root||!v.endsWith('\\')));
const capabilityKeys=['can_execute','exact_turn_interrupt','descendants_proof','atomic_queue_append','native_queue_expiry'];
const observationValid=o=>fields(o,['ready','busy',...capabilityKeys,'reason'])&&typeof o.ready==='boolean'&&
  capabilityKeys.every(k=>typeof o[k]==='boolean')&&o.descendants_proof===false&&o.native_queue_expiry===false&&reasonValid(o.reason)&&
  (o.ready?(typeof o.busy==='boolean'||o.busy===null)&&(o.can_execute||o.reason!==null)&&
    (o.busy!==null||!o.can_execute||o.atomic_queue_append):o.busy===null&&capabilityKeys.every(k=>o[k]===false)&&o.reason!==null);
const common=['action','request_id','instance_id','route'];
const actionFields={acquire:[...common,'expected_generation','host_kind','workspace','label','observation'],
  heartbeat:[...common,'generation','lease_id','sequence','observation'],release:[...common,'generation','lease_id','sequence']};

/** Authenticated native-host attestations only. This registry neither probes a
 * computer nor grants authority to execute; native intake rechecks the target. */
export class AgentSessionDirectory {
  constructor(store){
    this.store=store;
    this.db.exec(`CREATE TABLE IF NOT EXISTS agent_computer_bindings(
        owner TEXT NOT NULL,computer_id TEXT NOT NULL,device_id TEXT NOT NULL,producer TEXT NOT NULL,
        PRIMARY KEY(owner,computer_id)) STRICT;
      CREATE TABLE IF NOT EXISTS agent_sessions(
        owner TEXT NOT NULL,route_key TEXT NOT NULL,route TEXT NOT NULL,producer TEXT NOT NULL,device_id TEXT NOT NULL,
        host_kind TEXT NOT NULL,workspace TEXT NOT NULL,label TEXT NOT NULL,generation INTEGER NOT NULL,
        instance_id TEXT NOT NULL,lease_id TEXT NOT NULL,sequence INTEGER NOT NULL,expires INTEGER NOT NULL,
        observation TEXT NOT NULL,released INTEGER NOT NULL,PRIMARY KEY(owner,route_key)) STRICT;
      CREATE TABLE IF NOT EXISTS agent_defaults(owner TEXT PRIMARY KEY,revision INTEGER NOT NULL,route TEXT,updated_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS agent_session_requests(
        owner TEXT NOT NULL,device_id TEXT NOT NULL,request_id TEXT NOT NULL,digest TEXT NOT NULL,response TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(owner,device_id,request_id)) STRICT;`);
    if(!this.db.prepare('PRAGMA table_info(agent_session_requests)').all().some(c=>c.name==='created_at'))
      this.db.exec('ALTER TABLE agent_session_requests ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;');
    this.db.exec('CREATE INDEX IF NOT EXISTS agent_session_request_age ON agent_session_requests(created_at);');
  }
  get db(){return this.store.db;}
  envelope(owner,now){return {schema_version:'1.0',server_id:this.db.prepare("SELECT value FROM meta WHERE key='server_id'").get().value,
    owner_id:owner,server_time:iso(now)};}
  principal(token,publish=false){
    const p=this.store.auth(token,'tasks:update'),d=this.store.devices.device(p);
    if(publish&&(!JSON.parse(p.scopes).includes('receipts:agent')||d.role!=='agent'))reject(403,'FORBIDDEN');
    if(d.owner!==p.owner||d.producer!==p.producer)reject(403,'FORBIDDEN');
    return {p,d};
  }
  replay(p,d,kind,input){
    const expired=this.store.clock()-SESSION_ACK_RETENTION_MS;
    // Counter/route records are permanent; only replay ACKs age out. Prune a
    // bounded batch plus this exact key so an expired PK never blocks reuse.
    this.db.prepare('DELETE FROM agent_session_requests WHERE rowid IN (SELECT rowid FROM agent_session_requests WHERE created_at<=? ORDER BY created_at LIMIT 128)').run(expired);
    this.db.prepare('DELETE FROM agent_session_requests WHERE owner=? AND device_id=? AND request_id=? AND created_at<=?').run(p.owner,d.device_id,input.request_id,expired);
    const digest=sha(canonical({kind,body:input}));
    const old=this.db.prepare('SELECT digest,response FROM agent_session_requests WHERE owner=? AND device_id=? AND request_id=?')
      .get(p.owner,d.device_id,input.request_id);
    if(old&&old.digest!==digest)reject(409,'IDEMPOTENCY_CONFLICT');
    return {digest,response:old?JSON.parse(old.response):null};
  }
  saveReply(p,d,input,digest,response){
    this.db.prepare('INSERT INTO agent_session_requests(owner,device_id,request_id,digest,response,created_at) VALUES (?,?,?,?,?,?)').run(p.owner,d.device_id,input.request_id,digest,JSON.stringify(response),this.store.clock());
    return response;
  }
  row(owner,route){return this.db.prepare('SELECT * FROM agent_sessions WHERE owner=? AND route_key=?').get(owner,canonical(route));}
  view(row,now){
    const observation=JSON.parse(row.observation),device=this.db.prepare('SELECT revoked_at FROM devices WHERE device_id=? AND owner=?').get(row.device_id,row.owner);
    const reason=!device||device.revoked_at!==null?'device_revoked':row.released?'lease_released':row.expires<=now?'lease_expired':observation.reason;
    const online=Boolean(device&&device.revoked_at===null&&!row.released&&row.expires>now&&observation.ready);
    return {route:JSON.parse(row.route),producer_id:row.producer,device_id:row.device_id,host_kind:row.host_kind,workspace:row.workspace,label:row.label,
      generation:row.generation,instance_id:row.instance_id,lease_id:row.lease_id,lease_expires_at:iso(row.expires),online,busy:online?observation.busy:null,
      capabilities:Object.fromEntries(capabilityKeys.map(k=>[k,online&&observation[k]])),reason};
  }
  defaultView(owner){
    const row=this.db.prepare('SELECT * FROM agent_defaults WHERE owner=?').get(owner);
    return row?{revision:row.revision,route:row.route===null?null:JSON.parse(row.route),updated_at:iso(row.updated_at)}:{revision:0,route:null,updated_at:null};
  }
  list(token){
    const p=this.store.auth(token,'tasks:read'),now=this.store.clock();
    const rows=p.sessionRoute?this.db.prepare('SELECT * FROM agent_sessions WHERE owner=? AND route_key=?').all(p.owner,p.sessionRoute):
      this.db.prepare('SELECT * FROM agent_sessions WHERE owner=? ORDER BY route_key').all(p.owner);
    const selected=this.defaultView(p.owner);
    // Preserve the owner-wide CAS revision without disclosing another
    // session's route to a credential approved for this one session only.
    if(p.sessionRoute&&selected.route!==null&&canonical(selected.route)!==p.sessionRoute)selected.route=null;
    return {...this.envelope(p.owner,now),sessions:rows.map(r=>this.view(r,now)),default:selected};
  }
  publish(token,input){
    return this.store.tx(()=>{
      const {p,d}=this.principal(token,true),now=this.store.clock(),keys=Object.hasOwn(actionFields,input?.action)?actionFields[input.action]:null;
      if(!keys||!fields(input,keys)||!uuid(input.request_id)||!uuid(input.instance_id)||!routeValid(input.route))reject(400,'INVALID_AGENT_SESSION');
      if(p.sessionRoute&&canonical(input.route)!==p.sessionRoute)reject(403,'FORBIDDEN');
      if(input.action==='acquire'){
        if(!integer(input.expected_generation)||!['claude','codex','acp'].includes(input.host_kind)||!workspaceValid(input.workspace)||!labelValid(input.label)||
          !observationValid(input.observation)||!input.observation.ready)reject(400,'INVALID_AGENT_SESSION');
      }else if(!integer(input.generation,1)||!uuid(input.lease_id)||!integer(input.sequence,1)||
        input.action==='heartbeat'&&!observationValid(input.observation))reject(400,'INVALID_AGENT_SESSION');
      const replay=this.replay(p,d,'session',input);if(replay.response)return replay.response;
      const current=this.row(p.owner,input.route);
      if(input.action==='acquire'){
        const computer=this.db.prepare('SELECT * FROM agent_computer_bindings WHERE owner=? AND computer_id=?').get(p.owner,input.route.computer_id);
        // A phone-approved session pairing owns exactly one route, not a whole
        // computer. Distinct pairings from the same computer use distinct
        // devices; they may coexist but cannot acquire each other's routes.
        if(!p.sessionRoute&&computer&&(computer.device_id!==d.device_id||computer.producer!==p.producer))reject(409,'COMPUTER_BINDING_CONFLICT');
        if(current&&(current.device_id!==d.device_id||current.producer!==p.producer||current.host_kind!==input.host_kind||current.workspace!==input.workspace))reject(409,'SESSION_BINDING_CONFLICT');
        if(input.expected_generation!==(current?.generation??0))reject(409,'SESSION_GENERATION_CONFLICT',{current_generation:current?.generation??0});
        if(current&&!current.released&&current.expires>now)reject(409,'SESSION_LEASE_ACTIVE');
        if(!current&&this.db.prepare('SELECT COUNT(*) AS count FROM agent_sessions WHERE owner=?').get(p.owner).count>=MAX_AGENT_SESSIONS)reject(409,'AGENT_SESSION_LIMIT');
        if(current?.generation===Number.MAX_SAFE_INTEGER)reject(409,'SESSION_GENERATION_CONFLICT');
        if(!p.sessionRoute&&!computer)this.db.prepare('INSERT INTO agent_computer_bindings VALUES (?,?,?,?)').run(p.owner,input.route.computer_id,d.device_id,p.producer);
        const route=canonical(input.route),generation=(current?.generation??0)+1;
        this.db.prepare(`INSERT INTO agent_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(owner,route_key) DO UPDATE SET label=excluded.label,generation=excluded.generation,
          instance_id=excluded.instance_id,lease_id=excluded.lease_id,sequence=0,expires=excluded.expires,observation=excluded.observation,released=0`)
          .run(p.owner,route,route,p.producer,d.device_id,input.host_kind,input.workspace,input.label,generation,input.instance_id,randomUUID(),0,now+SESSION_LEASE_MS,canonical(input.observation),0);
      }else{
        if(!current)reject(404,'AGENT_SESSION_NOT_FOUND');
        if(current.device_id!==d.device_id||current.producer!==p.producer)reject(409,'SESSION_BINDING_CONFLICT');
        if(current.generation!==input.generation||current.instance_id!==input.instance_id||current.lease_id!==input.lease_id||current.released)reject(409,'SESSION_LEASE_STALE');
        if(current.expires<=now)reject(410,'SESSION_LEASE_EXPIRED');
        if(input.sequence<=current.sequence)reject(409,'SESSION_SEQUENCE_STALE');
        this.db.prepare('UPDATE agent_sessions SET sequence=?,expires=?,observation=?,released=? WHERE owner=? AND route_key=?')
          .run(input.sequence,input.action==='release'?now:now+SESSION_LEASE_MS,input.action==='heartbeat'?canonical(input.observation):current.observation,
            input.action==='release'?1:0,p.owner,current.route_key);
      }
      const response={...this.envelope(p.owner,now),session:this.view(this.row(p.owner,input.route),now)};
      return this.saveReply(p,d,input,replay.digest,response);
    });
  }
  setDefault(token,input){
    return this.store.tx(()=>{
      const {p,d}=this.principal(token),now=this.store.clock();
      if(!fields(input,['request_id','expected_revision','route'])||!uuid(input.request_id)||!integer(input.expected_revision)||input.route!==null&&!routeValid(input.route))reject(400,'INVALID_AGENT_DEFAULT');
      if(p.sessionRoute&&input.route!==null&&canonical(input.route)!==p.sessionRoute)reject(403,'FORBIDDEN');
      const replay=this.replay(p,d,'default',input);if(replay.response)return replay.response;
      const current=this.defaultView(p.owner);
      if(p.sessionRoute&&input.route===null&&current.route!==null&&canonical(current.route)!==p.sessionRoute)reject(403,'FORBIDDEN');
      if(current.revision!==input.expected_revision||current.revision===Number.MAX_SAFE_INTEGER)reject(409,'DEFAULT_REVISION_CONFLICT',{current_revision:current.revision});
      if(input.route!==null){
        const target=this.row(p.owner,input.route);if(!target)reject(404,'AGENT_SESSION_NOT_FOUND');
        const view=this.view(target,now);if(!view.online||!view.capabilities.can_execute)reject(409,'DEFAULT_SESSION_UNAVAILABLE');
      }
      this.db.prepare(`INSERT INTO agent_defaults VALUES (?,?,?,?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,route=excluded.route,updated_at=excluded.updated_at`)
        .run(p.owner,current.revision+1,input.route===null?null:canonical(input.route),now);
      return this.saveReply(p,d,input,replay.digest,{...this.envelope(p.owner,now),default:this.defaultView(p.owner)});
    });
  }
}
