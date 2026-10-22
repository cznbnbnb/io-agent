import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { readLauncherEnvelope } from 'turbo_core';
import { TaskReplyBinding,TaskReplySubmission,taskReplyBindingValid } from './TaskReplyDraft';
import { TaskVoiceSourceRef,taskVoiceSourceValid,taskSameVoiceSource } from './TaskVoiceSourceRef';
import { TaskEnvelope,TaskAnswerBody,taskBodyValid,taskId,taskStamp } from './TaskWire';
import { TaskRecordingOrigin,taskRecordingOriginValid,taskSameRecordingOrigin } from './TaskRecordingTypes';

export class TaskVoiceConnection {peer:string='';epoch:number=0;}
export class TaskVoiceSourceView {
  state:string='missing';reason:string='';attempt_id:string='';binding_sha256:string='';text_sha256:string='';
  late_packets:number=0;dispatch_started:boolean=false;delivery_uncertain:boolean=false;
}
// Receipts contain hashes and delivery identity only, never transcript/audio or
// copies of the original question. They survive clearing the capture journal.
class VoiceSourceRecord {
  ref:TaskVoiceSourceRef=new TaskVoiceSourceRef();operation_id:string='';context_sha256:string='';target_sha256:string='';expires_at:string='';
  state:string='unknown';late_packets:number=0;pinned:boolean=false;pinned_payload_sha256:string='';
  dispatch_started:boolean=false;dispatch_event_sha256:string='';delivery_uncertain:boolean=false;
  recording_origin:TaskRecordingOrigin|null=null;
}
class VoiceSourceFile {schema:number=2;records:VoiceSourceRecord[]=[];}
class VoiceSourceIoError {code:string|number=0;}
const SOURCE_BYTES:number=1048576;
const SOURCE_RECORDS:number=128;

export class TaskVoiceSources {
  connection:()=>TaskVoiceConnection=():TaskVoiceConnection=>new TaskVoiceConnection();
  assertRecordingOrigin:(origin:TaskRecordingOrigin,textSha256:string)=>void=():void=>{throw new Error('TASK_RECORDING_SOURCE_UNAVAILABLE');};
  changed:()=>void=():void=>{};blocked:boolean=false;
  private file:string='';private boot:string='';private records:VoiceSourceRecord[]=[];
  private priorPresent:boolean=false;private priorBytes:number=0;private priorHash:string='';
  private hash(bytes:Uint8Array):string {
    const md=cryptoFramework.createMd('SHA256');md.updateSync({data:bytes});const out=md.digestSync().data;
    try{return Array.from(out).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}finally{out.fill(0);}
  }
  private textHash(text:string):string {const bytes=new util.TextEncoder().encodeInto(text);try{return this.hash(bytes);}finally{bytes.fill(0);}}
  private notify():void {try{this.changed();}catch{ /* A view callback is not receipt evidence. */ }}
  private hashValid(value:string):boolean {return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
  private exists(path:string):boolean {
    try{fs.lstatSync(path);return true;}catch(error){const code=(error as VoiceSourceIoError).code;
      if(code==='ENOENT'||code===13900002)return false;throw new Error('TASK_VOICE_SOURCE_IO');}
  }
  private length(path:string):number {
    const stat=fs.lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<1||stat.size>SOURCE_BYTES)throw new Error('TASK_VOICE_SOURCE_SIZE');return stat.size;
  }
  private raw(path:string):Uint8Array {
    const size=this.length(path),bytes=new Uint8Array(size),file=fs.openSync(path,fs.OpenMode.READ_ONLY);let complete:boolean=false;
    try{let at=0;while(at<size){const part=new Uint8Array(Math.min(16384,size-at));try{
      const n=fs.readSync(file.fd,part.buffer,{length:part.length});if(!Number.isSafeInteger(n)||n<1||n>part.length)throw new Error('TASK_VOICE_SOURCE_READ');bytes.set(part.subarray(0,n),at);at+=n;
    }finally{part.fill(0);}}
      const extra=new Uint8Array(1);try{if(fs.readSync(file.fd,extra.buffer,{length:1})!==0)throw new Error('TASK_VOICE_SOURCE_STALE');}finally{extra.fill(0);}
      if(this.length(path)!==size)throw new Error('TASK_VOICE_SOURCE_STALE');complete=true;return bytes;
    }finally{fs.closeSync(file);if(!complete)bytes.fill(0);}
  }
  private copy(records:VoiceSourceRecord[]):VoiceSourceRecord[] {return JSON.parse(JSON.stringify(records)) as VoiceSourceRecord[];}
  private refCopy(ref:TaskVoiceSourceRef):TaskVoiceSourceRef {return JSON.parse(JSON.stringify(ref)) as TaskVoiceSourceRef;}
  private validate(file:VoiceSourceFile):void {
    if(!file||Object.keys(file).length!==2||![1,2].includes(file.schema)||!Array.isArray(file.records)||file.records.length>SOURCE_RECORDS)throw new Error('TASK_VOICE_SOURCE_CORRUPT');
    const attempts:string[]=[],pinned:string[]=[];
    for(const row of file.records){
      if(!row||Object.keys(row).length!==(file.schema===1?12:13)||file.schema===1&&Object.keys(row).includes('recording_origin')||
        file.schema===2&&row.recording_origin!==null&&(!taskRecordingOriginValid(row.recording_origin)||row.recording_origin.owner_id!==row.ref?.attempt_id||row.recording_origin.peer!==row.ref?.peer)||
        !taskVoiceSourceValid(row.ref)||!taskId(row.operation_id)||!this.hashValid(row.context_sha256)||!this.hashValid(row.target_sha256)||!taskStamp(row.expires_at)||
        !['watching','unknown','tainted'].includes(row.state)||!Number.isSafeInteger(row.late_packets)||row.late_packets<0||typeof row.pinned!=='boolean'||
        typeof row.dispatch_started!=='boolean'||typeof row.delivery_uncertain!=='boolean'||typeof row.pinned_payload_sha256!=='string'||typeof row.dispatch_event_sha256!=='string'||
        (row.pinned?!this.hashValid(row.pinned_payload_sha256):row.pinned_payload_sha256!=='')||
        (row.dispatch_started?!row.pinned||!this.hashValid(row.dispatch_event_sha256):row.dispatch_event_sha256!==''||row.delivery_uncertain)||
        row.state==='watching'&&(row.late_packets!==0||row.delivery_uncertain)||row.state==='tainted'&&row.late_packets<1||attempts.includes(row.ref.attempt_id))throw new Error('TASK_VOICE_SOURCE_CORRUPT');
      attempts.push(row.ref.attempt_id);if(row.pinned){if(pinned.includes(row.operation_id))throw new Error('TASK_VOICE_SOURCE_CORRUPT');pinned.push(row.operation_id);}
    }
  }
  initialize(filesDir:string):void {
    this.file=filesDir+'/task-voice-sources.json';this.boot='';this.records=[];this.priorPresent=false;this.priorBytes=0;this.priorHash='';this.blocked=false;
    try{
      if(typeof filesDir!=='string'||!filesDir)throw new Error('TASK_VOICE_SOURCE_DIRECTORY');
      const nonce=cryptoFramework.createRandom().generateRandomSync(16).data;
      try{if(nonce.length!==16)throw new Error('TASK_VOICE_SOURCE_RANDOM');this.boot='boot-'+Array.from(nonce).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}finally{nonce.fill(0);}
      if(this.exists(this.file+'.partial'))throw new Error('TASK_VOICE_SOURCE_PARTIAL');if(!this.exists(this.file))return;
      const bytes=this.raw(this.file);try{const data=JSON.parse(new util.TextDecoder('utf-8',{fatal:true}).decodeToString(bytes)) as VoiceSourceFile;
        this.validate(data);this.records=data.records;if(data.schema===1)for(const row of this.records)row.recording_origin=null;
        this.priorPresent=true;this.priorBytes=bytes.length;this.priorHash=this.hash(bytes);
      }finally{bytes.fill(0);}
      // Old refs retain their original boot component. Even a persisted
      // "watching" row therefore has effective state unknown after restart.
    }catch{this.blocked=true;}
  }
  private assertCurrent():void {
    if(this.blocked||!this.file||!this.boot)throw new Error('TASK_VOICE_SOURCE_BLOCKED');let checked:boolean=false;
    try{if(this.exists(this.file+'.partial'))throw new Error('TASK_VOICE_SOURCE_PARTIAL');this.checkMain();checked=true;
    }finally{if(!checked)this.blocked=true;}
  }
  private checkMain():void {
    const exists=this.exists(this.file);if(exists!==this.priorPresent)throw new Error('TASK_VOICE_SOURCE_STALE');
    if(exists){const bytes=this.raw(this.file);try{if(bytes.length!==this.priorBytes||this.hash(bytes)!==this.priorHash)throw new Error('TASK_VOICE_SOURCE_STALE');}finally{bytes.fill(0);}}
  }
  private publish(next:VoiceSourceRecord[]):void {
    this.assertCurrent();const value=new VoiceSourceFile();value.records=next;this.validate(value);
    const raw=JSON.stringify(value),bytes=new util.TextEncoder().encodeInto(raw);let committed:boolean=false;
    try{if(bytes.length>SOURCE_BYTES)throw new Error('TASK_VOICE_SOURCE_CAPACITY');
      const file=fs.openSync(this.file+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY);
      try{let at=0;while(at<bytes.length){const part=bytes.slice(at);try{const n=fs.writeSync(file.fd,part.buffer);if(!Number.isSafeInteger(n)||n<1||n>part.length)throw new Error('TASK_VOICE_SOURCE_WRITE');at+=n;}finally{part.fill(0);}}fs.fsyncSync(file.fd);}finally{fs.closeSync(file);}
      this.checkMain();
      fs.renameSync(this.file+'.partial',this.file);this.records=this.copy(next);this.priorPresent=true;this.priorBytes=bytes.length;this.priorHash=this.hash(bytes);committed=true;
    }finally{bytes.fill(0);if(!committed)this.blocked=true;}
  }
  private bindingHash(binding:TaskReplyBinding):string {
    if(!taskReplyBindingValid(binding))throw new Error('TASK_VOICE_SOURCE_BINDING');const r=binding.route;
    return this.textHash(JSON.stringify(['task-voice-binding/1',binding.schema,binding.context_key,binding.operation_id,binding.request_id,binding.request_revision,
      binding.task_id,r.computer_id,r.agent_id,r.project_id,r.session_id,binding.expires_at,binding.question,binding.mode,
      binding.options.map((o):string[]=>[o.option_id,o.label])]));
  }
  private speechHash(text:string):string {
    if(typeof text!=='string'||!text.trim()||text.length>65536)throw new Error('TASK_VOICE_SOURCE_TEXT');
    // Raw UTF8 hashes must not equate two different lone UTF16 surrogates.
    for(let i=0;i<text.length;i++){const n=text.charCodeAt(i);if(n>=0xd800&&n<=0xdbff){const low=text.charCodeAt(++i);if(!(low>=0xdc00&&low<=0xdfff))throw new Error('TASK_VOICE_SOURCE_TEXT');}
      else if(n>=0xdc00&&n<=0xdfff)throw new Error('TASK_VOICE_SOURCE_TEXT');}
    return this.textHash(text);
  }
  private targetHash(binding:TaskReplyBinding,textHash:string):string {
    const r=binding.route;return this.textHash(JSON.stringify(['task-voice-target/1',binding.request_id,binding.request_revision,binding.task_id,
      r.computer_id,r.agent_id,r.project_id,r.session_id,textHash]));
  }
  private eventTarget(body:TaskAnswerBody):string {
    const r=body.route;return this.textHash(JSON.stringify(['task-voice-target/1',body.request_id,body.request_revision,body.task_id,
      r.computer_id,r.agent_id,r.project_id,r.session_id,this.speechHash(body.text)]));
  }
  private epoch(epoch:number):string {return this.boot+':'+epoch.toString();}
  private live(ref:TaskVoiceSourceRef):boolean {
    const c=this.connection();return !!this.boot&&typeof c?.peer==='string'&&c.peer===ref.peer&&Number.isSafeInteger(c.epoch)&&c.epoch>0&&ref.connection_epoch===this.epoch(c.epoch);
  }
  private effective(row:VoiceSourceRecord):string {
    if(row.state==='tainted')return 'tainted';if(row.state!=='watching'||!this.live(row.ref))return 'unknown';
    if(row.recording_origin){try{this.assertRecordingOrigin(row.recording_origin,row.ref.text_sha256);}catch{return 'unknown';}}
    return 'watching';
  }
  private found(ref:TaskVoiceSourceRef):VoiceSourceRecord|undefined {return this.records.find((r:VoiceSourceRecord):boolean=>taskSameVoiceSource(r.ref,ref));}
  private make(binding:TaskReplyBinding,attempt:string,peer:string,text:string,epoch:string):VoiceSourceRecord {
    const row=new VoiceSourceRecord();row.ref.attempt_id=attempt;row.ref.peer=peer;row.ref.connection_epoch=epoch;
    row.ref.binding_sha256=this.bindingHash(binding);row.ref.text_sha256=this.speechHash(text);
    if(!taskVoiceSourceValid(row.ref))throw new Error('TASK_VOICE_SOURCE_REF');row.operation_id=binding.operation_id;row.context_sha256=this.textHash(binding.context_key);
    row.target_sha256=this.targetHash(binding,row.ref.text_sha256);row.expires_at=binding.expires_at;return row;
  }
  register(binding:TaskReplyBinding,attempt:string,peer:string,epoch:number,text:string):TaskVoiceSourceRef {
    return this.registerOrigin(binding,attempt,peer,epoch,text,null);
  }
  registerRecording(binding:TaskReplyBinding,attempt:string,peer:string,epoch:number,text:string,origin:TaskRecordingOrigin):TaskVoiceSourceRef {
    if(!taskRecordingOriginValid(origin)||origin.owner_id!==attempt||origin.peer!==peer)throw new Error('TASK_RECORDING_SOURCE_INVALID');
    return this.registerOrigin(binding,attempt,peer,epoch,text,origin);
  }
  private registerOrigin(binding:TaskReplyBinding,attempt:string,peer:string,epoch:number,text:string,origin:TaskRecordingOrigin|null):TaskVoiceSourceRef {
    this.assertCurrent();const c=this.connection();if(!Number.isSafeInteger(epoch)||epoch<1||c.peer!==peer||c.epoch!==epoch)throw new Error('TASK_VOICE_SOURCE_CONNECTION');
    const row=this.make(binding,attempt,peer,text,this.epoch(epoch));row.recording_origin=origin?JSON.parse(JSON.stringify(origin)) as TaskRecordingOrigin:null;
    if(row.recording_origin)this.assertRecordingOrigin(row.recording_origin,row.ref.text_sha256);
    row.state='watching';const prior=this.records.find((r:VoiceSourceRecord):boolean=>r.ref.attempt_id===attempt);
    if(prior){if(!taskSameVoiceSource(prior.ref,row.ref)||prior.operation_id!==row.operation_id||!taskSameRecordingOrigin(prior.recording_origin,row.recording_origin)||this.effective(prior)!=='watching')throw new Error('TASK_VOICE_SOURCE_REUSED');return this.refCopy(prior.ref);}
    if(this.records.some((r:VoiceSourceRecord):boolean=>r.pinned&&r.operation_id===binding.operation_id))throw new Error('TASK_VOICE_SOURCE_PINNED');
    if(this.records.length>=SOURCE_RECORDS)throw new Error('TASK_VOICE_SOURCE_CAPACITY');const next=this.copy(this.records);next.push(row);this.publish(next);this.notify();return this.refCopy(row.ref);
  }
  restore(binding:TaskReplyBinding,attempt:string,peer:string,text:string):TaskVoiceSourceRef {
    return this.restoreOrigin(binding,attempt,peer,text,null);
  }
  restoreRecording(binding:TaskReplyBinding,attempt:string,peer:string,text:string,origin:TaskRecordingOrigin):TaskVoiceSourceRef{
    if(!taskRecordingOriginValid(origin)||origin.owner_id!==attempt||origin.peer!==peer)throw new Error('TASK_RECORDING_SOURCE_INVALID');
    return this.restoreOrigin(binding,attempt,peer,text,origin);
  }
  private restoreOrigin(binding:TaskReplyBinding,attempt:string,peer:string,text:string,origin:TaskRecordingOrigin|null):TaskVoiceSourceRef{
    this.assertCurrent();const row=this.make(binding,attempt,peer,text,'restored:'+this.boot);row.recording_origin=origin?JSON.parse(JSON.stringify(origin)) as TaskRecordingOrigin:null;
    if(row.recording_origin)this.assertRecordingOrigin(row.recording_origin,row.ref.text_sha256);
    const prior=this.records.find((r:VoiceSourceRecord):boolean=>r.ref.attempt_id===attempt);
    if(prior){if(prior.ref.peer!==peer||prior.ref.binding_sha256!==row.ref.binding_sha256||prior.ref.text_sha256!==row.ref.text_sha256||prior.operation_id!==binding.operation_id||!taskSameRecordingOrigin(prior.recording_origin,row.recording_origin))throw new Error('TASK_VOICE_SOURCE_REUSED');
      if(prior.state==='watching'){const next=this.copy(this.records),old=next.find((r:VoiceSourceRecord):boolean=>r.ref.attempt_id===attempt);if(!old)throw new Error('TASK_VOICE_SOURCE_MISSING');old.state='unknown';old.delivery_uncertain=old.delivery_uncertain||old.dispatch_started;this.publish(next);this.notify();}return this.refCopy(prior.ref);
    }
    if(this.records.some((r:VoiceSourceRecord):boolean=>r.pinned&&r.operation_id===binding.operation_id))throw new Error('TASK_VOICE_SOURCE_PINNED');
    if(this.records.length>=SOURCE_RECORDS)throw new Error('TASK_VOICE_SOURCE_CAPACITY');const next=this.copy(this.records);next.push(row);this.publish(next);this.notify();return this.refCopy(row.ref);
  }
  private shape(answer:TaskReplySubmission):void {
    if(!answer||answer.record_schema!==2||!taskReplyBindingValid(answer.binding)||!['phone','voice','glasses_semantic'].includes(answer.input_source)||
      typeof answer.text!=='string'||answer.text.length>65536||(answer.option_id===null?!answer.text.trim():!answer.binding.options.some((o):boolean=>o.option_id===answer.option_id)))throw new Error('TASK_VOICE_SOURCE_ANSWER');
  }
  assertAnswer(answer:TaskReplySubmission):void {
    this.shape(answer);if(answer.input_source!=='voice'){if(answer.voice_source!==null)throw new Error('TASK_VOICE_SOURCE_ANSWER');return;}
    const ref=answer.voice_source;if(!ref||!taskVoiceSourceValid(ref))throw new Error('TASK_VOICE_SOURCE_UNKNOWN');this.assertCurrent();const row=this.found(ref);
    if(!row||row.operation_id!==answer.binding.operation_id||row.context_sha256!==this.textHash(answer.binding.context_key)||ref.binding_sha256!==this.bindingHash(answer.binding)||
      ref.text_sha256!==this.speechHash(answer.text)||row.target_sha256!==this.targetHash(answer.binding,ref.text_sha256)||this.effective(row)!=='watching')throw new Error('TASK_VOICE_SOURCE_UNKNOWN');
  }
  pin(answer:TaskReplySubmission):void {
    this.assertAnswer(answer);if(answer.input_source!=='voice'||!answer.voice_source)return;const row=this.found(answer.voice_source);if(!row)throw new Error('TASK_VOICE_SOURCE_MISSING');
    const payload=this.textHash(JSON.stringify([row.target_sha256,answer.option_id,'voice']));
    if(row.pinned){if(row.pinned_payload_sha256!==payload)throw new Error('TASK_VOICE_SOURCE_PINNED');return;}
    if(this.records.some((r:VoiceSourceRecord):boolean=>r.pinned&&r.operation_id===row.operation_id))throw new Error('TASK_VOICE_SOURCE_PINNED');
    const next=this.copy(this.records),copy=next.find((r:VoiceSourceRecord):boolean=>r.ref.attempt_id===row.ref.attempt_id);if(!copy)throw new Error('TASK_VOICE_SOURCE_MISSING');
    copy.pinned=true;copy.pinned_payload_sha256=payload;this.publish(next);this.notify();
  }
  beforeSend(operation:string,event:TaskEnvelope,contextKey:string):void {
    const body=event?.body as TaskAnswerBody;if(!body||body.input_source!=='voice')return;this.assertCurrent();
    if(!taskId(operation)||!event||Object.keys(event).length!==8||event.schema_version!=='1.0'||event.kind!=='answer'||!taskId(event.event_id)||!taskId(event.idempotency_key)||!taskId(event.producer_id)||
      !taskStamp(event.created_at)||!taskStamp(event.expires_at)||Date.parse(event.created_at)>=Date.parse(event.expires_at)||!taskBodyValid('answer',body)||Object.keys(body).length!==9||Object.keys(body.route).length!==4)throw new Error('TASK_VOICE_SOURCE_EVENT');
    const row=this.records.find((r:VoiceSourceRecord):boolean=>r.operation_id===operation&&r.pinned);
    if(!row||this.effective(row)!=='watching'||row.context_sha256!==this.textHash(contextKey)||this.eventTarget(body)!==row.target_sha256||
      row.pinned_payload_sha256!==this.textHash(JSON.stringify([row.target_sha256,body.option_id,'voice']))||Date.parse(event.expires_at)>Date.parse(row.expires_at))throw new Error('TASK_VOICE_SOURCE_UNKNOWN');
    const eventHash=this.textHash(JSON.stringify(['task-voice-event/1',event.schema_version,event.kind,event.event_id,event.idempotency_key,event.producer_id,event.created_at,event.expires_at,
      body.answer_id,row.target_sha256,body.option_id,body.input_source,body.raw_action]));
    if(row.dispatch_started){if(row.dispatch_event_sha256!==eventHash)throw new Error('TASK_VOICE_SOURCE_EVENT_CHANGED');return;}
    const next=this.copy(this.records),copy=next.find((r:VoiceSourceRecord):boolean=>r.ref.attempt_id===row.ref.attempt_id);if(!copy)throw new Error('TASK_VOICE_SOURCE_MISSING');
    copy.dispatch_started=true;copy.dispatch_event_sha256=eventHash;this.publish(next);this.notify();
    // A normal UI/state callback may synchronously disconnect or invalidate the
    // source. This is the last source check before the caller starts HTTP.
    this.assertCurrent();const current=this.found(row.ref);
    if(!current||this.effective(current)!=='watching'||current.dispatch_event_sha256!==eventHash)throw new Error('TASK_VOICE_SOURCE_UNKNOWN');
  }
  observe(peer:string,epoch:number,business:number,payload:Uint8Array):void {
    const c=this.connection();if(![13,14].includes(business)||!Number.isSafeInteger(epoch)||epoch<1||peer!==c.peer||epoch!==c.epoch||!this.boot)return;
    let matching=this.records.filter((r:VoiceSourceRecord):boolean=>r.state==='watching'&&r.ref.peer===peer&&r.ref.connection_epoch===this.epoch(epoch)&&
      (business===14?!!r.recording_origin:!r.recording_origin));if(!matching.length)return;
    try{const packet=readLauncherEnvelope(payload);if(packet.type<0)throw new Error('TASK_VOICE_SOURCE_ENVELOPE');if(packet.type!==3)return;
      if(business===14){const value=JSON.parse(new util.TextDecoder('utf-8',{fatal:true}).decodeToString(packet.json)) as Record<string,Object>;
        if(typeof value['uuid']!=='string')throw new Error('TASK_RECORDING_SOURCE_UUID');matching=matching.filter((r:VoiceSourceRecord):boolean=>r.recording_origin?.uuid===value['uuid']);}
    }catch{ /* Malformed same-session traffic cannot establish a safe source. */ }
    if(!matching.length)return;
    const next=this.copy(this.records);for(const row of next){if(!matching.some((r:VoiceSourceRecord):boolean=>taskSameVoiceSource(r.ref,row.ref)))continue;
      row.state='tainted';row.late_packets=Math.min(Number.MAX_SAFE_INTEGER,row.late_packets+1);row.delivery_uncertain=row.delivery_uncertain||row.dispatch_started;}
    // Never roll a failed invalidation back to watching in memory. A surviving
    // partial must stop cold readers from trusting the older canonical file.
    this.records=next;try{this.publish(next);}catch{this.blocked=true;}this.notify();
  }
  disconnected():void {
    const next=this.copy(this.records);let altered:boolean=false;
    for(const row of next)if(row.state==='watching'){row.state='unknown';row.delivery_uncertain=row.delivery_uncertain||row.dispatch_started;altered=true;}
    if(!altered)return;this.records=next;try{this.publish(next);}catch{this.blocked=true;}this.notify();
  }
  status(answer:TaskReplySubmission):TaskVoiceSourceView {
    const view=new TaskVoiceSourceView();if(!answer||answer.record_schema!==2){view.state='legacy';view.reason='legacy_record';return view;}
    if(answer.input_source!=='voice'){try{this.assertAnswer(answer);view.state=answer.input_source==='phone'?'independent_phone':'independent_choice';}catch{view.state='unknown';view.reason='answer_invalid';}return view;}
    const ref=answer.voice_source;if(!ref||!taskVoiceSourceValid(ref)){view.state='unknown';view.reason='source_unknown';return view;}
    // A different answer must not borrow a receipt's metadata merely by naming
    // its ref. Bind even read-only inspection to all original values.
    try{if(ref.binding_sha256!==this.bindingHash(answer.binding)||ref.text_sha256!==this.speechHash(answer.text))throw new Error('MISMATCH');}
    catch{view.reason='binding_mismatch';return view;}
    view.attempt_id=ref.attempt_id;view.binding_sha256=ref.binding_sha256;view.text_sha256=ref.text_sha256;const row=this.found(ref);
    if(!row){view.state=this.blocked?'blocked':'missing';view.reason=this.blocked?'store_protected':this.records.length>=SOURCE_RECORDS?'capacity':'receipt_missing';return view;}
    view.late_packets=row.late_packets;view.dispatch_started=row.dispatch_started;view.delivery_uncertain=row.delivery_uncertain||row.dispatch_started&&this.effective(row)!=='watching';
    try{this.assertAnswer(answer);view.state='watching';}catch{view.state=this.blocked?'blocked':this.effective(row);view.reason=this.blocked?'store_protected':'source_not_current';}return view;
  }
}
