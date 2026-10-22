import { webSocket } from '@kit.NetworkKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { asrRunTask } from 'turbo_core';
import { ServiceConfig } from './RemoteServices';

export function downmixStereo16(bytes:Uint8Array):Uint8Array {
  if(bytes.length%4!==0)throw new Error('立体声 PCM 长度无效');
  const source=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),output=new Uint8Array(bytes.length/2),view=new DataView(output.buffer);
  for(let i=0;i<bytes.length;i+=4)view.setInt16(i/2,Math.round((source.getInt16(i,true)+source.getInt16(i+2,true))/2),true);
  return output;
}
interface Sentence {text?:string;sentence_end?:boolean;sentence_id?:number;heartbeat?:boolean;}
interface FileASRHeader {event:string;task_id:string;}
interface FileASROutput {sentence?:Sentence;}
interface FileASRPayload {output?:FileASROutput;}
interface ASRResponse {header:FileASRHeader;payload?:FileASRPayload;}
// File recognition is intentionally independent from single-turn CloudASR: VAD
// finalizes each sentence here, but only task-finished finalizes the whole file.
export class RecordingASR {
  active:boolean=false;progress:number=0;text:string='';
  changed:()=>void=():void=>{};
  private socket:webSocket.WebSocket|undefined=undefined;
  private timer:number=-1;private epoch:number=0;
  private reject:((error:Error)=>void)|undefined=undefined;
  cancel():void{
    const reject=this.reject;this.reject=undefined;this.close();if(reject)reject(new Error('转写已取消，原录音保留'));
  }
  private close():void{this.epoch++;this.active=false;if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;const socket=this.socket;this.socket=undefined;if(socket){try{socket.off('open');socket.off('message');socket.off('error');socket.off('close');socket.close().catch(()=>{});}catch(_){}}}
  async transcribe(path:string,config:ServiceConfig):Promise<string>{
    if(this.active)throw new Error('已有录音正在转写');
    if(!config.asrKey||!/^[a-z0-9.-]+\.aliyuncs\.com$/.test(config.asrHost))throw new Error('请先配置阿里 ASR');
    const file=fs.openSync(path,fs.OpenMode.READ_ONLY);
    try{
      const length=fs.statSync(file.fd).size;if(length<=44||length>44+64000*600)throw new Error('首版仅支持 10 分钟内的已封装录音');
      const header=new ArrayBuffer(44);if(fs.readSync(file.fd,header)!==44)throw new Error('WAV 头不完整');
      const h=new Uint8Array(header),v=new DataView(header);
      if(h[0]!==82||h[1]!==73||h[2]!==70||h[3]!==70||h[8]!==87||h[9]!==65||h[10]!==86||h[11]!==69||v.getUint16(20,true)!==1||v.getUint16(22,true)!==2||v.getUint32(24,true)!==16000||v.getUint16(34,true)!==16||v.getUint32(40,true)!==length-44||(length-44)%4)throw new Error('仅接受本机生成的 16kHz 立体声 PCM WAV');
      this.active=true;this.progress=0;this.text='';this.changed();const epoch=++this.epoch;
      const bytes=cryptoFramework.createRandom().generateRandomSync(16).data,task=Array.from(bytes).map((b:number)=>b.toString(16).padStart(2,'0')).join('');bytes.fill(0);
      const run=asrRunTask(task,config.asrModel),socket=webSocket.createWebSocket();this.socket=socket;
      return await new Promise<string>((resolve:(value:string)=>void,reject:(error:Error)=>void)=>{
        this.reject=reject;let uploading=false,uploaded=false;const sentences:Map<number,string>=new Map();let fallback=1000000;
        const fail=(message:string):void=>{if(epoch!==this.epoch)return;this.reject=undefined;this.close();reject(new Error(message));};
        this.timer=setTimeout(()=>fail('录音转写超时，原录音保留'),Math.ceil((length-44)/64000*1000)+45000);
        socket.on('open',():void=>{if(epoch!==this.epoch)return;socket.send(run).then((ok:boolean)=>{if(!ok)fail('转写任务未提交');}).catch(()=>fail('转写任务提交失败'));});
        socket.on('message',(error:BusinessError,data:string|ArrayBuffer):void=>{
          if(epoch!==this.epoch)return;
          if(error?.code||typeof data!=='string'||data.length>32768){fail('转写响应异常');return;}
          try{
            const event=JSON.parse(data) as ASRResponse;if(event.header?.task_id!==task)return;
            if(event.header.event==='task-started'&&!uploading){
              uploading=true;
              const feed=async():Promise<void>=>{
                let sent=0;while(sent<length-44){
                  if(epoch!==this.epoch)return;
                  const buffer=new ArrayBuffer(Math.min(6400,length-44-sent));const n=fs.readSync(file.fd,buffer);
                  if(n!==buffer.byteLength)throw new Error('read');
                  const stereo=new Uint8Array(buffer),mono=downmixStereo16(stereo);
                  try{if(!await socket.send(mono.buffer))throw new Error('send');}finally{stereo.fill(0);mono.fill(0);}
                  if(epoch!==this.epoch)return;sent+=n;this.progress=Math.floor(sent/(length-44)*100);this.changed();
                  await new Promise<void>((next:()=>void)=>{setTimeout(next,100);});
                }
                if(epoch!==this.epoch)return;uploaded=true;
                if(!await socket.send(`{"header":{"action":"finish-task","task_id":"${task}","streaming":"duplex"},"payload":{"input":{}}}`))throw new Error('finish');
              };
              feed().catch(()=>fail('读取或上传录音失败，未标记转写完成'));
            }else if(event.header.event==='result-generated'){
              const s=event.payload?.output?.sentence;if(!s||s.heartbeat||!s.sentence_end||typeof s.text!=='string'||!s.text.trim())return;
              if(s.text.length>4000||sentences.size>=2000){fail('转写文本超过保护上限');return;}
              const id=typeof s.sentence_id==='number'&&Number.isSafeInteger(s.sentence_id)&&s.sentence_id>=0?s.sentence_id:fallback++;
              sentences.set(id,s.text);this.text=Array.from(sentences.entries()).sort((a,b)=>a[0]-b[0]).map(row=>row[1]).join('\n');
              if(this.text.length>100000){fail('转写文本过长');return;}this.changed();
            }else if(event.header.event==='task-finished'){
              if(!uploaded||!this.text.trim()){fail('任务结束但没有完整录音对应的有效文字');return;}
              const text=this.text;this.reject=undefined;this.close();resolve(text);
            }else if(event.header.event==='task-failed')fail('ASR 服务拒绝转写，请核对当前配置');
          }catch(_){fail('转写响应解析失败');}
        });
        socket.on('error',():void=>fail('转写网络错误'));socket.on('close',():void=>fail('转写连接提前关闭'));
        socket.connect(`wss://${config.asrHost}/api-ws/v1/inference`,{header:{Authorization:`Bearer ${config.asrKey}`},skipServerCertVerification:false})
          .then((ok:boolean)=>{if(!ok)fail('转写连接未建立');}).catch(()=>fail('转写连接失败'));
      });
    }finally{fs.closeSync(file);if(this.active){this.reject=undefined;this.close();}this.changed();}
  }
}
