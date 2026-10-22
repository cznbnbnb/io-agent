import { RecordingCaptureHandle,RecordingOwnedStart } from './RecordingSession';
import { TaskVoiceCaptureState } from './TaskVoiceReplySession';
import { TaskReplyBinding,taskReplyBindingValid } from './TaskReplyDraft';
import { TaskRecordingResult,TaskRecordingOrigin,taskRecordingOriginValid } from './TaskRecordingTypes';

export interface TaskRecordingCapturePorts {
  start:(options:RecordingOwnedStart)=>Promise<RecordingCaptureHandle>;stop:(handle:RecordingCaptureHandle)=>Promise<void>;
  read:(handle:RecordingCaptureHandle)=>TaskRecordingResult;peer:()=>string;epoch:()=>number;available:()=>boolean;
  load:()=>string;save:(json:string)=>void;
}
class CaptureToken {format:string='turboio-task-voice/1';attempt_id:string='';peer:string='';reply:TaskReplyBinding=new TaskReplyBinding();}
class CaptureJournal {
  schema:number=1;token:string='';auth_epoch:number=0;handle:RecordingCaptureHandle|null=null;
  cancelled:boolean=false;stop_requested:boolean=false;phase:string='preparing';text:string='';origin:TaskRecordingOrigin|null=null;
}

// A composition adapter around the existing recording owner and sealed ASR
// result. It never installs recording callbacks, creates an ASR worker, deletes
// an original, sends an answer, or adopts the newest recording in the library.
export class TaskRecordingCapture {
  state:TaskVoiceCaptureState=new TaskVoiceCaptureState();changed:()=>void=():void=>{};
  private ports:TaskRecordingCapturePorts;private journal:CaptureJournal|null=null;
  private initialized:boolean=false;private fault:boolean=false;private generation:number=0;
  private starting:boolean=false;private stopping:boolean=false;private ticking:boolean=false;
  constructor(ports:TaskRecordingCapturePorts){this.ports=ports;}
  private notify():void{try{this.changed();}catch{}}
  private token(raw:string):CaptureToken|null{
    try{
      if(typeof raw!=='string'||!raw||raw.length>2048)return null;
      const value=JSON.parse(raw) as CaptureToken;
      if(!value||Object.keys(value).length!==4||value.format!=='turboio-task-voice/1'||typeof value.attempt_id!=='string'||!/^voice-[a-f0-9]{32}$/.test(value.attempt_id)||
        typeof value.peer!=='string'||!value.peer||value.peer.length>128||/[\u0000-\u0020\u007f]/.test(value.peer)||!taskReplyBindingValid(value.reply))return null;
      return value;
    }catch{return null;}
  }
  private handleValid(handle:RecordingCaptureHandle):boolean{
    return !!handle&&Object.keys(handle).length===6&&typeof handle.ownerId==='string'&&/^voice-[a-f0-9]{32}$/.test(handle.ownerId)&&
      typeof handle.cleanupId==='string'&&/^[a-f0-9]{32}$/.test(handle.cleanupId)&&typeof handle.uuid==='string'&&/^[A-Za-z0-9-]{1,64}$/.test(handle.uuid)&&
      typeof handle.directory==='string'&&handle.directory.length<=1024&&
      /^.+\/take-[a-f0-9]{32}$/.test(handle.directory)&&!/[\u0000-\u001f\u007f\\]/.test(handle.directory)&&!/(^|\/)\.\.?($|\/)/.test(handle.directory)&&
      typeof handle.peer==='string'&&!!handle.peer&&handle.peer.length<=128&&!/[\u0000-\u0020\u007f]/.test(handle.peer)&&
      Number.isSafeInteger(handle.connectionEpoch)&&handle.connectionEpoch>=0;
  }
  private sameHandle(a:RecordingCaptureHandle,b:RecordingCaptureHandle):boolean{
    return this.handleValid(a)&&this.handleValid(b)&&a.ownerId===b.ownerId&&a.cleanupId===b.cleanupId&&a.uuid===b.uuid&&
      a.directory===b.directory&&a.peer===b.peer&&a.connectionEpoch===b.connectionEpoch;
  }
  private copyHandle(value:RecordingCaptureHandle):RecordingCaptureHandle{return JSON.parse(JSON.stringify(value)) as RecordingCaptureHandle;}
  private copyOrigin(value:TaskRecordingOrigin):TaskRecordingOrigin{return JSON.parse(JSON.stringify(value)) as TaskRecordingOrigin;}
  private originMatches(origin:TaskRecordingOrigin,handle:RecordingCaptureHandle):boolean{
    return taskRecordingOriginValid(origin)&&origin.name===handle.directory.slice(handle.directory.lastIndexOf('/')+1)&&origin.uuid===handle.uuid&&
      origin.owner_id===handle.ownerId&&origin.cleanup_id===handle.cleanupId&&origin.peer===handle.peer;
  }
  private sameOrigin(a:TaskRecordingOrigin,b:TaskRecordingOrigin):boolean{
    return taskRecordingOriginValid(a)&&taskRecordingOriginValid(b)&&a.schema===b.schema&&a.name===b.name&&a.uuid===b.uuid&&a.owner_id===b.owner_id&&
      a.cleanup_id===b.cleanup_id&&a.peer===b.peer&&a.raw_bytes===b.raw_bytes&&a.raw_sha256===b.raw_sha256&&a.result_sha256===b.result_sha256&&
      a.material_id===b.material_id&&a.material_revision===b.material_revision&&a.exit_evidence===b.exit_evidence;
  }
  private validJournal(value:CaptureJournal):boolean{
    if(!value||Object.keys(value).length!==9||value.schema!==1||!Number.isSafeInteger(value.auth_epoch)||value.auth_epoch<1||
      typeof value.cancelled!=='boolean'||typeof value.stop_requested!=='boolean'||typeof value.text!=='string'||value.text.length>65536||
      !['preparing','capturing','waiting','cleanup_pending','complete','failed'].includes(value.phase))return false;
    const token=this.token(value.token);if(!token)return false;
    if(value.handle!==null&&(!this.handleValid(value.handle)||value.handle.ownerId!==token.attempt_id||value.handle.peer!==token.peer))return false;
    if(value.origin!==null&&(!value.handle||!this.originMatches(value.origin,value.handle)))return false;
    return value.phase!=='complete'||!!value.handle&&!value.cancelled&&!!value.text.trim()&&!!value.origin;
  }
  private broken():void{
    this.fault=true;this.state.active=true;this.state.phase='cleanup_pending';this.state.valid=false;
    this.state.transcriptStatus='partial';this.notify();
  }
  private persist():void{
    if(!this.journal||!this.validJournal(this.journal))throw new Error('TASK_RECORDING_JOURNAL_INVALID');
    const raw=JSON.stringify(this.journal);if(raw.length>262144)throw new Error('TASK_RECORDING_JOURNAL_TOO_LARGE');
    try{this.ports.save(raw);}catch{this.broken();throw new Error('TASK_RECORDING_JOURNAL_WRITE');}
  }
  private refresh():void{
    const value=this.journal;if(!value){this.state=new TaskVoiceCaptureState();this.notify();return;}
    const state=new TaskVoiceCaptureState();state.binding=value.token;state.text=value.text;
    state.phase=value.phase==='complete'?'draft':value.phase==='capturing'?'listening':value.phase==='waiting'?'transcribing':value.phase;
    state.active=['preparing','capturing','waiting','cleanup_pending'].includes(value.phase);
    state.valid=value.phase==='complete'&&!value.cancelled&&!this.fault;state.transcriptStatus=state.valid?'complete':value.cancelled?'cancelled':value.phase==='failed'?'partial':'pending';
    state.exitEvidence=value.origin?.exit_evidence||'none';this.state=state;this.notify();
  }
  initialize():void{
    if(this.initialized)return;this.initialized=true;
    try{
      const raw=this.ports.load();if(typeof raw!=='string'||raw.length>262144)throw new Error('TASK_RECORDING_JOURNAL_INVALID');
      if(!raw){this.refresh();return;}
      const value=JSON.parse(raw) as CaptureJournal;if(!this.validJournal(value))throw new Error('TASK_RECORDING_JOURNAL_INVALID');
      this.journal=value;
      // A saved start is never a microphone instruction. Unfinished work may
      // only regain an exact-owner stop or be classified by the source reader.
      if(value.phase!=='complete'){value.cancelled=true;value.stop_requested=true;value.phase=value.handle?'cleanup_pending':'failed';this.persist();}
      this.refresh();if(value.phase==='complete')this.tick();
    }catch{this.broken();}
  }
  private authorized(value:CaptureJournal,generation:number,allowStopped:boolean=false):boolean{
    const token=this.token(value.token);
    return !this.fault&&this.journal===value&&generation===this.generation&&!value.cancelled&&(allowStopped||!value.stop_requested)&&!!token&&
      token.peer===this.ports.peer()&&value.auth_epoch===this.ports.epoch()&&Date.parse(token.reply.expires_at)>Date.now()&&this.ports.available();
  }
  async start(token:string,guard:()=>Promise<void>):Promise<void>{
    const parsed=this.token(token),epoch=this.ports.epoch();
    if(!this.initialized||this.fault||this.journal||this.starting||!parsed||typeof guard!=='function'||parsed.peer!==this.ports.peer()||
      !Number.isSafeInteger(epoch)||epoch<1||Date.parse(parsed.reply.expires_at)<=Date.now()||!this.ports.available())throw new Error('TASK_RECORDING_NOT_READY');
    const value=new CaptureJournal();value.token=token;value.auth_epoch=epoch;this.journal=value;const generation=++this.generation;
    this.persist();this.starting=true;this.refresh();
    try{
      const options:RecordingOwnedStart={ownerId:parsed.attempt_id,maxDurationMs:15000,
        guard:async():Promise<void>=>{if(!this.authorized(value,generation))throw new Error('TASK_RECORDING_CONTEXT_CHANGED');await guard();if(!this.authorized(value,generation))throw new Error('TASK_RECORDING_CONTEXT_CHANGED');},
        current:():boolean=>this.authorized(value,generation),
        reserved:(handle:RecordingCaptureHandle):void=>{
          if(this.journal!==value||!this.handleValid(handle)||handle.ownerId!==parsed.attempt_id||handle.peer!==parsed.peer||value.handle&&!this.sameHandle(value.handle,handle))throw new Error('TASK_RECORDING_OWNER_CHANGED');
          value.handle=this.copyHandle(handle);value.phase=value.cancelled||value.stop_requested?'cleanup_pending':'capturing';this.persist();this.refresh();
        }};
      const handle=await this.ports.start(options);
      if(this.journal!==value||!value.handle||!this.sameHandle(value.handle,handle))throw new Error('TASK_RECORDING_OWNER_CHANGED');
      // A native write may finish after the user requested a normal stop.
      // The recorder's final current() check still fences late microphone
      // starts; an already-submitted owned start can finish into ASR waiting.
      if(!this.authorized(value,generation,true)){await this.stop(true);throw new Error('TASK_RECORDING_CONTEXT_CHANGED');}
      this.tick();
    }catch(error){
      if(this.journal===value&&!this.fault){value.cancelled=true;value.stop_requested=true;value.phase=value.handle?'cleanup_pending':'failed';this.persist();this.refresh();
        if(value.handle)try{await this.ports.stop(this.copyHandle(value.handle));}catch{}this.tick();}
      throw new Error('TASK_RECORDING_START_UNCONFIRMED');
    }finally{this.starting=false;}
  }
  async stop(cancelled:boolean):Promise<void>{
    const value=this.journal;if(!this.initialized||this.fault||!value||value.phase==='complete'||value.phase==='failed')throw new Error('TASK_RECORDING_NOT_ACTIVE');
    if(cancelled){value.cancelled=true;++this.generation;}
    value.stop_requested=true;value.phase=value.handle?'cleanup_pending':'preparing';
    try{this.persist();this.refresh();}catch{
      // Loss of the task journal must not veto the already-owned recorder's
      // emergency stop. Preserve the fault and never infer a device exit.
      if(value.handle&&!this.stopping){this.stopping=true;try{await this.ports.stop(this.copyHandle(value.handle));}catch{}finally{this.stopping=false;}}
      throw new Error('TASK_RECORDING_JOURNAL_WRITE');
    }
    if(!value.handle)return;
    // The ordinary recorder may already have released its hardware owner
    // while its sealed ASR job is still queued. Ending that wait must not send
    // another microphone stop or acquire a replacement recording's cleanup.
    try{
      const result=this.checkedResult(value);
      if(['device_event','user_confirmation'].includes(result.exitEvidence)){this.tick();return;}
    }catch{/* Unverified exit retains the precise-owner stop obligation. */}
    if(this.stopping)return;
    this.stopping=true;try{await this.ports.stop(this.copyHandle(value.handle));}
    finally{this.stopping=false;if(this.journal===value)this.tick();}
  }
  async cleanup():Promise<void>{
    const value=this.journal;if(this.fault||!value||value.phase!=='cleanup_pending'||!value.handle)throw new Error('TASK_RECORDING_CLEANUP_PROTECTED');
    await this.stop(true);
  }
  private checkedResult(value:CaptureJournal):TaskRecordingResult{
    if(!value.handle)throw new Error('TASK_RECORDING_SOURCE_MISSING');
    const result=this.ports.read(this.copyHandle(value.handle));
    if(!result||Object.keys(result).length!==4||!['waiting','capturing','cleanup_pending','complete','failed'].includes(result.state)||
      !['none','device_event','user_confirmation'].includes(result.exitEvidence)||typeof result.text!=='string'||result.text.length>65536||
      result.origin!==null&&!this.originMatches(result.origin,value.handle))throw new Error('TASK_RECORDING_SOURCE_INVALID');
    if(result.state==='complete'&&(!result.text.trim()||!result.origin||!['device_event','user_confirmation'].includes(result.exitEvidence)||result.origin.exit_evidence!==result.exitEvidence))throw new Error('TASK_RECORDING_SOURCE_INVALID');
    return result;
  }
  tick():void{
    if(!this.initialized||this.fault||this.ticking||!this.journal)return;
    this.ticking=true;
    try{
      const value=this.journal,token=this.token(value.token);if(!token)return;
      if(Date.parse(token.reply.expires_at)<=Date.now()&&!value.cancelled){value.cancelled=true;value.stop_requested=true;++this.generation;
        value.phase=value.handle?'cleanup_pending':'failed';this.persist();this.refresh();if(value.handle)void this.stop(true).catch(()=>{});}
      if(!value.handle)return;
      let result:TaskRecordingResult;try{result=this.checkedResult(value);}catch{
        // An immutable completed origin already proves microphone exit. A
        // deleted/unreadable source invalidates this answer, not that exit.
        if(value.phase==='complete'){value.phase='failed';value.cancelled=true;this.persist();this.refresh();}return;
      }
      if(value.phase==='complete'){
        if(result.state!=='complete'||result.text!==value.text||!value.origin||!result.origin||!this.sameOrigin(value.origin,result.origin)){
          value.phase='failed';value.cancelled=true;this.persist();this.refresh();
        }return;
      }
      // Cancellation and restart may retain audio/transcripts, but never turn
      // them into a valid task answer. A missing exit remains a cleanup debt.
      if(value.cancelled){
        const phase=['device_event','user_confirmation'].includes(result.exitEvidence)||
          !!value.origin&&['device_event','user_confirmation'].includes(value.origin.exit_evidence)?'failed':'cleanup_pending';
        if(value.phase!==phase){value.phase=phase;this.persist();this.refresh();}return;
      }
      if(result.state==='complete'){
        value.text=result.text;value.origin=this.copyOrigin(result.origin as TaskRecordingOrigin);value.phase='complete';this.persist();this.refresh();return;
      }
      const phase=result.state==='failed'?(result.exitEvidence==='none'?'cleanup_pending':'failed'):result.state;
      if(value.phase!==phase){value.phase=phase;this.persist();this.refresh();}
    }catch{this.broken();}finally{this.ticking=false;}
  }
  disconnected():void{
    const value=this.journal;if(!value||this.fault)return;++this.generation;value.cancelled=true;value.stop_requested=true;
    value.phase=value.handle?'cleanup_pending':'failed';this.persist();this.refresh();
  }
  lateAudio(peer:string,authEpoch:number,uuid:string):void{
    const value=this.journal,handle=value?.handle;
    if(!this.initialized||this.fault||!value||!handle||peer!==handle.peer||authEpoch!==value.auth_epoch||uuid!==handle.uuid)return;
    let result:TaskRecordingResult;try{result=this.checkedResult(value);}catch{return;}
    // The caller supplies only decoded business-14 audio identities. During
    // capture or its tail grace these are ordinary packets; only a previously
    // sealed exact source is invalidated, before any answer-source registration.
    if(!['waiting','complete','failed'].includes(result.state)||!['device_event','user_confirmation'].includes(result.exitEvidence))return;
    if(value.cancelled&&value.phase==='failed')return;
    ++this.generation;value.cancelled=true;value.stop_requested=true;value.phase='failed';
    try{this.persist();this.refresh();}catch{this.broken();}
  }
  clear():void{
    if(this.fault||this.starting||this.stopping||this.journal&& !['complete','failed'].includes(this.journal.phase))throw new Error('TASK_RECORDING_DRAFT_PROTECTED');
    try{this.ports.save('');}catch{this.broken();throw new Error('TASK_RECORDING_JOURNAL_WRITE');}
    ++this.generation;this.journal=null;this.refresh();
  }
  sourceOrigin(token:string,text:string):TaskRecordingOrigin{
    this.tick();const value=this.journal;
    if(this.fault||!value||value.token!==token||value.phase!=='complete'||value.cancelled||value.text!==text||!value.origin||!this.state.valid)throw new Error('TASK_RECORDING_SOURCE_UNVERIFIED');
    return this.copyOrigin(value.origin);
  }
  sourceEpoch(token:string,text:string):number{this.sourceOrigin(token,text);return (this.journal as CaptureJournal).auth_epoch;}
}
