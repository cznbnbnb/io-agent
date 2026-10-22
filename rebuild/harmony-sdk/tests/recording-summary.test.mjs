import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {summaryFixture,summaryId,summarySettled,turn,plain} from './recording-summary-fixture.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');

test('real sealed recording summary saves independently, cold opens, cites original and exports complete MD/JSON',async t=>{
 const f=summaryFixture(t),id=summaryId(1),before=fs.readFileSync(f.root+'/materials/'+f.head.material_id+'/revision-000000002.json');
 const preview=f.service.preview(f.reference);assert.equal(preview.pieces,1);assert.equal(preview.max_calls,30);
 const queued=await f.service.start(id,f.reference);assert.equal(queued.phase,'queued');const ready=await summarySettled(f.service,id);assert.equal(ready.phase,'ready');assert.equal(ready.calls_used,1);
 assert.equal(f.requests.length,1);assert.equal(ready.entries.length,1);const cold=f.cold(),opened=cold.status(id);assert.equal(opened.state_sha256,ready.state_sha256);assert.equal(opened.phase,'ready');
 assert.equal(f.requests.length,1,'cold status/list do not call model');const piece=cold.citation(id,'piece-0001',ready.state_sha256);assert.equal(piece.text,f.head.utterances[0].text);assert.equal(piece.start_ms,2000);
 const list=cold.list(f.head.material_id,10,'');assert.equal(list.items.length,1);assert.equal(list.items[0].entries.length,0);
 const md=cold.exportPath(id,ready.state_sha256,'md'),json=cold.exportPath(id,ready.state_sha256,'json');assert.match(fs.readFileSync(md,'utf8'),/不要发送报价/);
 const doc=JSON.parse(fs.readFileSync(json,'utf8'));assert.equal(doc.citations[0].text,piece.text);assert.equal(doc.entries[0].text,ready.entries[0].text);assert.equal(doc.source.content_sha256,f.reference.content_sha256);
 assert.equal(f.requests.length,1);assert.equal(cold.isCurrent(id,ready.state_sha256),true);assert.deepEqual(fs.readFileSync(f.root+'/materials/'+f.head.material_id+'/revision-000000002.json'),before);
 assert.equal(fs.readdirSync(f.root).some(name=>name.startsWith('day-')),false,'does not replace daily summary');
});

test('start retry with same ID never reissues a model request; different source binding is rejected',async t=>{
 const f=summaryFixture(t,{defer:true}),id=summaryId(2);await f.service.start(id,f.reference);await turn();assert.equal(f.requests.length,1);
 await f.service.start(id,f.reference);assert.equal(f.requests.length,1);await assert.rejects(f.service.start(id,{...f.reference,content_sha256:'f'.repeat(64)}),/STALE/);
 f.release();assert.equal((await summarySettled(f.service,id)).phase,'ready');await f.service.start(id,f.reference);assert.equal(f.requests.length,1);
});

test('suspend preserves charged uncertain attempt, ignores late response, and requires explicit cold resume',async t=>{
 const f=summaryFixture(t,{defer:true}),id=summaryId(3);await f.service.start(id,f.reference);await turn();f.service.suspend();
 const paused=f.cold().status(id);assert.equal(paused.phase,'paused');assert.equal(paused.calls_used,1);assert.equal(paused.completed_steps,0);assert.equal(paused.can_resume,true);assert.match(paused.note,/不确定/);
 f.release();await turn();assert.equal(f.cold().status(id).phase,'paused');assert.equal(f.requests.length,1);
 const cold=f.cold();await cold.resume(id,paused.state_sha256);await turn();assert.equal(f.requests.length,2);f.release(1);const ready=await summarySettled(cold,id);assert.equal(ready.phase,'ready');assert.equal(ready.calls_used,2);
});

test('lost process running checkpoint is read-only resumable; repeated status cannot cause retries',async t=>{
 const f=summaryFixture(t,{defer:true}),id=summaryId(4);await f.service.start(id,f.reference);await turn();const cold=f.cold(),before=f.requests.length;
 for(let n=0;n<4;n++){assert.equal(cold.status(id).phase,'resumable');cold.list(f.head.material_id);}
 assert.equal(f.requests.length,before);f.service.suspend();f.release();await turn();
});

test('source edit while awaiting model hides outputs and blocks stale citation/export/resume without rewriting source',async t=>{
 const f=summaryFixture(t,{defer:true}),id=summaryId(5);await f.service.start(id,f.reference);await turn();const edited=f.edit();f.release();await summarySettled(f.service,id);
 const stale=f.service.status(id);assert.equal(stale.phase,'stale');assert.equal(stale.entries.length,0);assert.equal(stale.generated_at,'');assert.equal(stale.can_resume,false);
 assert.throws(()=>f.service.exportPath(id,stale.state_sha256,'md'),/STALE/);assert.throws(()=>f.service.citation(id,'piece-0001'),/STALE/);await assert.rejects(f.service.resume(id,stale.state_sha256),/STALE/);
 assert.equal(f.store.read(f.head.material_id).text,edited.text);assert.equal(f.requests.length,1);
});

test('ready becomes stale on deletion/unreadable source; source restored recovers only exact saved fingerprint',async t=>{
 const f=summaryFixture(t),id=summaryId(6);await f.service.start(id,f.reference);const ready=await summarySettled(f.service,id);f.missing(true);
 assert.equal(f.service.status(id).phase,'stale');assert.equal(f.service.isCurrent(id,ready.state_sha256),false);f.missing(false);assert.equal(f.service.status(id).phase,'ready');assert.equal(f.requests.length,1);
});

test('invalid structured response is not cached; explicit retry is bounded to two attempts per step',async t=>{
 const f=summaryFixture(t),id=summaryId(7);f.responder(()=>'{"entries":[],"covered_ids":[]}');await f.service.start(id,f.reference);
 let error=await summarySettled(f.service,id);assert.equal(error.phase,'error');assert.equal(error.completed_steps,0);assert.equal(error.calls_used,1);assert.equal(error.entries.length,0);
 await f.service.resume(id,error.state_sha256);error=await summarySettled(f.service,id);assert.equal(error.calls_used,2);assert.equal(error.can_resume,false);await assert.rejects(f.service.resume(id,error.state_sha256),/LIMIT/);assert.equal(f.requests.length,2);
});

test('long recording executes every leaf and merge, preserves coverage and cold progress after interruption',async t=>{
 const f=summaryFixture(t,{text:'尚未决定发货，请确认运费。'.repeat(4000),defer:true}),id=summaryId(8),plan=f.plan.buildRecordingSummaryPlan(f.head);assert(plan.leaves.length>1);
 await f.service.start(id,f.reference);await turn();f.release();await turn();await turn();assert.equal(f.requests.length,2);f.service.suspend();const saved=f.service.status(id);assert.equal(saved.completed_steps,1);
 f.release(1);await turn();const cold=f.cold();await cold.resume(id,saved.state_sha256);await turn();
 for(let index=2;index<2*plan.leaves.length+2;index++){if(cold.status(id).phase==='ready')break;assert(f.pending[index]);f.release(index);await turn();await turn();}
 const ready=await summarySettled(cold,id);assert.equal(ready.phase,'ready');assert.equal(ready.completed_steps,2*plan.leaves.length-1);assert.equal(ready.calls_used,ready.completed_steps+1);
 for(const request of f.requests)assert(JSON.stringify(request.input).length<=20000);const dir=f.directory(id),names=fs.readdirSync(dir).filter(n=>n.endsWith('.json')).sort();let previous='';
 for(const name of names){const bytes=fs.readFileSync(dir+'/'+name),record=JSON.parse(bytes);assert.equal(record.previous_sha256,previous);previous=hash(bytes);assert.equal(JSON.stringify(record).includes(f.config.modelKey),false);assert.equal(JSON.stringify(record).includes(f.config.modelURL),false);}
 const last=JSON.parse(fs.readFileSync(dir+'/'+names.at(-1)));assert.deepEqual(new Set(last.outputs.at(-1).covered_ids),new Set(plan.pieces.map(p=>p.id)));
});

test('changed model or endpoint cannot silently resume an existing job',async t=>{
 const f=summaryFixture(t,{defer:true}),id=summaryId(9);await f.service.start(id,f.reference);await turn();f.service.suspend();const saved=f.service.status(id);f.config.model='different';
 await assert.rejects(f.cold().resume(id,saved.state_sha256),/CONFIG_CHANGED/);f.config.model='synthetic-model';f.config.modelURL='https://different.invalid';await assert.rejects(f.cold().resume(id,saved.state_sha256),/CONFIG_CHANGED/);assert.equal(f.requests.length,1);f.release();await turn();
});

test('cancel uses state CAS and reentrant lifecycle cancellation cannot restart a resumed job',async t=>{
 const f=summaryFixture(t,{defer:true}),id=summaryId(10);await f.service.start(id,f.reference);await turn();const running=f.service.status(id);f.service.cancel(id,running.state_sha256);
 assert.throws(()=>f.service.cancel(id,running.state_sha256),/STALE/);f.release();await turn();const saved=f.service.status(id);let once=false;
 const unsubscribe=f.service.subscribe(()=>{if(!once){once=true;f.service.suspend();}});await assert.rejects(f.service.resume(id,saved.state_sha256),/NOT_FOREGROUND/);unsubscribe();await turn();assert.equal(f.requests.length,1);
});

test('unknown files and tampered exports block rather than auto healing',async t=>{
 const f=summaryFixture(t),id=summaryId(11);await f.service.start(id,f.reference);const ready=await summarySettled(f.service,id),md=f.service.exportPath(id,ready.state_sha256,'md');
 fs.appendFileSync(md,'tampered');assert.equal(f.service.isCurrent(id,ready.state_sha256),false);assert.throws(()=>f.service.chunk(id,ready.state_sha256,'md',0,4000),/BLOCKED/);
 fs.writeFileSync(f.directory(id)+'/unexpected','unknown');assert.equal(f.cold().status(id).phase,'blocked');assert.equal(f.requests.length,1);
});

test('mutated committed hash chain is blocked and cannot expose or regenerate a result',async t=>{
 const f=summaryFixture(t),id=summaryId(13);await f.service.start(id,f.reference);await summarySettled(f.service,id);
 const file=f.directory(id)+'/state-0000.json',record=JSON.parse(fs.readFileSync(file,'utf8'));record.updated_at='2026-10-16T02:02:03.000Z';fs.writeFileSync(file,JSON.stringify(record));
 const view=f.cold().status(id);assert.equal(view.phase,'blocked');assert.equal(view.entries.length,0);assert.equal(view.state_sha256,'');assert.throws(()=>f.cold().citation(id,'piece-0001'),/BLOCKED/);assert.equal(f.requests.length,1);
});

test('interrupted malformed first checkpoint remains blocked with its original partial bytes and no model call',async t=>{
 const f=summaryFixture(t),id=summaryId(14);f.fault('write');await assert.rejects(f.service.start(id,f.reference),/WRITE_FAILED/);
 const pending=f.directory(id)+'/state-0000.json.partial',before=fs.readFileSync(pending);assert.equal(before.length,0);f.fault('');
 assert.equal(f.cold().status(id).phase,'blocked');await assert.rejects(f.cold().start(id,f.reference),/BLOCKED/);assert.deepEqual(fs.readFileSync(pending),before);assert.equal(f.requests.length,0);
});

test('full UTF16 export chunks preserve emoji and reject split surrogate offsets and stale hashes',async t=>{
 const f=summaryFixture(t,{text:'原文🙂保留'}),id=summaryId(12);await f.service.start(id,f.reference);const ready=await summarySettled(f.service,id);let offset=0,result='';
 for(;;){const chunk=f.service.chunk(id,ready.state_sha256,'json',offset,13);result+=chunk.text;offset=chunk.next_offset;if(!chunk.has_more)break;}
 const exported=f.service.exportPath(id,ready.state_sha256,'json');assert.equal(result,fs.readFileSync(exported,'utf8'));const emoji=result.indexOf('🙂');assert(emoji>=0);assert.throws(()=>f.service.chunk(id,ready.state_sha256,'json',emoji+1,13),/INVALID/);assert.throws(()=>f.service.chunk(id,'f'.repeat(64),'json',0,13),/STALE/);
});

test('metadata list pagination has stable snapshot and rejects stale cursor as membership changes',async t=>{
 const f=summaryFixture(t);for(let n=20;n<23;n++){await f.service.start(summaryId(n),f.reference);await summarySettled(f.service,summaryId(n));}
 const first=f.service.list(f.head.material_id,1),second=f.service.list(f.head.material_id,1,first.next_cursor);assert.equal(first.has_more,true);assert.notEqual(first.items[0].job_id,second.items[0].job_id);assert.equal(second.items[0].entries.length,0);
 await f.service.start(summaryId(24),f.reference);await summarySettled(f.service,summaryId(24));assert.throws(()=>f.service.list(f.head.material_id,1,first.next_cursor),/STALE/);assert.equal(f.requests.length,4);
});

test('rename-after-commit reconciliation reads exact durable bytes without issuing a duplicate request',async t=>{
 const f=summaryFixture(t),id=summaryId(30);f.fault('rename-after');await f.service.start(id,f.reference);const ready=await summarySettled(f.service,id);assert.equal(ready.phase,'ready');assert.equal(f.requests.length,1);
});

test('standard split references compare by range values across JSON key order and remain guarded by changed values',async t=>{
 const f=summaryFixture(t),id=summaryId(31),op=new f.MaterialSpeakerCorrection();
 Object.assign(op,{operation_id:'synthetic-summary-split-key-order',kind:'split',utterance_ids:[f.head.utterances[0].utterance_id],split_offset:3});
 // The real correction writer preserves parent revision/time provenance.
 const row=f.store.correctSpeakers(f.head.material_id,f.head.revision,op),part=row.utterances[0];
 const stored=f.store.read(row.material_id),canonical=f.plan.recordingSummaryReference(stored),reordered=plain(canonical);
 reordered.source_range=Object.fromEntries(Object.entries(reordered.source_range).reverse());assert.equal(f.sameRecordingSummaryReference(canonical,reordered),true);
 assert.equal(f.service.preview(reordered).pieces,2);await f.service.start(id,reordered);const ready=await summarySettled(f.service,id);assert.equal(ready.phase,'ready');
 const quote=f.service.citation(id,'piece-0001',ready.state_sha256);assert.equal(quote.text,part.text);assert.equal(quote.start_ms,null);
 assert.equal(f.sameRecordingSummaryReference(canonical,{...reordered,source_range:{...reordered.source_range,text_end:part.text.length+1}}),false);
 await assert.rejects(f.service.start(id,{...reordered,source_range:{...reordered.source_range,parent_revision:reordered.source_range.parent_revision+1}}),/STALE/);assert.equal(f.requests.length,1);
});
