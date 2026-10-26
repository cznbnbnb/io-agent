import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {BridgeState} from '../state.mjs';
import {BridgeRunLock} from '../run-lock.mjs';
import {runtimeDigest} from '../runtime-events.mjs';

const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(o,k)=>Object.hasOwn(o,k)?o[k]:undefined;
const TERMINAL=new Set(['completed','failed','stopped','cancelled','expired']);
const PHASES=new Set(['queued','sending','accepted','running','result_pending','stop_requested','stop_unconfirmed','outcome_unknown',...TERMINAL]);
const routeKeys=['computer_id','agent_id','project_id','session_id'];
export class SessionControlError extends Error{constructor(code){super(code);this.code=code;}}
const need=(v,code)=>{if(!v)throw new SessionControlError(code);};
const validText=v=>typeof v==='string'&&v.trim()&&Buffer.byteLength(v)<=32768;
const validTime=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
const validRoute=v=>object(v)&&Object.keys(v).length===4&&routeKeys.every(k=>typeof v[k]==='string'&&v[k].length>0&&v[k].length<=256);
const safeCode=e=>typeof e?.code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(e.code)?e.code:'NATIVE_HOST_UNAVAILABLE';
const publicCommand=c=>structuredClone(Object.fromEntries(['command_id','task_id','route','phase','reason','turn_id','native_status','created_at','updated_at','expires_at','resume_of','resumed_by','stop_control_id','result'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]])));

/** Durable, single-owner queue for ONE explicitly bound original session.
 * Host implementations are injected; this module neither starts agents nor
 * enables production dispatch. The host must provide atomic idle-only input
 * or native queue append (never steer),
 * exact-turn interrupt, and read-only reconciliation before it can be enabled.
 * Hosts opting into final_result_evidence must separately attest resultComplete
 * for the exact completed turn; until then that command retains single-flight.
 * It reuses the bridge's fsync/rename storage and process-owned SQLite locks. */
export class SessionControl {
  #state;#lease;#host;#clock;#busy=false;#closed=false;#poisoned=false;#binding;
  static open({stateFile,binding,host,clock=Date.now}){
    need(object(binding)&&validRoute(binding.route)&&uuid(binding.route.session_id)&&['codex','claude'].includes(binding.host_kind)&&
      typeof binding.server_id==='string'&&binding.server_id&&typeof binding.owner_id==='string'&&binding.owner_id&&
      typeof binding.workspace==='string'&&path.isAbsolute(binding.workspace),'SESSION_BINDING_INVALID');
    need(host?.conversationId===binding.route.session_id,'SESSION_HOST_MISMATCH');
    const lease=BridgeRunLock.acquire({stateFile,identity:{server_id:'native-session-control-v1',owner_id:String(os.userInfo().uid),computer_id:'local',agent_id:`${binding.host_kind}:${binding.route.session_id}`}});
    try{
      const existed=fs.existsSync(lease.stateFile);
      need(!existed||fs.statSync(lease.stateFile).size<=64*1024*1024,'SESSION_STATE_LIMIT');
      const state=BridgeState.load(lease.stateFile);
      need(!existed||object(state.value.native_control),'SESSION_STATE_CORRUPT');
      state.bind({server_id:binding.server_id,owner_id:binding.owner_id,producer_id:'native-session-control',binding:structuredClone(binding)});
      state.guardWrites(()=>lease.assertHeld());
      if(!state.value.native_control)state.value.native_control={schema_version:1,commands:{},controls:{},order:[]};
      return new SessionControl({state,lease,host,clock,binding});
    }catch(error){lease.release();throw error;}
  }
  constructor({state,lease,host,clock,binding}){
    this.#state=state;this.#lease=lease;this.#host=host;this.#clock=clock;this.#binding=structuredClone(binding);
    const journal=this.#journal;
    need(journal.schema_version===1&&object(journal.commands)&&object(journal.controls)&&Array.isArray(journal.order)&&journal.order.length<=1000&&
      journal.order.length===Object.keys(journal.commands).length&&new Set(journal.order).size===journal.order.length,'SESSION_STATE_CORRUPT');
    for(const id of journal.order){
      const c=own(journal.commands,id);
      need(uuid(id)&&object(c)&&c.command_id===id&&uuid(c.client_user_message_id)&&PHASES.has(c.phase)&&validText(c.text)&&
        validTime(c.expires_at)&&runtimeDigest(c.route)===runtimeDigest(binding.route)&&c.digest===runtimeDigest(this.#inputOf(c)),'SESSION_STATE_CORRUPT');
      if(c.phase==='result_pending')need(typeof c.turn_id==='string'&&c.turn_id&&c.native_status==='completed'&&c.result===undefined,'SESSION_STATE_CORRUPT');
      if(c.resume_of)need(uuid(c.resume_of)&&own(journal.commands,c.resume_of)&&
        (journal.commands[c.resume_of].resumed_by===id||['cancelled','expired'].includes(c.phase)),'SESSION_STATE_CORRUPT');
      if(c.resumed_by)need(own(journal.commands,c.resumed_by)?.resume_of===id,'SESSION_STATE_CORRUPT');
      if(c.stop_control_id)need(own(journal.controls,c.stop_control_id)?.command_id===id,'SESSION_STATE_CORRUPT');
      if(c.child_stop_phase!==undefined)need(c.stop_control_id&&['prepared','replied','outcome_unknown'].includes(c.child_stop_phase),'SESSION_STATE_CORRUPT');
      if(c.resume_queue_phase!==undefined)need(c.resume_of&&['prepared','replied','outcome_unknown'].includes(c.resume_queue_phase),'SESSION_STATE_CORRUPT');
    }
    need(Object.keys(journal.controls).length<=1000,'SESSION_STATE_LIMIT');
    for(const [id,control]of Object.entries(journal.controls))need(uuid(id)&&control.control_id===id&&own(journal.commands,control.command_id)?.stop_control_id===id&&
      typeof control.expected_turn_id==='string'&&control.expected_turn_id===journal.commands[control.command_id].turn_id,'SESSION_STATE_CORRUPT');
    need(journal.order.filter(id=>!TERMINAL.has(journal.commands[id].phase)&&journal.commands[id].phase!=='queued').length<=1,'SESSION_STATE_CORRUPT');
    this.#save();
  }
  get #journal(){return this.#state.value.native_control;}
  #now(){return new Date(this.#clock()).toISOString();}
  #check(){need(!this.#closed,'SESSION_CONTROL_CLOSED');need(!this.#poisoned,'SESSION_STORAGE_UNCERTAIN');this.#lease.assertHeld();}
  #save(){try{this.#state.save();}catch(error){this.#poisoned=true;throw error;}}
  #inputOf(c){return{command_id:c.command_id,task_id:c.task_id,route:c.route,text:c.text,expires_at:c.expires_at,resume_of:c.resume_of??null};}
  #change(c,phase,reason=null){c.phase=phase;c.reason=reason;c.updated_at=this.#now();this.#save();return publicCommand(c);}
  async #exclusive(callback){this.#check();need(!this.#busy,'SESSION_CONTROL_BUSY');this.#busy=true;try{return await callback();}finally{this.#busy=false;}}
  #command(id){need(uuid(id)&&own(this.#journal.commands,id),'SESSION_COMMAND_UNKNOWN');return this.#journal.commands[id];}
  list(){this.#check();return this.#journal.order.map(id=>publicCommand(this.#journal.commands[id]));}
  enqueue(input){this.#check();need(!this.#busy,'SESSION_CONTROL_BUSY');return this.#enqueue(input);}
  #enqueue(input){
    need(object(input)&&Object.keys(input).every(k=>['command_id','task_id','route','text','expires_at','resume_of'].includes(k))&&uuid(input.command_id)&&
      typeof input.task_id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.task_id)&&validText(input.text)&&validTime(input.expires_at)&&
      validRoute(input.route)&&runtimeDigest(input.route)===runtimeDigest(this.#binding.route),'SESSION_COMMAND_INVALID');
    const normalized=this.#inputOf(input),digest=runtimeDigest(normalized),prior=own(this.#journal.commands,input.command_id);
    if(prior){need(prior.digest===digest,'SESSION_COMMAND_CONFLICT');return publicCommand(prior);}
    need(this.#journal.order.length<1000,'SESSION_STATE_LIMIT');
    if(input.resume_of){const parent=this.#command(input.resume_of),previous=own(this.#journal.commands,parent.resumed_by);
      need(parent.phase==='stopped'&&(!parent.resumed_by||['cancelled','expired'].includes(previous?.phase))&&parent.task_id===input.task_id,'SESSION_RESUME_NOT_READY');parent.resumed_by=input.command_id;}
    else need(!this.#journal.order.some(id=>this.#journal.commands[id].task_id===input.task_id),'SESSION_TASK_ALREADY_ADMITTED');
    const c={...structuredClone(normalized),digest,client_user_message_id:randomUUID(),phase:'queued',reason:null,created_at:this.#now(),updated_at:this.#now()};
    this.#journal.commands[c.command_id]=c;this.#journal.order.push(c.command_id);this.#save();return publicCommand(c);
  }
  cancelQueued(commandId){
    this.#check();need(!this.#busy,'SESSION_CONTROL_BUSY');const c=this.#command(commandId);
    if(c.phase==='cancelled')return publicCommand(c);
    need(c.phase==='queued','SESSION_COMMAND_ALREADY_DISPATCHED');return this.#change(c,'cancelled','cancelled_before_dispatch');
  }
  async #hostStatus(){
    const status=await this.#host.status();
    need(object(status)&&status.conversationId===this.#binding.route.session_id&&status.workspace===this.#binding.workspace,'SESSION_HOST_MISMATCH');
    need(typeof status.busy==='boolean','SESSION_HOST_STATUS_INVALID');return status;
  }
  async tick(){return this.#exclusive(async()=>{
    const commands=this.#journal.order.map(id=>this.#journal.commands[id]);
    // Expiry closes only commands proven not sent. Sent/ambiguous input still
    // needs reconciliation, even when its original delivery window has ended.
    for(const c of commands)if(c.phase==='queued'&&Date.parse(c.expires_at)<=this.#clock())this.#change(c,'expired','deadline_before_dispatch');
    const active=commands.find(c=>!TERMINAL.has(c.phase)&&c.phase!=='queued');
    if(active){await this.#reconcile(active);return this.list();}
    const next=commands.find(c=>c.phase==='queued');if(!next)return this.list();
    let status;
    try{status=await this.#hostStatus();}catch(error){this.#change(next,'queued',safeCode(error));return this.list();}
    const nativeQueue=this.#host.capabilities?.atomic_queue_append===true;
    if(status.busy&&!nativeQueue){this.#change(next,'queued','waiting_for_idle');return this.list();}
    // A local busy check is not atomic with the user's desktop input. Do not
    // expose execution until the host guarantees reject-on-busy (never steer).
    if(this.#host.capabilities?.atomic_idle_start!==true&&!nativeQueue){this.#change(next,'queued','host_idle_admission_unverified');return this.list();}
    if(Date.parse(next.expires_at)<=this.#clock()){this.#change(next,'expired','deadline_before_dispatch');return this.list();}
    this.#change(next,'sending');
    try{
      const reply=await this.#host.start({text:next.text,clientUserMessageId:next.client_user_message_id,expiresAt:next.expires_at});
      need(reply?.accepted===true&&reply.clientUserMessageId===next.client_user_message_id,'SESSION_START_RECEIPT_INVALID');
      this.#change(next,'accepted','awaiting_native_turn');
    }catch(error){
      if(error.code==='CODEX_DESKTOP_BUSY'&&error.outcomeUnknown===false)this.#change(next,'queued','waiting_for_idle');
      else this.#change(next,'outcome_unknown',safeCode(error));
    }
    return this.list();
  });}
  async #reconcile(c){
    let observed;
    try{await this.#hostStatus();observed=await this.#host.inspectOperation(c.client_user_message_id);}
    catch(error){this.#change(c,'outcome_unknown',safeCode(error));return;}
    if(observed?.found!==true){this.#change(c,'outcome_unknown','native_operation_not_proven');return;}
    if(observed.status==='queued'){
      // An acknowledged native queue entry is neither a running turn nor a
      // missing operation. Once sent, local cancellation/expiry must not claim
      // it was removed from the native queue. Reconcile until it is consumed.
      need(this.#host.capabilities?.atomic_queue_append===true&&!c.turn_id&&!observed.turnId,'SESSION_NATIVE_TURN_CONFLICT');
      if(c.resume_of&&this.#host.capabilities?.atomic_queued_resume===true&&!c.resume_queue_phase){
        // Explicit Continue restores normal scheduling of the original native
        // session. Select this directive first, then let already-authorized
        // native queue entries run in their existing order. Never use steer.
        // Persist intent before the mutation; a lost reply/restart only reads
        // the original message ID and cannot start a second queued entry.
        if(Date.parse(c.expires_at)<=this.#clock()){
          this.#change(c,'accepted','resume_expired_in_native_queue');return;
        }
        c.resume_queue_phase='prepared';this.#change(c,'accepted','starting_native_continuation');
        try{
          const reply=await this.#host.startQueued(c.client_user_message_id,{expiresAt:c.expires_at});
          need(reply?.clientUserMessageId===c.client_user_message_id&&typeof reply.requested==='boolean','SESSION_RESUME_RECEIPT_INVALID');
          c.resume_queue_phase='replied';
          this.#change(c,'accepted',reply.requested?'awaiting_native_turn':'waiting_in_native_queue');
        }catch(error){c.resume_queue_phase='outcome_unknown';this.#change(c,'accepted',safeCode(error));}
        return;
      }
      this.#change(c,'accepted','waiting_in_native_queue');return;
    }
    if(observed.status==='rejected'){
      // A native admission hook can definitively drop an input before a turn
      // exists (for example after explicit user Stop). Never invent a turn ID.
      need(this.#host.capabilities?.atomic_queue_append===true&&!c.turn_id&&!observed.turnId,'SESSION_NATIVE_TURN_CONFLICT');
      this.#change(c,'failed','native_input_rejected_before_turn');return;
    }
    need(typeof observed.turnId==='string'&&observed.turnId&&(!c.turn_id||c.turn_id===observed.turnId),'SESSION_NATIVE_TURN_CONFLICT');
    c.turn_id=observed.turnId;c.native_status=observed.status;
    if(observed.status==='inProgress'){this.#change(c,c.stop_control_id?'stop_requested':'running');return;}
    if(observed.status==='completed'){
      // Completion evidence and result delivery are separate. Never extract
      // arbitrary historical/commentary/tool text as the final task result.
      // This opt-in preserves legacy host behavior. A strict host must attest
      // the complete final snapshot, even when it is intentionally empty;
      // missing/false/null resultComplete never means an empty final result.
      // Do not publish partial text or release the queue while waiting. tick()
      // will re-read this same operation, with the existing exact-turn fence.
      if(this.#host.capabilities?.final_result_evidence===true&&observed.resultComplete!==true){
        this.#change(c,'result_pending','native_result_not_complete');return;
      }
      if(observed.result!==undefined){
        need(object(observed.result)&&observed.result.type==='text'&&typeof observed.result.text==='string'&&
          Buffer.byteLength(observed.result.text)<=1024*1024&&Object.keys(observed.result).every(k=>['type','text'].includes(k)),'SESSION_NATIVE_RESULT_INVALID');
        c.result=structuredClone(observed.result);
      }
      this.#change(c,'completed',c.stop_control_id?'completed_before_stop':null);return;
    }
    if(observed.status==='failed'){this.#change(c,'failed','native_turn_failed');return;}
    if(observed.status!=='interrupted'){this.#change(c,'outcome_unknown','native_status_unrecognized');return;}
    if (c.stop_control_id && this.#host.capabilities?.exact_turn_child_stop===true && !c.child_stop_phase) {
      // Persist separately from the original turn interrupt. On restart or a
      // lost reply, only inspect native evidence; never repeat a child kill.
      c.child_stop_phase='prepared';this.#change(c,'stop_unconfirmed','awaiting_native_child_stop');
      try { await this.#host.stopChildren(c.turn_id);c.child_stop_phase='replied'; }
      catch { c.child_stop_phase='outcome_unknown'; }
      this.#change(c,'stop_unconfirmed','awaiting_stop_evidence');
    }
    let proof;
    try{proof=await this.#host.inspectStop?.(c.turn_id);}catch{}
    if(proof?.conversationId===this.#binding.route.session_id&&proof?.turnId===c.turn_id&&proof.terminal===true&&proof.descendantsStopped===true)
      this.#change(c,'stopped','native_turn_and_children_stopped');
    else this.#change(c,'stop_unconfirmed','child_stop_not_proven');
  }
  requestStop({control_id,command_id,expected_turn_id}){return this.#exclusive(async()=>{
    need(uuid(control_id)&&typeof expected_turn_id==='string'&&expected_turn_id.length>0&&expected_turn_id.length<=160,'SESSION_STOP_INVALID');
    const c=this.#command(command_id),old=own(this.#journal.controls,control_id);
    if(old){need(old.command_id===command_id&&old.expected_turn_id===expected_turn_id,'SESSION_STOP_CONFLICT');return publicCommand(c);}
    need(!c.stop_control_id&&c.turn_id===expected_turn_id&&c.phase==='running','SESSION_STOP_STALE');
    need(this.#host.capabilities?.exact_turn_interrupt===true,'SESSION_STOP_UNSUPPORTED');
    await this.#hostStatus();
    const control={control_id,command_id,expected_turn_id,created_at:this.#now(),phase:'prepared'};
    this.#journal.controls[control_id]=control;c.stop_control_id=control_id;this.#change(c,'stop_requested');
    try{
      const receipt=await this.#host.interrupt(expected_turn_id);
      need(receipt?.expectedTurnId===expected_turn_id&&typeof receipt.requested==='boolean','SESSION_STOP_RECEIPT_INVALID');
      control.phase='replied';control.requested=receipt.requested;this.#change(c,'stop_requested','awaiting_stop_evidence');
    }catch(error){control.phase='outcome_unknown';this.#change(c,'outcome_unknown',safeCode(error));}
    // A reply never proves termination. No automatic re-send after a lost
    // reply or restart: reconcile this exact turn, not the session's next one.
    return publicCommand(c);
  });}
  async close(){need(!this.#busy,'SESSION_CONTROL_BUSY');if(this.#closed)return;this.#closed=true;this.#lease.release();}
}
