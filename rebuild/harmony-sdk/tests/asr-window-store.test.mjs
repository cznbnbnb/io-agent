import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {loadApp} from './load-app.mjs';
function setup(t){
 const prefix=path.join(os.tmpdir(),'turboio-window-');const root=fs.mkdtempSync(prefix).replaceAll('\\','/');t.after(()=>{if(!path.resolve(root).startsWith(path.resolve(prefix)))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true});});
 let fail=false;const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},accessSync:fs.existsSync,mkdirSync:fs.mkdirSync,listFileSync:fs.readdirSync,statSync:fs.statSync,readTextSync:p=>fs.readFileSync(p,'utf8'),openSync:p=>({fd:fs.openSync(p,'w')}),closeSync:f=>fs.closeSync(f.fd),writeSync:(fd,b)=>fs.writeSync(fd,new Uint8Array(b).slice(0,31)),fsyncSync:fs.fsyncSync,renameSync:(a,b)=>{if(fail)throw Error('synthetic-full');fs.renameSync(a,b);}};
 const {AsrWindowStore}=loadApp('AsrWindowStore',{'@kit.CoreFileKit':{fileIo:io}}),store=new AsrWindowStore();store.initialize(root);
 const id='asr-lifelog-'+'a'.repeat(32);const restart=()=>{const s=new AsrWindowStore();s.initialize(root);return s;};
 const result=(start,end)=>({windowed:true,windowStartFrame:start,windowEndFrame:end,frames:1000,seconds:60,sourcePrefixBytes:240000,sourcePrefixSha256:'c'.repeat(64),utterances:[{start:start*.06+.1,end:end*.06-.1,text:'合成窗口',speaker:-1}],speakers:[]});
 return{root,store,id,restart,result,fail:v=>fail=v};
}
test('cursor advances only with immutable text; restart and duplicate publication preserve a contiguous history',t=>{
 const s=setup(t),a=s.result(0,334);s.store.append(s.id,0,a);const next=s.restart();assert.equal(next.resume(s.id).cursor,334);
 next.append(s.id,0,a);assert.equal(next.resume(s.id).windows.length,1);
 next.append(s.id,334,s.result(334,668));assert.equal(s.restart().resume(s.id).cursor,668);
 assert.throws(()=>next.append(s.id,100,s.result(100,200)),/CONFLICT/);
});
test('a torn window never advances the cursor; a gap or damaged published window fails closed',t=>{
 const s=setup(t);s.fail(true);assert.throws(()=>s.store.append(s.id,0,s.result(0,334)),/synthetic-full/);assert.equal(s.restart().resume(s.id).cursor,0);
 s.fail(false);s.store.append(s.id,0,s.result(0,334));const p=path.join(s.root,'asr-windows',s.id,'window-000000.json');fs.writeFileSync(p,'{');assert.throws(()=>s.restart().resume(s.id));
});
test('out-of-window text, invalid source checksums and traversal cannot be published',t=>{
 const s=setup(t),r=s.result(334,668);r.utterances[0]={start:1,end:2,text:'错误归属',speaker:-1};assert.throws(()=>s.store.append(s.id,334,r),/TEXT_INVALID/);
 const bad=s.result(0,334);bad.sourcePrefixSha256='';assert.throws(()=>s.store.append(s.id,0,bad),/CORRUPT/);
 assert.throws(()=>s.store.resume('../outside'),/JOB_INVALID/);assert.equal(s.store.resume(s.id).cursor,0);
});


test('token-owned checkpoint accepts final boundary punctuation and rejects forged timing or verification',t=>{
 const s=setup(t),r=s.result(0,334);r.boundaryProcessing='token_starts';
 r.utterances=[{start:19,end:20.04,text:'甲',speaker:-1,alignment:'token_starts',tokens:['甲'],tokenStarts:[19]}];
 s.store.append(s.id,0,r);assert.equal(s.restart().resume(s.id).windows[0].boundaryProcessing,'token_starts');
 const bad=s.result(334,668);bad.boundaryProcessing='token_starts';assert.throws(()=>s.store.append(s.id,334,bad),/ALIGNMENT_INVALID/);
 bad.utterances=[{start:20.04,end:30,text:'乙',speaker:-1,alignment:'token_starts',tokens:['乙'],tokenStarts:[1]}];
 assert.throws(()=>s.store.append(s.id,334,bad),/TEXT_INVALID/);
 const last=s.result(334,1000);last.boundaryProcessing='token_starts';
 last.utterances=[{start:60,end:60,text:'。',speaker:-1,alignment:'token_starts',tokens:['。'],tokenStarts:[60]}];
 s.store.append(s.id,334,last);assert.equal(s.restart().resume(s.id).cursor,1000);
});
