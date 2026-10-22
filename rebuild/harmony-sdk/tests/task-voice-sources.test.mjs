import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {loadCore} from './load-core.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
function realDirectory(directory){
 const resolved=path.resolve(directory);assert.match(resolved,/^[Dd]:[\\/]/,'source tests must use real D: directories');
 for(let current=resolved;;){const stat=fs.lstatSync(current);assert(stat.isDirectory()&&!stat.isSymbolicLink(),'source test directory chain must not redirect');const parent=path.dirname(current);if(parent===current)break;current=parent;}
 assert.equal(fs.realpathSync(resolved).toLowerCase(),resolved.toLowerCase(),'source test directory must not redirect');return resolved;
}
function selectScratch(){
 const fallback=path.resolve(fileURLToPath(new URL('../../phase1/',import.meta.url))),workspace='D:\\TurboIO-builds\\01a125f7',managed=path.join(workspace,'_scratch'),temp=process.env.TEMP;
 const raw=typeof temp==='string'?temp.replaceAll('/','\\').toLowerCase():'';
 if(raw!==managed.toLowerCase()&&!raw.startsWith(managed.toLowerCase()+'\\'))return realDirectory(fallback);
 assert(path.isAbsolute(temp)&&!/[\\/]\.\.?([\\/]|$)/.test(temp),'managed source scratch must be an absolute canonical path');
 const candidate=path.resolve(temp);assert.equal(path.dirname(candidate).toLowerCase(),managed.toLowerCase(),'managed source scratch must be a direct owned child');
 assert.match(path.basename(candidate),/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}-[a-f0-9]{32}$/,'managed source scratch label must match its owner');realDirectory(candidate);
 const marker=path.join(candidate,'.candidate-scratch-owner.json'),stat=fs.lstatSync(marker);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=4096,'managed source scratch owner must be a small regular file');
 const owner=JSON.parse(fs.readFileSync(marker,'utf8'));assert(owner&&owner.schema===1&&typeof owner.ownerId==='string'&&/^[a-f0-9]{32}$/.test(owner.ownerId),'managed source scratch owner is invalid');
 assert.equal(typeof owner.workspaceRoot,'string');assert.equal(owner.workspaceRoot.replaceAll('/','\\').toLowerCase(),workspace.toLowerCase(),'managed source scratch workspace mismatch');
 assert.equal(typeof owner.directory,'string');assert(path.isAbsolute(owner.directory));assert.equal(path.resolve(owner.directory).toLowerCase(),candidate.toLowerCase(),'managed source scratch directory mismatch');return candidate;
}
const scratch=selectScratch();
const {businessEnvelope}=loadCore('./BusinessCommands');
const audio=()=>Uint8Array.of(8,1,16,3,34,3,1,2,3);
const attempt=n=>'voice-'+n.toString(16).padStart(32,'0');
function recordingOrigin(f,n=1){return {schema:1,name:'take-'+ 'b'.repeat(32),uuid:'recording-uuid',owner_id:attempt(n),cleanup_id:'c'.repeat(32),peer:f.peer,
 raw_bytes:240,raw_sha256:'d'.repeat(64),result_sha256:'e'.repeat(64),material_id:'mat-recording-'+ 'b'.repeat(32),material_revision:2,exit_evidence:'device_event'};}

// Real bounded D: files, real SHA256 and precise short IO. No device, server,
// native audio, model or task enqueue is reachable from these store tests.
function fixture(t){
 assert.match(scratch,/^[Dd]:[\\/]/);const root=fs.mkdtempSync(path.join(scratch,'voice-source-host-')).replaceAll('\\','/');
 const resolved=path.resolve(root),prefix=path.join(scratch,'voice-source-host-'),handles=new Map(),stats={reads:0,writes:0,fsync:0,rename:0,changes:0};
 t.after(()=>{for(const fd of handles.keys())try{fs.closeSync(fd);}catch{}assert.equal(path.dirname(resolved).toLowerCase(),scratch.toLowerCase());assert(resolved.startsWith(prefix)&&resolved!==scratch);realDirectory(scratch);if(fs.existsSync(resolved)){realDirectory(resolved);fs.rmSync(resolved,{recursive:true,force:true});}});
 realDirectory(resolved);
 let random=0,randomFail=false,peer='synthetic-peer',epoch=7,writeWidth=37,readWidth=83,fault='',writeAt=0,writeCount=0,afterWrite;
 const safe=value=>{const p=typeof value==='number'?handles.get(value):value?.fd!==undefined?handles.get(value.fd):value;
  if(typeof p!=='string'||!path.resolve(p).startsWith(resolved+path.sep))throw Error('synthetic source IO escaped owned D directory');return p;};
 const io={OpenMode:{READ_ONLY:fs.constants.O_RDONLY,WRITE_ONLY:fs.constants.O_WRONLY,CREATE:fs.constants.O_CREAT,TRUNC:fs.constants.O_TRUNC},
  accessSync:p=>fs.existsSync(safe(p)),statSync:p=>fs.statSync(safe(p)),lstatSync:p=>fs.lstatSync(safe(p)),readTextSync:p=>fs.readFileSync(safe(p),'utf8'),
  openSync(p,mode=fs.constants.O_RDONLY){const fd=fs.openSync(safe(p),mode);handles.set(fd,p);return{fd};},
  closeSync(value){const fd=typeof value==='number'?value:value.fd;safe(fd);fs.closeSync(fd);handles.delete(fd);},
  readSync(fd,buffer,options={}){safe(fd);assert.equal(options.offset,undefined,'SDK offset is relative; advance the actual fd');stats.reads++;
   const bytes=new Uint8Array(buffer);return fs.readSync(fd,bytes,0,Math.min(readWidth,options.length??bytes.length,bytes.length),null);},
  writeSync(fd,buffer){safe(fd);stats.writes++;writeCount++;if(fault==='write'&&writeCount===writeAt)throw Error('synthetic source short-write failure');
   const bytes=new Uint8Array(buffer),n=fs.writeSync(fd,bytes,0,Math.min(writeWidth,bytes.length),null);if(afterWrite){const hook=afterWrite;afterWrite=undefined;hook();}return n;},
  fsyncSync(fd){safe(fd);stats.fsync++;if(fault==='fsync')throw Error('synthetic source fsync failure');fs.fsyncSync(fd);},
  renameSync(from,to){safe(from);safe(to);stats.rename++;if(fault==='rename_before')throw Error('synthetic source rename-before failure');
   fs.renameSync(from,to);if(fault==='rename_after')throw Error('synthetic source rename-after failure');},
  unlinkSync(){assert.fail('source history must never be automatically pruned');}
 };
 const platform={'@kit.CoreFileKit':{fileIo:io},'@kit.ArkTS':{util:{TextEncoder:class{encodeInto(value){return new TextEncoder().encode(value);}},
  TextDecoder:class{constructor(label,options){this.decoder=new TextDecoder(label,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}}},
  '@kit.CryptoArchitectureKit':{cryptoFramework:{createMd:()=>{const hash=createHash('sha256');return{updateSync:b=>hash.update(b.data),digestSync:()=>({data:Uint8Array.from(hash.digest())})};},
   createRandom:()=>({generateRandomSync:n=>{if(randomFail)throw Error('synthetic random unavailable');return{data:new Uint8Array(n).fill(++random)};}})}},
  '@kit.NetworkKit':{http:{createHttp(){assert.fail('source receipts must never open HTTP');}}}};
 const model=loadApp('TaskReplyDraft',platform),core=loadApp('TaskVoiceSources',platform),wire=loadApp('TaskWire',platform),refs=loadApp('TaskVoiceSourceRef',platform),now=Date.now();
 const binding=Object.assign(new model.TaskReplyBinding(),{context_key:'private-owner-context',operation_id:'original-operation',request_id:'original-question',request_revision:3,task_id:'original-task',
  route:{computer_id:'private-computer',agent_id:'hermes',project_id:'private-project',session_id:'private-existing-session'},expires_at:new Date(now+60000).toISOString(),question:'原问题全文不得存入来源账本',mode:'free_text'});
 const file=root+'/task-voice-sources.json',text=' 首句🦜。\n用新价格，但运费沿用上次。 ';
 const create=()=>{const store=new core.TaskVoiceSources();store.connection=()=>Object.assign(new core.TaskVoiceConnection(),{peer,epoch});store.changed=()=>stats.changes++;store.initialize(root);return store;};
 const store=create();
 const answer=(ref,body=text,b=binding,source='voice')=>Object.assign(new model.TaskReplySubmission(),{binding:clone(b),text:body,input_source:source,voice_source:ref===null?null:clone(ref)});
 const register=(n=1,b=binding,body=text,target=store)=>target.register(b,attempt(n),peer,epoch,body);
 const event=(value)=>{const body=Object.assign(new wire.TaskAnswerBody(),{answer_id:'answer-source-1',request_id:value.binding.request_id,request_revision:value.binding.request_revision,
  task_id:value.binding.task_id,route:clone(value.binding.route),option_id:value.option_id,text:value.text,input_source:value.input_source});
  return Object.assign(new wire.TaskEnvelope(),{event_id:'evt-source-1',idempotency_key:'idem-source-1',kind:'answer',producer_id:'synthetic-phone',created_at:new Date(now).toISOString(),expires_at:value.binding.expires_at,body});};
 return{...model,...core,...refs,root,file,binding,text,now,io,stats,store,create,answer,register,event,
  disk:()=>JSON.parse(fs.readFileSync(file,'utf8')),bytes:()=>fs.readFileSync(file),
  setConnection:(nextPeer,nextEpoch)=>{peer=nextPeer;epoch=nextEpoch;},get peer(){return peer;},get epoch(){return epoch;},
  randomFail:()=>randomFail=true,widths:(read,write)=>{readWidth=read;writeWidth=write;},
  armFault:(next,at=2)=>{fault=next;writeAt=at;writeCount=0;},clearFault:()=>{fault='';writeAt=0;writeCount=0;},afterWrite:hook=>afterWrite=hook};
}

test('register persists an exact six-field hash receipt before return using real short writes without storing full text',t=>{
 const f=fixture(t),ref=f.register(),answer=f.answer(ref);assert.equal(f.store.blocked,false);assert(f.taskVoiceSourceValid(ref));
 assert.deepEqual(Object.keys(ref).sort(),['schema','attempt_id','peer','connection_epoch','binding_sha256','text_sha256'].sort());
 assert.equal(ref.text_sha256,sha(Buffer.from(f.text,'utf8')));assert.notEqual(ref.text_sha256,sha(Buffer.from(f.text.trim(),'utf8')));
 assert.equal(f.disk().records.length,1);assert(f.stats.writes>1);assert(f.stats.fsync>0);assert(f.stats.rename>0);
 assert.equal(f.disk().records[0].ref.text_sha256,ref.text_sha256);assert.equal(f.store.status(answer).state,'watching');f.store.assertAnswer(answer);assert(f.stats.reads>1);
 const raw=f.bytes().toString('utf8');for(const secret of [f.text,f.binding.question,f.binding.context_key,f.binding.route.session_id])assert.equal(raw.includes(secret),false);
 const bytes=f.bytes(),changes=f.stats.changes;assert.deepEqual(clone(f.register()),clone(ref));assert.deepEqual(f.bytes(),bytes);assert.equal(f.stats.changes,changes);
 ref.peer='caller mutation';assert.equal(f.store.status(answer).state,'watching','returned refs cannot mutate the persisted receipt');
});
test('recording receipts require a verified immutable source and cannot be borrowed by another origin or text',t=>{
 const f=fixture(t),origin=recordingOrigin(f);assert.throws(()=>f.store.registerRecording(f.binding,attempt(1),f.peer,f.epoch,f.text,origin),/UNAVAILABLE/);
 assert.equal(fs.existsSync(f.file),false);let valid=true,checks=0;
 f.store.assertRecordingOrigin=(value,textHash)=>{checks++;assert.deepEqual(value,origin);assert.equal(textHash,sha(f.text));if(!valid)throw Error('source changed');};
 const ref=f.store.registerRecording(f.binding,attempt(1),f.peer,f.epoch,f.text,origin),value=f.answer(ref);
 assert.equal(f.disk().schema,2);assert.deepEqual(f.disk().records[0].recording_origin,origin);f.store.assertAnswer(value);
 const reordered=Object.fromEntries(Object.entries(origin).reverse());assert.deepEqual(clone(f.store.registerRecording(f.binding,attempt(1),f.peer,f.epoch,f.text,reordered)),clone(ref));
 valid=false;assert.throws(()=>f.store.assertAnswer(value));assert.equal(f.store.status(value).state,'unknown');assert.throws(()=>f.store.pin(value));assert(checks>2);
});
test('recording origin watch ignores assistant and other recording audio, but invalidates its exact UUID',t=>{
 const f=fixture(t),origin=recordingOrigin(f);f.store.assertRecordingOrigin=()=>{};
 const ref=f.store.registerRecording(f.binding,attempt(1),f.peer,f.epoch,f.text,origin),value=f.answer(ref);
 f.store.observe(f.peer,f.epoch,13,audio());assert.equal(f.store.status(value).state,'watching');
 const packet=uuid=>businessEnvelope(3,new TextEncoder().encode(JSON.stringify({uuid})));
 f.store.observe(f.peer,f.epoch,14,packet('another-recording'));assert.equal(f.store.status(value).state,'watching');
 f.store.observe(f.peer,f.epoch+1,14,packet(origin.uuid));assert.equal(f.store.status(value).state,'watching');
 f.store.observe(f.peer,f.epoch,14,packet(origin.uuid));assert.equal(f.store.status(value).state,'tainted');assert.throws(()=>f.store.assertAnswer(value));
});
test('old schema1 source rows load without rewriting and migrate atomically only on a new explicit registration',t=>{
 const f=fixture(t),ref=f.register(),data=f.disk();data.schema=1;for(const row of data.records)delete row.recording_origin;
 fs.writeFileSync(f.file,JSON.stringify(data));const old=f.bytes(),cold=f.create();assert(!cold.blocked);assert.deepEqual(f.bytes(),old);assert.equal(cold.status(f.answer(ref)).state,'unknown');
 cold.register({...clone(f.binding),operation_id:'another-operation'},attempt(2),f.peer,f.epoch,f.text);
 const migrated=f.disk();assert.equal(migrated.schema,2);assert.deepEqual(migrated.records[0].ref,data.records[0].ref);assert.equal(migrated.records[0].recording_origin,null);
});
test('restored recording sources retain their provenance and remain unknown instead of acquiring a fresh live epoch',t=>{
 const f=fixture(t),origin=recordingOrigin(f);f.store.assertRecordingOrigin=()=>{};
 const ref=f.store.registerRecording(f.binding,attempt(1),f.peer,f.epoch,f.text,origin),cold=f.create();cold.assertRecordingOrigin=()=>{};
 const restored=cold.restoreRecording(f.binding,attempt(1),f.peer,f.text,origin);assert.deepEqual(clone(restored),clone(ref));
 assert.equal(cold.status(f.answer(restored)).state,'unknown');assert.throws(()=>cold.assertAnswer(f.answer(restored)));assert.deepEqual(f.disk().records[0].recording_origin,origin);
});
test('schema2 malformed recording origin blocks voice while leaving independent phone answers usable',t=>{
 const f=fixture(t),origin=recordingOrigin(f);f.store.assertRecordingOrigin=()=>{};const ref=f.store.registerRecording(f.binding,attempt(1),f.peer,f.epoch,f.text,origin),data=f.disk();
 data.records[0].recording_origin.uuid=123;fs.writeFileSync(f.file,JSON.stringify(data));const old=f.bytes(),cold=f.create();assert(cold.blocked);
 assert.throws(()=>cold.assertAnswer(f.answer(ref)));cold.assertAnswer(f.answer(null,f.text,f.binding,'phone'));assert.deepEqual(f.bytes(),old);
});

test('canonical binding digest ignores object key order while preserving every original value and option order',t=>{
 const f=fixture(t),b=clone(f.binding);b.mode='choice';b.options=[{option_id:'a',label:'方案甲'},{option_id:'b',label:'方案乙'}];const ref=f.register(1,b),value=f.answer(ref,f.text,b);
 const reordered=Object.fromEntries(Object.entries(b).reverse());reordered.route=Object.fromEntries(Object.entries(b.route).reverse());reordered.options=b.options.map(o=>({label:o.label,option_id:o.option_id}));
 f.store.assertAnswer(f.answer(ref,f.text,reordered));assert.deepEqual(clone(f.register(1,reordered)),clone(ref));
 const changes=[v=>v.context_key+='x',v=>v.operation_id+='x',v=>v.request_id+='x',v=>v.request_revision++,v=>v.task_id+='x',v=>v.question+='x',
  v=>v.expires_at=new Date(Date.parse(v.expires_at)+1).toISOString(),v=>v.route.computer_id+='x',v=>v.route.agent_id+='x',v=>v.route.project_id+='x',v=>v.route.session_id+='x',
  v=>v.options.reverse(),v=>v.options[0].label+='x'];
 for(const change of changes){const next=clone(b);change(next);assert.throws(()=>f.store.assertAnswer(f.answer(ref,f.text,next)));}
 for(const text of [f.text.trim(),f.text.replace('\n',' '),f.text+'尾'])assert.throws(()=>f.store.assertAnswer(f.answer(ref,text,b)));
 assert.equal(f.store.status(value).state,'watching');
});

test('fresh receipt requires the exact current positive authenticated epoch and rejects changed attempts or invalid Unicode',t=>{
 const f=fixture(t);for(const [peer,epoch]of[['other-peer',7],[f.peer,0],[f.peer,-1],[f.peer,8],[f.peer,NaN]])assert.throws(()=>f.store.register(f.binding,attempt(1),peer,epoch,f.text));
 assert.equal(fs.existsSync(f.file),false);const ref=f.register();
 assert.throws(()=>f.register(1,f.binding,f.text+'different'));assert.throws(()=>f.store.register(f.binding,'voice-not-random',f.peer,f.epoch,f.text));
 for(const text of ['\ud800','\udc01','ok\ud801tail',' \n '])assert.throws(()=>f.register(2,f.binding,text));
 assert.equal(f.disk().records.length,1);assert.equal(f.store.status(f.answer(ref)).state,'watching');
});

test('status is metadata only and read-only; current phone and choice answers ignore missing or blocked source storage',t=>{
 const f=fixture(t),ref=f.register(),value=f.answer(ref),bytes=f.bytes(),changes=f.stats.changes,view=f.store.status(value);
 assert.equal(view.state,'watching');for(const secret of [f.text,f.binding.question,f.binding.context_key,f.binding.route.session_id])assert.equal(JSON.stringify(view).includes(secret),false);
 assert.deepEqual(f.bytes(),bytes);assert.equal(f.stats.changes,changes);const bad=clone(value);bad.binding.route.session_id+='wrong';assert.equal(f.store.status(bad).attempt_id,'');
 f.store.blocked=true;for(const [source,state]of[['phone','independent_phone'],['glasses_semantic','independent_choice']]){
  const answer=f.answer(null,f.text,f.binding,source);f.store.assertAnswer(answer);f.store.pin(answer);assert.equal(f.store.status(answer).state,state);
  f.store.beforeSend(f.binding.operation_id,f.event(answer),f.binding.context_key);
 }
 const legacy=f.answer(null);legacy.record_schema=1;assert.throws(()=>f.store.assertAnswer(legacy));assert.equal(f.store.status(legacy).state,'legacy');
 const unknown=f.answer(null);assert.throws(()=>f.store.assertAnswer(unknown));assert.equal(f.store.status(unknown).state,'unknown');
 const crossed=f.answer(ref,f.text,f.binding,'phone');assert.throws(()=>f.store.assertAnswer(crossed));assert.deepEqual(f.bytes(),bytes);
});

test('same-connection late audio taints all watching receipts before notification without consuming or decoding the packet',t=>{
 const f=fixture(t),a=f.answer(f.register(1)),b=f.answer(f.register(2,{...clone(f.binding),operation_id:'other-operation'}),f.text,{...clone(f.binding),operation_id:'other-operation'});
 const packet=audio(),before=Uint8Array.from(packet);let notified=0,durableBeforeNotification=false;f.store.changed=()=>{notified++;durableBeforeNotification=f.disk().records.every(r=>r.state==='tainted');};
 f.store.observe(f.peer,f.epoch,13,packet);assert.deepEqual(packet,before);assert.equal(notified,1);assert.equal(durableBeforeNotification,true);assert(f.disk().records.every(r=>r.late_packets===1));
 for(const answer of [a,b]){assert.equal(f.store.status(answer).state,'tainted');assert.throws(()=>f.store.assertAnswer(answer));assert.throws(()=>f.store.pin(answer));}
 const bytes=f.bytes();assert.throws(()=>f.register(1));assert.deepEqual(f.bytes(),bytes);f.store.observe(f.peer,f.epoch,13,audio());assert.equal(f.store.status(a).state,'tainted');
});

test('wrong peer, old auth epoch, other business and other valid message types do not taint or mutate an observed packet',t=>{
 const f=fixture(t),value=f.answer(f.register()),bytes=f.bytes(),changes=f.stats.changes;
 const cases=[['wrong-peer',f.epoch,13,audio()],[f.peer,f.epoch-1,13,audio()],[f.peer,f.epoch,21,audio()],
  [f.peer,f.epoch,13,businessEnvelope(8,new TextEncoder().encode('{"rc":6}'))],[f.peer,f.epoch,13,businessEnvelope(54,new TextEncoder().encode('{}'))]];
 for(const [peer,epoch,business,payload]of cases){const before=Uint8Array.from(payload);f.store.observe(peer,epoch,business,payload);assert.deepEqual(payload,before);assert.equal(f.store.status(value).state,'watching');}
 assert.deepEqual(f.bytes(),bytes);assert.equal(f.stats.changes,changes);
});

test('malformed relevant envelopes fail closed without mutating caller bytes',async t=>{
 for(const payload of [new Uint8Array(),Uint8Array.of(8,1),Uint8Array.of(16,3,34,9,1),Uint8Array.of(16,3,16,3)])await t.test(Buffer.from(payload).toString('hex')||'empty',t=>{
  const f=fixture(t),value=f.answer(f.register()),before=Uint8Array.from(payload);f.store.observe(f.peer,f.epoch,13,payload);
  assert.deepEqual(payload,before);assert.equal(f.store.status(value).state,'tainted');assert.throws(()=>f.store.assertAnswer(value));
 });
});

test('pin persists one exact original operation and cannot attach another ref or option to the same operation',t=>{
 const f=fixture(t),binding=clone(f.binding);binding.mode='choice';binding.options=[{option_id:'a',label:'甲'},{option_id:'b',label:'乙'}];
 const first=f.answer(f.register(1,binding),f.text,binding),second=f.answer(f.register(2,binding),f.text,binding);first.option_id='a';f.store.pin(first);
 assert.equal(f.disk().records[0].pinned,true);const bytes=f.bytes();f.store.pin(first);assert.deepEqual(f.bytes(),bytes);
 const changed=clone(first);changed.option_id='b';assert.throws(()=>f.store.pin(changed));assert.throws(()=>f.store.pin(second));assert.throws(()=>f.register(3,binding));assert.deepEqual(f.bytes(),bytes);
});

test('actual POST gate requires a pinned full event and persists dispatch before returning; same event is idempotent',t=>{
 const f=fixture(t),value=f.answer(f.register()),event=f.event(value);assert.throws(()=>f.store.beforeSend(f.binding.operation_id,event,f.binding.context_key));
 f.store.pin(value);f.store.beforeSend(f.binding.operation_id,event,f.binding.context_key);assert.equal(f.disk().records[0].dispatch_started,true);
 const view=f.store.status(value);assert.equal(view.dispatch_started,true);assert.equal(view.delivery_uncertain,false);const bytes=f.bytes();
 f.store.beforeSend(f.binding.operation_id,event,f.binding.context_key);assert.deepEqual(f.bytes(),bytes);
 for(const mutate of [e=>e.event_id+='x',e=>e.idempotency_key+='x',e=>e.producer_id+='x',e=>e.body.answer_id+='x']){const other=clone(event);mutate(other);assert.throws(()=>f.store.beforeSend(f.binding.operation_id,other,f.binding.context_key));}
 f.store.observe(f.peer,f.epoch,13,audio());const after=f.store.status(value);assert.equal(after.state,'tainted');assert.equal(after.dispatch_started,true);assert.equal(after.delivery_uncertain,true);
 assert.deepEqual(event,f.event(value),'source invalidation cannot rewrite an already serialized event');assert.throws(()=>f.store.beforeSend(f.binding.operation_id,event,f.binding.context_key));
});

test('beforeSend rejects changed request, revision, task, route, source binding, full text, option, context or deadline',t=>{
 const f=fixture(t),value=f.answer(f.register()),original=f.event(value);f.store.pin(value);const bytes=f.bytes();
 const changes=[e=>e.body.request_id+='x',e=>e.body.request_revision++,e=>e.body.task_id+='x',e=>e.body.route.session_id+='x',e=>e.body.route.computer_id+='x',
  e=>e.body.route.agent_id+='x',e=>e.body.route.project_id+='x',e=>e.body.text+='尾',e=>e.body.option_id='foreign-option',e=>e.body.raw_action='fabricated',
  e=>e.expires_at=new Date(Date.parse(e.expires_at)+1).toISOString(),e=>e.body.extra='injected'];
 for(const change of changes){const event=clone(original);change(event);assert.throws(()=>f.store.beforeSend(f.binding.operation_id,event,f.binding.context_key));assert.deepEqual(f.bytes(),bytes);}
 assert.throws(()=>f.store.beforeSend('another-operation',original,f.binding.context_key));assert.throws(()=>f.store.beforeSend(f.binding.operation_id,original,'another-owner'));
 assert.equal(f.store.status(value).dispatch_started,false);
});

test('cold watchers never become trusted on reconnect or identical re-register; restore preserves the original unknown ref',t=>{
 const f=fixture(t),ref=f.register(),value=f.answer(ref),bytes=f.bytes(),cold=f.create();assert.equal(cold.blocked,false);assert.deepEqual(f.bytes(),bytes);
 assert.equal(cold.status(value).state,'unknown');assert.throws(()=>cold.assertAnswer(value));assert.throws(()=>cold.register(f.binding,attempt(1),f.peer,f.epoch,f.text));
 const restored=cold.restore(f.binding,attempt(1),f.peer,f.text);assert.deepEqual(clone(restored),clone(ref));assert.equal(cold.status(f.answer(restored)).state,'unknown');assert.throws(()=>cold.pin(f.answer(restored)));
 const again=f.create();assert.equal(again.status(value).state,'unknown');assert.throws(()=>again.assertAnswer(value));
});

test('a missing old capture can only create a persisted unknown receipt, never a fresh watching source',t=>{
 const f=fixture(t),ref=f.store.restore(f.binding,attempt(1),f.peer,f.text),value=f.answer(ref);
 assert.equal(f.disk().records.length,1);assert.equal(f.disk().records[0].state,'unknown');assert.equal(f.store.status(value).state,'unknown');
 assert.throws(()=>f.register(1));assert.throws(()=>f.store.assertAnswer(value));assert.throws(()=>f.store.pin(value));
 const bytes=f.bytes();assert.deepEqual(clone(f.store.restore(f.binding,attempt(1),f.peer,f.text)),clone(ref));assert.deepEqual(f.bytes(),bytes);
});

test('disconnect removes freshness durably and an auth epoch change cannot revive an old receipt',t=>{
 const f=fixture(t),value=f.answer(f.register());f.store.pin(value);f.store.beforeSend(f.binding.operation_id,f.event(value),f.binding.context_key);f.store.disconnected();
 assert.equal(f.disk().records[0].state,'unknown');assert.equal(f.store.status(value).state,'unknown');assert.equal(f.store.status(value).delivery_uncertain,true);
 f.setConnection(f.peer,f.epoch+1);assert.throws(()=>f.store.assertAnswer(value));assert.throws(()=>f.store.beforeSend(f.binding.operation_id,f.event(value),f.binding.context_key));
 const bytes=f.bytes();f.store.observe(f.peer,f.epoch-1,13,audio());assert.deepEqual(f.bytes(),bytes);
});

test('failed late invalidations stay immediately protected and preserve any partial across live retry and cold restart',async t=>{
 for(const fault of ['write','fsync','rename_before','rename_after'])await t.test(fault,t=>{
  const f=fixture(t),value=f.answer(f.register()),before=f.bytes();f.armFault(fault);f.store.observe(f.peer,f.epoch,13,audio());
  assert.equal(f.store.blocked,true);assert.throws(()=>f.store.assertAnswer(value));assert.equal(f.store.status(value).late_packets,1);f.clearFault();
  const main=f.bytes(),partial=fs.existsSync(f.file+'.partial')?fs.readFileSync(f.file+'.partial'):undefined;
  assert.throws(()=>f.store.register(f.binding,attempt(2),f.peer,f.epoch,f.text));assert.deepEqual(f.bytes(),main);
  if(partial){assert.deepEqual(main,before);assert.deepEqual(fs.readFileSync(f.file+'.partial'),partial);const cold=f.create();assert(cold.blocked);assert.throws(()=>cold.assertAnswer(value));assert.deepEqual(fs.readFileSync(f.file+'.partial'),partial);}
  else{const cold=f.create();assert.equal(cold.status(value).state,'tainted');assert.throws(()=>cold.assertAnswer(value));}
 });
});

test('failed first registration or dispatch publication never authorizes a ref or POST and cannot directly overwrite evidence',async t=>{
 for(const step of ['register','pin','dispatch'])await t.test(step,t=>{
  const f=fixture(t);let value,event;
  if(step!=='register'){value=f.answer(f.register());event=f.event(value);if(step==='dispatch')f.store.pin(value);}
  f.armFault('rename_before');assert.throws(()=>{if(step==='register')f.register();else if(step==='pin')f.store.pin(value);else f.store.beforeSend(f.binding.operation_id,event,f.binding.context_key);});
  assert(f.store.blocked);const partial=fs.readFileSync(f.file+'.partial'),main=fs.existsSync(f.file)?f.bytes():undefined;f.clearFault();
  assert.throws(()=>f.register(2));assert.deepEqual(fs.readFileSync(f.file+'.partial'),partial);if(main)assert.deepEqual(f.bytes(),main);
  assert(f.create().blocked);if(value)assert.throws(()=>f.store.assertAnswer(value));
 });
});

test('stale instances and a canonical writer during short publication are detected without erasing either record',t=>{
 const f=fixture(t),stale=f.create();f.register();const current=f.bytes();assert.throws(()=>stale.register(f.binding,attempt(2),f.peer,f.epoch,f.text));assert(stale.blocked);assert.deepEqual(f.bytes(),current);
 const external=Buffer.from(f.bytes().toString('utf8')+'\n');f.afterWrite(()=>fs.writeFileSync(f.file,external));
 assert.throws(()=>f.register(3));assert(f.store.blocked);assert.deepEqual(f.bytes(),external);assert(fs.existsSync(f.file+'.partial'));
 const partial=fs.readFileSync(f.file+'.partial');assert(f.create().blocked);assert.deepEqual(fs.readFileSync(f.file+'.partial'),partial);
});

test('foreign partial, corrupted, unknown, invalid-UTF8 or oversized sources block only voice and preserve bytes',async t=>{
 for(const kind of ['partial_with_main','orphan_partial','corrupt','unknown_field','unknown_schema','unknown_state','invalid_utf8','oversized'])await t.test(kind,t=>{
  const f=fixture(t);let value;
  if(kind!=='orphan_partial')value=f.answer(f.register());
  if(kind.includes('partial'))fs.writeFileSync(f.file+'.partial','{newer interrupted source');
  else if(kind==='corrupt')fs.writeFileSync(f.file,'{broken');
  else if(kind==='oversized'){const fd=fs.openSync(f.file,'w');try{fs.ftruncateSync(fd,1048577);}finally{fs.closeSync(fd);}}
  else{const data=f.disk();if(kind==='unknown_field')data.extra=true;if(kind==='unknown_schema')data.schema=3;if(kind==='unknown_state')data.records[0].state='invented';
   const bytes=Buffer.from(JSON.stringify(data));if(kind==='invalid_utf8'){const at=bytes.indexOf(Buffer.from('original-operation'));assert(at>0);bytes[at]=0xff;}fs.writeFileSync(f.file,bytes);}
  const main=fs.existsSync(f.file)?f.bytes():undefined,partial=fs.existsSync(f.file+'.partial')?fs.readFileSync(f.file+'.partial'):undefined,cold=f.create();assert(cold.blocked);
  if(value)assert.throws(()=>cold.assertAnswer(value));cold.assertAnswer(f.answer(null,f.text,f.binding,'phone'));
  assert.throws(()=>cold.register(f.binding,attempt(2),f.peer,f.epoch,f.text));if(main)assert.deepEqual(f.bytes(),main);if(partial)assert.deepEqual(fs.readFileSync(f.file+'.partial'),partial);
 });
});

test('128 receipts have an explicit hard capacity without pruning; existing pins and invalidations continue within the bound',t=>{
 const f=fixture(t);f.widths(16384,16384);let first;
 for(let n=1;n<=128;n++){const b={...clone(f.binding),operation_id:'operation-'+n},ref=f.register(n,b);if(n===1)first=f.answer(ref,f.text,b);}
 assert.equal(f.disk().records.length,128);assert(f.bytes().length<1048576);const bytes=f.bytes();assert.throws(()=>f.register(129,{...clone(f.binding),operation_id:'operation-129'}),/CAPACITY/);assert.deepEqual(f.bytes(),bytes);assert.equal(f.store.blocked,false);
 f.store.assertAnswer(first);f.store.pin(first);f.store.observe(f.peer,f.epoch,13,audio());assert.equal(f.disk().records.length,128);assert.equal(f.store.status(first).state,'tainted');
 const cold=f.create();assert.equal(cold.blocked,false);assert.equal(cold.status(first).state,'tainted');assert.equal(cold.status(f.answer(null,f.text,f.binding,'phone')).state,'independent_phone');
});

test('entropy failure never invents a current boot source while independent phone answers remain usable',t=>{
 const f=fixture(t);f.randomFail();const blocked=f.create();assert(blocked.blocked);assert.equal(fs.existsSync(f.file),false);
 assert.throws(()=>blocked.register(f.binding,attempt(1),f.peer,f.epoch,f.text));blocked.assertAnswer(f.answer(null,f.text,f.binding,'phone'));
 assert.equal(blocked.status(f.answer(null,f.text,f.binding,'phone')).state,'independent_phone');
});

test('a dispatch notification which synchronously invalidates the source still refuses the pending POST boundary',t=>{
 for(const reason of ['late_audio','disconnect']){
  const f=fixture(t),value=f.answer(f.register()),event=f.event(value);f.store.pin(value);let changed=false;
  f.store.changed=()=>{if(!changed){changed=true;if(reason==='late_audio')f.store.observe(f.peer,f.epoch,13,audio());else f.store.disconnected();}};
  assert.throws(()=>f.store.beforeSend(f.binding.operation_id,event,f.binding.context_key),/TASK_VOICE_SOURCE_/);
  assert(changed);assert.notEqual(f.store.status(value).state,'watching');assert.equal(f.disk().records[0].dispatch_started,true);
  assert.equal(f.store.status(value).delivery_uncertain,true,'the conservative dispatch marker is retained, never rewritten as a successful recall');
 }
});
