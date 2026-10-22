import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadApp} from './load-app.mjs';
function setup(t){
 const prefix=path.join(os.tmpdir(),'turboio-asr-queue-');const root=fs.mkdtempSync(prefix).replaceAll('\\','/');
 t.after(()=>{if(!path.resolve(root).startsWith(path.resolve(prefix)))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true});});
 let fail=false;
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},accessSync:fs.existsSync,mkdirSync:fs.mkdirSync,statSync:fs.statSync,readTextSync:p=>fs.readFileSync(p,'utf8'),
  openSync:p=>({fd:fs.openSync(p,'w')}),closeSync:f=>fs.closeSync(f.fd),writeSync:(fd,b)=>fs.writeSync(fd,new Uint8Array(b).slice(0,31)),fsyncSync:fs.fsyncSync,
  renameSync:(a,b)=>{if(fail)throw Error('synthetic-disk-full');fs.renameSync(a,b);}};
 const {LocalAsrQueue}=loadApp('LocalAsrQueue',{'@kit.CoreFileKit':{fileIo:io}});
 const queue=new LocalAsrQueue();queue.initialize(root);const directory=root+'/recordings/take-'+'a'.repeat(32);
 const enqueue=(q=queue,retry=false)=>q.enqueue(directory,directory+'/source.rawopus',1000,'recording',true,retry);
 const restart=()=>{const q=new LocalAsrQueue();q.initialize(root);return q;};
 return{root,queue,directory,enqueue,restart,fail:v=>fail=v};
}

test('restart resumes an interrupted job with the same ID and persisted attempt counter',t=>{
 const s=setup(t),job=s.enqueue();s.enqueue();assert.equal(s.queue.all().length,1);
 s.queue.transition(job.jobId,'running');const restarted=s.restart(),row=restarted.get(job.jobId);
 assert.equal(row.status,'queued');assert.equal(row.attempts,1);assert.equal(row.lastError,'interrupted');
 assert.equal(s.enqueue(restarted).jobId,job.jobId);
 restarted.transition(job.jobId,'running');assert.equal(s.restart().get(job.jobId).attempts,2);
});
test('a sealed inference result survives crash before the ledger update and can be published without inference',t=>{
 const s=setup(t),job=s.enqueue();s.queue.transition(job.jobId,'running');
 // Result file is promoted but the following ledger promotion is interrupted.
 const result=JSON.stringify({utterances:[{text:'合成测试'}],seconds:1});
 let writes=0;const resultPath=path.join(s.root,'asr-queue',job.jobId+'.result.json');fs.writeFileSync(resultPath,result);
 const restarted=s.restart();assert.equal(restarted.get(job.jobId).status,'result_ready');
 assert.equal(restarted.readResult(job.jobId),result);restarted.transition(job.jobId,'succeeded');
 assert.equal(s.enqueue(s.restart()).status,'succeeded');assert.equal(writes,0);
});
test('publication failure leaves both the durable and in-memory state unchanged',t=>{
 const s=setup(t),job=s.enqueue();s.fail(true);
 assert.throws(()=>s.queue.transition(job.jobId,'running'),/disk-full/);
 assert.equal(s.queue.get(job.jobId).status,'queued');s.fail(false);
 assert.equal(s.restart().get(job.jobId).attempts,0);
 s.queue.transition(job.jobId,'running');s.queue.sealResult(job.jobId,'{"utterances":[]}');
 assert.equal(s.restart().get(job.jobId).status,'result_ready');
});
test('cancel and failure remain terminal during automatic discovery; only explicit retry reactivates',t=>{
 const s=setup(t),job=s.enqueue();s.queue.cancel(job.jobId);
 const restarted=s.restart();assert.equal(s.enqueue(restarted).status,'cancelled');
 assert.equal(s.enqueue(restarted,true).status,'queued');
 restarted.transition(job.jobId,'failed','storage_unavailable');assert.equal(s.enqueue(restarted).status,'failed');
 assert.equal(s.enqueue(restarted,true).status,'queued');
});
test('source mismatch, traversal and corrupt ledger fail closed without replacing the saved ledger',t=>{
 const s=setup(t),job=s.enqueue();
 assert.throws(()=>s.queue.enqueue(s.directory,'../elsewhere',1000,'recording',true),/SOURCE_CHANGED/);
 assert.throws(()=>s.queue.enqueue(s.root+'/recordings/take-../x','x',1,'recording',true),/CORRUPT/);
 assert.equal(s.queue.all().length,1);
 const ledger=path.join(s.root,'asr-queue','state.json');fs.writeFileSync(ledger,'{');
 assert.throws(()=>s.restart());assert.equal(fs.readFileSync(ledger,'utf8'),'{');
});

test('repeated process kills cannot bypass the retry cap; explicit retry and sealed result recovery remain available',t=>{
 const s=setup(t),job=s.enqueue();let q=s.queue;
 for(let i=0;i<3;i++){q.transition(job.jobId,'running');q=s.restart();}
 assert.equal(q.get(job.jobId).status,'failed');assert.equal(q.get(job.jobId).lastError,'interrupted_retry_exhausted');
 assert.equal(s.enqueue(q).status,'failed');assert.equal(s.enqueue(q,true).attempts,0);
 for(let i=0;i<3;i++){q.transition(job.jobId,'running');if(i<2)q=s.restart();}
 fs.writeFileSync(path.join(s.root,'asr-queue',job.jobId+'.result.json'),'{"utterances":[]}');
 assert.equal(s.restart().get(job.jobId).status,'result_ready','sealed text is recovered even after the final attempt');
});
