import { systemDateTime } from '@kit.BasicServicesKit';
import { AsrWindowStore, AsrWindowCheckpoint } from './AsrWindowStore';
import { AsrWindowRequest } from './AsrWindows';
import { LifelogASR, LifelogTranscript, LifelogSpeaker, LifelogUtterance } from './LifelogASR';
import { TranscriptionMeter } from './TranscriptionMeter';
import { TranscriptionConditions, admitTranscription } from './TranscriptionBudget';

export class LifelogWindowStep {
  state:string='waiting';reason:string='';commitKey:string='';cursor:number=0;retryAt:number=0;
  result:LifelogTranscript|undefined=undefined;
}
// Private processing checkpoints; publication into MaterialStore remains a
// separate CAS step. A crash between these stages replays publication only.
export class LifelogWindowPipeline {
  private windows:AsrWindowStore=new AsrWindowStore();
  private meter:TranscriptionMeter=new TranscriptionMeter();
  initialize(filesDir:string):void{
    this.windows=new AsrWindowStore();this.windows.initialize(filesDir);
    this.meter=new TranscriptionMeter();this.meter.initialize(filesDir);this.meter.recoverOrphans(Date.now());
  }
  private waitBudget(step:LifelogWindowStep):LifelogWindowStep{
    const now=Date.now();step.reason='window_budget_exhausted';
    step.retryAt=this.meter.nextAvailableAt(now,15000)||now+60000;return step;
  }
  private aggregate(checkpoint:AsrWindowCheckpoint):LifelogTranscript{
    const out=new LifelogTranscript();const latest=checkpoint.windows[checkpoint.windows.length-1];
    if(!latest)return out;
    out.frames=latest.frames;out.seconds=latest.seconds;out.windowed=true;out.windowEndFrame=checkpoint.cursor;
    out.sourcePrefixBytes=latest.sourcePrefixBytes;out.sourcePrefixSha256=latest.sourcePrefixSha256;
    out.speakerProcessing=checkpoint.windows.some((row:LifelogTranscript):boolean=>row.speakerProcessing==='pending')?'pending':'unknown';
    out.boundaryProcessing=checkpoint.windows.every((row:LifelogTranscript):boolean=>['token_starts','no_speech'].includes(row.boundaryProcessing))?
      (checkpoint.windows.some((row:LifelogTranscript):boolean=>row.boundaryProcessing==='token_starts')?'token_starts':'no_speech'):'unverified';
    for(let i=0;i<checkpoint.windows.length;i++){
      const window=checkpoint.windows[i];
      // Cluster numbers are local to a window. Never imply the same cluster 0
      // from two windows is the same person. Keep identity unknown for P23.
      for(const speaker of window.speakers){
        const row=new LifelogSpeaker();row.index=i*1000+speaker.index;
        row.name=`第${i+1}窗·说话人${speaker.index+1}`;row.samples=speaker.samples;out.speakers.push(row);
      }
      for(const part of window.utterances){
        const row=JSON.parse(JSON.stringify(part)) as LifelogUtterance;
        row.speaker=part.speaker<0?-1:i*1000+part.speaker;out.utterances.push(row);
      }
    }
    out.utterances.sort((a:LifelogUtterance,b:LifelogUtterance):number=>a.start-b.start);
    out.speechSeconds=out.utterances.reduce((sum:number,row:LifelogUtterance):number=>sum+row.end-row.start,0);
    return out;
  }
  async next(id:string,path:string,sealed:boolean,asr:LifelogASR,appliedKey:string,
    conditions:TranscriptionConditions,isCurrent:()=>boolean,responseDeadlineMs:number=15000):Promise<LifelogWindowStep>{
    if(!Number.isSafeInteger(responseDeadlineMs)||responseDeadlineMs<1000||responseDeadlineMs>15000)throw new Error('ASR_RESPONSE_DEADLINE_INVALID');
    if(!isCurrent())throw new Error('ASR_LIFETIME_ENDED');
    let saved=this.windows.resume(id);const step=new LifelogWindowStep();
    const key=():string=>id+'-window-'+saved.cursor;
    const result=():LifelogWindowStep=>{
      const latest=saved.windows[saved.windows.length-1];step.cursor=saved.cursor;step.commitKey=key();step.result=this.aggregate(saved);
      step.state=sealed&&latest&&saved.cursor===latest.frames?'complete':'published';return step;
    };
    // This sealed result was already inferred but material/legacy publication
    // was interrupted. Budget or network must not force inference again.
    if(saved.windows.length&&appliedKey!==key())return result();
    const latest=saved.windows[saved.windows.length-1];
    if(sealed&&latest&&saved.cursor===latest.frames)return result();
    if(this.meter.hasReservation(Date.now()))return this.waitBudget(step);
    conditions.usedWorkerMs=this.meter.used(Date.now());
    const admission=admitTranscription(conditions);
    if(!admission.allowed){if(admission.reason==='window_budget_exhausted')return this.waitBudget(step);step.reason=admission.reason;return step;}
    // Do not dispatch the same full window with a leftover 1–14s allowance.
    // A successful prior window must not make the next one deterministically
    // time out and discard work. Wait for the full admission allowance.
    const deadline=15000;
    if(this.meter.remaining(Date.now())<deadline)return this.waitBudget(step);
    // A monotonic clock is required; a wall-clock adjustment cannot turn a
    // long model load into a zero-cost call.
    const monotonic=systemDateTime.getUptime(systemDateTime.TimeType.STARTUP,false);
    const meter=this.meter,engine=asr.engine;
    const reservation=meter.reserve(Date.now(),deadline);
    try{
      const request=new AsrWindowRequest();request.cursor=saved.cursor;request.sealed=sealed;
      // On-device background recognition of a 32s decode range exceeded 15s.
      // Keep continuous disjoint coverage, but admit a 10.02s core with 4.98s
      // context on each side. Original archives and old checkpoints are intact.
      request.coreFrames=167;request.contextFrames=83;
      // Immediate text and speaker analysis are separate stages. Long VAD
      // embeddings exceeded the daytime budget on device. Keep unknown labels
      // and an explicit pending state; P23 refinement is still required.
      request.includeSpeakers=false;
      if(latest){request.expectedPrefixBytes=latest.sourcePrefixBytes;request.expectedPrefixSha256=latest.sourcePrefixSha256;}
      const transcript=await asr.transcribeWindow(path,'lifelog',request,responseDeadlineMs);
      if(!isCurrent())throw new Error('ASR_LIFETIME_ENDED');
      saved=this.windows.append(id,saved.cursor,transcript);return result();
    }catch(error){
      if((error as Error).message==='ASR_WINDOW_WAITING_AUDIO'){step.reason='waiting_audio';return step;}
      throw new Error((error as Error).message);
    }finally{
      if(engine&&engine.isClosed()&&!engine.isExitConfirmed()){
        if(isCurrent()){
          meter.markExitPending(reservation,Math.max(0,Math.round(systemDateTime.getUptime(systemDateTime.TimeType.STARTUP,false)-monotonic)));
          asr.note='等待转写线程退出；原音与窗口保留';asr.changed();
        }
        await engine.waitForExit();
      }
      if(isCurrent()){
        const elapsed=Math.max(0,Math.round(systemDateTime.getUptime(systemDateTime.TimeType.STARTUP,false)-monotonic));
        meter.settle(reservation,Date.now(),elapsed);
      }
    }
  }
}
