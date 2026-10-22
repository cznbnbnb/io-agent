import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
function setup(){
 const files=new Map(),dirs=new Set(),handles=new Map(),clients=[],calls=[];let fd=0;
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},accessSync:p=>dirs.has(p)||files.has(p),
  openSync:p=>{files.set(p,new Uint8Array());handles.set(++fd,p);return{fd};},closeSync(){},
  writeSync:(fd,buffer)=>{const p=handles.get(fd),old=files.get(p),b=new Uint8Array(buffer),out=new Uint8Array(old.length+b.length);out.set(old);out.set(b,old.length);files.set(p,out);return b.length;},
  fsyncSync(){},renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);}};
 class Engine{constructor(){this.closed=0;clients.push(this);}codecProbe(path){calls.push(['probe',path]);return new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});}close(){this.closed++;this.reject?.(Error('closed'));}}
 const {CodecWindowProbe}=loadApp('CodecWindowProbe',{'@kit.AbilityKit':{},'@kit.CoreFileKit':{fileIo:io},'./AsrEngine':{AsrEngineClient:Engine},
  './DailyLabSourceClone':{cloneDailyLabSource:(base,from,to,name)=>{calls.push(['clone',base,from,to,name]);dirs.add(to);return 'a'.repeat(64);}}});
 return{probe:new CodecWindowProbe(),clients,calls,files,run(probe){return probe.run({filesDir:'/app'},'/app/p22-daily-lab','/app/p22-daily-lab/run-1790000000000','seg-'+'a'.repeat(32));},
  report(){return JSON.parse(new TextDecoder().decode([...files.entries()].find(([p])=>p.endsWith('/codec-window-probe.json'))[1]));}};
}
test('finite codec diagnostic owns copied source and its Worker, writes no daily trial or transcript',async()=>{
 const s=setup(),work=s.run(s.probe);assert.equal(s.clients.length,1);assert.equal(s.calls[0][0],'clone');assert.equal(s.calls[1][0],'probe');
 s.clients[0].resolve({equivalent:true,windows:[]});assert.equal(await work,'verified');assert.equal(s.clients[0].closed,1);
 assert.equal(s.report().phase,'verified');assert.equal(s.report().sourceSha256,'a'.repeat(64));assert(![...s.files.keys()].some(p=>p.endsWith('/trial.json')));
});
test('cancel rejects the pending diagnostic and closes only its own Worker',async()=>{
 const s=setup(),work=s.run(s.probe);await assert.rejects(s.run(s.probe),/BUSY/);s.probe.cancel();assert.equal(await work,'cancelled');assert(s.clients[0].closed>=1);assert.equal(s.report().phase,'cancelled');
});
test('unequal PCM and Worker error cannot report verified',async()=>{
 const s=setup(),work=s.run(s.probe);s.clients[0].resolve({equivalent:false,windows:[]});assert.equal(await work,'not_verified');
 const t=setup(),failure=t.run(t.probe);t.clients[0].reject(Error('private path or words'));assert.equal(await failure,'failed');assert.equal(t.report().error,'details_kept_private');
});
