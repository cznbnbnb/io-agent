import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {loadApp} from './load-app.mjs';
export function setupMaterialStore(t){
 const prefix=path.join(os.tmpdir(),'turboio-material-');const root=fs.mkdtempSync(prefix).replaceAll('\\','/');
 t.after(()=>{if(!path.resolve(root).startsWith(path.resolve(prefix)))throw Error('Unsafe test cleanup');fs.rmSync(root,{recursive:true});});
 let failPromotion=false;
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},accessSync:fs.existsSync,mkdirSync:p=>fs.mkdirSync(p),
  listFileSync:fs.readdirSync,statSync:p=>fs.statSync(p),readTextSync:p=>fs.readFileSync(p,'utf8'),
  openSync:p=>({fd:fs.openSync(p,'w')}),closeSync:f=>fs.closeSync(typeof f==='number'?f:f.fd),
  writeSync:(fd,b)=>fs.writeSync(fd,new Uint8Array(b).slice(0,37)),fsyncSync:fs.fsyncSync,
  renameSync:(a,b)=>{if(failPromotion)throw Error('synthetic-disk-failure');fs.renameSync(a,b);}};
 const mod=loadApp('MaterialStore',{'@kit.CoreFileKit':{fileIo:io}});
 const store=new mod.MaterialStore();store.initialize(root);
 const source=new mod.MaterialSource();Object.assign(source,{kind:'recording',name:'take-'+'a'.repeat(32),started:1000,ended:61000,complete:true,audioAvailable:true,audioBytes:720000,decodedChannels:2,audioFrames:3000,frameMs:20});
 const input=new mod.MaterialTextInput();input.text='测试语句';input.channel='mix';
 const part=new mod.MaterialUtterance();Object.assign(part,{start_ms:2000,end_ms:3000,text:'测试语句',speaker_id:'speaker-0',speaker_basis:'segment_cluster'});input.utterances=[part];
 return{...mod,root,store,source,input,io,failPromotion:v=>{failPromotion=v;}};
}
