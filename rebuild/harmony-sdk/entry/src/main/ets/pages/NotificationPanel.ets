import { notifications } from '../NotificationService';
import { SuggestionTestPanel } from './SuggestionTestPanel';
@Component
export struct NotificationPanel {
  @State notificationEnabled:boolean=false;@State busy:boolean=false;@State note:string='';@State titleText:string='Turbo IO 测试';@State content:string='通知校验 5826';
  @State ownerUid:string='';
  private visible:boolean=false;
  aboutToAppear():void{this.visible=true;notifications.changed=():void=>this.refresh();this.refresh();}
  aboutToDisappear():void{this.visible=false;notifications.changed=():void=>{};}
  private refresh():void{if(!this.visible)return;this.notificationEnabled=notifications.enabled;this.busy=notifications.occupied||notifications.waiting;this.ownerUid=notifications.pendingUid;this.note=notifications.note;}
  private run(work:()=>Promise<void>):void{work().catch((error:Error)=>{if(this.visible){this.refresh();this.note=error.message;}});}
  build(){
    Column({space:16}){
      Text('消息，抬眼即见').fontSize(25).fontWeight(FontWeight.Bold).fontColor($r('app.color.text_primary')).width('100%')
      Text('手机手动发送 → 眼镜通知模板').fontSize(13).fontColor($r('app.color.text_muted')).width('100%')
      Row(){Column({space:6}){Text('允许眼镜通知').fontSize(18).fontColor($r('app.color.text_primary'));Text('仅提交通知总开关').fontSize(12).fontColor($r('app.color.text_muted'))}.alignItems(HorizontalAlign.Start);Blank();Toggle({type:ToggleType.Switch,isOn:this.notificationEnabled}).selectedColor($r('app.color.brand')).enabled(!this.busy).onChange((v:boolean)=>{if(notifications.busy||notifications.waiting||v===notifications.enabled)return;this.notificationEnabled=v;this.run(()=>notifications.setEnabled(v));})}.width('100%').padding(18).backgroundColor($r('app.color.row_bg')).borderRadius(20)
      if(this.ownerUid){
        Column({space:10}){
          Text('通知仍可能显示，暂不启动其他采集或显示功能。请看镜片，确认通知已收起后再继续。').fontSize(14).fontColor($r('app.color.text_secondary'))
          Button('我已确认通知收起').enabled(!notifications.busy).onClick(()=>{try{notifications.confirmDismissed(this.ownerUid);}catch(error){this.note=(error as Error).message;}})
        }.width('100%').padding(18).backgroundColor($r('app.color.row_bg')).borderRadius(20)
      }
      Column({space:12}){
        Text('手动测试').fontSize(17).fontColor($r('app.color.text_secondary')).width('100%')
        TextInput({text:this.titleText,placeholder:'通知标题，最多 16 字'}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).maxLength(16).backgroundColor($r('app.color.input_bg')).fontColor($r('app.color.text_primary')).onChange((v:string)=>{this.titleText=v;})
        TextArea({text:this.content,placeholder:'正文，最多 48 字'}).maxLength(48).height(110).backgroundColor($r('app.color.input_bg')).fontColor($r('app.color.text_primary')).onChange((v:string)=>{this.content=v;})
        Button('发送到眼镜').height(48).width('100%').backgroundColor($r('app.color.brand')).fontColor($r('app.color.on_brand')).enabled(this.notificationEnabled&&!this.busy).onClick(()=>this.run(()=>notifications.notify(this.titleText,this.content)))
        Text(this.note).fontSize(13).fontColor($r('app.color.text_secondary')).width('100%')
      }.width('100%').padding(18).backgroundColor($r('app.color.row_bg')).borderRadius(20)
      Text('这是独立业务通知，不经过手机系统通知中心。保留眼镜原有来源过滤与停留时长，发送成功不等于镜片已显示。').fontSize(12).fontColor($r('app.color.text_secondary'))
      SuggestionTestPanel()
      Column({space:8}){Text('其他 App 通知转发').fontSize(17).fontColor($r('app.color.text_secondary')).width('100%');Text('尚未启用：需要华为通知订阅权限与证书授权。当前版本不会读取微信或其他 App 的通知，也不展示假的应用白名单。').fontSize(13).fontColor($r('app.color.warm'))}.padding(18).backgroundColor($r('app.color.card_raise')).borderRadius(20).width('100%')
    }.padding(16).width('100%').backgroundColor($r('app.color.input_bg')).borderRadius(22).alignItems(HorizontalAlign.Start)
  }
}
