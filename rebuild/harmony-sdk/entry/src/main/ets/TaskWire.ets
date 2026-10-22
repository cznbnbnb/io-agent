// P43 queue protocol. These are the existing P14/P40 objects, not a second
// task protocol. No defaults generate IDs or silently create a session.
export class TaskRoute {
  computer_id:string='';agent_id:string='';project_id:string='';session_id:string='';
}
export class TaskCommandBody {
  task_id:string='';revision:number=1;route:TaskRoute=new TaskRoute();state:string='queued';
  command:string='';allow_create_session:boolean=false;
}
export class TaskOption { option_id:string='';label:string=''; }
export class TaskRequestBody {
  request_id:string='';revision:number=1;task_id:string='';route:TaskRoute=new TaskRoute();
  mode:string='free_text';question:string='';options:TaskOption[]=[];state:string='pending';runtime_request_id:string|null=null;
}
export class TaskAnswerBody {
  answer_id:string='';request_id:string='';request_revision:number=1;task_id:string='';route:TaskRoute=new TaskRoute();
  option_id:string|null=null;text:string='';input_source:string='phone';raw_action:null=null;
}
export class TaskMessageBody {
  message_id:string='';revision:number=1;route:TaskRoute=new TaskRoute();task_id:string='';request_id:string|null=null;
  channel:string='progress';text:string='';
}
export class TaskReceiptError { code:string='';retryable:boolean=false;detail:string=''; }
export class TaskReceiptBody {
  receipt_id:string='';subject_kind:string='';subject_id:string='';subject_revision:number=1;stage:string='';
  actor_id:string='';related_event_id:string='';error:TaskReceiptError|null=null;
}
export type TaskBody=TaskCommandBody|TaskRequestBody|TaskAnswerBody|TaskMessageBody|TaskReceiptBody;
export class TaskEnvelope {
  schema_version:string='1.0';event_id:string='';idempotency_key:string='';kind:string='task';producer_id:string='';
  created_at:string='';expires_at:string='';body:TaskBody=new TaskCommandBody();
}
export class TaskObject {
  schema_version:string='1.0';kind:string='';object_id:string='';revision:number=0;commit_seq:number=0;
  stored_at:string='';event_id:string='';expires_at:string='';command_expires_at:string='';state:string='';
  body:TaskBody=new TaskCommandBody();receipts:TaskReceiptBody[]=[];answer:TaskObject|null=null;
}
export class TaskAck {
  schema_version:string='';event_id:string='';kind:string='';object_id:string='';revision:number=0;commit_seq:number=0;
  stored_at:string='';receipt:TaskReceiptBody=new TaskReceiptBody();
}
export class TaskInboxPage {
  items:TaskObject[]=[];has_more:boolean=false;next_cursor:string='';server_time:string='';fresh_until:string='';
}
export function taskId(value:string):boolean {return typeof value==='string'&&value.length>0&&value.length<=512;}
export function taskStamp(value:string):boolean {return typeof value==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));}
export function taskPositive(value:number):boolean {return Number.isSafeInteger(value)&&value>0;}
export function taskRouteValid(route:TaskRoute):boolean {
  return !!route&&taskId(route.computer_id)&&taskId(route.agent_id)&&taskId(route.project_id)&&taskId(route.session_id);
}
export function taskSameRoute(a:TaskRoute,b:TaskRoute):boolean {
  return taskRouteValid(a)&&taskRouteValid(b)&&a.computer_id===b.computer_id&&a.agent_id===b.agent_id&&a.project_id===b.project_id&&a.session_id===b.session_id;
}
export function taskObjectId(kind:string,body:TaskBody):string {
  if(kind==='task')return (body as TaskCommandBody).task_id;
  if(kind==='request')return (body as TaskRequestBody).request_id;
  if(kind==='answer')return (body as TaskAnswerBody).answer_id;
  if(kind==='message')return (body as TaskMessageBody).message_id;
  if(kind==='receipt')return (body as TaskReceiptBody).receipt_id;
  return '';
}
export function taskBodyRevision(kind:string,body:TaskBody):number {
  if(kind==='answer'||kind==='receipt')return 1;
  return (body as TaskCommandBody).revision;
}
const taskStates:string[]=['queued','agent_received','running','waiting_answer','cancel_requested','cancelled','completed','failed','expired','execution_unknown'];
const requestStates:string[]=['pending','presented','answered','withdrawn','expired'];
export function taskReceiptValid(r:TaskReceiptBody):boolean {
  return !!r&&taskId(r.receipt_id)&&['material','task','request','answer','message','receipt'].includes(r.subject_kind)&&
    taskId(r.subject_id)&&taskPositive(r.subject_revision)&&taskId(r.actor_id)&&taskId(r.related_event_id)&&
    ['server_stored','phone_received','glasses_displayed','user_answered','agent_received','task_resumed','task_completed','cancel_requested','cancelled','failed','expired'].includes(r.stage)&&
    (r.error===null||(!!r.error&&taskId(r.error.code)&&typeof r.error.retryable==='boolean'&&typeof r.error.detail==='string'&&r.error.detail.length<=512));
}
export function taskBodyValid(kind:string,body:TaskBody):boolean {
  if(!body||!taskId(taskObjectId(kind,body))||!taskPositive(taskBodyRevision(kind,body)))return false;
  if(kind==='receipt')return taskReceiptValid(body as TaskReceiptBody);
  if(!taskRouteValid((body as TaskCommandBody).route))return false;
  if(kind==='task') {const b=body as TaskCommandBody;return taskStates.includes(b.state)&&b.allow_create_session===false&&typeof b.command==='string'&&b.command.length>0&&b.command.length<=65536;}
  if(kind==='request') {const b=body as TaskRequestBody;
    if(!taskId(b.task_id)||!requestStates.includes(b.state)||!['choice','free_text'].includes(b.mode)||typeof b.question!=='string'||!b.question||b.question.length>4096||
      !Array.isArray(b.options)||b.options.length>4||(b.runtime_request_id!==null&&!taskId(b.runtime_request_id)))return false;
    const seen:string[]=[];
    for(const o of b.options){if(!o||!taskId(o.option_id)||!taskId(o.label)||seen.includes(o.option_id))return false;seen.push(o.option_id);}
    return b.mode==='choice'?b.options.length>=2:b.options.length===0;
  }
  if(kind==='answer') {const b=body as TaskAnswerBody;return taskId(b.request_id)&&taskId(b.task_id)&&taskPositive(b.request_revision)&&
    (b.option_id===null||taskId(b.option_id))&&typeof b.text==='string'&&b.text.length<=65536&&(b.option_id!==null||!!b.text.trim())&&
    ['phone','voice','glasses_semantic'].includes(b.input_source)&&b.raw_action===null;}
  if(kind==='message') {const b=body as TaskMessageBody;return taskId(b.task_id)&&(b.request_id===null||taskId(b.request_id))&&
    ['command','question','answer','progress','result','cancel'].includes(b.channel)&&typeof b.text==='string'&&b.text.length<=65536;}
  return false;
}
export function taskObjectValid(item:TaskObject,allowAnswer:boolean=true):boolean {
  if(!item||!['task','request','message','answer'].includes(item.kind)||item.schema_version!=='1.0'||!taskId(item.object_id)||
    !taskId(item.event_id)||!taskPositive(item.revision)||!taskPositive(item.commit_seq)||!taskStamp(item.stored_at)||!taskStamp(item.expires_at)||
    !taskBodyValid(item.kind,item.body)||item.object_id!==taskObjectId(item.kind,item.body)||item.revision!==taskBodyRevision(item.kind,item.body))return false;
  if(item.kind==='task'&&(!taskStates.includes(item.state)||(item.command_expires_at!==undefined&&item.command_expires_at!==''&&!taskStamp(item.command_expires_at))))return false;
  if(item.kind==='request'&&!requestStates.includes(item.state))return false;
  if(['message','answer'].includes(item.kind)&&item.state!=='recorded')return false;
  if(item.receipts!==undefined){if(!Array.isArray(item.receipts)||item.receipts.length>1000)return false;
    for(const r of item.receipts)if(!taskReceiptValid(r)||r.subject_kind!==item.kind||r.subject_id!==item.object_id||r.subject_revision>item.revision)return false;}
  if(item.answer!==undefined&&item.answer!==null){
    if(!allowAnswer||item.kind!=='request'||item.state!=='answered'||item.answer.kind!=='answer'||!taskObjectValid(item.answer,false))return false;
    const a=item.answer.body as TaskAnswerBody,b=item.body as TaskRequestBody;
    if(a.request_id!==item.object_id||a.request_revision!==item.revision||a.task_id!==b.task_id||!taskSameRoute(a.route,b.route))return false;
  }
  return true;
}
export function taskAckValid(ack:TaskAck,event:TaskEnvelope):boolean {
  const r=ack?.receipt;
  return !!ack&&ack.schema_version==='1.0'&&ack.event_id===event.event_id&&ack.kind===event.kind&&
    ack.object_id===taskObjectId(event.kind,event.body)&&ack.revision===taskBodyRevision(event.kind,event.body)&&
    taskPositive(ack.commit_seq)&&taskStamp(ack.stored_at)&&taskReceiptValid(r)&&r.subject_kind===ack.kind&&r.subject_id===ack.object_id&&
    r.subject_revision===ack.revision&&r.related_event_id===ack.event_id&&r.stage==='server_stored'&&r.actor_id==='server-storage'&&r.error===null;
}

// Presentation gate only; submission still refreshes request/task and server
// CAS decides. Missing parent or another route cannot become an answer target.
export function taskRequestCanAnswer(item:TaskObject,parent:TaskObject|undefined,now:number):boolean {
  if(item.kind!=='request'||!['pending','presented'].includes(item.state)||item.answer||Date.parse(item.expires_at)<=now||
    !parent||parent.kind!=='task'||!['queued','agent_received','running','waiting_answer'].includes(parent.state))return false;
  const request=item.body as TaskRequestBody,task=parent.body as TaskCommandBody;
  return parent.object_id===request.task_id&&taskSameRoute(request.route,task.route);
}
