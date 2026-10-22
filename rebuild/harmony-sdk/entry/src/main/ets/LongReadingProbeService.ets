import { LongReadingProbe,ReadingRecord,ReadingView } from './LongReadingProbe';
import { teleprompter } from './TeleprompterService';
import { suggestionTests,notifications } from './NotificationService';
import { probeSession } from './ProbeSession';

class ReadingCommand {schema:number=1;id:string='';action:string='';expires_at:number=0;source_id:string='';}
class ReadingReceipt {schema:number=1;id:string='';request_json:string='';state:string='running';error:string='';record:ReadingRecord=new ReadingRecord();lens_verified:boolean=false;}
export class LongReadingProbeService {
  private probe:LongReadingProbe;private busy:boolean=false;
  private read:(name:string)=>string|undefined;private write:(name:string,json:string)=>void;
  constructor(read:(name:string)=>string|undefined,write:(name:string,json:string)=>void){
    this.read=read;this.write=write;
    const raw=read('reading-state.json');
    this.probe=new LongReadingProbe({now:()=>Date.now(),view:()=>this.view(),save:(r:ReadingRecord):void=>write('reading-state.json',JSON.stringify(r)),
      prepare:()=>teleprompter.prepare('正文稳定性验证：请只阅读，无需按键或手势。\n这段文字保持两分钟后由手机停止。\n本轮不收音、不发选择卡、不提交任务。',60,2,'local','正文稳定性验证'),
      control:(type:number)=>teleprompter.control(type),exit:()=>teleprompter.stopAndWait(),
      show:()=>suggestionTests.start('采用新价格吗？','点头采用，摇头修改。本轮只记录测试选择。',60),
      ack:()=>suggestionTests.acknowledge(0),remove:()=>suggestionTests.remove()
    },raw?JSON.parse(raw) as ReadingRecord:undefined);
  }
  private view():ReadingView{
    const v=new ReadingView();v.connected=probeSession.features.state.connected;v.foreground=probeSession.foreground;
    v.peer=v.connected?probeSession.peerDeviceId:'';v.connection=probeSession.auth.connectionGeneration;
    v.prompterPhase=teleprompter.phase;v.prompterActive=teleprompter.active;v.did=teleprompter.cleanupSessionId;v.resumeSequence=teleprompter.deviceResumeSequence;
    v.localBackSequence=teleprompter.deviceLocalBackSequence;v.localBackDid=teleprompter.deviceLocalBackDid;
    v.cardActive=suggestionTests.active;v.cardPhase=suggestionTests.phase;v.uid=suggestionTests.pendingUid;v.choice=suggestionTests.command;
    v.idle=!v.prompterActive&&!v.cardActive&&!suggestionTests.busy&&!probeSession.features.launcherBusy&&!probeSession.agentSuggestionOccupied&&!probeSession.agentCaptureOccupied&&
      !notifications.occupied&&!probeSession.voice.active&&!probeSession.voice.pendingWrites&&!probeSession.features.displayActive&&!probeSession.recordingOccupied()&&!probeSession.lifelogOccupied();
    return v;
  }
  private valid(r:ReadingCommand):boolean{
    if(!r||r.schema!==1||!/^read-[a-f0-9]{32}$/.test(r.id)||!['start','check','status','stop'].includes(r.action)||
      !Number.isSafeInteger(r.expires_at)||r.expires_at>Date.now()+120000)return false;
    const allowed=['schema','id','action','expires_at'];
    if(r.action==='stop'){allowed.push('source_id');if(!/^read-[a-f0-9]{32}$/.test(r.source_id)||r.source_id===r.id)return false;}
    return Object.keys(r).length===allowed.length&&Object.keys(r).every((key:string):boolean=>allowed.includes(key));
  }
  dispose():void{this.probe.dispose();}
  async poll():Promise<void>{
    if(this.busy)return;this.busy=true;
    try{
      await this.probe.tick();
      const raw=this.read('reading-command.json');if(!raw||raw.length>1024)return;
      const r=JSON.parse(raw) as ReadingCommand;if(!this.valid(r))return;
      const canonical=JSON.stringify(r),prior=this.read(r.id+'.json');
      if(prior){
        const old=JSON.parse(prior) as ReadingReceipt;
        if(old.request_json===canonical&&old.state==='running'){old.state='uncertain';old.error='INTERRUPTED_NO_REPLAY';old.record=this.probe.record;this.write(r.id+'.json',JSON.stringify(old));}
        return;
      }
      const receipt=new ReadingReceipt();receipt.id=r.id;receipt.request_json=canonical;
      this.write(r.id+'.json',JSON.stringify(receipt));
      try{
        if(r.expires_at<=Date.now())throw new Error('READING_EXPIRED');
        // Restore only the fixed, text-only check after the normal prompter
        // path passed running/pause/continue and exact-owner stop on 124.
        // The interactive handoff remains gated until its mirror acceptance.
        if(r.action==='start')throw new Error('READING_PROBE_SUSPENDED');
        if(r.action==='check')await this.probe.start(r.id,true);
        if(r.action==='stop')await this.probe.stop(r.source_id);
        receipt.state='complete';
      }catch(error){receipt.state='error';const reason=(error as Error).message;receipt.error=/^[A-Z_]+$/.test(reason)?reason:'READING_COMMAND_FAILED';}
      receipt.record=this.probe.record;this.write(r.id+'.json',JSON.stringify(receipt));
    }finally{this.busy=false;}
  }
}
