// Prepare a fresh normal RecordingSession source fixture. No phone/cloud actions.
// Audio is a COPY of the previously authorized 0.1.23 test; text/IDs are synthetic.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(),priv=path.join(root,'rebuild/phase1/device-private');
const dir=path.join(priv,'recording-delete063-fixture');
assert(!fs.existsSync(dir),'DO_NOT_OVERWRITE_FIXTURE');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const raw=fs.readFileSync(path.join(priv,'asr24-source-before.rawopus'));
const wav=fs.readFileSync(path.join(priv,'recording23-full-voice.wav'));
assert.equal(sha(raw),'c993ed0b68db572a047b17622a150e7d50666dbb6a8501a6ed4495bb0a305250');
assert.equal(sha(wav),'f425d5693096eb30356558bc520f3a12985980ae2a109afb4e41e59fbbd7ab71');
assert.equal(raw.length,710880);assert.equal(wav.length,44+raw.length/240*1280);
assert.equal(wav.subarray(0,4).toString(),'RIFF');assert.equal(wav.subarray(8,12).toString(),'WAVE');
assert.equal(wav.readUInt16LE(22),2);assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readUInt16LE(34),16);
const id=crypto.randomUUID().replaceAll('-',''),take='take-'+id,created=Date.now();
const marker='RECORDING-DELETE-SYNTHETIC-'+id;
const manifest={version:1,uuid:id,peer:'synthetic-delete-test',created,completed:true,valid:true,wavReady:true,coverage:[[0,raw.length]]};
const textName='transcript-'+created+'.md';
const files={'source.rawopus':raw,'audio.wav':wav,'manifest.json':Buffer.from(JSON.stringify(manifest)),
 [textName]:Buffer.from(marker+'\n合成文字仅验证录音删除，不代表该音频的ASR结果。\n')};
fs.mkdirSync(path.join(dir,take),{recursive:true});
const record={synthetic:true,source_kind:'copy of previously authorized 0.1.23 test audio; synthetic ID/date/transcript; no new capture or ASR',
 take_name:take,material_id:'mat-recording-'+id,marker,created,frame_count:raw.length/240,duration_ms:raw.length/240*20,files:{}};
for(const [name,bytes]of Object.entries(files)){
 fs.writeFileSync(path.join(dir,take,name),bytes,{flag:'wx'});record.files[name]={bytes:bytes.length,sha256:sha(bytes)};
}
fs.writeFileSync(path.join(dir,'fixture.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({synthetic:true,material_id:record.material_id,source_files:Object.keys(files).length,reused_original_source_untouched:true}));
