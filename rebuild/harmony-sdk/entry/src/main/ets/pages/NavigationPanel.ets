import { common, bundleManager } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { probeSession } from '../ProbeSession';
import { AmapNavigationSession } from '../AmapNavigationSession';
import { AmapNativeServices, configureAmap, revokeAmap } from '../AmapNativeServices';
import { AmapPreview } from './AmapPreview';
import { ServiceConfig, SecureServiceConfig, TravelMode, RemoteServices, NavigationPlace } from '../RemoteServices';

@Extend(Button)
function chipBtn() {
  .backgroundColor($r('app.color.input_bg'))
  .fontColor($r('app.color.text_primary'))
}


@Component
export struct NavigationPanel {

  @State mode: TravelMode = 'walking';
  @State live: boolean = true;
  @State city: string = '北京';
  @State origin: string = '';
  @State destination: string = '';
  @State places:NavigationPlace[]=[];
  @State selectedPlace:string='';
  @State searching:boolean=false;
  @State serviceKey: string = '';
  @State settings: boolean = false;
  @State configured: boolean = false;
  @State applicationId: string = '';
  @State showKeyHelp: boolean = false;
  @State consent:boolean=false;
  @State mapReady:boolean=false;
  @State routePoints:string='';
  @State busy: boolean = false;
  @State active: boolean = false;
  @State ready: boolean = false;
  @State note: string = '选择目的地，抬眼看路线';
  @State display: string = '';
  @State text: string = '';
  @State remaining: number = 0;
  @State step: number = 0;
  @State count: number = 0;
  @State accuracy: number = -1;
  @State displayClosing:boolean=false;
  private displayMonitor:number=-1;
  private config: ServiceConfig = new ServiceConfig();
  private vault: SecureServiceConfig = new SecureServiceConfig();
  private session: AmapNavigationSession = new AmapNavigationSession(probeSession.features,()=>probeSession.foreground);
  private visible: boolean = false;
  private searchService:AmapNativeServices=new AmapNativeServices();
  private searchEpoch:number=0;
  private tell(message:string):void{this.note=message;try{this.getUIContext().getPromptAction().showToast({message:message,duration:3000});}catch(_){}}
  private invalidateSelection():void {
    this.places=[];this.selectedPlace='';this.searchEpoch++;this.searchService.cancel();this.searching=false;
    if(this.ready)this.session.stop('起终点已修改，请重新规划路线').catch(()=>{});
  }
  private async search():Promise<void>{
    if(this.searching){this.searchEpoch++;this.searchService.cancel();this.searching=false;this.tell('搜索已取消');return;}
    if(!this.configured||!this.consent){this.settings=true;this.tell('请配置鸿蒙 SDK Key 并同意地图服务说明');return;}
    const epoch=++this.searchEpoch;this.searching=true;this.places=[];this.selectedPlace='';this.note='正在搜索目的地…';
    try{const places=await this.searchService.searchPlaces(this.config,this.destination,this.city,this.getUIContext().getHostContext() as common.UIAbilityContext);if(!this.visible||epoch!==this.searchEpoch)return;this.places=places;this.tell(places.length?'请从结果中选择目的地，再规划路线':'没有找到地点，请加上道路或区县重试');}
    catch(error){if(this.visible&&epoch===this.searchEpoch)this.tell((error as Error).message);}
    finally{if(this.visible&&epoch===this.searchEpoch)this.searching=false;}
  }
  aboutToAppear():void {
    this.visible=true;this.session.changed=():void=>this.refresh();
    try {
      this.applicationId=bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_SIGNATURE_INFO).signatureInfo.appId;
    } catch (_) { this.applicationId=''; }
    this.displayMonitor=setInterval(()=>{if(this.visible){this.display=probeSession.features.state.display;this.displayClosing=probeSession.features.displayClosing;}},500);
    probeSession.onNavigationSuspend=():void=>{this.session.stop('应用已退到后台，导航已停止').catch(()=>{});};
    this.vault.load().then((config:ServiceConfig)=>{if(this.visible){this.config=config;this.configured=!!config.amapHarmonyKey;this.consent=config.amapConsent===true;this.settings=!this.configured||!this.consent;this.enableMap();}}).catch(()=>{if(this.visible)this.settings=true;});
  }
  aboutToDisappear():void {this.visible=false;if(this.displayMonitor!==-1)clearInterval(this.displayMonitor);this.displayMonitor=-1;this.searchEpoch++;this.searchService.cancel();probeSession.onNavigationSuspend=():void=>{};this.session.changed=():void=>{};this.session.stop('已离开导航页').catch(()=>{});}
  private refresh():void {
    if(!this.visible)return;const s=this.session.state;this.busy=s.busy;this.active=s.active;this.ready=s.route.steps.length>0;
    this.note=s.note;this.display=s.display;this.text=s.text;this.remaining=s.remaining;this.step=s.step;this.count=s.route.steps.length;this.accuracy=s.accuracy;
    this.routePoints=s.route.steps.map((step)=>step.polyline).join(';');
  }
  private enableMap():void{if(this.configured&&this.consent){try{configureAmap(this.config,this.getUIContext().getHostContext() as common.UIAbilityContext);this.mapReady=true;}catch(error){this.tell((error as Error).message);}}}
  private async copyApplicationId():Promise<void> {
    try {
      if(!this.applicationId)throw new Error('missing-app-id');
      await pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN,this.applicationId));
      if(this.visible)this.tell('完整 App ID 已复制，可粘贴到高德申请页面');
    } catch (_) { if(this.visible)this.tell('复制失败，请重新进入导航页后重试'); }
  }
  private openKeyGuide():void {
    const context=this.getUIContext().getHostContext() as common.UIAbilityContext;
    context.startAbility({action:'ohos.want.action.viewData',uri:'https://lbs.amap.com/api/harmonyosnext-navi-sdk/gettingstarted'})
      .catch(()=>{if(this.visible)this.tell('请在浏览器搜索“高德 鸿蒙导航 SDK 入门指南”');});
  }
  private async acceptProvider():Promise<void>{
    const current=await this.vault.load();current.amapConsent=true;await this.vault.save(current);
    if(this.visible){this.config=current;this.consent=true;this.enableMap();this.tell('已同意地图服务；模拟演示不读取当前位置');}
  }
  private askConsent():void{
    this.getUIContext().showAlertDialog({title:'高德地图与导航',message:'开启后，高德 SDK 将处理设备/网络信息以鉴权并加载地图；搜索词、起终点会发送给高德。真实导航还会使用精确位置，模拟演示不读取当前位置。Turbo IO 不保存轨迹。请阅读高德隐私政策 https://lbs.amap.com/pages/privacy/ 后选择。可在本页撤回。',primaryButton:{value:'暂不开启',action:():void=>{}},secondaryButton:{value:'同意并开启',action:():void=>{this.acceptProvider().catch(()=>this.tell('同意状态未保存，请重试'));}}});
  }
  private async revokeProvider():Promise<void>{
    this.searchEpoch++;this.searchService.cancel();this.searching=false;await this.session.stop();this.mapReady=false;
    const current=await this.vault.load();current.amapConsent=false;await this.vault.save(current);this.config=current;this.consent=false;revokeAmap(this.getUIContext().getHostContext() as common.UIAbilityContext);this.tell('地图服务已关闭；重新进入或重启也不会自动开启');
  }
  private async save():Promise<void> {
    if(!/^[a-f0-9]{32}$/i.test(this.serviceKey.trim())){this.note='请填写 32 位高德鸿蒙 SDK Key';return;}
    try {
      // Reload before changing one setting; never overwrite newer voice/weather credentials.
      const current=await this.vault.load();current.amapHarmonyKey=this.serviceKey.trim();await this.vault.save(current);
      if(this.visible){this.config=current;this.configured=true;this.serviceKey='';this.settings=!this.consent;this.enableMap();this.note='鸿蒙 Key 已保存到本机安全存储';}
    }catch(_){if(this.visible)this.note='配置未保存，请检查安全存储';}
  }
  private plan():void {
    if(this.busy||this.active)return;
    if(!this.configured||!this.consent){this.settings=true;this.tell('请配置鸿蒙 SDK Key 并同意地图服务说明');return;}
    if(!this.destination.trim()){this.tell('请输入目的地，点击搜索地点并选择结果');return;}
    if(!this.live&&!this.origin.trim()){this.tell('模拟模式请填写出发地点，例如北京站');return;}
    this.session.plan(this.config,this.origin,this.destination,this.city,this.mode,this.live,this.getUIContext().getHostContext() as common.UIAbilityContext,this.selectedPlace)
      .catch((error:Error)=>{if(this.visible)this.tell(error.message);});
  }
  private start(simulated:boolean):void {
    if(!probeSession.features.state.connected){this.tell('请先连接眼镜；已规划路线保留，连接后再开始');return;}
    if(probeSession.recordingOccupied()){this.note='请先结束录音并等待归档';return;}
    if(probeSession.prompterOccupied()){this.note='请先退出提词器';return;}
    if(probeSession.voice.active){this.note='请先结束当前语音对话；待命状态不影响导航';return;}
    try{this.session.start(this.config,simulated);if(probeSession.features.state.connected)this.session.show().catch((error:Error)=>{this.note=error.message;});}
      catch(error){this.tell((error as Error).message);}
  }
  @Builder
  private input(label:string,value:string,change:(v:string)=>void) {
    Text(label).fontColor($r('app.color.text_muted')).fontSize(12)
    TextInput({text:value,placeholder:label}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).maxLength(100).height(48).fontColor($r('app.color.text_primary')).backgroundColor($r('app.color.card_bg')).borderRadius(12).onChange(change).enabled(!this.active&&!this.busy)
  }
  build() {
    Column({space:16}) {
      Row(){Text('导航').fontSize(26).fontWeight(FontWeight.Bold).fontColor($r('app.color.text_primary'));Blank();Button('服务配置').fontSize(12).backgroundColor($r('app.color.card_raise')).fontColor($r('app.color.text_muted')).onClick(()=>{this.settings=!this.settings;})}.width('100%')
      Text('1 搜索目的地 → 2 规划路线 → 3 开始导航').fontColor($r('app.color.text_muted')).fontSize(13)
      Text(this.note).fontColor($r('app.color.warm')).fontSize(14).width('100%').padding(12).backgroundColor($r('app.color.card_raise')).borderRadius(12)
      Text('室内测试：关闭“使用我的定位”，填写出发地；规划后点“模拟演示”。开始后自动请求眼镜显示，无需去其他页面初始化。').fontColor($r('app.color.text_secondary')).fontSize(12)
      Row({space:6}) {
        ForEach(['walking','bicycling','driving'],(mode:TravelMode)=>{
          Button(mode==='walking'?'步行':mode==='bicycling'?'骑行':'驾车').layoutWeight(1).height(42).fontSize(14)
            .backgroundColor(this.mode===mode?$r('app.color.brand'):$r('app.color.card_raise')).fontColor(this.mode===mode?$r('app.color.on_brand'):$r('app.color.text_secondary'))
            .enabled(!this.active&&!this.busy).onClick(()=>{this.mode=mode;this.session.stop('出行方式已更改，请重新规划').catch(()=>{});})
        })
      }.width('100%')
      if(this.settings) {
        Column({space:10}) {
          Text(this.configured?'高德鸿蒙服务已配置':'需要高德鸿蒙 SDK Key').fontColor($r('app.color.text_secondary')).fontSize(14)
          TextInput({text:this.serviceKey,placeholder:'鸿蒙 SDK Key · 已保存的值不回显'}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).type(InputType.Password).maxLength(200).height(44).backgroundColor($r('app.color.card_bg')).fontColor($r('app.color.text_primary')).onChange((v:string)=>{this.serviceKey=v;})
          Button('保存到本机').chipBtn().enabled(!this.active&&!this.busy).onClick(()=>this.save())
          Text('绑定当前签名对应的完整 App ID。Web / iOS / Android Key 不能替代。首次需同意下方地图服务说明。').fontColor($r('app.color.text_muted')).fontSize(12)
          Button(this.showKeyHelp?'收起申请说明':'还没有 Key？查看申请步骤').chipBtn().fontSize(12).onClick(()=>{this.showKeyHelp=!this.showKeyHelp;})
          if(this.showKeyHelp) {
            Text('1. 登录高德开放平台，进入控制台的应用管理。\n2. 创建应用并添加 Key，选择鸿蒙平台，填写本应用完整 App ID。\n3. 将生成的 Key 填入上方，保存后阅读并开启地图服务。').fontColor($r('app.color.text_secondary')).fontSize(13).lineHeight(22).width('100%')
            Text(this.applicationId || '暂未读取到应用签名，请重新进入此页').fontColor($r('app.color.text_muted')).fontSize(11).wordBreak(WordBreak.BREAK_ALL).width('100%')
            Button('复制完整 App ID').chipBtn().enabled(!!this.applicationId).onClick(()=>this.copyApplicationId())
            Button('打开高德官方申请指南').chipBtn().onClick(()=>this.openKeyGuide())
            Text('以后更换应用签名时，需要同步更新高德绑定的 App ID。').fontColor($r('app.color.text_muted')).fontSize(12).width('100%')
          }
          Button(this.consent?'撤回地图服务授权':'阅读并开启地图服务').chipBtn().enabled(!this.active&&!this.busy).onClick(()=>{if(this.consent)this.revokeProvider().catch(()=>this.tell('撤回未完成，请重试'));else this.askConsent();})
          Button('查看高德隐私政策').chipBtn().fontSize(12).onClick(()=>{const context=this.getUIContext().getHostContext() as common.UIAbilityContext;context.startAbility({action:'ohos.want.action.viewData',uri:'https://lbs.amap.com/pages/privacy/'}).catch(()=>this.tell('请在浏览器打开 https://lbs.amap.com/pages/privacy/'));})
        }.padding(14).backgroundColor($r('app.color.card_bg')).borderRadius(16)
      }
      if(this.mapReady){
        AmapPreview({route:this.routePoints,destination:this.selectedPlace,selectable:!this.active&&!this.busy,onSelect:(coordinate:string):void=>{this.invalidateSelection();this.selectedPlace=coordinate;this.destination='地图选点';this.tell('已选择地图位置，点击规划路线');}})
        Text('可拖动、缩放地图，轻点地图选择目的地；也可在下方搜索。').fontSize(12).fontColor($r('app.color.text_muted'))
      }
      Column({space:10}) {
        Row(){Text('使用我的定位').fontColor($r('app.color.text_primary'));Blank();Toggle({type:ToggleType.Switch,isOn:this.live}).selectedColor($r('app.color.brand')).enabled(!this.active&&!this.busy).onChange((v:boolean)=>{this.live=v;this.session.stop('起点方式已更改，请重新规划').catch(()=>{});})}.width('100%')
        if(!this.live){this.input('出发地点',this.origin,(v:string)=>{this.origin=v;if(this.ready)this.session.stop('起点已修改，请重新规划路线').catch(()=>{});})}
        this.input('城市',this.city,(v:string)=>{this.city=v;this.invalidateSelection();})
        this.input('目的地 · 地点名称或完整地址',this.destination,(v:string)=>{this.destination=v;this.invalidateSelection();})
        Button(this.searching?'取消搜索':'搜索地点').chipBtn().width('100%').height(46).enabled(!this.active&&!this.busy).onClick(()=>this.search())
        ForEach(this.places,(place:NavigationPlace)=>{
          Column({space:6}){
            Text(place.name).fontColor($r('app.color.text_primary')).fontSize(16).width('100%')
            Text(place.address||'高德地点').fontColor($r('app.color.text_muted')).fontSize(12).width('100%')
          }.padding(12).backgroundColor($r('app.color.brand_deep')).borderRadius(12).width('100%').onClick(()=>{this.invalidateSelection();this.selectedPlace=place.location;this.destination=place.name;this.tell('已选择 '+place.name+'，下一步点击规划路线');})
        })
        Button(this.busy?'正在规划…':'规划路线').width('100%').height(46).backgroundColor($r('app.color.brand')).fontColor($r('app.color.on_brand'))
          .enabled(!this.active&&!this.busy&&!this.searching).onClick(()=>this.plan())
      }.padding(16).backgroundColor($r('app.color.card_bg')).borderRadius(20).width('100%').alignItems(HorizontalAlign.Start)
      if(this.ready) {
        Column({space:12}) {
          Text(`${this.step+1} / ${this.count} 路段 · 剩余 ${this.remaining} 米`).fontSize(12).fontColor($r('app.color.brand_deep'))
          Text(this.text).fontSize(21).fontWeight(FontWeight.Medium).fontColor($r('app.color.on_brand')).width('100%')
        }.padding(20).backgroundColor($r('app.color.brand')).borderRadius(20).width('100%').alignItems(HorizontalAlign.Start)
        if(!this.active) {
          Row({space:8}) {
            Button('上一段').chipBtn().layoutWeight(1).enabled(this.step>0).onClick(()=>this.session.step(-1))
            Button('下一段').chipBtn().layoutWeight(1).enabled(this.step+1<this.count).onClick(()=>this.session.step(1))
          }
          Row({space:8}) {
            Button('开始真实导航').chipBtn().layoutWeight(1).enabled(this.live).onClick(()=>this.start(false))
            Button('模拟并显示眼镜').chipBtn().layoutWeight(1).onClick(()=>this.start(true))
          }
        }
        if(this.active){Button('重试眼镜指引显示').chipBtn().width('100%').enabled(probeSession.features.state.connected&&!this.busy)
          .onClick(()=>{if(probeSession.voice.active||probeSession.recordingOccupied()||probeSession.prompterOccupied()){this.note='请先结束当前对话、录音或提词器';return;}this.session.show().catch((error:Error)=>{this.note=error.message;});})
        }
        Button('停止导航与镜片显示').width('100%').backgroundColor($r('app.color.danger_bg')).fontColor($r('app.color.danger')).onClick(()=>this.session.stop().catch(()=>{this.note='退出提交未确认，请按眼镜按钮退出';}))
      }
      Text(this.note).fontColor($r('app.color.text_secondary')).fontSize(13).width('100%')
      if(this.accuracy>=0){Text(`定位精度约 ${Math.round(this.accuracy)} 米`).fontSize(12).fontColor($r('app.color.text_muted'))}
      Text(this.display).fontColor($r('app.color.text_muted')).fontSize(12)
      if(this.displayClosing){Button('确认眼镜已回首页').chipBtn().onClick(()=>{
        this.getUIContext().showAlertDialog({title:'确认镜片已退出',message:'只有实际看到眼镜回到首页时才确认。这不是设备回执，不会删除数据。',primaryButton:{value:'尚未退出',action:():void=>{}},secondaryButton:{value:'已回首页',action:():void=>{try{probeSession.features.confirmDisplayExited();this.displayClosing=false;}catch(_){}}}});
      })}
      Text('高德原生导航 SDK · 步行 / 骑行 / 驾车。当前仅前台运行：退到桌面或离开本页即停止。模拟模式并非真实位置。请遵守道路标识，勿在行驶中操作。').fontSize(12).fontColor($r('app.color.text_muted'))
    }.alignItems(HorizontalAlign.Start).width('100%').padding(18).backgroundColor($r('app.color.input_bg')).borderRadius(22)
  }
}
