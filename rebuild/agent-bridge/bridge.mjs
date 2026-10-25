import {createHash} from 'node:crypto';
import {BridgeClient,BridgeError} from './client.mjs';
import {BridgeState} from './state.mjs';
import {BridgeRunLock} from './run-lock.mjs';
import {runtimeEventBatch,runtimeDigest,runtimeSource,runtimeAnswer} from './runtime-events.mjs';

// P41 connection program: outbound-only. It polls the durable inbox, hands items to
// a runtime adapter and writes only what that adapter really accepted. Every write
// is persisted as an envelope before it is sent, so a retry reuses identical bytes
// and a lost network reply is reconciled by event id. Runtime handoff uncertainty
// is tracked separately; network idempotency is not an execution guarantee.
export const AGENT_STAGES=['agent_received','task_resumed','task_completed','cancel_requested','cancelled','failed'];
export const PUBLISHABLE_TASK_STATES=['agent_received','running','waiting_answer','cancel_requested','cancelled','completed','failed','expired','execution_unknown','stop_requested','stop_unconfirmed','stopped'];
const EXECUTION_PHASES={agent_received:['queued','sending','accepted'],running:['running','result_pending'],waiting_answer:['running'],execution_unknown:['outcome_unknown'],stop_requested:['running','stop_requested'],stop_unconfirmed:['stop_unconfirmed','outcome_unknown'],stopped:['stopped'],completed:['completed'],failed:['failed'],cancelled:['cancelled'],expired:['expired']};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const REQUIRED_SCOPES=['tasks:read','tasks:update','requests:write','messages:receive','messages:write','receipts:agent'];
const AMBIGUOUS=new Set(['NETWORK_UNAVAILABLE','INVALID_RESPONSE']);
const RECONCILABLE=new Set(['REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','STATE_CONFLICT','ROUTE_MISMATCH','ANSWER_ALREADY_ACCEPTED']);
const digest=(...parts)=>createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0,32);

export class AgentBridge{
  #client;#state=null;#adapter;#clock;#blocked=null;#lastSyncAt=null;#observed=new Set();#stateFile;
  #lease=null;#operation=null;#stopping=false;#stopPromise=null;#adapterStarted=false;
  #requestLifecycle=false;#taskBinding=null;#sessionControl=false;
  constructor({config,adapter=null,stateFile=null,clock=Date.now,fetchImpl=globalThis.fetch,taskBinding=null}={}){
    this.#client=new BridgeClient(config,{clock,fetchImpl});
    this.#adapter=adapter??{name:'observe-only',capabilities:{can_execute:false},onItem:()=>[],onAnswer:()=>[]};
    this.#clock=clock;this.#stateFile=stateFile??config?.state_file;
    // An existing CLI caller may only narrow the shared device inbox to its verified original task.
    if(taskBinding!==null){
      if(typeof taskBinding.task_id!=='string'||!taskBinding.task_id||!taskBinding.route||
        ['computer_id','agent_id','project_id','session_id'].some(k=>typeof taskBinding.route[k]!=='string'||!taskBinding.route[k])||
        ['computer_id','agent_id'].some(k=>taskBinding.route[k]!==config[k]))throw new BridgeError('INVALID_CONFIG',{permanent:true});
      this.#taskBinding=Object.freeze({task_id:taskBinding.task_id,route:Object.freeze({...taskBinding.route})});
    }
    if(typeof this.#stateFile!=='string'||!this.#stateFile)throw new BridgeError('INVALID_CONFIG',{permanent:true});
  }
  get client(){return this.#client;}
  get state(){return this.#state;}
  get blocked(){return this.#blocked;}
  inspectLocalStatus(){
    const state=this.#loadState();
    return {local_only:true,network_checked:false,adapter_started:false,started:false,
      server_id:state.serverId,owner_id:this.#client.config.owner_id,producer_id:this.#client.config.producer_id,
      cursor:state.cursor,pending:Object.keys(state.outbox()).length,waiting_requests:Object.keys(state.requests()).length,
      uncertain_dispatches:Object.values(state.value.dispatches).filter(value=>value.state==='prepared').length,
      reconciled_intakes:Object.keys(state.value.intake_reconciliations).length,
      reconciled_answers:Object.keys(state.value.answer_intake_reconciliations).length,
      blocked:state.value.blocked??null};
  }
  #loadState(){
    const state=BridgeState.load(this.#stateFile),{server_id,owner_id,producer_id}=this.#client.config;
    if(state.serverId&&state.serverId!==server_id)throw new BridgeError('STATE_SERVER_MISMATCH',{permanent:true});
    state.bind({server_id,owner_id,producer_id,computer_id:this.#client.config.computer_id??null,agent_id:this.#client.config.agent_id??null});
    return state;
  }
  start(){return this.#exclusive(()=>this.#start());}
  pollOnce(){return this.#exclusive(()=>this.#pollOnce());}
  flush(){return this.#exclusive(()=>this.#flush());}
  async #exclusive(callback){
    if(this.#stopping)throw new BridgeError('BRIDGE_STOPPING',{retryable:true});
    if(this.#operation)throw new BridgeError('BRIDGE_BUSY',{retryable:true});
    const operation=Promise.resolve().then(callback);this.#operation=operation;
    try{return await operation;}finally{if(this.#operation===operation)this.#operation=null;}
  }
  stop(){
    if(this.#stopPromise)return this.#stopPromise;
    this.#stopping=true;
    this.#stopPromise=(async()=>{
      try{
        await this.#operation?.catch(()=>{});
        if(this.#adapterStarted&&typeof this.#adapter.stop==='function')await this.#adapter.stop();
        this.#adapterStarted=false;this.#state=null;this.#lease?.release();this.#lease=null;
      }finally{this.#stopping=false;this.#stopPromise=null;}
    })();
    return this.#stopPromise;
  }
  async #start(){
    if(this.#state||this.#lease)throw new BridgeError('ALREADY_STARTED',{permanent:true});
    this.#state=null;
    this.#lease=BridgeRunLock.acquire({stateFile:this.#stateFile,identity:this.#client.config});
    this.#stateFile=this.#lease.stateFile;
    try{
      const identity=await this.#client.identity();
      const {owner_id,producer_id,server_id}=this.#client.config;
      if(!identity||identity.schema_version!=='1.0'||identity.owner_id!==owner_id||identity.producer_id!==producer_id||identity.server_id!==server_id)
        throw new BridgeError('IDENTITY_MISMATCH',{permanent:true});
      const scopes=new Set(Array.isArray(identity.scopes)?identity.scopes:[]);
      this.#requestLifecycle=Array.isArray(identity.capabilities)&&identity.capabilities.includes('request_lifecycle_v1');
      this.#sessionControl=Array.isArray(identity.capabilities)&&identity.capabilities.includes('task_session_control_v1');
      const missing=REQUIRED_SCOPES.filter(scope=>!scopes.has(scope));
      if(missing.length)throw new BridgeError('SCOPE_MISSING',{permanent:true,detail:missing.join(',')});
      const state=this.#loadState();
      if(typeof this.#adapter.routeBindingDigest==='string'){
        const fingerprint=this.#adapter.routeBindingDigest;
        if(state.value.runtime_route_binding!==undefined&&state.value.runtime_route_binding!==fingerprint||
          state.value.runtime_route_binding===undefined&&(state.cursor!==null||['handled','dispatches','outbox','runtime_sources','requests'].some(k=>Object.keys(state.value[k]).length)))
          throw new BridgeError('RUNTIME_ROUTE_BINDING_CHANGED',{permanent:true});
        // A changed route set must never inherit a cursor that skipped work for
        // newly enabled sessions. Configuration changes require reconciliation.
        state.value.runtime_route_binding=fingerprint;
      }
      const lease=this.#lease;state.guardWrites(()=>lease.assertHeld());
      if(typeof this.#adapter.start==='function'){
        this.#adapterStarted=true;await this.#adapter.start();
      }
      if(this.#adapter.capabilities?.async_events===true&&
        (typeof this.#adapter.pollEvents!=='function'||typeof this.#adapter.acknowledgeEvents!=='function'))
        throw new BridgeError('RUNTIME_EVENTS_UNSUPPORTED',{permanent:true});
      if(this.#adapter.capabilities?.admission_probe_v1===true&&
        (this.#adapter.capabilities?.async_events!==true||typeof this.#adapter.inspectAdmission!=='function'))
        throw new BridgeError('RUNTIME_ADMISSION_UNSUPPORTED',{permanent:true});
      if(this.#adapter.capabilities?.answer_intake_probe_v1===true&&
        (this.#adapter.capabilities?.async_events!==true||typeof this.#adapter.inspectAnswerIntake!=='function'))
        throw new BridgeError('RUNTIME_ANSWER_INTAKE_UNSUPPORTED',{permanent:true});
      if(this.#adapter.capabilities?.control_intake_probe_v1===true&&
        (this.#adapter.capabilities?.async_events!==true||typeof this.#adapter.inspectControlIntake!=='function'))
        throw new BridgeError('RUNTIME_CONTROL_INTAKE_UNSUPPORTED',{permanent:true});
      if(this.#adapter.capabilities?.task_session_control_v1===true&&!this.#sessionControl)
        throw new BridgeError('SERVER_SESSION_CONTROL_UNSUPPORTED',{permanent:true});
      if(this.#adapter.capabilities?.can_execute===true&&['computer_id','agent_id'].some(k=>typeof this.#client.config[k]!=='string'||!this.#client.config[k]))
        throw new BridgeError('ROUTE_BINDING_REQUIRED',{permanent:true});
      this.#lease.assertHeld();this.#state=state;
      this.#state.serverId=server_id;this.#state.save();
      this.#blocked=this.#state.value.blocked??null;
      return this.status();
    }catch(error){
      this.#state=null;
      if(this.#adapterStarted&&typeof this.#adapter.stop==='function')await this.#adapter.stop();
      this.#adapterStarted=false;this.#lease.release();this.#lease=null;throw error;
    }
  }
  status(){
    return {server_id:this.#state?.serverId??null,producer_id:this.#client.config.producer_id,owner_id:this.#client.config.owner_id,
      started:Boolean(this.#state),stopping:this.#stopping,owns_run:Boolean(this.#lease),cursor:this.#state?.cursor??null,last_sync_at:this.#lastSyncAt,observed_tasks:this.#observed.size,
      pending:Object.keys(this.#state?.outbox()??{}).length,blocked:this.#blocked,adapter:this.#adapter.name??'custom',
      can_execute:this.#adapter.capabilities?.can_execute===true};
  }
  async #pollOnce(){
    if(!this.#state)throw new BridgeError('NOT_STARTED',{permanent:true});
    this.#lease.assertHeld();
    if(this.#blocked)throw new BridgeError(this.#blocked.code,{permanent:true,detail:this.#blocked.key});
    if(this.#adapter.capabilities?.unavailable)throw new BridgeError('ADAPTER_EXITED',{permanent:true});
    if(this.#adapter.capabilities?.can_execute===true&&['computer_id','agent_id'].some(k=>typeof this.#client.config[k]!=='string'||!this.#client.config[k]))
      throw new BridgeError('ROUTE_BINDING_REQUIRED',{permanent:true});
    const page=await this.#client.inbox(this.#state.cursor,20);
    if(this.#adapter.capabilities?.can_execute!==true){
      for(const item of page.items)if(item.kind==='task')this.#observed.add(item.object_id);
      return {items:page.items.length,handled:0,pending:Object.keys(this.#state.outbox()).length,blocked:this.#blocked};
    }
    const handled=[];
    for(const item of page.items){
      const key=`${item.kind}:${item.object_id}:${item.revision}`;
      if(this.#state.handled(key))continue;
      if(!this.#matchesRoute(item))continue;
      await this.#handle(item);
      this.#state.markHandled(key,'observed');this.#state.save();
      handled.push(key);
    }
    await this.#flush();
    await this.#pollRequests();
    await this.#pollRuntimeEvents();
    // Actions produced while delivering an answer go out in the same cycle.
    await this.#flush();
    this.#state.cursor=page.next_cursor;this.#state.save();
    this.#lastSyncAt=new Date(this.#clock()).toISOString();
    return {items:page.items.length,handled:handled.length,pending:Object.keys(this.#state.outbox()).length,blocked:this.#blocked};
  }
  // The inbox only carries revisions, so a question that was answered without a new
  // revision is discovered by re-reading the requests this program is waiting on.
  async #pollRequests(){
    for(const [id,tracked] of Object.entries(this.#state.requests())){
      let item;
      try{item=this.#requestLifecycle?await this.#client.reconcileRequest(id,tracked.revision):await this.#client.object('request',id);}
      catch(error){
        if(error instanceof BridgeError&&error.code==='STALE_REQUEST'){
          item=await this.#client.object('request',id);
          if(!this.#matchesRoute(item))throw new BridgeError('ROUTE_MISMATCH',{permanent:true});
          this.#state.trackRequest(id,item.revision);this.#state.save();
        }else{
          if(error instanceof BridgeError&&error.code==='REQUEST_NOT_FOUND'){
            // A delayed POST has not stored this question yet. Keep the durable
            // waiter so that a later successful retry can still route its answer.
            const uploading=Object.values(this.#state.outbox()).some(entry=>entry.event.kind==='request'&&entry.event.body.request_id===id);
            if(uploading)continue;
            // An acknowledged question disappearing can mean a server rollback.
            // Preserve the waiting record and stop rather than silently losing it.
          }
          throw error;
        }
      }
      if(!this.#matchesRoute(item))throw new BridgeError('ROUTE_MISMATCH',{permanent:true});
      if(item.state==='answered'&&item.answer){
        await this.#deliverAnswer(item,item.answer);this.#state.untrackRequest(id);this.#state.save();
      }else if(item.state==='withdrawn'||item.state==='expired'){
        if(typeof this.#adapter.onRequestClosed==='function')await this.#apply(item,await this.#dispatch(`closed:${id}:${item.revision}`,item,
          context=>this.#adapter.onRequestClosed({request:item},context)));
        this.#state.untrackRequest(id);this.#state.save();
      }else if(item.revision!==tracked.revision){
        this.#state.trackRequest(id,item.revision);this.#state.save();
      }
    }
  }
  async #handle(item){
    if(item.kind==='task'){
      this.#observed.add(item.object_id);
      const current=await this.#client.object('task',item.object_id);
      if(!this.#matchesRoute(current))throw new BridgeError('ROUTE_MISMATCH',{permanent:true});
      if(['completed','cancelled','failed','expired'].includes(current.state))return;
      await this.#apply(current,await this.#dispatch(`item:task:${current.object_id}:${current.revision}`,current,context=>this.#adapter.onItem(current,context)));
    }else if(item.kind==='request'){
      if(item.state==='answered'&&item.answer)await this.#deliverAnswer(item,item.answer);
    }else{
      await this.#apply(item,await this.#dispatch(`item:${item.kind}:${item.object_id}:${item.revision}`,item,context=>this.#adapter.onItem(item,context)));
    }
  }
  async #deliverAnswer(item,answer){
    const key=`${item.object_id}:${item.revision}:${answer.object_id}`;
    if(this.#state.answerDelivered(key))return;
    if(!this.#matchesRoute(item)||JSON.stringify(item.body.route)!==JSON.stringify(answer.body.route)||
      answer.body.request_id!==item.object_id||answer.body.task_id!==item.body.task_id||answer.body.request_revision!==item.revision)
      throw new BridgeError('ROUTE_MISMATCH',{permanent:true});
    const task=await this.#client.object('task',item.body.task_id),expected=this.#state.requests()[item.object_id]?.execution;
    if(!this.#matchesRoute(task))throw new BridgeError('ROUTE_MISMATCH',{permanent:true});
    // Accepted answers remain history. They cannot restart a stopped task or
    // feed a different command after an explicit resume.
    if(['cancel_requested','cancelled','completed','failed','expired','execution_unknown','stop_requested','stop_unconfirmed','stopped','resume_requested'].includes(task.state)||
      task.body.execution&&(!expected||expected.command_id!==task.body.execution.command_id||expected.turn_id!==task.body.execution.turn_id)){
      this.#state.markAnswer(key,{request_id:item.object_id,request_revision:item.revision,answer_id:answer.object_id,ignored:true,reason:'task_execution_closed_or_changed'});this.#state.save();return;
    }
    await this.#apply(item,await this.#dispatch(`answer:${key}`,item,context=>this.#adapter.onAnswer({request:item,answer},context),answer));
    this.#state.markAnswer(key,{request_id:item.object_id,request_revision:item.revision,answer_id:answer.object_id});this.#state.save();
  }
  async #dispatch(key,source,callback,answer=null){
    const priorSource=this.#state.value.runtime_sources[key];
    const prepared=this.#state.value.dispatches[key];
    if(prepared?.state==='prepared'&&this.#adapter.capabilities?.control_intake_probe_v1===true&&
      source.kind==='task'&&['stop_requested','resume_requested'].includes(source.body.state)&&
      source.body.control&&key===`item:task:${source.object_id}:${source.revision}`&&priorSource){
      if(runtimeDigest(priorSource)!==runtimeDigest(runtimeSource(source)))
        throw new BridgeError('RUNTIME_CONTROL_INTAKE_PROOF_INVALID',{permanent:true});
      const proof=await this.#adapter.inspectControlIntake({delivery_id:key,source:priorSource});
      if(proof?.status==='accepted'){
        if(proof.delivery_id!==key||proof.control_id!==source.body.control.control_id||
          !proof.source||runtimeDigest(proof.source)!==runtimeDigest(priorSource))
          throw new BridgeError('RUNTIME_CONTROL_INTAKE_PROOF_INVALID',{permanent:true});
        this.#state.confirmControlIntake(key,proof);
      }else if(proof?.status!=='not_proven')throw new BridgeError('RUNTIME_CONTROL_INTAKE_PROOF_INVALID',{permanent:true});
    }
    if(prepared?.state==='prepared'&&this.#adapter.capabilities?.answer_intake_probe_v1===true&&
      source.kind==='request'&&answer&&priorSource&&prepared.answer&&
      key===`answer:${source.object_id}:${source.revision}:${answer.object_id}`){
      // A received answer is not a resumed/completed task. Read only the exact
      // original durable intake, never re-deliver into a possibly consumed wait.
      if(runtimeDigest(priorSource)!==runtimeDigest(runtimeSource(source))||runtimeDigest(prepared.answer)!==runtimeDigest(runtimeAnswer(answer)))
        throw new BridgeError('RUNTIME_ANSWER_INTAKE_PROOF_INVALID',{permanent:true});
      const proof=await this.#adapter.inspectAnswerIntake({delivery_id:key,request:priorSource,answer:prepared.answer});
      if(proof?.status==='received'){
        const normalized=Object.fromEntries(['kind','object_id','revision','body','expires_at','command_expires_at']
          .filter(field=>priorSource[field]!==undefined).map(field=>[field,priorSource[field]]));
        const stored={answer_id:answer.object_id,stored_at:answer.stored_at,body:answer.body};
        if(proof.delivery_id!==key||proof.operation_id!=='op-'+runtimeDigest(source.body.task_id)||
          !proof.request||runtimeDigest(proof.request)!==runtimeDigest(normalized)||proof.answer_digest!==runtimeDigest(stored))
          throw new BridgeError('RUNTIME_ANSWER_INTAKE_PROOF_INVALID',{permanent:true});
        this.#state.confirmAnswerIntake(key,proof,[{action:'receipt',stage:'agent_received',subject_kind:'answer',
          subject_id:answer.object_id,subject_revision:answer.revision}]);
      }else if(proof?.status!=='not_proven')throw new BridgeError('RUNTIME_ANSWER_INTAKE_PROOF_INVALID',{permanent:true});
    }
    if(this.#state.value.dispatches[key]?.state==='prepared'&&this.#adapter.capabilities?.admission_probe_v1===true&&
      source.kind==='task'&&source.revision===1&&source.body.state==='queued'&&source.body.allow_create_session===false&&
      key===`item:task:${source.object_id}:1`&&priorSource){
      // Read the adapter-owned intake fact. Never invoke the executable handler
      // again just because its reply did not make it into the bridge ledger.
      const proof=await this.#adapter.inspectAdmission({delivery_id:key,source:priorSource});
      if(proof?.status==='admitted'){
        const normalized=Object.fromEntries(['kind','object_id','revision','body','expires_at','command_expires_at']
          .filter(field=>priorSource[field]!==undefined).map(field=>[field,priorSource[field]]));
        const operationId='op-'+runtimeDigest(source.body.task_id),eventId='rt-'+runtimeDigest([operationId,'admitted']);
        if(proof.delivery_id!==key||proof.operation_id!==operationId||proof.admitted_event_id!==eventId||
          !proof.source||typeof proof.source!=='object'||Array.isArray(proof.source)||runtimeDigest(proof.source)!==runtimeDigest(normalized)||
          runtimeDigest(priorSource)!==runtimeDigest(runtimeSource(source)))
          throw new BridgeError('RUNTIME_ADMISSION_PROOF_INVALID',{permanent:true});
        this.#state.confirmAdmission(key,proof);
      }else if(proof?.status!=='not_proven')throw new BridgeError('RUNTIME_ADMISSION_PROOF_INVALID',{permanent:true});
    }
    if(this.#adapter.capabilities?.async_events===true){this.#state.rememberRuntimeSource(key,source);this.#state.save();}
    return this.#state.dispatch(key,()=>callback({delivery_id:key}),{answer:answer?runtimeAnswer(answer):null});
  }
  async #pollRuntimeEvents(){
    if(this.#adapter.capabilities?.async_events!==true)return;
    const events=runtimeEventBatch(await this.#adapter.pollEvents());
    // Validate the whole batch before applying anything. Origins are durable
    // bridge-issued deliveries, never adapter-chosen project/session objects.
    for(const event of events){
      if(this.#state.runtimeEventSeen(event))continue;
      const source=this.#state.value.runtime_sources[event.delivery_id];
      if(!source||!['task','request'].includes(source.kind)||!this.#matchesRoute(source))
        throw new BridgeError('RUNTIME_SOURCE_UNKNOWN',{permanent:true});
      for(const action of event.actions){
        if(action?.action!=='none')this.#validate(action);
        if(action?.action==='receipt'&&(action.subject_kind!=='task'||action.subject_id!==source.body.task_id))
          throw new BridgeError('ROUTE_MISMATCH',{permanent:true});
      }
    }
    for(const event of events){
      if(this.#state.runtimeEventSeen(event))continue;
      const source=this.#state.value.runtime_sources[event.delivery_id];
      let task=await this.#client.object('task',source.body.task_id);
      for(const entry of Object.values(this.#state.outbox()))if(entry.event.kind==='task'&&
        entry.event.body.task_id===source.body.task_id&&entry.event.body.revision>task.revision)
        task={...task,body:entry.event.body,revision:entry.event.body.revision,state:entry.event.body.state};
      if(runtimeDigest(task.body.route)!==runtimeDigest(source.body.route))throw new BridgeError('ROUTE_MISMATCH',{permanent:true});
      if(['completed','cancelled','failed','expired'].includes(task.state))throw new BridgeError('RUNTIME_SOURCE_CLOSED',{permanent:true});
      const paused=['cancel_requested','stop_unconfirmed','stopped'].includes(task.state)||
        task.state==='stop_requested'&&Date.parse(task.body.control?.expires_at)>this.#clock();
      const actions=paused?event.actions.filter(action=>
        action.action!=='request'&&(action.action!=='task_state'||!['agent_received','running','waiting_answer'].includes(action.state))):event.actions;
      await this.#apply(source,actions,event);
    }
    // Acknowledgement means the bridge has durably taken responsibility, not
    // cloud storage or task completion. Lost acknowledgements replay safely.
    if(events.length)await this.#adapter.acknowledgeEvents(events.map(event=>event.event_id));
  }
  async #apply(source,actions,runtimeEvent=null){
    if(!Array.isArray(actions))throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true});
    const list=actions.filter(action=>action?.action!=='none');
    // Validate every action before persisting any of them: a misbehaving adapter
    // must not leave a partial effect in the durable outbox.
    for(const action of list)this.#validate(action);
    const snapshot=structuredClone(this.#state.value);
    try{for(const action of list){
      if(action.action==='task_state')await this.#enqueueTaskState(source,action);
      else if(action.action==='receipt')this.#enqueueReceipt(source,action);
      else if(action.action==='message')this.#enqueueMessage(source,action);
      else await this.#enqueueRequest(source,action);
    }if(runtimeEvent)this.#state.markRuntimeEvent(runtimeEvent);this.#state.save();}catch(error){this.#state.value=snapshot;throw error;}
  }
  #matchesRoute(item){const route=item.body?.route,bound=this.#taskBinding;return route?.computer_id===this.#client.config.computer_id&&route?.agent_id===this.#client.config.agent_id&&
    (typeof this.#adapter.acceptsRoute!=='function'||this.#adapter.acceptsRoute(route))&&
    (!bound||item.body.task_id===bound.task_id&&['computer_id','agent_id','project_id','session_id'].every(k=>route[k]===bound.route[k]));}
  #validate(action){
    if(!action||typeof action.action!=='string')throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'action'});
    if(action.action==='task_state'){
      if(!PUBLISHABLE_TASK_STATES.includes(action.state)||Object.keys(action).some(k=>!['action','state','task_id','execution'].includes(k)))throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'task_state'});
      if(action.execution!==undefined){
        const x=action.execution;
        if(!this.#sessionControl||!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==3||
          !uuid(x.command_id)||!(x.turn_id===null||typeof x.turn_id==='string'&&x.turn_id.length>0&&x.turn_id.length<=160)||
          !EXECUTION_PHASES[action.state]?.includes(x.phase))throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'execution'});
      }
      return;
    }
    if(action.action==='receipt'){
      if(!AGENT_STAGES.includes(action.stage))throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'stage'});
      if(typeof action.subject_id!=='string'||!action.subject_id||!Number.isSafeInteger(action.subject_revision)||action.subject_revision<1)
        throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'subject'});
      const subjects=['material','message','task','request','answer'];
      if(!subjects.includes(action.subject_kind))throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'subject_kind'});
      return;
    }
    if(action.action==='message'){
      if(Object.keys(action).some(key=>!['action','message_id','channel','text'].includes(key))||
        !['progress','result'].includes(action.channel)||typeof action.text!=='string'||action.text.length>65536||
        typeof action.message_id!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(action.message_id))
        throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'message'});
      return;
    }
    if(action.action==='request'){
      if(action.expires_at!==undefined&&(typeof action.expires_at!=='string'||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(action.expires_at)||!Number.isFinite(Date.parse(action.expires_at))||
        new Date(action.expires_at).toISOString().replace(/\.\d{3}Z$/,'Z')!==action.expires_at.replace(/\.\d{1,6}Z$/,'Z')))
        throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'expires_at'});
      if(typeof action.question!=='string'||!action.question||action.question.length>4096)
        throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'question'});
      if(!['choice','free_text'].includes(action.mode))throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'mode'});
      const mode=action.mode;
      const options=mode==='choice'?(action.options??[]):[];
      if(mode==='free_text'&&action.options!==undefined&&(!Array.isArray(action.options)||action.options.length))
        throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'options'});
      if(mode==='choice'&&(!Array.isArray(options)||options.length<2||options.length>4||options.some(option=>!option||
        typeof option.option_id!=='string'||!option.option_id||option.option_id.length>512||typeof option.label!=='string'||!option.label||option.label.length>512||
        Object.keys(option).some(k=>!['option_id','label'].includes(k)))||new Set(options.map(option=>option.option_id)).size!==options.length))
        throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'options'});
      return;
    }
    throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'action_type'});
  }
  async #enqueueTaskState(source,action){
    if(!PUBLISHABLE_TASK_STATES.includes(action.state))throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'task_state'});
    const taskId=action.task_id??source.body.task_id;
    if(taskId!==source.body.task_id)throw new BridgeError('ROUTE_MISMATCH',{permanent:true});
    let current=await this.#client.object('task',taskId);
    if(!this.#matchesRoute(current))throw new BridgeError('ROUTE_MISMATCH',{permanent:true});
    for(const entry of Object.values(this.#state.outbox()))if(entry.event.kind==='task'&&entry.event.body.task_id===taskId&&entry.event.body.revision>current.revision)
      current={...current,body:entry.event.body,revision:entry.event.body.revision,state:entry.event.body.state};
    // The desired state already holds: publishing it again would only produce a
    // conflict, so the program records nothing and leaves the task alone.
    if(current.state===action.state&&(action.execution===undefined||runtimeDigest(current.body.execution??null)===runtimeDigest(action.execution)))return;
    const revision=current.revision+1;
    const body={...current.body,revision,state:action.state,...(action.execution===undefined?{}:{execution:structuredClone(action.execution)})};
    this.#persist(`task:${taskId}:${revision}`,'task',body);
  }
  #enqueueReceipt(source,action){
    if(!AGENT_STAGES.includes(action.stage))throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'stage'});
    if(typeof action.subject_id!=='string'||!action.subject_id||!Number.isSafeInteger(action.subject_revision)||action.subject_revision<1)
      throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'subject'});
    const receiptId=`rc-${digest(this.#client.config.server_id,action.subject_kind,action.subject_id,action.subject_revision,action.stage)}`;
    const body={receipt_id:receiptId,subject_kind:action.subject_kind,subject_id:action.subject_id,subject_revision:action.subject_revision,
      stage:action.stage,actor_id:this.#client.config.producer_id,related_event_id:action.related_event_id??source.event_id,error:action.error??null};
    this.#persist(`receipt:${receiptId}`,'receipt',body);
  }
  async #enqueueRequest(source,action){
    if(typeof action.question!=='string'||!action.question||action.question.length>4096)throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'question'});
    const taskId=action.task_id??source.body.task_id;
    const mode=action.mode==='choice'?'choice':'free_text';
    const options=mode==='choice'?(action.options??[]):[];
    if(mode==='choice'&&(options.length<2||new Set(options.map(option=>option.option_id)).size!==options.length))
      throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true,detail:'options'});
    const requestId=action.request_id??`req-${digest(this.#client.config.server_id,taskId,action.question)}`;
    const body={request_id:requestId,revision:1,task_id:taskId,route:source.body.route,mode,question:action.question,
      options,state:'pending',runtime_request_id:action.runtime_request_id??null};
    this.#persist(`request:${requestId}:1`,'request',body,action.expires_at);
    if(taskId!==source.body.task_id)throw new BridgeError('ROUTE_MISMATCH',{permanent:true});
    let task=await this.#client.object('task',taskId);
    for(const entry of Object.values(this.#state.outbox()))if(entry.event.kind==='task'&&entry.event.body.task_id===taskId&&entry.event.body.revision>task.revision)
      task={...task,body:entry.event.body,revision:entry.event.body.revision,state:entry.event.body.state};
    this.#state.trackRequest(requestId,1,task.body.execution);
  }
  #enqueueMessage(source,action){
    const body={message_id:action.message_id,revision:1,task_id:source.body.task_id,route:source.body.route,
      request_id:null,channel:action.channel,text:action.text};
    this.#persist(`message:${body.message_id}:1`,'message',body);
  }
  #persist(key,kind,body,expiresAt){
    const now=this.#clock();
    if(expiresAt!==undefined&&(Date.parse(expiresAt)<=now||Date.parse(expiresAt)>now+3600000))
      throw new BridgeError('RUNTIME_DEADLINE_INVALID',{permanent:true});
    const event={schema_version:'1.0',event_id:`ev-${digest(this.#client.config.server_id,key)}`,
      idempotency_key:`id-${digest('idem',this.#client.config.server_id,key)}`,kind,producer_id:this.#client.config.producer_id,
      created_at:new Date(now).toISOString(),expires_at:expiresAt??new Date(now+3600000).toISOString(),body};
    this.#state.enqueue(key,event);
  }
  async #flush(){
    if(!this.#state)throw new BridgeError('NOT_STARTED',{permanent:true});
    this.#lease.assertHeld();
    if(this.#blocked)throw new BridgeError(this.#blocked.code,{permanent:true});
    const now=this.#clock();
    const deferred=new Set(),deferredTasks=new Set();
    for(const [key,entry] of Object.entries(this.#state.outbox())){
      this.#lease.assertHeld();
      const objectKey=`${entry.event.kind}:${entry.event.body[`${entry.event.kind}_id`]}`;
      const taskId=entry.event.body.task_id??(entry.event.kind==='receipt'&&entry.event.body.subject_kind==='task'?entry.event.body.subject_id:null);
      const postpone=()=>{deferred.add(objectKey);if(taskId)deferredTasks.add(taskId);};
      if(deferred.has(objectKey)||taskId&&deferredTasks.has(taskId))continue;
      if(entry.next_attempt_at>now){postpone();continue;}
      try{
        await this.#client.post(entry.event.kind,entry.event);
        this.#state.complete(key);this.#state.save();
      }catch(error){
        if(!(error instanceof BridgeError))throw error;
        if(AMBIGUOUS.has(error.code)){
          const settled=await this.#reconcile(entry);
          if(settled){this.#state.complete(key);this.#state.save();continue;}
          this.#state.fail(key,error.code,now,null);this.#state.save();postpone();continue;
        }
        if(error.retryable){this.#state.fail(key,error.code,now,error.detail);this.#state.save();postpone();continue;}
        if(RECONCILABLE.has(error.code)&&await this.#reconcile(entry)){this.#state.complete(key);this.#state.save();continue;}
        if(['REVISION_CONFLICT','TASK_CONTROL_INVALID'].includes(error.code)&&await this.#settleControlRace(key,entry)){postpone();continue;}
        this.#blocked={key,code:error.code,at:new Date(now).toISOString()};
        this.#state.value.blocked=this.#blocked;this.#state.save();
        throw error;
      }
    }
    return {pending:Object.keys(this.#state.outbox()).length,blocked:this.#blocked};
  }
  async #settleControlRace(key,entry){
    // The server definitively rejected these bytes. Keep that fact separately;
    // never alter an envelope that might already have been accepted.
    const old=entry.event.body;if(entry.event.kind!=='task'||!old.execution)return false;
    const current=await this.#client.object('task',old.task_id),body=current.body;
    if(!this.#matchesRoute(current)||body.command!==old.command||runtimeDigest(body.route)!==runtimeDigest(old.route)||
      body.allow_create_session!==old.allow_create_session||!body.control||runtimeDigest(body.control)===runtimeDigest(old.control??null)||
      !body.execution||body.execution.command_id!==old.execution.command_id||body.execution.turn_id!==old.execution.turn_id||
      !['stop_requested','stop_unconfirmed','stopped','resume_requested'].includes(current.state))return false;
    const discard=['agent_received','running','waiting_answer'].includes(old.state);
    const final=['completed','failed'].includes(old.state)&&['stop_requested','stop_unconfirmed'].includes(current.state);
    if(!discard&&!final)return false;
    const snapshot=structuredClone(this.#state.value);
    try{
      this.#state.value.superseded_task_events??={};
      this.#state.value.superseded_task_events[entry.event.event_id]={task_id:old.task_id,revision:old.revision,current_revision:current.revision,control_id:body.control.control_id,reason:discard?'control_won':'terminal_fact_rebased'};
      this.#state.complete(key);
      if(final){const revised={...body,revision:current.revision+1,state:old.state,execution:old.execution};
        const replacement=`task:${old.task_id}:${revised.revision}:rebase:${runtimeDigest(revised)}`;
        this.#persist(replacement,'task',revised);
        // Keep completion ahead of its receipt and behind its result chunks.
        const outbox=this.#state.outbox();
        this.#state.value.outbox=Object.fromEntries(Object.keys(snapshot.outbox).flatMap(k=>k===key?[[replacement,outbox[replacement]]]:outbox[k]?[[k,outbox[k]]]:[]));
      }
      this.#state.save();return true;
    }catch(error){this.#state.value=snapshot;throw error;}
  }
  async #reconcile(entry){
    try{await this.#client.event(entry.event.event_id,entry.event);return true;}
    catch(error){
      if(error instanceof BridgeError&&error.code==='EVENT_NOT_FOUND')return false;
      if(error instanceof BridgeError&&AMBIGUOUS.has(error.code))return false;
      return false;
    }
  }
}
