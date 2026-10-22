import { agentCapture,agentCaptureView } from '../AgentCaptureService';
import { AgentCaptureState } from '../AgentReplyCapture';

@Component
export struct AgentCapturePanel {
  @State state:AgentCaptureState=new AgentCaptureState();@State note:string='';
  private visible:boolean=false;
  aboutToAppear():void{this.visible=true;this.refresh();agentCaptureView.changed=():void=>{if(this.visible)this.refresh();};}
  aboutToDisappear():void{this.visible=false;agentCaptureView.changed=():void=>{};}
  private refresh():void{this.state=JSON.parse(JSON.stringify(agentCapture.state)) as AgentCaptureState;}
  private async start():Promise<void>{
    try{this.note='';await agentCapture.start('capture-lab-'+Date.now().toString(36),15);}
    catch(_){this.note='暂不能开始；请先连接眼镜并结束其他采集、显示或识别';}this.refresh();
  }
  private async stop():Promise<void>{try{await agentCapture.stop(false);}catch(_){this.note='停止尚未确认，请保留记录并清理';}this.refresh();}
  private async cleanup():Promise<void>{try{await agentCapture.cleanup();}catch(_){this.note='请连接原眼镜后再清理';}this.refresh();}
  private clear():void{try{agentCapture.clearDraft();this.note='';}catch(_){this.note='停止未确认，未清空记录';}this.refresh();}
  private writeState(value:string):string{return value==='submitted'?'写入完成（非设备确认）':value==='failed'?'写入失败':value==='pending'?'正在写入':'未尝试';}
  private transcriptState(value:string):string{return value==='complete'?'完整':value==='partial'?'部分文字（不可转存答案）':value==='pending'?'正在收尾':
    value==='cancelled'?'已取消（不可转存答案）':value==='legacy'?'历史文字（完整性未确认）':'尚无完整文字';}
  private confirmExit():void{
    const binding=this.state.binding;
    this.getUIContext().showAlertDialog({title:'确认镜片已退出',message:'请先在眼镜上退出语音界面，确认已回到主界面且没有收音提示。这里只解除本轮占用，不提交草稿或答案；不记为设备退出回执。',
      primaryButton:{value:'稍后',action:():void=>{}},
      secondaryButton:{value:'镜片已退出，解除占用',action:():void=>{void this.acceptExit(binding);}}});
  }
  private async acceptExit(binding:string):Promise<void>{try{await agentCapture.confirmExitByUser(binding);this.note='';}catch(_){this.note='请先连接原眼镜清理，等待音频停止，并核对镜片后再确认';}this.refresh();}
  build(){
    Column({space:8}){
      Text('语音回复收音自检 · 验证中').fontSize(15).width('100%')
      Text('独立自检只收音并在本机转写，不提交任务答案。原问题的口述由第二张回答卡明确同意后开始。').fontSize(12).fontColor($r('app.color.text_muted')).width('100%')
      Text(this.state.note).fontSize(12).width('100%')
      Text(`音频包 ${this.state.packets} · 非全零包 ${this.state.nonzeroPackets} · 退出通知 ${this.state.exitObserved?'已观察':'未观察'}`).fontSize(11).width('100%')
      Text('关麦：'+this.writeState(this.state.recorderStop)+' · 退出：'+this.writeState(this.state.exitWrite)).fontSize(11).width('100%')
      Text(`当前识别线程 ${this.state.workerExited?'已释放':'未释放'} · 停止后音频包 ${this.state.lateAudioPackets} · 退出依据 ${this.state.exitEvidence==='device_event'?'设备事件':this.state.exitEvidence==='user_confirmation'?'用户确认（非设备回执）':this.state.exitEvidence==='legacy_record'?'历史记录':'尚未确认'}`).fontSize(11).width('100%')
      Text('转写：'+this.transcriptState(this.state.transcriptStatus)+' · 本机音频输入：'+(this.state.inputSealed?'已封口':'尚未封口')).fontSize(11).width('100%')
      if(this.state.text)Text('转写草稿：'+this.state.text).fontSize(13).copyOption(CopyOptions.InApp).width('100%')
      Row({space:8}){
        Button('开始15秒收音自检').fontSize(11).enabled(!agentCapture.active&&this.state.phase!=='blocked'&&!this.state.text).onClick(()=>this.start())
        Button('停止并保留草稿').fontSize(11).enabled(['preparing','starting','listening'].includes(this.state.phase)).onClick(()=>this.stop())
      }.width('100%')
      Row({space:8}){
        Button('清理上次收音').fontSize(11).enabled(this.state.phase==='cleanup_pending').onClick(()=>this.cleanup())
        Button('清空自检草稿').fontSize(11).enabled(!agentCapture.active&&this.state.phase!=='blocked'&&!!this.state.text).onClick(()=>this.clear())
      }.width('100%')
      if(this.state.phase==='cleanup_pending'){
        Button('我已在眼镜上退出…').fontSize(11).enabled(this.state.stopSubmitted&&this.state.workerExited).onClick(()=>this.confirmExit())
        if(this.state.inputSealed&&this.state.workerExited&&this.state.exitEvidence==='none')Text('本机音频已排空并结束识别，仍待确认眼镜已退出；本机收尾不代表设备退出回执。').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
        Text('收音界面没有同意/拒绝按钮。请先在镜片确认已回到主界面且没有收音提示，再明确解除占用；退出未确认时，其他共享音频业务暂不可启动。').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
      }
      if(this.note)Text(this.note).fontSize(12).width('100%')
    }.padding(12).width('100%').backgroundColor($r('app.color.card_bg_soft')).borderRadius(14)
  }
}
