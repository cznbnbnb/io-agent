// 转写引擎客户端：持有 AsrWorker 线程，把 load/transcribe 派到 Worker，
// 进度回帖映射回 LifelogASR 的 progress/note。只被 App 装配层（Index）引用，单测不加载本文件。
import { worker, MessageEvents, ErrorEvent } from '@kit.ArkTS';
import { AsrEngineHandle, LifelogTranscript } from './LifelogASR';
import { AsrWindowRequest } from './AsrWindows';
import { CodecCheckResult } from './LifelogPcmWindow';

interface EngineReply {
  type: string; jobId: number; progress: number; note: string; message: string;
  transcript: LifelogTranscript|undefined;codecReport:CodecCheckResult|undefined;
}
interface PendingJob { resolve: (reply:EngineReply) => void; reject: (e: Error) => void; timer: number }
interface EngineRequest { cmd:string;jobId:number;path:string;kind:string;filesDir:string;windowRequest:AsrWindowRequest|undefined; }
export class AsrWorkerLifecycle { clientId:number=0;state:string='';at:number=0;exitCode:number=-1; }

export class AsrEngineClient implements AsrEngineHandle {
  private static draining:AsrEngineClient[]=[];
  private static clientSequence:number=0;
  private clientId:number=++AsrEngineClient.clientSequence;
  lastNote: string = '';
  private seq: number = 0;
  private closed: boolean = false;
  private pending: Map<number, PendingJob> = new Map<number, PendingJob>();
  private workerPort: worker.ThreadWorker|undefined=undefined;
  private exited:boolean=false;
  private resolveExit:()=>void=():void=>{};
  private exitPromise:Promise<void>;
  private startPromise:Promise<void>=Promise.resolve();
  private onProgress: (progress: number, note: string) => void;
  private onLifecycle:(event:AsrWorkerLifecycle)=>void;

  constructor(filesDir: string, onProgress: (progress: number, note: string) => void,
    onLifecycle:(event:AsrWorkerLifecycle)=>void=(_event:AsrWorkerLifecycle):void=>{}) {
    this.onProgress = onProgress;
    this.onLifecycle=onLifecycle;this.exitPromise=new Promise<void>((resolve:()=>void):void=>{this.resolveExit=resolve;});
    if(AsrEngineClient.draining.length){this.emit('waiting_exit');this.startPromise=this.waitAndStart(filesDir);}
    else this.start(filesDir);
  }
  private emit(state:string,code:number=-1):void{
    const event=new AsrWorkerLifecycle();event.clientId=this.clientId;event.state=state;event.at=Date.now();event.exitCode=code;
    try{this.onLifecycle(event);}catch(_){/* Diagnostic failures must not release the native gate. */}
  }
  private async waitAndStart(filesDir:string):Promise<void>{
    while(!this.closed&&AsrEngineClient.draining.length){
      await Promise.all(AsrEngineClient.draining.map((client:AsrEngineClient):Promise<void>=>client.waitForExit()));
    }
    if(!this.closed)this.start(filesDir);
  }
  private start(filesDir:string):void{
    try{this.workerPort=new worker.ThreadWorker('entry/ets/workers/AsrWorker.ets');}
    catch(_){this.fail(new Error('转写线程创建失败'));return;}
    const port=this.workerPort;
    port.onexit=(code:number):void=>{
      if(this.exited)return;
      this.exited=true;AsrEngineClient.draining=AsrEngineClient.draining.filter((client:AsrEngineClient):boolean=>client!==this);
      this.emit('exit_confirmed',code);this.resolveExit();
      if(!this.closed)this.fail(new Error('转写线程已退出'));
    };
    port.onmessage = (e: MessageEvents): void => {
      if (this.closed) return;
      const m = e.data as EngineReply;
      if (!m) return;
      if (m.type === 'progress') { if (m.note) this.lastNote = m.note; this.onProgress(m.progress, m.note); return; }
      const job = this.pending.get(m.jobId);
      if (!job) return;
      this.pending.delete(m.jobId);
      if (job.timer !== -1) clearTimeout(job.timer);
      if (m.type === 'error') { job.reject(new Error(m.message || '转写失败')); return; }
      if (m.note) this.lastNote = m.note;
      job.resolve(m);
    };
    port.onerror = (error: ErrorEvent): void => {
      const reason = new Error('转写线程异常：' + (error.message || '未知'));
      this.fail(reason);
    };
    this.emit('created');
    try{port.postMessage({ cmd: 'init', jobId: 0, path: '', kind: '', filesDir });}
    catch(_){this.fail(new Error('转写线程初始化发送失败'));}
  }

  load(timeoutMs: number = 0): Promise<void> {
    return this.call('load', '', '', timeoutMs).then((): void => {});
  }

  close(): void {
    this.fail(new Error('转写服务已关闭'));
  }
  isClosed(): boolean { return this.closed; }
  isReady():boolean{return !this.closed&&this.workerPort!==undefined;}
  isExitConfirmed():boolean{return this.exited;}
  waitForExit():Promise<void>{return this.exitPromise;}

  // P12 diagnostics: same real ASR Worker queue, no model/audio processing.
  healthcheck(): Promise<void> { return this.call('health', '', '', 5000).then((): void => {}); }

  private fail(reason: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.pending.forEach((job: PendingJob): void => {
      if (job.timer !== -1) clearTimeout(job.timer);
      job.reject(reason);
    });
    this.pending.clear();
    if(!this.workerPort){this.exited=true;this.emit('closed_without_worker');this.resolveExit();return;}
    if(this.exited)return;
    AsrEngineClient.draining.push(this);this.emit('terminate_requested');
    try{this.workerPort.terminate();}catch(_){this.emit('terminate_request_failed');}
  }

  transcribe(path: string, kind: string, timeoutMs: number = 0): Promise<LifelogTranscript> {
    return this.call('transcribe', path, kind, timeoutMs).then((reply:EngineReply):LifelogTranscript=>this.transcriptReply(reply));
  }
  transcribeWindow(path:string,kind:string,request:AsrWindowRequest,timeoutMs:number=30000):Promise<LifelogTranscript>{
    return this.call('window',path,kind,timeoutMs,request).then((reply:EngineReply):LifelogTranscript=>this.transcriptReply(reply));
  }
  codecProbe(path:string):Promise<CodecCheckResult>{
    return this.call('codec_probe',path,'lifelog',30000).then((reply:EngineReply):CodecCheckResult=>{
      if(!reply.codecReport)throw new Error('CODEC_PROBE_REPLY_INVALID');return reply.codecReport;
    });
  }
  private transcriptReply(reply:EngineReply):LifelogTranscript{
    if(!reply.transcript)throw new Error('ASR_TRANSCRIPT_REPLY_INVALID');return reply.transcript;
  }

  private call(cmd: string, path: string, kind: string, timeoutMs: number = 0,windowRequest:AsrWindowRequest|undefined=undefined): Promise<EngineReply> {
    if (this.closed) return Promise.reject(new Error('转写服务已关闭，请重建线程'));
    const jobId = ++this.seq;
    return new Promise<EngineReply>((resolve: (reply:EngineReply) => void, reject: (e: Error) => void): void => {
      const timer = timeoutMs > 0 ? setTimeout((): void => this.fail(new Error('转写线程响应超时')), timeoutMs) : -1;
      this.pending.set(jobId, { resolve, reject, timer });
      const send=():void=>{
        if(this.closed||!this.pending.has(jobId))return;
        const request:EngineRequest={cmd,jobId,path,kind,filesDir:'',windowRequest};
        try{this.workerPort?.postMessage(request);}
        catch(_){this.fail(new Error('转写线程发送失败'));}
      };
      if(this.workerPort)send();else void this.startPromise.then(send);
    });
  }
}
