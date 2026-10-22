import fs from 'node:fs';import path from 'node:path';
import {loadApp} from './load-app.mjs';import {setupMaterialStore} from './material-fixture.mjs';
// Shared fixture only: importing it does not register tests or start a service.
export function setupRecordingCloud(t){
 const f=setupMaterialStore(t),io=f.io;
 io.OpenMode.READ_ONLY=8;
 const positions=new Map();io.WhenceType={SEEK_SET:0};
 io.openSync=(p,flags)=>{const fd=fs.openSync(p,flags&8?'r':'w');positions.set(fd,0);return {fd};};
 io.closeSync=f=>{const fd=typeof f==='number'?f:f.fd;positions.delete(fd);fs.closeSync(fd);};
 io.lseek=(fd,position)=>{positions.set(fd,position);return position;};
 io.statSync=p=>{const s=typeof p==='number'?fs.fstatSync(p):fs.statSync(p);return {size:s.size,mtime:s.mtimeMs};};
 io.readSync=(fd,buffer)=>{const n=fs.readSync(fd,new Uint8Array(buffer),0,buffer.byteLength,positions.get(fd));positions.set(fd,positions.get(fd)+n);return n;};
 io.unlinkSync=fs.unlinkSync;io.rmdirSync=fs.rmdirSync;
 const platform={'@kit.CoreFileKit':{fileIo:io}},mod=loadApp('RecordingCloudPublication',platform,{setTimeout,clearTimeout});
 const publisher=new mod.RecordingCloudPublication();publisher.initialize(f.root,f.store);
 const directory=path.join(f.root,'recordings',f.source.name);fs.mkdirSync(directory,{recursive:true});
 const rawPath=path.join(directory,'source.rawopus'),wavPath=path.join(directory,'audio.wav');
 fs.writeFileSync(rawPath,Buffer.alloc(f.source.audioBytes,7));
 const pcm=f.source.audioFrames*1280,header=loadApp('RecordingCoverage').stereoWavHeader(pcm);
 const wav=Buffer.alloc(44+pcm,3);Buffer.from(header).copy(wav);fs.writeFileSync(wavPath,wav);
 let current=true,mirrorCalls=0;
 const readSource=()=>mod.readRecordingCloudSnapshot(f.source,rawPath,wavPath,()=>current);
 const mirror=(source,fileName,text)=>{mirrorCalls++;const target=path.join(directory,fileName),body=`# 眼镜录音转写\n\n录音时间：${new Date(source.started).toISOString()}\n\n${text}\n`;
  if(fs.existsSync(target)){if(fs.readFileSync(target,'utf8')!==body)throw Error('RECORDING_CLOUD_MIRROR_CONFLICT');return;}
  fs.writeFileSync(target+'.partial',body);fs.renameSync(target+'.partial',target);};
 return {...f,platform,io,...mod,publisher,directory,rawPath,wavPath,readSource,mirror,mirrorCalls:()=>mirrorCalls,
  current:()=>current,setCurrent:v=>current=v,restart(){const store=new f.MaterialStore();store.initialize(f.root);const p=new mod.RecordingCloudPublication();p.initialize(f.root,store);return {store,publisher:p};}};
}
export function setupLifelogManual(t,{legacy=false}={}){
 const f=setupRecordingCloud(t),source=new f.MaterialSource();Object.assign(source,{kind:'lifelog',name:'seg-'+'b'.repeat(32),started:1000,ended:2200,complete:true,audioAvailable:true,decodedChannels:0,audioFrames:legacy?-1:20,frameMs:60});
 const directory=path.join(f.root,'lifelog',source.name);fs.mkdirSync(directory,{recursive:true});const oggPath=path.join(directory,'audio.ogg');
 const chunks=[],{OggOpusWriter}=loadApp('OggOpus'),writer=new OggOpusWriter(bytes=>chunks.push(bytes),7,50);writer.begin();
 for(let i=0;i<20;i++){const frame=new Uint8Array(240).fill(3);frame[0]=0x5b;frame[1]=1;writer.push(frame);}writer.finish();fs.writeFileSync(oggPath,Buffer.concat(chunks.map(v=>Buffer.from(v))));source.audioBytes=fs.statSync(oggPath).size;
 const {lifelogMarkdown}=loadApp('LifelogASR',{'@kit.AbilityKit':{},'libturbo_audio.so':{},'sherpa_onnx':{},'./VoiceRegistry':{VoiceRegistry:class{}}});
 const makeResult=transcript=>JSON.stringify({transcript,markdown:lifelogMarkdown('智记合成测试',transcript)});
 const readSource=()=>f.readLifelogManualSnapshot(source,oggPath,f.current);
 const mirror=(_source,_name,markdown,result)=>{fs.writeFileSync(path.join(directory,'transcript.json'),result);fs.writeFileSync(path.join(directory,'text.md'),markdown);};
 return {...f,source,directory,oggPath,rawPath:oggPath,wavPath:oggPath,readSource,mirror,makeResult,makeInput:f.lifelogManualTextInput};
}
