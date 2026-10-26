import fs from 'node:fs';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {canonical,reject} from './json.mjs';
const require=createRequire(import.meta.url);
function dependency(n){
  try{return require(n);}catch(error){
    if(process.env.TURBOIO_CONTRACT_DEV_DEPS==='1')return require('../../tools/deveco-cli/node_modules/'+n);
    throw error;
  }
}
const contractNames=['event-v1.schema.json','event-v1.1.schema.json','event-v1.2.schema.json'];
// A release carries its schemas with the switched code directory. The explicit
// marker binds all three files; a damaged release must never fall back to the
// shared, older schemas. Source checkouts and historical packages have neither.
function contracts(){
  const marker=new URL('./release-contracts.json',import.meta.url),local=new URL('./contracts/',import.meta.url);
  const stat=url=>{try{return fs.lstatSync(url);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const m=stat(marker),d=stat(local);
  if(!m){if(d)throw new Error('RELEASE_CONTRACT_MARKER_MISSING');return new URL('../../docs/contracts/',import.meta.url);}
  if(!m.isFile()||m.isSymbolicLink()||m.size>4096||!d?.isDirectory()||d.isSymbolicLink())throw new Error('RELEASE_CONTRACT_LAYOUT_INVALID');
  let manifest;try{manifest=JSON.parse(fs.readFileSync(marker,'utf8'));}catch{throw new Error('RELEASE_CONTRACT_MARKER_INVALID');}
  if(!manifest||Object.keys(manifest).sort().join(',')!=='files,schema'||manifest.schema!==1||
    !manifest.files||Array.isArray(manifest.files)||Object.keys(manifest.files).sort().join(',')!==[...contractNames].sort().join(','))throw new Error('RELEASE_CONTRACT_MARKER_INVALID');
  for(const name of contractNames){
    const file=new URL(name,local),s=stat(file),expected=manifest.files[name];
    if(!s?.isFile()||s.isSymbolicLink()||s.size>2097152||typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||
      createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected)throw new Error('RELEASE_CONTRACT_HASH_MISMATCH');
  }
  return local;
}
// P40 queue objects reuse the P14 v1.0 envelope. Each kind is validated against
// its own $defs entry so a material body can never be accepted as a task.
export function createQueueValidator(){
  const Ajv=dependency('ajv/dist/2020.js'),formats=dependency('ajv-formats');const ajv=new Ajv({allErrors:true,strict:false});formats(ajv);
  const root=contracts();
  const schema=JSON.parse(fs.readFileSync(new URL('event-v1.schema.json',root)));ajv.addSchema(schema);
  const envelope=ajv.getSchema(schema.$id);
  const kinds=['task','request','answer','message','receipt'];
  const bodies=new Map(kinds.map(k=>[k,ajv.getSchema(schema.$id+'#/$defs/'+k)]));
  return (event,kind)=>{
    if(!kinds.includes(kind)||event?.kind!==kind||event?.schema_version!=='1.0'||!envelope(event)||!bodies.get(kind)(event.body))reject(400,'INVALID');
    canonical(event);
    function numbers(v){if(typeof v==='number'&&!Number.isSafeInteger(v))reject(400,'INVALID_NUMBER');if(v&&typeof v==='object')for(const x of Object.values(v))numbers(x);}
    numbers(event);
    if([Date.parse(event.created_at),Date.parse(event.expires_at)].some(n=>!Number.isFinite(n))||Date.parse(event.created_at)>=Date.parse(event.expires_at))reject(400,'INVALID_TIME_RANGE');
    return true;
  };
}

export function createValidator(){
  const Ajv=dependency('ajv/dist/2020.js'),formats=dependency('ajv-formats');const ajv=new Ajv({allErrors:true,strict:false});formats(ajv);
  const root=contracts();
  const old=JSON.parse(fs.readFileSync(new URL('event-v1.schema.json',root)));ajv.addSchema(old);
  const current=JSON.parse(fs.readFileSync(new URL('event-v1.1.schema.json',root)));ajv.addSchema(current);
  const speakers=JSON.parse(fs.readFileSync(new URL('event-v1.2.schema.json',root)));ajv.addSchema(speakers);
  const versions=new Map([['1.0',ajv.getSchema(old.$id)],['1.1',ajv.getSchema(current.$id)],['1.2',ajv.getSchema(speakers.$id)]]);
  return event=>{
    const validate=versions.get(event?.schema_version);if(!validate)reject(400,'UNSUPPORTED_SCHEMA_VERSION');
    if(!validate(event)||event.kind!=='material.revision')reject(400,'INVALID');
    const b=event.body;canonical(event);
    function numbers(v){if(typeof v==='number'&&!Number.isSafeInteger(v))reject(400,'INVALID_NUMBER');if(v&&typeof v==='object')for(const x of Object.values(v))numbers(x);}
    numbers(event);
    const start=Date.parse(b.started_at),end=Date.parse(b.ended_at);
    if([start,end,Date.parse(event.created_at),Date.parse(event.expires_at)].some(n=>!Number.isFinite(n))||end<start)reject(400,'INVALID_TIME_RANGE');
    if(b.revision!==b.base_revision+1)reject(409,'REVISION_CONFLICT');
    const ids=new Set();
    for(const u of b.utterances){
      if(ids.has(u.utterance_id)||(u.start_ms!==null&&(u.end_ms<u.start_ms||u.end_ms>end-start)))reject(400,'INVALID_UTTERANCE');ids.add(u.utterance_id);
      if((u.speaker_basis==='unknown'&&u.speaker_id!==null)||(u.speaker_basis!=='unknown'&&!u.speaker_id))reject(400,'INVALID_SPEAKER');
    }
    if(b.audio.state==='stored_verified'||b.audio.object_id!==null)reject(409,'AUDIO_NOT_VERIFIED');
    if(b.operation==='delete'&&(b.utterances.length||b.full_text?.text))reject(400,'INVALID_TOMBSTONE');
    const p=b.processing;
    if(p&&((p.covered_ms!==null&&p.source_ms!==null&&p.covered_ms>p.source_ms)||
      (p.transcription_state==='complete'&&(p.covered_ms!==p.source_ms||b.completeness!=='complete'))))reject(400,'INVALID_COVERAGE');
    if(event.schema_version==='1.2')validateSpeakerMaterial(b);
    return true;
  };
}

// Pure cross-field checks also protect query clients from invalid remote data.
// Historic parent text/ranges require the authenticated store transaction below.
export function validateSpeakerMaterial(b){
  const speakers=new Set(),utterances=new Set();let self=0;
  if(!Number.isSafeInteger(b.revision)||b.revision!==b.base_revision+1||!Number.isSafeInteger(b.text_revision))reject(400,'INVALID_NUMBER');
  const p=b.processing;
  if((p.covered_ms!==null&&p.source_ms!==null&&p.covered_ms>p.source_ms)||
    (p.transcription_state==='complete'&&(p.covered_ms!==p.source_ms||b.completeness!=='complete')))reject(400,'INVALID_COVERAGE');
  for(const s of b.speakers){
    const suffix=s.speaker_id.slice((b.material_id+'-s').length);
    if(!s.speaker_id.startsWith(b.material_id+'-s')||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(suffix)||
      /[\u0000-\u001f\u007f-\u009f]/.test(s.speaker_id)||speakers.has(s.speaker_id)||!s.label.trim()||s.label.length>80||
      /[\u0000-\u001f\u007f-\u009f]/.test(s.label)||(s.is_self&&(s.label_basis!=='user_confirmed'||++self>1)))reject(400,'INVALID_SPEAKER_DICTIONARY');
    speakers.add(s.speaker_id);
  }
  for(const u of b.utterances){
    if(utterances.has(u.utterance_id))reject(400,'INVALID_UTTERANCE');utterances.add(u.utterance_id);
    if(u.speaker_id!==null&&!speakers.has(u.speaker_id))reject(400,'INVALID_SPEAKER_DICTIONARY');
    if((u.speaker_basis==='unknown')!==(u.speaker_id===null))reject(400,'INVALID_SPEAKER');
    if((u.start_ms===null)!==(u.end_ms===null)||u.start_ms===null&&!u.source_range)reject(400,'INVALID_SOURCE_RANGE');
    if(u.start_ms!==null&&(u.end_ms<u.start_ms||u.end_ms>Date.parse(b.ended_at)-Date.parse(b.started_at)))reject(400,'INVALID_UTTERANCE');
    const r=u.source_range;
    if(r&&(r.parent_revision>=b.revision||r.end_ms<r.start_ms||r.end_ms>Date.parse(b.ended_at)-Date.parse(b.started_at)||
      r.text_end<=r.text_start||(u.start_ms!==null&&(u.start_ms<r.start_ms||u.end_ms>r.end_ms))))reject(400,'INVALID_SOURCE_RANGE');
    if(b.processing.covered_ms!==null&&((u.end_ms!==null&&u.end_ms>b.processing.covered_ms)||r&&r.end_ms>b.processing.covered_ms))reject(400,'INVALID_COVERAGE');
  }
}
