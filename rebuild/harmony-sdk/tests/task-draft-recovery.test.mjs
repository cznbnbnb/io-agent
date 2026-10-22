import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const scratch=path.resolve(fileURLToPath(new URL('../../phase1/',import.meta.url)));

// Independent native-file adapter: do not change the existing material fixture's
// numeric mode semantics. All files are small synthetic records on D:, with
// real raw reads, short IO and a real SHA256 implementation supplied by loadApp.
function fixture(t){
 assert.match(scratch,/^[Dd]:[\\/]/,'recovery tests must not accumulate files on C:');
 const root=fs.mkdtempSync(path.join(scratch,'task-recovery-host-')).replaceAll('\\','/');
 const resolved=path.resolve(root),prefix=path.join(scratch,'task-recovery-host-');
 const handles=new Map(),renames=[],readSizes=[];let fault,renameCount=0,nonce=0,now=Date.now(),context='synthetic-recovery-context',idle=true,valid=true;
 const existing=new Set(),effects={suspend:0,changed:0,validate:0,operation:0,device:0,network:0,enqueue:0,draftSaved:0};
 const rootPath=value=>{const target=typeof value==='number'?handles.get(value):value?.fd!==undefined?handles.get(value.fd):value;
  if(typeof target!=='string'||(path.resolve(target)!==resolved&&!path.resolve(target).startsWith(resolved+path.sep)))throw Error('synthetic IO escaped its owned directory');return target;};
 const io={
  OpenMode:{READ_ONLY:fs.constants.O_RDONLY,WRITE_ONLY:fs.constants.O_WRONLY,READ_WRITE:fs.constants.O_RDWR,CREATE:fs.constants.O_CREAT,TRUNC:fs.constants.O_TRUNC,EXCL:fs.constants.O_EXCL},
  accessSync:p=>fs.existsSync(rootPath(p)),statSync:p=>fs.statSync(rootPath(p)),lstatSync:p=>fs.lstatSync(rootPath(p)),listFileSync:p=>fs.readdirSync(rootPath(p)),
  mkdirSync:p=>fs.mkdirSync(rootPath(p)),readTextSync:p=>fs.readFileSync(rootPath(p),'utf8'),
  openSync(p,mode=fs.constants.O_RDONLY){const fd=fs.openSync(rootPath(p),mode);handles.set(fd,p);return{fd};},
  closeSync(value){const fd=typeof value==='number'?value:value.fd;fs.closeSync(fd);handles.delete(fd);},
  readSync(fd,buffer,options={}){rootPath(fd);assert.equal(options.offset,undefined,'bounded reader should advance the fd without relative seeks');const bytes=new Uint8Array(buffer),length=Math.min(17,options.length??bytes.byteLength,bytes.byteLength);
   const n=fs.readSync(fd,bytes,0,length,null);readSizes.push(n);return n;},
  writeSync(fd,buffer){rootPath(fd);const bytes=new Uint8Array(buffer);return fs.writeSync(fd,bytes,0,Math.min(37,bytes.byteLength),null);},
  fsyncSync:fd=>{rootPath(fd);fs.fsyncSync(fd);},
  renameSync(from,to){rootPath(from);rootPath(to);const count=++renameCount;renames.push({from,to});
   if(fault?.at===count&&fault.when==='before')throw Error('synthetic rename before '+count);
   fs.renameSync(from,to);if(fault?.at===count&&fault.when==='after')throw Error('synthetic rename after '+count);},
  unlinkSync:p=>{throw Error('recovery must not delete original evidence: '+path.basename(rootPath(p)));},
  rmdirSync:p=>{throw Error('recovery must archive owned intent instead of deleting it: '+path.basename(rootPath(p)));}
 };
 class Clock extends Date{static now(){return now;}}
 const platform={'@kit.CoreFileKit':{fileIo:io},
  '@kit.ArkTS':{util:{TextEncoder:class{encodeInto(value){return new TextEncoder().encode(value);}},
   TextDecoder:class{constructor(label,options){this.decoder=new TextDecoder(label,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}}},
  './ProbeSession':{probeSession:{auth:{sendBusiness(){effects.device++;throw Error('unexpected BLE');}}}},
  './TaskService':{taskService:{answerBound(){effects.enqueue++;throw Error('unexpected enqueue');}}},
  '@kit.NetworkKit':{http:{createHttp(){effects.network++;throw Error('unexpected HTTP');}}}};
 const model=loadApp('TaskReplyDraft',platform,{Date:Clock}),core=loadApp('TaskDraftRecovery',platform,{Date:Clock});
 const binding=new model.TaskReplyBinding();Object.assign(binding,{context_key:context,operation_id:'synthetic-original-operation',request_id:'synthetic-original-question',request_revision:3,
  task_id:'synthetic-original-task',route:{computer_id:'synthetic-pc',agent_id:'hermes',project_id:'synthetic-project',session_id:'synthetic-existing-session'},
  expires_at:new Date(now+3600000).toISOString(),question:'是否采用这个价格？',mode:'free_text'});
 const main=root+'/task-decision-draft.json',partial=main+'.partial',active=root+'/task-decision-recovery.active',cases=root+'/task-decision-recovery-cases';
 const ports={context:()=>context,idle:()=>idle,operationExists:operation=>{effects.operation++;return existing.has(operation);},
  validate(value){effects.validate++;assert(model.taskSameReplyBinding(value,binding),'the original complete request binding must be checked');if(!valid)throw Error('synthetic request is closed');},
  suspend(){effects.suspend++;draft.pause();},nonce:()=> 'recover-'+(++nonce).toString(16).padStart(32,'0'),changed(){effects.changed++;}};
 let draft,recovery;
 const cold=()=>{draft=new model.TaskDecisionDraft();draft.initialize(root);recovery=new core.TaskDraftRecovery(draft,ports);recovery.initialize(root);return{draft,recovery};};
 const record=(stage='review',text=' 用新价格，但运费沿用上次。\n尾句保留🦜 ' )=>{const value=new model.TaskDecisionRecord();value.binding=clone(binding);value.stage=stage;value.text=['proposal','supplement_offer','voice_authorized'].includes(stage)?'':text;value.input_source=stage==='voice_authorized'?'phone':'voice';return value;};
 const put=(which,value,format=true)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(format?JSON.stringify(value,null,2)+'\r\n':value,'utf8');fs.writeFileSync(which==='main'?main:partial,bytes);return bytes;};
 const allFiles=(directory=root)=>{const found=new Map();if(!fs.existsSync(directory))return found;for(const name of fs.readdirSync(directory)){const p=path.join(directory,name);if(fs.statSync(p).isDirectory())for(const [key,value]of allFiles(p))found.set(key,value);else found.set(path.relative(root,p).replaceAll('\\','/'),fs.readFileSync(p));}return found;};
 const noRemote=()=>{assert.equal(effects.device,0);assert.equal(effects.network,0);assert.equal(effects.enqueue,0);assert.equal(effects.draftSaved,0);};
 t.after(()=>{for(const fd of handles.keys())try{fs.closeSync(fd);}catch{}assert(resolved.startsWith(prefix)&&resolved!==scratch);fs.rmSync(resolved,{recursive:true,force:true});});
 cold();return{...model,...core,root,main,partial,active,cases,binding,ports,effects,renames,readSizes,record,put,cold,allFiles,noRemote,
  get draft(){return draft;},get recovery(){return recovery;},get now(){return now;},advance:value=>now+=value,setContext:value=>context=value,setIdle:value=>idle=value,setValid:value=>valid=value,
  exists:value=>existing.add(value),armRename:(at,when='before')=>{renameCount=0;renames.length=0;fault={at,when};},clearFault:()=>{fault=undefined;renameCount=0;renames.length=0;}};
}

function originalPresent(f,bytes){assert([...f.allFiles().values()].some(value=>value.equals(bytes)),'every byte of each original must still exist in its live path or archive');}
function manifest(f){return[...f.allFiles()].map(([name,bytes])=>({name,bytes:bytes.length,sha256:sha(bytes)}));}
function sourceHash(f){const view=f.recovery.inspect();assert.equal(typeof view.inspection_sha256,'string');if(view.inspection_sha256)assert.match(view.inspection_sha256,/^[0-9a-f]{64}$/);return view;}
function recovered(f,text,stage='review',inputSource='voice',schema=2,voiceSource=null){
 assert.equal(fs.existsSync(f.partial),false);assert.equal(fs.existsSync(f.active),false);assert.equal(f.draft.blocked,false);assert.equal(f.draft.paused,true);
 const row=JSON.parse(fs.readFileSync(f.main,'utf8'));assert.equal(row.stage,stage);assert.equal(row.text,text);assert.equal(row.option_id,null);assert.equal(row.input_source,inputSource);assert.equal(row.schema,schema);
 if(schema===2)assert.deepEqual(row.voice_source,voiceSource);else assert.equal(Object.hasOwn(row,'voice_source'),false);
 assert.throws(()=>f.draft.seal(f.binding.context_key,f.now),'local recovery never retains permission to submit');f.noRemote();return row;
}

test('raw short reads hash exact UTF8 bytes and inspection exposes metadata while explicit preview preserves full text',t=>{
 const f=fixture(t),a=f.record('review',' 首句。\n末句🦜，不能截断。 '),b=f.record('review','候选全文：新价格，旧运费。');
 const main=f.put('main',a),partial=f.put('partial',b);f.cold();const view=sourceHash(f);
 assert.match(view.inspection_sha256,/^[0-9a-f]{64}$/);
 assert.equal(view.main.sha256,sha(main));assert.equal(view.partial.sha256,sha(partial));assert.equal(view.main.bytes,main.length);assert.equal(view.partial.bytes,partial.length);
 assert.equal(view.main.valid,true);assert.equal(view.partial.valid,true);assert.equal(view.main.text_length,a.text.length);assert(f.readSizes.filter(n=>n>0).length>2);assert(f.readSizes.every(n=>n<=17));
 const visible=JSON.stringify(view);for(const secret of [a.text,b.text,f.binding.context_key,f.binding.question,f.binding.route.session_id])assert.equal(visible.includes(secret),false);
 for(const [selected,value]of [['main',a],['partial',b]]){const preview=f.recovery.preview(selected,view.inspection_sha256);assert(preview.includes(f.binding.question));assert(preview.includes(value.text),'normal UI preview retains every answer character');}
 assert.equal(f.effects.suspend,0);
 assert.deepEqual(fs.readFileSync(f.main),main);assert.deepEqual(fs.readFileSync(f.partial),partial);f.noRemote();
});

test('normal UI can preview an expired queued original without request or outbox side effects, while restoration stays closed',t=>{
 const f=fixture(t),value=f.record('queued','已发送记录仍能只读核对全文。'),main=f.put('main',value);f.cold();f.advance(3600000);f.exists(f.binding.operation_id);f.setValid(false);
 const view=sourceHash(f);f.ports.validate=()=>assert.fail('read-only preview must not revalidate the server request');f.ports.operationExists=()=>assert.fail('read-only preview must not query outbox eligibility');
 const preview=f.recovery.preview('main',view.inspection_sha256);assert(preview.includes(f.binding.question));assert(preview.includes(value.text));assert.equal(f.effects.suspend,0);
 assert.throws(()=>f.recovery.restore('main',view.inspection_sha256));assert.deepEqual(fs.readFileSync(f.main),main);f.noRemote();
});

test('invalid UTF8 is hashed as raw evidence and cannot become a replacement-character answer',t=>{
 const f=fixture(t),main=f.put('main',f.record('review','有效的原始正文。'));
 const raw=Buffer.from(JSON.stringify(f.record('review','INVALID_UTF8_MARKER')),'utf8'),at=raw.indexOf('INVALID_UTF8_MARKER');assert(at>0);raw[at]=0xff;
 assert.doesNotThrow(()=>JSON.parse(raw.toString('utf8')),'replacement decoding would hide the invalid byte inside valid JSON');
 f.put('partial',raw);f.cold();const view=sourceHash(f),before=f.allFiles();
 assert.equal(view.partial.sha256,sha(raw));assert.equal(view.partial.bytes,raw.length);assert.equal(view.partial.valid,false);assert.equal(view.partial.eligible,false);
 assert.throws(()=>f.recovery.preview('partial',view.inspection_sha256));assert.throws(()=>f.recovery.restore('partial',view.inspection_sha256));
 assert.deepEqual(f.allFiles(),before);assert.equal(fs.existsSync(f.active),false);originalPresent(f,main);originalPresent(f,raw);assert.equal(f.effects.suspend,0);f.noRemote();
});

test('explicit selection of main or partial preserves both original files byte for byte and returns only a paused normalized draft',async t=>{
 for(const selected of ['main','partial'])await t.test(selected,t=>{
  const f=fixture(t),a=f.record('review','原正式全文。\n运费保留。'),b=f.record('review','新候选全文。\n不得截去尾句。');
  const main=f.put('main',a),partial=f.put('partial',b);f.cold();const view=sourceHash(f);assert.equal(view[selected].eligible,true);
  f.recovery.restore(selected,view.inspection_sha256);recovered(f,selected==='main'?a.text:b.text);originalPresent(f,main);originalPresent(f,partial);
  const after=f.allFiles();assert.equal(fs.readdirSync(f.cases).length,1);assert.throws(()=>f.recovery.restore(selected,view.inspection_sha256));assert.deepEqual(f.allFiles(),after);f.noRemote();
 });
});

test('an orphan valid partial remains recoverable by explicit selection and is archived without creating an old main',t=>{
 const f=fixture(t),value=f.record('review','只有候选文件仍保有完整条件。'),partial=f.put('partial',value);f.cold();assert.equal(f.draft.blocked,true);
 const view=sourceHash(f);assert.equal(view.main.present,false);assert.equal(view.partial.eligible,true);f.recovery.restore('partial',view.inspection_sha256);
 recovered(f,value.text);originalPresent(f,partial);assert.equal([...f.allFiles().keys()].some(name=>name.endsWith('/main.original')),false);f.noRemote();
});

test('recovery loses an old seal and resets voice authorization without replaying consent, capture or submit',async t=>{
 for(const stage of ['sealed','voice_authorized','deferred'])await t.test(stage,t=>{
  const f=fixture(t),value=f.record(stage,'恢复后必须重新核对完整条件。'),main=f.put('main',value);f.cold();const view=sourceHash(f);
  f.recovery.restore('main',view.inspection_sha256);recovered(f,value.text,stage==='voice_authorized'?'supplement_offer':'review',value.input_source);originalPresent(f,main);
  if(stage==='voice_authorized')assert.throws(()=>f.draft.voiceBinding(f.binding.context_key,f.now));f.noRemote();
 });
});

test('wrong inspection CAS and source changes reject preview or restoration without overwriting either original',async t=>{
 for(const change of ['wrong_hash','changed_main','changed_partial','unknown_source'])await t.test(change,t=>{
  const f=fixture(t);f.put('main',f.record());f.put('partial',f.record('review','候选完整条件。'));f.cold();const view=sourceHash(f);
  if(change==='changed_main')fs.appendFileSync(f.main,' ');if(change==='changed_partial')fs.appendFileSync(f.partial,'\n');const before=f.allFiles();
  const hash=change==='wrong_hash'?'0'.repeat(64):view.inspection_sha256,source=change==='unknown_source'?'automatic':'partial';
  assert.throws(()=>f.recovery.preview(source,hash));assert.throws(()=>f.recovery.restore(source,hash));assert.deepEqual(f.allFiles(),before);assert.equal(f.effects.suspend,0);f.noRemote();
 });
});

test('context, deadline, outbox, occupied runtime and closed original request cannot be bypassed by recovery',async t=>{
 for(const change of ['context','expired','outbox','occupied','closed_request'])await t.test(change,t=>{
  const f=fixture(t);f.put('main',f.record());f.put('partial',f.record('review','待选择的完整条件。'));f.cold();
  if(change==='context')f.setContext('other-owner-context');if(change==='expired')f.advance(3600000);if(change==='outbox')f.exists(f.binding.operation_id);if(change==='occupied')f.setIdle(false);if(change==='closed_request')f.setValid(false);
  const view=sourceHash(f),before=f.allFiles();assert.throws(()=>f.recovery.restore('partial',view.inspection_sha256));assert.deepEqual(f.allFiles(),before);f.noRemote();
 });
});

test('different original bindings, competing cleanup leases and overfull UID unions stay read only',async t=>{
 for(const change of ['binding','two_uids','same_uid_other_peer','uid_union'])await t.test(change,t=>{
  const f=fixture(t),a=f.record(),b=f.record('review','另一个候选全文。'),uid=f.binding.operation_id+'-card';
  if(change==='binding')b.binding.route.session_id+='-other';
  if(['two_uids','same_uid_other_peer'].includes(change)){
   Object.assign(a,{cleanup_uid:uid,cleanup_peer:'peer',card_stage:'review',used_uids:[uid]});const other=change==='two_uids'?uid+'-other':uid;
   Object.assign(b,{cleanup_uid:other,cleanup_peer:change==='same_uid_other_peer'?'other-peer':'peer',card_stage:'review',used_uids:[other]});
  }
  if(change==='uid_union'){a.used_uids=Array.from({length:5},(_,i)=>f.binding.operation_id+'-main-'+i);b.used_uids=Array.from({length:5},(_,i)=>f.binding.operation_id+'-partial-'+i);}
  f.put('main',a);f.put('partial',b);f.cold();const view=sourceHash(f),before=f.allFiles();assert.equal(view.main.eligible,false);assert.equal(view.partial.eligible,false);
  assert.throws(()=>f.recovery.restore('main',view.inspection_sha256));assert.throws(()=>f.recovery.restore('partial',view.inspection_sha256));assert.deepEqual(f.allFiles(),before);f.noRemote();
 });
});

test('one old cleanup lease is preserved even when it belongs to the unselected valid original',t=>{
 const f=fixture(t),a=f.record(),b=f.record('review','选择这个新全文，旧卡仍须清理。'),uid=f.binding.operation_id+'-old-review';
 Object.assign(a,{cleanup_uid:uid,cleanup_peer:'original-peer',card_stage:'review',used_uids:[uid]});b.used_uids=[f.binding.operation_id+'-prior-proposal'];
 const main=f.put('main',a),partial=f.put('partial',b);f.cold();f.recovery.restore('partial',sourceHash(f).inspection_sha256);const normalized=recovered(f,b.text);
 assert.equal(normalized.cleanup_uid,uid);assert.equal(normalized.cleanup_peer,'original-peer');assert.equal(normalized.card_stage,'review');assert.deepEqual(new Set(normalized.used_uids),new Set([...a.used_uids,...b.used_uids]));
 assert.throws(()=>f.draft.resume(f.binding,f.now));assert.throws(()=>f.draft.confirmReview(f.taskRecordSubmission(normalized),'original-peer',34,uid,1,f.now));originalPresent(f,main);originalPresent(f,partial);f.noRemote();
});

function pair(f){const a=f.record('review','正式原文。\n原始运费说明。'),b=f.record('review','候选原文。\n完整尾句🦜。');const main=f.put('main',a),partial=f.put('partial',b);f.cold();return{main,partial,text:b.text};}
function successfulRenamePlan(t){const f=fixture(t);pair(f);f.recovery.restore('partial',sourceHash(f).inspection_sha256);return f.renames.map(({from,to})=>({from:path.basename(from),to:path.basename(to)}));}

test('each transaction rename interruption retains originals and requires explicit cold resume or remains protected',async t=>{
 const plan=successfulRenamePlan(t);assert(plan.some(row=>row.to==='intent.json'));assert(plan.some(row=>row.to==='main.original'));assert(plan.some(row=>row.to==='partial.original'));assert(plan.some(row=>row.to==='done.json'));assert(plan.some(row=>row.to==='active-intent'));
 for(let at=1;at<=plan.length;at++)for(const when of ['before','after'])await t.test(at+' '+plan[at-1].to+' '+when,t=>{
  const f=fixture(t),original=pair(f);f.armRename(at,when);assert.throws(()=>f.recovery.restore('partial',sourceHash(f).inspection_sha256));f.clearFault();
  originalPresent(f,original.main);originalPresent(f,original.partial);f.cold();const view=sourceHash(f);
  if(fs.existsSync(f.active)){assert(f.draft.blocked);assert.throws(()=>f.draft.begin({...f.binding,operation_id:'replacement-operation'},new f.TaskDecisionPlan(),f.now));}
  const before=f.allFiles();f.noRemote();
  if(view.can_resume){f.recovery.restore('resume',view.inspection_sha256);recovered(f,original.text);originalPresent(f,original.main);originalPresent(f,original.partial);
   const completed=f.allFiles();assert.throws(()=>f.recovery.restore('resume',view.inspection_sha256));assert.deepEqual(f.allFiles(),completed);
  }else if(fs.existsSync(f.active)){
   assert.throws(()=>f.recovery.restore('resume',view.inspection_sha256));assert.deepEqual(f.allFiles(),before);assert(f.draft.blocked);
  }else recovered(f,original.text);
  f.noRemote();
 });
});

test('an interrupted local transaction can finish after expiry, closure or new outbox without granting submission',t=>{
 const plan=successfulRenamePlan(t),at=plan.findIndex(row=>row.to==='main.original')+1;assert(at>0);const f=fixture(t),original=pair(f);
 f.armRename(at,'after');assert.throws(()=>f.recovery.restore('partial',sourceHash(f).inspection_sha256));f.clearFault();f.advance(3600000);f.exists(f.binding.operation_id);f.setValid(false);f.cold();
 const view=sourceHash(f);assert.equal(view.can_resume,true);const validations=f.effects.validate;f.recovery.restore('resume',view.inspection_sha256);assert.equal(f.effects.validate,validations,'resume finishes an already authorized local file transaction, not a new answer');
 recovered(f,original.text);originalPresent(f,original.main);originalPresent(f,original.partial);f.noRemote();
});

test('active transaction window blocks a new draft and an old sealed session before enqueue',async t=>{
 const f=fixture(t),old=f.record('sealed','旧确认必须在恢复窗口失效。'),original=f.put('main',old);f.cold();const initial=f.draft.snapshot();assert.equal(initial.stage,'sealed');
 // Interrupt the first durable intent publication, before moving an original.
 f.armRename(1,'after');assert.throws(()=>f.recovery.restore('main',sourceHash(f).inspection_sha256));f.clearFault();assert.equal(fs.existsSync(f.active),true);
 assert.throws(()=>f.draft.begin({...f.binding,operation_id:'new-operation'},new f.TaskDecisionPlan(),f.now));
 const {TaskSuggestionSession}=loadApp('TaskSuggestionSession',{'@kit.CoreFileKit':{fileIo:{accessSync:()=>false}}});
 const session=new TaskSuggestionSession(f.draft,{context:()=>f.binding.context_key,foreground:()=>true,device:()=>'',available:()=>false,
  validate(){assert.fail('protected sealed retry cannot refresh');},async revalidate(){assert.fail('protected sealed retry cannot refresh');},async send(){f.effects.device++;},async wait(){},enqueue(){f.effects.enqueue++;return'awaiting_refresh';}});
 await assert.rejects(Promise.resolve().then(()=>session.submit()));assert.equal(f.effects.enqueue,0);originalPresent(f,original);f.noRemote();
});

test('incomplete active intent and altered archive remain protected and are never guessed or deleted',async t=>{
 for(const change of ['empty_intent','partial_intent','altered_backup'])await t.test(change,t=>{
  const f=fixture(t),original=pair(f);
  if(change==='altered_backup'){
   const plan=successfulRenamePlan(t),at=plan.findIndex(row=>row.to==='main.original')+1;f.armRename(at,'after');assert.throws(()=>f.recovery.restore('partial',sourceHash(f).inspection_sha256));f.clearFault();
   const archive=[...f.allFiles().keys()].find(name=>name.endsWith('/main.original'));assert(archive);fs.appendFileSync(path.join(f.root,archive),'changed');
  }else{fs.mkdirSync(f.active);if(change==='partial_intent')fs.writeFileSync(path.join(f.active,'intent.json.partial'),'incomplete synthetic intent');}
  f.cold();const view=sourceHash(f),before=f.allFiles();assert(f.draft.blocked);assert.throws(()=>f.recovery.restore('resume',view.inspection_sha256));assert.throws(()=>f.recovery.restore('partial',view.inspection_sha256));assert.deepEqual(f.allFiles(),before);
  if(change!=='altered_backup')originalPresent(f,original.main);originalPresent(f,original.partial);f.noRemote();
 });
});

test('oversize originals and unknown recovery evidence reject recovery without automatic pruning',async t=>{
 for(const change of ['source_256k','unknown_case','case_over_1m','directory_over_4m'])await t.test(change,t=>{
  const f=fixture(t);f.put('main',f.record());f.put('partial',f.record('review','尚未选择的完整全文。'));
  if(change==='source_256k'){const raw=fs.readFileSync(f.main);fs.appendFileSync(f.main,' '.repeat(262145-raw.length));}
  else{
   if(!fs.existsSync(f.cases))fs.mkdirSync(f.cases);const directory=path.join(f.cases,change==='unknown_case'?'unknown-owner':'recover-'+'f'.repeat(32));fs.mkdirSync(directory);
   const file=path.join(directory,'unrecognized-evidence'),fd=fs.openSync(file,'w');try{fs.ftruncateSync(fd,change==='directory_over_4m'?4194305:change==='case_over_1m'?1048577:1);}finally{fs.closeSync(fd);}
  }
  f.cold();const view=sourceHash(f),before=manifest(f);assert.throws(()=>f.recovery.restore('partial',view.inspection_sha256));assert.deepEqual(manifest(f),before);f.noRemote();
 });
});

test('four completed recovery cases are retained and a fifth restore is refused without losing any earlier original',t=>{
 const f=fixture(t),originals=[];
 for(let round=0;round<4;round++){
  const value=f.record('review','第'+round+'轮原文与完整条件。'),bytes=f.put('main',value);originals.push(bytes);f.cold();f.recovery.restore('main',sourceHash(f).inspection_sha256);recovered(f,value.text);
 }
 assert.equal(fs.readdirSync(f.cases).length,4);const before=f.allFiles(),view=sourceHash(f);assert.throws(()=>f.recovery.restore('main',view.inspection_sha256));assert.deepEqual(f.allFiles(),before);
 for(const raw of originals)originalPresent(f,raw);f.noRemote();
});

test('merging valid UID history cannot publish an oversized normalized candidate or create an invalid active intent',t=>{
 const f=fixture(t),main=f.record('review','X'),partial=f.record('review','另一份仍有效的全文。');
 partial.used_uids=Array.from({length:8},(_,i)=>(f.binding.operation_id+'-history-'+i+'-').padEnd(128,'x'));
 const fixed=Buffer.byteLength(JSON.stringify(main),'utf8');main.text+='\u0000'.repeat(Math.floor((262144-fixed-64)/6));
 const mainBytes=Buffer.from(JSON.stringify(main),'utf8'),partialBytes=Buffer.from(JSON.stringify(partial),'utf8');
 assert(mainBytes.length<=262144);assert(partialBytes.length<=262144);
 const normalized={...main,used_uids:partial.used_uids,input_source:'phone'};assert(Buffer.byteLength(JSON.stringify(normalized),'utf8')>262144,'the UID union, not either source, exceeds the actual byte limit');
 f.put('main',mainBytes);f.put('partial',partialBytes);f.cold();const view=sourceHash(f),before=f.allFiles();
 assert.equal(view.main.valid,true);assert.equal(view.partial.valid,true);assert.equal(view.main.eligible,false);
 assert.throws(()=>f.recovery.restore('main',view.inspection_sha256));assert.equal(fs.existsSync(f.active),false);assert.equal(fs.existsSync(f.cases),false);
 assert.deepEqual(f.allFiles(),before);assert.equal(f.effects.suspend,0);originalPresent(f,mainBytes);originalPresent(f,partialBytes);f.noRemote();
});

test('a failed UI change notification neither masks a completed local recovery nor replaces its durable result',t=>{
 const f=fixture(t),value=f.record('review','事务完成后的完整文字仍在原任务草稿。'),original=f.put('main',value);f.cold();
 f.ports.changed=()=>{f.effects.changed++;throw Error('synthetic UI callback failure');};
 assert.doesNotThrow(()=>f.recovery.restore('main',sourceHash(f).inspection_sha256));recovered(f,value.text);assert.equal(f.effects.changed,1);originalPresent(f,original);f.noRemote();
});

function recoveryRef(attempt='1'){return {schema:1,attempt_id:'voice-'+attempt.repeat(32),peer:'synthetic-peer',connection_epoch:'synthetic-boot:23',binding_sha256:'a'.repeat(64),text_sha256:attempt==='1'?'b'.repeat(64):'c'.repeat(64)};}
test('new paused-v2 recovery preserves the selected full voice source and never borrows the other attempt or converts it to phone',t=>{
 const f=fixture(t),a=f.record('review','第一轮完整原文。'),b=f.record('sealed','第二轮完整原文，尾句不能丢。');a.voice_source=recoveryRef('1');b.voice_source=recoveryRef('2');
 const main=f.put('main',a),partial=f.put('partial',b);f.cold();f.recovery.restore('partial',sourceHash(f).inspection_sha256);const result=recovered(f,b.text,'review','voice',2,b.voice_source);
 assert.notDeepEqual(result.voice_source,a.voice_source);const directory=path.join(f.cases,fs.readdirSync(f.cases)[0]);assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'active-intent/intent.json'),'utf8')).policy,'paused-v2');
 originalPresent(f,main);originalPresent(f,partial);f.noRemote();
});

test('new recovery leaves legacy phone and voice text legacy instead of silently upgrading their source claims',async t=>{
 for(const source of ['phone','voice'])await t.test(source,t=>{
  const f=fixture(t),value=f.record('sealed','旧版全文仍需明确人工采用。');value.schema=1;value.input_source=source;delete value.voice_source;const original=f.put('main',value);f.cold();
  f.recovery.restore('main',sourceHash(f).inspection_sha256);recovered(f,value.text,'review',source,1);originalPresent(f,original);f.noRemote();
 });
});

function unfinishedV1(f,schema=1){
 const a=f.record('review','旧正式文件。'),b=f.record('sealed','旧候选全文，必须按原事务字节完成。');
 for(const value of [a,b])if(schema===1){value.schema=1;delete value.voice_source;}
 const main=f.put('main',a),partial=f.put('partial',b),id='recover-'+'e'.repeat(32),directory=path.join(f.cases,id);
 const normalized={...b,stage:'review',option_id:null,input_source:'phone'},ready=Buffer.from(JSON.stringify(normalized),'utf8');
 const descriptor=bytes=>({present:true,bytes:bytes.length,sha256:sha(bytes)});
 const intent={schema:1,transaction_id:id,source:'partial',context_sha256:sha(Buffer.from(f.binding.context_key,'utf8')),binding_sha256:sha(Buffer.from(JSON.stringify(b.binding),'utf8')),
  main:descriptor(main),partial:descriptor(partial),normalized_bytes:ready.length,normalized_sha256:sha(ready),policy:'paused-v1'};
 fs.mkdirSync(f.active);fs.mkdirSync(f.cases);fs.mkdirSync(directory);const raw=Buffer.from(JSON.stringify(intent),'utf8');fs.writeFileSync(path.join(f.active,'intent.json'),raw);
 fs.writeFileSync(path.join(directory,'normalized.ready'),ready);fs.renameSync(f.main,path.join(directory,'main.original'));f.cold();return{main,partial,ready,raw,directory,b};
}
test('an existing paused-v1 schema1 transaction resumes its exact old canonical phone bytes without claiming a new source',t=>{
 const f=fixture(t),old=unfinishedV1(f),view=sourceHash(f);assert.equal(view.can_resume,true);f.recovery.restore('resume',view.inspection_sha256);recovered(f,old.b.text,'review','phone',1);
 assert.deepEqual(fs.readFileSync(f.main),old.ready);assert.deepEqual(fs.readFileSync(path.join(old.directory,'active-intent/intent.json')),old.raw);
 assert.equal(JSON.parse(fs.readFileSync(path.join(old.directory,'done.json'),'utf8')).main_sha256,sha(old.ready));originalPresent(f,old.main);originalPresent(f,old.partial);f.noRemote();
});
test('a paused-v1 intent cannot launder a newer schema2 record into an independent phone answer',t=>{
 const f=fixture(t),old=unfinishedV1(f,2),view=sourceHash(f),before=f.allFiles();assert.equal(view.can_resume,false);assert.equal(f.draft.blocked,true);
 assert.throws(()=>f.recovery.restore('resume',view.inspection_sha256));assert.deepEqual(f.allFiles(),before);originalPresent(f,old.main);originalPresent(f,old.partial);f.noRemote();
});


