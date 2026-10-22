import { probeSession } from '../ProbeSession';
import { ServiceConfig, SecureServiceConfig, RemoteServices } from '../RemoteServices';
import { CloudASR } from '../CloudASR';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { NavigationPanel } from './NavigationPanel';
import { LibraryPanel } from './LibraryPanel';
import { RecordingPanel } from './RecordingPanel';
import { JournalPanel } from './JournalPanel';
import { TeleprompterPanel } from './TeleprompterPanel';
import { NotificationPanel } from './NotificationPanel';
import { connectedServices } from '../ConnectedServices';
import { TaskPanel } from './TaskPanel';
import { BrightnessDrag } from '../BrightnessDrag';
import { DisplayPositionDrag } from '../DisplayPositionDrag';
import { deviceSettingsPorts } from '../DeviceSettingsService';
import { DeviceSettingsPorts } from '../DeviceSettingsControl';

interface SettingSegments {
  label:string;
  options:string[];
  values:number[];
  current:number;
  pick:(value:number)=>void;
  enabled?:boolean;
}
class SettingsDraftOrigin {peer:string='';connection:number=-1;owner:number=0;}

@Extend(Button)
function softBtn() {
  .height(44)
  .borderRadius(14)
  .backgroundColor($r('app.color.input_bg'))
  .fontColor($r('app.color.text_primary'))
}


@Component
export struct FeaturePanel {
  @Link @Watch('deviceTabChanged') tab: string;
  @Prop wide: boolean = false;
  private readonly railTabs: string[] = ['模型','电脑任务','导航','待办','录音','智记','提词器','资料','通知','天气','卡片','设备'];
  @State status: string = '';
  @State link: string = '未连接';
  @State connected: boolean = false;
  @State settingsLoaded: boolean = false;
  @State statusLoaded: boolean = false;
  @State settingsPending: boolean = false;
  @State deviceReadRunning:boolean=false;
  @State busy: boolean = false;
  @State note: string = '';
  @State weatherNote: string = '';
  @State dashboardNote: string = '';
  @State displayNote: string = '';
  @State city: string = '北京';
  @State temp: string = '27';
  @State icon: string = '101';
  @State widgetText: string = 'Turbo IO 7392';
  @State question: string = '用一句话介绍你自己';
  @State answer: string = '';
  @State modelURL: string = 'https://api.deepseek.com';
  @State modelName: string = 'deepseek-flash';
  @State modelKey: string = '';
  @State tinyfishKey: string = '';
  @State tinyfishEnabled: boolean = false;
  @State deepseekSearch:boolean=true;
  @State tinyfishConfigured: boolean = false;
  @State asrHost: string = 'dashscope.aliyuncs.com';
  @State asrModel: string = 'qwen-audio-3.0-asr-flash-streaming';
  @State asrKey: string = '';
  @State voiceEnabled: boolean = false;
  @State voiceCleanup: boolean = false;
  @State voiceCanConfirmCleanup: boolean = false;
  @State voicePendingWrites: boolean = false;
  @State voiceNote: string = '未开启';
  @State voiceTranscript: string = '';
  @State voiceAnswer: string = '';
  @State voiceAudit: string = '';
  @State showServiceConfig: boolean = false;
  @State showVoiceDiagnostics: boolean = false;
  @State showDeviceDiagnostics: boolean = false;
  @State prompt: string = '';
  @State weatherHost: string = '';
  @State weatherKey: string = '';
  @State latitude: string = '39.92';
  @State longitude: string = '116.41';
  @State amapKey: string = '';
  @State configStatus: string = '尚未读取配置';
  @State autoWeather: boolean = true;
  // 设备设置当前值（从眼镜读回后刷新，见 refreshSettingsState）
  @State headupOn: boolean = true;
  @State headupDeg: number = 20;
  @State crownSw: number = 0;
  @State dispH: number = 1;
  @State dispD: number = 2;
  @State lockSec: number = 15;
  @State bright: number = 7;
  @State focusOn: boolean = false;
  @State focusGlass: boolean = true;
  @State micOn: boolean = true;
  @State ledLevel: number = 4;
  @State ledAuto: boolean = true;
  @State logOn: boolean = true;
  @State headOn: boolean = true;
  @State headMode: number = 0;
  @State crownDir: number = 1;
  @State crownDouble: number = 0;
  @State crownLong: number = 1;
  private editingSetting:string='';
  private deviceReadConnection:number=-1;
  private readonly deviceReader:DeviceSettingsPorts=deviceSettingsPorts(()=>undefined,()=>undefined,()=>{});
  private brightnessOrigin:SettingsDraftOrigin|undefined=undefined;
  private displayOrigin:SettingsDraftOrigin|undefined=undefined;
  private brightnessQueued:boolean=false;
  private displayQueued:boolean=false;
  private brightnessDrag:BrightnessDrag=new BrightnessDrag({
    send:(value:number):Promise<void>=>this.sendBrightnessDraft(value),
    change:():void=>{if(this.active)this.refresh();},
    fail:(reason:string):void=>{if(this.active){this.status=reason;this.refreshSettingsState();}}
  });
  private displayDrag:DisplayPositionDrag=new DisplayPositionDrag({
    send:(height:number,distance:number):Promise<void>=>this.sendDisplayDraft(height,distance),
    change:():void=>{if(this.active)this.refresh();},
    fail:(reason:string):void=>{if(this.active){this.status=reason;this.refreshSettingsState();}}
  });
  private config: ServiceConfig = new ServiceConfig();
  private vault: SecureServiceConfig = new SecureServiceConfig();
  private services: RemoteServices = new RemoteServices();
  private asrCheck: CloudASR = new CloudASR();
  private weatherAt: number = 0;
  private epoch: number = 0;
  private active: boolean = false;
  private pageTimer: number = -1;
  // 最近一次已应用到 @State 的读回版本号（见 DeviceFeatures.settingsRev/statusRev）。
  // 只有版本号变化才重解析——refresh() 不再用旧缓存回冲乐观更新。
  private settingsRevSeen: number = -1;
  private statusRevSeen: number = -1;

  aboutToAppear(): void {
    this.active = true;
    probeSession.features.changed = ():void => this.refresh(); this.refresh();
    probeSession.voice.changed = ():void => this.refreshVoice(); this.refreshVoice();
    this.vault.load().then((config:ServiceConfig)=>{
      if (!this.active) return; this.config = config; this.modelURL = config.modelURL; this.modelName = config.model;
      this.prompt = config.systemPrompt; this.weatherHost = config.weatherHost; this.city = config.weatherCity;
      this.latitude = config.weatherLatitude; this.longitude = config.weatherLongitude;
      this.asrHost=config.asrHost||this.asrHost;this.asrModel=config.asrModel||this.asrModel;
      this.autoWeather=config.automaticWeather!==false;
      this.tinyfishEnabled=config.tinyfishEnabled===true;this.tinyfishConfigured=!!config.tinyfishKey;
      this.deepseekSearch=config.deepseekSearchEnabled!==false;
      this.configStatus = `ASR ${config.asrKey ? '已配置':'未配置'} · 模型 ${config.modelKey ? '已配置':'未配置'} · 和风 ${config.weatherKey ? '已配置':'未配置'} · 高德 ${config.amapKey ? '已配置':'未配置'}`;
    }).catch(()=>{if(this.active)this.configStatus='暂无可读安全配置，请填写并保存';});
  }
  aboutToDisappear(): void {
    this.cancelSettingsDrafts();this.editingSetting='';
    this.active = false; this.epoch++; this.services.cancel();
    this.asrCheck.close();
    if (this.pageTimer !== -1) clearTimeout(this.pageTimer); this.pageTimer = -1;
    probeSession.features.changed = ():void=>{};
    probeSession.voice.changed = ():void=>{};
  }
  private refreshVoice():void {
    const v=probeSession.voice.state;this.voiceEnabled=v.enabled;
    this.voiceCleanup=probeSession.voice.cleanupRequired&&['cleanup','closing','error'].includes(v.phase);this.voiceCanConfirmCleanup=probeSession.voice.canConfirmExited;this.voicePendingWrites=probeSession.voice.pendingWrites;
    this.voiceNote=`${v.phase} · ${v.note} · 音频 ${v.packets} 包 / PCM ${v.pcmBytes} B`;
    this.voiceTranscript=v.transcript;this.voiceAnswer=v.answer;
    this.voiceAudit=`模型请求 ${v.modelRequests} / 返回 ${v.modelReplies} / 完成 ${v.completedRounds}\n${v.lastResult}`;
    if(probeSession.voice.active||probeSession.voice.pendingWrites){this.cancelSettingsDrafts();this.refresh();}
    this.requestDeviceSettings();
  }
  private confirmVoiceExit():void{
    const sid=probeSession.voice.cleanupSessionId;
    this.getUIContext().showAlertDialog({title:'确认助手已退出',message:'只有实际看到原眼镜回到时间主界面、没有助手窗口或收音提示时才确认。这是人工确认，不是设备回执。',primaryButton:{value:'尚未退出',action:():void=>{}},secondaryButton:{value:'已回时间页',action:():void=>{
      if(!this.active)return;
      try{probeSession.voice.confirmExited(sid);}catch(error){this.status=(error as Error).message;}
      this.refreshVoice();
    }}});
  }
  private deviceTabChanged():void{
    if(this.tab==='设备'){this.deviceReadConnection=-1;this.requestDeviceSettings();}
    else{this.cancelSettingsDrafts();this.editingSetting='';if(this.active){this.refreshSettingsState();this.refresh();}}
  }
  private syncSettingsDrafts():void{probeSession.features.localSettingsPending=this.brightnessQueued||this.displayQueued;}
  private cancelSettingsDrafts():void{
    this.brightnessDrag.cancel();this.displayDrag.cancel();this.brightnessQueued=false;this.displayQueued=false;
    this.brightnessOrigin=undefined;this.displayOrigin=undefined;this.syncSettingsDrafts();
  }
  private newSettingsDraftOrigin():SettingsDraftOrigin{
    const origin=new SettingsDraftOrigin();origin.peer=probeSession.peerDeviceId;
    origin.connection=probeSession.features.state.connectionRev;origin.owner=probeSession.features.nextSettingsWriteOwner();return origin;
  }
  private settingsDraftReady(origin:SettingsDraftOrigin|undefined):boolean{
    const f=probeSession.features;
    return !!origin&&this.active&&this.tab==='设备'&&probeSession.foreground&&f.state.connected&&!!origin.peer&&
      origin.peer===probeSession.peerDeviceId&&origin.connection===f.state.connectionRev&&f.canSettingsWrite()&&
      (!f.wireBusy||f.settingsWriteOwnedBy(origin.owner));
  }
  private queueBrightnessDraft(value:number,commit:boolean):void{
    if(!this.brightnessDrag.pending)this.brightnessOrigin=this.newSettingsDraftOrigin();
    if(!this.settingsDraftReady(this.brightnessOrigin)){this.cancelSettingsDrafts();this.refreshSettingsState();this.refresh();return;}
    this.brightnessQueued=true;this.syncSettingsDrafts();this.brightnessDrag.update(value,commit);
  }
  private queueDisplayDraft(height:number,distance:number,commit:boolean):void{
    if(!this.displayDrag.pending)this.displayOrigin=this.newSettingsDraftOrigin();
    if(!this.settingsDraftReady(this.displayOrigin)){this.cancelSettingsDrafts();this.refreshSettingsState();this.refresh();return;}
    this.displayQueued=true;this.syncSettingsDrafts();this.displayDrag.update(height,distance,commit);
  }
  private async sendBrightnessDraft(value:number):Promise<void>{
    const origin=this.brightnessOrigin;
    if(!this.settingsDraftReady(origin)){this.brightnessQueued=false;this.syncSettingsDrafts();throw new Error('设置草稿已失效，请重新调整');}
    const pending=probeSession.features.brightness(value,origin!.owner);
    this.brightnessQueued=false;this.syncSettingsDrafts();await pending;
  }
  private async sendDisplayDraft(height:number,distance:number):Promise<void>{
    const origin=this.displayOrigin;
    if(!this.settingsDraftReady(origin)){this.displayQueued=false;this.syncSettingsDrafts();throw new Error('设置草稿已失效，请重新调整');}
    const pending=probeSession.features.writeDisplay(height,distance,origin!.owner);
    this.displayQueued=false;this.syncSettingsDrafts();await pending;
  }
  private requestDeviceSettings():void{
    if(!this.active||this.tab!=='设备'||!this.connected||this.busy||this.deviceReadRunning||
      (this.settingsLoaded&&this.statusLoaded)||!this.deviceReader.safe())return;
    const connection=probeSession.features.state.connectionRev;
    if(this.deviceReadConnection===connection)return;
    this.deviceReadConnection=connection;this.deviceReadRunning=true;
    const epoch=this.epoch;this.status='正在读取眼镜当前设置…';
    // Read both fresh snapshots; never unlock defaults or replay a setting.
    // One attempt per connection/entry prevents a failed read from looping.
    this.deviceReader.read().then(()=>{
      if(this.active&&epoch===this.epoch&&this.tab==='设备')this.status='';
    }).catch(()=>{
      if(this.active&&epoch===this.epoch&&this.tab==='设备')this.status='当前设置未完整读回，可使用上方读取按钮重试。';
    }).finally(()=>{this.deviceReadRunning=false;if(this.active)this.refresh();});
  }
  private async enableVoice(test:boolean):Promise<void> {
    if(probeSession.recordingOccupied())throw new Error('请先结束录音并等待归档');
    if(probeSession.prompterOccupied())throw new Error('请先退出提词器');
    await this.saveConfig();
    this.config.automaticVoice=true;await this.vault.save(this.config);connectedServices.invalidate();
    if(probeSession.features.displayActive)await probeSession.features.stopDisplay();
    probeSession.voice.enable(this.config,test);
    try{await probeSession.features.voiceWakeup();}
    catch(_){probeSession.voice.disable('唤醒初始化未提交');throw new Error('唤醒初始化未提交');}
    this.refreshVoice();
  }
  private async checkASR():Promise<void> {
    await this.saveConfig();const epoch=this.epoch;
    const random=cryptoFramework.createRandom().generateRandomSync(16).data;
    const task=Array.from(random).map((b:number)=>b.toString(16).padStart(2,'0')).join('');random.fill(0);
    await new Promise<void>((resolve:()=>void,reject:(error:Error)=>void)=>{
      this.asrCheck.onStatus=(status:string):void=>{if(this.active&&epoch===this.epoch)this.configStatus=status;};
      this.asrCheck.onReady=():void=>{this.asrCheck.close();if(this.active&&epoch===this.epoch)this.configStatus='ASR 创建任务成功 · 没有收音 / 上传音频';resolve();};
      this.asrCheck.onError=(reason:string):void=>{reject(new Error(reason));};
      this.asrCheck.start(this.config,task);
    });
  }
  private refresh(): void {
    const state = probeSession.features.state;
    const wasSettingsPending = this.settingsPending;
    this.connected = state.connected; this.link = `${state.connected ? '眼镜已连接':'眼镜未连接'} · 电量 ${state.battery < 0 ? '待回报':`${state.battery}%`}`;
    if(!this.connected||!probeSession.foreground||!probeSession.features.canSettingsWrite())this.cancelSettingsDrafts();
    this.brightnessDrag.reconcile(!probeSession.features.wireBusy);
    this.displayDrag.reconcile(!probeSession.features.wireBusy);
    if(!this.brightnessDrag.pending){this.brightnessOrigin=undefined;this.brightnessQueued=false;}
    if(!this.displayDrag.pending){this.displayOrigin=undefined;this.displayQueued=false;}
    this.syncSettingsDrafts();
    this.settingsLoaded = this.connected && state.settingsJson.length > 0;
    this.statusLoaded = this.connected && state.statusJson.length > 0;
    this.settingsPending = probeSession.features.launcherBusy||this.deviceReadRunning;
    this.note = state.note; this.weatherNote = state.weather; this.dashboardNote = state.dashboard; this.displayNote = state.display;
    if (this.active && this.tab === '设备' && wasSettingsPending && !this.settingsPending && this.note) {
      this.getUIContext().getPromptAction().showToast({ message: this.note, duration: 3000 });
    }
    // 只在收到新读回（内容版本号变化）时重解析设置值；否则保留用户的乐观更新，等真回执来打。
    if (state.settingsRev !== this.settingsRevSeen || state.statusRev !== this.statusRevSeen) this.refreshSettingsState();
    this.requestDeviceSettings();
  }
  private run(action:()=>Promise<void>): void {
    if(this.busy)return; this.busy=true;this.status='处理中…'; const epoch=this.epoch;
    action().then(()=>{if(this.active&&epoch===this.epoch)this.status=this.tab==='设备'?'':'操作已完成';})
      .catch((error:Error)=>{if(this.active&&epoch===this.epoch){this.status=error.message?.slice(0,150)||'操作未完成';this.getUIContext().getPromptAction().showToast({message:this.status,duration:3000});}})
      .finally(()=>{if(this.active&&epoch===this.epoch){this.busy=false;this.refresh();}});
  }
  private async saveConfig(): Promise<void> {
    const c = new ServiceConfig();
    if(probeSession.voice.active)throw new Error('请先结束当前对话再保存配置；待命状态可以直接保存');
    const latest=await this.vault.load();
    c.automaticVoice=latest.automaticVoice!==false;c.automaticWeather=latest.automaticWeather!==false;
    c.modelURL=this.modelURL.trim();c.model=this.modelName.trim();c.systemPrompt=this.prompt || c.systemPrompt;
    c.modelKey=this.modelKey.trim()||latest.modelKey;c.weatherHost=this.weatherHost.trim();c.weatherKey=this.weatherKey.trim()||latest.weatherKey;
    c.weatherCity=this.city;c.weatherLatitude=this.latitude;c.weatherLongitude=this.longitude;c.amapKey=this.amapKey.trim()||latest.amapKey;
    c.amapHarmonyKey=latest.amapHarmonyKey||'';c.amapConsent=latest.amapConsent===true;
    c.asrHost=this.asrHost.trim();c.asrModel=this.asrModel.trim();c.asrKey=this.asrKey.trim()||latest.asrKey;
    c.tinyfishEnabled=this.tinyfishEnabled;c.tinyfishKey=this.tinyfishKey.trim()||latest.tinyfishKey||'';
    c.deepseekSearchEnabled=this.deepseekSearch;
    if(c.tinyfishEnabled&&!c.tinyfishKey)throw new Error('请先填写 TinyFish Key');
    await this.vault.save(c);this.config=c;this.modelKey='';this.weatherKey='';this.amapKey='';this.asrKey='';this.services.clearHistory();
    this.tinyfishKey='';this.tinyfishConfigured=!!c.tinyfishKey;
    if(probeSession.voice.state.enabled)probeSession.voice.disable('配置已保存，正在恢复自动待命');
    connectedServices.invalidate();
    this.configStatus='已保存在本机安全存储；密钥不会显示在日志或源码';
  }
  private async fetchWeather(): Promise<void> {
    this.config=await this.vault.load();
    const weather=await this.services.weather(this.config);
    this.temp=String(weather.temp);this.icon=String(weather.icon);this.weatherNote=`和风天气：${weather.description}`;
    await probeSession.features.weather(this.config.weatherCity,weather.temp,weather.icon);
  }
  private async chat(): Promise<void> {
    const epoch=this.epoch;
    const result=await this.services.chat(this.config,this.question);
    if(!this.active||epoch!==this.epoch)return;
    this.answer=result;
  }
  @Builder
  private title(text:string) { Text(text).fontSize(20).fontWeight(FontWeight.Bold).fontColor($r('app.color.text_primary')).width('100%') }
  @Builder
  private input(label:string,value:string,change:(value:string)=>void,secret:boolean=false) {
    Text(label).fontSize(12).fontColor($r('app.color.text_muted')).width('100%')
    TextInput({text:value,placeholder:secret?'留空保留已保存 Key':label}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).type(secret?InputType.Password:InputType.Normal)
      .maxLength(secret?512:500).onChange(change).fontColor($r('app.color.text_primary')).backgroundColor($r('app.color.input_bg')).height(46).borderRadius(12)
  }
  @Builder
  private sw(label:string,value:boolean,hint:string,flip:(v:boolean)=>void) {
    Row() {
      Column({space:2}) {
        Text(label).fontSize(14).fontColor($r('app.color.text_primary'))
        if (hint) { Text(hint).fontSize(11).fontColor($r('app.color.text_muted')) }
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      Toggle({type:ToggleType.Switch,isOn:value}).selectedColor($r('app.color.brand'))
        .enabled(this.connected&&!this.busy&&!this.settingsPending&&this.settingsLoaded&&this.statusLoaded).onChange((v:boolean)=>flip(v))
    }.width('100%')
  }
  @Builder
  private seg(p:SettingSegments) {
    Column({space:10}) {
      Text(p.label).fontSize(13).fontColor($r('app.color.text_primary'))
      Flex({ direction: FlexDirection.Row, wrap: FlexWrap.Wrap }) {
      ForEach(p.options,(o:string,i:number)=>{
        Button(o).fontSize(13).height(40).padding({left:14,right:14}).margin({right:8,bottom:8})
          .backgroundColor(p.values[i]===p.current?$r('app.color.brand'):$r('app.color.input_bg'))
          .fontColor(p.values[i]===p.current?$r('app.color.on_brand'):$r('app.color.text_primary'))
          .accessibilityText(p.label+'：'+o+(p.values[i]===p.current?'，已选择':''))
          .enabled(p.enabled===undefined?this.connected&&!this.busy&&!this.settingsPending&&this.settingsLoaded&&this.statusLoaded:p.enabled)
          .onClick(()=>p.pick(p.values[i]))
      },(o:string):string=>o)
      }.width('100%')
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  private subObj(o:Object|undefined,key:string):Record<string,Object> {
    if(!o)return JSON.parse('{}');
    const v=(o as Record<string,Object>)[key];
    return (typeof v==='object'&&v!==null?v:JSON.parse('{}')) as Record<string,Object>;
  }
  private numOf(o:Record<string,Object>,key:string,def:number):number { const v=o[key];return typeof v==='number'?v:def; }
  private displayControlsEnabled():boolean {
    return this.connected&&!this.busy&&this.settingsLoaded&&this.statusLoaded&&!this.deviceReadRunning&&!this.brightnessDrag.pending&&
      (!this.settingsPending||this.displayDrag.pending&&(!probeSession.features.wireBusy||!!this.displayOrigin&&probeSession.features.settingsWriteOwnedBy(this.displayOrigin.owner)));
  }
  private refreshSettingsState(): void {
    const f = probeSession.features.state;
    try {
      const root = JSON.parse(f.settingsJson) as Record<string,Object>;
      const s = this.subObj(root,'generalSettings');
      const wk = this.subObj(s,'wakeupConfig');
      this.headupOn = this.numOf(wk,'headupSwitch',1)===1;
      if(this.editingSetting!=='degree')this.headupDeg = this.numOf(wk,'headupDegree',20);
      this.crownSw = this.numOf(wk,'crownSwitch',0);
      const dc = this.subObj(s,'displayConfig');
      this.dispH = this.displayDrag.pending?this.displayDrag.height:this.numOf(dc,'height',1);
      this.dispD = this.displayDrag.pending?this.displayDrag.distance:this.numOf(dc,'distance',2);
      this.lockSec = this.numOf(s,'autoLockTime',15);
      const hg = this.subObj(s,'headGestures');
      this.headOn = this.numOf(hg,'enabled',1)===1; this.headMode = this.numOf(hg,'mode',0);
      const cc = this.subObj(s,'crownConfig');
      this.crownDir = this.numOf(cc,'direction',1); this.crownDouble = this.numOf(cc,'double',0); this.crownLong = this.numOf(cc,'longPress',1);
      const pv = this.subObj(s,'privacyConfig');
      this.micOn = this.numOf(pv,'mic_switch',1)===1; this.ledLevel = this.numOf(pv,'led_light',4);
      this.ledAuto = this.numOf(pv,'led_auto_light',1)===1; this.logOn = this.numOf(pv,'log_switch',1)===1;
    } catch (_) {}
    try {
      const st = this.subObj(JSON.parse(f.statusJson) as Record<string,Object>,'generalStatus');
      this.bright = this.brightnessDrag.pending?this.brightnessDrag.target:this.numOf(st,'brightness',7);
      const fm = this.subObj(st,'focusMode');
      this.focusOn = this.numOf(fm,'enable',0)===1; this.focusGlass = this.numOf(fm,'enableGlassClose',1)===1;
    } catch (_) {}
    this.settingsRevSeen = f.settingsRev; this.statusRevSeen = f.statusRev;
  }
  @Builder
  contentCard() {
    Column({space:16}) {
      Text(this.link).fontSize(16).fontColor(this.connected?$r('app.color.brand'):$r('app.color.warm')).width('100%')
      if (this.status) { Text(this.status).fontSize(12).fontColor($r('app.color.warm')).width('100%') }
      if(this.tab==='设备') {
        this.title('电量与设备设置')
        Row({space:12}) {
          Button('刷新真实状态').softBtn().layoutWeight(1).enabled(this.connected&&!this.busy&&!this.settingsPending).onClick(()=>this.run(()=>probeSession.features.refreshStatus()))
          Button('读取通用设置').softBtn().layoutWeight(1).enabled(this.connected&&!this.busy&&!this.settingsPending).onClick(()=>this.run(()=>probeSession.features.refreshSettings()))
        }
        Text(this.note || '修改后会读取眼镜实际值，确认结果会在此显示并弹出提醒。').fontSize(13).fontColor($r('app.color.text_secondary')).lineHeight(20).width('100%')
        if (!this.settingsLoaded || !this.statusLoaded) {
          Text(this.deviceReadRunning?'正在读取当前状态与设置，完成后即可调整。':'连接后会自动读取设备设置；读取未完成时可使用上方按钮重试。').fontSize(13).fontColor($r('app.color.warm')).lineHeight(20)
        }

        this.title('旋钮操作')
        Text('单击：点亮屏幕、确认或打开当前选项。左右旋转：浏览或滚动，由眼镜当前页面处理。双击可快捷启动 AI 或智记；长按快捷键仅在息屏时生效，亮屏时用于返回看板。').fontSize(12).fontColor($r('app.color.text_secondary')).lineHeight(20)
        this.seg({label:'旋转方向',options:['标准','自然'],values:[0,1],current:this.crownDir,pick:(v:number)=>{this.crownDir=v;this.run(()=>probeSession.features.writeCrown(v,this.crownDouble,this.crownLong));}})
        this.seg({label:'双击快捷功能',options:['AI 对话','看板','专注','录音','实时字幕','提词器','全天智记','待办','实时提示','无'],values:[0,1,2,3,4,5,6,8,9,7],current:this.crownDouble,pick:(v:number)=>{this.crownDouble=v;this.run(()=>probeSession.features.writeCrown(this.crownDir,v,this.crownLong));}})
        this.seg({label:'长按快捷功能（息屏）',options:['AI 对话','看板','专注','录音','实时字幕','提词器','待办','实时提示','无'],values:[0,1,2,3,4,5,8,9,7],current:this.crownLong,pick:(v:number)=>{this.crownLong=v;this.run(()=>probeSession.features.writeCrown(this.crownDir,this.crownDouble,v));}})
        Button('双击恢复 AI 对话').softBtn().width('100%').enabled(this.connected&&!this.busy&&!this.settingsPending&&this.settingsLoaded&&this.statusLoaded)
          .onClick(()=>this.run(()=>probeSession.features.restoreDoubleClickAI()))
        Text('快捷功能由固件提供；实时字幕、实时提示等尚未接入本 App 的手机服务。单击和左右旋转没有独立改键接口。').fontSize(11).fontColor($r('app.color.text_muted'))

        this.sw('抬头唤醒', this.headupOn, '', (v:boolean)=>{this.headupOn=v;this.run(()=>probeSession.features.writeWakeup(v,this.headupDeg,this.crownSw));})
        Text(`抬头唤醒角度 ${this.headupDeg}°`).fontSize(13).fontColor($r('app.color.text_primary'))
        Slider({value:this.headupDeg,min:0,max:70,step:1}).selectedColor($r('app.color.brand'))
          .enabled(this.connected&&!this.busy&&!this.settingsPending&&this.settingsLoaded&&this.statusLoaded)
          .onChange((v:number,mode:SliderChangeMode):void=>{
            this.headupDeg=Math.round(v);this.editingSetting='degree';
            if(mode===SliderChangeMode.End||mode===SliderChangeMode.Click){this.editingSetting='';this.run(()=>probeSession.features.writeWakeup(this.headupOn,this.headupDeg,this.crownSw));}
          })
        this.seg({label:'息屏互动',options:['关闭','开启'],values:[0,3],current:this.crownSw,pick:(v:number)=>{this.crownSw=v;this.run(()=>probeSession.features.writeWakeup(this.headupOn,this.headupDeg,v));}})
        if(![0,3].includes(this.crownSw)){Text(`设备当前互动值 ${this.crownSw}，调角度时保留`).fontSize(11).fontColor($r('app.color.text_muted'))}
        Text(`显示高度 ${this.dispH}/6`).fontSize(13).fontColor($r('app.color.text_primary'))
        Slider({value:this.dispH,min:1,max:6,step:1}).selectedColor($r('app.color.brand'))
          .enabled(this.displayControlsEnabled())
          .onChange((v:number,mode:SliderChangeMode):void=>{
            this.dispH=Math.round(v);
            if(mode!==SliderChangeMode.Begin){this.queueDisplayDraft(this.dispH,this.dispD,mode===SliderChangeMode.End||mode===SliderChangeMode.Click);}
          })
        this.seg({label:'显示距离',options:['近','中','远'],values:[1,2,3],current:this.dispD,enabled:this.displayControlsEnabled(),pick:(v:number)=>{this.dispD=v;this.queueDisplayDraft(this.dispH,v,true);}})
        Text(`当前位置：高度 ${this.dispH}/6 · ${['近','中','远'][this.dispD-1]}${this.settingsPending&&this.displayDrag.pending?' · 正在确认':''}`).fontSize(12).fontColor($r('app.color.text_secondary'))
        this.seg({label:'自动息屏',options:['5秒','10秒','15秒','25秒','40秒','60秒','120秒'],values:[5,10,15,25,40,60,120],current:this.lockSec,pick:(v:number)=>{this.lockSec=v;this.run(()=>probeSession.features.sleepTime(v));}})
        Text(`亮度 ${Math.round((this.bright-1)*100/16)}% · ${this.bright}/17`).fontSize(13).fontColor($r('app.color.text_primary'))
        Slider({value:this.bright,min:1,max:17,step:1}).selectedColor($r('app.color.brand'))
          .enabled(this.connected&&this.statusLoaded&&!this.busy&&(!this.settingsPending||this.brightnessDrag.pending&&(!probeSession.features.wireBusy||!!this.brightnessOrigin&&probeSession.features.settingsWriteOwnedBy(this.brightnessOrigin.owner))))
          .onChange((v:number,mode:SliderChangeMode):void=>{
            this.bright=Math.round(v);
            if(mode!==SliderChangeMode.Begin){this.queueBrightnessDraft(this.bright,mode===SliderChangeMode.End||mode===SliderChangeMode.Click);}
          })
        this.sw('专注模式（勿扰）', this.focusOn, '保留眼镜当前时间与星期策略', (v:boolean)=>{this.focusOn=v;this.run(()=>probeSession.features.writeFocus(v,this.focusGlass));})
        this.sw('眼镜端可退出专注', this.focusGlass, '', (v:boolean)=>{this.focusGlass=v;this.run(()=>probeSession.features.writeFocus(this.focusOn,v));})
        this.sw('麦克风', this.micOn, '关闭后眼镜录音与语音助手不可用', (v:boolean)=>{this.micOn=v;this.run(()=>probeSession.features.writePrivacy(v,this.ledLevel,this.ledAuto,this.logOn));})
        this.seg({label:'指示灯亮度',options:['1','2','3','4','5','6'],values:[1,2,3,4,5,6],current:this.ledLevel,pick:(v:number)=>{this.ledLevel=v;this.run(()=>probeSession.features.writePrivacy(this.micOn,v,this.ledAuto,this.logOn));}})
        this.sw('指示灯自动亮度', this.ledAuto, '', (v:boolean)=>{this.ledAuto=v;this.run(()=>probeSession.features.writePrivacy(this.micOn,this.ledLevel,v,this.logOn));})
        this.sw('头部控制', this.headOn, '', (v:boolean)=>{this.headOn=v;this.run(()=>probeSession.features.writeHeadGestures(v,this.headMode));})
        this.seg({label:'头部方向模式',options:['模式 0','模式 1'],values:[0,1],current:this.headMode,pick:(v:number)=>{this.headMode=v;this.run(()=>probeSession.features.writeHeadGestures(this.headOn,v));}})
        Text('配置完整后连接自动语音待命，唤醒才收音；录音和导航无需手动关闭待命。后台蓝牙保持在设置页开启。').fontSize(12).fontColor($r('app.color.text_muted'))
        Button(this.showDeviceDiagnostics ? '收起高级调试' : '高级调试').softBtn().width('100%').onClick((): void => { this.showDeviceDiagnostics = !this.showDeviceDiagnostics; })
        if (this.showDeviceDiagnostics) {
          Text('当前时区校时已验证。高级格式探测会临时改变时钟，完成后尝试恢复。').fontSize(12).fontColor($r('app.color.text_muted')).lineHeight(20)
          Button('同步本机时间').softBtn().width('100%').enabled(this.connected&&!this.busy).onClick(()=>this.run(()=>probeSession.features.syncTime(0)))
          Button('探测时间格式').softBtn().width('100%').enabled(this.connected&&!this.busy).onClick(()=>this.run(()=>probeSession.features.probeTimeFormats()))
        }
      } else if(this.tab==='天气') {
        this.title('首页天气 · 和风实时数据')
        this.input('地点名称',this.city,(v:string)=>{this.city=v;})
        this.input('和风 API Host',this.weatherHost,(v:string)=>{this.weatherHost=v;})
        this.input('和风 API Key',this.weatherKey,(v:string)=>{this.weatherKey=v;},true)
        this.input('纬度，两位小数',this.latitude,(v:string)=>{this.latitude=v;})
        this.input('经度，两位小数',this.longitude,(v:string)=>{this.longitude=v;})
        Button('保存天气配置').softBtn().width('100%').enabled(!this.busy).onClick(()=>this.run(()=>this.saveConfig()))
        Button('拉取实时天气 → 眼镜首页').softBtn().width('100%').enabled(this.connected&&!this.busy).onClick(()=>this.run(()=>this.fetchWeather()))
        Toggle({type:ToggleType.Switch,isOn:this.autoWeather}).selectedColor($r('app.color.brand')).onChange((v:boolean)=>{
          this.autoWeather=v;this.run(async()=>{const c=await this.vault.load();c.automaticWeather=v;await this.vault.save(c);this.config=c;connectedServices.invalidate();});
        })
        Text('默认连接后自动同步：首页天气每 15 分钟更新，不依赖停留在此页；当前自动拉取在手机前台执行。').fontSize(12).fontColor($r('app.color.text_muted'))
        this.input('测试温度（非实时天气）',this.temp,(v:string)=>{this.temp=v;})
        this.input('天气图标编号（候选，镜片需确认）',this.icon,(v:string)=>{this.icon=v;})
        Button('发送测试温度').softBtn().width('100%').enabled(this.connected&&!this.busy).onClick(()=>this.run(()=>probeSession.features.weather(this.city,Number(this.temp),Number(this.icon))))
        Text(this.weatherNote).fontSize(13).fontColor($r('app.color.text_secondary'))
      } else if(this.tab==='卡片') {
        this.title('自定义仪表盘 · 单卡')
        Text('只添加或删除自己的文字卡，不覆盖现有天气和待办。先读取基线；当前单帧适合短文字，复杂布局仍需分包适配。').fontSize(13).fontColor($r('app.color.text_secondary'))
        this.input('卡片短文字',this.widgetText,(v:string)=>{this.widgetText=v;})
        Button('1 · 读取仪表盘基线').softBtn().width('100%').enabled(this.connected&&!this.busy).onClick(()=>this.run(()=>probeSession.features.dashboardRead()))
        Button('2 · 安装 / 更新文字卡').softBtn().width('100%').enabled(this.connected&&!this.busy).onClick(()=>this.run(()=>probeSession.features.widget(this.widgetText)))
        Button('3 · 删除本次测试卡').softBtn().width('100%').enabled(this.connected&&!this.busy).onClick(()=>this.run(()=>probeSession.features.removeWidget()))
        Text(this.dashboardNote).fontSize(13).fontColor($r('app.color.text_secondary'))
        Text(this.note).fontSize(13).fontColor($r('app.color.text_secondary'))
      } else if(this.tab==='模型') {
        this.title('语音与自定义模型')
        Text('支持 DeepSeek Flash。双击唤起 AI 时会临时让智记待命，对话结束自动恢复。').fontSize(12).fontColor($r('app.color.text_secondary'))
        Button('设置旋钮快捷键').softBtn().width('100%').onClick(():void=>{this.tab='设备';})
        Text(this.modelName + ' · 阿里流式 ASR').fontSize(15).fontColor($r('app.color.brand'))
        Column({space:12}) {
          Text('我说').fontSize(12).fontColor($r('app.color.text_muted')).width('100%')
          Text(this.voiceTranscript || '唤醒眼镜后，识别文字会显示在这里').fontSize(16).fontColor($r('app.color.text_primary')).width('100%')
          Text('AI 回答').fontSize(12).fontColor($r('app.color.brand')).width('100%')
          Text(this.voiceAnswer || '等待你的问题').fontSize(16).fontColor($r('app.color.text_primary')).width('100%')
        }.padding(18).width('100%').backgroundColor($r('app.color.card_raise')).borderRadius(18)
        Text('回答完整显示后 10 秒退出').fontSize(12).fontColor($r('app.color.text_muted'))
        Button(this.voiceEnabled ? '语音已开启 · 等待眼镜唤醒' : '开启语音对话')
          .width('100%').height(52).backgroundColor($r('app.color.brand')).fontColor($r('app.color.on_brand'))
          .enabled(this.connected&&!this.busy&&!this.voiceEnabled&&!this.voiceCleanup&&!this.voicePendingWrites).onClick(()=>this.run(()=>this.enableVoice(false)))
        if(this.voiceCleanup){
          Button('清理上次助手退出').softBtn().width('100%').enabled(this.connected&&!this.busy&&!this.voicePendingWrites).onClick(()=>this.run(async()=>{
            if(!await probeSession.voice.stopAndWait())throw new Error('助手退出尚未确认，原记录保留；请核对原眼镜');
          }))
          if(this.voiceCanConfirmCleanup){Button('我已确认助手退出').softBtn().width('100%').enabled(!this.busy&&!this.voicePendingWrites).onClick(()=>this.confirmVoiceExit())}
        }
        if(this.voiceEnabled) {
          Button('关闭自动语音待命').softBtn().width('100%').onClick(()=>this.run(async()=>{
            const c=await this.vault.load();c.automaticVoice=false;await this.vault.save(c);connectedServices.invalidate();probeSession.voice.disable();this.refreshVoice();
          }))
        }
        Text(this.voiceNote).fontSize(12).fontColor($r('app.color.brand'))
        Button(this.showServiceConfig ? '收起服务配置' : '服务配置  ›').softBtn().width('100%')
          .onClick(()=>{this.showServiceConfig=!this.showServiceConfig;})
        if(this.showServiceConfig) {
        Text('唤醒后收音并发送到阿里 ASR，文字交给自有模型，不保存对话音频。再次唤醒可打断；眼镜发起后续收音时，识别到新话语才中断旧回答。没有新话语时回答结束 10 秒退出。TTS 与长时间锁屏待验。').fontSize(13).fontColor($r('app.color.text_secondary'))
        this.input('阿里 ASR Host',this.asrHost,(v:string)=>{this.asrHost=v;})
        this.input('ASR 模型名称',this.asrModel,(v:string)=>{this.asrModel=v;})
        this.input('ASR API Key',this.asrKey,(v:string)=>{this.asrKey=v;},true)
        Button('保存 ASR 配置').softBtn().width('100%').enabled(!this.busy&&!probeSession.voice.active).onClick(()=>this.run(()=>this.saveConfig()))
        Button('检查 ASR 连接（不收音）').softBtn().width('100%').enabled(!this.busy&&!probeSession.voice.active).onClick(()=>this.run(()=>this.checkASR()))
        Text(this.configStatus).fontSize(12).fontColor($r('app.color.text_muted'))
        this.input('OpenAI 兼容 API Base URL',this.modelURL,(v:string)=>{this.modelURL=v;})
        this.input('模型名称',this.modelName,(v:string)=>{this.modelName=v;})
        this.input('模型 API Key',this.modelKey,(v:string)=>{this.modelKey=v;},true)
        this.input('可编辑系统提示词',this.prompt,(v:string)=>{this.prompt=v;})
        Button('保存模型配置').softBtn().width('100%').enabled(!this.busy).onClick(()=>this.run(()=>this.saveConfig()))
        Text(this.configStatus).fontSize(12).fontColor($r('app.color.text_muted'))
        this.title('联网搜索')
        Row(){Text('DeepSeek 原生联网搜索').fontSize(14).fontColor($r('app.color.text_primary'));Blank();Toggle({type:ToggleType.Switch,isOn:this.deepseekSearch}).selectedColor($r('app.color.brand')).onChange((v:boolean):void=>{this.deepseekSearch=v;})}.width('100%')
        Text('与 Flash 对话共用 DeepSeek Key，无需另配搜索 Key。模型按需搜索，每轮最多两次，回答保留来源；使用官方模型地址时生效，搜索会产生额外模型用量。修改后点击「保存搜索设置」。').fontSize(12).fontColor($r('app.color.text_secondary')).lineHeight(20)
        Text('备用搜索服务 · TinyFish').fontSize(13).fontColor($r('app.color.text_muted'))
        Text(this.tinyfishEnabled&&this.tinyfishConfigured?'web_search · TinyFish 已配置并启用':'web_search · 尚未启用或缺 Key').fontSize(13).fontColor($r('app.color.text_muted'))
        Toggle({type:ToggleType.Switch,isOn:this.tinyfishEnabled}).selectedColor($r('app.color.brand')).onChange((v:boolean)=>{this.tinyfishEnabled=v;})
        this.input('TinyFish API Key',this.tinyfishKey,(v:string)=>{this.tinyfishKey=v;},true)
        Text('只搜索公开资料，每轮最多两次。必要检索词发送给 TinyFish，来源摘要回传当前模型；不接管浏览器，不读取其他应用。开关修改需保存。').fontSize(12).fontColor($r('app.color.text_muted'))
        Button('保存搜索设置').softBtn().width('100%').enabled(!this.busy).onClick(()=>this.run(()=>this.saveConfig()))
        Button('测试联网搜索').softBtn().width('100%').enabled(!this.busy).onClick(()=>this.run(async()=>{
          await this.saveConfig();const result=await this.services.search(this.config,'TinyFish Search API 官方文档');
          this.configStatus=`TinyFish 返回 ${result.results.length} 条来源`;this.answer=result.results.map(row=>`${row.title}\n${row.url}`).join('\n');
        }))
        }
        Button(this.showVoiceDiagnostics ? '收起诊断信息' : '诊断与文字测试  ›').softBtn().width('100%')
          .onClick(()=>{this.showVoiceDiagnostics=!this.showVoiceDiagnostics;})
        if(this.showVoiceDiagnostics) {
        Text(this.voiceAudit).fontSize(12).fontColor($r('app.color.text_muted'))
        Button('测试 ASR → 校验文字').softBtn().width('100%').enabled(this.connected&&!this.busy&&!this.voiceEnabled).onClick(()=>this.run(()=>this.enableVoice(true)))
        this.input('文字测试问题',this.question,(v:string)=>{this.question=v;})
        Button('请求当前模型').softBtn().width('100%').enabled(!this.busy).onClick(()=>this.run(()=>this.chat()))
        Text(this.answer).fontSize(15).fontColor($r('app.color.text_primary')).copyOption(CopyOptions.InApp)
        Button('将回答前 96 字显示到眼镜').softBtn().width('100%').enabled(this.connected&&!this.busy&&this.answer.length>0)
          .onClick(()=>this.run(async()=>{if(probeSession.prompterOccupied()||probeSession.recordingOccupied()||probeSession.voice.state.enabled)throw new Error('请先结束提词、录音或语音任务');await probeSession.features.show(this.answer.slice(0,96));}))
        Button('退出眼镜文字显示').softBtn().width('100%').enabled(this.connected&&!this.busy).onClick(()=>this.run(()=>probeSession.features.stopDisplay()))
        Button('清空本轮模型历史').softBtn().width('100%').onClick(()=>{this.services.clearHistory();this.answer='';})
        Text(this.displayNote).fontSize(13).fontColor($r('app.color.text_secondary'))
        }
      } else if(this.tab==='电脑任务') {
        TaskPanel()
      } else if(this.tab==='录音') {
        RecordingPanel({connected:this.connected})
      } else if(this.tab==='智记') {
        JournalPanel({connected:this.connected})
      } else if(this.tab==='提词器') {
        TeleprompterPanel({connected:this.connected})
      } else if(this.tab==='通知') {
        NotificationPanel()
      } else if(this.tab==='待办'||this.tab==='资料') {
        LibraryPanel({category:this.tab})
      } else {
        NavigationPanel()
      }
    }.padding(20).width('100%').backgroundColor($r('app.color.card_bg')).borderRadius(20).alignItems(HorizontalAlign.Start)
  }

  build() {
    if (this.wide) {
      // 展开态：左侧功能轨 + 右侧内容卡，一列变两列
      Row({ space: 16 }) {
        Column({ space: 2 }) {
          ForEach(this.railTabs, (t: string) => {
            Text(t).fontSize(14)
              .fontColor(this.tab === t ? $r('app.color.brand') : $r('app.color.text_secondary'))
              .fontWeight(this.tab === t ? FontWeight.Medium : FontWeight.Normal)
              .width('100%').padding({ left: 14, top: 11, bottom: 11 }).borderRadius(12)
              .backgroundColor(this.tab === t ? $r('app.color.brand_deep') : '#00000000')
              .onClick((): void => { this.tab = t; this.status = ''; })
          }, (t: string): string => t)
        }.width(148).padding(10).backgroundColor($r('app.color.card_bg')).borderRadius(18)
        Column() { this.contentCard() }.layoutWeight(1)
      }.width('100%').alignItems(VerticalAlign.Top)
    } else {
      this.contentCard()
    }
  }
}
