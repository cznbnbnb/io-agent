import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {NativeRuntimeAdapter} from '../hosts/native-runtime.mjs';
import {runtimeDigest,runtimeSource,runtimeEventBatch} from '../runtime-events.mjs';

const states=events=>events.flatMap(e=>e.actions).filter(a=>a.action==='task_state');
const lastState=events=>states(events).at(-1);
const delivery=item=>`item:task:${item.object_id}:${item.revision}`;
const clone=v=>structuredClone(v);

function fixture(t,{count=1}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-runtime-')),stateFile=path.join(directory,'runtime.json');
  let now=Date.parse('2026-10-25T12:00:00.000Z');
  const bindings=[],instances=[];
  const journal=()=>JSON.parse(fs.readFileSync(stateFile,'utf8')).native_runtime;
  for(let i=0;i<count;i++){
    const binding={server_id:'synthetic-native-server',owner_id:'synthetic-owner',host_kind:i%2?'claude':'codex',workspace:directory,
      route:{computer_id:'synthetic-computer',agent_id:`synthetic-agent-${i}`,project_id:`synthetic-project-${i}`,session_id:randomUUID()}};
    const controlStateFile=path.join(directory,`control-${i}.json`),calls=[],turns=new Map();
    const host={conversationId:binding.route.session_id,capabilities:{atomic_idle_start:true,exact_turn_interrupt:true,final_result_evidence:true},busy:false,offline:false,proof:null,
      async status(){calls.push({kind:'status'});if(this.offline)throw{code:'SYNTHETIC_OFFLINE'};return{conversationId:this.conversationId,workspace:binding.workspace,busy:this.busy};},
      async start(args){
        const saved=JSON.parse(fs.readFileSync(controlStateFile,'utf8')).native_control;
        const c=Object.values(saved.commands).find(c=>c.client_user_message_id===args.clientUserMessageId);
        assert.equal(c?.phase,'sending','native input follows durable controller intent');
        assert(Object.values(journal().operations).some(op=>op.admitted&&op.commands[c.command_id]),'native input follows durable runtime admission');
        calls.push({kind:'start',...args});
        turns.set(args.clientUserMessageId,{found:true,turnId:`synthetic-turn-${randomUUID()}`,status:'inProgress'});
        return{accepted:true,clientUserMessageId:args.clientUserMessageId};
      },
      async inspectOperation(id){calls.push({kind:'inspect',id});return clone(turns.get(id)??{found:false,outcomeUnknown:true});},
      async interrupt(turnId){
        const saved=JSON.parse(fs.readFileSync(controlStateFile,'utf8')).native_control;
        const c=Object.values(saved.commands).find(c=>c.turn_id===turnId);
        assert.equal(c?.phase,'stop_requested');
        assert.equal(journal().controls[c.stop_control_id]?.phase,'processing','control intake precedes native interrupt');
        calls.push({kind:'interrupt',turnId});return{requested:true,expectedTurnId:turnId};
      },
      async inspectStop(turnId){calls.push({kind:'stop-proof',turnId});return clone(this.proof);},
      async close(){calls.push({kind:'close'});}
    };
    bindings.push({binding,host,controlStateFile,calls,turns});
  }
  const f={directory,stateFile,bindings,journal,clock:()=>now,setTime:v=>{now=v;},advance:ms=>{now+=ms;},
    async open(){const a=new NativeRuntimeAdapter({stateFile,bindings,clock:()=>now});instances.push(a);await a.start();return a;},
    item(index=0,patch={}){
      const task_id='synthetic-'+randomUUID(),expires_at=new Date(now+60000).toISOString();
      return{kind:'task',object_id:task_id,revision:1,event_id:randomUUID(),state:'queued',expires_at,command_expires_at:expires_at,
        body:{task_id,state:'queued',route:clone(bindings[index].binding.route),command:'Synthetic task only',allow_create_session:false},...patch};
    },
    control(item,x,{kind='stop',text='Synthetic continuation',revision=2,expires_at=new Date(now+30000).toISOString(),...patch}={}){
      const c={control_id:randomUUID(),kind,expected_command_id:x.command_id,expected_turn_id:x.turn_id,expires_at,...(kind==='resume'?{text}:{}),...patch};
      const state=kind==='stop'?'stop_requested':'resume_requested';
      return{...clone(item),revision,event_id:randomUUID(),state,body:{...clone(item.body),state,execution:clone(x),control:c}};
    },
    starts:i=>bindings[i??0].calls.filter(c=>c.kind==='start'),interrupts:i=>bindings[i??0].calls.filter(c=>c.kind==='interrupt'),
    turn:i=>[...bindings[i??0].turns.values()].at(-1)
  };
  t.after(async()=>{for(const a of instances)await a.stop();fs.rmSync(directory,{recursive:true,force:true});});return f;
}
async function accept(a,item){assert.deepEqual(await a.onItem(item,{delivery_id:delivery(item)}),[]);}
async function drain(a){const events=await a.pollEvents();await a.acknowledgeEvents(events.map(e=>e.event_id));return events;}
async function running(f,a,item=f.item()){
  await accept(a,item);await drain(a);const events=await drain(a);const x=lastState(events)?.execution;
  assert.equal(x?.phase,'running');return{item,x,turn:f.turn()};
}
async function stopped(f,a,active){
  const request=f.control(active.item,active.x);await accept(a,request);await drain(a);
  active.turn.status='interrupted';f.bindings[0].host.proof={conversationId:f.bindings[0].host.conversationId,turnId:active.turn.turnId,terminal:true,descendantsStopped:true};
  const events=await drain(a);assert.equal(lastState(events).state,'stopped');return{...active,x:lastState(events).execution};
}

test('durable admission is exact, read-only, restartable, and creates no native input during intake',async t=>{
  const f=fixture(t);let a=await f.open();const item=f.item(),source=runtimeSource(item),op='op-'+runtimeDigest(item.object_id);
  assert.equal(a.capabilities.can_execute,true);assert.equal(a.capabilities.async_events,true);assert.equal(a.capabilities.admission_probe_v1,true);
  assert.equal(a.capabilities.control_intake_probe_v1,true);assert.equal(a.capabilities.task_session_control_v1,true);assert.equal(a.capabilities.native_queue_expiry,false);
  await accept(a,item);await accept(a,item);assert.deepEqual(f.bindings[0].calls,[]);
  const expected={status:'admitted',delivery_id:delivery(item),operation_id:op,admitted_event_id:'rt-'+runtimeDigest([op,'admitted']),
    source:Object.fromEntries(['kind','object_id','revision','body','expires_at','command_expires_at'].map(k=>[k,source[k]]))};
  assert.deepEqual(await a.inspectAdmission({delivery_id:delivery(item),source}),expected);
  await a.stop();a=await f.open();assert.deepEqual(await a.inspectAdmission({delivery_id:delivery(item),source}),expected);assert.deepEqual(f.bindings[0].calls,[]);
  for(const args of [{delivery_id:'wrong',source},{delivery_id:delivery(item),source:{...source,event_id:randomUUID()}},{delivery_id:delivery(item),source:{...source,state:'running'}}])
    assert.deepEqual(await a.inspectAdmission(args),{status:'not_proven'});
  const events=await a.pollEvents();assert.equal(events[0].event_id,expected.admitted_event_id);assert.equal(f.starts().length,1);
  assert.equal(fs.statSync(f.stateFile).mode&0o777,0o600);
});

test('event bytes survive lost acknowledgements and restart; ack batches validate before mutation',async t=>{
  const f=fixture(t);let a=await f.open();const item=f.item();await accept(a,item);const first=await a.pollEvents();
  await assert.rejects(a.acknowledgeEvents([first[0].event_id,'unknown']),{code:'NATIVE_RUNTIME_EVENT_ACK_INVALID'});
  assert.equal(f.journal().events[first[0].event_id].acked,false);
  await a.stop();a=await f.open();const replay=await a.pollEvents();assert.deepEqual(replay.slice(0,first.length),first);assert.equal(f.starts().length,1);
  await a.acknowledgeEvents(replay.map(e=>e.event_id));await a.acknowledgeEvents(replay.map(e=>e.event_id));assert.deepEqual(await a.pollEvents(),[]);
  await a.stop();assert(!f.bindings[0].calls.some(c=>c.kind==='close'),'injected host stays caller-owned');
});

test('exact route, source and delivery validation prevent rerouting, duplicate commands or silent changes',async t=>{
  const f=fixture(t),a=await f.open(),item=f.item();assert(a.acceptsRoute(item.body.route));assert(!a.acceptsRoute({...item.body.route,session_id:randomUUID()}));
  assert(!a.acceptsRoute({...item.body.route,extra:true}));await accept(a,item);
  await assert.rejects(a.onItem(item,{delivery_id:'wrong'}),{code:'NATIVE_RUNTIME_DELIVERY_INVALID'});
  await assert.rejects(accept(a,{...item,body:{...item.body,route:{...item.body.route,session_id:randomUUID()}}}),{code:'NATIVE_RUNTIME_SOURCE_INVALID'});
  await assert.rejects(accept(a,{...item,body:{...item.body,command:'changed'}}),{code:'NATIVE_RUNTIME_OPERATION_CONFLICT'});
  await assert.rejects(accept(a,{...item,event_id:randomUUID()}),{code:'NATIVE_RUNTIME_SOURCE_CONFLICT'});
  await assert.rejects(accept(a,{...item,state:'running'}),{code:'NATIVE_RUNTIME_SOURCE_INVALID'});
  assert.equal(f.journal().order.length,1);assert.deepEqual(f.bindings[0].calls,[]);
  await a.pollEvents();assert.equal(f.starts().length,1);assert.equal(f.starts()[0].text,item.body.command);
});

test('old nonqueued revisions are never admitted or replayed; messages never become prompts',async t=>{
  const f=fixture(t),a=await f.open(),item=f.item();item.revision=4;item.state='running';item.body.state='running';
  await accept(a,item);assert.deepEqual(await a.inspectAdmission({delivery_id:delivery(item),source:runtimeSource(item)}),{status:'not_proven'});
  assert.deepEqual(await a.onItem({kind:'message',body:{text:'do not execute'}},{delivery_id:'message:1'}),[]);
  assert.deepEqual(await a.pollEvents(),[]);assert.deepEqual(f.bindings[0].calls,[]);
});

test('busy sessions queue without repeat input and independent offline bindings do not block peers',async t=>{
  const f=fixture(t,{count:2}),a=await f.open();f.bindings[0].host.offline=true;
  const first=f.item(0),second=f.item(1);await accept(a,first);await accept(a,second);await drain(a);
  assert.equal(f.starts(0).length,0);assert.equal(f.starts(1).length,1);assert.equal(f.starts(1)[0].text,second.body.command);
  f.bindings[0].host.offline=false;f.bindings[0].host.busy=true;await drain(a);await drain(a);assert.equal(f.starts(0).length,0);
  f.bindings[0].host.busy=false;await drain(a);await drain(a);assert.equal(f.starts(0).length,1);assert.equal(f.starts(1).length,1);
});

test('native queue capability accepts busy once; expiry cannot claim a native queued input was cancelled',async t=>{
  const f=fixture(t);let a=await f.open();const host=f.bindings[0].host;host.busy=true;host.capabilities.atomic_queue_append=true;host.capabilities.atomic_idle_start=false;
  const item=f.item();await accept(a,item);await drain(a);f.bindings[0].turns.set(f.starts()[0].clientUserMessageId,{found:true,status:'queued',turnId:null});await drain(a);
  await a.stop();f.advance(61000);a=await f.open();await drain(a);assert.equal(f.starts().length,1);
  const c=JSON.parse(fs.readFileSync(f.bindings[0].controlStateFile,'utf8')).native_control;assert.equal(c.commands[c.order[0]].phase,'accepted');
});

test('unknown start receipt is reconciled after restart, never retried or followed by a second prompt',async t=>{
  const f=fixture(t);let a=await f.open();const host=f.bindings[0].host,original=host.start;
  host.start=async function(args){await original.call(this,args);throw{code:'SYNTHETIC_LOST_REPLY'};};
  const first=f.item(),second=f.item();await accept(a,first);await accept(a,second);const events=await drain(a);assert.equal(lastState(events).state,'execution_unknown');
  const known=[...f.bindings[0].turns.entries()][0];f.bindings[0].turns.clear();await a.stop();a=await f.open();await drain(a);await drain(a);assert.equal(f.starts().length,1);
  f.bindings[0].turns.set(...known);const recovered=await drain(a);assert.equal(lastState(recovered).state,'running');assert.equal(f.starts().length,1);
});

test('completed output waits for explicit final evidence; complete text and terminal state share one event',async t=>{
  const f=fixture(t);let a=await f.open();const active=await running(f,a);await accept(a,f.item());active.turn.status='completed';active.turn.result={type:'text',text:'partial'};
  let events=await drain(a);assert.equal(lastState(events).execution.phase,'result_pending');assert(!events.flatMap(e=>e.actions).some(a=>a.action==='message'));
  await a.stop();a=await f.open();await drain(a);assert.equal(f.starts().length,1);
  active.turn.resultComplete=true;active.turn.result={type:'text',text:'Complete synthetic result'};events=await drain(a);
  const done=events.find(e=>e.actions.some(a=>a.state==='completed'));assert(done);assert.deepEqual(done.actions[0],{action:'message',channel:'result',message_id:done.actions[0].message_id,text:'Complete synthetic result'});
  assert.equal(done.actions.at(-1).stage,'task_completed');assert.equal(done.delivery_id,delivery(active.item));assert.equal(f.starts().length,1);
  await drain(a);assert.equal(f.starts().length,2);
});

test('large and empty explicitly final outputs stay within Bridge action bounds and preserve Unicode',async t=>{
  for(const [name,text]of [['empty',''],['large Unicode','x'.repeat(65535)+'😀'+'z'.repeat(900000)],['1 MiB JSON escapes','\u0000'.repeat(1024*1024)]])await t.test(name,async t=>{
    const f=fixture(t),a=await f.open(),active=await running(f,a);active.turn.status='completed';active.turn.resultComplete=true;active.turn.result={type:'text',text};
    const events=await drain(a),done=events.find(e=>e.actions.some(a=>a.state==='completed'));runtimeEventBatch([done]);
    const messages=done.actions.filter(a=>a.action==='message');assert.equal(messages.map(m=>m.text).join(''),text);assert(messages.every(m=>m.text.length<=65536));assert(done.actions.length<=64);
    assert(messages.every(m=>Buffer.byteLength(JSON.stringify(m.text))<=240*1024));
    assert(messages.every(m=>!/[\uD800-\uDBFF]$/.test(m.text)));
  });
});

test('expired unsent tasks close without host calls',async t=>{
  const f=fixture(t),a=await f.open(),item=f.item();await accept(a,item);f.advance(60001);const events=await drain(a);
  assert.equal(lastState(events).state,'expired');assert.deepEqual(f.bindings[0].calls,[]);
});

test('control intake proof covers the exact delivery and full source and is read-only across restart',async t=>{
  const f=fixture(t);let a=await f.open();const active=await running(f,a),item=f.control(active.item,active.x),source=runtimeSource(item);
  assert.deepEqual(await a.inspectControlIntake({delivery_id:delivery(item),source}),{status:'not_proven'});
  await accept(a,item);assert.equal(f.interrupts().length,0);const calls=f.bindings[0].calls.length;
  const expected={status:'accepted',delivery_id:delivery(item),source,control_id:item.body.control.control_id};
  assert.deepEqual(await a.inspectControlIntake({delivery_id:delivery(item),source}),expected);await a.stop();a=await f.open();
  assert.deepEqual(await a.inspectControlIntake({delivery_id:delivery(item),source}),expected);assert.equal(f.bindings[0].calls.length,calls);
  for(const change of [{event_id:randomUUID()},{revision:99},{state:'running'}])assert.deepEqual(await a.inspectControlIntake({delivery_id:delivery(item),source:{...source,...change}}),{status:'not_proven'});
  assert.deepEqual(await a.inspectControlIntake({delivery_id:'wrong',source}),{status:'not_proven'});
  await drain(a);assert.equal(f.interrupts().length,1);
});

test('stop receipt is not descendant-stop proof, unknown stop survives restart without reinterrupt',async t=>{
  const f=fixture(t);let a=await f.open();const active=await running(f,a),item=f.control(active.item,active.x);
  await accept(a,item);const interrupted=await drain(a);assert.equal(lastState(interrupted).state,'stop_requested');assert.equal(f.interrupts().length,1);
  active.turn.status='interrupted';let events=await drain(a);assert.equal(lastState(events).state,'stop_unconfirmed');
  const illegal=f.control(active.item,lastState(events).execution,{kind:'resume',revision:3});await assert.rejects(accept(a,illegal),{code:'NATIVE_RUNTIME_CONTROL_INVALID'});
  await a.stop();a=await f.open();await accept(a,item);await drain(a);assert.equal(f.interrupts().length,1);assert.equal(f.starts().length,1);
  f.bindings[0].host.proof={conversationId:f.bindings[0].host.conversationId,turnId:active.turn.turnId,terminal:true,descendantsStopped:true};events=await drain(a);assert.equal(lastState(events).state,'stopped');
});

test('a proved stop permits a new same-task command and publishes resume admission before its native turn',async t=>{
  const f=fixture(t),a=await f.open(),active=await stopped(f,a,await running(f,a));
  const item=f.control(active.item,active.x,{kind:'resume',revision:4,text:'Continue the same synthetic task'});await accept(a,item);assert.equal(f.starts().length,1);
  const events=await drain(a),all=states(events);assert.equal(all[0].state,'agent_received');assert.equal(all[0].execution.command_id,item.body.control.control_id);assert.equal(all[0].execution.turn_id,null);
  assert.equal(f.starts().length,2);assert.equal(f.starts()[1].text,item.body.control.text);assert(events.every(e=>e.delivery_id===delivery(active.item)));
  await accept(a,item);const next=await drain(a);assert.equal(lastState(next).state,'running');assert.equal(lastState(next).execution.command_id,item.body.control.control_id);assert.equal(f.starts().length,2);
});

test('expired stop restores running with a stable correction event even when native projection did not change',async t=>{
  const f=fixture(t);let a=await f.open();const active=await running(f,a),item=f.control(active.item,active.x,{expires_at:new Date(f.clock()-1).toISOString()});
  await accept(a,item);const events=await a.pollEvents(),correction=events.find(e=>e.actions.some(a=>a.state==='running'));
  assert(correction);assert.equal(correction.event_id,'rt-'+runtimeDigest(['op-'+runtimeDigest(active.item.object_id),['control-rejected',item.body.control.control_id]]));assert.equal(f.interrupts().length,0);
  await a.stop();a=await f.open();assert.deepEqual(await a.pollEvents(),events);await a.acknowledgeEvents(events.map(e=>e.event_id));assert.deepEqual(await a.pollEvents(),[]);
});

test('expired resume restores stopped and never enqueues the new command',async t=>{
  const f=fixture(t),a=await f.open(),active=await stopped(f,a,await running(f,a)),item=f.control(active.item,active.x,{kind:'resume',revision:4,expires_at:new Date(f.clock()-1).toISOString()});
  await accept(a,item);const events=await drain(a);assert.equal(lastState(events).state,'stopped');assert.equal(lastState(events).execution.command_id,active.x.command_id);assert.equal(f.starts().length,1);
  assert.equal(JSON.parse(fs.readFileSync(f.bindings[0].controlStateFile,'utf8')).native_control.order.length,1);
});

test('a stale stop cannot emit a second completion after the original final result was acknowledged',async t=>{
  const f=fixture(t),a=await f.open(),active=await running(f,a);active.turn.status='completed';active.turn.resultComplete=true;active.turn.result={type:'text',text:'Finished before stop request'};const original=await drain(a);
  assert.equal(lastState(original).state,'completed');assert.equal(original[0].actions[0].text,active.turn.result.text);
  const item=f.control(active.item,active.x);await accept(a,item);const events=await drain(a);assert.deepEqual(events,[]);assert.equal(f.interrupts().length,0);
});

test('changed or reused control identities are rejected atomically without creating another command or proof',async t=>{
  const f=fixture(t),a=await f.open(),active=await running(f,a),item=f.control(active.item,active.x);await accept(a,item);
  const changed=clone(item);changed.revision=3;changed.body.control.expected_turn_id='different';changed.body.execution.turn_id='different';
  await assert.rejects(accept(a,changed),{code:'NATIVE_RUNTIME_CONTROL_CONFLICT'});assert.deepEqual(await a.inspectControlIntake({delivery_id:delivery(changed),source:runtimeSource(changed)}),{status:'not_proven'});
  const collision=f.control(active.item,active.x,{revision:3,control_id:active.x.command_id});await assert.rejects(accept(a,collision),{code:'NATIVE_RUNTIME_CONTROL_CONFLICT'});
  assert.equal(Object.keys(f.journal().controls).length,1);assert.equal(Object.keys(f.journal().control_intakes).length,1);assert.equal(f.interrupts().length,0);
});

test('duplicate control revisions each have exact durable proof but share one native effect',async t=>{
  const f=fixture(t),a=await f.open(),active=await running(f,a),item=f.control(active.item,active.x),later={...clone(item),revision:3,event_id:randomUUID()};
  await accept(a,item);await accept(a,later);await drain(a);assert.equal(f.interrupts().length,1);
  assert.equal((await a.inspectControlIntake({delivery_id:delivery(later),source:runtimeSource(later)})).status,'accepted');
});

test('runtime ownership and persisted command-source checks fail closed',async t=>{
  const f=fixture(t),a=await f.open(),item=f.item();await accept(a,item);
  const other=new NativeRuntimeAdapter({stateFile:f.stateFile,bindings:f.bindings});await assert.rejects(other.start(),{code:'BRIDGE_IN_USE'});await a.stop();
  const saved=JSON.parse(fs.readFileSync(f.stateFile,'utf8')),j=saved.native_runtime,op=j.operations[j.order[0]];op.commands[Object.keys(op.commands)[0]].text='Corrupt replacement';fs.writeFileSync(f.stateFile,JSON.stringify(saved));
  await assert.rejects(f.open(),{code:'NATIVE_RUNTIME_STATE_CORRUPT'});assert.equal(f.starts().length,0);
});

test('storage failure after intake poisons the process and prevents dispatch',async t=>{
  const f=fixture(t),a=await f.open(),item=f.item(),temporary=`${f.stateFile}.${process.pid}.tmp`;fs.mkdirSync(temporary);
  await assert.rejects(accept(a,item));fs.rmSync(temporary,{recursive:true});
  await assert.rejects(a.pollEvents(),{code:'NATIVE_RUNTIME_STORAGE_UNCERTAIN'});assert.equal(f.starts().length,0);
});

test('wire-valid oversized and blank commands fail as unsent durable intakes without blocking the next task',async t=>{
  const f=fixture(t),a=await f.open();
  const invalid=['x'.repeat(65536),'中'.repeat(10923),' \t\n '].map(command=>{const item=f.item();item.body.command=command;return item;});
  for(const item of invalid)await accept(a,item);
  const events=await drain(a);assert.equal(events.length,invalid.length);assert.deepEqual(f.bindings[0].calls,[]);
  for(const [index,event]of events.entries()){
    assert.equal(event.delivery_id,delivery(invalid[index]));assert.equal(event.actions[0].channel,'result');assert.match(event.actions[0].text,/任务未派发/);
    assert.deepEqual(event.actions[1],{action:'task_state',state:'failed'});assert.equal(event.actions[2].stage,'failed');
    const op=f.journal().operations['op-'+runtimeDigest(invalid[index].object_id)];assert.equal(op.admission_rejection,index===2?'command_blank':'command_too_large');assert.deepEqual(op.commands,{});
  }
  assert.equal(JSON.parse(fs.readFileSync(f.bindings[0].controlStateFile,'utf8')).native_control.order.length,0);
  const valid=f.item();valid.body.command='x'.repeat(32768);await accept(a,valid);await drain(a);assert.equal(f.starts().length,1);assert.equal(f.starts()[0].text,valid.body.command);
});

test('rejected admission retains exact initial proof and the same failed event after restart',async t=>{
  const f=fixture(t);let a=await f.open();const item=f.item();item.body.command='中'.repeat(12000);await accept(a,item);
  const args={delivery_id:delivery(item),source:runtimeSource(item)},proof=await a.inspectAdmission(args);assert.equal(proof.status,'admitted');
  const expected='rt-'+runtimeDigest(['op-'+runtimeDigest(item.object_id),'admitted']);assert.equal(proof.admitted_event_id,expected);
  await a.stop();a=await f.open();assert.deepEqual(await a.inspectAdmission(args),proof);await accept(a,item);
  const events=await a.pollEvents();assert.equal(events.length,1);assert.equal(events[0].event_id,expected);assert(!events[0].actions.some(action=>action.execution));
  await a.stop();a=await f.open();assert.deepEqual(await a.pollEvents(),events);assert.deepEqual(f.bindings[0].calls,[]);
  await a.acknowledgeEvents([expected]);assert.deepEqual(await a.pollEvents(),[]);
});

test('existing admitted journals without the optional rejection field still resume once',async t=>{
  const f=fixture(t);let a=await f.open();const item=f.item();await accept(a,item);await a.stop();
  const saved=JSON.parse(fs.readFileSync(f.stateFile,'utf8'));for(const op of Object.values(saved.native_runtime.operations))delete op.admission_rejection;fs.writeFileSync(f.stateFile,JSON.stringify(saved));
  a=await f.open();assert.equal((await a.inspectAdmission({delivery_id:delivery(item),source:runtimeSource(item)})).status,'admitted');
  await drain(a);await drain(a);assert.equal(f.starts().length,1);
});
