import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';

// 资料旁车独立于旧录音目录；迁移不移动、重命名或删除原音/旧文字。
export class MaterialSource {
  kind:string='recording';name:string='';started:number=0;ended:number=0;
  complete:boolean=false;audioAvailable:boolean=false;audioBytes:number=0;
  decodedChannels:number=0;deviceId:string='';legacyTextRef:string='';
  // -1 means the original timeline has not been measured, rather than silence.
  audioFrames:number=-1;frameMs:number=0;interrupted:boolean=false;
}
export class MaterialUtterance {
  utterance_id:string='';start_ms:number|null=0;end_ms:number|null=0;text:string='';
  speaker_id:string='';speaker_basis:string='unknown';overlap:boolean=false;
  source_range:MaterialSourceRange|undefined=undefined;
}
// Labels are scoped to this material. They are not a global voice/person ID.
export class MaterialSpeaker {
  speaker_id:string='';label:string='';label_basis:string='anonymous';is_self:boolean=false;
}
export class MaterialSourceRange {
  parent_utterance_id:string='';parent_revision:number=0;start_ms:number=0;end_ms:number=0;text_start:number=0;text_end:number=0;
}
export class MaterialSpeakerCorrection {
  operation_id:string='';kind:string='';speaker_id:string='';target_speaker_id:string='';label:string='';
  utterance_ids:string[]=[];split_offset:number=0;text:string='';
}
export class MaterialSpeakerCorrectionReceipt {
  operation_id:string='';payload_sha256:string='';base_revision:number=0;
}
export class MaterialTextInput {
  text:string='';utterances:MaterialUtterance[]=[];channel:string='unknown';
  speakers:MaterialSpeaker[]|undefined=undefined;
  speakerProcessing:string='unknown';
  boundaryProcessing:string='unknown';
  transcriptionState:string='unknown';coveredMs:number=-1;sourceMs:number=-1;
}
export class MaterialRevision {
  schema_version:number=1;material_id:string='';revision:number=1;text_revision:number=0;
  operation:string='upsert';created_at:number=0;modified_at:number=0;
  source:MaterialSource=new MaterialSource();
  text:string='';utterances:MaterialUtterance[]=[];
  speakers:MaterialSpeaker[]|undefined=undefined;
  speaker_correction:MaterialSpeakerCorrectionReceipt|undefined=undefined;
  text_origin:string='none';recognition_channel:string='unknown';user_edited:boolean=false;
  audio_sha256:string='';audio_checksum_state:string='pending';sync_state:string='local';
  source_identity:string='unknown';applied_job:string='';
  speaker_processing:string='unknown';
  boundary_processing:string='unknown';
  transcription_state:string='unknown';covered_ms:number=-1;transcription_source_ms:number=-1;
}
// A read-only observation of committed revision names and head metadata. This
// is deliberately not a digest of every material's JSON contents.
export class MaterialQueryCatalog {
  ids:string[]=[];snapshot_sha256:string='';
}

function speakerDigest(value:string):string{
  const bytes=new util.TextEncoder().encodeInto(value);const md=cryptoFramework.createMd('SHA256');
  try{md.updateSync({data:bytes});const digest=md.digestSync().data;
    const out=Array.from(digest).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');digest.fill(0);return out;
  }finally{bytes.fill(0);}
}
function speakerLabelValid(label:string):boolean{
  return typeof label==='string'&&label.length>0&&label.length<=80&&label.trim().length>0&&!/[\u0000-\u001f\u007f-\u009f]/.test(label);
}
function scopedSpeakerId(id:string,speaker:string):boolean{return speaker.startsWith(id+'-s')&&/^[a-f0-9]{12,64}$/.test(speaker.slice(id.length+2));}
function canonicalSpeakerOperation(input:MaterialSpeakerCorrection):MaterialSpeakerCorrection{
  if(!input||Object.keys(input).some((key:string):boolean=>!['operation_id','kind','speaker_id','target_speaker_id','label','utterance_ids','split_offset','text'].includes(key)))throw new Error('SPEAKER_OPERATION_INVALID');
  const out=new MaterialSpeakerCorrection();out.operation_id=input.operation_id;out.kind=input.kind;
  out.speaker_id=input.speaker_id===undefined?'':input.speaker_id;out.target_speaker_id=input.target_speaker_id===undefined?'':input.target_speaker_id;
  out.label=input.label===undefined?'':input.label;
  if(input.utterance_ids!==undefined&&!Array.isArray(input.utterance_ids))throw new Error('SPEAKER_OPERATION_INVALID');
  out.utterance_ids=input.utterance_ids===undefined?[]:input.utterance_ids.slice();
  out.split_offset=input.split_offset===undefined?0:input.split_offset;out.text=input.text===undefined?'':input.text;
  if(typeof out.operation_id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(out.operation_id)||
    !['rename','merge','assign','unknown','split','self','text'].includes(out.kind)||
    typeof out.speaker_id!=='string'||out.speaker_id.length>128||typeof out.target_speaker_id!=='string'||out.target_speaker_id.length>128||
    typeof out.label!=='string'||out.label.length>80||typeof out.text!=='string'||out.text.length>65536||
    !Array.isArray(out.utterance_ids)||out.utterance_ids.length>10000||
    out.utterance_ids.some((id:string):boolean=>typeof id!=='string'||!id||id.length>256)||new Set(out.utterance_ids).size!==out.utterance_ids.length||
    !Number.isSafeInteger(out.split_offset)||out.split_offset<0)throw new Error('SPEAKER_OPERATION_INVALID');
  // Each operation has one unambiguous payload; unused fields cannot smuggle a second action.
  if((out.kind!=='split'&&out.split_offset!==0)||(out.kind!=='text'&&out.text!=='')||
    (!['rename','merge','self'].includes(out.kind)&&out.speaker_id!=='')||
    (!['merge','assign'].includes(out.kind)&&out.target_speaker_id!=='')||
    (!['rename','assign','self'].includes(out.kind)&&out.label!=='')||
    (['rename','merge','self'].includes(out.kind)&&out.utterance_ids.length!==0)||
    (['assign','unknown','split','text'].includes(out.kind)&&out.utterance_ids.length===0)||
    (['split','text'].includes(out.kind)&&out.utterance_ids.length!==1))throw new Error('SPEAKER_OPERATION_INVALID');
  return out;
}
// UI may show legacy labels without changing the old immutable revision.
export function deriveMaterialSpeakers(row:MaterialRevision):MaterialSpeaker[]{
  if(row.speakers!==undefined)return JSON.parse(JSON.stringify(row.speakers)) as MaterialSpeaker[];
  const out:MaterialSpeaker[]=[];
  for(const part of row.utterances){if(!part.speaker_id||out.some((speaker:MaterialSpeaker):boolean=>speaker.speaker_id===part.speaker_id))continue;
    const speaker=new MaterialSpeaker();speaker.speaker_id=part.speaker_id;
    speaker.label='说话人 '+String.fromCharCode(65+out.length%26)+(out.length>=26?Math.floor(out.length/26).toString():'');out.push(speaker);
  }return out;
}
function normalizedSpeaker(row:MaterialRevision,legacyId:string):string{
  return legacyId&&row.speakers===undefined?row.material_id+'-s'+speakerDigest(legacyId).slice(0,20):legacyId;
}
function markdownLabel(value:string):string{return value.replace(/[\\`*_{}\[\]<>|]/g,(char:string):string=>'\\'+char);}
function materialClock(ms:number,clockOffsetMinutes:number|undefined=undefined):string{
  const date=new Date(ms+(clockOffsetMinutes===undefined?0:clockOffsetMinutes*60000));
  const values=clockOffsetMinutes===undefined?[date.getHours(),date.getMinutes(),date.getSeconds()]:[date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds()];
  return values.map((n:number):string=>n.toString().padStart(2,'0')).join(':');
}
// The structured utterances remain the exact original text. This is the shared
// display/export/query rendering, using current labels rather than cached ASR names.
export function renderMaterialTranscript(row:MaterialRevision,clockOffsetMinutes:number|undefined=undefined):string{
  // Optional fixed offset is minutes east of UTC, sealed by the publisher.
  // Omitting it preserves ordinary current-local-time display behavior.
  if(clockOffsetMinutes!==undefined&&(!Number.isSafeInteger(clockOffsetMinutes)||clockOffsetMinutes< -840||clockOffsetMinutes>840))throw new Error('MATERIAL_CLOCK_OFFSET_INVALID');
  if(!row.utterances.length)return row.text;
  const speakers=deriveMaterialSpeakers(row);
  return row.utterances.map((part:MaterialUtterance):string=>{
    const speaker=speakers.find((saved:MaterialSpeaker):boolean=>saved.speaker_id===part.speaker_id);
    const who=speaker?markdownLabel(speaker.label):'未确定';
    const at=part.start_ms===null?'句内时间未确定':materialClock(row.source.started+part.start_ms,clockOffsetMinutes);
    return '- **['+at+'] '+who+'** '+part.text;
  }).join('\n');
}
export function applyMaterialSpeakerCorrection(row:MaterialRevision,input:MaterialSpeakerCorrection):MaterialRevision{
  const op=canonicalSpeakerOperation(input);
  if(row.operation==='delete')throw new Error('MATERIAL_DELETED');
  if(!row.source.complete||row.source.interrupted)throw new Error('MATERIAL_CORRECTION_SOURCE_UNSEALED');
  if(row.transcription_state!=='complete')throw new Error('MATERIAL_CORRECTION_COVERAGE_UNCONFIRMED');
  if(!row.utterances.length)throw new Error('MATERIAL_CORRECTION_NO_UTTERANCES');
  const next=JSON.parse(JSON.stringify(row)) as MaterialRevision;next.speakers=deriveMaterialSpeakers(row);
  for(const speaker of next.speakers)speaker.speaker_id=normalizedSpeaker(row,speaker.speaker_id);
  for(const part of next.utterances)part.speaker_id=normalizedSpeaker(row,part.speaker_id);
  const sourceId=normalizedSpeaker(row,op.speaker_id),targetId=normalizedSpeaker(row,op.target_speaker_id);
  const source=next.speakers.find((speaker:MaterialSpeaker):boolean=>speaker.speaker_id===sourceId);
  const target=next.speakers.find((speaker:MaterialSpeaker):boolean=>speaker.speaker_id===targetId);
  const selected:MaterialUtterance[]=[];for(const id of op.utterance_ids){const part=next.utterances.find((utterance:MaterialUtterance):boolean=>utterance.utterance_id===id);
    if(!part)throw new Error('UTTERANCE_NOT_FOUND');selected.push(part);}
  let changed=false;
  if(op.kind==='rename'){
    if(!source)throw new Error('SPEAKER_NOT_FOUND');if(!speakerLabelValid(op.label))throw new Error('SPEAKER_LABEL_INVALID');
    changed=source.label!==op.label||source.label_basis!=='user_confirmed';source.label=op.label;source.label_basis='user_confirmed';
  }else if(op.kind==='merge'){
    if(!source||!target)throw new Error('SPEAKER_NOT_FOUND');
    if(sourceId!==targetId){for(const part of next.utterances){if(part.speaker_id===sourceId){part.speaker_id=targetId;part.speaker_basis='user';changed=true;}}
      next.speakers=next.speakers.filter((speaker:MaterialSpeaker):boolean=>speaker.speaker_id!==sourceId);changed=true;}
  }else if(op.kind==='assign'){
    let assigned=target;
    if(targetId&&!assigned)throw new Error('SPEAKER_NOT_FOUND');
    if(targetId&&op.label!=='')throw new Error('SPEAKER_OPERATION_INVALID');
    if(!targetId){if(!speakerLabelValid(op.label))throw new Error('SPEAKER_LABEL_INVALID');assigned=new MaterialSpeaker();
      assigned.speaker_id=row.material_id+'-s'+speakerDigest(op.operation_id).slice(0,20);assigned.label=op.label;assigned.label_basis='user_confirmed';
      if(next.speakers.some((speaker:MaterialSpeaker):boolean=>speaker.speaker_id===assigned?.speaker_id))throw new Error('SPEAKER_ID_CONFLICT');next.speakers.push(assigned);changed=true;}
    if(!assigned)throw new Error('SPEAKER_NOT_FOUND');const assignedId=assigned.speaker_id;
    for(const part of selected){if(part.speaker_id!==assignedId||part.speaker_basis!=='user')changed=true;part.speaker_id=assignedId;part.speaker_basis='user';}
  }else if(op.kind==='unknown'){
    for(const part of selected){if(part.speaker_id!==''||part.speaker_basis!=='unknown')changed=true;part.speaker_id='';part.speaker_basis='unknown';}
  }else if(op.kind==='self'){
    if(!source)throw new Error('SPEAKER_NOT_FOUND');const label=op.label||'我';if(!speakerLabelValid(label))throw new Error('SPEAKER_LABEL_INVALID');
    for(const speaker of next.speakers){const self=speaker.speaker_id===sourceId;if(speaker.is_self!==self)changed=true;speaker.is_self=self;}
    if(source.label!==label||source.label_basis!=='user_confirmed')changed=true;source.label=label;source.label_basis='user_confirmed';
  }else if(op.kind==='text'){
    changed=selected[0].text!==op.text;selected[0].text=op.text;
    // A user text correction no longer proves the ASR token boundary.
    if(changed)next.boundary_processing='unknown';
  }else{
    const parent=selected[0],offset=op.split_offset;if(offset<=0||offset>=parent.text.length||
      (/[\uD800-\uDBFF]/.test(parent.text.charAt(offset-1))&&/[\uDC00-\uDFFF]/.test(parent.text.charAt(offset))))throw new Error('SPEAKER_SPLIT_OFFSET_INVALID');
    const start=parent.start_ms===null?parent.source_range?.start_ms:parent.start_ms;
    const end=parent.end_ms===null?parent.source_range?.end_ms:parent.end_ms;
    if(start===undefined||end===undefined)throw new Error('SPEAKER_SPLIT_SOURCE_UNKNOWN');
    const children:MaterialUtterance[]=[];const splitId=speakerDigest(op.operation_id).slice(0,20);
    for(let index=0;index<2;index++){const child=JSON.parse(JSON.stringify(parent)) as MaterialUtterance;
      child.utterance_id=row.material_id+'-u-split-'+splitId+'-'+index;child.start_ms=null;child.end_ms=null;
      const range=new MaterialSourceRange();range.parent_utterance_id=parent.utterance_id;range.parent_revision=row.revision;range.start_ms=start;range.end_ms=end;
      range.text_start=index===0?0:offset;range.text_end=index===0?offset:parent.text.length;child.source_range=range;
      child.text=parent.text.slice(range.text_start,range.text_end);children.push(child);}
    const at=next.utterances.findIndex((part:MaterialUtterance):boolean=>part.utterance_id===parent.utterance_id);next.utterances.splice(at,1,...children);
    next.boundary_processing='unknown';changed=true;
  }
  if(!changed)return row;
  next.revision++;next.text_revision++;next.text_origin='user';next.user_edited=true;next.sync_state='local';next.applied_job='';
  next.modified_at=Math.max(Date.now(),row.modified_at);next.text=renderMaterialTranscript(next);return next;
}

export class MaterialStore {
  private root:string='';
  private readingDepth:number=0;
  private readingRows:Map<string,MaterialRevision>=new Map();
  initialize(filesDir:string):void{
    this.root=filesDir+'/materials';if(!fs.accessSync(this.root))fs.mkdirSync(this.root);
  }
  queryCatalog():MaterialQueryCatalog{
    try{
      if(!this.root)throw new Error('MATERIAL_CATALOG_UNAVAILABLE');
      const directory=(path:string):string=>{
        const normalized=path.replace(/\\/g,'/');let cursor:string='';let rest:string='';let identity:string='';
        if(/^[A-Za-z]:\//.test(normalized)){cursor=normalized.slice(0,2);rest=normalized.slice(3);}
        else if(normalized.startsWith('/')&&!normalized.startsWith('//'))rest=normalized.slice(1);
        else throw new Error('MATERIAL_CATALOG_UNAVAILABLE');
        const parts=rest.split('/');if(parts.some((part:string):boolean=>!part||part==='.'||part==='..'))throw new Error('MATERIAL_CATALOG_UNAVAILABLE');
        for(const part of parts){cursor+='/'+part;const stat=fs.lstatSync(cursor);
          if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('MATERIAL_CATALOG_UNAVAILABLE');identity=String(stat.ino);
          if(!/^[0-9]+$/.test(identity))throw new Error('MATERIAL_CATALOG_UNAVAILABLE');}
        return identity;
      };
      const names=(path:string):string[]=>{const found=fs.listFileSync(path);
        if(!Array.isArray(found)||found.some((name:string):boolean=>typeof name!=='string')||new Set(found).size!==found.length)throw new Error('MATERIAL_CATALOG_UNAVAILABLE');
        return found;
      };
      const rootIdentity=directory(this.root),out=new MaterialQueryCatalog();
      out.ids=names(this.root).filter((name:string):boolean=>/^mat-(recording|lifelog)-[0-9a-f]{32}$/.test(name)).sort();
      const md=cryptoFramework.createMd('SHA256');
      const append=(value:string):void=>{const bytes=new util.TextEncoder().encodeInto(value);try{md.updateSync({data:bytes});}finally{bytes.fill(0);}};
      append(JSON.stringify(['material-query-catalog-v1',rootIdentity,out.ids.length])+'\n');
      for(const id of out.ids){
        // The complete root ancestry is checked at both ends of this
        // synchronous observation; each direct child needs one extra lstat.
        const path=this.root+'/'+id,child=fs.lstatSync(path),identity=String(child.ino);
        if(child.isSymbolicLink()||!child.isDirectory()||!/^[0-9]+$/.test(identity))throw new Error('MATERIAL_CATALOG_UNAVAILABLE');
        const versions=names(path).filter((name:string):boolean=>/^revision-[0-9]{9}\.json$/.test(name)).sort();
        append(JSON.stringify(['material',id,identity,versions.length])+'\n');
        for(const version of versions){
          const stat=fs.lstatSync(path+'/'+version);if(stat.isSymbolicLink()||!stat.isFile())throw new Error('MATERIAL_CATALOG_UNAVAILABLE');
          append(JSON.stringify(['revision',version])+'\n');
          if(version===versions[versions.length-1]){
            const ino=String(stat.ino);if(!/^[0-9]+$/.test(ino)||!Number.isSafeInteger(stat.size)||stat.size<0||
              !Number.isFinite(stat.mtime)||!Number.isFinite(stat.ctime)||
              (stat.mtimeNs!==undefined&&typeof stat.mtimeNs!=='bigint')||(stat.ctimeNs!==undefined&&typeof stat.ctimeNs!=='bigint'))throw new Error('MATERIAL_CATALOG_UNAVAILABLE');
            append(JSON.stringify(['head',version,ino,stat.size,stat.mtime,stat.ctime,
              stat.mtimeNs===undefined?'':String(stat.mtimeNs),stat.ctimeNs===undefined?'':String(stat.ctimeNs)])+'\n');
          }
        }
        if(!versions.length)append('["empty-head"]\n');
      }
      if(directory(this.root)!==rootIdentity)throw new Error('MATERIAL_CATALOG_UNAVAILABLE');
      const digest=md.digestSync().data;try{out.snapshot_sha256=Array.from(digest).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}finally{digest.fill(0);}
      return out;
    }catch(_){throw new Error('MATERIAL_CATALOG_UNAVAILABLE');}
  }
  idFor(kind:string,name:string):string{
    const prefix=kind==='recording'?'take-':kind==='lifelog'?'seg-':'';
    if(!prefix||!name.startsWith(prefix)||!/^[0-9a-f]{32}$/.test(name.slice(prefix.length)))throw new Error('MATERIAL_SOURCE_INVALID');
    return 'mat-'+kind+'-'+name.slice(prefix.length);
  }
  private directory(id:string):string{
    if(!this.root||!/^mat-(recording|lifelog)-[0-9a-f]{32}$/.test(id))throw new Error('MATERIAL_ID_INVALID');
    return this.root+'/'+id;
  }
  private validate(row:MaterialRevision,id:string):void{
    if(row.schema_version!==1||row.material_id!==id||!Number.isSafeInteger(row.revision)||row.revision<1||
      !Number.isSafeInteger(row.text_revision)||row.text_revision<0||row.text_revision>row.revision||
      !['upsert','delete'].includes(row.operation)||typeof row.text!=='string'||row.text.length>1000000||
      !Array.isArray(row.utterances)||row.utterances.length>10000||this.idFor(row.source.kind,row.source.name)!==id||
      !Number.isSafeInteger(row.source.started)||!Number.isSafeInteger(row.source.ended)||row.source.started<0||row.source.ended<row.source.started||
      !Number.isSafeInteger(row.source.audioBytes)||row.source.audioBytes<0||
      typeof row.source.complete!=='boolean'||typeof row.source.audioAvailable!=='boolean'||
      (row.source.audioFrames!==undefined&&(!Number.isSafeInteger(row.source.audioFrames)||row.source.audioFrames< -1))||
      (row.source.frameMs!==undefined&&![0,20,60].includes(row.source.frameMs))||
      (row.source.audioFrames>=0&&!([20,60].includes(row.source.frameMs)))||
      (row.source.audioFrames>=0&&!Number.isSafeInteger(row.source.audioFrames*row.source.frameMs))||
      (row.source.interrupted!==undefined&&typeof row.source.interrupted!=='boolean')||
      ![0,1,2].includes(row.source.decodedChannels)||typeof row.source.deviceId!=='string'||row.source.deviceId.length>128||
      typeof row.user_edited!=='boolean'||typeof row.applied_job!=='string'||row.applied_job.length>256||
      !Number.isSafeInteger(row.created_at)||!Number.isSafeInteger(row.modified_at)||row.modified_at<row.created_at||
      !['none','legacy','asr','user'].includes(row.text_origin)||
      (row.speaker_processing!==undefined&&!['unknown','pending','processed','unavailable'].includes(row.speaker_processing))||
      (row.boundary_processing!==undefined&&!['unknown','unverified','token_starts','no_speech'].includes(row.boundary_processing))||
      !['pending','verified','unavailable'].includes(row.audio_checksum_state)||
      typeof row.audio_sha256!=='string'||(row.audio_sha256!==''&&!/^[a-f0-9]{64}$/.test(row.audio_sha256)))throw new Error('MATERIAL_CORRUPT');
    // Pre-coverage sidecars remain readable without rewriting their history.
    if(row.transcription_state!==undefined){
      if(!['unknown','pending','partial','complete'].includes(row.transcription_state)||
        !Number.isSafeInteger(row.covered_ms)||row.covered_ms< -1||
        !Number.isSafeInteger(row.transcription_source_ms)||row.transcription_source_ms< -1||
        (row.covered_ms>=0&&row.transcription_source_ms>=0&&row.covered_ms>row.transcription_source_ms)||
        (row.transcription_state==='unknown'&&(row.covered_ms!==-1||row.transcription_source_ms!==-1))||
        (row.transcription_state==='pending'&&row.covered_ms!==0)||
        (row.transcription_state==='partial'&&(row.covered_ms<0||row.transcription_source_ms<0))||
        (row.transcription_state==='complete'&&(!row.source.complete||row.source.interrupted||row.covered_ms<0||
          row.covered_ms!==row.transcription_source_ms||row.source.audioFrames<0||
          !Number.isSafeInteger(row.source.audioFrames)||row.covered_ms!==row.source.audioFrames*row.source.frameMs)))throw new Error('MATERIAL_COVERAGE_INVALID');
    }
    if(row.speakers!==undefined){
      if(!Array.isArray(row.speakers)||row.speakers.length>10000)throw new Error('MATERIAL_SPEAKERS_INVALID');
      const speakerIds:string[]=[];let selfCount=0;
      for(const speaker of row.speakers){
        if(!speaker||Object.keys(speaker).some((key:string):boolean=>!['speaker_id','label','label_basis','is_self'].includes(key))||
          typeof speaker.speaker_id!=='string'||!scopedSpeakerId(id,speaker.speaker_id)||speakerIds.includes(speaker.speaker_id)||
          !speakerLabelValid(speaker.label)||!['anonymous','user_confirmed','role_match'].includes(speaker.label_basis)||
          typeof speaker.is_self!=='boolean'||(speaker.is_self&&speaker.label_basis!=='user_confirmed'))throw new Error('MATERIAL_SPEAKERS_INVALID');
        speakerIds.push(speaker.speaker_id);if(speaker.is_self)selfCount++;
      }
      if(selfCount>1)throw new Error('MATERIAL_SPEAKERS_INVALID');
    }
    if(row.speaker_correction!==undefined){
      const receipt=row.speaker_correction;
      if(!receipt||Object.keys(receipt).some((key:string):boolean=>!['operation_id','payload_sha256','base_revision'].includes(key))||
        typeof receipt.operation_id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(receipt.operation_id)||
        typeof receipt.payload_sha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.payload_sha256)||
        !Number.isSafeInteger(receipt.base_revision)||receipt.base_revision<1||receipt.base_revision>=row.revision)throw new Error('MATERIAL_SPEAKER_OPERATION_INVALID');
    }
    const ids:string[]=[];
    for(const part of row.utterances){
      if(typeof part.utterance_id!=='string'||!part.utterance_id||ids.includes(part.utterance_id)||
        typeof part.text!=='string'||part.text.length>65536||
        !['unknown','segment_cluster','user'].includes(part.speaker_basis)||typeof part.speaker_id!=='string'||part.speaker_id.length>128||typeof part.overlap!=='boolean')throw new Error('MATERIAL_UTTERANCE_INVALID');
      const unknownTime=part.start_ms===null&&part.end_ms===null;
      if((!unknownTime&&(!Number.isSafeInteger(part.start_ms)||!Number.isSafeInteger(part.end_ms)||part.start_ms===null||part.end_ms===null||
        part.start_ms<0||part.end_ms<part.start_ms||part.end_ms>row.source.ended-row.source.started))||
        (unknownTime&&(!part.source_range||row.boundary_processing!=='unknown'||!row.user_edited||row.text_origin!=='user'||
          !part.utterance_id.startsWith(id+'-u-split-')||!/^[a-f0-9]{20}-[01]$/.test(part.utterance_id.slice(id.length+9))))||
        (!unknownTime&&part.source_range!==undefined))throw new Error('MATERIAL_UTTERANCE_INVALID');
      if(row.speakers!==undefined&&((part.speaker_id&&!row.speakers.some((speaker:MaterialSpeaker):boolean=>speaker.speaker_id===part.speaker_id))||
        (part.speaker_id===''&&part.speaker_basis!=='unknown')||(part.speaker_id!==''&&part.speaker_basis==='unknown')))throw new Error('MATERIAL_SPEAKERS_INVALID');
      if(part.source_range!==undefined)this.validateSourceRange(row,part);
      ids.push(part.utterance_id);
    }
  }
  private validateSourceRange(row:MaterialRevision,part:MaterialUtterance):void{
    const range=part.source_range as MaterialSourceRange;
    if(!range||Object.keys(range).some((key:string):boolean=>!['parent_utterance_id','parent_revision','start_ms','end_ms','text_start','text_end'].includes(key))||
      typeof range.parent_utterance_id!=='string'||!range.parent_utterance_id||range.parent_utterance_id.length>256||
      !Number.isSafeInteger(range.parent_revision)||range.parent_revision<1||range.parent_revision>=row.revision||
      !Number.isSafeInteger(range.start_ms)||range.start_ms<0||!Number.isSafeInteger(range.end_ms)||range.end_ms<range.start_ms||
      range.end_ms>row.source.ended-row.source.started||!Number.isSafeInteger(range.text_start)||range.text_start<0||
      !Number.isSafeInteger(range.text_end)||range.text_end<=range.text_start)throw new Error('MATERIAL_SOURCE_RANGE_INVALID');
    const parentRevision=this.read(row.material_id,range.parent_revision);
    const parent=parentRevision?.utterances.find((saved:MaterialUtterance):boolean=>saved.utterance_id===range.parent_utterance_id);
    if(!parentRevision||parentRevision.operation==='delete'||!parent||range.text_end>parent.text.length||
      range.start_ms!==(parent.start_ms===null?parent.source_range?.start_ms:parent.start_ms)||
      range.end_ms!==(parent.end_ms===null?parent.source_range?.end_ms:parent.end_ms)||
      (range.text_start>0&&/[\uD800-\uDBFF]/.test(parent.text.charAt(range.text_start-1))&&/[\uDC00-\uDFFF]/.test(parent.text.charAt(range.text_start)))||
      (range.text_end<parent.text.length&&/[\uD800-\uDBFF]/.test(parent.text.charAt(range.text_end-1))&&/[\uDC00-\uDFFF]/.test(parent.text.charAt(range.text_end))))throw new Error('MATERIAL_SOURCE_RANGE_INVALID');
    // Child text can subsequently be explicitly edited; provenance still refers
    // to the selected UTF-16 range in the immutable parent, never invented timing.
  }
  read(id:string,revision:number=0):MaterialRevision|undefined{
    // Cache only within one synchronous validation traversal. Parent references
    // share immutable revisions; repeated splits must not recursively reread the
    // same history exponentially. A later public read always rechecks disk.
    if(this.readingDepth===0)this.readingRows.clear();this.readingDepth++;
    try{
      const directory=this.directory(id);if(!fs.accessSync(directory))return undefined;
      if(revision>0){const cached=this.readingRows.get(id+':'+revision.toString());if(cached)return cached;}
      const versions=fs.listFileSync(directory).filter((name:string):boolean=>/^revision-[0-9]{9}\.json$/.test(name)).sort();
      const name=revision>0?'revision-'+revision.toString().padStart(9,'0')+'.json':versions.pop();
      if(!name)return undefined;
      const path=directory+'/'+name;if(!fs.accessSync(path))return undefined;
      if(fs.statSync(path).size>4000000)throw new Error('MATERIAL_TOO_LARGE');
      const row=JSON.parse(fs.readTextSync(path)) as MaterialRevision;this.validate(row,id);
      if(name!=='revision-'+row.revision.toString().padStart(9,'0')+'.json')throw new Error('MATERIAL_REVISION_MISMATCH');
      this.readingRows.set(id+':'+row.revision.toString(),row);return row;
    }finally{this.readingDepth--;if(this.readingDepth===0)this.readingRows.clear();}
  }
  private commit(row:MaterialRevision,expected:number):MaterialRevision{
    this.validate(row,row.material_id);
    const current=this.read(row.material_id);
    if((current?.revision||0)!==expected||row.revision!==expected+1)throw new Error('REVISION_CONFLICT');
    const directory=this.directory(row.material_id);if(!fs.accessSync(directory))fs.mkdirSync(directory);
    const target=directory+'/revision-'+row.revision.toString().padStart(9,'0')+'.json';
    if(fs.accessSync(target))throw new Error('REVISION_CONFLICT');
    const bytes=new util.TextEncoder().encodeInto(JSON.stringify(row));
    if(bytes.length>4000000)throw new Error('MATERIAL_TOO_LARGE');
    const file=fs.openSync(target+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{
      let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('MATERIAL_WRITE_FAILED');offset+=n;}
      fs.fsyncSync(file.fd);
    }finally{fs.closeSync(file);bytes.fill(0);}
    // 发布不可变修订即提交点；崩溃留下partial时不会被read读取。
    fs.renameSync(target+'.partial',target);return row;
  }
  ensure(source:MaterialSource,legacyText:string='',legacyInput:MaterialTextInput|undefined=undefined):MaterialRevision{
    const id=this.idFor(source.kind,source.name);const old=this.read(id);
    if(old){
      if(old.operation==='delete')return old;
      // 只更新原音完整性/缺失状态，旧转写不能覆盖用户修订。
      if(old.source.complete===source.complete&&old.source.audioAvailable===source.audioAvailable&&old.source.audioBytes===source.audioBytes&&old.source.ended>=source.ended&&
        old.source.audioFrames===source.audioFrames&&old.source.frameMs===source.frameMs&&old.source.interrupted===source.interrupted)return old;
      const next=JSON.parse(JSON.stringify(old)) as MaterialRevision;
      next.revision++;next.modified_at=Date.now();
      next.source.complete=source.complete;next.source.audioAvailable=source.audioAvailable;next.source.audioBytes=source.audioBytes;
      next.source.ended=Math.max(old.source.ended,source.ended);
      next.source.audioFrames=source.audioFrames;next.source.frameMs=source.frameMs;next.source.interrupted=source.interrupted;
      const changed=old.source.audioBytes!==source.audioBytes||old.source.audioFrames!==source.audioFrames||old.source.frameMs!==source.frameMs;
      if(changed&&next.transcription_state!==undefined&&next.transcription_state!=='unknown'){
        if(source.audioBytes<old.source.audioBytes||source.audioFrames<old.source.audioFrames||source.frameMs!==old.source.frameMs){
          next.transcription_state='unknown';next.covered_ms=-1;next.transcription_source_ms=-1;
        }else{
          next.transcription_source_ms=source.audioFrames>=0?source.audioFrames*source.frameMs:-1;
          if(next.transcription_source_ms<next.covered_ms){next.transcription_state='unknown';next.covered_ms=-1;next.transcription_source_ms=-1;}
          else if(next.transcription_state==='complete')next.transcription_state='partial';
        }
      }
      if((!source.complete||source.interrupted)&&next.transcription_state==='complete')next.transcription_state='partial';
      if(old.source.audioBytes!==source.audioBytes){next.audio_sha256='';next.audio_checksum_state=source.audioAvailable?'pending':'unavailable';}
      if(old.source.audioAvailable!==source.audioAvailable){next.audio_sha256='';next.audio_checksum_state=source.audioAvailable?'pending':'unavailable';}
      next.sync_state='local';return this.commit(next,old.revision);
    }
    const row=new MaterialRevision();row.material_id=id;row.source=source;
    row.audio_checksum_state=source.audioAvailable?'pending':'unavailable';
    row.created_at=Date.now();row.modified_at=row.created_at;
    row.text=legacyText||legacyInput?.text||'';const hasLegacy=!!row.text||(legacyInput?.utterances.length||0)>0;
    row.text_origin=hasLegacy?'legacy':'none';row.text_revision=hasLegacy?1:0;
    if(!row.text&&!legacyInput){row.transcription_state='pending';row.covered_ms=0;row.transcription_source_ms=source.audioFrames>=0?source.audioFrames*source.frameMs:-1;}
    if(legacyInput){row.utterances=this.assignUtterances(row,legacyInput.utterances);row.speakers=legacyInput.speakers;row.recognition_channel=legacyInput.channel;row.speaker_processing=legacyInput.speakerProcessing||'unknown';row.boundary_processing=legacyInput.boundaryProcessing||'unknown';this.applyCoverage(row,legacyInput);}
    return this.commit(row,0);
  }
  private applyCoverage(row:MaterialRevision,input:MaterialTextInput):void{
    row.transcription_state=input.transcriptionState||'unknown';row.covered_ms=input.coveredMs===undefined?-1:input.coveredMs;
    row.transcription_source_ms=input.sourceMs===undefined?-1:input.sourceMs;
    if(row.transcription_state==='complete'&&row.covered_ms!==row.transcription_source_ms)throw new Error('MATERIAL_COVERAGE_INVALID');
    // A file may have grown while inference ran; full processing of the earlier
    // snapshot cannot mark the current source complete.
    if(row.transcription_state==='complete'&&(!row.source.complete||row.source.interrupted||
      !Number.isSafeInteger(row.source.audioFrames)||row.source.audioFrames<0||
      row.transcription_source_ms!==row.source.audioFrames*row.source.frameMs))row.transcription_state='partial';
  }
  private assignUtterances(row:MaterialRevision,input:MaterialUtterance[]):MaterialUtterance[]{
    return input.map((part:MaterialUtterance,index:number):MaterialUtterance=>{
      const next=JSON.parse(JSON.stringify(part)) as MaterialUtterance;
      const old=row.utterances.find((saved:MaterialUtterance):boolean=>saved.start_ms===part.start_ms&&saved.end_ms===part.end_ms&&saved.text===part.text);
      next.utterance_id=old?.utterance_id||row.material_id+'-u'+row.revision+'-'+index;return next;
    });
  }
  appendTranscript(id:string,expected:number,input:MaterialTextInput,job:string=''):MaterialRevision{
    const old=this.read(id);if(!old)throw new Error('MATERIAL_NOT_FOUND');
    if(old.operation==='delete')throw new Error('MATERIAL_DELETED');
    if(job&&old.applied_job===job)return old;
    if(old.revision!==expected)throw new Error('REVISION_CONFLICT');
    if(old.user_edited)throw new Error('USER_REVISION_PROTECTED');
    const next=JSON.parse(JSON.stringify(old)) as MaterialRevision;
    next.revision++;next.text_revision++;next.text=input.text;
    next.utterances=this.assignUtterances(next,input.utterances);next.speakers=input.speakers;next.speaker_correction=undefined;next.text_origin='asr';next.recognition_channel=input.channel;
    next.speaker_processing=input.speakerProcessing||'unknown';
    next.boundary_processing=input.boundaryProcessing||'unknown';
    this.applyCoverage(next,input);
    next.modified_at=Date.now();next.sync_state='local';next.applied_job=job;
    return this.commit(next,expected);
  }
  correctText(id:string,expected:number,utteranceId:string,text:string):MaterialRevision{
    const old=this.read(id);if(!old||old.operation==='delete')throw new Error('MATERIAL_NOT_FOUND');
    if(old.revision!==expected)throw new Error('REVISION_CONFLICT');
    const next=JSON.parse(JSON.stringify(old)) as MaterialRevision;
    const part=next.utterances.find((row:MaterialUtterance):boolean=>row.utterance_id===utteranceId);
    if(!part)throw new Error('UTTERANCE_NOT_FOUND');part.text=text;
    next.text=next.utterances.map((row:MaterialUtterance):string=>row.text).join('\n');
    next.revision++;next.text_revision++;next.text_origin='user';next.user_edited=true;
    next.modified_at=Date.now();next.sync_state='local';next.applied_job='';return this.commit(next,expected);
  }
  correctSpeakers(id:string,expected:number,input:MaterialSpeakerCorrection):MaterialRevision{
    if(!Number.isSafeInteger(expected)||expected<1)throw new Error('REVISION_CONFLICT');
    const old=this.read(id);if(!old)throw new Error('MATERIAL_NOT_FOUND');if(old.operation==='delete')throw new Error('MATERIAL_DELETED');
    const op=canonicalSpeakerOperation(input);
    const payload=speakerDigest(id+'\n'+expected.toString()+'\n'+JSON.stringify(op));
    const directory=this.directory(id),noopPath=directory+'/speaker-noop-'+speakerDigest(op.operation_id)+'.json';
    // Receipts live in immutable revisions, so a failed promotion has no effect
    // and a lost reply after promotion can be reconciled across cold restarts.
    const versions=fs.listFileSync(directory).filter((name:string):boolean=>/^revision-[0-9]{9}\.json$/.test(name)).sort();
    for(const name of versions){const version=Number(name.slice(9,18));const row=this.read(id,version);
      if(row?.speaker_correction?.operation_id!==op.operation_id)continue;
      if(row.speaker_correction.payload_sha256!==payload||row.speaker_correction.base_revision!==expected)throw new Error('SPEAKER_OPERATION_CONFLICT');
      const applied=this.read(id,expected+1);
      if(!applied||applied.speaker_correction?.operation_id!==op.operation_id||applied.speaker_correction.payload_sha256!==payload||
        applied.speaker_correction.base_revision!==expected)throw new Error('MATERIAL_SPEAKER_OPERATION_INVALID');return applied;
    }
    if(fs.accessSync(noopPath)){
      if(fs.statSync(noopPath).size>4096)throw new Error('MATERIAL_SPEAKER_OPERATION_INVALID');
      const receipt=JSON.parse(fs.readTextSync(noopPath)) as MaterialSpeakerCorrectionReceipt;
      if(Object.keys(receipt).some((key:string):boolean=>!['operation_id','payload_sha256','base_revision'].includes(key))||
        receipt.operation_id!==op.operation_id||!Number.isSafeInteger(receipt.base_revision)||receipt.base_revision<1||
        typeof receipt.payload_sha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.payload_sha256))throw new Error('MATERIAL_SPEAKER_OPERATION_INVALID');
      if(receipt.payload_sha256!==payload)throw new Error('SPEAKER_OPERATION_CONFLICT');
      if(receipt.base_revision!==expected)throw new Error('MATERIAL_SPEAKER_OPERATION_INVALID');
      const base=this.read(id,receipt.base_revision);if(!base||base.operation==='delete')throw new Error('MATERIAL_SPEAKER_OPERATION_INVALID');return base;
    }
    if(old.revision!==expected)throw new Error('REVISION_CONFLICT');
    const next=applyMaterialSpeakerCorrection(old,op);
    const receipt=new MaterialSpeakerCorrectionReceipt();receipt.operation_id=op.operation_id;receipt.payload_sha256=payload;receipt.base_revision=expected;
    if(next===old){
      // A durable no-op receipt protects operation IDs without inventing a text
      // revision. The .partial file is ignored until atomic promotion succeeds.
      const bytes=new util.TextEncoder().encodeInto(JSON.stringify(receipt));const file=fs.openSync(noopPath+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
      try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('MATERIAL_WRITE_FAILED');offset+=n;}fs.fsyncSync(file.fd);}
      finally{fs.closeSync(file);bytes.fill(0);}fs.renameSync(noopPath+'.partial',noopPath);return old;
    }
    next.speaker_correction=receipt;return this.commit(next,expected);
  }
  delete(id:string,expected:number):MaterialRevision{
    const old=this.read(id);if(!old)throw new Error('MATERIAL_NOT_FOUND');
    if(old.revision!==expected)throw new Error('REVISION_CONFLICT');
    if(old.operation==='delete')return old;
    const next=JSON.parse(JSON.stringify(old)) as MaterialRevision;
    next.revision++;next.operation='delete';next.text='';next.utterances=[];
    if(next.speakers!==undefined)next.speakers=[];
    next.speaker_correction=undefined;
    next.modified_at=Date.now();next.sync_state='local';return this.commit(next,expected);
  }
  ids():string[]{
    if(!this.root)return [];
    return fs.listFileSync(this.root).filter((name:string):boolean=>/^mat-(recording|lifelog)-[0-9a-f]{32}$/.test(name)).sort();
  }
}
