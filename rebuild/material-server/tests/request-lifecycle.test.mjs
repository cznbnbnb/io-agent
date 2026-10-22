import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../store.mjs';
import {listen} from '../http.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/normal.json',import.meta.url)));
const bodies=Object.fromEntries(fixture.events.map(e=>[e.kind,e.body]));
const lifecycleExamples=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/request-lifecycle.json',import.meta.url)));
const epoch=Date.parse('2026-10-12T10:00:00Z');
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-lifecycle-')),file=path.join(dir,'queue.sqlite');
  let now=epoch,store=new MaterialStore(file,{clock:()=>now});
  const phone=store.mint({owner:'synthetic-owner',producer:'synthetic-phone',scopes:['tasks:write','answers:write','requests:read','tasks:read']});
  const pc=store.mint({owner:'synthetic-owner',producer:'synthetic-pc',scopes:['tasks:read','tasks:update','requests:write']});
  const foreign=store.mint({owner:'synthetic-foreign',producer:'synthetic-pc',scopes:['requests:write']});
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const submit=(kind,body,ttl=3600000)=>{
    const credential=['request','receipt'].includes(kind)||kind==='task'&&body.revision>1?pc:phone;
    const producer=credential===pc?'synthetic-pc':'synthetic-phone';
    const event={schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind,producer_id:producer,
      created_at:new Date(now).toISOString(),expires_at:new Date(now+ttl).toISOString(),body:structuredClone(body)};
    return {event,result:store.queueSubmit(credential.token,event,kind)};
  };
  submit('task',bodies.task);submit('request',bodies.request,60000);
  return {get store(){return store;},dir,file,phone,pc,foreign,submit,setTime:value=>{now=value;},
    command:{schema_version:'1.0',request_revision:1},
    reconcile(){return store.reconcileRequest(pc.token,bodies.request.request_id,this.command);},
    restart(){store.close();store=new MaterialStore(file,{clock:()=>now});}};
}

test('server clock expires one immutable question revision durably with a separate request receipt',t=>{
  const f=setup(t),original=f.store.queueRevision('synthetic-owner','request',bodies.request.request_id,1);
  assert.equal(f.reconcile().changed,false);assert.equal(f.reconcile().item.state,'pending');
  const before=f.store.queueCeiling('synthetic-owner');f.setTime(epoch+60000);
  const closed=f.reconcile();assert.equal(closed.changed,true);assert.equal(closed.reason,'deadline');
  assert.equal(closed.item.state,'expired');assert.equal(closed.item.revision,1);
  assert.equal(closed.item.expires_at,new Date(epoch+60000).toISOString());
  assert.deepEqual(f.store.queueRevision('synthetic-owner','request',bodies.request.request_id,1),original);
  assert.equal(closed.item.receipts.length,1);assert.equal(closed.item.receipts[0].stage,'expired');
  assert.equal(closed.item.receipts[0].subject_kind,'request');assert.equal(closed.item.receipts[0].actor_id,'server-lifecycle');
  assert.equal(f.store.queueCeiling('synthetic-owner'),before+1);
  f.restart();assert.equal(f.reconcile().changed,false);
  assert.equal(f.reconcile().item.receipts.length,1);assert.equal(f.store.queueCeiling('synthetic-owner'),before+1);
  assert.throws(()=>f.submit('answer',bodies.answer),e=>e.code==='REQUEST_CLOSED');
  assert.equal(f.store.queueGet(f.phone.token,'request',bodies.request.request_id).answer,null);
});

test('task closure withdraws only its pending question and does not claim task stopped',t=>{
  for(const state of ['cancel_requested','execution_unknown','failed']){
    const f=setup(t);f.submit('task',{...bodies.task,revision:2,state});
    const result=f.reconcile();assert.equal(result.reason,'task_closed');assert.equal(result.item.state,'withdrawn');
    assert.equal(result.item.receipts[0].stage,'cancelled');assert.equal(result.item.receipts[0].subject_kind,'request');
    const task=f.store.queueGet(f.pc.token,'task',bodies.task.task_id);
    assert.equal(task.state,state);assert.equal(task.receipts.length,0);
    assert.throws(()=>f.submit('answer',bodies.answer),e=>e.code==='REQUEST_CLOSED');
  }
});

test('answer accepted before closure wins and remains available after deadline and task cancellation',t=>{
  const f=setup(t),accepted=f.submit('answer',bodies.answer);
  f.setTime(epoch+70000);f.submit('task',{...bodies.task,revision:2,state:'cancel_requested'});
  const before=f.store.queueCeiling('synthetic-owner'),result=f.reconcile();
  assert.equal(result.changed,false);assert.equal(result.item.state,'answered');
  assert.equal(result.item.answer.object_id,bodies.answer.answer_id);assert.equal(result.item.answer.body.text,bodies.answer.text);
  assert.equal(f.store.queueCeiling('synthetic-owner'),before);assert.equal(result.item.receipts.length,0);
  assert.equal(f.store.queueSubmit(f.phone.token,accepted.event,'answer').status,200);
});

test('scope, owner, version and exact command guards reject without closing a live question',t=>{
  const f=setup(t),before=f.store.queueCeiling('synthetic-owner');
  for(const [token,body,code] of [[f.phone.token,f.command,'FORBIDDEN'],[f.foreign.token,f.command,'REQUEST_NOT_FOUND'],
    [f.pc.token,{...f.command,request_revision:2},'STALE_REQUEST'],[f.pc.token,{...f.command,state:'expired'},'INVALID']]){
    assert.throws(()=>f.store.reconcileRequest(token,bodies.request.request_id,body),e=>e.code===code);
  }
  assert.equal(f.reconcile().item.state,'pending');assert.equal(f.store.queueCeiling('synthetic-owner'),before);
});

test('failed closure receipt persistence rolls back the question head and sequence together',t=>{
  const f=setup(t),before=f.store.queueCeiling('synthetic-owner');f.setTime(epoch+60000);
  f.store.db.exec("CREATE TEMP TRIGGER synthetic_lifecycle_failure BEFORE INSERT ON events WHEN NEW.producer='server-lifecycle' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_RECEIPT_SAVE_FAILURE'); END;");
  assert.throws(()=>f.reconcile(),/SYNTHETIC_RECEIPT_SAVE_FAILURE/);
  const intact=f.store.queueGet(f.pc.token,'request',bodies.request.request_id);
  assert.equal(intact.state,'pending');assert.equal(intact.receipts.length,0);assert.equal(f.store.queueCeiling('synthetic-owner'),before);
  f.store.db.exec('DROP TRIGGER synthetic_lifecycle_failure');assert.equal(f.reconcile().changed,true);
  f.setTime(epoch);f.restart();assert.equal(f.reconcile().item.state,'expired','clock rollback cannot reopen a closed question');
});

test('three independent processes reconcile the same expired question with one closure receipt',async t=>{
  const f=setup(t),before=f.store.queueCeiling('synthetic-owner');f.setTime(epoch+60000);
  const commandFile=path.join(f.dir,'synthetic-command.json');
  fs.writeFileSync(commandFile,JSON.stringify({token:f.pc.token,request_id:bodies.request.request_id,command:f.command,now:epoch+60000}),{mode:0o600});
  const worker=fileURLToPath(new URL('./request-lifecycle-worker.mjs',import.meta.url));
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[worker,f.file,commandFile],{windowsHide:true});let out='';
    child.stdout.on('data',bytes=>out+=bytes);child.on('error',reject);
    child.on('close',code=>{try{assert.equal(code,0);resolve(JSON.parse(out));}catch(error){reject(error);}});
  });
  const results=await Promise.all([run(),run(),run()]);
  assert.equal(results.filter(r=>r.changed).length,1);assert(results.every(r=>r.state==='expired'));
  f.restart();assert.equal(f.reconcile().item.receipts.length,1);assert.equal(f.store.queueCeiling('synthetic-owner'),before+1);
});

test('HTTP lifecycle endpoint is authenticated, bounded and returns original question with server closure facts',async t=>{
  const f=setup(t),server=await listen(f.store);t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/v1/`,url=base+'requests/'+bodies.request.request_id+'/reconcile';
  const call=(token,body,query='')=>fetch(url+query,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert((await fetch(base+'identity',{headers:{Authorization:'Bearer '+f.pc.token}}).then(r=>r.json())).capabilities.includes('request_lifecycle_v1'));
  assert.equal((await call(f.phone.token,f.command)).status,403);assert.equal((await call(f.pc.token,f.command,'?x=1')).status,400);
  f.setTime(epoch+60001);const response=await call(f.pc.token,f.command);assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.item.state,'expired');assert.equal(result.item.body.question,bodies.request.question);
  assert.equal(result.item.body.state,'pending');assert.equal(result.item.answer,null);assert.equal(result.item.receipts[0].subject_revision,1);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await call(f.pc.token,f.command)).status,200);
});

test('shared normal, duplicate, expired and offline lifecycle examples match the actual durable server',t=>{
  assert.equal(lifecycleExamples.question_expires_at,new Date(epoch+60000).toISOString());
  for(const scenario of lifecycleExamples.scenarios){
    const f=setup(t);assert.deepEqual(lifecycleExamples.command,f.command);
    if(scenario.task_state)f.submit('task',{...bodies.task,revision:2,state:scenario.task_state});
    f.setTime(Date.parse(scenario.server_time));if(scenario.restart_before)f.restart();
    for(let index=0;index<scenario.repeat;index++){
      const actual=f.reconcile(),expected=index===0?scenario.response_facts:scenario.retry_facts;
      assert.deepEqual({state:actual.item.state,revision:actual.item.revision,changed:actual.changed,reason:actual.reason,
        receipt_count:actual.item.receipts.length},expected,scenario.case);
      if(actual.item.receipts.length){
        const receipt=actual.item.receipts[0];
        for(const [key,value]of Object.entries(lifecycleExamples.closure_receipt_facts))assert.equal(receipt[key],value,scenario.case);
      }
    }
    if(scenario.late_answer_error)assert.throws(()=>f.submit('answer',bodies.answer),e=>e.code===scenario.late_answer_error);
    if(scenario.task_state_after)assert.equal(f.store.queueGet(f.pc.token,'task',bodies.task.task_id).state,scenario.task_state_after);
  }
});
