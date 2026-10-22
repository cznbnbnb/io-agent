import { common, abilityAccessCtrl } from '@kit.AbilityKit';
import { geoLocationManager } from '@kit.LocationKit';
import { ServiceConfig, RemoteServices, RouteResult, TravelMode } from './RemoteServices';
import { NavigationProgress, NavProgress, parseNavPoint } from './NavigationProgress';
import { DeviceFeatures } from './DeviceFeatures';

export class NavigationState {
  mode: string = 'preview'; active: boolean = false; busy: boolean = false;
  note: string = '选择出行方式和目的地'; text: string = ''; step: number = 0;
  remaining: number = 0; toTurn: number = 0; accuracy: number = -1;
  route: RouteResult = new RouteResult(); display: string = '尚未发送到眼镜';
}
export class NavigationSession {
  state: NavigationState = new NavigationState();
  changed: ()=>void = ():void=>{};
  private services: RemoteServices = new RemoteServices();
  private geometry: NavigationProgress = new NavigationProgress();
  private generation: number = 0;
  private timer: number = -1;
  private listener: ((fix:geoLocationManager.Location)=>void)|undefined = undefined;
  private features: DeviceFeatures;
  private foreground: ()=>boolean;
  private latestFix: number = 0;
  private conversionAt: number = 0;
  private converting: boolean = false;
  private pushed: string = '';
  private publishing: boolean = false;
  private ownsDisplay: boolean = false;
  private simulation: number = 0;
  private travel: TravelMode = 'walking';
  constructor(features:DeviceFeatures, foreground:()=>boolean){this.features=features;this.foreground=foreground;}
  async plan(config:ServiceConfig, origin:string, destination:string, city:string, mode:TravelMode, live:boolean, context:common.UIAbilityContext, destinationCoordinate:string=''):Promise<void> {
    if(this.state.busy)throw new Error('正在规划路线');
    const stopped=this.stop();const generation=++this.generation;this.state.busy=true;this.state.note='规划路线…';this.state.mode=live?'live':'preview';this.travel=mode;this.changed();
    try {
      await stopped;if(generation!==this.generation)return;
      let from='';
      if(live){
        const permission=await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context,['ohos.permission.APPROXIMATELY_LOCATION','ohos.permission.LOCATION']);
        if(generation!==this.generation)return;
        if(permission.authResults.length!==2||permission.authResults.some((v:number)=>v!==0))throw new Error('真实导航需要精确定位授权');
        if(!this.foreground())throw new Error('请回到应用前台开始导航');
        const fix=await geoLocationManager.getCurrentLocation({priority:geoLocationManager.LocationRequestPriority.ACCURACY,timeoutMs:15000});
        if(generation!==this.generation)return;
        if(!this.validFix(fix))throw new Error('未取得新鲜、精度足够的定位，请到室外重试');
        from=await this.services.gpsCoordinate(config,fix.longitude,fix.latitude);
      }else from=await this.services.resolvePlace(config,origin,city);
      if(generation!==this.generation)return;
      const to=destinationCoordinate||await this.services.resolvePlace(config,destination,city);
      if(generation!==this.generation)return;
      const route=await this.services.routeCoordinates(config,from,to,mode);
      if(generation!==this.generation)return;
      this.geometry.load(route.steps.map((s)=>s.polyline));this.state.route=route;this.state.step=0;
      this.state.remaining=Math.round(this.geometry.total);this.state.toTurn=Number(route.steps[0].distance)||0;
      this.state.note=live?'路线已就绪 · 点击开始真实导航':'路线已就绪 · 手动预览或模拟演示';this.compose();
    }catch(error){if(generation===this.generation){this.state.note=(error as Error).message;throw new Error(this.state.note);}}
    finally{if(generation===this.generation){this.state.busy=false;this.changed();}}
  }
  private validFix(fix:geoLocationManager.Location):boolean {
    return Number.isFinite(fix.accuracy)&&fix.accuracy>=0&&fix.accuracy<=50&&Number.isFinite(fix.timeStamp)&&Date.now()-fix.timeStamp<=15000&&fix.timeStamp<=Date.now()+2000;
  }
  start(config:ServiceConfig, simulated:boolean):void {
    if(this.state.busy||this.state.active||!this.state.route.steps.length)throw new Error('请先规划路线');
    if(!simulated&&this.state.mode!=='live')throw new Error('请从我的定位重新规划');
    if(!this.foreground())throw new Error('请在前台启动导航');
    if(this.ownsDisplay)throw new Error('请先停止当前预览，再重新规划并启动导航');
    this.geometry.load(this.state.route.steps.map(s=>s.polyline));this.simulation=0;
    this.state.active=true;this.state.mode=simulated?'simulation':'live';this.latestFix=Date.now();this.conversionAt=0;
    const generation=++this.generation;
    if(!simulated){
      this.listener=(fix:geoLocationManager.Location):void=>{
        if(generation!==this.generation||!this.state.active||this.converting||!this.validFix(fix))return;
        if(Date.now()-this.conversionAt<4000)return;
        this.conversionAt=Date.now();this.converting=true;
        this.services.gpsCoordinate(config,fix.longitude,fix.latitude).then((coordinate:string)=>{
          if(generation!==this.generation)return;
          const progress=this.geometry.update(parseNavPoint(coordinate),fix.accuracy,fix.timeStamp,Date.now(),this.travel==='walking'?4:this.travel==='bicycling'?18:55);
          this.apply(progress);if(progress.accepted)this.latestFix=Date.now();this.state.accuracy=fix.accuracy;
        }).catch(()=>{if(generation===this.generation){this.state.note='坐标转换暂不可用，暂停更新道路指引';this.state.text='定位更新失败\n请以手机地图和道路标识为准';this.changed();}})
          .finally(()=>{if(generation===this.generation)this.converting=false;});
      };
      try{geoLocationManager.on('locationChange',{scenario:geoLocationManager.LocationRequestScenario.NAVIGATION,timeInterval:2,distanceInterval:0,maxAccuracy:50},this.listener);}
      catch(_){this.state.active=false;this.listener=undefined;throw new Error('无法启动定位，请检查系统定位开关');}
    }
    this.state.note=simulated?'模拟演示 · 不代表真实位置':'等待定位更新 · 请保持应用前台';this.compose();this.changed();
    this.timer=setInterval(()=>{
      if(generation!==this.generation)return;
      if(!this.foreground()){this.stop('已退到后台，定位导航已停止；蓝牙后台保持不受影响').catch(()=>{});return;}
      if(simulated){this.simulation=Math.min(this.geometry.total,this.simulation+Math.max(10,this.geometry.total/80));this.apply(this.geometry.update(this.geometry.sample(this.simulation),1,Date.now(),Date.now(),100000));}
      else if(Date.now()-this.latestFix>20000){this.state.note='定位已过期 · 暂停道路指引';this.state.text='定位信号中断\n请以手机地图和道路标识为准';this.changed();}
      if(this.ownsDisplay&&!this.features.state.connected){this.stop('眼镜断开，导航已停止').catch(()=>{});return;}
      if(this.ownsDisplay&&!this.features.displayActive){this.stop('眼镜显示会话已结束，请重新开始导航').catch(()=>{});return;}
      if(this.ownsDisplay)this.publish().catch(()=>{});
    },1000);
  }
  private apply(progress:NavProgress):void {
    if(!progress.accepted)return;
    if(progress.offRoute){this.state.note='已偏离路线 · 请停止后从我的定位重新规划';this.state.text='已偏离路线\n请在手机重新规划';this.changed();return;}
    this.state.step=progress.step;this.state.remaining=progress.remaining;this.state.toTurn=progress.toTurn;
    this.state.note=progress.arrived?'已到达目的地':this.state.mode==='simulation'?'模拟演示 · 自动更新路段':'实时定位指引';
    this.compose();this.changed();
    if(progress.arrived){this.state.text=`${this.state.mode==='simulation'?'模拟演示':'导航'}\n已到达目的地`;this.finishArrival();}
  }
  private finishArrival():void {
    this.state.active=false;this.releaseLocation();
    this.publish().catch(()=>{});
    if(this.timer!==-1)clearInterval(this.timer);
    const generation=this.generation;
    this.timer=setTimeout(()=>{if(generation===this.generation)this.stop('导航已结束').catch(()=>{});},10000);
    this.changed();
  }
  private compose():void {
    const s=this.state.route.steps[this.state.step];if(!s)return;
    const label=this.state.mode==='simulation'?'模拟演示':this.state.mode==='live'?'定位指引':'路线预览';
    this.state.text=`${label} · ${this.state.step+1}/${this.state.route.steps.length}\n${s.instruction.slice(0,42)}\n本段剩余 ${this.state.toTurn}米 · 全程剩余 ${this.state.remaining}米`.slice(0,96);
  }
  step(offset:number):void {
    if(this.state.active)return;this.state.step=Math.max(0,Math.min(this.state.route.steps.length-1,this.state.step+offset));
    this.state.toTurn=Number(this.state.route.steps[this.state.step]?.distance)||0;this.compose();this.changed();
  }
  async show():Promise<void>{
    if(!this.state.text)throw new Error('请先规划路线');
    if(!this.ownsDisplay){
      if(this.features.displayActive)throw new Error('已有其他显示会话，请先退出');
      // Claim ownership before awaiting so stop can cancel an in-flight opening.
      this.ownsDisplay=true;const generation=this.generation;
      try{await this.features.show(this.state.text,this.state.active);}
      catch(error){if(generation===this.generation)this.ownsDisplay=false;throw new Error((error as Error).message);}
      if(generation!==this.generation)return;this.pushed='';
    }
    else await this.publish();
    this.state.display=this.features.state.display;this.changed();
  }
  private async publish():Promise<void>{
    if(!this.ownsDisplay||this.publishing||!this.features.state.displayReady||this.pushed===this.state.text)return;
    const text=this.state.text,generation=this.generation;this.publishing=true;
    try{await this.features.updateDisplay(text);if(generation===this.generation){this.pushed=text;this.state.display='最新指引已提交 · 镜片效果待验收';}}
    catch(_){if(generation===this.generation)this.state.display='蓝牙繁忙，保留最新指引等待重试';}
    finally{if(generation===this.generation){this.publishing=false;this.changed();}}
  }
  private releaseLocation():void{if(this.listener){try{geoLocationManager.off('locationChange',this.listener);}catch(_){}this.listener=undefined;}}
  async stop(note:string='导航已停止'):Promise<void>{
    this.generation++;this.services.cancel();this.releaseLocation();if(this.timer!==-1){clearInterval(this.timer);clearTimeout(this.timer);}this.timer=-1;
    this.state.active=false;this.state.busy=false;this.converting=false;this.publishing=false;this.state.note=note;
    this.state.route=new RouteResult();this.state.text='';this.pushed='';
    const owned=this.ownsDisplay;this.ownsDisplay=false;
    try{if(owned)await this.features.stopDisplay();}finally{this.changed();}
  }
}
