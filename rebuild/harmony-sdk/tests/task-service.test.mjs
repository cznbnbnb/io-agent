import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {loadApp} from './load-app.mjs';import {loadCore} from './load-core.mjs';
const turn=()=>new Promise(setImmediate);
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(t){
  const prefix=path.join(os.tmpdir(),'turboio-service-source-'),root=fs.mkdtempSync(prefix).replaceAll('\\','/'),handles=new Map();
  const safe=p=>{assert(path.resolve(p).startsWith(path.resolve(root)+path.sep));return p;};
  const io={OpenMode:{READ_ONLY:fs.constants.O_RDONLY,WRITE_ONLY:fs.constants.O_WRONLY,CREATE:fs.constants.O_CREAT,TRUNC:fs.constants.O_TRUNC},
    accessSync:p=>fs.existsSync(safe(p)),lstatSync:p=>fs.lstatSync(safe(p)),statSync:p=>fs.statSync(safe(p)),readTextSync:p=>fs.readFileSync(safe(p),'utf8'),
    openSync(p,mode){const fd=fs.openSync(safe(p),mode);handles.set(fd,p);return{fd};},closeSync(f){const fd=typeof f==='number'?f:f.fd;assert(handles.has(fd));fs.closeSync(fd);handles.delete(fd);},
    readSync(fd,b,o={}){assert(handles.has(fd));return fs.readSync(fd,new Uint8Array(b),0,Math.min(83,o.length??b.byteLength),null);},
    writeSync(fd,b){assert(handles.has(fd));return fs.writeSync(fd,new Uint8Array(b),0,Math.min(37,b.byteLength),null);},
    fsyncSync:fs.fsyncSync,renameSync:(a,b)=>fs.renameSync(safe(a),safe(b))};
  t.after(()=>{for(const fd of handles.keys())try{fs.closeSync(fd);}catch{}assert(path.resolve(root).startsWith(path.resolve(prefix)));fs.rmSync(root,{recursive:true});});
  const loads=[],configurations=[],instances=[],actions=[],timers=[];let saved,saveError=false,stopRelease,randomBytes,boundState='awaiting_refresh';
  let randomSequence=0;
  class Coordinator{
    constructor(){this.changed=()=>{};this.enabled=false;instances.push(this);}
    setForeground(value){this.foreground=value;}
    async configure(value){this.enabled=!!value?.enabled;configurations.push(value?JSON.parse(JSON.stringify(value)):undefined);}
    async stop(){this.enabled=false;return new Promise(r=>stopRelease=r);}
    summary(){return{enabled:this.enabled,configuring:false,contextKey:'original-context'};}defaultRoute(){return{};}sends(){return[];}objects(){return[];}
    delegate(...args){actions.push(args);}async tick(){actions.push('tick');}
    bindReply(key,operation,id,revision){actions.push(['bind',key,operation,id,revision]);return{schema:1,context_key:key,operation_id:operation,request_id:id,request_revision:revision,task_id:'original-task',
      route:{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'existing'},expires_at:new Date(Date.now()+60000).toISOString(),question:'是否采用当前方案？',mode:'free_text',options:[]};}
    answerBound(...args){actions.push(['answer',...args]);return boundState;}
  }
  class Vault{
    async load(){return new Promise((resolve,reject)=>loads.push({resolve,reject}));}
    async save(value){if(saveError)throw Error('synthetic asset unavailable');saved=JSON.parse(JSON.stringify(value));}
  }
  const {TaskService}=loadApp('TaskService',{
    './TaskCoordinator':{TaskCoordinator:Coordinator,TaskSummary:class{},TaskSendView:class{}},
    './TaskSettings':{SecureTaskSettings:Vault,validateTaskSettings(){}},
    '@kit.CoreFileKit':{fileIo:io},
    '@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:()=>({data:randomBytes=Uint8Array.from({length:16},(_,i)=>(i+(randomSequence++))&255)})}),
      createMd:()=>{const hash=createHash('sha256');return{updateSync:b=>hash.update(b.data),digestSync:()=>({data:Uint8Array.from(hash.digest())})};}}}
  },{setTimeout:(fn,delay)=>{const timer={id:timers.length+1,fn,delay,cancelled:false};timers.push(timer);return timer.id;},clearTimeout:id=>{const timer=timers.find(v=>v.id===id);if(timer)timer.cancelled=true;}});
  const service=new TaskService();service.initialize(root);service.voiceSources.connection=()=>({peer:'synthetic-peer',epoch:7});
  const config={schema:1,enabled:true,target:{baseUrl:'https://synthetic.invalid/v1',token:'a'.repeat(43),principal:{ownerId:'owner',producerId:'phone',serverId:'server'}},route:{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'existing'}};
  const register=(binding,text)=>service.voiceSources.register(binding,'voice-'+'a'.repeat(32),'synthetic-peer',7,text);
  return{service,root,config,loads,configurations,instances,actions,timers,register,getSaved:()=>saved,getRandom:()=>randomBytes,setBoundState:v=>boundState=v,setSaveError:()=>saveError=true,releaseStop:()=>stopRelease()};
}
test('late vault reload cannot override a newer explicit task configuration',async t=>{
  const f=fixture(t);const reload=f.service.reload();await turn();assert.equal(f.loads.length,1);
  assert.equal(f.service.summary().configuring,true);assert.throws(()=>f.service.delegate('old','not submitted',60000),/TASK_SETTINGS_BUSY/);
  const replacement={...f.config,route:{...f.config.route,session_id:'replacement'}};await f.service.save(replacement);
  f.loads[0].resolve(f.config);await reload;assert.equal(f.getSaved().route.session_id,'replacement');
  assert.equal(f.configurations.at(-1).route.session_id,'replacement');assert.equal(f.service.summary().configuring,false);
});
test('locked settings pause tasks without overwriting credentials and recover after unlock',async t=>{
  const f=fixture(t);await f.service.save(f.config);const reload=f.service.reload();await turn();f.loads[0].reject(Error('locked'));await reload;
  assert.equal(f.service.summary().enabled,false);assert.match(f.service.settingsNote,/未覆盖/);assert.equal(f.getSaved().target.token,f.config.target.token);
  const retry=f.service.reload();await turn();f.loads[1].resolve(f.config);await retry;assert.equal(f.service.summary().enabled,true);assert.equal(f.service.settingsNote,'');
});
test('foreground unavailable settings recover on a bounded timer without saving credentials or resuming a decision',async t=>{
  const f=fixture(t);let pauses=0;f.service.onReplyPause=()=>pauses++;
  f.service.setForeground(true);await turn();f.loads[0].reject(Error('TASK_SETTINGS_UNAVAILABLE'));await turn();
  assert.equal(f.service.summary().enabled,false);assert.equal(f.service.summary().configuring,false);assert.equal(f.timers.length,1);assert.equal(f.timers[0].delay,1000);
  f.timers[0].fn();await turn();assert.equal(f.loads.length,2);f.loads[1].resolve(f.config);await turn();
  assert.equal(f.service.summary().enabled,true);assert.equal(f.service.settingsNote,'');assert.equal(f.getSaved(),undefined);assert.equal(f.actions.length,0);assert.equal(f.service.decisionDraft.paused,true);assert(pauses>=2);
});
test('invalid settings and configuration failures are not treated as unlock retries',async t=>{
  for(const message of ['TASK_SETTINGS_INVALID','TASK_ROUTE_INVALID','synthetic configuration failure']){
    const f=fixture(t);f.service.setForeground(true);await turn();f.loads[0].reject(Error(message));await turn();
    assert.equal(f.timers.length,0);assert.equal(f.service.summary().enabled,false);assert.match(f.service.settingsNote,/加载失败/);assert.doesNotMatch(f.service.settingsNote,/解锁/);assert.equal(f.getSaved(),undefined);
  }
});
test('unavailable settings have five retries and a new foreground explicitly renews the budget',async t=>{
  const f=fixture(t);f.service.setForeground(true);await turn();
  for(let i=0;i<6;i++){
    f.loads[i].reject(Error('TASK_SETTINGS_UNAVAILABLE'));await turn();
    if(i<5){assert.equal(f.timers.length,i+1);f.timers[i].fn();await turn();}
  }
  assert.equal(f.loads.length,6);assert.deepEqual(f.timers.map(v=>v.delay),[1000,3000,10000,30000,30000]);assert.equal(f.actions.length,0);
  f.service.setForeground(true);await turn();f.loads[6].reject(Error('TASK_SETTINGS_UNAVAILABLE'));await turn();assert.equal(f.timers.at(-1).delay,1000);
  f.service.setForeground(false);
});
test('background and explicit save invalidate queued callbacks without consuming a newer timer or profile',async t=>{
  const f=fixture(t);f.service.setForeground(true);await turn();f.loads[0].reject(Error('TASK_SETTINGS_UNAVAILABLE'));await turn();const old=f.timers[0];
  f.service.setForeground(false);assert.equal(old.cancelled,true);old.fn();await turn();assert.equal(f.loads.length,1);
  f.service.setForeground(true);await turn();f.loads[1].reject(Error('TASK_SETTINGS_UNAVAILABLE'));await turn();const current=f.timers[1];
  old.fn();assert.equal(current.cancelled,false);assert.equal(f.loads.length,2);
  await f.service.save({...f.config,enabled:false});assert.equal(current.cancelled,true);current.fn();await turn();
  assert.equal(f.loads.length,2);assert.equal(f.service.summary().enabled,false);assert.equal(f.getSaved().enabled,false);assert.equal(f.actions.length,0);
});
test('background invalidates a late vault result and a pending coordinator drain before it reads credentials',async t=>{
  const f=fixture(t);f.service.setForeground(true);await turn();f.service.setForeground(false);f.loads[0].resolve(f.config);await turn();
  assert.equal(f.service.summary().enabled,false);assert.equal(f.service.summary().configuring,false);assert.equal(f.timers.length,0);
  let release;f.instances[0].configure=()=>new Promise(r=>release=r);
  f.service.setForeground(true);await turn();f.service.setForeground(false);release();await turn();assert.equal(f.loads.length,1);
});
test('dispose cancels retry authority even when an old callback runs after another runtime initializes',async t=>{
  const f=fixture(t);f.service.setForeground(true);await turn();f.loads[0].reject(Error('TASK_SETTINGS_UNAVAILABLE'));await turn();const timer=f.timers[0];
  const disposal=f.service.dispose();f.service.initialize(f.root);timer.fn();await turn();assert.equal(f.loads.length,1);assert.equal(f.instances[1].enabled,false);assert.equal(timer.cancelled,true);
  f.releaseStop();await disposal;
});
test('failed settings save stays paused and blocks concurrent actions and saves',async t=>{
  const f=fixture(t);await f.service.save(f.config);f.setSaveError();const saving=f.service.save({...f.config,target:{...f.config.target,token:'b'.repeat(43)}});
  assert.throws(()=>f.service.delegate('old','not submitted',60000),/TASK_SETTINGS_BUSY/);
  await assert.rejects(f.service.save(f.config),/TASK_SETTINGS_BUSY/);await assert.rejects(saving,/TASK_SETTINGS_SAVE_FAILED/);
  assert.equal(f.service.summary().enabled,false);assert.equal(f.getSaved().target.token,f.config.target.token);assert.equal(f.actions.length,0);
});
test('new runtime drains the old writer before loading configuration; cancelled reload cannot reenable it',async t=>{
  const f=fixture(t);const oldReload=f.service.reload();await turn();const disposal=f.service.dispose();f.service.initialize(f.root);
  const reload=f.service.reload();await turn();assert.equal(f.instances.length,2);assert.equal(f.loads.length,1);
  f.loads[0].resolve(f.config);await oldReload;assert.equal(f.instances[0].enabled,false);assert.equal(f.instances[1].enabled,false);
  f.releaseStop();await disposal;await turn();assert.equal(f.loads.length,2);f.loads[1].resolve(f.config);await reload;
  assert.equal(f.instances[0].enabled,false);assert.equal(f.instances[1].enabled,true);assert.equal(f.service.summary().configuring,false);
});
test('task UI operation uses the platform random source and clears its temporary bytes',async t=>{
  const f=fixture(t);await f.service.save(f.config);f.service.delegate('context','synthetic',60000);
  assert.equal(f.actions[0][0],'context');assert.match(f.actions[0][1],/^tap-[a-f0-9]{32}$/);assert(f.getRandom().every(b=>b===0));
});
test('reply binding allocates its operation once; saving and retrying preserve it without another random allocation',async t=>{
  const f=fixture(t);await f.service.save(f.config);const binding=f.service.bindReply('original-context','original-question',3);
  assert.match(binding.operation_id,/^tap-[a-f0-9]{32}$/);const bytes=f.getRandom();assert(bytes.every(b=>b===0));
  const ref=f.register(binding,'保留全部条件');
  assert.equal(f.service.answerBound(binding,null,'保留全部条件','voice',2,ref),'awaiting_refresh');
  f.setBoundState('server_stored');assert.equal(f.service.answerBound(binding,null,'保留全部条件','voice',2,ref),'server_stored');
  assert.equal(f.getRandom(),bytes);assert.equal(f.actions.filter(a=>a[0]==='bind').length,1);
  for(const a of f.actions.filter(a=>a[0]==='answer')){assert.deepEqual(clone(a[1]),clone(binding));assert.notEqual(a[1],binding);assert.equal(a[3],'保留全部条件');assert.equal(a[4],'voice');}
});
test('a sealed local decision cannot be queued with different content, source or original binding',async t=>{
  const f=fixture(t);await f.service.save(f.config);const binding={...f.service.bindReply('original-context','original-question',3),task_id:'original-task',route:f.config.route,expires_at:new Date(Date.now()+60000).toISOString()};
  const ref=f.register(binding,'用新价格，但运费沿用上次'),queued=[];f.service.decisionDraft={snapshot:()=>({schema:2,stage:'sealed',binding,option_id:null,text:'用新价格，但运费沿用上次',input_source:'voice',voice_source:ref}),queued:id=>queued.push(id)};
  for(const args of [[binding,null,'删去运费','voice'],[binding,null,'用新价格，但运费沿用上次','phone'],[{...binding,context_key:'other'},null,'用新价格，但运费沿用上次','voice']])assert.throws(()=>f.service.answerBound(...args),/OPERATION_CONFLICT|TASK_VOICE_SOURCE_/);
  assert.equal(f.actions.filter(a=>a[0]==='answer').length,0);assert.equal(queued.length,0);
  f.setBoundState('rejected');f.service.answerBound(binding,null,'用新价格，但运费沿用上次','voice',2,ref);assert.equal(queued.length,0);
  f.setBoundState('awaiting_refresh');f.service.answerBound(binding,null,'用新价格，但运费沿用上次','voice',2,ref);assert.deepEqual(queued,[binding.operation_id]);
});

test('central voice entry refuses missing, cold or tainted provenance before enqueue; new phone text remains independent',async t=>{
  const f=fixture(t);await f.service.save(f.config);const binding=f.service.bindReply('original-context','original-question',3),text='全文保留，不能仅靠voice标签发送';
  assert.throws(()=>f.service.answerBound(binding,null,text,'voice'),/TASK_VOICE_SOURCE_/);assert.equal(f.actions.filter(a=>a[0]==='answer').length,0);
  const ref=f.register(binding,text);f.service.voiceSources.disconnected();
  assert.throws(()=>f.service.answerBound(binding,null,text,'voice',2,ref),/TASK_VOICE_SOURCE_/);assert.equal(f.actions.filter(a=>a[0]==='answer').length,0);
  f.service.voiceSources.blocked=true;assert.equal(f.service.answerBound(binding,null,'用户明确输入的新手机文字','phone'),'awaiting_refresh');
  assert.equal(f.actions.filter(a=>a[0]==='answer').length,1);
  assert.throws(()=>f.service.answerBound(binding,null,text,'phone',1,null),/TASK_VOICE_SOURCE_/,'legacy records require explicit adoption before a new send');
});

test('source invalidated synchronously by a receipt notification cannot enter the outbox',async t=>{
  const f=fixture(t);await f.service.save(f.config);const binding=f.service.bindReply('original-context','original-question',3),text='转存后的完整文字';
  const ref=f.register(binding,text),{businessEnvelope}=loadCore('./BusinessCommands');let invalidated=false;
  f.service.onReplyState=()=>{if(!invalidated){invalidated=true;f.service.voiceSources.observe('synthetic-peer',7,13,businessEnvelope(3,Uint8Array.of(1,2,3)));}};
  assert.throws(()=>f.service.answerBound(binding,null,text,'voice',2,ref),/TASK_VOICE_SOURCE_/);
  assert.equal(invalidated,true);assert.equal(f.actions.filter(a=>a[0]==='answer').length,0);
});

test('service freezes caller binding and ref before source callbacks and forwards POST guards with current context',async t=>{
  const f=fixture(t);await f.service.save(f.config);const binding=f.service.bindReply('original-context','original-question',3),text='完整原条件',ref=f.register(binding,text),original=clone(binding),frozenRef=clone(ref);
  f.service.onReplyState=()=>{binding.operation_id='caller-replaced-operation';binding.route.session_id='foreign-session';ref.text_sha256='0'.repeat(64);};
  assert.equal(f.service.answerBound(binding,null,text,'voice',2,ref),'awaiting_refresh');const sent=f.actions.find(a=>a[0]==='answer');assert.deepEqual(clone(sent[1]),original);
  assert.equal(sent[4],'voice');assert.notDeepEqual(ref,frozenRef);
  const event={body:{input_source:'voice'}},calls=[];f.service.voiceSources.beforeSend=(...args)=>calls.push(args);
  f.instances[0].beforeAnswerSend(original.operation_id,event);assert.deepEqual(calls,[[original.operation_id,event,'original-context']]);
});
