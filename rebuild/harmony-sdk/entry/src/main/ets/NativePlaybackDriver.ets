import { media } from '@kit.MediaKit';
import { audio } from '@kit.AudioKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { PlaybackLease } from './LocalAudioSource';
import { PlaybackDriver,PlaybackDriverEvent } from './PlaybackController';

class NativeStateWait {
  target:string='';resolve:()=>void=():void=>{};reject:(error:Error)=>void=(_error:Error):void=>{};
}
// No native object is created at module import or construction.
export class NativePlaybackDriver implements PlaybackDriver {
  private player:media.AVPlayer|undefined=undefined;private creation:Promise<media.AVPlayer>|undefined=undefined;
  private emit:((event:PlaybackDriverEvent)=>void)|undefined=undefined;private waits:NativeStateWait[]=[];
  private retired:boolean=false;private released:boolean=false;private started:boolean=false;private seekPending:boolean=false;
  private seekTarget:number=-1;private seekResolve:(()=>void)|undefined=undefined;private seekReject:((error:Error)=>void)|undefined=undefined;
  private releasing:Promise<void>|undefined=undefined;
  private stateChanged=(state:media.AVPlayerState,_reason:media.StateChangeReason):void=>{
    if(this.released)return;this.signal(state);this.event('state',state);
  };
  private timeChanged=(time:number):void=>{if(!this.retired)this.event('time','','',time);};
  private seekDone=(requested:number):void=>{
    if(this.retired||!this.seekPending||requested!==this.seekTarget)return;
    const resolve=this.seekResolve;this.seekPending=false;this.seekResolve=undefined;this.seekReject=undefined;this.event('seek_done');if(resolve)resolve();
  };
  private interrupted=(info:audio.InterruptEvent):void=>{
    if(this.retired||info.eventType!==audio.InterruptType.INTERRUPT_TYPE_BEGIN)return;
    if(info.hintType===audio.InterruptHint.INTERRUPT_HINT_PAUSE)this.event('interrupt_pause');
    else if(info.hintType===audio.InterruptHint.INTERRUPT_HINT_STOP)this.event('interrupt_stop');
    // END/RESUME never starts playback or restores volume.
  };
  private outputChanged=(info:audio.AudioStreamDeviceChangeInfo):void=>{
    if(!this.retired&&info.changeReason===audio.AudioStreamDeviceChangeReason.REASON_OLD_DEVICE_UNAVAILABLE)this.event('output_lost');
  };
  private playerError=(_error:BusinessError):void=>{
    if(this.retired)return;this.retired=true;this.rejectWaits(new Error('PLAYBACK_PLAYER_FAILED'));this.event('error','','PLAYBACK_PLAYER_FAILED');
  };
  private event(kind:string,state:string='',error:string='',position:number=-1):void{
    const event=new PlaybackDriverEvent();event.kind=kind;event.native_state=state;event.error=error;
    const player=this.player;if(player){
      if(!state&&['prepared','playing','paused','completed'].includes(player.state))event.native_state=player.state;
      try{if(['prepared','playing','paused','completed'].includes(player.state)){
        const current=player.currentTime,duration=player.duration;
        if(Number.isSafeInteger(current)&&current>=0)event.position_ms=current;if(Number.isSafeInteger(duration)&&duration>=0)event.duration_ms=duration;
      }}catch(_){}
    }
    if(Number.isSafeInteger(position)&&position>=0)event.position_ms=position;
    try{this.emit?.(event);}catch(_){}
  }
  private attach(player:media.AVPlayer):void{
    player.on('stateChange',this.stateChanged);player.on('timeUpdate',this.timeChanged);player.on('seekDone',this.seekDone);
    player.on('audioInterrupt',this.interrupted);player.on('audioOutputDeviceChangeWithInfo',this.outputChanged);player.on('error',this.playerError);
  }
  private detach(player:media.AVPlayer):void{
    try{player.off('stateChange',this.stateChanged);}catch(_){}try{player.off('timeUpdate',this.timeChanged);}catch(_){}
    try{player.off('seekDone',this.seekDone);}catch(_){}try{player.off('audioInterrupt',this.interrupted);}catch(_){}
    try{player.off('audioOutputDeviceChangeWithInfo',this.outputChanged);}catch(_){}try{player.off('error',this.playerError);}catch(_){}
  }
  private signal(state:string):void{
    const ready=this.waits.filter((value:NativeStateWait):boolean=>value.target===state);
    this.waits=this.waits.filter((value:NativeStateWait):boolean=>value.target!==state);for(const value of ready)value.resolve();
  }
  private rejectWaits(error:Error):void{
    const waits=this.waits;this.waits=[];for(const value of waits)value.reject(error);
    const reject=this.seekReject;this.seekPending=false;this.seekResolve=undefined;this.seekReject=undefined;if(reject)reject(error);
  }
  private waitState(target:string):Promise<void>{
    if(this.player?.state===target)return Promise.resolve();
    return new Promise<void>((resolve:(value?:void)=>void,reject:(error:Error)=>void):void=>{
      const wait=new NativeStateWait();wait.target=target;wait.resolve=():void=>resolve();wait.reject=reject;this.waits.push(wait);
    });
  }
  private deadline(work:Promise<void>,releasing:boolean=false):Promise<void>{
    return new Promise<void>((resolve:(value?:void)=>void,reject:(error:Error)=>void):void=>{
      const timer=setTimeout(():void=>{
        const error=new Error(releasing?'PLAYBACK_CLEANUP_PENDING':'PLAYBACK_PLAYER_FAILED');
        if(!releasing){this.retired=true;this.rejectWaits(error);}reject(error);
      },10000);
      work.then(():void=>{clearTimeout(timer);resolve();},():void=>{clearTimeout(timer);reject(new Error(releasing?'PLAYBACK_CLEANUP_PENDING':'PLAYBACK_PLAYER_FAILED'));});
    });
  }
  private alive():media.AVPlayer{if(this.retired||this.released||!this.player)throw new Error('PLAYBACK_PLAYER_FAILED');return this.player;}
  private async transition(target:string,work:()=>Promise<void>):Promise<void>{
    const observed=this.waitState(target);let action:Promise<void>;
    try{action=work();}catch(_){this.retired=true;this.rejectWaits(new Error('PLAYBACK_PLAYER_FAILED'));action=Promise.reject(new Error('PLAYBACK_PLAYER_FAILED'));}
    try{await this.deadline(Promise.all([observed,action.then(():void=>{if(this.player)this.signal(this.player.state);})]).then(():void=>{}));}
    catch(_){this.retired=true;this.rejectWaits(new Error('PLAYBACK_PLAYER_FAILED'));throw new Error('PLAYBACK_PLAYER_FAILED');}
    this.alive();
  }
  async prepare(lease:PlaybackLease,event:(value:PlaybackDriverEvent)=>void):Promise<void>{
    if(this.started||this.retired)throw new Error('PLAYBACK_BUSY');this.started=true;this.emit=event;
    try{
      this.creation=media.createAVPlayer();
      await this.deadline(this.creation.then((player:media.AVPlayer):void=>{this.player=player;this.attach(player);}));
      const player=this.alive(),initialized=this.waitState('initialized');initialized.catch(():void=>{});
      const descriptor:media.AVFileDescriptor={fd:lease.fd,offset:0,length:lease.length};
      try{player.fdSrc=descriptor;}catch(_){this.rejectWaits(new Error('PLAYBACK_PLAYER_FAILED'));throw new Error('PLAYBACK_PLAYER_FAILED');}
      await this.deadline(initialized);this.alive();
      const renderer:audio.AudioRendererInfo={usage:audio.StreamUsage.STREAM_USAGE_MUSIC,rendererFlags:0};player.audioRendererInfo=renderer;
      await this.transition('prepared',():Promise<void>=>player.prepare());this.alive();
      player.audioInterruptMode=audio.InterruptMode.INDEPENDENT_MODE;this.event('state',player.state);
    }catch(_){this.retired=true;this.rejectWaits(new Error('PLAYBACK_PLAYER_FAILED'));throw new Error('PLAYBACK_PLAYER_FAILED');}
  }
  async play():Promise<void>{const player=this.alive();if(!['prepared','paused','completed'].includes(player.state))throw new Error('PLAYBACK_UNAVAILABLE');await this.transition('playing',():Promise<void>=>player.play());}
  async pause():Promise<void>{
    const player=this.alive();if(player.state==='paused'){this.event('state',player.state);return;}
    if(player.state!=='playing')throw new Error('PLAYBACK_UNAVAILABLE');await this.transition('paused',():Promise<void>=>player.pause());
  }
  async seek(position:number):Promise<void>{
    const player=this.alive();if(this.seekPending)throw new Error('PLAYBACK_BUSY');
    if(!Number.isSafeInteger(position)||position<0||position>86400000||!Number.isFinite(player.duration)||player.duration<0||position>player.duration)throw new Error('PLAYBACK_INVALID');
    if(!['prepared','playing','paused','completed'].includes(player.state))throw new Error('PLAYBACK_UNAVAILABLE');
    this.seekPending=true;this.seekTarget=position;
    const done=new Promise<void>((resolve:(value?:void)=>void,reject:(error:Error)=>void):void=>{this.seekResolve=():void=>resolve();this.seekReject=reject;});
    try{player.seek(position);}catch(_){this.retired=true;this.rejectWaits(new Error('PLAYBACK_PLAYER_FAILED'));}
    try{await this.deadline(done);this.alive();}catch(_){this.retired=true;this.rejectWaits(new Error('PLAYBACK_PLAYER_FAILED'));throw new Error('PLAYBACK_PLAYER_FAILED');}
  }
  release():Promise<void>{
    this.retired=true;this.rejectWaits(new Error('PLAYBACK_PLAYER_FAILED'));if(this.released)return Promise.resolve();
    if(!this.releasing){
      const ready:Promise<void>=this.creation?this.creation.then((player:media.AVPlayer):Promise<void>=>{
        this.player=player;if(player.state==='released')return Promise.resolve();return player.release();
      },():void=>{}):Promise.resolve();
      this.releasing=ready.then(():void=>{
        this.released=true;if(this.player)this.detach(this.player);this.event('release_done',this.player?this.player.state:'');
      },():void=>{this.releasing=undefined;throw new Error('PLAYBACK_CLEANUP_PENDING');});
    }
    return this.deadline(this.releasing,true);
  }
}
export function createNativePlaybackDriver():PlaybackDriver{return new NativePlaybackDriver();}
