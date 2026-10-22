import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {summaryFixture,summaryId,summarySettled,turn} from './recording-summary-fixture.mjs';

// Independent recovery review: actual service, hash-linked checkpoints and D IO.
// Only model responses and the named fsync failure are synthetic; no network/device.
function readyFlushFault(f){
 const original=f.io.fsyncSync,attempts=[];let reject=true;
 f.io.fsyncSync=fd=>{const info=f.handles.get(fd),raw=fs.readFileSync(info.file,'utf8');let record;try{record=JSON.parse(raw);}catch{}
  if(record?.phase==='ready'){attempts.push({file:info.file,mode:info.mode});if(reject)throw Error('synthetic-ready-fsync-failure');}
  return original(fd);
 };
 return{attempts,allow:()=>reject=false};
}
function pendingReady(f,id){const names=fs.readdirSync(f.directory(id)).filter(name=>/^state-\d{4}\.json\.partial$/.test(name));assert.equal(names.length,1);
 const file=f.directory(id)+'/'+names[0],bytes=fs.readFileSync(file);assert.equal(JSON.parse(bytes.toString('utf8')).phase,'ready');return{file,final:file.slice(0,-8),bytes};}

test('cold recovery re-fsyncs a complete pending ready record; failed reflush preserves exact bytes and cannot claim ready',async t=>{
 const f=summaryFixture(t),id=summaryId(201),fault=readyFlushFault(f);await f.service.start(id,f.reference);
 const stopped=await summarySettled(f.service,id);assert.equal(stopped.phase,'resumable');assert.equal(stopped.can_resume,true);assert.equal(f.requests.length,1);
 const pending=pendingReady(f,id);assert.equal(fs.existsSync(pending.final),false);assert.equal(fault.attempts.length,1);
 const cold=f.cold(),view=cold.status(id);await assert.rejects(()=>cold.resume(id,view.state_sha256),/RECORDING_SUMMARY_WRITE_FAILED/);
 assert.equal(fault.attempts.length,2,'cold promotion must retry fsync rather than treating a read/close as durable');assert.equal(fault.attempts[1].mode,f.io.OpenMode.WRITE_ONLY);
 assert.equal(fs.existsSync(pending.final),false);assert.deepEqual(fs.readFileSync(pending.file),pending.bytes);assert.equal(cold.status(id).phase,'resumable');assert.equal(f.requests.length,1);
 fault.allow();const recovered=await cold.resume(id,cold.status(id).state_sha256);assert.equal(recovered.phase,'ready');assert.equal(fault.attempts.length,3);assert.equal(f.requests.length,1);
 assert.equal(fs.existsSync(pending.file),false);assert.deepEqual(fs.readFileSync(pending.final),pending.bytes);
 const document=JSON.parse(cold.chunk(id,recovered.state_sha256,'json',0,4000).text);assert.equal(document.entries[0].category,'fact');
});

test('the thirtieth charged call can finish a pending ready record locally without spending another model call',async t=>{
 const f=summaryFixture(t,{text:'甲'.repeat(60000)}),id=summaryId(202);
 const first=new f.MaterialUtterance(),second=new f.MaterialUtterance();Object.assign(first,{start_ms:1000,end_ms:2000,text:'甲'.repeat(60000)});Object.assign(second,{start_ms:3000,end_ms:4000,text:'乙'.repeat(60000)});
 const input=new f.MaterialTextInput();Object.assign(input,{text:first.text+'\n'+second.text,utterances:[first,second],channel:'mix',transcriptionState:'complete',coveredMs:60000,sourceMs:60000});
 const head=f.store.appendTranscript(f.head.material_id,f.head.revision,input,'review-eight-leaf-source'),reference=f.plan.recordingSummaryReference(head),plan=f.plan.buildRecordingSummaryPlan(head);
 assert.equal(plan.leaves.length,8);const attempts=new Map();f.responder(input=>{const key=input.required_ids.join(','),used=(attempts.get(key)||0)+1;attempts.set(key,used);
  if(used===1)throw Error('synthetic explicit retry required');return JSON.stringify({entries:[],covered_ids:input.required_ids});});
 const fault=readyFlushFault(f);await f.service.start(id,reference);let view=await summarySettled(f.service,id);assert.equal(view.phase,'error');
 for(let step=0;step<15;step++){await f.service.resume(id,view.state_sha256);view=await summarySettled(f.service,id);}
 assert.equal(f.requests.length,30);assert.equal(view.calls_used,30);assert.equal(view.completed_steps,14);assert.equal(view.phase,'resumable');assert.equal(view.can_resume,true,'pending ready requires no new call and remains explicitly recoverable at the call cap');
 const pending=pendingReady(f,id);assert.equal(JSON.parse(pending.bytes).outputs.length,15);const cold=f.cold();assert.equal(cold.status(id).can_resume,true);
 await assert.rejects(()=>cold.resume(id,cold.status(id).state_sha256),/WRITE_FAILED/);assert.equal(f.requests.length,30);assert.deepEqual(fs.readFileSync(pending.file),pending.bytes);
 fault.allow();const done=await cold.resume(id,cold.status(id).state_sha256);assert.equal(done.phase,'ready');assert.equal(done.calls_used,30);assert.equal(done.completed_steps,15);assert.equal(done.can_resume,false);assert.equal(f.requests.length,30);
 const again=await f.cold().resume(id,done.state_sha256);assert.equal(again.phase,'ready');assert.equal(f.requests.length,30,'reopening a completed result has no model effect');
});

test('standard canonical 161-256 character utterance IDs work from preview through durable ready and export',async t=>{
 for(const length of[161,256]){
  const f=summaryFixture(t),id=summaryId(300+length),row=JSON.parse(JSON.stringify(f.head));row.utterances[0].utterance_id='u'.repeat(length);
  // Explicit synthetic historical canonical row. The actual Store validates it;
  // the public summary must not impose a narrower ID length than its references.
  const canonical=f.root+'/materials/'+row.material_id+'/revision-'+row.revision.toString().padStart(9,'0')+'.json';fs.writeFileSync(canonical,JSON.stringify(row));
  const checked=f.store.read(row.material_id);assert.equal(checked.utterances[0].utterance_id.length,length);const reference=f.plan.recordingSummaryReference(checked);
  assert.equal(f.service.preview(reference).pieces,1);await f.service.start(id,reference);const done=await summarySettled(f.service,id);assert.equal(done.phase,'ready');
  const citation=f.service.citation(id,done.entries[0].evidence_ids[0],done.state_sha256);assert.equal(citation.reference.utterance_id.length,length);
  assert.match(fs.readFileSync(f.service.exportPath(id,done.state_sha256,'json'),'utf8'),new RegExp('u{'+length+'}'));
 }
});

test('cancel from a synchronous resume notification is not overwritten by launch and issues no new request',async t=>{
 const f=summaryFixture(t),id=summaryId(203);f.responder(()=>{throw Error('synthetic initial model failure');});await f.service.start(id,f.reference);const failed=await summarySettled(f.service,id);assert.equal(failed.phase,'error');
 let armed=true,cancelled=false;const unsubscribe=f.service.subscribe(()=>{if(!armed)return;const view=f.service.status(id);if(view.phase==='paused'){armed=false;cancelled=true;f.service.cancel(id,view.state_sha256);}});
 await assert.rejects(()=>f.service.resume(id,failed.state_sha256),/RECORDING_SUMMARY_(STALE|NOT_FOREGROUND)/);unsubscribe();await turn();
 assert.equal(cancelled,true);assert.equal(f.requests.length,1);assert.equal(f.service.status(id).phase,'paused');
});
