import { dailyCaptureLab } from '../DailyCaptureLab';
import { probeSession } from '../ProbeSession';
import { lifelog, lifelogASR, localQueueSize, localCurrentDirectory } from '../RecordingService';

@Entry
@Component
struct DailyLab {
  @State phase:string='idle';@State note:string='';@State connected:boolean=false;
  @State modelReady:boolean=false;@State running:boolean=false;@State capture:string='';@State queue:string='';
  aboutToAppear():void{
    dailyCaptureLab.changed=():void=>this.refresh();probeSession.onConnection=():void=>this.refresh();this.refresh();
  }
  aboutToDisappear():void{dailyCaptureLab.changed=():void=>{};probeSession.onConnection=():void=>{};}
  private refresh():void{
    this.phase=dailyCaptureLab.phase;this.note=dailyCaptureLab.note;this.running=dailyCaptureLab.running;
    this.modelReady=dailyCaptureLab.modelReady;this.connected=probeSession.connection.phase==='ready';
    this.capture=lifelog.capturePhase+' · '+lifelog.bytes+' B · '+lifelog.note;
    this.queue='等待 '+localQueueSize()+' · 正在处理 '+(localCurrentDirectory()?'是':'否')+' · '+lifelogASR.progress+'%';
  }
  private failure(error:Error):void{this.note=error.message;}
  build(){
    Scroll(){
      Column({space:16}){
        Text('P22 日常调度隔离实验').fontSize(24).fontColor($r('app.color.text_primary'))
        Text('采集75秒后请求停止，新采集实验最多180秒；只恢复转写最多10分钟。测试资料独立保存，不上传、不生成每日总结。').fontSize(14).fontColor($r('app.color.warm'))
        Text(this.connected?'ready · 眼镜已连接':probeSession.connection.phase+' · '+probeSession.connection.note).fontSize(16)
        Text(this.phase+' · '+this.note).fontSize(16)
        Text(this.capture).fontSize(14)
        Text(this.queue).fontSize(14)
        Button('准备本机模型').id('p22-model-prepare').enabled(!this.running&&this.phase!=='loading')
          .onClick(():void=>{dailyCaptureLab.prepare();})
        Button('开始75秒智记与自动短窗').id('p22-daily-start').enabled(this.connected&&this.modelReady&&!this.running)
          .onClick(():void=>{dailyCaptureLab.start().catch((error:Error):void=>this.failure(error));})
        Button('停止采集，保留文字补处理').id('p22-daily-stop').enabled(this.running)
          .onClick(():void=>{dailyCaptureLab.stopCapture();})
        Row({space:8}){
          Button('继续上次转写').id('p22-daily-resume').enabled(this.connected&&this.modelReady&&!this.running)
            .onClick(():void=>{dailyCaptureLab.start(true).catch((error:Error):void=>this.failure(error));})
          Button('复测上次原音').id('p22-daily-replay').enabled(this.connected&&this.modelReady&&!this.running)
            .onClick(():void=>{dailyCaptureLab.start(true,true).catch((error:Error):void=>this.failure(error));})
        }
        Row({space:8}){
          Button('结束实验').id('p22-daily-finish').enabled(this.running)
            .onClick(():void=>{dailyCaptureLab.finish();})
          Button('核对线程退出').id('p22-worker-exit-probe').enabled(!this.running)
            .onClick(():void=>{dailyCaptureLab.probeWorkerExit().catch((error:Error):void=>this.failure(error));})
          Button('核对解码一致性').id('p22-codec-probe').enabled(!this.running&&this.phase!=='loading')
            .onClick(():void=>{dailyCaptureLab.probeWindowCodec().catch((error:Error):void=>this.failure(error));})
        }
      }.padding({left:20,right:20,top:60,bottom:40}).width('100%')
    }.height('100%').width('100%').backgroundColor($r('app.color.background'))
  }
}
