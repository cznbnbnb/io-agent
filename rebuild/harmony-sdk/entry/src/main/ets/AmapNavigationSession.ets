import { common, abilityAccessCtrl } from '@kit.AbilityKit';
import { geoLocationManager } from '@kit.LocationKit';
import { AMapNaviFactory, IAMapNavi, IAMapNaviListener, INaviInfo, IAMapCalcRouteResult,
  NaviLatLng, NaviPoi, CoordinateConverter, CoordType, LatLng, AMapTravelInfo, TransportType } from '@amap/amap_lbs_navi';
import { ServiceConfig, RouteResult, RouteStep, TravelMode } from './RemoteServices';
import { NavigationSession } from './NavigationSession';
import { DeviceFeatures } from './DeviceFeatures';
import { configureAmap, AmapNativeServices } from './AmapNativeServices';

export function turnLabel(icon:number):string {
  const labels:string[]=['沿道路前进','沿道路前进','左转','右转','向左前方','向右前方','向左后方','向右后方','掉头','直行','途经点','进入环岛','驶出环岛','服务区','收费站','到达目的地','隧道'];
  return labels[icon]||'沿当前路线前进';
}
function point(value:string):NaviLatLng {
  const parts=value.split(',').map(Number);
  if(parts.length!==2||!parts.every(Number.isFinite)||Math.abs(parts[0])>180||Math.abs(parts[1])>90)throw new Error('地点坐标无效，请重新选择');
  return new NaviLatLng(parts[1],parts[0]);
}

// Reuses the tested display ownership/closing state machine, not the Web/GPS route engine.
export class AmapNavigationSession extends NavigationSession {
  private nativeEpoch:number=0;
  private engine:IAMapNavi|undefined=undefined;
  private callbacks:IAMapNaviListener|undefined=undefined;
  private lookup:AmapNativeServices=new AmapNativeServices();
  private routeReject:((error:Error)=>void)|undefined=undefined;
  private nativeTimer:number=-1;
  private arrivalTimer:number=-1;
  private glasses:boolean=false;
  private nativeFeatures:DeviceFeatures;
  private isForeground:()=>boolean;
  private lastInfo:number=0;
  private nativeReady:boolean=false;
  private everReady:boolean=false;
  private plannedLive:boolean=false;
  constructor(features:DeviceFeatures,foreground:()=>boolean){super(features,foreground);this.nativeFeatures=features;this.isForeground=foreground;}

  async plan(config:ServiceConfig,origin:string,destination:string,city:string,mode:TravelMode,live:boolean,context:common.UIAbilityContext,destinationCoordinate:string=''):Promise<void>{
    if(this.state.busy)throw new Error('正在规划路线');
    const stopping=this.stop();const epoch=++this.nativeEpoch;this.state.busy=true;this.state.mode=live?'live':'preview';this.plannedLive=live;this.state.note='高德原生 SDK 正在规划…';this.changed();
    try{
      await stopping;if(epoch!==this.nativeEpoch)return;
      configureAmap(config,context);
      let from:NaviLatLng;
      if(live){
        const permission=await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context,['ohos.permission.APPROXIMATELY_LOCATION','ohos.permission.LOCATION']);
        if(epoch!==this.nativeEpoch)return;
        if(permission.authResults.length!==2||permission.authResults.some((v:number)=>v!==0))throw new Error('真实导航需要精确定位授权；室内可用模拟模式');
        if(!this.isForeground())throw new Error('请在应用前台获取定位');
        const fix=await geoLocationManager.getCurrentLocation({priority:geoLocationManager.LocationRequestPriority.ACCURACY,timeoutMs:15000});
        if(epoch!==this.nativeEpoch)return;
        if(!Number.isFinite(fix.accuracy)||fix.accuracy<0||fix.accuracy>50||!Number.isFinite(fix.timeStamp)||Date.now()-fix.timeStamp>15000||fix.timeStamp>Date.now()+2000)throw new Error('定位不够准确，请到室外或改用模拟演示');
        const converted=new CoordinateConverter(context).from(CoordType.GPS).coord(new LatLng(fix.latitude,fix.longitude)).convert();
        if(!converted)throw new Error('高德坐标转换失败');
        from=new NaviLatLng(converted.latitude,converted.longitude);this.state.accuracy=fix.accuracy;
      }else{
        const matches=await this.lookup.searchPlaces(config,origin,city,context);if(epoch!==this.nativeEpoch)return;
        if(!matches.length)throw new Error('找不到出发地点，请输入更完整的名称');
        from=point(matches[0].location);
      }
      if(!destinationCoordinate)throw new Error('请先搜索并选择目的地，或在地图上点选');
      const to=point(destinationCoordinate);
      if(epoch!==this.nativeEpoch)return;
      this.engine=AMapNaviFactory.getAMapNaviInstance(context.getApplicationContext(),config.amapHarmonyKey);
      this.engine.setUseInnerVoice(false,true);
      await this.calculate(from,to,mode,epoch);
      if(epoch!==this.nativeEpoch)return;
      this.readRoute();this.state.note='原生路线已就绪 · 选择真实导航或模拟演示';
    }catch(error){if(epoch===this.nativeEpoch){this.nativeReady=false;this.state.note=(error as Error).message;this.destroyEngine();throw new Error(this.state.note);}}
    finally{if(epoch===this.nativeEpoch){this.state.busy=false;this.changed();}}
  }
  private calculate(from:NaviLatLng,to:NaviLatLng,mode:TravelMode,epoch:number):Promise<void>{
    return new Promise<void>((resolve,reject)=>{
      let done=false;
      const finish=(error?:Error):void=>{if(done)return;done=true;clearTimeout(timeout);this.routeReject=undefined;if(error)reject(error);else{this.nativeReady=true;resolve();}};
      const timeout=setTimeout(()=>finish(new Error('高德算路超时，请检查网络、Key 或导航服务权限')),30000);
      this.routeReject=(error:Error):void=>finish(error);
      const current=():boolean=>epoch===this.nativeEpoch;
      this.callbacks={
        onInitNaviFailure:():void=>{if(current())finish(new Error('高德导航初始化失败'));},
        onCalculateRouteSuccess:(_result:IAMapCalcRouteResult|null):void=>{
          if(!current())return;if(!done)finish();else if(this.state.active){try{this.readRoute();this.state.note='已重新规划路线';this.changed();}catch(_){this.stop('重新规划未返回可用路线，请重试').catch(()=>{});}}
        },
        onCalculateRouteFailure:(code:number):void=>{if(current())this.routeFailure(code,finish);},
        onCalculateRouteFailureForResult:(result:IAMapCalcRouteResult|null):void=>{if(current())this.routeFailure(result?.errorCode||-1,finish);},
        onNaviInfoUpdate:(info:INaviInfo):void=>{if(current()&&this.state.active)this.receiveInfo(info);},
        onReCalculateRouteForYaw:():void=>{if(current()&&this.state.active){this.state.note='偏离路线 · 高德重新规划中';this.state.text='正在重新规划\n请以道路标识为准';this.changed();}},
        onGpsSignalWeak:(weak:boolean):void=>{if(current()&&weak&&this.state.active&&this.state.mode==='live'){this.state.note='GPS 信号较弱';this.state.text='定位信号较弱\n请以手机地图和道路标识为准';this.changed();}},
        onArriveDestination:():void=>{if(current())this.arrive(epoch);},
        onEndEmulatorNavi:():void=>{if(current())this.arrive(epoch);}
      };
      try{
        this.engine!.addAMapNaviListener(this.callbacks);
        let accepted=false;
        if(mode==='walking'){this.engine!.setTravelInfo(new AMapTravelInfo(TransportType.Walk));accepted=this.engine!.calculateWalkRouteLatLng(from,to);}
        else if(mode==='bicycling'){this.engine!.setTravelInfo(new AMapTravelInfo(TransportType.Ride));accepted=this.engine!.calculateRideRouteLatLng(from,to);}
        else accepted=this.engine!.calculateDriveRouteForPoi(new NaviPoi('出发地',from,null),new NaviPoi('目的地',to,null),null,10);
        if(!accepted)finish(new Error('高德未接受算路请求，请检查起终点及 Key 绑定'));
      }catch(_){finish(new Error('高德算路请求无法启动'));}
    });
  }
  private routeFailure(code:number,finish:(error?:Error)=>void):void {
    const message=`高德算路失败（${code}），请核对完整 App ID、Key 与导航服务权限`;
    finish(new Error(message));
    if(this.state.active){this.state.note=message;this.state.text='路线更新失败\n请停止后重新规划';this.changed();}
  }
  private readRoute():void {
    const path=this.engine?.getNaviPath();if(!path)throw new Error('高德未返回可用路线');
    const route=new RouteResult();route.distance=String(path.getAllLength());route.duration=String(path.getAllTime());
    const steps=path.getSteps();if(steps)for(let i=0;i<steps.length;i++){
      const source=steps[i],step=new RouteStep();step.distance=String(source.getLength());
      const links=source.getLinks();step.road=links?.length?links[0].getRoadName()||'':'';
      step.instruction=`${turnLabel(source.getIconType())} ${step.road}`.trim();
      const coords=source.getCoords(),points:string[]=[];
      if(coords)for(let j=0;j<coords.length;j++)points.push(`${coords[j].getLongitude()},${coords[j].getLatitude()}`);
      step.polyline=points.join(';');route.steps.push(step);
    }
    if(!route.steps.length)throw new Error('高德路线没有路段数据');
    this.state.route=route;this.state.step=0;this.state.remaining=Number(route.distance);this.state.toTurn=Number(route.steps[0].distance);
    this.state.text=`原生路线 · ${Math.round(Number(route.distance))}米\n${route.steps[0].instruction}\n预计 ${Math.max(1,Math.round(Number(route.duration)/60))} 分钟`;
  }
  start(_config:ServiceConfig,simulated:boolean):void {
    if(!this.nativeReady||!this.engine||this.state.busy||this.state.active)throw new Error('请先规划路线');
    if(!simulated&&!this.plannedLive)throw new Error('真实导航请从我的定位重新规划');
    if(!this.isForeground())throw new Error('请在应用前台启动导航');
    this.state.mode=simulated?'simulation':'live';this.state.active=true;this.lastInfo=Date.now();
    this.everReady=false;const epoch=this.nativeEpoch;
    if(!this.engine.startNavi(simulated?1:0)){this.state.active=false;throw new Error('高德导航未启动，请重新规划');}
    this.nativeReady=false;this.state.note=simulated?'高德模拟演示 · 不代表真实位置':'高德实时导航 · 保持应用前台';this.changed();
    this.nativeTimer=setInterval(()=>{
      if(epoch!==this.nativeEpoch)return;
      if(!this.isForeground()){this.stop('已退到后台，导航已停止').catch(()=>{});return;}
      if(this.glasses&&!this.nativeFeatures.state.connected){this.stop('眼镜断开，导航已停止').catch(()=>{});return;}
      if(this.glasses&&this.nativeFeatures.displayActive)this.everReady=true;
      if(this.glasses&&this.everReady&&!this.nativeFeatures.displayActive){this.stop('眼镜显示已退出').catch(()=>{});return;}
      if(this.state.active&&Date.now()-this.lastInfo>20000){this.state.note='导航数据已过期';this.state.text='等待导航位置更新\n请以手机地图和道路标识为准';this.changed();}
      if(this.glasses&&this.nativeFeatures.displayActive)super.show().catch(()=>{});
    },1000);
  }
  private receiveInfo(info:INaviInfo):void {
    if(!Number.isFinite(info.mRouteRemainDis)||!Number.isFinite(info.mSegRemainDis))return;
    this.lastInfo=Date.now();this.state.step=Math.max(0,Math.min(this.state.route.steps.length-1,info.mCurSegIndex));
    this.state.remaining=Math.max(0,Math.round(info.mRouteRemainDis));this.state.toTurn=Math.max(0,Math.round(info.mSegRemainDis));
    const label=this.state.mode==='simulation'?'模拟演示':'实时导航';
    this.state.note=`${label} · 原生 SDK 回调`;this.state.text=`${label} · ${this.state.toTurn}米后${turnLabel(info.mIcon)}\n${info.mNextRoadName||info.mCurRoadName||'沿路线前进'}\n剩余 ${this.state.remaining}米 · ${Math.max(1,Math.round(info.mRouteRemainTime/60))}分钟`.slice(0,96);this.changed();
  }
  private arrive(epoch:number):void {
    if(!this.state.active)return;this.state.active=false;this.state.text='已到达目的地';this.state.note=this.state.mode==='simulation'?'模拟演示已完成':'导航已到达';
    this.engine?.stopGPS();this.changed();
    if(this.glasses)super.show().catch(()=>{});
    this.arrivalTimer=setTimeout(()=>{if(epoch===this.nativeEpoch)this.stop('导航已结束').catch(()=>{});},10000);
  }
  async show():Promise<void>{this.glasses=true;try{await super.show();}catch(error){this.glasses=false;throw new Error((error as Error).message);}}
  private destroyEngine():void {
    if(this.engine){if(this.callbacks)this.engine.removeAMapNaviListener(this.callbacks);this.engine.stopNavi();this.engine.stopGPS();AMapNaviFactory.destroyAMapNaviInstance();}
    this.engine=undefined;this.callbacks=undefined;
  }
  async stop(note:string='导航已停止'):Promise<void>{
    this.nativeEpoch++;this.lookup.cancel();this.nativeReady=false;this.glasses=false;
    const reject=this.routeReject;this.routeReject=undefined;if(reject)reject(new Error('规划已取消'));
    if(this.nativeTimer!==-1)clearInterval(this.nativeTimer);this.nativeTimer=-1;
    if(this.arrivalTimer!==-1)clearTimeout(this.arrivalTimer);this.arrivalTimer=-1;
    this.destroyEngine();await super.stop(note);
  }
}
