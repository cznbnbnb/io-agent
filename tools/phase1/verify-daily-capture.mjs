// Usage: node verify-daily-capture.mjs capture.json recovery.json private-run version hap-sha256 output.json
// Read only: independently check a completed isolated archive; publish no text or IDs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {loadApp} from '../../rebuild/harmony-sdk/tests/load-app.mjs';
const [capturePath,recoveryPath,root,version,hapSha,output,...extra]=process.argv.slice(2);
assert(output&&!extra.length&&/^0\.1\.\d+$/.test(version)&&/^[a-f0-9]{64}$/.test(hapSha),'Invalid arguments');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const capture=read(capturePath),recovery=read(recoveryPath);
for(const journal of [capture,recovery])assert(journal.schema===1&&journal.kind==='p22_actual_daily_coordinator','Unexpected journal');
assert(capture.root===recovery.root&&capture.created===recovery.created,'Capture and recovery differ');
assert(recovery.phase==='completed'&&recovery.finished>0,'Recovery not complete');
assert(capture.samples.some(s=>s.capture&&s.bytes>0),'No actual acquisition observed');
const segments=fs.readdirSync(path.join(root,'lifelog')).filter(n=>/^seg-[0-9a-f]{32}$/.test(n));
assert(segments.length===1,'Expected exactly one isolated source');
const segment=path.join(root,'lifelog',segments[0]),audio=fs.readFileSync(path.join(segment,'audio.ogg'));
const meta=read(path.join(segment,'meta.json')),transcript=read(path.join(segment,'transcript.json'));
const frames=loadApp('OggOpus').readOggOpusFrames(new Uint8Array(audio)).length;
assert(frames>0&&frames===meta.frames&&meta.sealed===true,'Archive metadata mismatch');
assert(transcript.transcription_complete===true&&transcript.covered_frames===frames&&transcript.source_frames===frames,'Incomplete transcript');
const jobs=fs.readdirSync(path.join(root,'asr-windows')).filter(n=>/^asr-lifelog-[0-9a-f]{32}$/.test(n));
assert(jobs.length===1,'Expected one window stream');
const windows=fs.readdirSync(path.join(root,'asr-windows',jobs[0])).filter(n=>/^window-[0-9]{6}\.json$/.test(n))
 .map(n=>read(path.join(root,'asr-windows',jobs[0],n)).result).sort((a,b)=>a.windowStartFrame-b.windowStartFrame);
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
let cursor=0;
for(const w of windows){
 assert(w.windowStartFrame===cursor&&w.windowEndFrame>cursor&&w.windowEndFrame<=frames,'Coverage gap or overlap');cursor=w.windowEndFrame;
 assert(w.sourcePrefixBytes>0&&w.sourcePrefixBytes<=audio.length&&digest(audio.subarray(0,w.sourcePrefixBytes))===w.sourcePrefixSha256,'Prefix digest mismatch');
 for(const u of w.utterances){
  assert(u.alignment==='token_starts'&&u.tokens.length===u.tokenStarts.length,'Token provenance missing');
  assert(u.tokenStarts.every(t=>{const us=Math.round(t*1e6),end=w.windowEndFrame*60000;return us>=w.windowStartFrame*60000&&(us<end||us===end&&end===w.frames*60000);}), 'Token outside owned core');
 }
}
assert(cursor===frames,'Tail not covered');
const ids=fs.readdirSync(path.join(root,'materials')).filter(n=>/^mat-lifelog-[0-9a-f]{32}$/.test(n));assert(ids.length===1,'Expected one material');
const materialDir=path.join(root,'materials',ids[0]);const revisions=fs.readdirSync(materialDir).filter(n=>/^revision-[0-9]{9}\.json$/.test(n)).sort();
const material=read(path.join(materialDir,revisions.at(-1)));
assert(material.transcription_state==='complete'&&material.covered_ms===frames*60&&material.transcription_source_ms===frames*60,'Material coverage mismatch');
assert(JSON.stringify(material.utterances.map(u=>u.text))===JSON.stringify(transcript.utterances.map(u=>u.text)),'Published texts differ');
const out={kind:'p22_independent_capture_archive_verification',version,signed_hap_sha256:hapSha,bytes:audio.length,sha256:digest(audio),frames,seconds:frames*60/1000,
 continuous_core_coverage:true,all_committed_prefix_hashes_verified:true,model_token_starts_owned_by_core:true,
 windows:windows.map(w=>[w.windowStartFrame,w.windowEndFrame]),transcription_complete:true,
 material_revision:material.revision,text_revision:material.text_revision,utterances:transcript.utterances.length,
 speaker_processing:material.speaker_processing,boundary_processing:material.boundary_processing,
 recognition_accuracy_verified:false,speaker_identity_verified:false,eight_hour_acceptance_passed:false};
fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');process.stdout.write(JSON.stringify(out)+'\n');
