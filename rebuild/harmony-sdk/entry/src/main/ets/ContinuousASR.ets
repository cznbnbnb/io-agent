import { webSocket } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { ServiceConfig } from './RemoteServices';
interface StreamSentence {text:string;sentence_id:number;sentence_end?:boolean;heartbeat?:boolean;}
interface StreamOutput {sentence?:StreamSentence;}
interface StreamPayload {output?:StreamOutput;}
interface StreamHeader {task_id:string;event:string;}
interface StreamEvent {header:StreamHeader;payload?:StreamPayload;}
interface RunHeader {action:string;task_id:string;streaming:string;}
interface RunParameters {format:string;sample_rate:number;heartbeat:boolean;max_sentence_silence:number;}
interface RunInput {}
interface RunPayload {task_group:string;task:string;function:string;model:string;parameters:RunParameters;input:RunInput;}
interface RunEvent {header:RunHeader;payload:RunPayload;}
export class ContinuousASR {
  onText:(text:string,final:boolean,id:number)=>void=(_text:string,_final:boolean,_id:number):void=>{};
  onError:(note:string)=>void=(_note:string):void=>{};
  private socket:webSocket.WebSocket|undefined=undefined;private epoch:number=0;private task:string='';
  private ready:boolean=false;private draining:boolean=false;private queue:Uint8Array[]=[];private queued:number=0;
  private timer:number=-1;private readyResolve:(()=>void)|undefined=undefined;private readyReject:((error:Error)=>void)|undefined=undefined;
  private sentence:number=0;private finalSentence:number=0;private previous:string='';
  start(config:ServiceConfig,task:string):Promise<void>{
    this.close();
    if(!config.asrKey||!/^[a-z0-9.-]+\.aliyuncs\.com$/.test(config.asrHost)||!/^(qwen-audio-3\.[01]-asr-flash-streaming|paraformer-realtime-v2|fun-asr-realtime)$/.test(config.asrModel)||!/^[0-9a-f]{32}$/.test(task))return Promise.reject(new Error('请配置受支持的流式转写模型、Host和Key'));
    const token=this.epoch;this.task=task;this.sentence=0;this.finalSentence=0;this.previous='';
    const pending=new Promise<void>((resolve:()=>void,reject:(error:Error)=>void):void=>{this.readyResolve=resolve;this.readyReject=reject;});
    const socket=webSocket.createWebSocket();this.socket=socket;let opened=false;
    const request:RunEvent={header:{action:'run-task',task_id:task,streaming:'duplex'},payload:{task_group:'audio',task:'asr',function:'recognition',model:config.asrModel,parameters:{format:'pcm',sample_rate:16000,heartbeat:true,max_sentence_silence:500},input:{}}};
    const run=JSON.stringify(request);
    socket.on('open',():void=>{if(token!==this.epoch||opened)return;opened=true;socket.send(run).then((ok:boolean):void=>{if(token===this.epoch&&!ok)this.fail('跟随转写请求未受理');}).catch(()=>{if(token===this.epoch)this.fail('跟随转写请求发送失败');});});
    socket.on('message',(error:BusinessError,data:string|ArrayBuffer):void=>{
      if(token!==this.epoch)return;
      if(error?.code||typeof data!=='string'||data.length>65536){this.fail('跟随转写消息无效');return;}
      try{const event=JSON.parse(data) as StreamEvent;if(event.header?.task_id!==this.task)return;
        if(event.header.event==='task-started'){if(!this.ready){this.ready=true;if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;const resolve=this.readyResolve;this.readyResolve=undefined;this.readyReject=undefined;resolve?.();void this.drain(token);}return;}
        if(event.header.event==='task-failed'||event.header.event==='task-finished'){this.fail('跟随转写已中断，请重新继续');return;}
        if(event.header.event!=='result-generated'||!this.ready)return;
        const sentence=event.payload?.output?.sentence;
        if(!sentence||sentence.heartbeat)return;
        if(!Number.isSafeInteger(sentence.sentence_id)||sentence.sentence_id<1||typeof sentence.text!=='string'||sentence.text.length>4000){this.fail('跟随转写句子无效');return;}
        const id=sentence.sentence_id,final=sentence.sentence_end===true;
        if(id<this.sentence||id<=this.finalSentence)return;if(id>this.sentence){this.sentence=id;this.previous='';}
        const key=sentence.text+'|'+String(final);if(key===this.previous)return;this.previous=key;if(final)this.finalSentence=id;
        if(sentence.text.trim())this.onText(sentence.text,final,id);
      }catch(_){this.fail('跟随转写响应无效');}
    });
    socket.on('error',():void=>{if(token===this.epoch)this.fail('跟随转写网络异常');});
    socket.on('close',():void=>{if(token===this.epoch)this.fail('跟随转写连接中断');});
    this.timer=setTimeout(()=>{if(token===this.epoch)this.fail('跟随转写启动超时');},10000);
    socket.connect(`wss://${config.asrHost}/api-ws/v1/inference`,{header:{Authorization:`Bearer ${config.asrKey}`},skipServerCertVerification:false}).then((ok:boolean):void=>{if(token===this.epoch&&!ok)this.fail('跟随转写连接未受理');}).catch(()=>{if(token===this.epoch)this.fail('跟随转写连接失败');});return pending;
  }
  append(pcm:Uint8Array):void{
    if(!this.socket)return;if(!pcm.length||pcm.length%2||pcm.length>4096||this.queued+pcm.length>64000){this.fail('跟随音频无效或积压超过两秒');return;}
    this.queue.push(pcm.slice());this.queued+=pcm.length;void this.drain(this.epoch);
  }
  private async drain(token:number):Promise<void>{
    if(this.draining||!this.ready||!this.socket)return;this.draining=true;
    try{while(token===this.epoch&&this.socket&&this.ready&&this.queue.length){const bytes=this.queue.shift()!;this.queued-=bytes.length;try{if(!await this.socket.send(bytes.buffer))throw new Error('send');}finally{bytes.fill(0);}}}
    catch(_){if(token===this.epoch)this.fail('跟随音频发送失败');}finally{if(token===this.epoch)this.draining=false;}
  }
  private fail(note:string):void{const reject=this.readyReject;this.readyReject=undefined;this.readyResolve=undefined;this.close();reject?.(new Error(note));this.onError(note);}
  close():void{
    this.epoch++;const socket=this.socket;this.socket=undefined;this.ready=false;this.draining=false;
    if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;
    const reject=this.readyReject;this.readyReject=undefined;this.readyResolve=undefined;reject?.(new Error('跟随转写已取消'));
    for(const item of this.queue)item.fill(0);this.queue=[];this.queued=0;this.previous='';
    if(socket){try{socket.off('open');socket.off('message');socket.off('error');socket.off('close');void socket.close().catch(()=>{});}catch(_){}}
  }
}
