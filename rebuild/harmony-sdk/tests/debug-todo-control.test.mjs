import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

const operation='tdel-'+'a'.repeat(32),hash='b'.repeat(64),reference=()=>({id:123,revision:2,peer:'aabbccddeeff',content_sha256:'c'.repeat(64)});
function fixture(){
 const {DebugCardControl,DebugCardState}=loadApp('DebugCardControl');let raw,sequence=0,foreground=true,failSave=false,gate;
 const disk=new Map(),calls=[],view={operation_id:operation,phase:'pending',state_sha256:hash};
 const forbidden=()=>assert.fail('todo must not access task, microphone, card, summary or recovery');
 const ports={command:()=>raw,result:id=>disk.get(id),save(id,text){if(failSave)throw Error('synthetic durable claim failure');disk.set(id,text);},foreground:()=>foreground,status:()=>new DebugCardState(),
  show:forbidden,remove:forbidden,taskStatus:forbidden,voice:forbidden,reviewCard:forbidden,recoveryStatus:forbidden,restoreDraft:forbidden,recordingSummaryStatus:forbidden,
  todoPage(scope,limit,cursor){calls.push(['list',scope,limit,cursor]);return{scope,todos:[],deletions:[]};},
  async todoDelete(op,ref){assert.equal(JSON.parse(disk.get(JSON.parse(raw).id)).state,'running');calls.push(['delete',op,ref]);if(gate)await gate();return view;},
  todoDeleteStatus(op){calls.push(['status',op]);return view;},async todoDeleteCancel(op,sha){calls.push(['cancel',op,sha]);return{...view,phase:'cancelled'};},
  async todoDeleteSend(op,sha){calls.push(['send',op,sha]);if(gate)await gate();return{...view,phase:'submitted'};},
  async todoQuery(){calls.push(['query']);return{phase:'waiting',absence_is_confirmation:false};},todoQueryStatus(){calls.push(['query-status']);return{phase:'idle',absence_is_confirmation:false};}};
 const control=new DebugCardControl(ports);control.enable(true);
 const put=(action,todo,extra={})=>{const now=Date.now(),value={schema:10,id:'dbg-'+(++sequence).toString(16).padStart(32,'0'),action,created_at:new Date(now).toISOString(),expires_at:new Date(now+60000).toISOString(),expected_uid:'',todo,...extra};raw=JSON.stringify(value);return value;};
 return{control,disk,calls,ports,put,result:value=>JSON.parse(disk.get(value.id)),failSave:value=>failSave=value,foreground:value=>foreground=value,effect:fn=>gate=fn,reload:()=>{const c=new DebugCardControl(ports);c.enable(true);return c;}};
}

test('schema10 seven exact actions delegate to existing todo ports with no unrelated effects',async()=>{
 const f=fixture(),selections={'todo-list':{scope:'active',limit:2,cursor:''},'todo-delete':{operation_id:operation,reference:reference(),confirm:true},
  'todo-delete-status':{operation_id:operation},'todo-delete-cancel':{operation_id:operation,state_sha256:hash},'todo-delete-send':{operation_id:operation,state_sha256:hash,confirm:true},'todo-query':{},'todo-query-status':{}};
 for(const [action,todo]of Object.entries(selections)){const command=f.put(action,todo);await f.control.poll();const result=f.result(command);assert.equal(result.state,'complete');assert.equal(result.control_call_completed,true);assert.equal(result.task_snapshot,undefined);assert.equal(result.recording_summary_view,undefined);}
 assert.deepEqual(f.calls,[['list','active',2,''],['delete',operation,reference()],['status',operation],['cancel',operation,hash],['send',operation,hash],['query'],['query-status']]);
});

test('same command replay and cold reconcile preserve prior pending/submitted observation without repeating a delete/send/query',async()=>{
 const f=fixture();for(const [action,todo]of [['todo-delete',{operation_id:operation,reference:reference(),confirm:true}],['todo-delete-send',{operation_id:operation,state_sha256:hash,confirm:true}],['todo-query',{}]]){
  const command=f.put(action,todo);await f.control.poll();const bytes=f.disk.get(command.id),count=f.calls.length;await f.control.poll();await f.reload().poll();assert.equal(f.calls.length,count);assert.equal(f.disk.get(command.id),bytes);
 }
 assert.equal(f.calls.length,3);
});

test('unconfirmed, wrong-schema, arbitrary-wire and malformed todo selectors are rejected before durable claim',async()=>{
 const f=fixture(),valid={operation_id:operation,reference:reference(),confirm:true};
 const cases=[['todo-delete',{...valid,confirm:false}],['todo-delete',{operation_id:operation,reference:reference()}],['todo-delete',{...valid,reference:{...reference(),id:true}}],
  ['todo-delete',{...valid,reference:{...reference(),revision:0}}],['todo-delete',{...valid,reference:{...reference(),peer:'AA:BB:CC:DD:EE:FF'}}],['todo-delete',{...valid,reference:{...reference(),wire:'danger'}}],
  ['todo-delete',{...valid,operation_id:'new-random'}],['todo-delete-send',{operation_id:operation,state_sha256:hash,confirm:1}],['todo-delete-cancel',{operation_id:operation,state_sha256:''}],
  ['todo-list',{scope:'all',limit:10,cursor:''}],['todo-list',{scope:'active',limit:11,cursor:''}],['todo-list',{scope:'deleted',limit:1,cursor:'tcur-'+hash+'-201'}],['todo-list',{scope:'active',limit:1,cursor:'tcur-'+hash+'-01'}],
  ['todo-query',{business:22,payload:'not allowed'}],['todo-query-status',{confirm:true}],['todo-delete-status',{operation_id:operation,state_sha256:hash}]];
 for(const [action,todo]of cases){const command=f.put(action,todo);await f.control.poll();assert.equal(f.disk.has(command.id),false);}
 for(const extra of[{expected_uid:'p10-wrong'},{schema:9},{recording_summary:{}},{annotation:{}},{arbitrary_wire:[]}]){const command=f.put('todo-delete',valid,extra);await f.control.poll();assert.equal(f.disk.has(command.id),false);}
 assert.deepEqual(f.calls,[]);
});

test('safe integer boundaries, purely local references and bounded tcur offsets remain valid',async()=>{
 const f=fixture();for(const ref of[reference(),{...reference(),id:9007199254740991,revision:9007199254740991,peer:''}]){const c=f.put('todo-delete',{operation_id:operation,reference:ref,confirm:true});await f.control.poll();assert.equal(f.result(c).state,'complete');}
 const c=f.put('todo-list',{scope:'deleted',limit:10,cursor:'tcur-'+hash+'-200'});await f.control.poll();assert.equal(f.result(c).state,'complete');
 const bad=f.put('todo-delete',{operation_id:operation,reference:{...reference(),id:9007199254740992},confirm:true});await f.control.poll();assert.equal(f.disk.has(bad.id),false);
});

test('claim failure, release mode, background and expired commands never enter todo mutation ports',async()=>{
 const f=fixture(),todo={operation_id:operation,reference:reference(),confirm:true};f.put('todo-delete',todo);f.failSave(true);await f.control.poll();assert.deepEqual(f.calls,[]);
 f.failSave(false);f.control.enable(false);await f.control.poll();f.control.enable(true);f.foreground(false);await f.control.poll();assert.equal(f.disk.size,0);
 f.foreground(true);const now=Date.now(),expired=f.put('todo-delete',todo,{created_at:new Date(now-120000).toISOString(),expires_at:new Date(now-60000).toISOString()});await f.control.poll();assert.equal(f.result(expired).error,'DEBUG_COMMAND_EXPIRED');assert.deepEqual(f.calls,[]);
});

test('async delete interrupted by dispose remains an ambiguous running claim and cannot be replayed',async()=>{
 const f=fixture(),command=f.put('todo-delete',{operation_id:operation,reference:reference(),confirm:true});let finish;f.effect(()=>new Promise(resolve=>finish=resolve));const pending=f.control.poll();
 while(!finish)await new Promise(setImmediate);await f.reload().poll();assert.equal(f.calls.length,1);f.control.dispose();finish();await pending;assert.equal(f.result(command).state,'running');await f.reload().poll();assert.equal(f.calls.length,1);
});

test('todo errors expose only the closed whitelist and unknown private exception text becomes TODO_FAILED',async()=>{
 const f=fixture();for(const [code,expected]of[['TODO_STALE','TODO_STALE'],['private title /token-secret','TODO_FAILED']]){f.effect(()=>{throw Error(code);});const command=f.put('todo-delete',{operation_id:operation,reference:reference(),confirm:true});await f.control.poll();const result=f.result(command);assert.equal(result.error,expected);assert.equal(result.todo_deletion,undefined);assert.equal(JSON.stringify(result).includes('token-secret'),false);}
});
