import { util } from '@kit.ArkTS';
import { PlaybackSelection,PlaybackReference,PlaybackLease,validPlaybackSelection } from './LocalAudioSource';

export class PlaybackSnapshot {
  schema:number=1;session_id:string='';phase:string='idle';source:PlaybackReference|undefined=undefined;
  position_ms:number=0;position_known:boolean=false;duration_ms:number=0;duration_known:boolean=false;
  native_state:string='';callback_seq:number=0;error:string='';note:string='';audio_output_verified:boolean=false;
}
export class PlaybackDriverEvent {
  kind:string='';native_state:string='';position_ms:number=-1;duration_ms:number=-1;error:string='';note:string='';
}
export interface PlaybackDriver {
  prepare:(lease:PlaybackLease,event:(value:PlaybackDriverEvent)=>void)=>Promise<void>;
  play:()=>Promise<void>;pause:()=>Promise<void>;seek:(position:number)=>Promise<void>;release:()=>Promise<void>;
}
export interface PlaybackControllerPorts {
  resolve:(selection:PlaybackSelection)=>PlaybackLease;create:()=>PlaybackDriver;foreground:()=>boolean;
}
class PlaybackRun {
  id:string='';selection:PlaybackSelection=new PlaybackSelection();lease:PlaybackLease|undefined=undefined;
  driver:PlaybackDriver|undefined=undefined;pending:number=0;intent:string='paused';cancelled:boolean=false;closed:boolean=false;focusPause:boolean=false;
  quarantined:boolean=false;cleanup:Promise<void>|undefined=undefined;finalPhase:string='idle';finalError:string='';finalNote:string='';
}
const ERRORS:string[]=['PLAYBACK_INVALID','PLAYBACK_UNAVAILABLE','PLAYBACK_SOURCE_CHANGED','PLAYBACK_STALE_SESSION','PLAYBACK_BUSY',
  'PLAYBACK_NOT_FOREGROUND','PLAYBACK_PLAYER_FAILED','PLAYBACK_CLEANUP_PENDING','PLAYBACK_IN_USE','PLAYBACK_SOURCE_UNAVAILABLE',
  'PLAYBACK_INCOMPLETE','PLAYBACK_DELETED','PLAYBACK_ANCHOR_STALE','PLAYBACK_TIME_UNKNOWN'];
function safeError(error:Error,fallback:string='PLAYBACK_PLAYER_FAILED'):Error{return new Error(ERRORS.includes(error.message)?error.message:fallback);}
function copyReference(value:PlaybackReference):PlaybackReference{
  const out=new PlaybackReference();out.kind=value.kind;out.name=value.name;out.audio_sha256=value.audio_sha256;out.format=value.format;
  out.revision=value.revision;out.utterance_id=value.utterance_id;return out;
}
function sameReference(a:PlaybackReference,b:PlaybackReference):boolean{
  return a.kind===b.kind&&a.name===b.name&&a.audio_sha256===b.audio_sha256&&a.format===b.format&&a.revision===b.revision&&a.utterance_id===b.utterance_id;
}
function observed(value:number):boolean{return Number.isSafeInteger(value)&&value>=0;}

export class PlaybackController {
  private ports:PlaybackControllerPorts;private state:PlaybackSnapshot=new PlaybackSnapshot();private run:PlaybackRun|undefined=undefined;
  private generation:number=0;private foregroundAllowed:boolean=true;private timer:number=-1;
  private listeners:((value:PlaybackSnapshot)=>void)[]=[];private retained:PlaybackSelection|undefined=undefined;
  constructor(ports:PlaybackControllerPorts){this.ports=ports;}
  snapshot():PlaybackSnapshot{
    const out=new PlaybackSnapshot();out.session_id=this.state.session_id;out.phase=this.state.phase;
    if(this.state.source)out.source=copyReference(this.state.source);out.position_ms=this.state.position_ms;out.position_known=this.state.position_known;
    out.duration_ms=this.state.duration_ms;out.duration_known=this.state.duration_known;out.native_state=this.state.native_state;
    out.callback_seq=this.state.callback_seq;out.error=this.state.error;out.note=this.state.note;return out;
  }
  subscribe(listener:(value:PlaybackSnapshot)=>void):()=>void{
    if(this.listeners.length>=32)throw new Error('PLAYBACK_BUSY');this.listeners.push(listener);
    return ():void=>{this.listeners=this.listeners.filter((value:(snapshot:PlaybackSnapshot)=>void):boolean=>value!==listener);};
  }
  private changed():void{for(const listener of this.listeners.slice()){try{listener(this.snapshot());}catch(_){}}}
  private foreground():boolean{try{return this.foregroundAllowed&&this.ports.foreground();}catch(_){return false;}}
  private session(id:string):PlaybackRun|undefined{
    if(typeof id!=='string'||!id||id!==this.state.session_id)throw new Error('PLAYBACK_STALE_SESSION');return this.run;
  }
  private current(run:PlaybackRun,ticket:number):void{
    if(this.run!==run||run.cancelled||ticket!==this.generation)throw new Error(run.finalError||'PLAYBACK_STALE_SESSION');
    if(!this.foreground()){this.failed(run,'PLAYBACK_NOT_FOREGROUND');throw new Error('PLAYBACK_NOT_FOREGROUND');}
  }
  private check(run:PlaybackRun,ticket:number,strong:boolean):void{
    this.current(run,ticket);
    if(!run.lease)throw new Error('PLAYBACK_UNAVAILABLE');
    try{run.lease.check(strong);}catch(error){const safe=safeError(error as Error,'PLAYBACK_SOURCE_CHANGED');this.failed(run,safe.message);throw safe;}
  }
  private watch(run:PlaybackRun):void{
    this.clearWatch();this.timer=setInterval(():void=>{
      if(this.run!==run||run.cancelled)return;
      try{if(!this.foreground())throw new Error('PLAYBACK_NOT_FOREGROUND');run.lease?.check(false);}
      catch(error){this.failed(run,safeError(error as Error,'PLAYBACK_SOURCE_CHANGED').message);}
    },1000);
  }
  private clearWatch():void{if(this.timer>=0){clearInterval(this.timer);this.timer=-1;}}
  private metrics(event:PlaybackDriverEvent):void{
    if(observed(event.position_ms)){this.state.position_ms=event.position_ms;this.state.position_known=true;}
    if(observed(event.duration_ms)){this.state.duration_ms=event.duration_ms;this.state.duration_known=true;}
  }
  private event(run:PlaybackRun,value:PlaybackDriverEvent):void{
    if(this.run!==run||run.closed)return;
    if(value.kind==='release_done'){
      if(['idle','initialized','prepared','playing','paused','completed','stopped','released','error'].includes(value.native_state))this.state.native_state=value.native_state;
      try{this.finishRelease(run);}catch(_){this.blockCleanup(run);}return;
    }
    if(run.cancelled)return;
    // Position/state callbacks may arrive every 100 ms. Source IO is bounded by
    // the one-second guard and explicit command checks, not callback frequency.
    if(!this.foreground()){this.failed(run,'PLAYBACK_NOT_FOREGROUND');return;}
    this.state.callback_seq++;this.metrics(value);
    if(['idle','initialized','prepared','playing','paused','completed','stopped','released','error'].includes(value.native_state))this.state.native_state=value.native_state;
    if(value.kind==='error'){this.failed(run,safeError(new Error(value.error)).message);return;}
    if(value.kind==='interrupt_pause'){this.interruptedPause(run);return;}
    if(value.kind==='interrupt_stop'||value.kind==='output_lost'){this.releaseForResume(run);return;}
    // A play already submitted to native code may report playing after a pause
    // revoked its intention. Compensate; a stale completion cannot unpause it.
    if(value.kind==='state'&&value.native_state==='playing'&&run.intent!=='playing'){this.interruptedPause(run);return;}
    if(value.native_state==='completed'){run.intent='paused';this.state.phase='ended';}
    else if(value.native_state==='paused'&&this.state.phase!=='loading'){run.intent='paused';this.state.phase='paused';}
    this.changed();
  }
  private blockCleanup(run:PlaybackRun):void{
    if(this.run!==run||run.closed)return;run.quarantined=true;this.state.phase='blocked';this.state.error='PLAYBACK_CLEANUP_PENDING';
    this.state.note='播放器释放尚未确认，请重试停止';this.changed();
  }
  private finishRelease(run:PlaybackRun):void{
    if(run.closed)return;run.lease?.close();run.lease=undefined;run.driver=undefined;run.closed=true;run.quarantined=false;
    if(this.run===run){this.clearWatch();this.run=undefined;this.state.phase=run.finalPhase;this.state.error=run.finalError;
      this.state.note=run.finalNote;this.changed();}
  }
  private cleanup(run:PlaybackRun,phase:string='idle',error:string='',note:string=''):Promise<void>{
    run.cancelled=true;run.intent='paused';run.finalPhase=phase;run.finalError=error;run.finalNote=note;this.clearWatch();
    if(run.closed)return Promise.resolve();if(run.cleanup)return run.cleanup;
    this.state.phase='stopping';this.changed();
    let actual:Promise<void>;
    try{actual=run.driver?run.driver.release():Promise.resolve();}catch(_){actual=Promise.reject(new Error('PLAYBACK_CLEANUP_PENDING'));}
    const completed=actual.then(():void=>{this.finishRelease(run);});
    const waiting=new Promise<void>((resolve:(value?:void)=>void,reject:(error:Error)=>void):void=>{
      const timer=setTimeout(():void=>{this.blockCleanup(run);reject(new Error('PLAYBACK_CLEANUP_PENDING'));},10000);
      completed.then(():void=>{clearTimeout(timer);resolve();},():void=>{clearTimeout(timer);this.blockCleanup(run);reject(new Error('PLAYBACK_CLEANUP_PENDING'));});
    });
    run.cleanup=waiting;waiting.then(():void=>{run.cleanup=undefined;},():void=>{run.cleanup=undefined;});return waiting;
  }
  private failed(run:PlaybackRun,code:string):void{
    if(this.run!==run||run.cancelled)return;this.generation++;this.retained=undefined;
    this.cleanup(run,'error',code,'播放未完成，请重新选择原音').catch(():void=>{});
  }
  private releaseForResume(run:PlaybackRun):void{
    if(this.run!==run||run.cancelled)return;this.generation++;this.retained=validPlaybackSelection(run.selection);
    this.cleanup(run,'paused','','播放已被打断，需手动继续').catch(():void=>{});
  }
  private interruptedPause(run:PlaybackRun):void{
    if(this.run!==run||run.cancelled||run.focusPause)return;this.generation++;run.intent='paused';this.retained=validPlaybackSelection(run.selection);
    this.state.note='播放已被打断，需手动继续';
    if(this.state.native_state==='paused'){this.state.phase='paused';this.changed();return;}
    if(this.state.native_state!=='playing'||!run.driver){this.releaseForResume(run);return;}
    run.pending++;run.focusPause=true;this.state.phase='paused';this.changed();
    run.driver.pause().then(():void=>{
      if(this.run!==run||run.cancelled)return;try{if(!this.foreground())throw new Error('PLAYBACK_NOT_FOREGROUND');run.lease?.check(false);this.state.phase='paused';this.changed();}
      catch(_){this.failed(run,'PLAYBACK_SOURCE_CHANGED');}
    },():void=>{this.releaseForResume(run);}).finally(():void=>{run.pending--;run.focusPause=false;});
  }
  async play(selection:PlaybackSelection):Promise<PlaybackSnapshot>{
    const value=validPlaybackSelection(selection);if(!this.foreground())throw new Error('PLAYBACK_NOT_FOREGROUND');
    if(this.run?.quarantined)throw new Error('PLAYBACK_CLEANUP_PENDING');
    const ticket=++this.generation,old=this.run;this.retained=undefined;
    if(old)await this.cleanup(old);if(ticket!==this.generation)throw new Error('PLAYBACK_STALE_SESSION');
    const id='playback-'+util.generateRandomUUID(false).replace(/-/g,'');
    return this.start(value,id,ticket,-1,undefined);
  }
  private async start(selection:PlaybackSelection,id:string,ticket:number,offset:number,prior:PlaybackReference|undefined):Promise<PlaybackSnapshot>{
    if(ticket!==this.generation)throw new Error('PLAYBACK_STALE_SESSION');if(!this.foreground())throw new Error('PLAYBACK_NOT_FOREGROUND');
    const run=new PlaybackRun();run.id=id;run.selection=validPlaybackSelection(selection);run.intent='playing';run.pending=1;
    this.state=new PlaybackSnapshot();this.state.session_id=id;this.state.phase='loading';this.run=run;this.changed();
    try{
      // resolve already performs the strong source check before returning its
      // independent descriptor. Do not hash it twice in one synchronous turn.
      run.lease=this.ports.resolve(run.selection);
      if(prior&&!sameReference(prior,run.lease.reference))throw new Error('PLAYBACK_SOURCE_CHANGED');
      this.state.source=copyReference(run.lease.reference);this.retained=validPlaybackSelection(selection);
      run.driver=this.ports.create();this.watch(run);this.changed();
      await run.driver.prepare(run.lease,(event:PlaybackDriverEvent):void=>this.event(run,event));this.check(run,ticket,true);
      const target=offset>=0?offset:run.lease.start_ms;
      if(offset>=0||target>0){this.seekable(target);this.state.phase='seeking';this.changed();await run.driver.seek(target);this.check(run,ticket,true);}
      this.current(run,ticket);if(run.intent!=='playing')throw new Error('PLAYBACK_STALE_SESSION');
      await run.driver.play();this.check(run,ticket,true);this.state.phase='playing';this.changed();return this.snapshot();
    }catch(error){const safe=safeError(error as Error,'PLAYBACK_UNAVAILABLE');
      if(this.run===run&&!run.cancelled&&ticket===this.generation){this.retained=undefined;await this.cleanup(run,'error',safe.message,'原音暂不可播放');}
      throw safe;
    }finally{run.pending--;}
  }
  async pause(id:string):Promise<PlaybackSnapshot>{
    const run=this.session(id);if(!run&&this.state.phase==='paused')return this.snapshot();if(!run||run.cancelled)throw new Error('PLAYBACK_UNAVAILABLE');
    if(run.pending)throw new Error('PLAYBACK_BUSY');if(this.state.phase==='paused')return this.snapshot();
    if(this.state.phase!=='playing'||!run.driver)throw new Error('PLAYBACK_UNAVAILABLE');
    const ticket=this.generation;this.check(run,ticket,false);run.pending++;run.intent='paused';
    try{await run.driver.pause();this.check(run,ticket,false);this.state.phase='paused';this.changed();return this.snapshot();}
    catch(error){const safe=safeError(error as Error);if(ticket===this.generation)this.failed(run,safe.message);throw safe;}
    finally{run.pending--;}
  }
  async resume(id:string):Promise<PlaybackSnapshot>{
    const run=this.session(id);if(!this.foreground())throw new Error('PLAYBACK_NOT_FOREGROUND');
    if(run?.quarantined)throw new Error('PLAYBACK_CLEANUP_PENDING');
    if(!run){
      if(this.state.phase!=='paused'||!this.retained||!this.state.source||!this.state.position_known)throw new Error('PLAYBACK_UNAVAILABLE');
      const selection=validPlaybackSelection(this.retained),prior=copyReference(this.state.source),position=this.state.position_ms;
      return this.start(selection,id,++this.generation,position,prior);
    }
    if(run.cancelled)throw new Error('PLAYBACK_UNAVAILABLE');if(run.pending)throw new Error('PLAYBACK_BUSY');
    if(this.state.phase!=='paused'||!run.driver)throw new Error('PLAYBACK_UNAVAILABLE');const ticket=this.generation;
    this.check(run,ticket,true);run.pending++;run.intent='playing';
    try{await run.driver.play();this.check(run,ticket,true);this.state.phase='playing';this.state.note='';this.changed();return this.snapshot();}
    catch(error){const safe=safeError(error as Error);if(ticket===this.generation)this.failed(run,safe.message);throw safe;}finally{run.pending--;}
  }
  private seekable(position:number):void{
    if(!Number.isSafeInteger(position)||position<0||position>86400000)throw new Error('PLAYBACK_INVALID');
    if(!this.state.duration_known)throw new Error('PLAYBACK_UNAVAILABLE');if(position>this.state.duration_ms)throw new Error('PLAYBACK_INVALID');
  }
  async seek(id:string,position:number):Promise<PlaybackSnapshot>{
    const run=this.session(id);this.seekable(position);if(!run||run.cancelled||!run.driver)throw new Error('PLAYBACK_UNAVAILABLE');
    if(run.pending)throw new Error('PLAYBACK_BUSY');if(!['playing','paused','ended'].includes(this.state.phase))throw new Error('PLAYBACK_UNAVAILABLE');
    const ticket=this.generation;this.check(run,ticket,true);run.pending++;const intent=run.intent;this.state.phase='seeking';this.changed();
    try{await run.driver.seek(position);this.check(run,ticket,true);this.state.phase=intent==='playing'&&run.intent==='playing'?'playing':'paused';this.changed();return this.snapshot();}
    catch(error){const safe=safeError(error as Error);if(ticket===this.generation)this.failed(run,safe.message);throw safe;}finally{run.pending--;}
  }
  async stop(id:string):Promise<PlaybackSnapshot>{
    const run=this.session(id);this.generation++;this.retained=undefined;
    if(run)await this.cleanup(run);else{this.state.phase='idle';this.state.error='';this.state.note='';this.changed();}return this.snapshot();
  }
  async stopSource(kind:string,name:string):Promise<PlaybackSnapshot>{
    if(this.state.source?.kind!==kind||this.state.source?.name!==name)return this.snapshot();return this.stop(this.state.session_id);
  }
  assertSourceReleased(kind:string,name:string):void{
    if(this.run?.lease&&this.run.lease.reference.kind===kind&&this.run.lease.reference.name===name)throw new Error('PLAYBACK_IN_USE');
  }
  setForeground(value:boolean):void{this.foregroundAllowed=value;if(!value)this.suspend('background').catch(():void=>{});}
  async suspend(reason:string):Promise<PlaybackSnapshot>{
    this.generation++;this.retained=undefined;const run=this.run;
    const note=reason==='background'?'应用已退到后台，播放已停止':'播放已停止';
    if(run)await this.cleanup(run,'idle','',note);else{this.state.phase='idle';this.state.note=note;this.changed();}return this.snapshot();
  }
}
