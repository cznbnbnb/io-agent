import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { HarmonySha256 } from 'turbo_core';
import { TaskRoute, TaskEnvelope, TaskCommandBody, TaskAnswerBody, TaskObject, TaskRequestBody, TaskAck, TaskInboxPage,
  taskBodyValid, taskObjectValid, taskAckValid, taskStamp, taskId, taskSameRoute,taskRequestCanAnswer } from './TaskWire';
import { TaskReplyBinding,taskReplyBindingValid } from './TaskReplyDraft';

export class TaskPrincipal { ownerId:string='';producerId:string='';serverId:string=''; }
export class TaskPending {
  operation_id:string='';payload:string='';state:string='queued';attempts:number=0;needs_lookup:boolean=false;
  next_attempt_at:number=0;error:string='';ack:TaskAck|null=null;
}
export class TaskCached { item:TaskObject=new TaskObject();detail_at:number=0; }
class TaskSnapshot {
  schema:number=1;principal:TaskPrincipal=new TaskPrincipal();cursor:string='';outbox:TaskPending[]=[];objects:TaskCached[]=[];
}
export class TaskClaim {
  operationId:string='';eventId:string='';attempt:number=0;action:string='send';payload:string='';partition:string='';
}
class TaskErrorBody { code:string='';retryable:boolean=true; }
class TaskErrorResponse { schema_version:string='';error:TaskErrorBody=new TaskErrorBody(); }

// A single fsync+rename commits inbox objects AND their cursor together. Commands
// and answers retain their original serialized bytes in the same snapshot. This
// store owns no credentials, network, timers, capture or Agent execution.
export class TaskMailbox {
  private path:string='';private digest:string='';private partition:string='';private state:TaskSnapshot=new TaskSnapshot();
  private ready:boolean=false;
  private copy(value:TaskSnapshot):TaskSnapshot{return JSON.parse(JSON.stringify(value)) as TaskSnapshot;}
  private hash(text:string):string {
    const bytes=new util.TextEncoder().encodeInto(text);
    try{return Array.from(new HarmonySha256().digest(bytes)).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}
    finally{bytes.fill(0);}
  }
  private time(now:number):void {if(!Number.isSafeInteger(now)||now<0||!Number.isFinite(new Date(now).getTime()))throw new Error('TASK_TIME_INVALID');}
  private envelope(row:TaskPending):TaskEnvelope {
    const e=JSON.parse(row.payload) as TaskEnvelope;
    if(e.schema_version!=='1.0'||!taskId(e.event_id)||typeof e.idempotency_key!=='string'||e.idempotency_key.length<8||e.idempotency_key.length>256||
      e.producer_id!==this.state.principal.producerId||!['task','answer'].includes(e.kind)||!taskBodyValid(e.kind,e.body)||
      !taskStamp(e.created_at)||!taskStamp(e.expires_at)||Date.parse(e.expires_at)<=Date.parse(e.created_at))throw new Error('TASK_STORE_CORRUPT');
    return e;
  }
  private validate(s:TaskSnapshot):void {
    if(s.schema!==1||!s.principal||s.principal.ownerId!==this.state.principal.ownerId||s.principal.producerId!==this.state.principal.producerId||s.principal.serverId!==this.state.principal.serverId||typeof s.cursor!=='string'||s.cursor.length>4096||
      !Array.isArray(s.outbox)||s.outbox.length>300||!Array.isArray(s.objects)||s.objects.length>500)throw new Error('TASK_STORE_CORRUPT');
    const operations:string[]=[],events:string[]=[],keys:string[]=[];
    for(const row of s.outbox){
      if(!taskId(row.operation_id)||operations.includes(row.operation_id)||typeof row.payload!=='string'||row.payload.length>262144||
        !['withdrawn_local','awaiting_refresh','queued','sending','reconcile','retry_wait','server_stored','expired','blocked'].includes(row.state)||
        !Number.isSafeInteger(row.attempts)||row.attempts<0||!Number.isSafeInteger(row.next_attempt_at)||row.next_attempt_at<0||
        typeof row.needs_lookup!=='boolean'||typeof row.error!=='string'||row.error.length>64)throw new Error('TASK_STORE_CORRUPT');
      const e=this.envelope(row);if(events.includes(e.event_id))throw new Error('TASK_STORE_CORRUPT');
      if(row.state==='awaiting_refresh'&&(e.kind!=='answer'||row.attempts!==0||row.needs_lookup))throw new Error('TASK_STORE_CORRUPT');
      if(row.state==='withdrawn_local'&&(row.attempts!==0||row.needs_lookup))throw new Error('TASK_STORE_CORRUPT');
      if(row.state==='server_stored'?(row.ack===null||!taskAckValid(row.ack,e)):(row.ack!==null))throw new Error('TASK_STORE_CORRUPT');
      operations.push(row.operation_id);events.push(e.event_id);
    }
    for(const entry of s.objects){const item=entry.item,key=item.kind+':'+item.object_id;
      if(!taskObjectValid(item)||keys.includes(key)||!Number.isSafeInteger(entry.detail_at)||entry.detail_at<0)throw new Error('TASK_STORE_CORRUPT');keys.push(key);}
  }
  private publish(next:TaskSnapshot):void {
    if(!this.ready)throw new Error('TASK_STORE_NOT_READY');this.validate(next);
    if(fs.accessSync(this.path)&&fs.statSync(this.path).size>8388608)throw new Error('TASK_STORE_TOO_LARGE');
    if((fs.accessSync(this.path)?this.hash(fs.readTextSync(this.path)):'')!==this.digest)throw new Error('TASK_WRITER_STALE');
    const text=JSON.stringify(next),bytes=new util.TextEncoder().encodeInto(text);
    if(bytes.length>8388608){bytes.fill(0);throw new Error('TASK_STORE_FULL');}
    const file=fs.openSync(this.path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('TASK_STORE_WRITE_FAILED');offset+=n;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}
    fs.renameSync(this.path+'.partial',this.path);this.state=next;this.digest=this.hash(text);
  }
  initialize(filesDir:string,principal:TaskPrincipal):void {
    this.ready=false;this.path='';this.digest='';this.partition='';this.state=new TaskSnapshot();
    if(!principal||[principal.ownerId,principal.producerId,principal.serverId].some((v:string):boolean=>typeof v!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(v)))throw new Error('TASK_PRINCIPAL_INVALID');
    this.state.principal=JSON.parse(JSON.stringify(principal)) as TaskPrincipal;
    const parent=filesDir+'/task-mailbox';if(!fs.accessSync(parent))fs.mkdirSync(parent);
    this.partition=this.hash(JSON.stringify([principal.ownerId,principal.producerId,principal.serverId]));
    const root=parent+'/'+this.partition;if(!fs.accessSync(root))fs.mkdirSync(root);this.path=root+'/state.json';
    if(fs.accessSync(this.path)){
      if(fs.statSync(this.path).size>8388608)throw new Error('TASK_STORE_TOO_LARGE');
      const text=fs.readTextSync(this.path),stored=JSON.parse(text) as TaskSnapshot;this.validate(stored);
      this.state=stored;this.digest=this.hash(text);
    }
    this.ready=true;const recovered=this.copy(this.state);let changed=false;
    for(const row of recovered.outbox)if(row.state==='sending'){row.state='reconcile';row.needs_lookup=true;row.next_attempt_at=0;row.error='INTERRUPTED';changed=true;}
    if(changed)try{this.publish(recovered);}catch(error){this.ready=false;throw error as Error;}
  }
  matches(p:TaskPrincipal):boolean{return this.ready&&p.ownerId===this.state.principal.ownerId&&p.producerId===this.state.principal.producerId&&p.serverId===this.state.principal.serverId;}
  cursor():string {if(!this.ready)throw new Error('TASK_STORE_NOT_READY');return this.state.cursor;}
  pending():TaskPending[] {if(!this.ready)throw new Error('TASK_STORE_NOT_READY');return this.copy(this.state).outbox;}
  objects():TaskCached[] {if(!this.ready)throw new Error('TASK_STORE_NOT_READY');return this.copy(this.state).objects;}
  object(kind:string,id:string):TaskCached|undefined{return this.objects().find((e:TaskCached):boolean=>e.item.kind===kind&&e.item.object_id===id);}
  private enqueue(operation:string,kind:string,body:TaskCommandBody|TaskAnswerBody,now:number,expires:number,initialState:string='queued'):TaskPending {
    if(!this.ready)throw new Error('TASK_STORE_NOT_READY');this.time(now);this.time(expires);
    if(!taskId(operation)||!taskBodyValid(kind,body)||expires<=now||expires-now>86400000)throw new Error('TASK_COMMAND_INVALID');
    const next=this.copy(this.state),prior=next.outbox.find((r:TaskPending):boolean=>r.operation_id===operation);
    if(prior){const e=this.envelope(prior);if(e.kind!==kind||JSON.stringify(e.body)!==JSON.stringify(body))throw new Error('TASK_OPERATION_CONFLICT');return prior;}
    if(next.outbox.length>=300)throw new Error('TASK_STORE_FULL');
    const stable=this.hash(JSON.stringify(['phone-task-v1',this.partition,operation])),e=new TaskEnvelope();
    e.event_id='evt-phone-'+stable;e.idempotency_key='idem-phone-'+stable;e.producer_id=this.state.principal.producerId;
    e.kind=kind;e.body=body;e.created_at=new Date(now).toISOString();e.expires_at=new Date(expires).toISOString();
    const row=new TaskPending();row.operation_id=operation;row.payload=JSON.stringify(e);row.state=initialState;
    const bytes=new util.TextEncoder().encodeInto(row.payload);const size=bytes.length;bytes.fill(0);
    if(size>262144)throw new Error('TASK_EVENT_TOO_LARGE');next.outbox.push(row);this.publish(next);return JSON.parse(JSON.stringify(row)) as TaskPending;
  }
  delegate(operation:string,route:TaskRoute,command:string,now:number,expires:number):TaskPending {
    const body=new TaskCommandBody();body.task_id='task-phone-'+this.hash(JSON.stringify([this.partition,operation]));body.route=JSON.parse(JSON.stringify(route)) as TaskRoute;body.command=command;
    if(!command.trim())throw new Error('TASK_COMMAND_INVALID');return this.enqueue(operation,'task',body,now,expires);
  }
  // Callers must fetch the current request and task detail at the point of user
  // submission. Local validation helps offline UI; server CAS decides the winner.
  private answerFromCache(operation:string,requestId:string,revision:number,option:string|null,text:string,now:number,draft:boolean,expectedRoute:TaskRoute|undefined=undefined,inputSource:string='phone'):TaskPending {
    const cached=this.object('request',requestId);if(!cached||cached.item.revision!==revision||!draft&&cached.detail_at!==now)throw new Error('TASK_REFRESH_REQUIRED');
    const item=cached.item,b=item.body as TaskRequestBody,task=this.object('task',b.task_id);
    if(expectedRoute&&!taskSameRoute(expectedRoute,b.route))throw new Error('TASK_ROUTE_MISMATCH');
    if(!['phone','voice','glasses_semantic'].includes(inputSource))throw new Error('TASK_REPLY_SOURCE_INVALID');
    if(!['pending','presented'].includes(item.state)||item.answer||Date.parse(item.expires_at)<=now)throw new Error('TASK_REQUEST_CLOSED');
    if(!task||!draft&&task.detail_at!==now||!taskSameRoute((task.item.body as TaskCommandBody).route,b.route)||
      ['cancel_requested','cancelled','completed','failed','expired','execution_unknown'].includes(task.item.state))throw new Error('TASK_CLOSED');
    if(option!==null&&!b.options.some((o):boolean=>o.option_id===option))throw new Error('TASK_OPTION_INVALID');
    const body=new TaskAnswerBody();body.answer_id='answer-phone-'+this.hash(JSON.stringify([this.partition,operation]));
    body.request_id=requestId;body.request_revision=revision;body.task_id=b.task_id;body.route=b.route;body.option_id=option;body.text=text;body.input_source=inputSource;
    // The original question's deadline is never extended by an offline answer.
    return this.enqueue(operation,'answer',body,now,Math.min(now+86400000,Date.parse(item.expires_at)),draft?'awaiting_refresh':'queued');
  }
  answer(operation:string,requestId:string,revision:number,option:string|null,text:string,now:number):TaskPending {
    return this.answerFromCache(operation,requestId,revision,option,text,now,false);
  }
  // Offline UI can save an answer to its exact cached question. It remains a
  // draft until authenticated live detail has revalidated that original version.
  draftAnswer(operation:string,requestId:string,revision:number,option:string|null,text:string,now:number):TaskPending {
    return this.answerFromCache(operation,requestId,revision,option,text,now,true);
  }
  draftBoundAnswer(binding:TaskReplyBinding,option:string|null,text:string,source:string,now:number):TaskPending{
    if(!taskReplyBindingValid(binding)||!['phone','voice','glasses_semantic'].includes(source))throw new Error('TASK_REPLY_BINDING_INVALID');
    const prior=this.state.outbox.find((row:TaskPending):boolean=>row.operation_id===binding.operation_id);
    if(prior){
      const event=this.envelope(prior),body=event.body as TaskAnswerBody;
      if(event.kind!=='answer'||body.request_id!==binding.request_id||body.request_revision!==binding.request_revision||body.task_id!==binding.task_id||
        !taskSameRoute(body.route,binding.route)||body.option_id!==option||body.text!==text||body.input_source!==source)throw new Error('TASK_OPERATION_CONFLICT');
      return JSON.parse(JSON.stringify(prior)) as TaskPending;
    }
    this.validateBoundReply(binding,now);
    return this.answerFromCache(binding.operation_id,binding.request_id,binding.request_revision,option,text,now,true,binding.route,source);
  }
  validateBoundReply(binding:TaskReplyBinding,now:number):void{
    if(!taskReplyBindingValid(binding))throw new Error('TASK_REPLY_BINDING_INVALID');
    const cached=this.object('request',binding.request_id),request=cached?.item.body as TaskRequestBody;
    if(!cached||cached.item.revision!==binding.request_revision||request.task_id!==binding.task_id||!taskSameRoute(request.route,binding.route)||
      cached.item.expires_at!==binding.expires_at||request.question!==binding.question||request.mode!==binding.mode||request.options.length!==binding.options.length||
      request.options.some((o,index:number):boolean=>o.option_id!==binding.options[index].option_id||o.label!==binding.options[index].label))throw new Error('TASK_REPLY_BINDING_STALE');
    if(Date.parse(binding.expires_at)<=now)throw new Error('EXPIRED');
    if(!taskRequestCanAnswer(cached.item,this.object('task',binding.task_id)?.item,now))throw new Error('TASK_REQUEST_CLOSED');
  }
  firstDraft():TaskPending|undefined {return this.pending().find((row:TaskPending):boolean=>row.state==='awaiting_refresh');}
  withdrawUnsent(operation:string):void {
    const next=this.copy(this.state),row=next.outbox.find((r:TaskPending):boolean=>r.operation_id===operation);
    if(!row||row.attempts!==0||row.needs_lookup||!['queued','awaiting_refresh','expired','blocked'].includes(row.state))throw new Error('TASK_WITHDRAW_UNCERTAIN');
    row.state='withdrawn_local';row.error='';this.publish(next);
  }
  recheck(operation:string):void {
    const next=this.copy(this.state),row=next.outbox.find((r:TaskPending):boolean=>r.operation_id===operation);
    if(!row||!['blocked','expired'].includes(row.state)||row.attempts===0)throw new Error('TASK_RECHECK_UNAVAILABLE');
    row.state='reconcile';row.needs_lookup=true;row.next_attempt_at=0;row.error='';this.publish(next);
  }
  rejectDraft(operation:string,code:string):void {
    if(!/^[A-Z][A-Z0-9_]{0,63}$/.test(code))throw new Error('TASK_ERROR_INVALID');
    const next=this.copy(this.state),row=next.outbox.find((r:TaskPending):boolean=>r.operation_id===operation);
    if(!row||row.state!=='awaiting_refresh')throw new Error('TASK_DRAFT_STALE');row.state='blocked';row.error=code;this.publish(next);
  }
  confirmDraft(operation:string,request:TaskObject,task:TaskObject,now:number):void {
    this.time(now);if(!taskObjectValid(request)||request.kind!=='request'||!taskObjectValid(task)||task.kind!=='task')throw new Error('TASK_RESPONSE_INVALID');
    const next=this.copy(this.state),row=next.outbox.find((r:TaskPending):boolean=>r.operation_id===operation);
    if(!row||row.state!=='awaiting_refresh')throw new Error('TASK_DRAFT_STALE');const event=this.envelope(row),answer=event.body as TaskAnswerBody;
    const b=request.body as TaskRequestBody;let error='';
    if(request.object_id!==answer.request_id||b.task_id!==answer.task_id||task.object_id!==answer.task_id||
      !taskSameRoute(b.route,answer.route)||!taskSameRoute((task.body as TaskCommandBody).route,answer.route))error='ROUTE_MISMATCH';
    else if(request.revision!==answer.request_revision)error='STALE_REQUEST';
    else if(!['pending','presented'].includes(request.state)||request.answer)error='REQUEST_CLOSED';
    else if(['cancel_requested','cancelled','completed','failed','expired','execution_unknown'].includes(task.state))error='TASK_CLOSED';
    else if(Date.parse(request.expires_at)<=now||Date.parse(event.expires_at)<=now)error='EXPIRED';
    else if(answer.option_id!==null&&!b.options.some((o):boolean=>o.option_id===answer.option_id))error='INVALID_OPTIONS';
    this.merge(next,request,now);this.merge(next,task,now);
    row.state=error==='EXPIRED'?'expired':error?'blocked':'queued';row.error=error;this.publish(next);
  }
  requestCancel(operation:string,taskId:string,revision:number,now:number):TaskPending {
    const entry=this.object('task',taskId);if(!entry||entry.detail_at!==now||entry.item.revision!==revision)throw new Error('TASK_REFRESH_REQUIRED');
    if(!['queued','agent_received','running','waiting_answer'].includes(entry.item.state))throw new Error('TASK_CANCEL_UNAVAILABLE');
    const body=JSON.parse(JSON.stringify(entry.item.body)) as TaskCommandBody;body.revision++;body.state='cancel_requested';
    return this.enqueue(operation,'task',body,now,now+3600000);
  }
  private merge(next:TaskSnapshot,item:TaskObject,detailAt:number):void {
    if(!taskObjectValid(item))throw new Error('TASK_RESPONSE_INVALID');
    const index=next.objects.findIndex((e:TaskCached):boolean=>e.item.kind===item.kind&&e.item.object_id===item.object_id);
    const previous=index>=0?next.objects[index]:undefined;
    if(previous){
      if(!taskSameRoute((previous.item.body as TaskCommandBody).route,(item.body as TaskCommandBody).route))throw new Error('TASK_ROUTE_MISMATCH');
      if(item.revision<previous.item.revision)return;
      if(item.revision===previous.item.revision&&(item.event_id!==previous.item.event_id||item.commit_seq!==previous.item.commit_seq||JSON.stringify(item.body)!==JSON.stringify(previous.item.body)))throw new Error('TASK_REVISION_CONFLICT');
    }else if(next.objects.length>=500)throw new Error('TASK_STORE_FULL');
    const entry=new TaskCached();entry.item=JSON.parse(JSON.stringify(item)) as TaskObject;entry.detail_at=detailAt;
    // An inbox revision does not contain answer/receipt details. Never erase the
    // already observed facts for that same revision when re-reading an old page.
    if(previous&&item.revision===previous.item.revision&&detailAt===0){
      entry.item.receipts=previous.item.receipts??[];entry.item.answer=previous.item.answer??null;
      if(entry.item.answer)entry.item.state='answered';
    }
    if(index>=0)next.objects[index]=entry;else next.objects.push(entry);
  }
  acceptPage(page:TaskInboxPage,expectedCursor:string):void {
    if(!this.ready||this.state.cursor!==expectedCursor)throw new Error('TASK_CURSOR_STALE');
    if(!page||!Array.isArray(page.items)||page.items.length>20||typeof page.has_more!=='boolean'||
      typeof page.next_cursor!=='string'||!page.next_cursor||page.next_cursor.length>4096||
      !taskStamp(page.server_time)||!taskStamp(page.fresh_until)||(page.has_more&&page.items.length===0))throw new Error('TASK_RESPONSE_INVALID');
    const next=this.copy(this.state);let last=0;
    for(const item of page.items){if(!['task','request','message'].includes(item.kind)||item.commit_seq<=last)throw new Error('TASK_RESPONSE_INVALID');last=item.commit_seq;this.merge(next,item,0);}
    next.cursor=page.next_cursor;this.publish(next);
  }
  acceptDetail(item:TaskObject,now:number):void {this.time(now);const next=this.copy(this.state);this.merge(next,item,now);this.publish(next);}
  resetCursor(expectedCursor:string):void {if(this.cursor()!==expectedCursor)throw new Error('TASK_CURSOR_STALE');const next=this.copy(this.state);next.cursor='';this.publish(next);}
  claim(now:number):TaskClaim|undefined {
    this.time(now);const next=this.copy(this.state);if(next.outbox.some((r:TaskPending):boolean=>r.state==='sending'))return undefined;
    let changed=false;
    for(const row of next.outbox){
      if(!['queued','retry_wait','reconcile'].includes(row.state)||row.next_attempt_at>now)continue;
      const e=this.envelope(row);
      if(!row.needs_lookup&&Date.parse(e.expires_at)<=now){row.state='expired';row.error='EXPIRED';changed=true;continue;}
      row.state='sending';row.attempts++;const claim=new TaskClaim();claim.operationId=row.operation_id;claim.eventId=e.event_id;
      claim.attempt=row.attempts;claim.action=row.needs_lookup?'lookup':'send';claim.payload=row.payload;claim.partition=this.partition;
      this.publish(next);return claim;
    }
    if(changed)this.publish(next);return undefined;
  }
  blockUnsent(claim:TaskClaim,code:string,now:number):void{
    this.time(now);if(claim.partition!==this.partition||claim.action!=='send'||!/^TASK_[A-Z_]{1,58}$/.test(code))throw new Error('TASK_CLAIM_STALE');
    const next=this.copy(this.state),row=next.outbox.find((r:TaskPending):boolean=>r.operation_id===claim.operationId);
    if(!row||row.state!=='sending'||row.attempts!==claim.attempt||row.payload!==claim.payload)throw new Error('TASK_CLAIM_STALE');
    // The caller invokes this only before request.request. Keep the immutable
    // envelope; a local evidence rejection is not an invented HTTP response.
    row.state='blocked';row.error=code;row.needs_lookup=false;row.next_attempt_at=0;this.publish(next);
  }
  finish(claim:TaskClaim,status:number,body:string,now:number,retryAfterMs:number=0):void {
    this.time(now);if(claim.partition!==this.partition)throw new Error('TASK_CLAIM_STALE');
    const next=this.copy(this.state),row=next.outbox.find((r:TaskPending):boolean=>r.operation_id===claim.operationId);
    if(!row||row.state!=='sending'||row.attempts!==claim.attempt||row.payload!==claim.payload)throw new Error('TASK_CLAIM_STALE');
    const e=this.envelope(row);let ack:TaskAck|null=null,code='';let absent=false;
    try{if(body.length<=1048576){if(status===200||status===201){const parsed=JSON.parse(body) as TaskAck;if(taskAckValid(parsed,e))ack=parsed;}
      else{const parsed=JSON.parse(body) as TaskErrorResponse;if(parsed.schema_version==='1.0'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(parsed.error?.code)){
        code=parsed.error.code;absent=status===404&&code==='EVENT_NOT_FOUND'&&parsed.error.retryable===false;}}}}catch{}
    if(ack){row.state='server_stored';row.needs_lookup=false;row.error='';row.ack=ack;}
    else if(claim.action==='lookup'&&absent){row.needs_lookup=false;row.state=Date.parse(e.expires_at)<=now?'expired':'queued';row.next_attempt_at=0;row.error=row.state==='expired'?'EXPIRED':'';}
    else if(status===0||status===429||status>=500||status>=200&&status<300){
      row.state='retry_wait';row.needs_lookup=true;row.error=status===0?'TRANSPORT_UNKNOWN':code||'RESPONSE_UNKNOWN';
      const delay=Math.min(300000,1000*Math.pow(2,Math.min(row.attempts,8)));
      row.next_attempt_at=now+Math.max(delay,Number.isSafeInteger(retryAfterMs)&&retryAfterMs>0?retryAfterMs:0);
    }else{row.state=status===410&&code==='EXPIRED'?'expired':'blocked';row.needs_lookup=claim.action==='lookup';row.error=code||'HTTP_REJECTED';}
    this.publish(next);
  }
}
