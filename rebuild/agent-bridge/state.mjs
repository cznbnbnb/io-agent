import fs from 'node:fs';
import path from 'node:path';
import {BridgeError} from './client.mjs';
import {runtimeDigest,runtimeSource} from './runtime-events.mjs';

const SCHEMA=2,MAX_LEDGER=20000;
const RENAME_DELAYS=[10,20,40,80,100],RENAME_WAIT=new Int32Array(new SharedArrayBuffer(4));
const map=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
// Durable connection-program state: inbox cursor, persisted outgoing envelopes
// (same bytes for every retry), handled-inbox ledger and delivered-answer ledger.
// Written atomically; a corrupt file stops the program instead of silently
// replaying or skipping the user's queue.
export class BridgeState{
  #writeGuard=null;
  constructor(file,value){
    this.file=file;this.value=value;
    for(const key of ['runtime_sources','runtime_events','intake_reconciliations','answer_intake_reconciliations','control_intake_reconciliations']){
      if(value[key]===undefined)value[key]={};
      if(!map(value[key]))throw new BridgeError('STATE_CORRUPT',{permanent:true});
    }
  }
  guardWrites(callback){this.#writeGuard=callback;}
  static load(file){
    if(!fs.existsSync(file))return new BridgeState(file,{schema_version:SCHEMA,server_id:null,binding:null,cursor:null,outbox:{},handled:{},answers:{},requests:{},dispatches:{},updated_at:null});
    let raw;
    try{raw=fs.readFileSync(file,'utf8');}catch{throw new BridgeError('STATE_UNREADABLE',{permanent:true});}
    let value;
    try{value=JSON.parse(raw);}catch{throw new BridgeError('STATE_CORRUPT',{permanent:true});}
    if(!map(value)||![1,SCHEMA].includes(value.schema_version)||!map(value.outbox)||!map(value.handled)||
      !map(value.answers)||(value.cursor!==null&&typeof value.cursor!=='string'))
      throw new BridgeError('STATE_CORRUPT',{permanent:true});
    if(!map(value.requests)||value.schema_version===SCHEMA&&(!map(value.dispatches)||!map(value.binding)))throw new BridgeError('STATE_CORRUPT',{permanent:true});
    if(value.schema_version===1){value.dispatches={};value.binding=null;}
    return new BridgeState(file,value);
  }
  bind(identity){
    const empty=this.value.cursor===null&&['outbox','handled','answers','requests','dispatches','runtime_sources','runtime_events','intake_reconciliations','answer_intake_reconciliations','control_intake_reconciliations'].every(k=>Object.keys(this.value[k]).length===0);
    if(this.value.binding&&JSON.stringify(this.value.binding)!==JSON.stringify(identity)||!this.value.binding&&!empty)
      throw new BridgeError('STATE_IDENTITY_MISMATCH',{permanent:true});
    this.value.binding=structuredClone(identity);this.value.schema_version=SCHEMA;
  }
  async dispatch(key,callback,{answer=null}={}){
    const prior=this.value.dispatches[key];
    if(prior?.state==='responded')return structuredClone(prior.actions);
    if(prior)throw new BridgeError('DISPATCH_UNCERTAIN',{permanent:true});
    // Persist BEFORE handing work to a runtime. A crash in this gap requires
    // reconciliation; network event dedupe cannot prove runtime non-execution.
    this.value.dispatches[key]={state:'prepared',...(answer===null?{}:{answer:structuredClone(answer)})};this.save();
    const actions=await callback();
    if(!Array.isArray(actions))throw new BridgeError('BRIDGE_ACTION_INVALID',{permanent:true});
    this.value.dispatches[key]={state:'responded',actions:structuredClone(actions)};this.save();return actions;
  }
  rememberRuntimeSource(key,item){
    const source=runtimeSource(item),prior=this.value.runtime_sources[key];
    if(prior){
      if(runtimeDigest(prior)!==runtimeDigest(source))throw new BridgeError('RUNTIME_SOURCE_CONFLICT',{permanent:true});
      return;
    }
    if(Object.keys(this.value.runtime_sources).length>=MAX_LEDGER)throw new BridgeError('RUNTIME_LEDGER_FULL',{permanent:true});
    this.value.runtime_sources[key]=source;
  }
  confirmAdmission(key,proof){
    if(this.value.dispatches[key]?.state!=='prepared')throw new BridgeError('DISPATCH_NOT_PREPARED',{permanent:true});
    if(Object.keys(this.value.intake_reconciliations).length>=MAX_LEDGER)throw new BridgeError('RUNTIME_LEDGER_FULL',{permanent:true});
    this.value.dispatches[key]={state:'responded',actions:[]};
    this.value.intake_reconciliations[key]={at:new Date().toISOString(),operation_id:proof.operation_id,
      admitted_event_id:proof.admitted_event_id,source_digest:runtimeDigest(proof.source)};
    this.save();
  }
  confirmAnswerIntake(key,proof,actions){
    if(this.value.dispatches[key]?.state!=='prepared')throw new BridgeError('DISPATCH_NOT_PREPARED',{permanent:true});
    if(Object.keys(this.value.answer_intake_reconciliations).length>=MAX_LEDGER)throw new BridgeError('RUNTIME_LEDGER_FULL',{permanent:true});
    this.value.dispatches[key]={state:'responded',actions:structuredClone(actions)};
    this.value.answer_intake_reconciliations[key]={at:new Date().toISOString(),operation_id:proof.operation_id,
      request_id:proof.request.object_id,answer_digest:proof.answer_digest,source_digest:runtimeDigest(proof.request)};
    this.save();
  }
  confirmControlIntake(key,proof){
    if(this.value.dispatches[key]?.state!=='prepared')throw new BridgeError('DISPATCH_NOT_PREPARED',{permanent:true});
    if(Object.keys(this.value.control_intake_reconciliations).length>=MAX_LEDGER)throw new BridgeError('RUNTIME_LEDGER_FULL',{permanent:true});
    this.value.dispatches[key]={state:'responded',actions:[]};
    this.value.control_intake_reconciliations[key]={at:new Date().toISOString(),control_id:proof.control_id,source_digest:runtimeDigest(proof.source)};
    this.save();
  }
  runtimeEventSeen(event){
    const prior=Object.hasOwn(this.value.runtime_events,event.event_id)?this.value.runtime_events[event.event_id]:null;
    if(!prior)return false;
    if(prior.digest!==runtimeDigest(event))throw new BridgeError('RUNTIME_EVENT_CONFLICT',{permanent:true});
    return true;
  }
  markRuntimeEvent(event){
    if(!this.runtimeEventSeen(event)){
      if(Object.keys(this.value.runtime_events).length>=MAX_LEDGER)throw new BridgeError('RUNTIME_LEDGER_FULL',{permanent:true});
      this.value.runtime_events[event.event_id]={digest:runtimeDigest(event),delivery_id:event.delivery_id};
    }
  }
  get cursor(){return this.value.cursor;}
  set cursor(value){this.value.cursor=value;}
  get serverId(){return this.value.server_id;}
  set serverId(value){this.value.server_id=value;}
  outbox(){return this.value.outbox;}
  pending(key){return this.value.outbox[key];}
  enqueue(key,event){
    if(!this.value.outbox[key])this.value.outbox[key]={event,attempts:0,next_attempt_at:0,last_error:'',created_at:new Date().toISOString()};
    return this.value.outbox[key];
  }
  complete(key){delete this.value.outbox[key];}
  fail(key,code,now,retryAfterMs){
    const entry=this.value.outbox[key];if(!entry)return undefined;
    entry.attempts+=1;entry.last_error=code;
    const base=Number.isSafeInteger(retryAfterMs)&&retryAfterMs>0?retryAfterMs:1000*2**Math.min(entry.attempts-1,5);
    const delay=Math.min(30000,base);entry.next_attempt_at=now+delay+Math.floor(delay*Math.random()*0.2);
    return entry;
  }
  handled(key){return Object.hasOwn(this.value.handled,key);}
  markHandled(key,status){
    this.value.handled[key]={at:new Date().toISOString(),status};delete this.value.dispatches[`item:${key}`];this.#prune(this.value.handled);
  }
  answerDelivered(key){return Object.hasOwn(this.value.answers,key);}
  markAnswer(key,details){
    this.value.answers[key]={at:new Date().toISOString(),...details};delete this.value.dispatches[`answer:${key}`];this.#prune(this.value.answers);
  }
  // Questions this program asked and is still waiting on (glasses.get_reply).
  requests(){return this.value.requests;}
  trackRequest(id,revision,execution){this.value.requests={...this.value.requests,[id]:{...this.value.requests[id],revision,asked_at:new Date().toISOString(),...(execution?{execution:structuredClone(execution)}:{})}};}
  untrackRequest(id){delete this.value.requests[id];}
  #prune(ledger){
    const keys=Object.keys(ledger);
    for(let index=0;index<keys.length-MAX_LEDGER;index+=1)delete ledger[keys[index]];
  }
  save(){
    this.#writeGuard?.();
    const directory=path.dirname(this.file);fs.mkdirSync(directory,{recursive:true});
    this.value.updated_at=new Date().toISOString();
    const temporary=`${this.file}.${process.pid}.tmp`;
    const descriptor=fs.openSync(temporary,'w',0o600);
    try{fs.writeFileSync(descriptor,JSON.stringify(this.value));fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
    // Windows readers/scanners can briefly deny atomic replacement. Retry only
    // the same fully fsynced bytes, with a strict 250ms total wait. Never delete
    // the old ledger or fall back to a non-atomic in-place write. Ownership is
    // checked again before every replacement, including after each wait.
    for(let attempt=0;;attempt++){
      this.#writeGuard?.();
      try{fs.renameSync(temporary,this.file);break;}
      catch(error){
        if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=RENAME_DELAYS.length)throw error;
        Atomics.wait(RENAME_WAIT,0,0,RENAME_DELAYS[attempt]);
      }
    }
    if(process.platform!=='win32'){
      const handle=fs.openSync(directory,'r');
      try{fs.fsyncSync(handle);}finally{fs.closeSync(handle);}
    }
  }
}
