import { webSocket } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { asrRunTask } from 'turbo_core';
import { ServiceConfig } from './RemoteServices';
interface ASRHeader { event: string; task_id: string; error_code?: string; }
interface ASRSentence { text: string; sentence_end?: boolean; heartbeat?: boolean; sentence_id?: number; }
interface ASROutput { sentence?: ASRSentence; }
interface ASRPayload { output?: ASROutput; }
interface ASREvent { header: ASRHeader; payload?: ASRPayload; }
export class CloudASR {
  onReady: ()=>void = ():void=>{};
  onStatus: (status:string)=>void = (_s:string):void=>{};
  onText: (text:string, final:boolean)=>void = (_t:string,_f:boolean):void=>{};
  onError: (reason:string)=>void = (_s:string):void=>{};
  private socket: webSocket.WebSocket | undefined = undefined;
  private epoch: number = 0;
  private ready: boolean = false;
  private done: boolean = false;
  private task: string = '';
  private queue: Uint8Array[] = [];
  private queued: number = 0;
  private total: number = 0;
  private draining: boolean = false;
  private timer: number = -1;
  start(config: ServiceConfig, task: string): void {
    this.close();
    if (!config.asrKey || !/^[a-z0-9.-]+\.aliyuncs\.com$/.test(config.asrHost)) throw new Error('ASR Key / Host 未配置');
    const run = asrRunTask(task,config.asrModel); const token=this.epoch;this.task=task;this.done=false;this.total=0;
    const socket=webSocket.createWebSocket();this.socket=socket;
    let opened=false;
    this.onStatus('WebSocket 连接中');
    socket.on('open',():void=>{
      if(token!==this.epoch||opened)return;opened=true;this.onStatus('WebSocket 已打开，提交 ASR 任务');
      socket.send(run).then((ok:boolean):void=>{if(token!==this.epoch)return;if(!ok)this.fail('ASR任务未发送');else this.onStatus('ASR任务已发送，等待服务启动');})
        .catch(()=>{if(token===this.epoch)this.fail('ASR任务发送失败');});
    });
    socket.on('message',(error:BusinessError,data:string|ArrayBuffer):void=>{
      if(token!==this.epoch)return;
      if(error?.code || typeof data!=='string' || data.length>32768){this.fail('ASR消息异常');return;}
      try {
        const event=JSON.parse(data) as ASREvent;
        if(event.header?.task_id!==this.task)return;
        if(event.header.event==='task-started'){
          this.ready=true;if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;this.drain(token);this.onReady();
        } else if(event.header.event==='result-generated'&&!this.done){
          const sentence=event.payload?.output?.sentence;
          if(!sentence||sentence.heartbeat||typeof sentence.text!=='string'||sentence.text.length>4000)return;
          const final=sentence.sentence_end===true;
          if(!sentence.text.trim())return;
          if(final)this.done=true;
          this.onText(sentence.text,final);
        } else if(event.header.event==='task-failed')this.fail('ASR服务拒绝任务，请核对Host、模型和Key');
        else if(event.header.event==='task-finished'&&!this.done)this.fail('ASR已结束但没有有效句末文字');
      } catch (_) {this.fail('ASR响应解析失败');}
    });
    socket.on('error',():void=>{if(token===this.epoch)this.fail('ASR网络连接异常');});
    socket.on('close',():void=>{if(token===this.epoch&&!this.done)this.fail('ASR连接提前关闭');});
    this.timer=setTimeout(()=>{if(token===this.epoch)this.fail('ASR启动超时');},10000);
    socket.connect(`wss://${config.asrHost}/api-ws/v1/inference`,{header:{Authorization:`Bearer ${config.asrKey}`},skipServerCertVerification:false})
      .then((ok:boolean)=>{if(token===this.epoch&&!ok)this.fail('ASR连接请求未受理');})
      .catch(()=>{if(token===this.epoch)this.fail('ASR连接失败');});
  }
  append(pcm:Uint8Array):void {
    if(!this.socket||this.done)return;
    if(pcm.length===0||pcm.length%2||this.queued+pcm.length>64000||this.total+pcm.length>1280000){this.fail('ASR音频积压或达到40秒保护上限');return;}
    this.queue.push(pcm.slice());this.queued+=pcm.length;this.total+=pcm.length;this.drain(this.epoch);
  }
  private async drain(token:number):Promise<void>{
    if(this.draining||!this.ready||!this.socket)return;this.draining=true;
    try {
      while(token===this.epoch&&this.ready&&this.socket&&this.queue.length){
        const bytes=this.queue.shift()!;this.queued-=bytes.length;
        try {if(!await this.socket.send(bytes.buffer))throw new Error('send');}finally{bytes.fill(0);}
      }
    }catch(_){if(token===this.epoch)this.fail('ASR音频发送失败');}
    finally{if(token===this.epoch)this.draining=false;}
  }
  private fail(reason:string):void{this.close();this.onError(reason);}
  close():void{
    this.epoch++;const socket=this.socket;this.socket=undefined;this.ready=false;this.draining=false;this.done=true;
    if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;
    for(const b of this.queue)b.fill(0);this.queue=[];this.queued=0;
    if(socket){try{socket.off('open');socket.off('message');socket.off('error');socket.off('close');socket.close().catch(()=>{});}catch(_){}}
  }
}
