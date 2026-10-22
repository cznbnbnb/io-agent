// Container-only benchmark. Dummy packets are not speech or decoder fixtures.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {performance} from 'node:perf_hooks';
import {loadApp} from '../../rebuild/harmony-sdk/tests/load-app.mjs';
const {OggOpusWriter,inspectLifelogPrefix}=loadApp('OggOpus');
const directory=path.resolve('rebuild/phase1/device-private/ogg-index-'+Date.now());fs.mkdirSync(directory);
const rows=[];
for(const frames of [10000,50000]){
 const chunks=[],writer=new OggOpusWriter(b=>chunks.push(b),101,100);writer.begin();
 for(let i=0;i<frames;i++)writer.push(new Uint8Array(240).fill(i%251));writer.finish();
 const file=path.join(directory,frames+'.ogg'),data=Buffer.concat(chunks.map(c=>Buffer.from(c)));fs.writeFileSync(file,data,{flag:'wx'});
 const expected=createHash('sha256').update(data).digest('hex'),handles=new Map();let maxRead=0;
 const io={OpenMode:{READ_ONLY:0},WhenceType:{SEEK_SET:0},
  openSync:p=>{const fd=fs.openSync(p,'r');handles.set(fd,0);return{fd};},closeSync:f=>{fs.closeSync(f.fd);handles.delete(f.fd);},
  statSync:f=>fs.fstatSync(f),lseek:(f,at)=>{handles.set(f,at);},
  readSync:(f,b)=>{maxRead=Math.max(maxRead,b.byteLength);const at=handles.get(f),n=fs.readSync(f,new Uint8Array(b),0,b.byteLength,at);handles.set(f,at+n);return n;}};
 const {OggFileSource}=loadApp('OggFileSource',{'@kit.CoreFileKit':{fileIo:io}});
 const legacyAt=performance.now(),raw=Uint8Array.from(fs.readFileSync(file)),legacy=inspectLifelogPrefix(raw,true),legacyHash=createHash('sha256').update(raw).digest('hex'),legacyMs=performance.now()-legacyAt;
 const coldAt=performance.now(),cold=new OggFileSource(file,true,undefined,0,'');cold.verifyUnchanged();const coldMs=performance.now()-coldAt,index=cold.index,scanned=cold.scannedPages;cold.close();
 const warmAt=performance.now(),warm=new OggFileSource(file,true,index,index.prefix.committedBytes,index.sha256);warm.verifyUnchanged();const warmMs=performance.now()-warmAt;
 const verified=warm.index.sha256===expected&&legacyHash===expected&&legacy.offsets.length===frames&&warm.index.prefix.offsets.length===frames&&warm.scannedPages===0&&maxRead<=65536;
 rows.push({frames,container_bytes:data.length,synthetic_duration_seconds:frames*.06,legacy_ms:legacyMs,cold_ms:coldMs,warm_ms:warmMs,
  cold_scanned_pages:scanned,warm_scanned_pages:warm.scannedPages,reused_frames:warm.reusedFrames,max_read_buffer_bytes:maxRead,hash_and_frame_count_verified:verified});
 warm.close();if(handles.size||!verified){console.error(JSON.stringify({row:rows.at(-1),open_handles:handles.size,legacy_hash:legacyHash,index_hash:index.sha256,expected}));throw Error('INDEX_BENCHMARK_FAILED');}
}
const result={kind:'desktop_ogg_container_index',node:process.versions.node,platform:process.platform,arch:process.arch,rows,
 scope:'Synthetic packet containers; actual ETS reader/scanner and local file I/O; no recognition, playback or acquisition.',
 limits:['desktop timings do not predict phone timings','not valid speech or a speaker fixture','existing size/frame limits remain','cold native codec prefix replay remains']};
fs.writeFileSync('rebuild/phase1/desktop-ogg-index-comparison.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
