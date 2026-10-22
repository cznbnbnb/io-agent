import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { MaterialStore, MaterialSource, MaterialTextInput, MaterialRevision, renderMaterialTranscript } from './MaterialStore';
import { MaterialCoverageInput, materialTextInput } from './MaterialTranscript';
import { LifelogTranscript } from './LifelogASR';
import { OggFileSource } from './OggFileSource';

export class LifelogManualResult {
  transcript:LifelogTranscript|undefined=undefined;markdown:string='';
  // Missing in sealed 0.1.54 results: preserve the exact legacy reconstruction.
  speaker_schema:number|undefined=undefined;title:string|undefined=undefined;clock_offset_minutes:number|undefined=undefined;
}
function scopedManualId(source:MaterialSource):string{
  if(source.kind!=='lifelog'||!/^seg-[0-9a-f]{32}$/.test(source.name))throw new Error('RECORDING_CLOUD_RESULT_INVALID');
  return 'mat-lifelog-'+source.name.slice(4);
}
function manualSpeakerMarkdown(title:string,transcript:LifelogTranscript,input:MaterialTextInput,source:MaterialSource,clockOffsetMinutes:number):string{
  if(typeof title!=='string'||!title.trim()||title.length>200||/[\u0000-\u001f\u007f-\u009f]/.test(title))throw new Error('RECORDING_CLOUD_RESULT_INVALID');
  const row=new MaterialRevision();row.source=source;row.utterances=input.utterances;row.speakers=input.speakers;
  const lines:string[]=['# '+title,'',
    '- 原始时长：'+transcript.seconds.toFixed(2)+' 秒（有效语音 '+transcript.speechSeconds.toFixed(2)+' 秒）',
    '- 本机离线转写；说话人标签仅用于此段，识别文字可能有误。'];
  if(input.speakerProcessing==='pending')lines.push('- 说话人分析待处理；当前归属尚未确认。');
  if(input.speakerProcessing==='unavailable')lines.push('- 说话人分析不可用；无法确认的发言保持未确定。');
  if(input.speakers?.some((speaker):boolean=>speaker.label_basis==='role_match'))lines.push('- 角色匹配姓名为候选，尚未确认本人身份。');
  lines.push('',renderMaterialTranscript(row,clockOffsetMinutes)||'-（未检测到有效语音）');return lines.join('\n')+'\n';
}
// Seal the new format before saving ready. The renderer never includes local
// biographies, role IDs or embeddings; recovery is independent of wall clocks.
export function prepareLifelogManualResult(transcript:LifelogTranscript,source:MaterialSource,title:string):LifelogManualResult{
  if(!source.complete||source.interrupted||source.audioFrames<0||source.frameMs!==60||
    source.ended<source.started+source.audioFrames*source.frameMs)throw new Error('MATERIAL_COVERAGE_INVALID');
  const saved=new LifelogManualResult();saved.transcript=JSON.parse(JSON.stringify(transcript)) as LifelogTranscript;saved.speaker_schema=1;saved.title=title;
  saved.clock_offset_minutes=-new Date(source.started).getTimezoneOffset();
  transcript=saved.transcript;
  const coverage=new MaterialCoverageInput();coverage.complete=true;coverage.coveredFrames=transcript.frames;coverage.sourceFrames=source.audioFrames;coverage.frameMs=source.frameMs;
  const input=materialTextInput(transcript,'','unknown',coverage,scopedManualId(source));saved.markdown=manualSpeakerMarkdown(title,transcript,input,source,saved.clock_offset_minutes);
  // Run the same strict reconstruction used on cold recovery before any ready
  // state can become durable; no normalization after the Store commit.
  lifelogManualTextInput(JSON.stringify(saved),source);return saved;
}
export function lifelogManualTextInput(result:string,source:MaterialSource):MaterialTextInput{
  const saved=JSON.parse(result) as LifelogManualResult,parsed=saved.transcript;
  if(!parsed||!Array.isArray(parsed.utterances)||parsed.utterances.length>10000||!Array.isArray(parsed.speakers)||parsed.speakers.length>10000||
    !Number.isSafeInteger(parsed.frames)||parsed.frames<0||!Number.isFinite(parsed.seconds)||Math.abs(parsed.seconds*1000-parsed.frames*60)>1||
    !Number.isFinite(parsed.speechSeconds)||parsed.speechSeconds<0||parsed.speechSeconds>parsed.seconds||typeof saved.markdown!=='string'||!saved.markdown.trim())throw new Error('MATERIAL_COVERAGE_INVALID');
  for(const part of parsed.utterances){if(!Number.isFinite(part.start)||!Number.isFinite(part.end)||part.start<0||part.end<part.start||part.end>parsed.seconds||typeof part.text!=='string'||!Number.isSafeInteger(part.speaker)||part.speaker< -1)throw new Error('RECORDING_CLOUD_RESULT_INVALID');}
  for(const speaker of parsed.speakers){if(!Number.isSafeInteger(speaker.index)||speaker.index<0||typeof speaker.name!=='string'||typeof speaker.bio!=='string')throw new Error('RECORDING_CLOUD_RESULT_INVALID');}
  let coverage:MaterialCoverageInput|undefined=undefined;
  if(source.audioFrames>=0){
    if(parsed.frames!==source.audioFrames)throw new Error('MATERIAL_COVERAGE_INVALID');
    coverage=new MaterialCoverageInput();coverage.complete=true;coverage.coveredFrames=parsed.frames;coverage.sourceFrames=source.audioFrames;coverage.frameMs=source.frameMs;
  }
  if(saved.speaker_schema!==undefined&&saved.speaker_schema!==1)throw new Error('RECORDING_CLOUD_RESULT_INVALID');
  if(saved.speaker_schema===1){
    if(!source.complete||source.interrupted||source.audioFrames<0||source.frameMs!==60||
      source.ended<source.started+source.audioFrames*source.frameMs)throw new Error('MATERIAL_COVERAGE_INVALID');
    if(!Number.isSafeInteger(saved.clock_offset_minutes)||saved.clock_offset_minutes===undefined||saved.clock_offset_minutes< -840||saved.clock_offset_minutes>840)throw new Error('RECORDING_CLOUD_RESULT_INVALID');
    const input=materialTextInput(parsed,saved.markdown,'unknown',coverage,scopedManualId(source));
    if(saved.markdown!==manualSpeakerMarkdown(saved.title as string,parsed,input,source,saved.clock_offset_minutes))throw new Error('RECORDING_CLOUD_RESULT_INVALID');return input;
  }
  return materialTextInput(parsed,saved.markdown,'unknown',coverage);
}

export class RecordingCloudSnapshot {
  source:MaterialSource=new MaterialSource();wavPath:string='';wavSha256:string='';
  rawBytes:number=0;rawMtime:number=0;wavBytes:number=0;wavMtime:number=0;
}
function assertCurrent(current:()=>boolean):void{if(!current())throw new Error('RECORDING_CLOUD_LIFETIME_CHANGED');}
async function readAudioSnapshot(source:MaterialSource,rawPath:string,wavPath:string,current:()=>boolean,recording:boolean):Promise<RecordingCloudSnapshot>{
  assertCurrent(current);
  if(source.kind!==(recording?'recording':'lifelog')||!source.complete||source.interrupted||!source.audioAvailable)throw new Error('RECORDING_CLOUD_SOURCE_UNAVAILABLE');
  const raw=fs.statSync(rawPath),wav=fs.statSync(wavPath);
  if(raw.size!==source.audioBytes||raw.size<=0||(!recording&&raw.size>16000000)||wav.size<=(recording?44:0)||(recording&&wav.size>44+64000*600)||!Number.isFinite(raw.mtime)||!Number.isFinite(wav.mtime))throw new Error('RECORDING_CLOUD_SOURCE_UNAVAILABLE');
  const md=cryptoFramework.createMd('SHA256'),file=fs.openSync(wavPath,fs.OpenMode.READ_ONLY);let offset=0;
  try{
    while(offset<wav.size){
      assertCurrent(current);const bytes=new Uint8Array(Math.min(262144,wav.size-offset));
      try{if(fs.readSync(file.fd,bytes.buffer,{length:bytes.length})!==bytes.length)throw new Error('RECORDING_CLOUD_SOURCE_CHANGED');md.updateSync({data:bytes});}
      finally{bytes.fill(0);}
      offset+=Math.min(262144,wav.size-offset);
      await new Promise<void>((resolve:()=>void):void=>{setTimeout(resolve,0);});
    }
  }finally{fs.closeSync(file);}
  assertCurrent(current);const rawAfter=fs.statSync(rawPath),wavAfter=fs.statSync(wavPath);
  if(rawAfter.size!==raw.size||rawAfter.mtime!==raw.mtime||wavAfter.size!==wav.size||wavAfter.mtime!==wav.mtime)throw new Error('RECORDING_CLOUD_SOURCE_CHANGED');
  const out=new RecordingCloudSnapshot();out.source=JSON.parse(JSON.stringify(source)) as MaterialSource;out.wavPath=wavPath;
  out.rawBytes=raw.size;out.rawMtime=raw.mtime;out.wavBytes=wav.size;out.wavMtime=wav.mtime;
  const digest=md.digestSync().data;out.wavSha256=Array.from(digest).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');digest.fill(0);return out;
}
export async function readRecordingCloudSnapshot(source:MaterialSource,rawPath:string,wavPath:string,current:()=>boolean):Promise<RecordingCloudSnapshot>{
  return readAudioSnapshot(source,rawPath,wavPath,current,true);
}
export async function readLifelogManualSnapshot(source:MaterialSource,oggPath:string,current:()=>boolean):Promise<RecordingCloudSnapshot>{
  const snapshot=await readAudioSnapshot(source,oggPath,oggPath,current,false);assertCurrent(current);
  const ogg=new OggFileSource(oggPath,true,undefined,snapshot.wavBytes,snapshot.wavSha256);
  try{
    const frames=ogg.index.prefix.offsets.length;
    if(frames<=0||(source.audioFrames>=0&&source.audioFrames!==frames))throw new Error('RECORDING_CLOUD_SOURCE_CHANGED');
    snapshot.source.audioFrames=frames;snapshot.source.frameMs=60;snapshot.source.ended=Math.max(source.ended,source.started+frames*60);
  }finally{ogg.close();}
  assertCurrent(current);const after=fs.statSync(oggPath);if(after.size!==snapshot.wavBytes||after.mtime!==snapshot.wavMtime)throw new Error('RECORDING_CLOUD_SOURCE_CHANGED');return snapshot;
}
class RecordingCloudState {
  schema:number=1;materialId:string='';operationId:string='';baseRevision:number=0;createdAt:number=0;
  fileName:string='';sourceSignature:string='';source:MaterialSource=new MaterialSource();state:string='prepared';result:string='';input:MaterialTextInput=new MaterialTextInput();
}
function signature(snapshot:RecordingCloudSnapshot,source:MaterialSource|undefined=undefined):string{
  const s=source||snapshot.source;
  return JSON.stringify([s.kind,s.name,s.started,s.ended,s.complete,s.audioAvailable,s.audioBytes,s.audioFrames,s.frameMs,s.decodedChannels,s.interrupted,s.deviceId,
    snapshot.rawBytes,snapshot.rawMtime,snapshot.wavBytes,snapshot.wavMtime,snapshot.wavSha256]);
}
function validateSource(source:MaterialSource):void{
  if(!source||!['recording','lifelog'].includes(source.kind)||typeof source.name!=='string'||
    !Number.isSafeInteger(source.started)||source.started<0||!Number.isSafeInteger(source.ended)||source.ended<source.started||
    typeof source.complete!=='boolean'||!source.complete||typeof source.audioAvailable!=='boolean'||!source.audioAvailable||
    !Number.isSafeInteger(source.audioBytes)||source.audioBytes<=0||!Number.isSafeInteger(source.audioFrames)||source.audioFrames< -1||
    ![20,60].includes(source.frameMs)||!Number.isSafeInteger(Math.max(0,source.audioFrames)*source.frameMs)||
    ![0,1,2].includes(source.decodedChannels)||typeof source.interrupted!=='boolean'||source.interrupted||typeof source.deviceId!=='string'||source.deviceId.length>128)throw new Error('RECORDING_CLOUD_STATE_INVALID');
}
// Durable ASR result and canonical publication are separate commits. Recovery
// can infer an exact committed operation from its original CAS revision.
export class RecordingCloudPublication {
  private root:string='';private store:MaterialStore|undefined=undefined;private busy:boolean=false;
  private unsavedReady:Map<string,RecordingCloudState>=new Map<string,RecordingCloudState>();
  initialize(filesDir:string,store:MaterialStore):void{this.root=filesDir+'/recording-cloud-publication';if(!fs.accessSync(this.root))fs.mkdirSync(this.root);this.store=store;}
  private path(id:string):string{if(!this.root||!/^mat-(recording|lifelog)-[0-9a-f]{32}$/.test(id))throw new Error('RECORDING_CLOUD_ID_INVALID');return this.root+'/'+id+'.json';}
  private read(id:string):RecordingCloudState|undefined{
    const path=this.path(id);if(!fs.accessSync(path))return undefined;if(fs.statSync(path).size>8000000)throw new Error('RECORDING_CLOUD_STATE_INVALID');
    const row=JSON.parse(fs.readTextSync(path)) as RecordingCloudState;
    if(row.schema!==1||row.materialId!==id||!Number.isSafeInteger(row.baseRevision)||row.baseRevision<1||row.operationId!==`cloud-${id}-r${row.baseRevision}`||
      !Number.isSafeInteger(row.createdAt)||row.createdAt<1||row.fileName!==`transcript-${row.createdAt}.md`||typeof row.sourceSignature!=='string'||row.sourceSignature.length>4096||
      !['prepared','ready'].includes(row.state)||typeof row.result!=='string'||row.result.length>4000000||(row.state==='prepared'&&row.result!=='')||(row.state==='ready'&&!row.result.trim())||
      !row.input||typeof row.input.text!=='string'||!Array.isArray(row.input.utterances)||
      this.store?.idFor(row.source.kind,row.source.name)!==id)throw new Error('RECORDING_CLOUD_STATE_INVALID');return row;
  }
  private write(row:RecordingCloudState):void{
    const path=this.path(row.materialId),bytes=new util.TextEncoder().encodeInto(JSON.stringify(row));
    if(bytes.length>8000000)throw new Error('RECORDING_CLOUD_STATE_INVALID');
    const file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('RECORDING_CLOUD_RESULT_WRITE_FAILED');offset+=n;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}fs.renameSync(path+'.partial',path);
  }
  private saveReady(row:RecordingCloudState):void{
    try{this.write(row);}catch(error){throw new Error('RECORDING_CLOUD_RESULT_WRITE_FAILED: '+(error as Error).message);}
  }
  private head(id:string):MaterialRevision{
    const head=this.store?.read(id);if(!head)throw new Error('MATERIAL_NOT_FOUND');
    if(head.operation==='delete')throw new Error('MATERIAL_DELETED');if(head.user_edited)throw new Error('USER_REVISION_PROTECTED');return head;
  }
  private isCommitted(head:MaterialRevision,row:RecordingCloudState):boolean{
    const input=row.input;
    return row.state==='ready'&&head.revision===row.baseRevision+1&&head.applied_job===row.operationId&&head.text===input.text&&
      head.recognition_channel===input.channel&&head.utterances.length===input.utterances.length&&head.utterances.every((p,index):boolean=>{
        const wanted=input.utterances[index];return p.start_ms===wanted.start_ms&&p.end_ms===wanted.end_ms&&p.text===wanted.text&&p.speaker_id===wanted.speaker_id&&p.speaker_basis===wanted.speaker_basis&&p.overlap===wanted.overlap;
      })&&JSON.stringify(head.speakers)===JSON.stringify(input.speakers)&&head.speaker_processing===input.speakerProcessing&&head.boundary_processing===input.boundaryProcessing&&
      head.transcription_state===input.transcriptionState&&head.covered_ms===input.coveredMs&&head.transcription_source_ms===input.sourceMs;
  }
  hasCommittedLifelog(source:MaterialSource):boolean{
    if(!this.store||source.kind!=='lifelog')return false;
    const id=this.store.idFor(source.kind,source.name),row=this.read(id),head=this.store.read(id);if(!row||row.state!=='ready'||!head||head.operation==='delete'||head.user_edited)return false;
    const saved=row.source;if(source.audioFrames<0){source=JSON.parse(JSON.stringify(source)) as MaterialSource;source.audioFrames=saved.audioFrames;source.ended=Math.max(source.ended,source.started+saved.audioFrames*saved.frameMs);}
    return saved.started===source.started&&saved.ended===source.ended&&saved.complete===source.complete&&saved.interrupted===source.interrupted&&
      saved.audioAvailable===source.audioAvailable&&saved.audioBytes===source.audioBytes&&saved.audioFrames===source.audioFrames&&saved.frameMs===source.frameMs&&
      JSON.stringify(lifelogManualTextInput(row.result,row.source))===JSON.stringify(row.input)&&this.isCommitted(head,row);
  }
  async publish(readSource:()=>Promise<RecordingCloudSnapshot>,recognize:(wavPath:string)=>Promise<string>,mirror:(source:MaterialSource,fileName:string,text:string,result:string)=>void,current:()=>boolean,makeInput:((result:string,source:MaterialSource)=>MaterialTextInput)|undefined=undefined,allowRecognitionRetry:boolean=false):Promise<string>{
    if(this.busy)throw new Error('RECORDING_CLOUD_BUSY');if(!this.store)throw new Error('RECORDING_CLOUD_NOT_INITIALIZED');this.busy=true;
    try{
      assertCurrent(current);const initial=await readSource();assertCurrent(current);
      validateSource(initial.source);
      const id=this.store.idFor(initial.source.kind,initial.source.name),durable=this.read(id);let row=this.unsavedReady.get(id)||durable;let created=false;
      if(!row){
        const base=this.store.ensure(initial.source);this.head(id);
        row=new RecordingCloudState();row.materialId=id;row.baseRevision=base.revision;row.operationId=`cloud-${id}-r${base.revision}`;
        row.createdAt=Date.now();row.fileName=`transcript-${row.createdAt}.md`;row.sourceSignature=signature(initial);row.source=initial.source;this.write(row);
        created=true;
      }
      validateSource(row.source);
      if(row.sourceSignature!==signature(initial))throw new Error('RECORDING_CLOUD_SOURCE_CHANGED');
      if(signature(initial,row.source)!==row.sourceSignature)throw new Error('RECORDING_CLOUD_STATE_INVALID');
      let head=this.head(id);
      if(head.revision!==row.baseRevision&&!this.isCommitted(head,row))throw new Error('REVISION_CONFLICT');
      if(row.state==='prepared'){
        if(!created&&!allowRecognitionRetry)throw new Error('RECORDING_CLOUD_RESULT_NOT_SAVED：此前结果未能保存，状态未知；确认后可重新识别');
        const result=await recognize(initial.wavPath);assertCurrent(current);
        if(typeof result!=='string'||!result.trim()||result.length>(makeInput?4000000:100000))throw new Error('RECORDING_CLOUD_RESULT_INVALID');
        const input=makeInput?makeInput(result,row.source):new MaterialTextInput();if(!makeInput){input.text=result;input.channel='mix';}
        if(!input.text.trim()||input.text.length>1000000)throw new Error('RECORDING_CLOUD_RESULT_INVALID');
        row.result=result;row.input=input;row.state='ready';this.unsavedReady.set(id,row);this.saveReady(row);this.unsavedReady.delete(id);
      }
      const reconstructed=makeInput?makeInput(row.result,row.source):new MaterialTextInput();if(!makeInput){reconstructed.text=row.result;reconstructed.channel='mix';}
      if(JSON.stringify(reconstructed)!==JSON.stringify(row.input))throw new Error('RECORDING_CLOUD_STATE_INVALID');
      if(this.unsavedReady.has(id)){this.saveReady(row);this.unsavedReady.delete(id);}
      const beforePublish=await readSource();assertCurrent(current);
      if(signature(beforePublish)!==row.sourceSignature)throw new Error('RECORDING_CLOUD_SOURCE_CHANGED');
      head=this.head(id);
      if(head.revision===row.baseRevision){
        head=this.store.appendTranscript(id,row.baseRevision,row.input,row.operationId);
      }
      if(!this.isCommitted(head,row))throw new Error('REVISION_CONFLICT');
      const beforeMirror=await readSource();assertCurrent(current);
      if(signature(beforeMirror)!==row.sourceSignature)throw new Error('RECORDING_CLOUD_SOURCE_CHANGED');
      head=this.head(id);if(!this.isCommitted(head,row))throw new Error('REVISION_CONFLICT');
      let mirrored=true;try{mirror(row.source,row.fileName,row.input.text,row.result);}catch(_){mirrored=false;}
      assertCurrent(current);head=this.head(id);if(!this.isCommitted(head,row))throw new Error('REVISION_CONFLICT');
      if(!mirrored)return `资料 v${head.revision} 的文字已保存，本机转写文件待补写；重试会复用结果，服务器同步状态另行显示`;
      return `资料 v${head.revision} 的文字已保存，本机转写文件已就绪；服务器同步状态另行显示`;
    }finally{this.busy=false;}
  }
}
