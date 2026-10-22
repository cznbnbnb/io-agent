import { teleprompter,teleprompterDraft,teleprompterCatalog } from '../TeleprompterService';
import { localWorkspace,WorkspaceEntry } from '../LocalWorkspace';

@Extend(Button)
function chipBtn() {
  .backgroundColor($r('app.color.input_bg'))
  .fontColor($r('app.color.text_primary'))
}


@Component
export struct TeleprompterPanel {
  @Prop connected:boolean=false;
  @State phase:string='idle';@State note:string='';@State progress:number=0;@State readOffset:number=0;
  @State speed:number=120;@State title:string='';@State text:string='';@State busy:boolean=false;
  @State mode:number=2;@State followNote:string='';@State followPackets:number=0;@State matchedOffset:number=0;@State confirmedHighlight:number=0;
  @State asrSource:string='local';
  @State catalogNote:string='';
  @State canConfirmCleanup:boolean=false;
  @State manuscripts:WorkspaceEntry[]=[];
  private visible:boolean=false;
  aboutToAppear():void{this.visible=true;teleprompter.changed=():void=>this.refresh();teleprompterDraft.changed=():void=>this.refresh();teleprompterCatalog.changed=():void=>this.refresh();localWorkspace.changed=():void=>this.refresh();this.refresh();}
  aboutToDisappear():void{this.visible=false;teleprompter.changed=():void=>{};teleprompterDraft.changed=():void=>{};teleprompterCatalog.changed=():void=>{};localWorkspace.changed=():void=>{};}
  private refresh():void{
    if(!this.visible)return;
    if(teleprompterDraft.confirmedSpeed!==teleprompter.speed){teleprompterDraft.confirmedSpeed=teleprompter.speed;teleprompterDraft.speed=teleprompter.speed;}
    this.title=teleprompterDraft.title;this.text=teleprompterDraft.text;this.speed=teleprompterDraft.speed;this.busy=teleprompterDraft.busy;
    this.phase=teleprompter.phase;this.note=teleprompterDraft.note||teleprompter.note;this.progress=teleprompter.progress;this.readOffset=teleprompter.offset;
    this.mode=this.phase==='idle'?teleprompterDraft.mode:teleprompter.mode;this.followNote=teleprompter.followNote;this.followPackets=teleprompter.followPackets;this.matchedOffset=teleprompter.matchedOffset;this.confirmedHighlight=teleprompter.confirmedHighlight;
    this.asrSource=this.phase==='idle'?(teleprompterDraft.asrSource||'local'):teleprompter.asrSource;
    this.catalogNote=teleprompterCatalog.note;
    this.canConfirmCleanup=teleprompter.canConfirmExited;
    this.manuscripts=localWorkspace.entries.filter((e:WorkspaceEntry):boolean=>e.kind==='manuscript');
  }
  private remember():void{teleprompterDraft.title=this.title;teleprompterDraft.text=this.text;teleprompterDraft.speed=this.speed;teleprompterDraft.mode=this.mode;teleprompterDraft.asrSource=this.asrSource;teleprompterDraft.note='';this.note=teleprompter.note;}
  private choose(index:number):void{if(this.phase!=='idle'||this.busy||!Number.isInteger(index)||index<0||index>=this.manuscripts.length)return;this.title=this.manuscripts[index].title;this.text=this.manuscripts[index].text;this.remember();}
  private saveManuscript():void{
    const title=this.title,text=this.text;
    this.run(async():Promise<void>=>{await localWorkspace.manuscript(title,text);teleprompterDraft.note='稿件已保存到本机资料；可从列表重新选择';});
  }
  private run(work:()=>Promise<void>):void{
    if(!this.visible||teleprompterDraft.busy)return;
    this.remember();teleprompterDraft.busy=true;teleprompterDraft.changed();
    work().catch((error:Error):void=>{teleprompterDraft.note=error.message;})
      .finally(():void=>{teleprompterDraft.busy=false;teleprompterDraft.changed();});
  }
  private confirmExit():void {
    const did=teleprompter.cleanupSessionId;
    this.getUIContext().showAlertDialog({title:'确认提词已退出',message:'只有实际看到原眼镜回到时间主界面、没有提词或收音提示时才确认。这是人工确认，不是设备回执。',primaryButton:{value:'尚未退出',action:():void=>{}},secondaryButton:{value:'已回时间页',action:():void=>{
      if(!this.visible)return;
      try{teleprompter.confirmExited(did);teleprompterDraft.note='';}catch(error){teleprompterDraft.note=(error as Error).message;}
      teleprompterDraft.changed();this.refresh();
    }}});
  }
  build(){
    Column({space:16}) {
      Row(){Column({space:6}){Text('把稿件放进视线').fontSize(25).fontWeight(FontWeight.Bold).fontColor($r('app.color.text_primary'));Text(this.mode===1?(this.asrSource==='local'?'本机朗读跟随候选 · 中文识别，音频不外发':'云端朗读跟随候选 · 使用已保存的云转写'):'匀速提词 · 不开启麦克风').fontSize(13).fontColor($r('app.color.text_muted'))}.alignItems(HorizontalAlign.Start);Blank();Text('▤').fontSize(38).fontColor($r('app.color.brand'))}.width('100%')
      Column({space:12}) {
        Select([{value:'匀速滚动'},{value:'本机朗读跟随（候选）'},{value:'云端朗读跟随（候选）'}]).value(this.mode===1?(this.asrSource==='local'?'本机朗读跟随（候选）':'云端朗读跟随（候选）'):'匀速滚动').enabled(!this.busy&&this.phase==='idle').onSelect((index:number)=>{if(this.busy||this.phase!=='idle'||![0,1,2].includes(index))return;this.mode=index===0?2:1;this.asrSource=index===2?'cloud':'local';this.remember();})
        Text('01  选择或粘贴稿件').fontSize(16).fontColor($r('app.color.text_secondary')).width('100%')
        if(this.manuscripts.length){Select(this.manuscripts.map((e:WorkspaceEntry):SelectOption=>({value:e.title}))).value('从我的资料选择').enabled(!this.busy&&this.phase==='idle').fontColor($r('app.color.brand_soft')).onSelect((index:number)=>this.choose(index))}
        TextInput({text:this.title,placeholder:'稿件标题（仅本机记录，不同步眼镜列表）'}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).maxLength(100).enabled(!this.busy&&this.phase==='idle').backgroundColor($r('app.color.input_bg')).fontColor($r('app.color.text_primary')).onChange((v:string)=>{if(v===this.title||this.busy||this.phase!=='idle')return;this.title=v;this.remember();})
        TextArea({text:this.text,placeholder:'粘贴正文；文件请先在「资料」导入 TXT / MD'}).height(200).maxLength(12000).enabled(!this.busy&&this.phase==='idle').backgroundColor($r('app.color.input_bg')).fontColor($r('app.color.text_primary')).onChange((v:string)=>{if(v===this.text||this.busy||this.phase!=='idle')return;this.text=v;this.remember();})
        Row(){Text(`${this.text.length} / 12000 字`).fontSize(12).fontColor($r('app.color.text_muted'));Blank();Button('保存到资料').chipBtn().fontSize(12).enabled(!this.busy&&this.phase==='idle'&&this.text.trim().length>0).onClick(()=>this.saveManuscript())}.width('100%')
      }.padding(18).backgroundColor($r('app.color.row_bg')).borderRadius(20).width('100%')
      Column({space:12}) {
        Row(){Text(this.mode===1?'02  朗读跟随（候选）':'02  匀速滚动').fontSize(16).fontColor($r('app.color.text_secondary'));Blank();Text(this.mode===1?'◉':`${this.speed}`).fontSize(25).fontColor($r('app.color.brand'))}.width('100%')
        Slider({value:this.speed,min:60,max:240,step:10}).enabled(this.mode===2&&!this.busy&&!['preparing','transferring','controlling','closing','error'].includes(this.phase)).selectedColor($r('app.color.brand')).onChange((v:number)=>{this.speed=Math.round(v);this.remember();})
        Text('60 慢速                                    240 快速').fontSize(12).fontColor($r('app.color.text_muted')).width('100%')
        Button('完整传稿 → 等待就绪').width('100%').height(48).backgroundColor($r('app.color.brand')).fontColor($r('app.color.on_brand')).enabled(this.connected&&!this.busy&&this.phase==='idle'&&this.text.trim().length>0).onClick(()=>this.run(()=>teleprompter.prepare(this.text,this.speed,this.mode,this.asrSource,this.title)))
        if(this.phase!=='idle'){
          Progress({value:this.progress,total:100,type:ProgressType.Linear}).color($r('app.color.brand')).width('100%')
          Text(`传输 ${this.progress}% · 阅读偏移 ${this.readOffset} B`).fontSize(12).fontColor($r('app.color.text_muted'))
        }
        if(this.catalogNote){Text(this.catalogNote).fontSize(12).fontColor($r('app.color.text_muted')).width('100%')}
        Text(this.note).fontSize(13).fontColor($r('app.color.text_secondary')).width('100%')
        if(this.mode===1){Text(`${this.followNote} · 音频 ${this.followPackets} 包 · 匹配 ${this.matchedOffset} B / 设备位置回报 ${this.confirmedHighlight} B`).fontSize(12).fontColor($r('app.color.text_muted'));Text('候选尚未完成镜片验收；转写中断会请求暂停。退出或切后台会停止本机处理并请求眼镜退出，不在本机保存这份语音。').fontSize(12).fontColor($r('app.color.warm'))}
      }.padding(18).backgroundColor($r('app.color.row_bg')).borderRadius(20).width('100%')
      Row({space:8}){
        Button('开始').chipBtn().layoutWeight(1).enabled(!this.busy&&this.phase==='ready').onClick(()=>this.run(()=>teleprompter.control(3)))
        Button(this.phase==='paused'?'继续':'暂停').chipBtn().layoutWeight(1).enabled(!this.busy&&['running','paused'].includes(this.phase)).onClick(()=>this.run(()=>teleprompter.control(this.phase==='paused'?5:4)))
        Button('调速').chipBtn().layoutWeight(1).enabled(this.mode===2&&!this.busy&&['ready','running','paused'].includes(this.phase)).onClick(()=>this.run(()=>teleprompter.control(7,this.speed)))
      }.width('100%')
      if(this.phase!=='idle'){Button(this.phase==='cleanup'?'清理上次提词退出':'退出提词器').width('100%').backgroundColor($r('app.color.danger_bg')).enabled(!this.busy&&this.connected&&this.phase!=='closing').onClick(()=>this.run(()=>teleprompter.stop()))}
      if(this.canConfirmCleanup){Button('我已确认提词退出').chipBtn().width('100%').enabled(!this.busy).onClick(()=>this.confirmExit())}
      Text('切换页面保留本次稿件和提词；未保存稿件仅保留至应用进程结束。退到后台会请求退出，如连接中断，请用眼镜实体按钮退出。完整收稿需要两项设备确认，镜片显示另行验收。标题暂仅保存在手机，眼镜目录同步仍待修复。').fontSize(12).fontColor($r('app.color.warm'))
    }.padding(16).width('100%').backgroundColor($r('app.color.input_bg')).borderRadius(22).alignItems(HorizontalAlign.Start)
  }
}
