import { recordingLab } from '../RecordingLabSession';
import { probeSession } from '../ProbeSession';
import { backgroundLab } from '../BackgroundLabSession';

@Component
export struct RecordingLabPanel {
  @State phase:string='idle';@State note:string='尚未开始录音回归';
  @State progress:number=0;@State modelReady:boolean=false;@State active:boolean=false;
  @State hasTake:boolean=false;
  aboutToAppear():void{recordingLab.changed=():void=>this.refresh();this.refresh();}
  aboutToDisappear():void{recordingLab.changed=():void=>{};}
  private refresh():void{
    this.phase=recordingLab.phase;this.note=recordingLab.note;this.progress=recordingLab.progress;
    this.modelReady=recordingLab.modelReady;this.active=recordingLab.recorder.active;
    this.hasTake=recordingLab.hasTake;
  }
  build(){
    Column({space:10}){
      Text('P12 录音与本机识别回归').fontSize(20).fontColor($r('app.color.text_primary'))
      Text('只在明确开始后采集，60秒自动请求停止。测试原音和文字单独保留，不上传，不处理历史资料。').fontSize(14).fontColor($r('app.color.warm'))
      Text(this.phase+' · '+this.note+' · '+this.progress+'%').fontSize(14).fontColor($r('app.color.text_primary'))
      Button('加载并校验本机模型').id('p12-model-prepare')
        .enabled(!this.active&&this.phase!=='models_loading'&&this.phase!=='transcribing'&&!backgroundLab.active)
        .onClick(():void=>{recordingLab.prepare();})
      Button('开始60秒测试录音').id('p12-record-start')
        .enabled(this.modelReady&&!this.active&&this.phase!=='transcribing'&&probeSession.connection.phase==='ready'&&!backgroundLab.active)
        .onClick(():void=>{recordingLab.start();})
      Button('停止并保存测试录音').id('p12-record-stop').enabled(this.active)
        .onClick(():void=>{recordingLab.stop();})
      Button('转写并比较混合与左右声道').id('p12-transcribe')
        .enabled(!this.active&&this.hasTake&&this.phase!=='transcribing'&&this.modelReady)
        .onClick(():void=>{recordingLab.transcribe();})
      Button('20秒后转写已保存测试样本').id('p12-background-transcribe')
        .enabled(!this.active&&this.hasTake&&this.phase!=='transcribing'&&this.modelReady&&!backgroundLab.active)
        .onClick(():void=>{recordingLab.transcribe(true);})
      Button('停止本轮转写 · 保留原音').id('p12-transcribe-cancel').enabled(this.phase==='transcribing')
        .onClick(():void=>{recordingLab.cancelTranscription();})
      Button('继续一个20秒窗口 · 保存恢复点').id('p12-window-transcribe')
        .enabled(!this.active&&this.hasTake&&this.phase!=='transcribing'&&this.modelReady&&!backgroundLab.active)
        .onClick(():void=>{recordingLab.transcribeOneWindow();})
    }.width('100%')
  }
}
