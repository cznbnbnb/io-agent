import {canonical,sha,reject} from './json.mjs';
const iso=n=>new Date(n).toISOString();
const DAILY="r.id LIKE 'daily-%' AND json_extract(r.body,'$.source')='agent_analysis' AND json_array_length(r.body,'$.utterances')=0 AND json_extract(r.body,'$.audio.state')='not_retained' AND json_extract(r.body,'$.full_text.format')='markdown' AND json_extract(r.body,'$.full_text.text') GLOB '# ????-??-?? 每日 AI 总结*'";
const TASKS=`FROM queue_heads h JOIN queue_revisions r ON r.owner=h.owner AND r.kind=h.kind AND r.object_id=h.object_id AND r.revision=h.revision LEFT JOIN admin_task_marks m ON m.owner=h.owner AND m.id=h.object_id`;
const CLOSED=new Set(['completed','cancelled','failed','expired','stopped']);
const fields=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const id=v=>typeof v==='string'&&v.length>0&&v.length<=128&&/^[A-Za-z0-9_.:-]+$/.test(v);

/** Owner comes only from the authenticated admin session. No bearer minting. */
export class AdminConsole {
 constructor(store){this.store=store;this.db=store.db;this.db.exec(`
  CREATE TABLE IF NOT EXISTS admin_delivery(owner TEXT NOT NULL,producer TEXT NOT NULL,paused INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(owner,producer)) STRICT;
  CREATE TABLE IF NOT EXISTS admin_task_marks(owner TEXT NOT NULL,id TEXT NOT NULL,favorite INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,trashed INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL,PRIMARY KEY(owner,id)) STRICT;
  CREATE TABLE IF NOT EXISTS admin_audit(seq INTEGER PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,detail TEXT NOT NULL,at INTEGER NOT NULL) STRICT;
  CREATE INDEX IF NOT EXISTS admin_audit_owner ON admin_audit(owner,seq);`);}
 deliveryPaused(owner,producer){return this.db.prepare('SELECT paused FROM admin_delivery WHERE owner=? AND producer=?').get(owner,producer)?.paused===1;}
 sessions(owner){const now=this.store.clock(),selected=this.store.agentSessions.defaultView(owner);return {default:selected,items:this.db.prepare('SELECT * FROM agent_sessions WHERE owner=? ORDER BY label,route_key').all(owner).map(row=>{
  const view=this.store.agentSessions.view(row,now);const {instance_id,lease_id,...safe}=view;
  return {...safe,key:sha(row.route_key),delivery_paused:this.deliveryPaused(owner,row.producer),is_default:selected.route!==null&&canonical(selected.route)===row.route_key};
 })};}
 devices(owner,traffic){
  const primary=this.db.prepare('SELECT * FROM primary_phones WHERE owner=?').get(owner),now=this.store.clock();
  const last=new Map(traffic?traffic.db.prepare('SELECT producer,max(at) at FROM recent WHERE owner=? GROUP BY producer').all(owner).map(r=>[r.producer,r.at]):[]);
  const sessions=this.sessions(owner).items;
  return {primary:primary?{device_id:primary.device_id,revision:primary.revision,active_after:iso(primary.active_after),lease_until:iso(primary.lease_until)}:null,
   items:this.store.devices.listOwner(owner).map(d=>({...d,delivery_paused:this.deliveryPaused(owner,d.producer_id),last_seen:last.has(d.producer_id)?iso(last.get(d.producer_id)):null,
    recent_contact:!d.revoked&&last.has(d.producer_id)&&now-last.get(d.producer_id)<90000,primary:primary?.device_id===d.device_id,
    glasses_lease_live:!d.revoked&&primary?.device_id===d.device_id&&primary.active_after<=now&&primary.lease_until>now,
    account_bound:!!this.db.prepare('SELECT 1 FROM phone_accounts WHERE owner=? AND device_id=?').get(owner,d.device_id),sessions:sessions.filter(s=>s.device_id===d.device_id).length,executable_sessions:sessions.filter(s=>s.device_id===d.device_id&&s.online&&s.capabilities.can_execute&&!s.delivery_paused).length}))};
 }
 read(owner,section,query,traffic){
  const allowed={overview:[],devices:[],sessions:['q','status'],tasks:['q','state','group','workspace','offset'],task:['id'],daily:['q','from','to','kind','offset'],summary:['id'],history:['id','before'],traffic:['hours','producer','route','status','offset'],audit:['offset']};
  if(!Object.hasOwn(allowed,section)||Object.keys(query).some(k=>!allowed[section].includes(k))||Object.values(query).some(v=>typeof v!=='string'||v.length>512))reject(400,'INVALID_ADMIN_QUERY');
  const offset=Number(query.offset??0);if(!/^(0|[1-9]\d*)$/.test(query.offset??'0')||!Number.isSafeInteger(offset)||offset>100000)reject(400,'INVALID_ADMIN_QUERY');
  const now=this.store.clock();
  if(section==='devices')return this.devices(owner,traffic);
  if(section==='sessions'){
   if(query.status&&!['online','offline','executable'].includes(query.status))reject(400,'INVALID_ADMIN_QUERY');
   const result=this.sessions(owner),selected=result.items.find(s=>s.is_default)??null;
   return {...result,default_session:selected,items:result.items.filter(s=>(!query.q||[s.label,s.workspace,s.host_kind].join(' ').toLowerCase().includes(query.q.toLowerCase()))&&(!query.status||query.status==='online'&&s.online||query.status==='offline'&&!s.online||query.status==='executable'&&s.online&&s.capabilities.can_execute&&!s.delivery_paused))};
  }
  if(section==='overview'){
   const devices=this.devices(owner,traffic),sessions=this.sessions(owner),queue=this.store.operationsForOwner(owner);
   const daily=this.db.prepare(`SELECT COUNT(*) count,MAX(r.stored_at) last FROM materials m JOIN revisions r ON r.owner=m.owner AND r.id=m.id AND r.revision=m.revision WHERE r.owner=? AND m.deleted=0 AND ${DAILY}`).get(owner);
   return {server_time:iso(now),devices,sessions,queue,daily,traffic:traffic?traffic.inspect(owner,{hours:24,offset:0}):{available:false},recent_actions:this.db.prepare('SELECT username,action,target,detail,at FROM admin_audit WHERE owner=? ORDER BY seq DESC LIMIT 5').all(owner)};
  }
  if(section==='traffic'){
   const hours=Number(query.hours??24);if(![1,6,24,168].includes(hours)||query.status&&!['ok','error'].includes(query.status)||query.producer&&!id(query.producer)||query.route&&!/^[a-z-]{1,40}$/.test(query.route))reject(400,'INVALID_ADMIN_QUERY');
   const result=traffic?traffic.inspect(owner,{hours,offset,producer:query.producer,route:query.route,status:query.status}):{available:false};
   return {...result,devices:this.store.devices.listOwner(owner)};
  }
  if(section==='audit'){const rows=this.db.prepare('SELECT seq,username,action,target,detail,at FROM admin_audit WHERE owner=? ORDER BY seq DESC LIMIT 51 OFFSET ?').all(owner,offset);return {items:rows.slice(0,50),has_more:rows.length>50,offset};}
  if(section==='tasks'){
   if(query.group&&!['all','favorite','archived','trash'].includes(query.group))reject(400,'INVALID_ADMIN_QUERY');
   if(query.state&&!['active','waiting','done','failed'].includes(query.state))reject(400,'INVALID_ADMIN_QUERY');
   const args=[owner];let where="WHERE h.owner=? AND h.kind='task'";
   if(query.group==='trash')where+=' AND m.trashed=1';else where+=' AND COALESCE(m.trashed,0)=0';
   if(query.group==='favorite')where+=' AND m.favorite=1';
   if(query.group==='archived')where+=' AND m.archived=1';
   else if(!query.group||query.group==='all')where+=' AND COALESCE(m.archived,0)=0';
   if(query.state==='active')where+=" AND h.state IN ('queued','agent_received','running','waiting_answer','resume_requested','stop_requested','execution_unknown','stop_unconfirmed')";
   if(query.state==='waiting')where+=" AND h.state='waiting_answer'";
   if(query.state==='done')where+=" AND h.state IN ('completed','cancelled','stopped','expired')";
   if(query.state==='failed')where+=" AND h.state IN ('failed','execution_unknown','stop_unconfirmed')";
   if(query.q){where+=" AND (instr(lower(json_extract(r.body,'$.command')),?)>0 OR instr(lower(h.object_id),?)>0)";args.push(query.q.toLowerCase(),query.q.toLowerCase());}
   if(query.workspace){where+=" AND json_extract(h.route,'$.project_id')=?";args.push(query.workspace);}
   const total=this.db.prepare(`SELECT COUNT(*) count ${TASKS} ${where}`).get(...args).count;
   const rows=this.db.prepare(`SELECT h.object_id,h.state,h.route,r.revision,r.stored_at,r.expires,substr(json_extract(r.body,'$.command'),1,200) title,COALESCE(m.favorite,0) favorite,COALESCE(m.archived,0) archived,COALESCE(m.trashed,0) trashed ${TASKS} ${where} ORDER BY r.seq DESC LIMIT 50 OFFSET ?`).all(...args,offset);
   return {items:rows.map(r=>({...r,route:JSON.parse(r.route),deadline_passed:r.expires<=now})),total,offset,has_more:offset+rows.length<total,sessions:this.sessions(owner).items};
  }
  if(section==='task'){
   if(!id(query.id))reject(400,'INVALID_ADMIN_QUERY');
   const head=this.store.queueHead(owner,'task',query.id);if(!head)reject(404,'TASK_NOT_FOUND');
   const task=this.store.queueItem(this.store.queueRevision(owner,'task',query.id,head.revision),head.state);
   const children=this.db.prepare("SELECT h.kind,h.object_id,h.state,h.revision,r.body,r.stored_at FROM queue_heads h JOIN queue_revisions r ON r.owner=h.owner AND r.kind=h.kind AND r.object_id=h.object_id AND r.revision=h.revision WHERE h.owner=? AND h.kind IN ('request','answer','message') AND json_extract(r.body,'$.task_id')=? ORDER BY r.seq DESC LIMIT 101").all(owner,query.id);
   const receipts=this.db.prepare("SELECT body,stored_at FROM queue_revisions WHERE owner=? AND kind='receipt' AND ((json_extract(body,'$.subject_kind')='task' AND json_extract(body,'$.subject_id')=?) OR EXISTS (SELECT 1 FROM queue_revisions child WHERE child.owner=? AND json_extract(child.body,'$.task_id')=? AND child.kind=json_extract(queue_revisions.body,'$.subject_kind') AND child.object_id=json_extract(queue_revisions.body,'$.subject_id'))) ORDER BY seq DESC LIMIT 201").all(owner,query.id,owner,query.id);
   return {task,children:children.slice(0,100).map(r=>({...r,body:JSON.parse(r.body)})),receipts:receipts.slice(0,200).map(r=>({...JSON.parse(r.body),stored_at:r.stored_at})),truncated:children.length>100||receipts.length>200,marks:this.db.prepare('SELECT favorite,archived,trashed FROM admin_task_marks WHERE owner=? AND id=?').get(owner,query.id)??{favorite:0,archived:0,trashed:0},sessions:this.sessions(owner).items};
  }
  if(section==='history')return this.store.lifelog.history(owner,{material_id:query.id,...(query.before?{before:Number(query.before)}:{})});
  if(section==='daily'){
   const result=this.store.lifelog.query(owner,{...(query.from?{from:query.from}:{}),...(query.to?{to:query.to}:{}),...(query.q?{keyword:query.q}:{}),kind:query.kind||'summary',limit:30},{offset,preview:true,descending:true});
   return {...result,items:result.items.map(s=>({...s,id:s.material_id})),offset};
  }
  if(section==='summary'){
   if(!id(query.id))reject(400,'INVALID_ADMIN_QUERY');const sources=this.store.lifelog.sources(owner),source=sources.find(s=>s.id===query.id);if(!source)reject(404,'MATERIAL_NOT_FOUND');
   const edits=this.store.lifelog.edits(owner);return {...this.store.lifelog.effective(owner,source,edits.get(source.id),sources,edits),id:source.id};
  }

 }
 action(session,input){
  if(input?.action==='lifelog-revert'){
   if(!fields(input,['action','correction'])||!input.correction||input.correction.edits!==undefined||input.correction.note!==undefined)reject(400,'INVALID_ADMIN_INPUT');
   const result=this.store.lifelog.change(session.owner,'admin:'+session.username,{...input.correction,agent:session.username});
   this.db.prepare('INSERT INTO admin_audit(owner,username,action,target,detail,at) VALUES (?,?,?,?,?,?)').run(session.owner,session.username,'lifelog-revert',result.material_id,'correction:'+result.correction_revision,this.store.clock());return {ok:true,result};
  }

  const keys={rename:['action','device_id','label'],delivery:['action','device_id','paused'],unpair:['action','device_id'],primary:['action','device_id','expected_revision'],default:['action','key','expected_revision'],mark:['action','ids','field','value']};
  if(!input||!Object.hasOwn(keys,input.action)||!fields(input,keys[input.action]))reject(400,'INVALID_ADMIN_INPUT');
  const {owner,username}=session,now=this.store.clock(),action=input.action;
  if(['rename','delivery','unpair','primary'].includes(action)&&!id(input.device_id))reject(400,'INVALID_ADMIN_INPUT');
  if(action==='rename'&&(typeof input.label!=='string'||!input.label.trim()||input.label.trim()!==input.label||input.label.length>64||/[\x00-\x1f\x7f]/.test(input.label)))reject(400,'INVALID_ADMIN_INPUT');
  if(action==='delivery'&&typeof input.paused!=='boolean'||action==='default'&&input.key!==null&&(typeof input.key!=='string'||!/^[a-f0-9]{64}$/.test(input.key))||['primary','default'].includes(action)&&(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<0))reject(400,'INVALID_ADMIN_INPUT');
  if(action==='mark'&&(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>50||new Set(input.ids).size!==input.ids.length||!input.ids.every(id)||!['favorite','archived','trashed'].includes(input.field)||typeof input.value!=='boolean'))reject(400,'INVALID_ADMIN_INPUT');
  return this.store.tx(()=>{
   let target='',detail='',result;
   if(['rename','delivery','unpair','primary'].includes(action)){
    const d=this.db.prepare('SELECT * FROM devices WHERE owner=? AND device_id=?').get(owner,input.device_id);if(!d)reject(404,'DEVICE_NOT_FOUND');
    if(d.revoked_at!==null&&action!=='unpair')reject(409,'DEVICE_REVOKED');target=d.label;
    if(action==='rename'){this.db.prepare('UPDATE devices SET label=? WHERE owner=? AND device_id=?').run(input.label,owner,d.device_id);detail=input.label;}
    if(action==='delivery'){this.db.prepare('INSERT INTO admin_delivery VALUES (?,?,?,?) ON CONFLICT(owner,producer) DO UPDATE SET paused=excluded.paused,updated=excluded.updated').run(owner,d.producer,Number(input.paused),now);detail=input.paused?'paused':'resumed';this.store.pendingInboxOwners.add(owner);}
    if(action==='unpair'){this.store.devices.revokeInTransaction(d.device_id);detail='revoked';}
    if(action==='primary'){this.store.phones.selectPrimary(owner,d.device_id,input.expected_revision,now);detail='primary';}
   }else if(action==='default'){
    const row=input.key===null?null:this.db.prepare('SELECT * FROM agent_sessions WHERE owner=?').all(owner).find(r=>sha(r.route_key)===input.key);
    if(input.key!==null&&!row)reject(404,'AGENT_SESSION_NOT_FOUND');
    result=this.store.agentSessions.setOwnerDefault(owner,input.expected_revision,row?JSON.parse(row.route):null,now);target=row?.label??'未指定';detail='default';
   }else{
    for(const task of input.ids){const head=this.store.queueHead(owner,'task',task);if(!head)reject(404,'TASK_NOT_FOUND');
     if(input.field==='trashed'&&input.value&&!CLOSED.has(head.state)&&!(head.state==='queued'&&this.store.queueRevision(owner,'task',task,1).expires<=now))reject(409,'ADMIN_TASK_ACTIVE');
     this.db.prepare('INSERT OR IGNORE INTO admin_task_marks(owner,id,updated) VALUES (?,?,?)').run(owner,task,now);
     this.db.prepare(`UPDATE admin_task_marks SET ${input.field}=?,updated=? WHERE owner=? AND id=?`).run(Number(input.value),now,owner,task);
    }target=input.ids.join(',');detail=input.field+':'+input.value;
   }
   this.db.prepare('INSERT INTO admin_audit(owner,username,action,target,detail,at) VALUES (?,?,?,?,?,?)').run(owner,username,action,target,detail,now);
   return {ok:true,action,result:result??null,at:iso(now)};
  });
 }
}
