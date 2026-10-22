import { probeSession } from './ProbeSession';
import { recordings } from './RecordingService';
import { SecureServiceConfig, ServiceConfig, RemoteServices } from './RemoteServices';

// App-level initialization, independent of the currently selected feature page.
// Automatic standby does not open ASR: only a physical glasses wake starts audio.
export class ConnectedServices {
  private started:boolean=false;
  private timer: number = -1;
  private loopGeneration: number = 0;
  private connected:boolean=false;
  private epoch:number=0;
  private busy:boolean=false;
  private configAt:number=0;
  private config:ServiceConfig|undefined=undefined;
  private weatherAt:number=0;
  private voiceRetryAt:number=0;
  private receiverRetryAt:number=0;
  private vault:SecureServiceConfig=new SecureServiceConfig();
  private remote:RemoteServices=new RemoteServices();
  start():void {
    if(this.started)return;this.started=true;this.loop(++this.loopGeneration);
  }
  stop(): void {
    this.started = false; this.loopGeneration++; this.epoch++;
    if (this.timer !== -1) clearTimeout(this.timer); this.timer = -1;
    this.remote.cancel(); this.connected = false;
  }
  invalidate():void { this.configAt=0;this.weatherAt=0;this.voiceRetryAt=0; }
  connectionChanged():void {
    const ready=probeSession.connection.phase==='ready';
    if(ready===this.connected)return;
    this.connected=ready;this.epoch++;this.configAt=0;this.weatherAt=0;this.voiceRetryAt=0;this.receiverRetryAt=0;
    if(!ready)this.remote.cancel();
  }
  private loop(generation: number):void {
    if (!this.started || generation !== this.loopGeneration) return;
    this.tick().catch(()=>{}).finally(()=>{
      if (!this.started || generation !== this.loopGeneration) return;
      this.timer = setTimeout((): void => { this.timer = -1; this.loop(generation); },2000);
    });
  }
  private async tick():Promise<void> {
    this.connectionChanged();
    if(!this.connected||!probeSession.foreground||this.busy||probeSession.firmwareOccupied)return;
    const epoch=this.epoch;this.busy=true;
    try {
      const now=Date.now();
      if(!this.configAt||now-this.configAt>15000){
        this.configAt=now;
        try{this.config=await this.vault.load();}
        catch(_){this.config=undefined;probeSession.features.state.weather='安全配置暂不可读；解锁后重试';return;}
      }
      if(epoch!==this.epoch||!this.connected||!this.config)return;
      const c=this.config;
      if(probeSession.notificationOccupied()||probeSession.agentSuggestionOccupied||probeSession.agentCaptureOccupied||probeSession.voice.active||probeSession.voice.pendingWrites||probeSession.recordingOccupied()||probeSession.prompterOccupied()||probeSession.features.displayActive)return;
      if(c.automaticVoice!==false&&!probeSession.voice.state.enabled&&now>=this.voiceRetryAt&&!probeSession.features.launcherBusy){
        this.voiceRetryAt=now+15000;
        if(c.asrKey&&c.modelKey&&c.asrHost&&c.asrModel){
          try{probeSession.voice.enable(c);await probeSession.features.voiceWakeup();}
          catch(_){probeSession.voice.disable('自动语音初始化未完成，将重试');}
          return; // Keep launcher initialization and weather writes separate.
        }
      }
      if(!recordings.enabled&&now>=this.receiverRetryAt){
        this.receiverRetryAt=now+15000;
        try{await recordings.enable(true,true);}catch(_){}
        return;
      }
      if(c.automaticWeather===false||probeSession.features.launcherBusy||now<this.weatherAt)return;
      this.weatherAt=now+60000;
      if(!c.weatherHost||!c.weatherKey){
        probeSession.features.state.weather='未配置和风天气 Host / Key；不会将测试温度当作实时天气';
        probeSession.features.changed();return;
      }
      try {
        const weather=await this.remote.weather(c);
        if(epoch!==this.epoch||!this.connected||!probeSession.foreground)return;
        if(probeSession.notificationOccupied()||probeSession.features.launcherBusy||probeSession.voice.active||probeSession.voice.pendingWrites)return;
        await probeSession.features.weather(c.weatherCity,weather.temp,weather.icon);
        this.weatherAt=Date.now()+900000;
      }catch(error){probeSession.features.state.weather='天气自动同步未完成：'+(error as Error).message;probeSession.features.changed();}
    }finally{this.busy=false;}
  }
}
export const connectedServices:ConnectedServices=new ConnectedServices();
