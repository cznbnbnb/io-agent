// macOS only: synthesize the fixed four-condition answer with the system TTS
// into a 16 kHz mono PCM WAV and its hash record. Never records or plays audio.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.join(workspace,'rebuild/android-app');
const date=process.argv[2];if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw Error('usage: make-voice-source.mjs YYYY-MM-DD');
// v1 "先预览" came back from the official ASR as "千玉懒"; "只做预览" anchors the word.
const text='只做预览。不要修改文件，保留全部资料。请在星期五继续，附加条件也要完整保留。',voice='Tingting';
const directory=path.join(root,'.private','voice-source-'+date),record=path.join(root,'asr-synthetic-source-'+date+'.json');
if(process.platform!=='darwin')throw Error('macOS say/afconvert required');
if(fs.existsSync(directory)||fs.existsSync(record))throw Error('Source already exists; inspect before replacing');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8'});if(r.error||r.status!==0)throw Error(cmd+' failed');};
function pcmOf(wav){
 let offset=12,format=null,data=null;
 while(offset+8<=wav.length){const kind=wav.toString('ascii',offset,offset+4),length=wav.readUInt32LE(offset+4);if(kind==='fmt ')format=wav.subarray(offset+8,offset+8+length);if(kind==='data')data=wav.subarray(offset+8,offset+8+length);offset+=8+length+(length&1);}
 if(!format||!data||format.readUInt16LE(0)!==1||format.readUInt16LE(2)!==1||format.readUInt32LE(4)!==16000||format.readUInt16LE(14)!==16)throw Error('Unexpected afconvert output');
 return Buffer.from(data);
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'io-voice-source-'));
try{
 // Speak slower or faster until the clip lands inside the guard's 8-9 s window.
 let pcm=null,rate=0;
 for(const wpm of [145,140,150,135,155,130,160]){
  const aiff=path.join(temp,wpm+'.aiff'),wav=path.join(temp,wpm+'.wav');
  run('say',['-v',voice,'-r',String(wpm),'-o',aiff,text]);run('afconvert','-f WAVE -d LEI16@16000 -c 1'.split(' ').concat([aiff,wav]));
  const candidate=pcmOf(fs.readFileSync(wav)),seconds=candidate.length/32000;if(seconds>=8.05&&seconds<8.95){pcm=candidate;rate=wpm;break;}
 }
 if(!pcm)throw Error('No speaking rate produced an 8-9 s clip');
 const header=Buffer.alloc(44);header.write('RIFF',0,'ascii');header.writeUInt32LE(36+pcm.length,4);header.write('WAVE',8,'ascii');header.write('fmt ',12,'ascii');header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36,'ascii');header.writeUInt32LE(pcm.length,40);
 const wav=Buffer.concat([header,pcm]);let nonzero=0,peak=0;for(let i=0;i<pcm.length;i+=2){const n=pcm.readInt16LE(i);if(n!==0)nonzero++;peak=Math.max(peak,Math.abs(n));}
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(directory,'synthetic.wav'),wav,{flag:'wx',mode:0o600});fs.writeFileSync(path.join(directory,'synthetic.pcm'),pcm,{flag:'wx',mode:0o600});
 const value={schema:1,generator:'macOS say -v '+voice+' -r '+rate+' | afconvert LEI16@16000 mono',text_sha256:hash(Buffer.from(text,'utf8')),conditions:['预览','不要修改文件','保留全部资料','星期五'],rate:16000,channels:1,bits:16,pcm_bytes:pcm.length,pcm_sha256:hash(pcm),wav_sha256:hash(wav),nonzero_samples:nonzero,peak,duration_seconds:pcm.length/32000,directory:path.relative(root,directory).replaceAll('\\','/')};
 fs.writeFileSync(record,JSON.stringify(value,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(value));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
