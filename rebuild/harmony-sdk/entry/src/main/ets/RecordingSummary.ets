import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { MaterialRevision } from './MaterialStore';
import { LocalMaterialQuery,LocalMaterialReference } from './MaterialLocalQuery';
import { ServiceConfig } from './RemoteServices';
import { RecordingSummaryEntry,RecordingSummaryPiece,RecordingSummaryPlan,RecordingSummaryStepResult,
  recordingSummaryReference,buildRecordingSummaryPlan,recordingSummaryLeafInput,recordingSummaryMergeInput,
  parseRecordingSummaryStep,RECORDING_SUMMARY_PROMPT_VERSION,RECORDING_SUMMARY_SYSTEM } from './RecordingSummaryPlan';

export class RecordingSummaryPreview {
  schema:number=1;text_units:number=0;pieces:number=0;leaf_count:number=0;max_calls:number=30;transcription_state:string='';
}
export class RecordingSummaryView {
  schema:number=1;job_id:string='';state_sha256:string='';phase:string='missing';note:string='';
  source:LocalMaterialReference=new LocalMaterialReference();model:string='';generated_at:string='';
  text_units:number=0;piece_count:number=0;leaf_count:number=0;step_count:number=0;completed_steps:number=0;
  calls_used:number=0;max_calls:number=30;can_resume:boolean=false;transcription_state:string='';entries:RecordingSummaryEntry[]=[];
}
export class RecordingSummaryList {
  items:RecordingSummaryView[]=[];next_cursor:string='';has_more:boolean=false;snapshot_sha256:string='';scanned:number=0;
  incomplete:boolean=false;incomplete_reason:string='';
}
export class RecordingSummaryChunk {
  job_id:string='';state_sha256:string='';format:string='';text:string='';offset:number=0;next_offset:number=0;total_utf16:number=0;has_more:boolean=false;
}
export interface RecordingSummaryPorts {
  root:()=>string;read:(id:string)=>MaterialRevision|undefined;foreground:()=>boolean;config:()=>Promise<ServiceConfig>;
  request:(config:ServiceConfig,system:string,input:string)=>Promise<string>;cancel:()=>void;now:()=>number;
}
class SummaryRecord {
  schema:number=1;job_id:string='';sequence:number=0;previous_sha256:string='';source:LocalMaterialReference=new LocalMaterialReference();
  model:string='';endpoint_sha256:string='';pipeline_version:string=RECORDING_SUMMARY_PROMPT_VERSION;
  created_at:string='';updated_at:string='';generated_at:string='';text_units:number=0;piece_count:number=0;leaf_count:number=0;step_count:number=0;
  calls_used:number=0;phase:string='queued';note:string='';outputs:RecordingSummaryStepResult[]=[];attempts:number[]=[];uncertain:boolean=false;
}
class CheckedJob {
  record:SummaryRecord|undefined=undefined;sha:string='';pending:SummaryRecord|undefined=undefined;pendingText:string='';
  directory:string='';bytes:number=0;blocked:boolean=false;
}
class SummaryStep {ids:string[]=[];left:number=-1;right:number=-1;}
class SummaryExport {
  schema:number=1;kind:string='recording_summary';job_id:string='';state_sha256:string='';source:LocalMaterialReference=new LocalMaterialReference();
  model:string='';generated_at:string='';transcription_state:string='';coverage_note:string='仅覆盖当前转写文字，不证明音频完整或内容已核实';
  entries:RecordingSummaryEntry[]=[];citations:RecordingSummaryPiece[]=[];
}
const MAX_FILE:number=2*1024*1024,MAX_JOB:number=16*1024*1024,MAX_STATES:number=96,MAX_JOBS:number=128,MAX_CALLS:number=30;
function summaryError(code:string):Error{return new Error('RECORDING_SUMMARY_'+code);}
function copyRecord(value:SummaryRecord):SummaryRecord{return JSON.parse(JSON.stringify(value)) as SummaryRecord;}
function copyRef(value:LocalMaterialReference):LocalMaterialReference{return JSON.parse(JSON.stringify(value)) as LocalMaterialReference;}
function sha(value:string):string{
  const bytes=new util.TextEncoder().encodeInto(value),md=cryptoFramework.createMd('SHA256');
  try{md.updateSync({data:bytes});const hash=md.digestSync().data;try{return Array.from(hash).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}finally{hash.fill(0);}}
  finally{bytes.fill(0);}
}
function idValid(value:string):void{if(typeof value!=='string'||!/^rsum-[a-f0-9]{32}$/.test(value))throw summaryError('INVALID');}
function shaValid(value:string):void{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw summaryError('INVALID');}
function unicode(value:string):boolean{
  for(let at=0;at<value.length;at++){const c=value.charCodeAt(at);if(c>=0xd800&&c<=0xdbff){const next=value.charCodeAt(++at);if(!(next>=0xdc00&&next<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true;
}
function utc(value:string):boolean{return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
export function newRecordingSummaryId():string{
  const bytes=cryptoFramework.createRandom().generateRandomSync(16).data;
  try{return 'rsum-'+Array.from(bytes).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}finally{bytes.fill(0);}
}
export function sameRecordingSummaryReference(a:LocalMaterialReference,b:LocalMaterialReference):boolean{
  if(!a||!b||a.material_id!==b.material_id||a.revision!==b.revision||a.text_revision!==b.text_revision||a.utterance_id!==b.utterance_id||a.content_sha256!==b.content_sha256)return false;
  const left=a.source_range,right=b.source_range;if(left===undefined||right===undefined)return left===right;
  return !!left&&!!right&&left.parent_utterance_id===right.parent_utterance_id&&left.parent_revision===right.parent_revision&&
    left.start_ms===right.start_ms&&left.end_ms===right.end_ms&&left.text_start===right.text_start&&left.text_end===right.text_end;
}
function steps(plan:RecordingSummaryPlan):SummaryStep[]{
  const out:SummaryStep[]=[];let level:number[]=[];
  for(const ids of plan.leaves){const step=new SummaryStep();step.ids=ids.slice();level.push(out.length);out.push(step);}
  while(level.length>1){const next:number[]=[];for(let at=0;at<level.length;at+=2){if(at+1===level.length){next.push(level[at]);continue;}
    const step=new SummaryStep();step.left=level[at];step.right=level[at+1];step.ids=out[step.left].ids.concat(out[step.right].ids);next.push(out.length);out.push(step);}level=next;}
  return out;
}

// A job is a hash-linked series of immutable checkpoints. Calls are charged
// before sending. Merely reading, listing or reopening never resumes a call.
export class RecordingSummaryService {
  private ports:RecordingSummaryPorts;private active:string='';private generation:number=0;private preparing:boolean=false;
  private listeners:Set<()=>void>=new Set<()=>void>();
  constructor(ports:RecordingSummaryPorts){this.ports=ports;}
  subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return ():void=>{this.listeners.delete(listener);};}
  private changed():void{for(const listener of this.listeners){try{listener();}catch(_){}}}
  private stamp():string{const now=this.ports.now();if(!Number.isSafeInteger(now)||now<0)throw summaryError('BLOCKED');return new Date(now).toISOString();}
  private foreground():void{if(!this.ports.foreground())throw summaryError('NOT_FOREGROUND');}
  private source(reference:LocalMaterialReference):MaterialRevision{
    try{const row=new LocalMaterialQuery({ids:():string[]=>[reference.material_id],read:this.ports.read}).resolve(reference);
      const canonical=recordingSummaryReference(row);if(!sameRecordingSummaryReference(reference,canonical))throw summaryError('STALE');return row;
    }catch(_){throw summaryError('STALE');}
  }
  preview(reference:LocalMaterialReference):RecordingSummaryPreview{
    const plan=buildRecordingSummaryPlan(this.source(reference)),out=new RecordingSummaryPreview();
    out.text_units=plan.text_units;out.pieces=plan.pieces.length;out.leaf_count=plan.leaves.length;out.transcription_state=plan.transcription_state;return out;
  }
  private root(create:boolean=false):string{
    const root=this.ports.root();if(typeof root!=='string'||!root.trim()||root!==root.trim()||/^[\\/]+$/.test(root)||/^[A-Za-z]:[\\/]*$/.test(root)||
      (!root.startsWith('/')&&!/^[A-Za-z]:[\\/]/.test(root))||root.split(/[\\/]/).some((part:string):boolean=>part==='.'||part==='..')||/[\u0000-\u001f\u007f]/.test(root))throw summaryError('BLOCKED');
    const base=fs.lstatSync(root);if(base.isSymbolicLink()||!base.isDirectory())throw summaryError('BLOCKED');const directory=root+'/recording-summaries-v1';
    if(!fs.accessSync(directory)){if(!create)return directory;fs.mkdirSync(directory);}
    if(fs.accessSync(directory)){const stat=fs.lstatSync(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw summaryError('BLOCKED');}return directory;
  }
  private readFile(path:string):string{
    const stat=fs.lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<1||stat.size>MAX_FILE)throw summaryError('BLOCKED');
    const file=fs.openSync(path,fs.OpenMode.READ_ONLY),bytes=new Uint8Array(stat.size);
    try{let at=0;while(at<bytes.length){const part=new Uint8Array(Math.min(16384,bytes.length-at));try{const count=fs.readSync(file.fd,part.buffer,{length:part.length});
      if(!Number.isSafeInteger(count)||count<1||count>part.length)throw summaryError('BLOCKED');bytes.set(part.subarray(0,count),at);at+=count;}finally{part.fill(0);}}
      const extra=new Uint8Array(1);if(fs.readSync(file.fd,extra.buffer,{length:1})!==0)throw summaryError('BLOCKED');
      const last=fs.lstatSync(path);if(last.isSymbolicLink()||!last.isFile()||last.size!==stat.size||fs.statSync(file.fd).size!==stat.size)throw summaryError('BLOCKED');
      const text=new util.TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decodeToString(bytes),encoded=new util.TextEncoder().encodeInto(text);
      try{if(!unicode(text)||encoded.length!==bytes.length||encoded.some((value:number,index:number):boolean=>value!==bytes[index]))throw summaryError('BLOCKED');}finally{encoded.fill(0);}return text;
    }finally{bytes.fill(0);fs.closeSync(file);}
  }
  private validate(raw:string,id:string,previous:SummaryRecord|undefined,previousSha:string):SummaryRecord{
    const value=JSON.parse(raw) as SummaryRecord,fields=Object.keys(new SummaryRecord());
    if(!value||Array.isArray(value)||Object.keys(value).length!==fields.length||Object.keys(value).some((key:string):boolean=>!fields.includes(key))||value.schema!==1||value.job_id!==id||
      value.sequence!==(previous?previous.sequence+1:0)||value.sequence>=MAX_STATES||value.previous_sha256!==previousSha||
      typeof value.model!=='string'||!value.model.trim()||value.model.length>128||!unicode(value.model)||/[\u0000-\u001f\u007f]/.test(value.model)||
      !/^[a-f0-9]{64}$/.test(value.endpoint_sha256)||value.pipeline_version!==RECORDING_SUMMARY_PROMPT_VERSION||!utc(value.created_at)||!utc(value.updated_at)||
      !['queued','running','paused','error','ready'].includes(value.phase)||typeof value.uncertain!=='boolean'||!['','paused','background','response_invalid','model_failed','budget','write_pending'].includes(value.note)||
      !Number.isSafeInteger(value.text_units)||value.text_units<1||value.text_units>120000||!Number.isSafeInteger(value.piece_count)||value.piece_count<1||value.piece_count>128||
      !Number.isSafeInteger(value.leaf_count)||value.leaf_count<1||value.leaf_count>8||value.step_count!==2*value.leaf_count-1||
      !Number.isSafeInteger(value.calls_used)||value.calls_used<0||value.calls_used>MAX_CALLS||!Array.isArray(value.outputs)||value.outputs.length>value.step_count||
      !Array.isArray(value.attempts)||value.attempts.length!==value.step_count||value.attempts.some((n:number):boolean=>!Number.isSafeInteger(n)||n<0||n>2)||
      value.attempts.reduce((sum:number,n:number):number=>sum+n,0)!==value.calls_used)throw summaryError('BLOCKED');
    const ref=value.source;if(!ref||Object.keys(ref).some((key:string):boolean=>!['material_id','revision','text_revision','utterance_id','content_sha256','source_range'].includes(key))||
      !/^mat-recording-[a-f0-9]{32}$/.test(ref.material_id)||!Number.isSafeInteger(ref.revision)||ref.revision<1||!Number.isSafeInteger(ref.text_revision)||ref.text_revision<1||
      typeof ref.utterance_id!=='string'||ref.utterance_id.length>256||!/^[a-f0-9]{64}$/.test(ref.content_sha256))throw summaryError('BLOCKED');
    for(const result of value.outputs)parseRecordingSummaryStep(JSON.stringify(result),result.covered_ids);
    if(value.phase==='ready'){if(value.outputs.length!==value.step_count||!utc(value.generated_at)||value.uncertain)throw summaryError('BLOCKED');}
    else if(value.generated_at!==''||value.outputs.length===value.step_count)throw summaryError('BLOCKED');
    if(!previous){if(value.calls_used!==0||value.outputs.length||value.phase!=='queued'||value.uncertain)throw summaryError('BLOCKED');}
    else{
      if(previous.phase==='ready'||!sameRecordingSummaryReference(previous.source,value.source)||previous.model!==value.model||previous.endpoint_sha256!==value.endpoint_sha256||
        previous.pipeline_version!==value.pipeline_version||previous.created_at!==value.created_at||previous.text_units!==value.text_units||previous.piece_count!==value.piece_count||
        previous.leaf_count!==value.leaf_count||previous.step_count!==value.step_count||value.calls_used<previous.calls_used||value.calls_used>previous.calls_used+1||
        value.outputs.length<previous.outputs.length||value.outputs.length>previous.outputs.length+1||previous.outputs.some((output:RecordingSummaryStepResult,index:number):boolean=>JSON.stringify(output)!==JSON.stringify(value.outputs[index]))||
        value.attempts.some((n:number,index:number):boolean=>n<previous.attempts[index]||n>previous.attempts[index]+1))throw summaryError('BLOCKED');
      const charged=value.calls_used-previous.calls_used,added=value.outputs.length-previous.outputs.length;
      if(charged&&(added||value.phase!=='running'||value.attempts[previous.outputs.length]!==previous.attempts[previous.outputs.length]+1))throw summaryError('BLOCKED');
      if(added&&(charged||previous.phase!=='running'||previous.attempts[previous.outputs.length]<1))throw summaryError('BLOCKED');
    }
    return value;
  }
  private inspect(id:string):CheckedJob{
    idValid(id);const out=new CheckedJob();
    try{const root=this.root(),directory=root+'/'+id;out.directory=directory;if(!fs.accessSync(directory))return out;
      const stat=fs.lstatSync(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw summaryError('BLOCKED');const names=fs.listFileSync(directory);names.sort();
      if(names.length>MAX_STATES+4||names.some((name:string):boolean=>!/^state-[0-9]{4}\.json(?:\.partial)?$/.test(name)&&!/^export-[a-f0-9]{64}\.(?:md|json)(?:\.partial)?$/.test(name)))throw summaryError('BLOCKED');
      const finals=names.filter((name:string):boolean=>/^state-[0-9]{4}\.json$/.test(name));const partials=names.filter((name:string):boolean=>/^state-[0-9]{4}\.json\.partial$/.test(name));
      if(partials.length>1||(!finals.length&&!partials.length))throw summaryError('BLOCKED');let previous:SummaryRecord|undefined=undefined,previousSha='';
      for(let index=0;index<finals.length;index++){
        const name='state-'+index.toString().padStart(4,'0')+'.json';if(finals[index]!==name)throw summaryError('BLOCKED');const raw=this.readFile(directory+'/'+name);
        out.bytes+=new util.TextEncoder().encodeInto(raw).length;if(out.bytes>MAX_JOB)throw summaryError('LIMIT');previous=this.validate(raw,id,previous,previousSha);previousSha=sha(raw);
      }
      out.record=previous;out.sha=previousSha;
      if(partials.length){if(partials[0]!=='state-'+finals.length.toString().padStart(4,'0')+'.json.partial')throw summaryError('BLOCKED');
        const raw=this.readFile(directory+'/'+partials[0]);out.bytes+=new util.TextEncoder().encodeInto(raw).length;if(out.bytes>MAX_JOB)throw summaryError('LIMIT');
        out.pending=this.validate(raw,id,previous,previousSha);out.pendingText=raw;if(!out.record){out.record=out.pending;out.sha=sha(raw);}}
    }catch(_){out.blocked=true;}return out;
  }
  private checked(id:string,expected:string=''):CheckedJob{
    const out=this.inspect(id);if(out.blocked)throw summaryError('BLOCKED');if(!out.record)throw summaryError('NOT_READY');if(expected){shaValid(expected);if(expected!==out.sha)throw summaryError('STALE');}return out;
  }
  private plan(record:SummaryRecord):RecordingSummaryPlan{
    const plan=buildRecordingSummaryPlan(this.source(record.source)),schedule=steps(plan);
    if(plan.text_units!==record.text_units||plan.pieces.length!==record.piece_count||plan.leaves.length!==record.leaf_count||schedule.length!==record.step_count)throw summaryError('STALE');
    record.outputs.forEach((result:RecordingSummaryStepResult,index:number):void=>{parseRecordingSummaryStep(JSON.stringify(result),schedule[index].ids);});return plan;
  }
  private write(record:SummaryRecord,previous:SummaryRecord|undefined,previousSha:string,directory:string):void{
    const text=JSON.stringify(record);this.validate(text,record.job_id,previous,previousSha);
    const path=directory+'/state-'+record.sequence.toString().padStart(4,'0')+'.json';
    try{this.atomic(path,text);}catch(_){throw summaryError('WRITE_FAILED');}
  }
  private atomic(path:string,text:string):void{
    const bytes=new util.TextEncoder().encodeInto(text);try{if(bytes.length>MAX_FILE)throw summaryError('LIMIT');
      if(fs.accessSync(path)){if(this.readFile(path)!==text)throw summaryError('BLOCKED');return;}
      const pending=path+'.partial';if(fs.accessSync(pending)){if(this.readFile(pending)!==text)throw summaryError('BLOCKED');
        // A previous close/read does not prove the failed fsync completed.
        // Explicit recovery must flush the existing bytes before promotion.
        const existing=fs.openSync(pending,fs.OpenMode.WRITE_ONLY);try{fs.fsyncSync(existing.fd);}finally{fs.closeSync(existing);}}
      else{const file=fs.openSync(pending,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY);try{let at=0;while(at<bytes.length){const part=bytes.slice(at,Math.min(bytes.length,at+16384));
        try{const count=fs.writeSync(file.fd,part.buffer);if(!Number.isSafeInteger(count)||count<1||count>part.length)throw summaryError('WRITE_FAILED');at+=count;}finally{part.fill(0);}}
        fs.fsyncSync(file.fd);}finally{fs.closeSync(file);}}
      if(this.readFile(pending)!==text)throw summaryError('WRITE_FAILED');
      try{fs.renameSync(pending,path);}catch(_){if(!fs.accessSync(path)||this.readFile(path)!==text)throw summaryError('WRITE_FAILED');}
      if(this.readFile(path)!==text)throw summaryError('WRITE_FAILED');
    }finally{bytes.fill(0);}
  }
  private append(checked:CheckedJob,record:SummaryRecord):CheckedJob{
    if(!checked.record||checked.pending)throw summaryError('BLOCKED');if(record.sequence+1>=MAX_STATES||checked.bytes+JSON.stringify(record).length*3>MAX_JOB)throw summaryError('LIMIT');
    const previous=checked.record;record.sequence=previous.sequence+1;record.previous_sha256=checked.sha;record.updated_at=this.stamp();
    this.write(record,previous,checked.sha,checked.directory);const out=this.checked(record.job_id);this.changed();return out;
  }
  private view(checked:CheckedJob,id:string):RecordingSummaryView{
    const out=new RecordingSummaryView();out.job_id=id;
    if(checked.blocked){out.phase='blocked';out.note='保存状态待核对，未自动重试';return out;}const record=checked.record;if(!record)return out;
    out.state_sha256=checked.sha;out.source=copyRef(record.source);out.model=record.model;out.generated_at=record.generated_at;
    out.text_units=record.text_units;out.piece_count=record.piece_count;out.leaf_count=record.leaf_count;out.step_count=record.step_count;
    out.completed_steps=record.outputs.length;out.calls_used=record.calls_used;
    try{const plan=this.plan(record);out.transcription_state=plan.transcription_state;}catch(_){out.phase='stale';out.generated_at='';out.note='原文已更改、删除或暂不可读，本版本已停用';return out;}
    if(checked.pending){out.phase='resumable';out.note='有未完成的本地提交，确认恢复后先核对保存状态';}
    else if(record.phase==='ready'){out.phase='ready';out.entries=JSON.parse(JSON.stringify(record.outputs[record.outputs.length-1].entries)) as RecordingSummaryEntry[];out.note='已独立保存；模型生成内容需核对原文';}
    else if(this.active===id){out.phase=record.phase==='queued'?'queued':'running';out.note='处理中；当前转写文字之外的音频不计入覆盖';}
    else{out.phase=record.phase==='queued'||record.phase==='running'?'resumable':record.phase;out.note=record.uncertain?'上次调用结果不确定，显式恢复可能再次计费':'进度已保留，恢复需要再次确认';}
    const effective=checked.pending||record,index=effective.outputs.length;
    out.can_resume=out.phase!=='ready'&&this.active===''&&(effective.phase==='ready'||(effective.calls_used<MAX_CALLS&&index<effective.step_count&&effective.attempts[index]<2));return out;
  }
  status(id:string):RecordingSummaryView{idValid(id);return this.view(this.inspect(id),id);}
  private async configuration():Promise<ServiceConfig>{
    let config:ServiceConfig;try{config=await this.ports.config();}catch(_){throw summaryError('BLOCKED');}
    if(!config||typeof config.model!=='string'||!config.model.trim()||config.model.length>128||!unicode(config.model)||/[\u0000-\u001f\u007f]/.test(config.model)||
      typeof config.modelKey!=='string'||!config.modelKey.trim()||typeof config.modelURL!=='string'||config.modelURL.length>1024||
      !/^https:\/\/[^\s/?#@:]+(?::[0-9]+)?(?:\/[^\s?#]*)?$/.test(config.modelURL))throw summaryError('BLOCKED');return config;
  }
  async start(id:string,reference:LocalMaterialReference):Promise<RecordingSummaryView>{
    idValid(id);this.foreground();const old=this.inspect(id);if(old.blocked)throw summaryError('BLOCKED');
    if(old.record){if(!sameRecordingSummaryReference(reference,old.record.source))throw summaryError('STALE');return this.view(old,id);}
    if(this.active||this.preparing)throw summaryError('BUSY');const plan=buildRecordingSummaryPlan(this.source(reference)),frozen=copyRef(reference),generation=this.generation;this.preparing=true;
    try{const config=await this.configuration();this.foreground();if(generation!==this.generation)throw summaryError('NOT_FOREGROUND');this.source(frozen);
      const root=this.root(true),names=fs.listFileSync(root);if(names.filter((name:string):boolean=>/^rsum-/.test(name)).length>=MAX_JOBS)throw summaryError('LIMIT');
      const directory=root+'/'+id;if(fs.accessSync(directory))throw summaryError('BLOCKED');fs.mkdirSync(directory);
      const record=new SummaryRecord();record.job_id=id;record.source=frozen;record.model=config.model;record.endpoint_sha256=sha(config.modelURL);
      record.created_at=this.stamp();record.updated_at=record.created_at;record.text_units=plan.text_units;record.piece_count=plan.pieces.length;record.leaf_count=plan.leaves.length;
      record.step_count=steps(plan).length;record.attempts=[];for(let at=0;at<record.step_count;at++)record.attempts.push(0);
      this.write(record,undefined,'',directory);this.launch(id);return this.status(id);
    }finally{this.preparing=false;}
  }
  async resume(id:string,expected:string):Promise<RecordingSummaryView>{
    idValid(id);shaValid(expected);this.foreground();let checked=this.checked(id,expected);const record=checked.record as SummaryRecord;
    this.plan(record);if(record.phase==='ready'&&!checked.pending)return this.view(checked,id);if(this.active||this.preparing)throw summaryError('BUSY');
    const generation=this.generation;this.preparing=true;
    try{const config=await this.configuration();this.foreground();if(generation!==this.generation)throw summaryError('NOT_FOREGROUND');checked=this.checked(id,expected);this.plan(checked.record as SummaryRecord);
      if(config.model!==record.model||sha(config.modelURL)!==record.endpoint_sha256)throw summaryError('CONFIG_CHANGED');
      if(checked.pending){const pending=checked.pending,path=checked.directory+'/state-'+pending.sequence.toString().padStart(4,'0')+'.json';this.plan(pending);
        try{this.atomic(path,checked.pendingText);}catch(_){throw summaryError('WRITE_FAILED');}checked=this.checked(id);if(checked.pending)throw summaryError('BLOCKED');if(checked.record?.phase==='ready'){this.changed();return this.view(checked,id);}}
      const saved=checked.record as SummaryRecord;if(saved.calls_used>=MAX_CALLS||saved.attempts[saved.outputs.length]>=2)throw summaryError('LIMIT');
      const next=copyRecord(saved);next.phase='paused';next.note='';next.uncertain=false;checked=this.append(checked,next);
      this.foreground();if(generation!==this.generation)throw summaryError('NOT_FOREGROUND');this.checked(id,checked.sha);this.plan(checked.record as SummaryRecord);
      this.launch(id);return this.status(id);
    }finally{this.preparing=false;}
  }
  cancel(id:string,expected:string):RecordingSummaryView{
    idValid(id);shaValid(expected);const checked=this.checked(id,expected);if(checked.record?.phase==='ready')return this.view(checked,id);
    if(this.active===id){this.generation++;this.active='';this.ports.cancel();}
    if(checked.pending){this.changed();return this.view(checked,id);}const next=copyRecord(checked.record as SummaryRecord);
    next.phase='paused';next.note='paused';next.uncertain=next.uncertain||checked.record?.phase==='running';return this.view(this.append(checked,next),id);
  }
  suspend():void{
    this.generation++;const id=this.active;this.active='';try{this.ports.cancel();}catch(_){}
    if(id){try{const checked=this.checked(id);if(!checked.pending&&checked.record?.phase!=='ready'){const next=copyRecord(checked.record as SummaryRecord);next.phase='paused';next.note='background';next.uncertain=true;this.append(checked,next);}}catch(_){}this.changed();}
  }
  private launch(id:string):void{
    this.active=id;const generation=++this.generation;this.changed();
    this.drive(id,generation).catch(():void=>{}).finally(():void=>{if(this.active===id&&generation===this.generation){this.active='';this.changed();}});
  }
  private alive(id:string,generation:number):void{if(this.active!==id||generation!==this.generation||!this.ports.foreground())throw summaryError('NOT_FOREGROUND');}
  private async drive(id:string,generation:number):Promise<void>{
    try{while(true){this.alive(id,generation);let checked=this.checked(id);if(checked.pending)throw summaryError('BLOCKED');const record=checked.record as SummaryRecord,plan=this.plan(record),schedule=steps(plan),index=record.outputs.length;
      if(record.phase==='ready')return;if(record.calls_used>=MAX_CALLS||record.attempts[index]>=2)throw summaryError('LIMIT');
      const config=await this.configuration();this.alive(id,generation);this.plan(record);
      if(config.model!==record.model||sha(config.modelURL)!==record.endpoint_sha256)throw summaryError('CONFIG_CHANGED');
      const step=schedule[index],input=step.left<0?recordingSummaryLeafInput(plan,step.ids):recordingSummaryMergeInput(record.outputs[step.left],record.outputs[step.right]);
      const charged=copyRecord(record);charged.calls_used++;charged.attempts[index]++;charged.phase='running';charged.note='';charged.uncertain=true;checked=this.append(checked,charged);
      this.alive(id,generation);this.plan(checked.record as SummaryRecord);
      const raw=await this.ports.request(config,RECORDING_SUMMARY_SYSTEM,input);this.alive(id,generation);this.plan(checked.record as SummaryRecord);
      const result=parseRecordingSummaryStep(raw,step.ids),next=copyRecord(checked.record as SummaryRecord);next.outputs.push(result);next.uncertain=false;next.note='';
      if(next.outputs.length===next.step_count){next.phase='ready';next.generated_at=this.stamp();}else next.phase='paused';this.append(checked,next);
      if(next.phase==='ready')return;
    }}catch(error){if(this.active!==id||generation!==this.generation)return;
      try{const checked=this.checked(id);if(!checked.pending&&checked.record?.phase!=='ready'){const next=copyRecord(checked.record as SummaryRecord);next.phase='error';
        const code=(error as Error).message;next.note=code==='RECORDING_SUMMARY_RESPONSE_INVALID'?'response_invalid':code==='RECORDING_SUMMARY_LIMIT'?'budget':'model_failed';this.append(checked,next);}}catch(_){}
    }
  }
  list(materialId:string,limit:number=10,cursor:string=''):RecordingSummaryList{
    if(typeof materialId!=='string'||!/^mat-recording-[a-f0-9]{32}$/.test(materialId)||!Number.isSafeInteger(limit)||limit<1||limit>10||typeof cursor!=='string'||
      (cursor!==''&&(!/^[a-f0-9]{64}:(0|[1-9][0-9]*)$/.test(cursor)||cursor.length>81||!Number.isSafeInteger(Number(cursor.slice(65))))))throw summaryError('INVALID');
    const out=new RecordingSummaryList(),items:RecordingSummaryView[]=[],facts:string[]=[materialId];let bytes=0;
    try{const root=this.root(),names=fs.accessSync(root)?fs.listFileSync(root).filter((name:string):boolean=>/^rsum-[a-f0-9]{32}$/.test(name)).sort():[];
      facts.push(sha(JSON.stringify(names)));if(names.length>MAX_JOBS){out.incomplete=true;out.incomplete_reason='scan_limit';}
      for(const id of names.slice(0,MAX_JOBS)){const checked=this.inspect(id);out.scanned++;bytes+=checked.bytes;facts.push(id+':'+checked.sha+':'+checked.blocked.toString()+':'+(checked.pending?sha(checked.pendingText):''));
        if(checked.blocked){out.incomplete=true;out.incomplete_reason='unreadable';}else if(checked.record?.source.material_id===materialId){const view=this.view(checked,id);view.entries=[];items.push(view);}
        if(bytes>32*1024*1024){out.incomplete=true;out.incomplete_reason='read_limit';break;}}
    }catch(_){out.incomplete=true;out.incomplete_reason='unreadable';facts.push('unreadable');}
    out.snapshot_sha256=sha(JSON.stringify(facts));let offset=0;if(cursor){offset=Number(cursor.slice(65));if(cursor.slice(0,64)!==out.snapshot_sha256||offset>items.length)throw summaryError('STALE');}
    out.items=items.slice(offset,offset+limit);out.has_more=offset+out.items.length<items.length;if(out.has_more)out.next_cursor=out.snapshot_sha256+':'+(offset+out.items.length).toString();return out;
  }
  private ready(id:string,expected:string=''):CheckedJob{const checked=this.checked(id,expected);this.plan(checked.record as SummaryRecord);if(checked.pending||checked.record?.phase!=='ready')throw summaryError('NOT_READY');return checked;}
  citation(id:string,pieceId:string,expected:string=''):RecordingSummaryPiece{
    if(typeof pieceId!=='string'||!/^piece-[0-9]{4}$/.test(pieceId))throw summaryError('INVALID');const checked=this.ready(id,expected),record=checked.record as SummaryRecord,plan=this.plan(record);
    if(!record.outputs[record.outputs.length-1].entries.some((entry:RecordingSummaryEntry):boolean=>entry.evidence_ids.includes(pieceId)))throw summaryError('INVALID');
    const piece=plan.pieces.find((value:RecordingSummaryPiece):boolean=>value.id===pieceId);if(!piece)throw summaryError('STALE');return JSON.parse(JSON.stringify(piece)) as RecordingSummaryPiece;
  }
  private document(checked:CheckedJob):SummaryExport{
    const record=checked.record as SummaryRecord,plan=this.plan(record),out=new SummaryExport();out.job_id=record.job_id;out.state_sha256=checked.sha;out.source=copyRef(record.source);
    out.model=record.model;out.generated_at=record.generated_at;out.transcription_state=plan.transcription_state;out.entries=record.outputs[record.outputs.length-1].entries;
    const ids:string[]=[];for(const entry of out.entries)for(const id of entry.evidence_ids)if(!ids.includes(id))ids.push(id);
    out.citations=ids.map((id:string):RecordingSummaryPiece=>{const piece=plan.pieces.find((value:RecordingSummaryPiece):boolean=>value.id===id);if(!piece)throw summaryError('STALE');return piece;});return out;
  }
  private exportText(checked:CheckedJob,format:string):string{
    if(!['md','json'].includes(format))throw summaryError('INVALID');const doc=this.document(checked);if(format==='json')return JSON.stringify(doc,null,2)+'\n';
    let text='# 录音总结\n\n- 资料：'+doc.source.material_id+'\n- 原文版本：'+doc.source.revision+' / '+doc.source.content_sha256+'\n- 模型：'+doc.model+'\n- 生成时间：'+doc.generated_at+'\n- 转写状态：'+doc.transcription_state+'\n- '+doc.coverage_note+'\n';
    const categories=['fact','todo','question','suggestion'],labels=['事实回顾','待办候选','待确认问题','建议'];
    for(let at=0;at<categories.length;at++){text+='\n## '+labels[at]+'\n';for(const entry of doc.entries.filter((entry:RecordingSummaryEntry):boolean=>entry.category===categories[at]))text+='\n'+entry.text+'\n引用：'+entry.evidence_ids.join('、')+'\n';}
    text+='\n## 原文引用\n';for(const piece of doc.citations)text+='\n### '+piece.id+'\n\n'+piece.text+'\n\n来源：'+piece.text_field+' ['+piece.char_start+','+piece.char_end+')；'+piece.speaker_label+'；原句时间：'+(piece.start_ms===null?'未知':piece.start_ms.toString()+'ms')+'\n';return text;
  }
  private verifyExports(checked:CheckedJob):void{
    for(const format of ['md','json']){const path=checked.directory+'/export-'+checked.sha+'.'+format;
      if(fs.accessSync(path)&&this.readFile(path)!==this.exportText(checked,format))throw summaryError('BLOCKED');
      if(fs.accessSync(path+'.partial')&&this.readFile(path+'.partial')!==this.exportText(checked,format))throw summaryError('BLOCKED');}
  }
  isCurrent(id:string,expected:string):boolean{try{shaValid(expected);const checked=this.ready(id,expected);this.verifyExports(checked);return true;}catch(_){return false;}}
  exportPath(id:string,expected:string,format:string):string{
    shaValid(expected);const checked=this.ready(id,expected),text=this.exportText(checked,format),path=checked.directory+'/export-'+checked.sha+'.'+format;
    this.verifyExports(checked);try{this.atomic(path,text);}catch(_){throw summaryError('WRITE_FAILED');}if(!this.isCurrent(id,expected))throw summaryError('STALE');return path;
  }
  chunk(id:string,expected:string,format:string,offset:number,maxChars:number):RecordingSummaryChunk{
    shaValid(expected);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(maxChars)||maxChars<2||maxChars>4000)throw summaryError('INVALID');
    const checked=this.ready(id,expected);this.verifyExports(checked);const text=this.exportText(checked,format);
    if(offset>text.length||(offset>0&&offset<text.length&&text.charCodeAt(offset)>=0xdc00&&text.charCodeAt(offset)<=0xdfff&&text.charCodeAt(offset-1)>=0xd800&&text.charCodeAt(offset-1)<=0xdbff))throw summaryError('INVALID');
    let end=Math.min(text.length,offset+maxChars);if(end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--;
    const out=new RecordingSummaryChunk();out.job_id=id;out.state_sha256=expected;out.format=format;out.text=text.slice(offset,end);out.offset=offset;out.next_offset=end;out.total_utf16=text.length;out.has_more=end<text.length;return out;
  }
}
