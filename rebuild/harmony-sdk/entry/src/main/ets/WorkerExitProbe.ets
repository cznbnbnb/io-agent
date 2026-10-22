import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { AsrEngineClient, AsrWorkerLifecycle } from './AsrEngine';
import { LifelogASR } from './LifelogASR';
import { LifelogWindowPipeline } from './LifelogWindowPipeline';
import { readTranscriptionSignals } from './TranscriptionSignals';
import { admitTranscription } from './TranscriptionBudget';
import { cloneDailyLabSource } from './DailyLabSourceClone';
import { probeSession } from './ProbeSession';

class ExitProbeReport {
  schema:number=1;kind:string='p22_native_exit_probe';started:number=0;finished:number=0;
  sourceSha256:string='';responseDeadlineMs:number=1000;modelLoadMs:number=0;
  timeoutObserved:boolean=false;exitConfirmed:boolean=false;replacementHealth:boolean=false;
  replacementCreatedAfterExit:boolean=false;budgetUsedMs:number=-1;budgetAccounting:string='unknown';
  phase:string='running';error:string='';events:AsrWorkerLifecycle[]=[];
}
class ExitProbeReplacement { client:AsrEngineClient|undefined=undefined; }
// Finite diagnostic with real recognition on a copied lab source. Never opens
// the microphone, publishes a transcript, dispatches a task or starts services.
export class WorkerExitProbe {
  private active:boolean=false;
  private cancelCurrent:()=>void=():void=>{};
  cancel():void{this.cancelCurrent();}
  async run(context:common.UIAbilityContext,base:string,from:string,name:string):Promise<string>{
    if(this.active)throw new Error('EXIT_PROBE_BUSY');this.active=true;
    const report=new ExitProbeReport();report.started=Date.now();
    const root=base+'/run-'+report.started;
    let original:AsrEngineClient|undefined=undefined;
    const replacement=new ExitProbeReplacement();
    let originalId=0,replacementId=0,armed=false,current=true,watchdog=-1;
    let cancelReject:(error:Error)=>void=(_error:Error):void=>{};
    const cancelled=new Promise<void>((_resolve:()=>void,reject:(error:Error)=>void):void=>{cancelReject=reject;});
    void cancelled.catch(():void=>{});
    this.cancelCurrent=():void=>{current=false;armed=false;original?.close();replacement.client?.close();cancelReject(new Error('EXIT_PROBE_CANCELLED'));};
    const asr=new LifelogASR();asr.initialize(context);asr.requireWorker=true;
    const persist=():void=>{
      const bytes=new util.TextEncoder().encodeInto(JSON.stringify(report));
      const file=fs.openSync(root+'/worker-exit-probe.json.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
      try{let at=0;while(at<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(at).buffer);if(n<=0)throw new Error('EXIT_PROBE_REPORT_WRITE');at+=n;}fs.fsyncSync(file.fd);}
      finally{fs.closeSync(file);bytes.fill(0);}fs.renameSync(root+'/worker-exit-probe.json.partial',root+'/worker-exit-probe.json');
    };
    const observe=(event:AsrWorkerLifecycle):void=>{
      if(report.events.length<40)report.events.push(event);asr.log('worker-client',JSON.stringify(event));
      if(!originalId&&event.state==='created')originalId=event.clientId;
      else if(event.state==='created'&&event.clientId!==originalId)replacementId=event.clientId;
      if(armed&&event.state==='terminate_requested'&&event.clientId===originalId){
        armed=false;replacement.client=new AsrEngineClient(context.filesDir,(_p:number,_n:string):void=>{},observe);
      }
      if(report.finished){try{persist();}catch(_){/* Original audio remains intact. */}}
    };
    try{
      const signals=await readTranscriptionSignals(context.filesDir);signals.conditions.foreground=probeSession.foreground;
      if(!current)throw new Error('EXIT_PROBE_CANCELLED');
      signals.conditions.bluetoothLease=probeSession.background.active;signals.conditions.workerReady=true;
      if(!admitTranscription(signals.conditions).allowed)throw new Error('EXIT_PROBE_CONDITIONS');
      report.sourceSha256=cloneDailyLabSource(base,from,root,name);persist();
      original=new AsrEngineClient(context.filesDir,(_p:number,_n:string):void=>{},observe);asr.engine=original;
      const before=Date.now();await asr.ensureExtracted();await original.load(30000);report.modelLoadMs=Date.now()-before;
      if(!current)throw new Error('EXIT_PROBE_CANCELLED');
      const pipeline=new LifelogWindowPipeline();pipeline.initialize(root);armed=true;
      const work=pipeline.next('asr-lifelog-'+name.slice(4),root+'/lifelog/'+name+'/audio.ogg',true,asr,'',signals.conditions,():boolean=>current,1000);
      const deadline=new Promise<void>((_resolve:()=>void,reject:(error:Error)=>void):void=>{
        watchdog=setTimeout(():void=>reject(new Error('EXIT_PROBE_UNCONFIRMED')),30000);
      });
      try{await Promise.race([work.then(():void=>{}),deadline,cancelled]);}
      catch(error){
        if((error as Error).message==='转写线程响应超时')report.timeoutObserved=true;
        else throw new Error((error as Error).message);
      }
      if(watchdog!==-1)clearTimeout(watchdog);watchdog=-1;armed=false;
      report.exitConfirmed=original.isExitConfirmed();
      if(replacement.client){await replacement.client.healthcheck();report.replacementHealth=true;}
      const oldExit=report.events.find((e:AsrWorkerLifecycle):boolean=>e.clientId===originalId&&e.state==='exit_confirmed');
      const newCreate=report.events.find((e:AsrWorkerLifecycle):boolean=>e.clientId===replacementId&&e.state==='created');
      report.replacementCreatedAfterExit=!!oldExit&&!!newCreate&&report.events.indexOf(newCreate)>report.events.indexOf(oldExit);
      const ledger=JSON.parse(fs.readTextSync(root+'/asr-worker-budget.json')) as Record<string,Object>;
      const rows=ledger['rows'] as Record<string,Object>[];
      if(rows.length===1){report.budgetUsedMs=rows[0]['usedMs'] as number;report.budgetAccounting=rows[0]['accounting'] as string;}
      report.phase=report.timeoutObserved&&report.exitConfirmed&&report.replacementHealth&&report.replacementCreatedAfterExit&&report.budgetAccounting==='measured'?'verified':'not_verified';
    }catch(error){report.phase='failed';const message=(error as Error).message;report.error=/^[A-Z0-9_]{1,100}$/.test(message)?message:'details_kept_private';}
    finally{
      armed=false;current=false;if(watchdog!==-1)clearTimeout(watchdog);
      original?.close();replacement.client?.close();report.finished=Date.now();this.active=false;this.cancelCurrent=():void=>{};
      if(fs.accessSync(root)){try{persist();}catch(_){report.phase='report_write_failed';}}
    }
    return report.phase;
  }
}
