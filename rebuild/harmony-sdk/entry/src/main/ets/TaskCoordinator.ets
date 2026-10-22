import { TaskMailbox, TaskPending, TaskCached } from './TaskMailbox';
import { TaskTransport, TaskTarget } from './TaskTransport';
import { TaskSettings, validateTaskSettings } from './TaskSettings';
import { TaskRoute, TaskOption, TaskEnvelope, TaskCommandBody, TaskRequestBody, TaskAnswerBody, taskObjectId,taskRequestCanAnswer } from './TaskWire';
import { TaskReplyBinding,taskReplyBindingValid } from './TaskReplyDraft';

export class TaskSummary {
  enabled:boolean=false;foreground:boolean=false;busy:boolean=false;configuring:boolean=false;contextKey:string='';note:string='disabled';
  queued:number=0;drafts:number=0;stored:number=0;blocked:number=0;expired:number=0;withdrawn:number=0;
}
export class TaskSendView {
  operationId:string='';objectId:string='';kind:string='';state:string='';error:string='';text:string='';
  session:string='';deadline:string='';canWithdraw:boolean=false;canRecheck:boolean=false;
}
// Ability lifetime owner. No page starts/stops the durable queue. Background
// pauses network; local drafts survive. Configuration drains the old writer.
export class TaskCoordinator {
  changed:()=>void=():void=>{};
  beforeAnswerSend:(operation:string,event:TaskEnvelope)=>void=(_operation:string,event:TaskEnvelope):void=>{
    if(event.kind==='answer'&&(event.body as TaskAnswerBody).input_source==='voice')throw new Error('TASK_VOICE_SOURCE_UNVERIFIED');
  };
  private filesDir:string;private mailbox:TaskMailbox|undefined=undefined;private transport:TaskTransport|undefined=undefined;
  private target:TaskTarget|undefined=undefined;private route:TaskRoute=new TaskRoute();
  private enabled:boolean=false;private foreground:boolean=false;private configuring:boolean=false;
  private generation:number=0;private contextKey:string='';private note:string='disabled';
  private flight:Promise<void>|undefined=undefined;private timer:number=-1;private lastPoll:number=0;private refreshIndex:number=0;
  constructor(filesDir:string){this.filesDir=filesDir;}
  private notify():void{try{this.changed();}catch{}}
  private clearTimer():void{if(this.timer>=0)clearTimeout(this.timer);this.timer=-1;}
  async configure(profile:TaskSettings|undefined):Promise<void>{
    const value=profile?JSON.parse(JSON.stringify(profile)) as TaskSettings:undefined;
    if(value)validateTaskSettings(value);
    const generation=++this.generation;this.configuring=true;this.enabled=false;this.contextKey='';this.target=undefined;
    this.clearTimer();this.transport?.cancel();this.note='configuring';this.notify();await this.flight?.catch(():void=>{});
    if(generation!==this.generation)return;
    this.mailbox=undefined;this.transport=undefined;this.route=new TaskRoute();
    try{if(value?.target.baseUrl){
      const mailbox=new TaskMailbox();mailbox.initialize(this.filesDir,value.target.principal);
      this.mailbox=mailbox;this.transport=new TaskTransport();this.transport.beforeSend=(operation:string,event:TaskEnvelope):void=>this.beforeAnswerSend(operation,event);this.transport.setForeground(this.foreground);
      this.target=value.target;this.route=value.route;this.enabled=value.enabled;
      const p=value.target.principal,r=value.route;
      this.contextKey=JSON.stringify([p.ownerId,p.producerId,p.serverId,r.computer_id,r.agent_id,r.project_id,r.session_id]);
    }
      this.lastPoll=0;this.refreshIndex=0;this.note=this.enabled?(this.foreground?'ready':'paused'):'disabled';
    }catch{this.note='TASK_CONFIGURATION_FAILED';throw new Error(this.note);}
    finally{this.configuring=false;this.notify();this.schedule();}
  }
  setForeground(value:boolean):void {
    this.foreground=value;this.clearTimer();this.transport?.setForeground(value);
    if(this.enabled)this.note=value?'ready':'paused';this.notify();this.schedule();
  }
  private schedule():void {
    if(this.timer>=0||this.flight||this.configuring||!this.foreground||!this.enabled||!this.target||!this.mailbox||!this.transport)return;
    const now=Date.now();let delay=Math.max(1000,15000-(now-this.lastPoll));
    if(this.transport.hasMore||this.mailbox.firstDraft())delay=1000;
    for(const row of this.mailbox.pending())if(['queued','reconcile','retry_wait'].includes(row.state))delay=Math.min(delay,Math.max(1000,row.next_attempt_at-now));
    delay=Math.max(delay,Math.min(300000,Math.max(0,this.transport.nextCheckAt-now)));
    if(['AUTH_REQUIRED','UNAUTHENTICATED','FORBIDDEN','TASK_IDENTITY_MISMATCH'].includes(this.note))delay=Math.max(delay,30000);
    this.timer=setTimeout(():void=>{this.timer=-1;this.tick().catch(():void=>{});},delay);
  }
  private perform(action:()=>Promise<void>):Promise<void> {
    if(this.flight)throw new Error('TASK_NETWORK_BUSY');this.clearTimer();
    const work=Promise.resolve().then(action);this.flight=work.finally(():void=>{this.flight=undefined;this.notify();this.schedule();});return this.flight;
  }
  tick():Promise<void> {
    if(this.flight)return this.flight;
    if(!this.foreground||!this.enabled||this.configuring||!this.mailbox||!this.transport||!this.target)return Promise.resolve();
    const mailbox=this.mailbox,transport=this.transport,target=this.target,generation=this.generation;
    return this.perform(async():Promise<void>=>{
      if(generation!==this.generation||!this.foreground)return;
      try{
        for(let n=0;n<2;n++){
          const due=mailbox.firstDraft()||mailbox.pending().some((r:TaskPending):boolean=>['queued','reconcile','retry_wait'].includes(r.state)&&r.next_attempt_at<=Date.now());
          if(!due||generation!==this.generation||!this.foreground)break;
          const processed=await transport.pump(mailbox,target);if(generation!==this.generation||!this.foreground)return;
          this.note=transport.note;if(!processed)break;
        }
        if(Date.now()<transport.nextCheckAt)return;
        if(transport.hasMore||Date.now()-this.lastPoll>=15000){
          const received=await transport.poll(mailbox,target);if(generation!==this.generation||!this.foreground)return;
          this.note=transport.note;if(!received)return;this.lastPoll=Date.now();
          // Inbox doesn't republish a request merely because an answer/receipt
          // was accepted. Read one rotating detail after a successful poll.
          const objects=mailbox.objects().slice(-20);
          if(objects.length&&!transport.hasMore){const item=objects[this.refreshIndex++%objects.length].item;
            await transport.refresh(mailbox,target,item.kind,item.object_id);if(generation!==this.generation||!this.foreground)return;this.note=transport.note;}
        }
      }catch{if(generation===this.generation)this.note='TASK_NEEDS_ATTENTION';}
    });
  }
  private usable(key:string):TaskMailbox {
    if(!this.enabled||this.configuring||!this.target||!this.mailbox||!key||key!==this.contextKey)throw new Error('TASK_PROFILE_CHANGED');return this.mailbox;
  }
  delegate(key:string,operation:string,command:string,ttlMs:number):void {
    if(!Number.isSafeInteger(ttlMs)||ttlMs<60000||ttlMs>86400000)throw new Error('TASK_DEADLINE_INVALID');
    const mailbox=this.usable(key),now=Date.now();mailbox.delegate(operation,this.route,command,now,now+ttlMs);this.notify();this.clearTimer();this.schedule();
  }
  answer(key:string,operation:string,requestId:string,revision:number,option:string|null,text:string):void {
    this.usable(key).draftAnswer(operation,requestId,revision,option,text,Date.now());this.notify();this.clearTimer();this.schedule();
  }
  bindReply(key:string,operation:string,id:string,revision:number):TaskReplyBinding{
    const mailbox=this.usable(key),cached=mailbox.objects().find((row:TaskCached):boolean=>row.item.kind==='request'&&row.item.object_id===id),item=cached?.item;
    const request=item?.body as TaskRequestBody,parent=mailbox.objects().find((row:TaskCached):boolean=>row.item.kind==='task'&&row.item.object_id===request?.task_id)?.item;
    if(!item||item.revision!==revision||!taskRequestCanAnswer(item,parent,Date.now()))throw new Error('TASK_REQUEST_CLOSED');
    const binding=new TaskReplyBinding();binding.context_key=key;binding.operation_id=operation;binding.request_id=id;binding.request_revision=revision;
    binding.task_id=request.task_id;binding.route=JSON.parse(JSON.stringify(request.route)) as TaskRoute;binding.expires_at=item.expires_at;
    binding.question=request.question;binding.mode=request.mode;binding.options=JSON.parse(JSON.stringify(request.options)) as TaskOption[];
    if(!taskReplyBindingValid(binding))throw new Error('TASK_REPLY_BINDING_INVALID');return binding;
  }
  answerBound(binding:TaskReplyBinding,option:string|null,text:string,source:string):string{
    if(!taskReplyBindingValid(binding))throw new Error('TASK_REPLY_BINDING_INVALID');
    const row=this.usable(binding.context_key).draftBoundAnswer(binding,option,text,source,Date.now());this.notify();this.clearTimer();this.schedule();return row.state;
  }
  validateReply(binding:TaskReplyBinding):void{this.usable(binding.context_key).validateBoundReply(binding,Date.now());}
  operationExists(operation:string):boolean{
    if(!this.mailbox)throw new Error('TASK_UNAVAILABLE');
    // Recovery must check the entire outbox, not the recent-20 UI projection.
    return this.mailbox.pending().some((row:TaskPending):boolean=>row.operation_id===operation);
  }
  revalidateReply(binding:TaskReplyBinding):Promise<void>{
    if(!taskReplyBindingValid(binding))throw new Error('TASK_REPLY_BINDING_INVALID');
    const mailbox=this.usable(binding.context_key),transport=this.transport,target=this.target,generation=this.generation;
    if(!this.foreground||!transport||!target)throw new Error('TASK_PAUSED');
    return this.perform(async():Promise<void>=>{
      if(generation!==this.generation||!this.foreground)throw new Error('TASK_PROFILE_CHANGED');
      if(!await transport.refresh(mailbox,target,'request',binding.request_id))throw new Error(transport.note);
      if(generation!==this.generation||!this.foreground)throw new Error('TASK_PROFILE_CHANGED');
      if(!await transport.refresh(mailbox,target,'task',binding.task_id))throw new Error(transport.note);
      if(generation!==this.generation||!this.foreground)throw new Error('TASK_PROFILE_CHANGED');
      this.usable(binding.context_key).validateBoundReply(binding,Date.now());this.note='refreshed';
    });
  }
  withdraw(key:string,operation:string):void {this.usable(key).withdrawUnsent(operation);this.notify();}
  recheck(key:string,operation:string):void {this.usable(key).recheck(operation);this.notify();this.clearTimer();this.schedule();}
  refresh(key:string,kind:string,id:string):Promise<void> {
    const mailbox=this.usable(key),transport=this.transport,target=this.target,generation=this.generation;
    if(!this.foreground||!transport||!target)throw new Error('TASK_PAUSED');
    return this.perform(async():Promise<void>=>{await transport.refresh(mailbox,target,kind,id);
      if(generation===this.generation)this.note=transport.note;});
  }
  cancelTask(key:string,operation:string,id:string,revision:number):Promise<void> {
    const mailbox=this.usable(key),transport=this.transport,target=this.target,generation=this.generation;
    if(!this.foreground||!transport||!target)throw new Error('TASK_PAUSED');
    return this.perform(async():Promise<void>=>{const row=await transport.prepareCancel(mailbox,target,operation,id,revision);
      if(generation!==this.generation)return;this.note=transport.note;if(!row)throw new Error(this.note);});
  }
  summary():TaskSummary {
    const s=new TaskSummary();s.enabled=this.enabled;s.foreground=this.foreground;s.busy=!!this.flight;s.configuring=this.configuring;s.contextKey=this.contextKey;s.note=this.note;
    for(const row of this.mailbox?.pending()||[]){if(row.state==='server_stored')s.stored++;else if(row.state==='blocked')s.blocked++;
      else if(row.state==='expired')s.expired++;else if(row.state==='awaiting_refresh')s.drafts++;else if(row.state==='withdrawn_local')s.withdrawn++;else s.queued++;}return s;
  }
  defaultRoute():TaskRoute{return JSON.parse(JSON.stringify(this.route)) as TaskRoute;}
  objects():TaskCached[]{return this.mailbox?.objects()||[];}
  sends():TaskSendView[]{
    return (this.mailbox?.pending()||[]).slice(-20).reverse().map((row:TaskPending):TaskSendView=>{
      const e=JSON.parse(row.payload) as TaskEnvelope,b=e.body as TaskCommandBody,view=new TaskSendView();
      view.operationId=row.operation_id;view.objectId=taskObjectId(e.kind,e.body);view.kind=e.kind;view.state=row.state;view.error=row.error;
      view.text=e.kind==='task'?b.command:(e.body as TaskAnswerBody).text;view.session=b.route.session_id;view.deadline=e.expires_at;
      view.canWithdraw=row.attempts===0&&!row.needs_lookup&&['queued','awaiting_refresh','expired','blocked'].includes(row.state);
      view.canRecheck=row.attempts>0&&['blocked','expired'].includes(row.state);return view;
    });
  }
  async stop():Promise<void>{this.setForeground(false);await this.configure(undefined);}
}
