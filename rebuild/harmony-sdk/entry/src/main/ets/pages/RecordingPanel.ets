// 录音：只管"在眼镜上录音"这条链路（开始/停止/导出/云端转写）。
// 全天智记与日历化的历史记录在「智记」页，两者历史在那里合并展示。
import { common } from '@kit.AbilityKit';
import { fileIo as fs,picker } from '@kit.CoreFileKit';
import { RecordingItem } from '../RecordingSession';
import { recordings, materials, localPlayback, enqueueLocalTranscribe, transcribeRecordingCloud, cancelRecordingCloudTranscription, localTranscriptionState, localMaterialRevision, localMaterialExportPath } from '../RecordingService';
import { MaterialRevision,MaterialUtterance } from '../MaterialStore';
import { PlaybackSelection } from '../LocalAudioSource';
import { PlaybackSnapshot } from '../PlaybackController';
import { MaterialSpeakerEditor } from './MaterialSpeakerEditor';
import { RecordingSummaryPanel } from './RecordingSummaryPanel';
import { LocalMaterialReference } from '../MaterialLocalQuery';
import { recordingSummaryReference } from '../RecordingSummaryPlan';
import { SecureServiceConfig } from '../RemoteServices';

@Extend(Button)
function chipBtn() {
  .backgroundColor($r('app.color.input_bg'))
  .fontColor($r('app.color.text_primary'))
}


@Component
export struct RecordingPanel {
  @Prop connected:boolean=false;
  @State note:string='';@State receiverEnabled:boolean=false;@State active:boolean=false;
  @State busy:boolean=false;@State bytes:number=0;@State items:RecordingItem[]=[];
  @State starting:boolean=false;
  @State stopping:boolean=false;@State localRevision:number=0;
  @State cleanupRequired:boolean=false;@State canConfirmCleanup:boolean=false;@State pendingWrites:boolean=false;
  @State transcript:string='';
  @State textName:string='';@State fullText:boolean=false;@State textRevision:number=0;
  @State summaryReference:LocalMaterialReference|undefined=undefined;
  @State playback:PlaybackSnapshot=new PlaybackSnapshot();
  private playbackUnsubscribe:()=>void=():void=>{};
  private visible:boolean=false;
  private actionEpoch:number=0;

  aboutToAppear():void{
    this.visible=true;++this.actionEpoch;this.busy=false;
    this.playbackUnsubscribe();this.playback=localPlayback.snapshot();const epoch=this.actionEpoch;
    this.playbackUnsubscribe=localPlayback.subscribe((value:PlaybackSnapshot):void=>{if(this.visible&&epoch===this.actionEpoch)this.playback=value;});
    recordings.changed=():void=>this.refresh();recordings.refresh();this.refresh();
  }
  aboutToDisappear():void{this.visible=false;++this.actionEpoch;this.busy=false;this.playbackUnsubscribe();void localPlayback.suspend('page_leave').catch(():void=>{});recordings.changed=():void=>{};cancelRecordingCloudTranscription();}

  private refresh():void{if(!this.visible)return;this.note=recordings.note;this.receiverEnabled=recordings.enabled;this.active=recordings.active;this.starting=recordings.starting;this.stopping=recordings.stopping;this.bytes=recordings.bytes;this.items=[...recordings.items];this.cleanupRequired=recordings.cleanupRequired;this.canConfirmCleanup=recordings.canConfirmExited;this.pendingWrites=recordings.pendingWrites;this.localRevision++;}
  private confirmRecordingExit():void{
    const id=recordings.cleanupSessionId,epoch=this.actionEpoch;
    this.getUIContext().showAlertDialog({title:'确认录音已退出',message:'只有实际看到原眼镜已退出录音、没有收音提示时才确认。这是人工确认，不会把未完整封口的原音标为完整。',primaryButton:{value:'尚未退出',action:():void=>{}},secondaryButton:{value:'已退出录音',action:():void=>{
      if(!this.visible||epoch!==this.actionEpoch)return;
      try{recordings.confirmExited(id);}catch(error){this.note=(error as Error).message;}this.refresh();
    }}});
  }
  private localState(item:RecordingItem):string{const revision=this.localRevision;return localTranscriptionState(recordings.directoryOf(item));}
  private retryLocal(item:RecordingItem):void{
    try{enqueueLocalTranscribe(recordings.directoryOf(item),recordings.file(item,false),item.created,'recording',true);this.refresh();}
    catch(error){this.note=(error as Error).message;}
  }
  private viewText(item:RecordingItem):void{
    try{const row=localMaterialRevision('recording',item.name);this.transcript=row.text||(!row.user_edited?fs.readTextSync(recordings.textPath(item)):'');this.textName=item.name;this.fullText=false;this.textRevision=row.revision;
      try{this.summaryReference=recordingSummaryReference(row);}catch(_){this.summaryReference=undefined;}}
    catch(_){this.transcript='';this.textName='';this.summaryReference=undefined;this.note='转写文字或资料来源暂不可读，请刷新后核对';}
  }
  private selectedMaterialChanged(row:MaterialRevision):void{
    this.transcript=row.text;this.textRevision=row.revision;
    try{this.summaryReference=recordingSummaryReference(row);}catch(_){this.summaryReference=undefined;}
    const current=localPlayback.snapshot().source;
    if(current&&current.kind===row.source.kind&&current.name===row.source.name&&
      (row.operation==='delete'||current.revision>0&&current.revision!==row.revision))void localPlayback.stopSource(current.kind,current.name).catch(():void=>{});
  }
  private closeText():void{
    if(this.textName)void localPlayback.stopSource('recording',this.textName).catch(():void=>{});
    this.transcript='';this.textName='';this.textRevision=0;this.fullText=false;this.summaryReference=undefined;
  }
  private playAudio(kind:string,name:string,revision:number=0,utteranceId:string=''):void{
    if(!this.visible)return;const epoch=this.actionEpoch,selection=new PlaybackSelection();
    selection.kind=kind;selection.name=name;selection.revision=revision;selection.utterance_id=utteranceId;
    localPlayback.play(selection).then(():void=>{if(this.visible&&epoch===this.actionEpoch)this.playback=localPlayback.snapshot();})
      .catch((error:Error):void=>{if(this.visible&&epoch===this.actionEpoch)this.note=this.playbackError(error.message);});
  }
  private playSentence(part:MaterialUtterance,row:MaterialRevision):void{
    if(part.start_ms===null||part.end_ms===null||!Number.isSafeInteger(part.start_ms)||!Number.isSafeInteger(part.end_ms)||part.start_ms<0||part.end_ms<part.start_ms)return;
    this.playAudio(row.source.kind,row.source.name,row.revision,part.utterance_id);
  }
  private controlPlayback(action:string,delta:number=0):void{
    if(!this.visible||!this.playback.session_id)return;const epoch=this.actionEpoch,current=this.playback;
    let pending:Promise<PlaybackSnapshot>;
    if(action==='pause')pending=localPlayback.pause(current.session_id);
    else if(action==='resume')pending=localPlayback.resume(current.session_id);
    else if(action==='stop')pending=localPlayback.stop(current.session_id);
    else{if(!current.position_known||!current.duration_known)return;pending=localPlayback.seek(current.session_id,Math.max(0,Math.min(current.duration_ms,current.position_ms+delta)));}
    pending.then(():void=>{if(this.visible&&epoch===this.actionEpoch)this.playback=localPlayback.snapshot();})
      .catch((error:Error):void=>{if(this.visible&&epoch===this.actionEpoch)this.note=this.playbackError(error.message);});
  }
  private playbackError(code:string):string{
    if(code==='PLAYBACK_SOURCE_UNAVAILABLE')return '原音或来源暂不可读取，文字和导出入口仍保留';
    if(code==='PLAYBACK_INCOMPLETE')return '原音尚未完整封口或完整性不符，暂不能回放';
    if(code==='PLAYBACK_SOURCE_CHANGED')return '所选原音或来源已变化，请刷新后重新选择';
    if(code==='PLAYBACK_DELETED')return '这份资料已删除，不能回放旧原音';
    if(code==='PLAYBACK_ANCHOR_STALE')return '文字修订或原句已变化，请重新打开当前资料';
    if(code==='PLAYBACK_TIME_UNKNOWN')return '原句时间未确定，不能定位起点';
    if(code==='PLAYBACK_CLEANUP_PENDING')return '上一次播放尚未停止，请点停止后再试';
    return '播放状态已变化或原音暂不能播放，请核对播放区后重试';
  }
  private playbackTime(value:number):string{
    const seconds=Math.floor(Math.max(0,value)/1000);return Math.floor(seconds/60).toString().padStart(2,'0')+':'+(seconds%60).toString().padStart(2,'0');
  }
  private playbackLabel():string{
    if(this.playback.phase==='playing')return '播放中';if(this.playback.phase==='paused')return '已暂停';if(this.playback.phase==='ended')return '播放结束';
    if(this.playback.phase==='loading')return '准备原音';if(this.playback.phase==='seeking')return '定位中';if(this.playback.phase==='stopping')return '正在停止';
    if(this.playback.phase==='blocked'||this.playback.phase==='error')return '播放需处理';return '已停止';
  }
  private hasText(item:RecordingItem):boolean{try{return !!item.textFile||!!materials.read(materials.idFor('recording',item.name))?.text.trim();}catch(_){return !!item.textFile;}}
  private stamp(ms:number):string{const d=new Date(ms);const p=(n:number):string=>n<10?'0'+n:''+n;return `${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;}
  private sizeText(bytes:number):string{return bytes>=1048576?`${(bytes/1048576).toFixed(1)}M`:`${Math.round(bytes/1024)}K`;}
  private run(action:()=>Promise<void>,preserveNote:boolean=false):void{
    if(this.busy||!this.visible)return;this.busy=true;this.note='正在处理…';const epoch=this.actionEpoch;
    action().then(():void=>{if(this.visible&&epoch===this.actionEpoch){if(!preserveNote)this.note=recordings.note;this.getUIContext().getPromptAction().showToast({message:this.note,duration:3000});}})
      .catch((error:Error):void=>{if(this.visible&&epoch===this.actionEpoch){this.note=error.message;this.getUIContext().getPromptAction().showToast({message:this.note,duration:4000});}})
      .finally(():void=>{if(this.visible&&epoch===this.actionEpoch)this.busy=false;});
  }
  private async copyOut(source:string,newName:string):Promise<boolean>{
    const context=this.getUIContext().getHostContext() as common.UIAbilityContext;
    const uris=await new picker.DocumentViewPicker(context).save({newFileNames:[newName]});if(!uris.length)return false;
    const input=fs.openSync(source,fs.OpenMode.READ_ONLY);let output:fs.File|undefined=undefined;
    try{
      output=fs.openSync(uris[0],fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
      const length=fs.statSync(input.fd).size;let offset=0;
      while(offset<length){
        const part=new ArrayBuffer(Math.min(262144,length-offset));
        const n=fs.readSync(input.fd,part,{length:part.byteLength});if(n<=0)throw new Error('源文件读取不完整');
        let written=0;while(written<n){const count=fs.writeSync(output.fd,part.slice(written,n));if(count<=0)throw new Error('导出写入不完整');written+=count;}
        offset+=n;await new Promise<void>((resolve:()=>void)=>{setTimeout(resolve,0);});
      }
      fs.fsyncSync(output.fd);
    }finally{fs.closeSync(input);if(output)fs.closeSync(output);}
    return true;
  }
  private async exportFile(item:RecordingItem,wav:boolean,text:boolean=false):Promise<void>{
    const source=text?(localMaterialRevision('recording',item.name).text?localMaterialExportPath('recording',item.name):recordings.textPath(item)):recordings.file(item,wav);
    const ok=await this.copyOut(source,`TurboIO-录音-${item.created}.${text?'md':wav?'wav':'rawopus'}`);if(!ok)return;
    if(this.visible)this.note='已保存到选择的位置；App 中原件保留';
  }
  private confirmTranscription(item:RecordingItem):void{
    const epoch=this.actionEpoch;
    this.getUIContext().showAlertDialog({title:'上传这条录音进行转写？',message:'只上传你选中的录音到本机配置的阿里 ASR（云端）。已保存结果优先恢复；若上次识别结果未保存，继续会重新上传所选录音并识别。原始录音保留，双声道会合并为单声道；请保持应用前台，离开本页或退到后台即取消。',
      primaryButton:{value:'取消',action:():void=>{}},secondaryButton:{value:'开始转写',action:():void=>{
        if(!this.visible||epoch!==this.actionEpoch)return;
        this.run(async():Promise<void>=>{
          const config=await new SecureServiceConfig().load();if(!this.visible||epoch!==this.actionEpoch)return;
          const note=await transcribeRecordingCloud(item,config,true);if(!this.visible||epoch!==this.actionEpoch)return;
          this.refresh();if(this.textName===item.name)this.viewText(item);this.note=note;
        },true);
      }}});
  }
  private exportSelected(format:string):void{
    if(!this.textName)return;this.run(async():Promise<void>=>{
      const path=localMaterialExportPath('recording',this.textName,format),ok=await this.copyOut(path,'TurboIO-'+this.textName+'.'+format);
      if(ok)this.note='已导出当前资料修订';
    },true);
  }
  private clearDeletedSelection(name:string):void{
    if(this.textName!==name)return;
    try{
      const material=materials.read(materials.idFor('recording',name));
      if(!material||material.operation!=='delete')return;
    }catch(_){return;}
    this.transcript='';this.textName='';this.textRevision=0;this.fullText=false;this.summaryReference=undefined;
  }
  private confirmRemove(item:RecordingItem):void{
    if(!this.visible||this.busy||recordings.active)return;
    const epoch=this.actionEpoch,name=item.name;
    this.getUIContext().showAlertDialog({title:'删除这条录音？',message:'从记录列表移除，并清理本机录音文件；原音清理不可恢复。历史文字修订保留用于同步核对。开启同步后发送删除标记，云端删除以服务器确认结果为准。',
      primaryButton:{value:'取消',action:():void=>{}},secondaryButton:{value:'删除',action:():void=>{
        if(!this.visible||epoch!==this.actionEpoch)return;
        this.run(async():Promise<void>=>{
          if(recordings.active)throw new Error('请先停止录音再删除');
          await localPlayback.stopSource('recording',name);
          if(!this.visible||epoch!==this.actionEpoch)return;
          if(recordings.active)throw new Error('请先停止录音再删除');
          if(item.name!==name||!recordings.items.some((saved:RecordingItem):boolean=>saved.name===name))throw new Error('录音条目已变化，请刷新后重试');
          try{recordings.remove(item);}
          finally{if(this.visible&&epoch===this.actionEpoch)this.clearDeletedSelection(name);}
        });
      }}});
  }

  @Builder
  playbackArea(){
    if(this.playback.session_id||this.playback.phase!=='idle'){Column({space:6}){
      Text('原音回放 · '+this.playbackLabel()).fontSize(12).fontColor($r('app.color.text_primary')).width('100%')
      Text((this.playback.position_known?this.playbackTime(this.playback.position_ms):'位置未知')+' / '+(this.playback.duration_known?this.playbackTime(this.playback.duration_ms):'时长待确认')).fontSize(11).fontColor($r('app.color.text_secondary'))
      Row({space:6}){
        Button('−15秒').chipBtn().fontSize(11).height(28).enabled(this.playback.position_known&&this.playback.duration_known&&['playing','paused'].includes(this.playback.phase)).onClick(()=>this.controlPlayback('seek',-15000))
        if(this.playback.phase==='playing'){Button('暂停').chipBtn().fontSize(11).height(28).onClick(()=>this.controlPlayback('pause'))}
        else{Button('继续').chipBtn().fontSize(11).height(28).enabled(this.playback.phase==='paused').onClick(()=>this.controlPlayback('resume'))}
        Button('+15秒').chipBtn().fontSize(11).height(28).enabled(this.playback.position_known&&this.playback.duration_known&&['playing','paused'].includes(this.playback.phase)).onClick(()=>this.controlPlayback('seek',15000))
        Button('停止').chipBtn().fontSize(11).height(28).enabled(!!this.playback.session_id).onClick(()=>this.controlPlayback('stop'))
      }.width('100%')
      if(this.playback.note){Text(this.playback.note).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')}
    }.width('100%').padding(10).backgroundColor($r('app.color.row_bg')).borderRadius(12)}
  }

  build(){
    Column({space:10}){
      Row(){Text('录音').fontSize(17).fontColor($r('app.color.text_primary'));Blank()
        Text(this.stopping?'◌ 正在收尾':this.starting?'◌ 等待确认':this.active?'● 录音中':'○ 待命').fontSize(12).fontColor(this.active?$r('app.color.brand'):$r('app.color.text_secondary'))
        Text(`${Math.round(this.bytes/1024)} KB`).fontSize(12).fontColor($r('app.color.text_muted')).margin({left:10})
      }.width('100%')
      Text(this.note).fontSize(12).fontColor($r('app.color.text_secondary')).width('100%').maxLines(2)
      Row({space:8}){
        Button(this.receiverEnabled?'关闭接收':'开启接收').chipBtn().fontSize(12).height(34).layoutWeight(1).enabled(!this.busy&&!this.active&&!this.cleanupRequired&&!this.pendingWrites).onClick(()=>this.run(()=>recordings.enable(!this.receiverEnabled)))
        if(!this.active){Button('在眼镜开始录音').fontSize(12).height(34).layoutWeight(1).backgroundColor($r('app.color.brand')).fontColor($r('app.color.on_brand')).enabled(!this.busy&&this.connected&&!this.cleanupRequired&&!this.pendingWrites).onClick(()=>this.run(()=>recordings.start()))}
        else{Button(this.stopping?'收尾中，请稍候':this.starting?'取消请求':'停止并保存').fontSize(12).height(34).layoutWeight(1).backgroundColor($r('app.color.danger_bg')).enabled(!this.busy&&!this.stopping).onClick(()=>this.run(()=>recordings.stop()))}
      }.width('100%')
      if(this.cleanupRequired&&!this.active){Button('清理上次录音退出').chipBtn().width('100%').enabled(!this.busy&&this.connected&&!this.pendingWrites).onClick(()=>this.run(()=>recordings.stop()))}
      if(this.canConfirmCleanup){Button('我已确认录音退出').chipBtn().width('100%').enabled(!this.busy&&!this.pendingWrites).onClick(()=>this.confirmRecordingExit())}
      Text('可从手机或眼镜开始录音，无需关闭智记。确认眼镜退出后才恢复智记；未确认时保留清理记录。录音原件持续保留，直到你主动删除。').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
      this.playbackArea()
      if(this.transcript){Column({space:6}){
        Row(){Text('最近转写').fontSize(11).fontColor($r('app.color.text_muted'));Blank();
          Button(this.fullText?'折叠全文':'展开全文').chipBtn().fontSize(11).height(24).onClick(()=>{this.fullText=!this.fullText;})
          Button('收起').chipBtn().fontSize(11).height(24).padding({left:8,right:8}).onClick(()=>this.closeText())
        }.width('100%')
        if(this.fullText){Text(this.transcript).fontColor($r('app.color.text_secondary')).fontSize(12).copyOption(CopyOptions.LocalDevice).width('100%')}
        else{Text(this.transcript).fontColor($r('app.color.text_secondary')).fontSize(12).copyOption(CopyOptions.LocalDevice).width('100%').maxLines(14).textOverflow({overflow:TextOverflow.Ellipsis})}
        if(this.textName){
          Row({space:8}){
            Button('导出MD').chipBtn().fontSize(11).height(26).enabled(!this.busy).onClick(()=>this.exportSelected('md'))
            Button('导出JSON').chipBtn().fontSize(11).height(26).enabled(!this.busy).onClick(()=>this.exportSelected('json'))
          }.width('100%')
          MaterialSpeakerEditor({kind:'recording',name:this.textName,revision:this.textRevision,onChanged:(row:MaterialRevision):void=>this.selectedMaterialChanged(row),onPlay:(part:MaterialUtterance,row:MaterialRevision):void=>this.playSentence(part,row)})
          if(this.summaryReference){RecordingSummaryPanel({reference:this.summaryReference})}
        }
      }.width('100%').padding(10).backgroundColor($r('app.color.row_bg')).borderRadius(12)}
      Row(){Text('本机录音').fontSize(15).fontColor($r('app.color.text_primary'));Blank()
        Button('刷新').chipBtn().fontSize(11).height(28).enabled(!this.active&&!this.busy).onClick(()=>{try{recordings.refresh();}catch(_){this.note='录音目录暂不可读取';}})}.width('100%')
      if(!this.items.length){Text('暂无录音').fontColor($r('app.color.text_muted')).fontSize(12).padding(10)}
      ForEach(this.items,(item:RecordingItem)=>{
        Row({space:6}){
          Text(this.stamp(item.created)).fontSize(12).fontColor($r('app.color.text_primary'))
          Text(`${this.sizeText(item.bytes)} · ${this.localState(item)||(item.textFile?'已完成本机转写':item.note)}`).fontSize(11).fontColor(item.complete?$r('app.color.brand'):$r('app.color.warm')).layoutWeight(1).maxLines(2).textOverflow({overflow:TextOverflow.Ellipsis})
          Button('播放').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(item.complete&&!this.busy).onClick(()=>this.playAudio('recording',item.name))
          Button('WAV').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(item.complete&&!this.busy&&!this.active).onClick(()=>this.run(async():Promise<void>=>{await this.exportFile(item,true);}))
          Button('原件').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(item.rawAvailable&&!this.busy&&!this.active).onClick(()=>this.run(async():Promise<void>=>{await this.exportFile(item,false);}))
          if(!this.hasText(item)){Button('本机转写').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(item.complete&&!this.busy&&!this.localState(item).includes('%')&&!this.localState(item).includes('等待')).onClick(()=>this.retryLocal(item))}
          else{
            Button('查看文字').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(!this.busy).onClick(()=>this.viewText(item))
            Button('MD').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(!this.busy&&!this.active).onClick(()=>this.run(async():Promise<void>=>{await this.exportFile(item,false,true);}))
          }
          Button('删').fontSize(11).height(26).padding({left:8,right:8}).backgroundColor($r('app.color.danger_bg')).enabled(!this.busy&&!this.active).onClick(()=>this.confirmRemove(item))
        }.padding({left:10,right:6,top:4,bottom:4}).backgroundColor($r('app.color.row_bg_soft')).borderRadius(10).width('100%')
      },(item:RecordingItem)=>item.name)
    }.padding(16).width('100%').backgroundColor($r('app.color.input_bg_soft')).borderRadius(22).alignItems(HorizontalAlign.Start)
  }
}
