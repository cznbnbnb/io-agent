import { worker,MessageEvents } from '@kit.ArkTS';
import { LocalFollowRequest,LocalFollowReply } from './LocalFollowWire';
export class LocalFollowASR {
  onText:(text:string,final:boolean,id:number)=>void=(_t:string,_f:boolean,_i:number):void=>{};
  onError:(note:string)=>void=(_n:string):void=>{};
  private static draining:Promise<void>[]=[];
  private port:worker.ThreadWorker|undefined=undefined;private epoch:number=0;private generation:number=0;private sequence:number=0;
  private ready:boolean=false;private listening:boolean=false;private queued:number=0;private pending:Map<number,number>=new Map();
  private timer:number=-1;private operation:string='';private resolve:(()=>void)|undefined=undefined;private reject:((error:Error)=>void)|undefined=undefined;
  private exitPromise:Promise<void>|undefined=undefined;private exitResolve:(()=>void)|undefined=undefined;private exiting:boolean=false;
  private control(operation:string):Promise<void>{
    if(this.operation)return Promise.reject(new Error('本机跟随正在准备'));
    this.operation=operation;return new Promise<void>((resolve:()=>void,reject:(error:Error)=>void):void=>{this.resolve=resolve;this.reject=reject;const token=this.epoch;this.timer=setTimeout(()=>{if(token===this.epoch)this.fail('本机跟随准备超时');},30000);});
  }
  private finish():void{if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;this.operation='';const resolve=this.resolve;this.resolve=undefined;this.reject=undefined;resolve?.();}
  async prepare(directory:string):Promise<void>{
    this.close();const token=this.epoch;const pending=this.control('loaded');
    void Promise.all(LocalFollowASR.draining).then(():void=>{
      if(token!==this.epoch)return;
      try{
        const port=new worker.ThreadWorker('entry/ets/workers/PrompterWorker.ets');this.port=port;this.exiting=false;
        this.exitPromise=new Promise<void>((resolve:()=>void):void=>{this.exitResolve=resolve;});const exit=this.exitPromise,releaseExit=this.exitResolve;let exitSeen=false;
        port.onexit=():void=>{if(exitSeen)return;exitSeen=true;LocalFollowASR.draining=LocalFollowASR.draining.filter((p:Promise<void>):boolean=>p!==exit);releaseExit?.();if(token===this.epoch&&!this.exiting)this.fail('本机跟随线程已退出');};
        port.onerror=():void=>{if(token===this.epoch)this.fail('本机跟随线程异常');};
        port.onmessage=(event:MessageEvents):void=>{if(token!==this.epoch)return;const reply=event.data as LocalFollowReply;if(reply.generation!==this.generation)return;
          if(reply.type==='error'){this.fail(reply.text);return;}
          if(reply.type===this.operation){
            if(reply.type==='loaded')this.ready=true;if(reply.type==='started')this.listening=true;
            if(reply.type==='finished'){
              if(this.pending.size){this.fail('本机识别音频未排空');return;}
              if(reply.text)this.onText(reply.text,true,reply.id);this.listening=false;
            }
            this.finish();return;
          }
          if(reply.type==='audio'){const bytes=this.pending.get(reply.sequence);if(bytes===undefined)return;this.pending.delete(reply.sequence);this.queued-=bytes;if(this.listening&&reply.text)this.onText(reply.text,reply.final,reply.id);}
        };
        const request=new LocalFollowRequest();request.cmd='load';request.directory=directory;request.generation=this.generation;port.postMessage(request);
      }catch(_){if(token===this.epoch)this.fail('本机跟随线程创建失败');}
    });return pending;
  }
  begin():Promise<void>{
    if(!this.ready||!this.port)return Promise.reject(new Error('本机跟随模型未就绪'));
    this.pause();const pending=this.control('started');const request=new LocalFollowRequest();request.cmd='start';request.generation=this.generation;
    try{this.port.postMessage(request);}catch(_){this.fail('本机跟随开始失败');}return pending;
  }
  append(pcm:Uint8Array):void{
    if(this.operation==='finished')return;
    if(!this.port||!this.ready||!this.listening&&this.operation!=='started')return;if(!pcm.length||pcm.length%2||pcm.length>4096||this.queued+pcm.length>64000){this.fail('本机跟随音频无效或积压超过两秒');return;}
    const request=new LocalFollowRequest();request.cmd='audio';request.generation=this.generation;request.sequence=++this.sequence;request.pcm=pcm.slice();
    this.pending.set(request.sequence,pcm.length);this.queued+=pcm.length;
    try{this.port.postMessage(request);}catch(_){this.fail('本机跟随音频发送失败');}finally{request.pcm.fill(0);}
  }
  finishInput():Promise<void>{
    if(!this.port||!this.ready||!this.listening)return Promise.reject(new Error('本机识别尚未开始'));
    const pending=this.control('finished');const request=new LocalFollowRequest();request.cmd='finish';request.generation=this.generation;
    try{this.port.postMessage(request);}catch(_){this.fail('本机识别封口失败');}return pending;
  }
  pause():void{
    this.generation++;this.listening=false;this.pending.clear();this.queued=0;
    if(this.operation==='started'||this.operation==='finished'){const reject=this.reject;this.resolve=undefined;this.reject=undefined;this.operation='';if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;reject?.(new Error('本机跟随已暂停'));}
    if(this.port&&this.ready){const request=new LocalFollowRequest();request.cmd='pause';request.generation=this.generation;try{this.port.postMessage(request);}catch(_){}}
  }
  private fail(note:string):void{const reject=this.reject;this.reject=undefined;this.resolve=undefined;this.close();reject?.(new Error(note));this.onError(note);}
  waitForExit():Promise<void>{return this.exiting&&this.exitPromise?this.exitPromise:Promise.resolve();}
  close():void{
    this.epoch++;this.pause();this.ready=false;if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;const reject=this.reject;this.reject=undefined;this.resolve=undefined;this.operation='';reject?.(new Error('本机跟随已取消'));
    const port=this.port;this.port=undefined;if(port&&!this.exiting){this.exiting=true;if(this.exitPromise)LocalFollowASR.draining.push(this.exitPromise);try{port.terminate();}catch(_){}}
  }
}
