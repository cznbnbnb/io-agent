import { taskSuggestions,taskSuggestionView,taskVoiceReplies,taskDraftRecovery } from '../TaskSuggestionService';
import { TaskDecisionRecord } from '../TaskReplyDraft';
import { TaskDraftRecoveryState } from '../TaskDraftRecovery';
import { taskService } from '../TaskService';
import { TaskVoiceSourceView } from '../TaskVoiceSources';

@Component
export struct TaskSuggestionPanel {
  @State note:string='';@State record:TaskDecisionRecord=new TaskDecisionRecord();
  @State present:boolean=false;@State busy:boolean=false;@State paused:boolean=true;@State protectedRecord:boolean=false;
  @State voiceNote:string='';@State voiceActive:boolean=false;@State voiceRecover:boolean=false;
  @State voiceCleanup:boolean=false;@State voiceDiscard:boolean=false;@State voiceCopied:boolean=false;
  @State voiceRetained:boolean=false;@State retainedText:string='';
  @State reviewReady:boolean=false;@State reviewHash:string='';
  @State recovery:TaskDraftRecoveryState=new TaskDraftRecoveryState();
  @State recoveryPreview:string='';@State recoverySource:string='';@State recoveryNote:string='';
  @State source:TaskVoiceSourceView=new TaskVoiceSourceView();@State adoption:string='';
  private visible:boolean=false;
  aboutToAppear():void{this.visible=true;this.refresh();taskSuggestionView.changed=():void=>{if(this.visible)this.refresh();};}
  aboutToDisappear():void{this.visible=false;taskSuggestionView.changed=():void=>{};this.recoveryPreview='';this.recoverySource='';}
  private refresh():void{const record=taskSuggestions.draft.snapshot();this.present=!!record;this.record=record||new TaskDecisionRecord();
    this.note=taskSuggestions.note;this.busy=taskSuggestions.busy;this.paused=taskSuggestions.draft.paused;this.protectedRecord=taskSuggestions.draft.blocked;
    const recovery=this.protectedRecord?taskDraftRecovery.inspect():new TaskDraftRecoveryState();
    if(recovery.inspection_sha256!==this.recovery.inspection_sha256){this.recoveryPreview='';this.recoverySource='';}
    this.recovery=recovery;
    try{this.source=taskService.sourceStatus();}catch{this.source=new TaskVoiceSourceView();this.source.state='blocked';}
    this.adoption=taskSuggestions.adoptionHash();
    this.voiceNote=taskVoiceReplies.note;this.voiceActive=taskVoiceReplies.active;this.voiceRecover=taskVoiceReplies.canRecover;
    this.voiceCleanup=taskVoiceReplies.cleanupPending;this.voiceDiscard=taskVoiceReplies.canDiscardIncomplete;this.voiceCopied=taskVoiceReplies.canClearCopied;
    this.voiceRetained=taskVoiceReplies.canDiscardRetained;this.retainedText=taskVoiceReplies.retainedText;
    const review=taskSuggestions.reviewStatus();this.reviewReady=review.ready;this.reviewHash=review.binding_sha256;}
  private act(action:()=>Promise<void>):void{try{action().catch(()=>{});}catch{}this.refresh();}
  private previewRecovery(source:string):void{
    try{this.recoveryPreview=taskDraftRecovery.preview(source,this.recovery.inspection_sha256);this.recoverySource=source;this.recoveryNote='请完整核对这一份内容；恢复只生成暂停草稿，不发送答案';}
    catch{this.recoveryPreview='';this.recoverySource='';this.recoveryNote='记录已变化或暂不可预览，请刷新核对；原件仍保留';}this.refresh();
  }
  private restoreRecovery(source:string):void{
    const expected=this.recovery.inspection_sha256;
    AlertDialog.show({title:source==='resume'?'继续未完成的恢复？':'恢复所选记录？',
      message:'原始记录会归档保留，恢复后仅为暂停草稿。旧确认不会重放，不会开麦或提交Agent答案；之后仍需重新核对原问题。',
      primaryButton:{value:'暂不恢复',action:():void=>{}},secondaryButton:{value:'恢复草稿',action:():void=>{
        try{taskDraftRecovery.restore(source,expected);this.recoveryNote='恢复步骤已完成，请查看暂停草稿；尚未提交答案';}
        catch{this.recoveryNote='恢复未完成或记录已变化；原件已保留，请刷新检查恢复状态';}this.refresh();
      }}});
  }
  private stage():string{
    if(this.record.stage==='proposal')return '等待方案选择';if(this.record.stage==='supplement_offer')return '等待是否补充条件';
    if(this.record.stage==='voice_authorized')return '本轮口述条件草稿';if(this.record.stage==='review')return '完整答案待确认';
    if(this.record.stage==='sealed')return '答案已封存，待核对发送记录';if(this.record.stage==='queued')return '本机发送队列已接管';
    if(this.record.stage==='abandoned')return '本地草稿已撤回，电脑任务未取消';return '本地草稿暂存';
  }
  build(){
    Column({space:8}){
      Text('眼镜答复草稿 · 验证中').fontSize(15).width('100%')
      Text(this.note).fontSize(12).width('100%')
      if(this.recoveryNote)Text(this.recoveryNote).fontSize(12).width('100%')
      if(this.protectedRecord){Text('草稿保存中断或记录已变化，现有记录均已保留。下方旧内容仅供查看和复制，暂不能提交或覆盖。').fontSize(12).width('100%')}
      if(this.protectedRecord){
        Text('先查看要恢复的记录，核对完整内容后再选择。').fontSize(12).width('100%')
        if(this.recovery.main.valid){Button('查看上次保存的内容').fontSize(12).onClick(()=>this.previewRecovery('main'))}
        if(this.recovery.partial.valid){Button('查看未完成保存的内容').fontSize(12).onClick(()=>this.previewRecovery('partial'))}
        if(this.recoveryPreview){Text(this.recoveryPreview).fontSize(13).width('100%').copyOption(CopyOptions.InApp)}
        if(this.recoverySource==='main'&&this.recovery.main.eligible||this.recoverySource==='partial'&&this.recovery.partial.eligible){
          Button('恢复这一份为暂停草稿').fontSize(12).enabled(!this.busy).onClick(()=>this.restoreRecovery(this.recoverySource))
        }
        if(this.recovery.can_resume){Button('继续上次未完成的恢复').fontSize(12).enabled(!this.busy).onClick(()=>this.restoreRecovery('resume'))}
        if(!this.recovery.main.valid&&!this.recovery.partial.valid&&!this.recovery.can_resume){Text('暂未找到可安全恢复的完整记录；原件保留，不自动选择旧内容。').fontSize(12).width('100%')}
      }
      if(this.present){
        Text(this.stage()).fontSize(13).width('100%')
        Text(this.record.binding.route.computer_id+' / '+this.record.binding.route.agent_id+' / '+this.record.binding.route.project_id+' / '+this.record.binding.route.session_id).fontSize(11).width('100%')
        Text(this.record.binding.question).fontSize(14).width('100%')
        if(this.record.text)Text(this.record.text).fontSize(14).width('100%').copyOption(CopyOptions.InApp)
        if(this.record.text&&['legacy','unknown','tainted','missing','blocked'].includes(this.source.state)){
          Text('这份文字的来源需要重新核对，完整原文保留。来源未确认前不会新提交口述答案。').fontSize(12).width('100%')
          if(this.source.delivery_uncertain){Text('存在投递不确定，请先查看发送记录；不会自动撤回、改写或重新提交。').fontSize(12).width('100%')}
          if(this.adoption){Button('已核对全文，以手机文字为准').fontSize(12).enabled(!this.busy&&!this.protectedRecord).onClick(()=>{
            const expected=this.adoption;
            AlertDialog.show({title:'采用你核对的完整文字？',message:'请确认已核对上方原问题和全部文字。采用后只保留为手机草稿，不自动发送；已有投递记录不会被覆盖。',
              primaryButton:{value:'继续保留',action:():void=>{}},secondaryButton:{value:'采用为手机草稿',action:():void=>this.act(()=>taskSuggestions.adoptPhone(expected))}});
          })}
        }
        if(this.record.stage==='voice_authorized'||this.voiceActive||this.voiceCleanup||this.voiceCopied||this.voiceRetained||this.voiceDiscard){
          Text(this.voiceNote).fontSize(12).width('100%')
          if(this.record.stage==='voice_authorized')Text('同意后录音约15秒，结束后在本机转写；核对完整文字后才发送。原音保留在录音资料中。').fontSize(12).width('100%')
          if(this.voiceActive&&!this.voiceCleanup){
            Button('结束口述并保留完整草稿').fontSize(12).onClick(()=>this.act(()=>taskVoiceReplies.stop()))
            Button('取消本次口述，保留原问题').fontSize(12).onClick(()=>{taskVoiceReplies.cancel();this.refresh();})
          }
          if(this.voiceCleanup)Button('清理本轮未退出收音').fontSize(12).onClick(()=>this.act(()=>taskVoiceReplies.cleanup()))
          if(this.voiceRecover)Button('重新核对并载入完整口述').fontSize(12).onClick(()=>this.act(()=>taskVoiceReplies.recover()))
          if(this.voiceDiscard)Button('清理本轮不完整口述').fontSize(12).onClick(()=>{try{taskVoiceReplies.discardIncomplete();}catch{}this.refresh();})
          if(this.voiceCopied)Button('清理已保存的收音副本').fontSize(12).onClick(()=>{try{taskVoiceReplies.clearCopied();}catch{}this.refresh();})
          if(this.voiceRetained){
            Text(this.retainedText).fontSize(13).width('100%').copyOption(CopyOptions.InApp)
            Button('丢弃本轮保留口述').fontSize(12).onClick(()=>AlertDialog.show({title:'丢弃这段口述？',
              message:'这段完整文字尚未交给Agent。可先复制保留；丢弃后无法恢复，原问题和电脑任务仍保留。',
              primaryButton:{value:'保留',action:():void=>{}},secondaryButton:{value:'丢弃口述',action:():void=>{try{taskVoiceReplies.discardRetained();}catch{}this.refresh();}}}))
          }
        }
        if(this.record.cleanup_uid){Button('重试移除本轮卡片').fontSize(12).enabled(!this.busy).onClick(()=>this.act(()=>taskSuggestions.cleanup()))}
        else if(this.paused&&!['sealed','queued','abandoned'].includes(this.record.stage)){
          Button('重新核对并继续草稿').fontSize(12).enabled(!this.busy&&!this.protectedRecord).onClick(()=>this.act(()=>taskSuggestions.resume()))
        }
        if(['review','sealed'].includes(this.record.stage)){
          Text('下方提交会把上方完整答案交给原电脑任务。服务器接受与任务完成分别显示。').fontSize(12).width('100%')
          if(this.record.stage==='review'){
            Button('在眼镜核对完整答案').fontSize(12).enabled(this.reviewReady).onClick(()=>this.act(()=>taskSuggestions.showReview(this.reviewHash)))
            Text('原问题和完整答案放不下时，请在手机核对；眼镜摇头仅保留草稿。').fontSize(11).width('100%')
          }
          Button('提交这份完整答案').fontSize(12).enabled(!this.busy&&!this.protectedRecord&&!this.record.cleanup_uid&&(!this.paused||this.record.stage==='sealed')).onClick(()=>this.act(()=>taskSuggestions.submit()))
        }
        if(!['sealed','queued','abandoned'].includes(this.record.stage)){
          Button('撤回本地未提交草稿').fontSize(12).enabled(!this.busy&&!this.protectedRecord).onClick(()=>this.act(()=>taskSuggestions.abandon()))
        }
      }
    }.padding(12).width('100%').backgroundColor($r('app.color.card_bg_soft')).borderRadius(14).alignItems(HorizontalAlign.Start)
  }
}
