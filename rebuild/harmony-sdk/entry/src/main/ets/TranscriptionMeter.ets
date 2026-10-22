import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';

class WorkerReservation {
  id:number=0;started:number=0;finished:number=0;reservedMs:number=0;usedMs:number=0;
  exitPending:boolean=false;accounting:string='reserved';
}
class MeterSnapshot { schema_version:number=1;sequence:number=0;rows:WorkerReservation[]=[]; }

// Reserve before dispatch, settle after the complete Worker call (including
// model load and decoder replay). A killed process leaves its reservation in
// the rolling window, so restarting cannot manufacture a fresh power budget.
export class TranscriptionMeter {
  private path:string='';private state:MeterSnapshot=new MeterSnapshot();
  static readonly windowMs:number=60000;
  static readonly maximumMs:number=20000;
  initialize(filesDir:string):void{
    this.path=filesDir+'/asr-worker-budget.json';
    if(!fs.accessSync(this.path)){this.state=new MeterSnapshot();return;}
    if(fs.statSync(this.path).size>65536)throw new Error('ASR_BUDGET_CORRUPT');
    const state=JSON.parse(fs.readTextSync(this.path)) as MeterSnapshot;
    if(state.schema_version!==1||!Number.isSafeInteger(state.sequence)||state.sequence<0||!Array.isArray(state.rows)||state.rows.length>100)throw new Error('ASR_BUDGET_CORRUPT');
    const ids:number[]=[];
    for(const row of state.rows){
      if(!Number.isSafeInteger(row.id)||row.id<=0||row.id>state.sequence||ids.includes(row.id)||
        !Number.isSafeInteger(row.started)||row.started<0||!Number.isSafeInteger(row.finished)||row.finished<0||
        (row.finished>0&&row.finished<row.started)||!Number.isSafeInteger(row.reservedMs)||row.reservedMs<1||row.reservedMs>TranscriptionMeter.maximumMs||
        !Number.isSafeInteger(row.usedMs)||row.usedMs<0||row.usedMs>86400000||
        (row.exitPending!==undefined&&typeof row.exitPending!=='boolean')||
        (row.accounting!==undefined&&!['reserved','exit_pending','measured','orphan_conservative'].includes(row.accounting))||
        (row.exitPending===true&&row.finished>0))throw new Error('ASR_BUDGET_CORRUPT');
      ids.push(row.id);
    }
    this.state=state;
  }
  private validateTime(now:number):void{if(!Number.isSafeInteger(now)||now<0)throw new Error('ASR_BUDGET_TIME_INVALID');}
  private active(row:WorkerReservation,now:number):boolean{
    if(!row.finished&&row.exitPending===true)return true;
    return (row.finished||row.started)+TranscriptionMeter.windowMs>now;
  }
  used(now:number):number{
    this.validateTime(now);
    return this.state.rows.filter((row:WorkerReservation):boolean=>this.active(row,now))
      .reduce((sum:number,row:WorkerReservation):number=>sum+(row.finished?row.usedMs:row.exitPending?Math.max(TranscriptionMeter.maximumMs,row.usedMs):row.reservedMs),0);
  }
  remaining(now:number):number{return Math.max(0,TranscriptionMeter.maximumMs-this.used(now));}
  // A prediction only; reserve() must recheck capacity at dispatch. Zero means
  // native exit has no known deadline, so callers keep a bounded fallback.
  nextAvailableAt(now:number,requestedMs:number=15000):number{
    this.validateTime(now);
    if(!Number.isSafeInteger(requestedMs)||requestedMs<1000||requestedMs>TranscriptionMeter.maximumMs)throw new Error('ASR_BUDGET_REQUEST_INVALID');
    if(this.state.rows.some((row:WorkerReservation):boolean=>!row.finished&&row.exitPending===true))return 0;
    if(!this.hasReservation(now)&&this.remaining(now)>=requestedMs)return now;
    const ends=this.state.rows.filter((row:WorkerReservation):boolean=>this.active(row,now))
      .map((row:WorkerReservation):number=>(row.finished||row.started)+TranscriptionMeter.windowMs).sort((a:number,b:number):number=>a-b);
    for(const at of ends)if(!this.hasReservation(at)&&this.remaining(at)>=requestedMs)return at;
    return 0;
  }
  hasReservation(now:number):boolean{
    this.validateTime(now);return this.state.rows.some((row:WorkerReservation):boolean=>!row.finished&&this.active(row,now));
  }
  reserve(now:number,requestedMs:number=15000):number{
    this.validateTime(now);
    if(!this.path)throw new Error('ASR_BUDGET_NOT_INITIALIZED');
    if(!Number.isSafeInteger(requestedMs)||requestedMs<1000||requestedMs>TranscriptionMeter.maximumMs||this.remaining(now)<requestedMs)throw new Error('ASR_BUDGET_EXHAUSTED');
    if(this.hasReservation(now))throw new Error('ASR_BUDGET_BUSY');
    const next=JSON.parse(JSON.stringify(this.state)) as MeterSnapshot;
    next.rows=next.rows.filter((row:WorkerReservation):boolean=>this.active(row,now));
    if(next.rows.length>=100)throw new Error('ASR_BUDGET_FULL');
    const row=new WorkerReservation();row.id=++next.sequence;row.started=now;row.reservedMs=requestedMs;next.rows.push(row);
    this.publish(next);return row.id;
  }
  settle(id:number,finished:number,elapsedMs:number):void{
    this.validateTime(finished);
    if(!Number.isSafeInteger(elapsedMs)||elapsedMs<0||elapsedMs>86400000)throw new Error('ASR_BUDGET_TIME_INVALID');
    const next=JSON.parse(JSON.stringify(this.state)) as MeterSnapshot;
    const row=next.rows.find((saved:WorkerReservation):boolean=>saved.id===id);
    if(!row)throw new Error('ASR_BUDGET_RESERVATION_MISSING');
    if(row.finished)return;
    // Backwards wall clock never frees the reservation early. elapsedMs should
    // come from a monotonic device clock at the coordinator boundary.
    row.finished=Math.max(1,row.started,finished);row.usedMs=elapsedMs;row.exitPending=false;row.accounting='measured';
    this.publish(next);
  }
  markExitPending(id:number,elapsedMs:number):void{
    if(!Number.isSafeInteger(elapsedMs)||elapsedMs<0||elapsedMs>86400000)throw new Error('ASR_BUDGET_TIME_INVALID');
    const next=JSON.parse(JSON.stringify(this.state)) as MeterSnapshot;
    const row=next.rows.find((saved:WorkerReservation):boolean=>saved.id===id);
    if(!row)throw new Error('ASR_BUDGET_RESERVATION_MISSING');if(row.finished)return;
    row.exitPending=true;row.usedMs=Math.max(row.usedMs,elapsedMs);row.accounting='exit_pending';this.publish(next);
  }
  // Startup recovery cannot know when the old process stopped native work.
  // Charge at least a full allowance and a fresh cooldown, explicitly uncertain.
  // Live-process native exclusion remains the AsrEngineClient onexit gate.
  recoverOrphans(now:number):void{
    this.validateTime(now);const next=JSON.parse(JSON.stringify(this.state)) as MeterSnapshot;let changed=false;
    for(const row of next.rows){if(!row.finished){
      row.finished=Math.max(1,row.started,now);row.usedMs=Math.max(TranscriptionMeter.maximumMs,row.usedMs);
      row.exitPending=false;row.accounting='orphan_conservative';changed=true;
    }}
    if(changed)this.publish(next);
  }
  private publish(next:MeterSnapshot):void{
    const bytes=new util.TextEncoder().encodeInto(JSON.stringify(next));
    const file=fs.openSync(this.path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('ASR_BUDGET_WRITE_FAILED');offset+=n;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}
    fs.renameSync(this.path+'.partial',this.path);this.state=next;
  }
}
