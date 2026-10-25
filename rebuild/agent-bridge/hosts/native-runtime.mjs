import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BridgeError} from '../client.mjs';
import {BridgeState} from '../state.mjs';
import {BridgeRunLock} from '../run-lock.mjs';
import {runtimeDigest,runtimeSource,runtimeEventBatch} from '../runtime-events.mjs';
import {directoryRoute as validRoute,directoryLabel} from '../session-directory.mjs';
import {SessionControl} from './session-control.mjs';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const own=(o,k)=>Object.hasOwn(o,k)?o[k]:undefined;
const normalizedSource=s=>Object.fromEntries(['kind','object_id','revision','body','expires_at','command_expires_at'].filter(k=>s[k]!==undefined).map(k=>[k,s[k]]));
const operationId=task=>'op-'+runtimeDigest(task);
const admittedId=op=>'rt-'+runtimeDigest([op,'admitted']);
const commandId=op=>{const h=runtimeDigest([op,'command']);return`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const commandRejection=text=>!text.trim()?'command_blank':Buffer.byteLength(text)>32768?'command_too_large':null;
const safeCode=e=>typeof e?.code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(e.code)?e.code:'NATIVE_RUNTIME_HOST_UNAVAILABLE';
const capabilities=Object.freeze({can_execute:true,async_events:true,admission_probe_v1:true,control_intake_probe_v1:true,task_session_control_v1:true,native_queue_expiry:false});
const execution=c=>({command_id:c.command_id,turn_id:c.turn_id??null,phase:c.phase});
const equal=(a,b)=>runtimeDigest(a)===runtimeDigest(b);
const MAX_STATE=64*1024*1024,MAX_OPERATIONS=1000,MAX_EVENTS=10000;
export class NativeRuntimeError extends BridgeError{constructor(code){super(code,{permanent:true});}}
const need=(v,c)=>{if(!v)throw new NativeRuntimeError(c);};
function deadline(value){
  need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)&&Number.isFinite(Date.parse(value)),'NATIVE_RUNTIME_DEADLINE_INVALID');
  return new Date(value).toISOString();
}
function receipt(op,stage){return{action:'receipt',stage,subject_kind:'task',subject_id:op.source.body.task_id,subject_revision:op.source.revision};}
function taskState(c){
  if(['queued','sending','accepted'].includes(c.phase))return'agent_received';
  if(['running','result_pending'].includes(c.phase))return'running';
  if(c.phase==='outcome_unknown')return c.stop_control_id?'stop_unconfirmed':'execution_unknown';
  return c.phase;
}
function resultActions(op,c){
  const text=c.result?.text??'';need(typeof text==='string'&&Buffer.byteLength(text)<=1024*1024,'NATIVE_RUNTIME_RESULT_INVALID');
  const parts=[];let at=0,end=0,jsonBytes=2;
  const append=()=>{parts.push({action:'message',channel:'result',message_id:'result-'+runtimeDigest([op.operation_id,c.command_id,parts.length]),text:text.slice(at,end)});at=end;jsonBytes=2;};
  // Limit both JS character count and the *encoded* JSON value. Control
  // characters expand sixfold; 240 KiB leaves room for the 256 KiB server
  // event envelope. Iterate code points so pairs never straddle messages.
  for(const character of text){
    const bytes=Buffer.byteLength(JSON.stringify(character))-2;
    if(end-at+character.length>65536||jsonBytes+bytes>240*1024)append();
    end+=character.length;jsonBytes+=bytes;
  }
  append();need(parts.length<=62,'NATIVE_RUNTIME_RESULT_LIMIT');return parts;
}

/** In-process AgentBridge adapter for explicitly supplied original-session
 * hosts. Intake and event acknowledgement use a separate durable journal;
 * SessionControl owns native input/interrupt write-ahead intents. No process,
 * thread or host connection is created or resumed by this adapter. Injected
 * hosts remain caller-owned when stop() releases the journals. Complete 1 MiB
 * results can exceed the generic stdio adapter's frame budget after JSON
 * escaping: this adapter is in-process only. One durable runtime event holds
 * all bounded message fragments plus the final state/receipt (<=64 actions). */
export class NativeRuntimeAdapter{
  name='native-session-runtime';
  #config;#clock;#state;#lease;#controllers=new Map();#busy=false;#started=false;#poisoned=false;#stopping=false;#operation;#readinessInFlight=new Map();#snapshot;#generation=0;
  constructor({stateFile,bindings,clock=Date.now}={}){
    need(typeof stateFile==='string'&&path.isAbsolute(stateFile)&&Array.isArray(bindings)&&bindings.length>0&&bindings.length<=32&&typeof clock==='function','NATIVE_RUNTIME_CONFIG_INVALID');
    const keys=new Set(),sessions=new Set();
    this.#config=bindings.map(entry=>{
      const b=entry?.binding;
      need(object(b)&&validRoute(b.route)&&['codex','claude'].includes(b.host_kind)&&typeof b.server_id==='string'&&b.server_id&&typeof b.owner_id==='string'&&b.owner_id&&typeof b.workspace==='string'&&path.isAbsolute(b.workspace),'NATIVE_RUNTIME_BINDING_INVALID');
      need(entry.label===undefined||directoryLabel(entry.label),'NATIVE_RUNTIME_BINDING_INVALID');
      need(entry.host?.conversationId===b.route.session_id&&['status','start','inspectOperation'].every(k=>typeof entry.host[k]==='function'),'NATIVE_RUNTIME_HOST_MISMATCH');
      const key=runtimeDigest(b.route),session=`${b.host_kind}:${b.route.session_id}`;
      need(!keys.has(key)&&!sessions.has(session),'NATIVE_RUNTIME_BINDING_DUPLICATE');keys.add(key);sessions.add(session);
      const controlStateFile=entry.controlStateFile??path.join(stateFile+'.sessions',key+'.json');
      need(typeof controlStateFile==='string'&&path.isAbsolute(controlStateFile)&&path.resolve(controlStateFile)!==path.resolve(stateFile),'NATIVE_RUNTIME_CONFIG_INVALID');
      return{key,binding:structuredClone(b),label:entry.label,host:entry.host,controlStateFile};
    }).sort((a,b)=>a.key.localeCompare(b.key));
    need(this.#config.every(e=>e.binding.server_id===this.#config[0].binding.server_id&&e.binding.owner_id===this.#config[0].binding.owner_id),'NATIVE_RUNTIME_BINDING_INVALID');
    this.stateFile=stateFile;this.#clock=clock;
  }
  get capabilities(){return capabilities;}
  get routeBindingDigest(){return runtimeDigest(this.#config.map(e=>e.binding));}
  acceptsRoute(route){return validRoute(route)&&this.#config.some(e=>equal(e.binding.route,route));}
  /** Read-only directory observation, independent of the task dispatch lock.
   * The budget bounds the whole snapshot, not each of up to 32 bindings.
   * Timed-out calls retain their slots until they actually settle: repeated
   * heartbeats cannot create an unbounded pile of probes on a stuck host.
   * No status fallback is allowed; some hosts read full history in status(). */
  async readinessSnapshot({timeoutMs=5000}={}){
    this.#check();need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=10&&timeoutMs<=10000,'NATIVE_RUNTIME_READINESS_TIMEOUT_INVALID');
    if(!this.#snapshot)this.#snapshot=this.#readinessSnapshot(timeoutMs).finally(()=>{this.#snapshot=null;});
    return structuredClone(await this.#snapshot);
  }
  async #readinessSnapshot(timeoutMs){
    const until=performance.now()+timeoutMs,generation=this.#generation,sessions=new Array(this.#config.length);let next=0;
    const unavailable=(e,reason,availability='offline')=>({route:structuredClone(e.binding.route),host_kind:e.binding.host_kind,workspace:e.binding.workspace,
      ...(e.label===undefined?{}:{label:e.label}),
      availability,busy:null,can_execute:false,exact_turn_interrupt:false,descendants_proof:false,atomic_queue_append:false,native_queue_expiry:false,reason});
    const probe=async e=>{
      if(typeof e.host.readiness!=='function')return unavailable(e,'NATIVE_RUNTIME_READINESS_UNSUPPORTED','unknown');
      let pending=this.#readinessInFlight.get(e.key);
      if(!pending){
        if(performance.now()>=until)return unavailable(e,'NATIVE_RUNTIME_READINESS_TIMEOUT');
        if(this.#readinessInFlight.size>=4)return unavailable(e,'NATIVE_RUNTIME_READINESS_CAPACITY','unknown');
        pending={expired:false,promise:Promise.resolve().then(()=>e.host.readiness()).then(status=>({status}),error=>({error}))};
        this.#readinessInFlight.set(e.key,pending);
        void pending.promise.then(()=>{if(this.#readinessInFlight.get(e.key)===pending)this.#readinessInFlight.delete(e.key);});
      }
      // A previous heartbeat's timed-out request is not a fresh observation.
      // Keep its slot, discard its late reply, then allow a new probe next time.
      if(pending.expired)return unavailable(e,'NATIVE_RUNTIME_READINESS_TIMEOUT');
      let timer;
      const response=await Promise.race([pending.promise,new Promise(resolve=>{timer=setTimeout(()=>{
        pending.expired=true;resolve({error:new NativeRuntimeError('NATIVE_RUNTIME_READINESS_TIMEOUT')});
      },Math.max(0,until-performance.now()));})]).finally(()=>clearTimeout(timer));
      if(response.error)return unavailable(e,safeCode(response.error),response.error.code==='NATIVE_RUNTIME_READINESS_UNSUPPORTED'?'unknown':'offline');
      const status=response.status;
      if(!object(status)||status.conversationId!==e.binding.route.session_id||status.workspace!==e.binding.workspace)return unavailable(e,'NATIVE_RUNTIME_READINESS_IDENTITY_MISMATCH');
      if(!(status.busy===null||typeof status.busy==='boolean')||typeof status.canExecute!=='boolean')return unavailable(e,'NATIVE_RUNTIME_READINESS_INVALID');
      const nativeQueue=e.host.capabilities?.atomic_queue_append===true;
      return{...unavailable(e,null),availability:'online',busy:status.busy,
        can_execute:status.canExecute&&(nativeQueue||e.host.capabilities?.atomic_idle_start===true&&status.busy===false),
        exact_turn_interrupt:e.host.capabilities?.exact_turn_interrupt===true,atomic_queue_append:nativeQueue,
        reason:status.reason==null?null:safeCode({code:status.reason})};
    };
    const worker=async()=>{while(next<this.#config.length){const index=next++;sessions[index]=await probe(this.#config[index]);}};
    await Promise.all(Array.from({length:Math.min(4,this.#config.length)},worker));
    // A concurrent stop or lost journal lock must not publish a fresh online
    // lease after this runtime has stopped owning the configured routes.
    this.#check();need(generation===this.#generation,'NATIVE_RUNTIME_NOT_STARTED');
    // A healthy native process does not repair a poisoned controller journal
    // or restore its ownership. Check all controller leases *after* the async
    // probes, so one slow host cannot hide a peer's intervening lock loss.
    for(let i=0;i<sessions.length;i++)if(sessions[i].availability==='online')try{
      const controller=this.#controllers.get(this.#config[i].key);
      need(controller,'NATIVE_RUNTIME_CONTROLLER_UNAVAILABLE');controller.list();
    }catch(error){sessions[i]={...sessions[i],can_execute:false,exact_turn_interrupt:false,atomic_queue_append:false,reason:safeCode(error)};}
    return{schema_version:1,observed_at:new Date(this.#clock()).toISOString(),sessions};
  }
  #check(){need(this.#started&&!this.#stopping,'NATIVE_RUNTIME_NOT_STARTED');need(!this.#poisoned,'NATIVE_RUNTIME_STORAGE_UNCERTAIN');this.#lease.assertHeld();}
  get #journal(){return this.#state.value.native_runtime;}
  #save(){try{need(Buffer.byteLength(JSON.stringify(this.#state.value))<=MAX_STATE,'NATIVE_RUNTIME_STATE_LIMIT');this.#state.save();}catch(error){this.#poisoned=true;throw error;}}
  #transaction(callback){const before=structuredClone(this.#journal);try{return callback();}catch(error){if(!this.#poisoned)this.#state.value.native_runtime=before;throw error;}}
  async #exclusive(callback){this.#check();need(!this.#busy,'NATIVE_RUNTIME_BUSY');this.#busy=true;
    const op=Promise.resolve().then(callback);this.#operation=op;try{return await op;}finally{this.#operation=null;this.#busy=false;}}
  async start(){
    need(!this.#started&&!this.#lease,'NATIVE_RUNTIME_ALREADY_STARTED');this.#poisoned=false;
    const identity=this.#config.map(({binding,controlStateFile})=>({binding,controlStateFile}));
    this.#lease=BridgeRunLock.acquire({stateFile:this.stateFile,identity:{server_id:'native-runtime-v1',owner_id:String(os.userInfo().uid),computer_id:'local',agent_id:runtimeDigest(identity)}});
    this.stateFile=this.#lease.stateFile;
    try{
      const existed=fs.existsSync(this.stateFile);need(!existed||fs.statSync(this.stateFile).size<=MAX_STATE,'NATIVE_RUNTIME_STATE_LIMIT');
      this.#state=BridgeState.load(this.stateFile);need(!existed||object(this.#state.value.native_runtime),'NATIVE_RUNTIME_STATE_CORRUPT');
      this.#state.bind({server_id:this.#config[0].binding.server_id,owner_id:this.#config[0].binding.owner_id,producer_id:'native-runtime-v1',bindings:identity});
      this.#state.guardWrites(()=>this.#lease.assertHeld());
      this.#state.value.native_runtime??={schema_version:1,operations:{},order:[],events:{},event_order:[],controls:{},control_intakes:{}};
      this.#validateJournal();
      for(const e of this.#config){
        const controller=SessionControl.open({stateFile:e.controlStateFile,binding:e.binding,host:e.host,clock:this.#clock});this.#controllers.set(e.key,controller);
        const known=new Set(this.#journal.order.flatMap(id=>Object.keys(this.#journal.operations[id].commands)));
        need(controller.list().every(c=>known.has(c.command_id)),'NATIVE_RUNTIME_COMMAND_ORPHAN');
      }
      this.#save();this.#generation++;this.#started=true;return this.capabilities;
    }catch(error){for(const c of this.#controllers.values())await c.close();this.#controllers.clear();this.#lease.release();this.#lease=null;this.#state=null;throw error;}
  }
  #validateJournal(){
    const j=this.#journal;
    need(j.schema_version===1&&object(j.operations)&&Array.isArray(j.order)&&j.order.length<=MAX_OPERATIONS&&j.order.length===Object.keys(j.operations).length&&new Set(j.order).size===j.order.length&&object(j.events)&&Array.isArray(j.event_order)&&j.event_order.length<=MAX_EVENTS&&j.event_order.length===Object.keys(j.events).length&&new Set(j.event_order).size===j.event_order.length&&object(j.controls)&&Object.keys(j.controls).length<=MAX_OPERATIONS&&object(j.control_intakes)&&Object.keys(j.control_intakes).length<=MAX_EVENTS,'NATIVE_RUNTIME_STATE_CORRUPT');
    for(const id of j.order){const op=own(j.operations,id);
      need(object(op)&&op.operation_id===id&&id===operationId(op.source?.body?.task_id)&&op.source_digest===runtimeDigest(op.source)&&this.acceptsRoute(op.source.body.route)&&op.binding_key===runtimeDigest(op.source.body.route)&&typeof op.admitted==='boolean'&&object(op.commands)&&Number.isSafeInteger(op.event_sequence)&&op.event_sequence>=0,'NATIVE_RUNTIME_STATE_CORRUPT');
      for(const [id,c]of Object.entries(op.commands))need(uuid(id)&&c.command_id===id&&c.task_id===op.source.body.task_id&&equal(c.route,op.source.body.route)&&typeof c.text==='string'&&c.text.trim()&&Buffer.byteLength(c.text)<=32768&&deadline(c.expires_at)===c.expires_at,'NATIVE_RUNTIME_STATE_CORRUPT');
      this.#source(op.source,op.delivery_id);
      if(op.admitted){
        need(op.source.revision===1&&op.source.body.state==='queued'&&op.source.body.execution===undefined&&op.source.body.control===undefined,'NATIVE_RUNTIME_STATE_CORRUPT');
        // Absence of the new field is the existing admitted-command format.
        // A rejected intake must never gain a controller command on restart.
        const rejected=op.admission_rejection??null;
        need(rejected===commandRejection(op.source.body.command),'NATIVE_RUNTIME_STATE_CORRUPT');
        if(rejected)need(Object.keys(op.commands).length===0,'NATIVE_RUNTIME_STATE_CORRUPT');
        else{const initial=own(op.commands,commandId(id));
          need(initial&&initial.text===op.source.body.command&&!initial.resume_of&&initial.expires_at===deadline(op.source.command_expires_at??op.source.expires_at),'NATIVE_RUNTIME_STATE_CORRUPT');}
      }else need(Object.keys(op.commands).length===0&&op.admission_rejection==null,'NATIVE_RUNTIME_STATE_CORRUPT');
      for(const [command,input]of Object.entries(op.commands))if(command!==commandId(id)){
        const control=own(j.controls,command);
        need(control?.operation_id===id&&control.control.kind==='resume'&&input.resume_of===control.control.expected_command_id&&input.text===control.control.text&&input.expires_at===deadline(control.control.expires_at),'NATIVE_RUNTIME_STATE_CORRUPT');
      }
    }
    for(const id of j.event_order){const stored=own(j.events,id);need(object(stored)&&typeof stored.acked==='boolean'&&stored.event?.event_id===id&&stored.digest===runtimeDigest(stored.event)&&j.order.some(op=>j.operations[op].delivery_id===stored.event.delivery_id),'NATIVE_RUNTIME_STATE_CORRUPT');runtimeEventBatch([stored.event]);}
    for(const [id,c]of Object.entries(j.controls))need(uuid(id)&&c.control?.control_id===id&&own(j.operations,c.operation_id)&&['pending','processing','applied','rejected'].includes(c.phase)&&c.digest===runtimeDigest(c.control),'NATIVE_RUNTIME_STATE_CORRUPT');
    for(const [delivery,intake]of Object.entries(j.control_intakes)){
      need(object(intake)&&intake.delivery_id===delivery&&intake.source_digest===runtimeDigest(intake.source)&&own(j.controls,intake.control_id)?.operation_id===intake.operation_id&&equal(j.controls[intake.control_id].control,intake.source?.body?.control),'NATIVE_RUNTIME_STATE_CORRUPT');
      this.#source(intake.source,delivery);
    }
    need(Object.keys(j.controls).every(id=>Object.values(j.control_intakes).some(i=>i.control_id===id)),'NATIVE_RUNTIME_STATE_CORRUPT');
  }
  #emit(op,tag,actions){
    const event={event_id:'rt-'+runtimeDigest([op.operation_id,tag]),delivery_id:op.delivery_id,actions};runtimeEventBatch([event]);
    const old=own(this.#journal.events,event.event_id);
    if(old){need(old.digest===runtimeDigest(event),'NATIVE_RUNTIME_EVENT_CONFLICT');return;}
    need(this.#journal.event_order.length<MAX_EVENTS,'NATIVE_RUNTIME_EVENT_LIMIT');
    this.#journal.events[event.event_id]={event,digest:runtimeDigest(event),acked:false};this.#journal.event_order.push(event.event_id);
  }
  #source(item,delivery){
    need(item?.kind==='task'&&identifier(item.object_id)&&Number.isSafeInteger(item.revision)&&item.revision>=1&&object(item.body)&&item.body.task_id===item.object_id&&this.acceptsRoute(item.body.route),'NATIVE_RUNTIME_SOURCE_INVALID');
    need(delivery===`item:task:${item.object_id}:${item.revision}`,'NATIVE_RUNTIME_DELIVERY_INVALID');
    // Wire-valid tasks may exceed a native host's smaller UTF-8 input budget,
    // or contain only whitespace. They still need durable intake and a failed
    // response; throwing here would strand Bridge's prepared delivery forever.
    need(item.body.allow_create_session===false&&typeof item.body.command==='string'&&item.body.command.length>0&&item.body.command.length<=131072&&Array.from(item.body.command).length<=65536,'NATIVE_RUNTIME_COMMAND_INVALID');
    need(typeof item.body.state==='string'&&(item.state===undefined||item.state===item.body.state),'NATIVE_RUNTIME_SOURCE_INVALID');
    deadline(item.command_expires_at??item.expires_at);return runtimeSource(item);
  }
  onItem(item,{delivery_id}={}){return this.#exclusive(()=>this.#transaction(()=>{
    if(item?.kind==='message')return[]; // Status and result notifications are never prompts.
    const source=this.#source(item,delivery_id),id=operationId(source.body.task_id),prior=own(this.#journal.operations,id);
    if(prior){
      need(equal(prior.source.body.route,source.body.route)&&prior.source.body.command===source.body.command&&prior.source.body.allow_create_session===source.body.allow_create_session&&(prior.source.command_expires_at??prior.source.expires_at)===(source.command_expires_at??source.expires_at),'NATIVE_RUNTIME_OPERATION_CONFLICT');
      if(prior.delivery_id===delivery_id)need(prior.source_digest===runtimeDigest(source),'NATIVE_RUNTIME_SOURCE_CONFLICT');
      if(['stop_requested','resume_requested'].includes(source.body.state))this.#control(prior,source,delivery_id);
      this.#save();return[];
    }
    need(this.#journal.order.length<MAX_OPERATIONS,'NATIVE_RUNTIME_OPERATION_LIMIT');
    const admitted=source.revision===1&&source.body.state==='queued'&&source.body.execution===undefined&&source.body.control===undefined;
    const op={operation_id:id,delivery_id,source,source_digest:runtimeDigest(source),binding_key:runtimeDigest(source.body.route),admitted,commands:{},event_sequence:0,last_projection:null};
    if(admitted){
      op.admission_rejection=commandRejection(source.body.command);
      if(op.admission_rejection){
        const text=op.admission_rejection==='command_blank'?'任务未派发：指令只有空白，请填写具体内容后重新提交。':'任务未派发：指令超过原生 Agent 的 32768 字节限制，请缩短后重新提交。';
        this.#emit(op,'admitted',[{action:'message',channel:'result',message_id:'rejected-'+runtimeDigest(id),text},{action:'task_state',state:'failed'},receipt(op,'failed')]);
      }else{
        const command={command_id:commandId(id),task_id:source.body.task_id,route:source.body.route,text:source.body.command,expires_at:deadline(source.command_expires_at??source.expires_at)};
        op.commands[command.command_id]=command;
        const initial={state:'agent_received',execution:execution({...command,phase:'queued'})};op.last_projection=runtimeDigest(initial);
        this.#emit(op,'admitted',[{action:'task_state',...initial},receipt(op,'agent_received')]);
      }
    }
    // A later revision without our own admission journal could have executed
    // elsewhere. Record it for dedupe but never claim or replay that command.
    this.#journal.operations[id]=op;this.#journal.order.push(id);this.#save();return[];
  }));}
  #control(op,source,delivery_id){
    need(op.admitted&&!op.admission_rejection,'NATIVE_RUNTIME_OPERATION_UNPROVEN');
    const c=source.body.control,x=source.body.execution,kind=source.body.state==='stop_requested'?'stop':'resume';
    need(object(c)&&c.kind===kind&&uuid(c.control_id)&&uuid(c.expected_command_id)&&typeof c.expected_turn_id==='string'&&c.expected_turn_id&&c.expected_turn_id.length<=160&&Object.keys(c).every(k=>['control_id','kind','expected_command_id','expected_turn_id','expires_at',...(kind==='resume'?['text']:[])].includes(k)),'NATIVE_RUNTIME_CONTROL_INVALID');
    deadline(c.expires_at);need(object(x)&&x.command_id===c.expected_command_id&&x.turn_id===c.expected_turn_id&&own(op.commands,c.expected_command_id),'NATIVE_RUNTIME_CONTROL_STALE');
    if(kind==='resume')need(typeof c.text==='string'&&c.text.trim()&&Buffer.byteLength(c.text)<=32768&&x.phase==='stopped','NATIVE_RUNTIME_CONTROL_INVALID');
    else need(['running','stop_requested'].includes(x.phase),'NATIVE_RUNTIME_CONTROL_STALE');
    const prior=own(this.#journal.controls,c.control_id);
    if(prior){need(prior.operation_id===op.operation_id&&prior.digest===runtimeDigest(c),'NATIVE_RUNTIME_CONTROL_CONFLICT');this.#controlIntake(op,source,delivery_id);return;}
    need(Object.keys(this.#journal.controls).length<MAX_OPERATIONS,'NATIVE_RUNTIME_CONTROL_LIMIT');
    need(!this.#journal.order.some(id=>own(this.#journal.operations[id].commands,c.control_id)),'NATIVE_RUNTIME_CONTROL_CONFLICT');
    if(kind==='resume')op.commands[c.control_id]={command_id:c.control_id,task_id:op.source.body.task_id,route:op.source.body.route,text:c.text,expires_at:deadline(c.expires_at),resume_of:c.expected_command_id};
    this.#journal.controls[c.control_id]={operation_id:op.operation_id,control:structuredClone(c),digest:runtimeDigest(c),phase:'pending',reason:null};
    this.#controlIntake(op,source,delivery_id);
  }
  #controlIntake(op,source,delivery_id){
    const prior=own(this.#journal.control_intakes,delivery_id);
    if(prior){need(prior.source_digest===runtimeDigest(source),'NATIVE_RUNTIME_SOURCE_CONFLICT');return;}
    need(Object.keys(this.#journal.control_intakes).length<MAX_EVENTS,'NATIVE_RUNTIME_CONTROL_LIMIT');
    this.#journal.control_intakes[delivery_id]={delivery_id,source:structuredClone(source),source_digest:runtimeDigest(source),operation_id:op.operation_id,control_id:source.body.control.control_id};
  }
  inspectAdmission({delivery_id,source}={}){return this.#exclusive(async()=>{
    const op=own(this.#journal.operations,operationId(source?.body?.task_id??null));
    if(!op?.admitted||op.delivery_id!==delivery_id||!equal(op.source,source))return{status:'not_proven'};
    const event=own(this.#journal.events,admittedId(op.operation_id));if(!event)return{status:'not_proven'};
    return{status:'admitted',delivery_id,operation_id:op.operation_id,admitted_event_id:event.event.event_id,source:structuredClone(normalizedSource(op.source))};
  });}
  inspectControlIntake({delivery_id,source}={}){return this.#exclusive(async()=>{
    const intake=typeof delivery_id==='string'?own(this.#journal.control_intakes,delivery_id):undefined;
    if(!intake||!equal(intake.source,source??null))return{status:'not_proven'};
    return{status:'accepted',delivery_id,source:structuredClone(intake.source),control_id:intake.control_id};
  });}
  async #applyControls(key,controller){
    for(const entry of Object.values(this.#journal.controls)){
      const op=this.#journal.operations[entry.operation_id];if(op.binding_key!==key||!['pending','processing'].includes(entry.phase))continue;
      const control=entry.control,current=controller.list().find(c=>c.command_id===control.expected_command_id);
      if(control.kind==='stop'&&current?.stop_control_id===control.control_id){entry.phase='applied';this.#save();continue;}
      if(control.kind==='resume'&&controller.list().some(c=>c.command_id===control.control_id)){entry.phase='applied';this.#save();continue;}
      if(Date.parse(control.expires_at)<=this.#clock()){this.#rejectControl(entry,op,controller,'control_expired_before_dispatch');continue;}
      if(!current||current.turn_id!==control.expected_turn_id||current.phase!==(control.kind==='stop'?'running':'stopped')){this.#rejectControl(entry,op,controller,'control_target_not_ready');continue;}
      entry.phase='processing';this.#save();
      try{
        if(control.kind==='stop')await controller.requestStop({control_id:control.control_id,command_id:control.expected_command_id,expected_turn_id:control.expected_turn_id});
        else controller.enqueue(op.commands[control.control_id]);
        entry.phase='applied';entry.reason=null;
      }catch(error){entry.phase='pending';entry.reason=safeCode(error);}
      this.#save();
    }
  }
  #rejectControl(entry,op,controller,reason){
    entry.phase='rejected';entry.reason=reason;
    // A rejected request is itself a state observation. Publish it even when
    // the native command did not change: the phone may now show a control
    // request instead of the last state we published. Stable IDs make this
    // correction replayable, including across a lost adapter reply/restart.
    this.#project(op,controller.list(),['control-rejected',entry.control.control_id]);this.#save();
  }
  #project(op,commands,tag=null){
    const ownCommands=commands.filter(c=>own(op.commands,c.command_id));if(!ownCommands.length)return;
    const c=ownCommands.at(-1),state=taskState(c),projection={state,execution:execution(c),...(c.phase==='completed'?{result:c.result??null}:{})},hash=runtimeDigest(projection);
    // Terminal facts/results already have a durable event. A late control
    // cannot produce a second completion after the first has closed the task.
    if(op.last_projection===hash&&(!tag||['completed','failed','cancelled','expired'].includes(c.phase)))return;
    const actions=[];if(c.phase==='completed')actions.push(...resultActions(op,c));
    actions.push({action:'task_state',state,execution:projection.execution});
    if(c.phase==='running')actions.push(receipt(op,'task_resumed'));
    if(['completed','failed','cancelled'].includes(c.phase))actions.push(receipt(op,c.phase==='completed'?'task_completed':c.phase));
    this.#emit(op,tag??['status',++op.event_sequence,c.command_id,c.phase],actions);op.last_projection=hash;this.#save();
  }
  pollEvents(){return this.#exclusive(async()=>{
    for(const {key}of this.#config){
      const controller=this.#controllers.get(key),ops=this.#journal.order.map(id=>this.#journal.operations[id]).filter(op=>op.admitted&&!op.admission_rejection&&op.binding_key===key);
      if(!ops.length)continue;
      try{
        for(const op of ops)controller.enqueue(op.commands[commandId(op.operation_id)]);
        await this.#applyControls(key,controller);
        // Publish a resume's queued identity before advancing its new turn.
        for(const op of ops)this.#project(op,controller.list());
        await controller.tick();
        for(const op of ops)this.#project(op,controller.list());
      }catch(error){
        // Host outages are per binding. Storage/ownership loss is not: do not
        // keep dispatching after any write-ahead journal becomes uncertain.
        if(this.#poisoned||['SESSION_STORAGE_UNCERTAIN','LOCK_LOST','NATIVE_RUNTIME_STATE_LIMIT','NATIVE_RUNTIME_EVENT_LIMIT'].includes(error.code))throw error;
        for(const op of ops)op.last_error=safeCode(error);this.#save();
      }
    }
    return this.#journal.event_order.filter(id=>!this.#journal.events[id].acked).slice(0,20).map(id=>structuredClone(this.#journal.events[id].event));
  });}
  acknowledgeEvents(ids){return this.#exclusive(async()=>{
    need(Array.isArray(ids)&&ids.length<=20&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&own(this.#journal.events,id)),'NATIVE_RUNTIME_EVENT_ACK_INVALID');
    for(const id of ids)this.#journal.events[id].acked=true;this.#save();
  });}
  onAnswer(){throw new NativeRuntimeError('NATIVE_RUNTIME_ANSWER_UNSUPPORTED');}
  onRequestClosed(){return[];}
  async stop(){
    if(!this.#lease)return;this.#generation++;this.#stopping=true;
    try{await this.#operation?.catch(()=>{});for(const c of this.#controllers.values())await c.close();this.#controllers.clear();this.#lease.release();this.#lease=null;this.#state=null;this.#started=false;}
    finally{this.#stopping=false;}
  }
}
