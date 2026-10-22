import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { AgentCaptureState } from './AgentReplyCapture';

export class CaptureLabSnapshot {
  phase:string='unavailable';active:boolean=false;connected:boolean=false;foreground:boolean=false;applicable:boolean=false;
  attempt_sha256:string='';expected_binding:string='';expected_peer:string='';expected_connection:number=0;
  metrics_available:boolean=false;observation_restored:boolean=false;stop_submitted:boolean=false;worker_exited:boolean=false;input_sealed:boolean=false;
  exit_evidence:string='none';recorder_stop:string='not_attempted';exit_write:string='not_attempted';
  type1_packets:number=0;first_type1_at:number=0;mic_write_started_at:number=0;mic_write_completed_at:number=0;
  first_decoded_compressed_bytes:number=0;first_decoded_samples:number=0;capture_packets:number=0;pcm_bytes:number=0;nonzero_packets:number=0;
  compressed_packets:number=0;compressed_bytes:number=0;repeated_compressed_packets:number=0;last_compressed_sha256:string='';
  first_audio_at:number=0;last_audio_at:number=0;stop_requested_at:number=0;input_sealed_at:number=0;pcm_rms:number=0;pcm_peak:number=0;
  tail_packets:number=0;tail_pcm_bytes:number=0;late_audio_packets:number=0;exit_reason:number=-1;transcript_status:string='none';boundary_evidence:string='none';
}
export interface CaptureLabPorts {
  state:()=>AgentCaptureState;active:()=>boolean;originalPeer:()=>string;generation:()=>number;
  peer:()=>string;connection:()=>number;connected:()=>boolean;foreground:()=>boolean;
  stop:()=>Promise<void>;cleanup:()=>Promise<void>;
  command:(priority:boolean)=>string|undefined;receipt:(id:string)=>string|undefined;save:(id:string,json:string)=>void;
}
class LabRequest {
  schema:number=1;id:string='';action:string='';expires_at:number=0;expected_binding:string='';expected_peer:string='';expected_connection:number=0;
}
class LabReceipt {
  schema:number=1;id:string='';request_json:string='';state:string='running';error:string='';snapshot:CaptureLabSnapshot=new CaptureLabSnapshot();control_call_completed:boolean=false;
}
function hash(text:string):string {
  const bytes=new util.TextEncoder().encodeInto(text),md=cryptoFramework.createMd('SHA256');
  try{md.updateSync({data:bytes});const result=md.digestSync().data;try{return Array.from(result).map((value:number):string=>value.toString(16).padStart(2,'0')).join('');}finally{result.fill(0);}}finally{bytes.fill(0);}
}
function count(value:number):number{return Number.isSafeInteger(value)&&value>=0?value:0;}
function amplitude(value:number):number{return Number.isFinite(value)&&value>=0&&value<=32768?value:0;}
function writeState(value:string):string{return ['not_attempted','pending','submitted','failed'].includes(value)?value:'not_attempted';}

// A separate stop-priority inbox. No start, task action, draft deletion or
// user-exit confirmation is reachable. Async ASR/native completion never holds
// the polling path; a running receipt is an outstanding call, not a device ACK.
export class AgentCaptureLabControl {
  private ports:CaptureLabPorts;private pending:Set<string>=new Set();private disposed:boolean=false;
  constructor(ports:CaptureLabPorts){this.ports=ports;}
  snapshot():CaptureLabSnapshot {
    const view=new CaptureLabSnapshot();
    try{
      view.connected=this.ports.connected()===true;view.foreground=this.ports.foreground()===true;view.active=this.ports.active()===true;
      const state=this.ports.state(),peer=this.ports.originalPeer(),generation=this.ports.generation(),connection=this.ports.connection();
      if(!state||typeof state.binding!=='string'||!/^capture-lab-[a-z0-9]{1,64}$/.test(state.binding)||
        !view.connected||typeof peer!=='string'||!peer||peer.length>256||/[\u0000-\u0020\u007f]/.test(peer)||peer!==this.ports.peer()||!Number.isSafeInteger(generation)||generation<0||!Number.isSafeInteger(connection)||connection<=0||
        !['idle','preparing','starting','listening','stopping','cleanup_pending','draft','failed','blocked'].includes(state.phase))return view;
      view.applicable=true;view.attempt_sha256=hash(state.binding);view.expected_peer=hash(peer);view.expected_connection=connection;
      view.expected_binding=hash(JSON.stringify(['capture-lab/1',state.binding,peer,generation,connection]));
      view.phase=['idle','preparing','starting','listening','stopping','cleanup_pending','draft','failed','blocked'].includes(state.phase)?state.phase:'unavailable';
      view.active=this.ports.active()===true;view.observation_restored=state.observationRestored===true;
      view.stop_submitted=state.stopSubmitted===true;view.worker_exited=state.workerExited===true;view.input_sealed=state.inputSealed===true;
      view.exit_evidence=['none','device_event','user_confirmation','legacy_record'].includes(state.exitEvidence)?state.exitEvidence:'none';
      view.recorder_stop=writeState(state.recorderStop);view.exit_write=writeState(state.exitWrite);
      view.transcript_status=['none','pending','complete','partial','cancelled','legacy'].includes(state.transcriptStatus)?state.transcriptStatus:'none';
      view.boundary_evidence=['none','device_event','quiet_after_stop','limit','cancelled'].includes(state.boundaryEvidence)?state.boundaryEvidence:'none';
      if(state.observationRestored===false){
        view.metrics_available=true;view.type1_packets=count(state.type1Packets);view.first_type1_at=count(state.firstType1At);
        view.mic_write_started_at=count(state.micWriteStartedAt);view.mic_write_completed_at=count(state.micWriteCompletedAt);
        view.first_decoded_compressed_bytes=count(state.firstDecodedCompressedBytes);view.first_decoded_samples=count(state.firstDecodedSamples);
        view.capture_packets=count(state.packets);view.pcm_bytes=count(state.pcmBytes);view.nonzero_packets=count(state.nonzeroPackets);
        view.compressed_packets=count(state.compressedPackets);view.compressed_bytes=count(state.compressedBytes);view.repeated_compressed_packets=count(state.repeatedCompressedPackets);
        view.last_compressed_sha256=typeof state.lastCompressedSha256==='string'&&/^[a-f0-9]{64}$/.test(state.lastCompressedSha256)?state.lastCompressedSha256:'';
        view.first_audio_at=count(state.firstAudioAt);view.last_audio_at=count(state.lastAudioAt);view.stop_requested_at=count(state.stopRequestedAt);view.input_sealed_at=count(state.inputSealedAt);
        view.pcm_rms=amplitude(state.pcmRms);view.pcm_peak=amplitude(state.pcmPeak);view.tail_packets=count(state.tailPackets);view.tail_pcm_bytes=count(state.tailPcmBytes);view.late_audio_packets=count(state.lateAudioPackets);
        view.exit_reason=Number.isSafeInteger(state.exitReason)&&state.exitReason>=1&&state.exitReason<=15?state.exitReason:-1;
      }
    }catch{const hidden=new CaptureLabSnapshot();hidden.connected=view.connected;hidden.foreground=view.foreground;hidden.active=true;return hidden;}
    return view;
  }
  private request(raw:string,priority:boolean):LabRequest {
    if(raw.length<1||raw.length>2048)throw new Error('LAB_COMMAND_INVALID');
    const value=JSON.parse(raw) as LabRequest,keys=Object.keys(value);
    if(keys.length!==7||!['schema','id','action','expires_at','expected_binding','expected_peer','expected_connection'].every((key:string):boolean=>keys.includes(key))||
      value.schema!==1||typeof value.id!=='string'||!/^cap-[a-f0-9]{32}$/.test(value.id)||!['status','stop','cleanup'].includes(value.action)||
      priority&&value.action!=='stop'||!priority&&value.action==='stop'||!Number.isSafeInteger(value.expires_at)||
      typeof value.expected_binding!=='string'||typeof value.expected_peer!=='string')throw new Error('LAB_COMMAND_INVALID');
    if(value.action==='status'){
      if(value.expected_binding||value.expected_peer||value.expected_connection!==0)throw new Error('LAB_COMMAND_INVALID');
    }else if(!/^[a-f0-9]{64}$/.test(value.expected_binding)||!/^[a-f0-9]{64}$/.test(value.expected_peer)||!Number.isSafeInteger(value.expected_connection)||value.expected_connection<=0)throw new Error('LAB_COMMAND_INVALID');
    return value;
  }
  private saved(raw:string,id:string):LabReceipt {
    if(raw.length<1||raw.length>16384)throw new Error('LAB_RECEIPT_INVALID');
    const value=JSON.parse(raw) as LabReceipt,keys=Object.keys(value);
    if(keys.length!==7||!['schema','id','request_json','state','error','snapshot','control_call_completed'].every((key:string):boolean=>keys.includes(key))||
      value.schema!==1||value.id!==id||typeof value.request_json!=='string'||!['running','complete','error','uncertain'].includes(value.state)||
      !['','LAB_COMMAND_EXPIRED','LAB_OPERATION_UNCERTAIN','LAB_OPERATION_BUSY','LAB_BINDING_CHANGED','LAB_NOT_FOREGROUND','LAB_PHASE_INVALID','LAB_CONTROL_FAILED','LAB_STOP_UNCONFIRMED','LAB_CLEANUP_UNCONFIRMED'].includes(value.error)||
      typeof value.control_call_completed!=='boolean'||!this.validSnapshot(value.snapshot))throw new Error('LAB_RECEIPT_INVALID');
    const body=JSON.parse(value.request_json) as LabRequest;
    if(this.request(value.request_json,body.action==='stop').id!==id||value.state==='running'&&(value.control_call_completed||!!value.error)||value.state==='complete'&&!!value.error)throw new Error('LAB_RECEIPT_INVALID');
    return value;
  }
  private validSnapshot(value:CaptureLabSnapshot):boolean {
    if(!value||typeof value!=='object')return false;
    const fields=JSON.parse(JSON.stringify(value)) as Record<string,Object>,defaults=JSON.parse(JSON.stringify(new CaptureLabSnapshot())) as Record<string,Object>;
    const keys=Object.keys(defaults);
    if(Object.keys(fields).length!==keys.length||!keys.every((key:string):boolean=>Object.keys(fields).includes(key)))return false;
    for(const key of keys){const actual=fields[key],sample=defaults[key];
      if(typeof actual!==typeof sample)return false;
      if(typeof actual==='number'){
        if(['pcm_rms','pcm_peak'].includes(key)){if(!Number.isFinite(actual)||actual<0||actual>32768)return false;}
        else if(key==='exit_reason'){if(!Number.isSafeInteger(actual)||actual < -1||actual>15)return false;}
        else if(!Number.isSafeInteger(actual)||actual<0)return false;
      }
    }
    if(!['unavailable','idle','preparing','starting','listening','stopping','cleanup_pending','draft','failed','blocked'].includes(value.phase)||
      !['none','device_event','user_confirmation','legacy_record'].includes(value.exit_evidence)||
      !['not_attempted','pending','submitted','failed'].includes(value.recorder_stop)||!['not_attempted','pending','submitted','failed'].includes(value.exit_write)||
      !['none','pending','complete','partial','cancelled','legacy'].includes(value.transcript_status)||!['none','device_event','quiet_after_stop','limit','cancelled'].includes(value.boundary_evidence))return false;
    if(![value.attempt_sha256,value.expected_binding,value.expected_peer,value.last_compressed_sha256].every((text:string):boolean=>text===''||/^[a-f0-9]{64}$/.test(text)))return false;
    if(value.applicable){if(!value.connected||value.expected_connection<1||![value.attempt_sha256,value.expected_binding,value.expected_peer].every((text:string):boolean=>/^[a-f0-9]{64}$/.test(text)))return false;}
    else if(keys.some((key:string):boolean=>!['active','connected','foreground'].includes(key)&&fields[key]!==defaults[key]))return false;
    if(value.metrics_available&&(!value.applicable||value.observation_restored))return false;
    const live=['type1_packets','first_type1_at','mic_write_started_at','mic_write_completed_at','first_decoded_compressed_bytes','first_decoded_samples','capture_packets','pcm_bytes','nonzero_packets','compressed_packets','compressed_bytes','repeated_compressed_packets','last_compressed_sha256','first_audio_at','last_audio_at','stop_requested_at','input_sealed_at','pcm_rms','pcm_peak','tail_packets','tail_pcm_bytes','late_audio_packets','exit_reason'];
    return value.metrics_available||live.every((key:string):boolean=>fields[key]===defaults[key]);
  }
  private assertCurrent(request:LabRequest):CaptureLabSnapshot {
    const view=this.snapshot();
    if(request.expires_at<=Date.now()||request.expires_at-Date.now()>60000)throw new Error('LAB_COMMAND_EXPIRED');
    if(!view.foreground)throw new Error('LAB_NOT_FOREGROUND');
    if(!view.applicable||view.expected_binding!==request.expected_binding||view.expected_peer!==request.expected_peer||view.expected_connection!==request.expected_connection)throw new Error('LAB_BINDING_CHANGED');
    if(!view.active||request.action==='stop'&&!['preparing','starting','listening','stopping'].includes(view.phase)||request.action==='cleanup'&&view.phase!=='cleanup_pending')throw new Error('LAB_PHASE_INVALID');
    return view;
  }
  private settle(request:LabRequest,raw:string,result:LabReceipt,error:string):void {
    this.pending.delete(request.id);if(this.disposed)return;
    try{
      const saved=this.ports.receipt(request.id);if(!saved)return;
      const current=this.saved(saved,request.id);if(current.request_json!==raw||current.state!=='running')return;
      const view=this.snapshot();result.control_call_completed=!error;
      // Successful local preparation cancellation/cleanup may advance the
      // generation. Execution used its full CAS; completion still belongs to
      // the same stable attempt, original peer and original connection.
      if(!view.applicable||view.attempt_sha256!==result.snapshot.attempt_sha256||view.expected_peer!==request.expected_peer||view.expected_connection!==request.expected_connection){result.state='uncertain';result.error='LAB_BINDING_CHANGED';result.snapshot=new CaptureLabSnapshot();}
      else{result.snapshot=view;result.state=error?'error':'complete';result.error=error;
        if(!error&&(view.active||!view.worker_exited||!view.input_sealed)){result.state='uncertain';result.error=request.action==='stop'?'LAB_STOP_UNCONFIRMED':'LAB_CLEANUP_UNCONFIRMED';}
      }
      this.ports.save(request.id,JSON.stringify(result));
    }catch{ /* Keep the durable running claim; never replay a possibly sent stop. */ }
  }
  private process(priority:boolean):void {
    let raw:string|undefined,request:LabRequest;
    try{raw=this.ports.command(priority);if(!raw)return;request=this.request(raw,priority);}catch{return;}
    try{
      const previous=this.ports.receipt(request.id);
      if(previous){const saved=this.saved(previous,request.id);if(saved.request_json!==raw)return;
        if(saved.state==='running'&&!this.pending.has(request.id)){saved.state='uncertain';saved.error='LAB_OPERATION_UNCERTAIN';saved.control_call_completed=false;saved.snapshot=new CaptureLabSnapshot();this.ports.save(request.id,JSON.stringify(saved));}return;}
      const result=new LabReceipt();result.id=request.id;result.request_json=raw;
      // Durable claim precedes even passive status collection and every stop.
      this.ports.save(request.id,JSON.stringify(result));
      if(request.expires_at<=Date.now()||request.expires_at-Date.now()>60000){result.state='error';result.error='LAB_COMMAND_EXPIRED';this.ports.save(request.id,JSON.stringify(result));return;}
      if(request.action==='status'){result.snapshot=this.snapshot();result.state='complete';this.ports.save(request.id,JSON.stringify(result));return;}
      if(this.pending.size>=8){result.state='error';result.error='LAB_OPERATION_BUSY';this.ports.save(request.id,JSON.stringify(result));return;}
      try{
        result.snapshot=this.assertCurrent(request); // No await before the underlying operation.
        this.pending.add(request.id);
        const work=request.action==='stop'?this.ports.stop():this.ports.cleanup();
        Promise.resolve(work).then(():void=>this.settle(request,raw!,result,''),():void=>this.settle(request,raw!,result,'LAB_CONTROL_FAILED'));
      }catch(error){this.pending.delete(request.id);result.state='error';result.error=['LAB_NOT_FOREGROUND','LAB_BINDING_CHANGED','LAB_PHASE_INVALID','LAB_COMMAND_EXPIRED'].includes((error as Error).message)?(error as Error).message:'LAB_CONTROL_FAILED';result.snapshot=new CaptureLabSnapshot();this.ports.save(request.id,JSON.stringify(result));}
    }catch{ /* Corrupt records, conflict or persistence failure cannot authorize work. */ }
  }
  poll():void{if(this.disposed)return;this.process(true);this.process(false);}
  dispose():void{this.disposed=true;this.pending.clear();}
}
