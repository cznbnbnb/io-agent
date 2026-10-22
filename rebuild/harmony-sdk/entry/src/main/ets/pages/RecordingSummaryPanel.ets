import { common } from '@kit.AbilityKit';
import { fileIo as fs,picker } from '@kit.CoreFileKit';
import { LocalMaterialReference } from '../MaterialLocalQuery';
import { RecordingSummaryView,newRecordingSummaryId,sameRecordingSummaryReference } from '../RecordingSummary';
import { RecordingSummaryEntry,RecordingSummaryPiece } from '../RecordingSummaryPlan';
import { recordingSummaries,localPlayback } from '../RecordingService';
import { probeSession } from '../ProbeSession';
import { PlaybackSelection } from '../LocalAudioSource';

@Component
export struct RecordingSummaryPanel {
  @Prop @Watch('referenceChanged') reference:LocalMaterialReference=new LocalMaterialReference();
  @State view:RecordingSummaryView|undefined=undefined;
  @State versions:RecordingSummaryView[]=[];
  @State note:string='';@State busy:boolean=false;@State incomplete:boolean=false;
  @State expanded:string[]=[];
  @State citation:RecordingSummaryPiece|undefined=undefined;
  @State hasMore:boolean=false;
  private versionsCursor:string='';private nextCursor:string='';
  private visible:boolean=false;private epoch:number=0;private selectedJob:string='';
  private shownReference:LocalMaterialReference|undefined=undefined;
  private unsubscribe:()=>void=():void=>{};

  aboutToAppear():void{
    this.visible=true;++this.epoch;this.busy=false;this.shownReference=JSON.parse(JSON.stringify(this.reference)) as LocalMaterialReference;
    this.unsubscribe();const epoch=this.epoch;
    this.unsubscribe=recordingSummaries.subscribe(():void=>{if(this.visible&&this.epoch===epoch)this.refresh();});
    this.refresh();
  }
  aboutToDisappear():void{
    this.visible=false;++this.epoch;this.busy=false;this.unsubscribe();recordingSummaries.suspend();
    this.view=undefined;this.citation=undefined;this.selectedJob='';this.versions=[];this.versionsCursor='';this.nextCursor='';this.hasMore=false;
  }
  private referenceChanged():void{
    if(this.shownReference&&sameRecordingSummaryReference(this.shownReference,this.reference))return;
    this.shownReference=JSON.parse(JSON.stringify(this.reference)) as LocalMaterialReference;
    ++this.epoch;this.busy=false;this.view=undefined;this.citation=undefined;this.selectedJob='';this.expanded=[];this.versions=[];this.note='';this.versionsCursor='';this.nextCursor='';this.hasMore=false;
    if(!this.visible)return;
    recordingSummaries.suspend();this.unsubscribe();const epoch=this.epoch;
    this.unsubscribe=recordingSummaries.subscribe(():void=>{if(this.visible&&epoch===this.epoch)this.refresh();});this.refresh();
  }
  private current(epoch:number,reference:LocalMaterialReference):boolean{
    return this.visible&&epoch===this.epoch&&probeSession.foreground&&sameRecordingSummaryReference(reference,this.reference);
  }
  private loadVersions(cursor:string=''):void{
    if(!this.visible)return;
    const page=recordingSummaries.list(this.reference.material_id,10,cursor);this.versions=page.items;this.incomplete=page.incomplete;
    this.versionsCursor=cursor;this.nextCursor=page.next_cursor;this.hasMore=page.has_more;
  }
  private nextVersions():void{
    if(!this.visible||this.busy||!this.hasMore||!this.nextCursor)return;
    try{this.loadVersions(this.nextCursor);}catch(_){this.versions=[];this.nextCursor='';this.hasMore=false;this.note='总结目录已变化，请返回首批重新核对';}
  }
  private refresh():void{
    if(!this.visible)return;
    try{
      this.loadVersions(this.versionsCursor);
      if(this.selectedJob){
        const value=recordingSummaries.status(this.selectedJob);
        this.view=sameRecordingSummaryReference(value.source,this.reference)?value:undefined;
        if(!this.view||this.view.phase!=='ready'||!recordingSummaries.isCurrent(this.view.job_id,this.view.state_sha256))this.citation=undefined;
      }
    }catch(_){this.view=undefined;this.citation=undefined;this.versions=[];this.incomplete=true;this.note='总结目录或来源暂不可读，原音与转写保留';}
  }
  private errorText(code:string):string{
    if(code.includes('STALE')||code.includes('SOURCE_CHANGED')||code.includes('DELETED')||code.includes('CONFLICT'))return '原文、总结版本或处理状态已变化，请重新选择；已有进度保留';
    if(code.includes('BUDGET')||code.includes('LIMIT'))return '已达到本次处理上限；已有进度保留，请核对后再决定';
    if(code.includes('CONFIG')||code.includes('KEY'))return '请先在设置中核对已配置的总结模型';
    if(code.includes('LIFETIME')||code.includes('FOREGROUND')||code.includes('CANCEL'))return '处理已停止，已有进度保留；回到前台后可明确恢复';
    return '本次处理尚未确认完成；请核对保存状态，原音与转写保留';
  }
  private run(action:()=>Promise<void>):void{
    if(!this.visible||this.busy||!probeSession.foreground)return;
    const epoch=this.epoch,reference=JSON.parse(JSON.stringify(this.reference)) as LocalMaterialReference;this.busy=true;
    action().catch((error:Error):void=>{if(this.current(epoch,reference)){this.note=this.errorText(error.message);this.refresh();}})
      .finally(():void=>{if(this.visible&&epoch===this.epoch&&sameRecordingSummaryReference(reference,this.reference))this.busy=false;});
  }
  private confirmGenerate():void{
    if(!this.visible||this.busy||!probeSession.foreground)return;
    const epoch=this.epoch,reference=JSON.parse(JSON.stringify(this.reference)) as LocalMaterialReference;
    try{
      const preview=recordingSummaries.preview(reference);
      this.getUIContext().showAlertDialog({title:'生成这条录音的总结？',
        message:'仅把当前修订的转写文字发送到已配置的总结模型，不上传原音。约'+preview.text_units+'字，分为'+preview.pieces+'个原文片段、'+preview.leaf_count+'组处理；长文分层整理，最多'+preview.max_calls+'次请求（含明确重试）。仅覆盖已保存文字，不能证明录音或转写完整。离开或退到后台会停止，进度保留，可明确恢复。',
        primaryButton:{value:'取消',action:():void=>{}},secondaryButton:{value:'开始生成',action:():void=>{
          if(!this.current(epoch,reference))return;
          this.run(async():Promise<void>=>{
            recordingSummaries.preview(reference);if(!this.current(epoch,reference))return;
            const id=newRecordingSummaryId();this.selectedJob=id;this.citation=undefined;this.expanded=[];
            const result=await recordingSummaries.start(id,reference);
            if(!this.current(epoch,reference))return;this.view=result;this.refresh();
          });
        }}});
    }catch(error){this.note=this.errorText((error as Error).message);}
  }
  private openVersion(item:RecordingSummaryView):void{
    if(!this.visible||this.busy)return;
    try{
      const value=recordingSummaries.status(item.job_id);
      if(!sameRecordingSummaryReference(value.source,this.reference)){this.note='这个版本的原文已变化，请用当前文字重新生成';this.view=undefined;this.citation=undefined;return;}
      this.selectedJob=value.job_id;this.view=value;this.citation=undefined;this.expanded=[];this.note='';
    }catch(error){this.view=undefined;this.citation=undefined;this.note=this.errorText((error as Error).message);}
  }
  private pauseGeneration():void{
    if(!this.visible||this.busy||!this.view)return;
    try{const value=recordingSummaries.cancel(this.view.job_id,this.view.state_sha256);this.view=value;this.citation=undefined;this.note='已请求停止，保存的进度保留；恢复需要再次确认';this.refresh();}
    catch(error){this.note=this.errorText((error as Error).message);this.refresh();}
  }
  private confirmResume():void{
    if(!this.visible||this.busy||!this.view?.can_resume||!probeSession.foreground)return;
    const value=this.view,epoch=this.epoch,reference=JSON.parse(JSON.stringify(this.reference)) as LocalMaterialReference;
    this.getUIContext().showAlertDialog({title:'恢复这个总结？',message:'从已保存检查点继续向已配置模型发送当前原文或中间结果。已有请求计入上限，最多30次；不会从头自动重试。',
      primaryButton:{value:'取消',action:():void=>{}},secondaryButton:{value:'明确恢复',action:():void=>{
        if(!this.current(epoch,reference)||this.view?.job_id!==value.job_id||this.view.state_sha256!==value.state_sha256)return;
        this.run(async():Promise<void>=>{const result=await recordingSummaries.resume(value.job_id,value.state_sha256);if(this.current(epoch,reference)){this.view=result;this.citation=undefined;this.refresh();}});
      }}});
  }
  private phaseText(phase:string):string{
    if(phase==='ready')return '已保存';if(phase==='running')return '正在生成';if(phase==='queued')return '已保存请求，等待处理';
    if(phase==='paused'||phase==='resumable')return '已暂停，可核对后恢复';if(phase==='stale')return '原文已变化，需重新生成';
    if(phase==='blocked')return '来源或处理条件暂不可用';if(phase==='missing')return '未找到保存记录';return '尚未完成，请核对状态';
  }
  private stamp(iso:string):string{
    const date=new Date(iso);if(!iso||!Number.isFinite(date.getTime()))return '生成时间未确定';
    const two=(n:number):string=>n.toString().padStart(2,'0');
    return date.getFullYear()+'-'+two(date.getMonth()+1)+'-'+two(date.getDate())+' '+two(date.getHours())+':'+two(date.getMinutes())+':'+two(date.getSeconds());
  }
  private categoryText(category:string):string{
    if(category==='fact')return '事实回顾';if(category==='todo')return '待办候选';if(category==='question')return '待确认问题';return '建议';
  }
  private categoryEntries(category:string):RecordingSummaryEntry[]{return this.view?.phase==='ready'?this.view.entries.filter((entry:RecordingSummaryEntry):boolean=>entry.category===category):[];}
  private toggleCategory(category:string):void{this.expanded=this.expanded.includes(category)?this.expanded.filter((value:string):boolean=>value!==category):[...this.expanded,category];}
  private showCitation(id:string):void{
    if(!this.visible||!this.view||this.view.phase!=='ready')return;
    try{
      if(!recordingSummaries.isCurrent(this.view.job_id,this.view.state_sha256))throw new Error('SUMMARY_STALE');
      this.citation=recordingSummaries.citation(this.view.job_id,id);this.note='原文引用来自当前资料，不是模型复述';
    }catch(error){this.citation=undefined;this.note=this.errorText((error as Error).message);this.refresh();}
  }
  private citationPlayable():boolean{
    const part=this.citation;return !!part&&part.text_field==='utterance'&&part.start_ms!==null&&part.end_ms!==null&&
      Number.isSafeInteger(part.start_ms)&&Number.isSafeInteger(part.end_ms)&&part.start_ms>=0&&part.end_ms>=part.start_ms;
  }
  private playCitation():void{
    if(!this.visible||!this.view||!this.citation||!this.citationPlayable()||!probeSession.foreground)return;
    const epoch=this.epoch,reference=JSON.parse(JSON.stringify(this.reference)) as LocalMaterialReference,value=this.view,id=this.citation.id;
    try{
      if(!recordingSummaries.isCurrent(value.job_id,value.state_sha256))throw new Error('SUMMARY_STALE');
      const part=recordingSummaries.citation(value.job_id,id);
      if(part.text_field!=='utterance'||part.start_ms===null||part.end_ms===null||!Number.isSafeInteger(part.start_ms)||!Number.isSafeInteger(part.end_ms)||part.start_ms<0||part.end_ms<part.start_ms)throw new Error('PLAYBACK_TIME_UNKNOWN');
      const selection=new PlaybackSelection();selection.kind='recording';
      selection.name=part.reference.material_id.replace(/^mat-recording-/,'take-');selection.revision=part.reference.revision;selection.utterance_id=part.reference.utterance_id;
      localPlayback.play(selection).catch(():void=>{if(this.current(epoch,reference))this.note='原音暂不能定位或回放，原文引用仍保留';});
    }catch(error){this.citation=undefined;this.note=this.errorText((error as Error).message);this.refresh();}
  }
  private async exportSummary(format:string):Promise<void>{
    if(!this.view||this.view.phase!=='ready')return;
    const value=this.view,epoch=this.epoch,reference=JSON.parse(JSON.stringify(this.reference)) as LocalMaterialReference;
    const current=():boolean=>this.current(epoch,reference)&&this.view?.job_id===value.job_id&&this.view.state_sha256===value.state_sha256&&recordingSummaries.isCurrent(value.job_id,value.state_sha256);
    if(!current())throw new Error('SUMMARY_STALE');
    const source=recordingSummaries.exportPath(value.job_id,value.state_sha256,format);
    const context=this.getUIContext().getHostContext() as common.UIAbilityContext;
    const uris=await new picker.DocumentViewPicker(context).save({newFileNames:['TurboIO-录音总结-'+value.job_id+'.'+format]});
    if(!uris.length){if(this.current(epoch,reference))this.note='已取消导出，本机总结保留';return;}
    if(!current()||recordingSummaries.exportPath(value.job_id,value.state_sha256,format)!==source)throw new Error('SUMMARY_STALE');
    const input=fs.openSync(source,fs.OpenMode.READ_ONLY);let output:fs.File|undefined=undefined;
    try{
      const length=fs.statSync(input.fd).size;
      if(!Number.isSafeInteger(length)||length<=0)throw new Error('SUMMARY_EXPORT_INVALID');
      let offset=0;
      while(offset<length){
        if(!current())throw new Error('SUMMARY_STALE');
        const buffer=new ArrayBuffer(Math.min(262144,length-offset));const n=fs.readSync(input.fd,buffer,{length:buffer.byteLength});
        if(!Number.isSafeInteger(n)||n<=0||n>buffer.byteLength)throw new Error('SUMMARY_EXPORT_READ');
        if(!current())throw new Error('SUMMARY_STALE');
        if(!output)output=fs.openSync(uris[0],fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
        let written=0;while(written<n){if(!current())throw new Error('SUMMARY_STALE');const count=fs.writeSync(output.fd,buffer.slice(written,n));if(!Number.isSafeInteger(count)||count<=0||count>n-written)throw new Error('SUMMARY_EXPORT_WRITE');written+=count;}
        offset+=n;await new Promise<void>((resolve:()=>void)=>{setTimeout(resolve,0);});
      }
      if(!current()||fs.statSync(input.fd).size!==length||!output)throw new Error('SUMMARY_STALE');
      fs.fsyncSync(output.fd);if(!current())throw new Error('SUMMARY_STALE');
    }finally{try{fs.closeSync(input);}finally{if(output)fs.closeSync(output);}}
    if(this.current(epoch,reference))this.note='已导出这次总结；本机总结与原文保留';
  }

  build(){
    Column({space:8}){
      Text('这条录音的总结').fontSize(14).fontColor($r('app.color.text_primary')).width('100%')
      Text('总结与原音、转写分开保存；只覆盖当前已有文字，不代表录音完整。待办是候选，不会自动执行。').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
      Row({space:8}){
        Button('生成新总结').fontSize(11).height(30).enabled(!this.busy).onClick(()=>this.confirmGenerate())
        Button('刷新状态').fontSize(11).height(30).enabled(!this.busy).onClick(()=>this.refresh())
      }.width('100%')
      if(this.note){Text(this.note).fontSize(11).fontColor($r('app.color.text_secondary')).width('100%')}
      if(this.incomplete){Text('目录范围不完整或部分记录不可读，不代表全部历史总结。').fontSize(11).fontColor($r('app.color.warm')).width('100%')}
      if(this.versions.length){
        Text('已保存版本与未完成进度').fontSize(12).fontColor($r('app.color.text_secondary')).width('100%')
        ForEach(this.versions,(item:RecordingSummaryView)=>{
          Button(this.stamp(item.generated_at)+' · '+this.phaseText(item.phase)).fontSize(11).constraintSize({minHeight:30}).width('100%').enabled(!this.busy).onClick(()=>this.openVersion(item))
        },(item:RecordingSummaryView)=>item.job_id+':'+item.state_sha256)
      }
      Row({space:8}){
        Button('返回首批').fontSize(11).height(28).enabled(!this.busy).onClick(()=>{this.versionsCursor='';this.refresh();})
        Button('更多版本').fontSize(11).height(28).enabled(!this.busy&&this.hasMore).onClick(()=>this.nextVersions())
      }.width('100%')
      if(this.view){
        Text(this.phaseText(this.view.phase)+' · '+this.view.completed_steps+'/'+this.view.step_count+'步 · 请求'+this.view.calls_used+'/'+this.view.max_calls).fontSize(12).fontColor($r('app.color.text_primary')).width('100%')
        Text('模型：'+(this.view.model||'尚未确定')+'；'+this.stamp(this.view.generated_at)+'；转写覆盖：'+this.view.transcription_state).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
        if(this.view.note){Text(this.view.note).fontSize(11).fontColor($r('app.color.text_secondary')).width('100%')}
        if(this.view.phase==='running'||this.view.phase==='queued'){Button('停止并保留进度').fontSize(11).height(30).enabled(!this.busy).onClick(()=>this.pauseGeneration())}
        if(this.view.can_resume){Button('核对后恢复').fontSize(11).height(30).enabled(!this.busy).onClick(()=>this.confirmResume())}
        if(this.view.phase==='ready'){
          Row({space:8}){
            Button('导出MD').fontSize(11).height(30).enabled(!this.busy).onClick(()=>this.run(()=>this.exportSummary('md')))
            Button('导出JSON').fontSize(11).height(30).enabled(!this.busy).onClick(()=>this.run(()=>this.exportSummary('json')))
          }.width('100%')
          ForEach(['fact','todo','question','suggestion'],(category:string)=>{
            Column({space:6}){
              Button((this.expanded.includes(category)?'收起 ':'展开 ')+this.categoryText(category)+'（'+this.categoryEntries(category).length+'）').fontSize(12).constraintSize({minHeight:30}).width('100%').onClick(()=>this.toggleCategory(category))
              if(this.expanded.includes(category)){
                ForEach(this.categoryEntries(category),(entry:RecordingSummaryEntry)=>{
                  Column({space:4}){
                    Text(entry.text).fontSize(12).fontColor($r('app.color.text_secondary')).copyOption(CopyOptions.LocalDevice).width('100%')
                    ForEach(entry.evidence_ids,(id:string)=>{Button('查看原文引用').fontSize(11).height(28).onClick(()=>this.showCitation(id))},(id:string)=>id)
                  }.width('100%')
                },(entry:RecordingSummaryEntry)=>entry.category+':'+entry.text+':'+entry.evidence_ids.join(','))
              }
            }.width('100%')
          },(category:string)=>category)
        }
      }
      if(this.citation){Column({space:6}){
        Text('当前原文片段 · '+(this.citation.speaker_label||'说话人未确定')).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
        Text(this.citation.text).fontSize(12).fontColor($r('app.color.text_secondary')).copyOption(CopyOptions.LocalDevice).width('100%')
        Text(this.citationPlayable()?'回放从原句起点开始，不是引用字词的精确时间。':'这段原文没有可靠时间，不能定位原句起点。').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
        Row({space:8}){Button('播放原句起点').fontSize(11).height(28).enabled(this.citationPlayable()).onClick(()=>this.playCitation());Button('收起引用').fontSize(11).height(28).onClick(()=>{this.citation=undefined;})}.width('100%')
      }.width('100%').padding(8).backgroundColor($r('app.color.input_bg')).borderRadius(8)}
    }.width('100%').padding(10).backgroundColor($r('app.color.input_bg')).borderRadius(12)
  }
}
