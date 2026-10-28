import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {SessionControl} from '../hosts/session-control.mjs';

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-session-control-')),stateFile=path.join(directory,'state.json');
  let now=Date.parse('2026-10-25T00:00:00.000Z');
  const binding={server_id:'synthetic-server',owner_id:'synthetic-owner',host_kind:'codex',workspace:directory,
    route:{computer_id:'synthetic-mac',agent_id:'synthetic-codex',project_id:'synthetic-project',session_id:randomUUID()}};
  const calls=[],turns=new Map();let counter=0;
  const host={conversationId:binding.route.session_id,capabilities:{atomic_idle_start:true,exact_turn_interrupt:true},busy:false,proof:null,
    async status(){return{conversationId:this.conversationId,workspace:binding.workspace,busy:this.busy};},
    async start(args){calls.push(args);const saved=JSON.parse(fs.readFileSync(stateFile,'utf8')).native_control;
      assert(Object.values(saved.commands).some(c=>c.phase==='sending'&&c.client_user_message_id===args.clientUserMessageId),'write-ahead intent must precede input');
      const turn={found:true,turnId:`synthetic-turn-${++counter}`,status:'inProgress'};turns.set(args.clientUserMessageId,turn);return{accepted:true,clientUserMessageId:args.clientUserMessageId};},
    async inspectOperation(id){return structuredClone(turns.get(id)??{found:false,outcomeUnknown:true});},
    async interrupt(turnId){calls.push({interrupt:turnId});return{requested:true,expectedTurnId:turnId,confirmedStopped:false};},
    async inspectStop(){return this.proof;}};
  const controllers=[];
  const f={directory,stateFile,binding,host,calls,turns,open(){const q=SessionControl.open({stateFile,binding,host,clock:()=>now});controllers.push(q);return q;},
    command(patch={}){return{command_id:randomUUID(),task_id:`synthetic-${randomUUID()}`,route:binding.route,text:'Synthetic input only',expires_at:new Date(now+60000).toISOString(),...patch};},
    setTime(v){now=v;},deadline(){return now+60000;}};
  t.after(async()=>{for(const c of controllers)await c.close();fs.rmSync(directory,{recursive:true,force:true});});return f;
}
async function running(f,q,input=f.command()){
  q.enqueue(input);await q.tick();await q.tick();assert.equal(q.list().at(-1).phase,'running');return{input,turn:[...f.turns.values()].at(-1)};
}

test('exact binding, command id and original task identity survive reopen without duplicate input',async t=>{
  const f=fixture(t);let q=f.open();const input=f.command();q.enqueue(input);q.enqueue({...input});
  assert.throws(()=>q.enqueue({...input,text:'changed'}),{code:'SESSION_COMMAND_CONFLICT'});
  assert.throws(()=>q.enqueue(f.command({task_id:input.task_id})),{code:'SESSION_TASK_ALREADY_ADMITTED'});
  assert.throws(()=>q.enqueue(f.command({route:{...f.binding.route,session_id:randomUUID()}})),{code:'SESSION_COMMAND_INVALID'});
  await q.tick();await q.close();q=f.open();q.enqueue(input);await q.tick();
  assert.equal(f.calls.length,1);assert.equal(q.list()[0].phase,'running');assert(!('text'in q.list()[0]));
});
test('busy native session queues, explicit unknown host idle capability never sends',async t=>{
  const f=fixture(t),q=f.open();q.enqueue(f.command());f.host.busy=true;await q.tick();assert.equal(q.list()[0].reason,'waiting_for_idle');
  f.host.busy=false;f.host.capabilities.atomic_idle_start=false;await q.tick();assert.equal(q.list()[0].reason,'host_idle_admission_unverified');assert.equal(f.calls.length,0);
});
test('shared desktop owner explicitly admits same-session messages after busy desktop work ends',async t=>{
  const f=fixture(t),q=f.open();f.host.capabilities={shared_conversation_input:true,atomic_idle_start:false};f.host.busy=true;
  q.enqueue(f.command());await q.tick();assert.equal(q.list()[0].reason,'waiting_for_idle');assert.equal(f.calls.length,0);
  f.host.busy=false;await q.tick();await q.tick();assert.equal(f.calls.length,1);assert.equal(q.list()[0].phase,'running');
});
test('native queue admission while busy survives reopen and expiry without starting a second operation',async t=>{
  const f=fixture(t);let q=f.open();f.host.busy=true;f.host.capabilities={atomic_idle_start:false,atomic_queue_append:true};
  const first=f.command(),second=f.command();q.enqueue(first);q.enqueue(second);await q.tick();
  assert.equal(f.calls.length,1);const message=f.calls[0].clientUserMessageId;
  f.turns.set(message,{found:true,status:'queued',turnId:null});await q.tick();
  assert.equal(q.list()[0].phase,'accepted');assert.equal(q.list()[0].reason,'waiting_in_native_queue');
  assert.throws(()=>q.cancelQueued(first.command_id),{code:'SESSION_COMMAND_ALREADY_DISPATCHED'});
  await q.close();q=f.open();f.setTime(Date.parse(first.expires_at)+1);await q.tick();
  assert.deepEqual(q.list().map(c=>c.phase),['accepted','expired']);assert.equal(f.calls.length,1);
  f.turns.set(message,{found:true,status:'inProgress',turnId:'native-queue-turn'});await q.tick();assert.equal(q.list()[0].phase,'running');
  f.turns.set(message,{found:true,status:'queued',turnId:null});await assert.rejects(q.tick(),{code:'SESSION_NATIVE_TURN_CONFLICT'});
});
test('native completion persists only a scoped final text result, not arbitrary host fields',async t=>{
  const f=fixture(t);let q=f.open();const{turn}=await running(f,q);turn.status='completed';turn.result={type:'text',text:'Synthetic final only'};
  await q.tick();assert.deepEqual(q.list()[0].result,turn.result);await q.close();q=f.open();assert.deepEqual(q.list()[0].result,turn.result);
});
test('strict host completion waits for explicit complete final evidence and re-reads the same operation',async t=>{
  const f=fixture(t),q=f.open();f.host.capabilities.final_result_evidence=true;const{turn}=await running(f,q);q.enqueue(f.command());
  const inspected=[],inspect=f.host.inspectOperation;f.host.inspectOperation=async function(id){inspected.push(id);return inspect.call(this,id);};
  turn.status='completed';turn.result={type:'text',text:'Provisional text must not be published'};
  for(const complete of [undefined,false,null,'true']){
    turn.resultComplete=complete;await q.tick();assert.deepEqual(q.list().map(c=>c.phase),['result_pending','queued']);
    assert.equal(q.list()[0].reason,'native_result_not_complete');assert.equal(q.list()[0].native_status,'completed');assert.equal(q.list()[0].result,undefined);
  }
  assert.equal(f.calls.length,1);assert.deepEqual(inspected,Array(4).fill(f.calls[0].clientUserMessageId));
  turn.resultComplete=true;turn.result={type:'text',text:'Complete final text'};await q.tick();
  assert.equal(q.list()[0].phase,'completed');assert.deepEqual(q.list()[0].result,turn.result);assert.equal(f.calls.length,1);
  await q.tick();assert.equal(f.calls.length,2);
});
test('result pending survives restart, keeps single-flight and delivers late output without re-enqueue',async t=>{
  const f=fixture(t);f.host.capabilities.final_result_evidence=true;let q=f.open();const{input,turn}=await running(f,q);q.enqueue(f.command());
  turn.status='completed';await q.tick();await q.close();q=f.open();assert.equal(q.list()[0].phase,'result_pending');
  assert.equal(q.enqueue(input).phase,'result_pending');await q.tick();assert.equal(f.calls.length,1);
  assert.throws(()=>q.cancelQueued(input.command_id),{code:'SESSION_COMMAND_ALREADY_DISPATCHED'});
  await assert.rejects(q.requestStop({control_id:randomUUID(),command_id:input.command_id,expected_turn_id:turn.turnId}),{code:'SESSION_STOP_STALE'});
  turn.resultComplete=true;turn.result={type:'text',text:'Late final from the original turn'};await q.tick();
  assert.equal(q.list()[0].phase,'completed');assert.equal(q.list()[0].turn_id,turn.turnId);assert.deepEqual(q.list()[0].result,turn.result);
  await q.close();q=f.open();assert.deepEqual(q.list()[0].result,turn.result);await q.tick();assert.equal(f.calls.length,2);
});
test('strict host can explicitly attest an empty final snapshot without inventing text',async t=>{
  for(const result of [undefined,{type:'text',text:''}])await t.test(result===undefined?'absent output':'empty text',async t=>{
    const f=fixture(t),q=f.open();f.host.capabilities.final_result_evidence=true;const{turn}=await running(f,q);
    turn.status='completed';turn.resultComplete=true;if(result!==undefined)turn.result=result;await q.tick();
    assert.equal(q.list()[0].phase,'completed');assert.deepEqual(q.list()[0].result,result);
  });
});
test('pending final result cannot be completed by a replacement turn or unrelated operation',async t=>{
  const f=fixture(t),q=f.open();f.host.capabilities.final_result_evidence=true;const{turn}=await running(f,q);turn.status='completed';await q.tick();
  const originalId=f.calls[0].clientUserMessageId,other={found:true,status:'completed',turnId:'unrelated-turn',resultComplete:true,result:{type:'text',text:'Wrong task'}};
  f.turns.set(randomUUID(),other);await q.tick();assert.equal(q.list()[0].phase,'result_pending');
  f.turns.set(originalId,other);await assert.rejects(q.tick(),{code:'SESSION_NATIVE_TURN_CONFLICT'});
  assert.equal(q.list()[0].phase,'result_pending');assert.equal(q.list()[0].turn_id,turn.turnId);assert.equal(q.list()[0].result,undefined);assert.equal(f.calls.length,1);
  f.turns.set(originalId,turn);turn.resultComplete=true;turn.result={type:'text',text:'Correct task'};await q.tick();assert.deepEqual(q.list()[0].result,turn.result);
});
test('result pending journals require the completed turn and cannot bypass the one-flight limit',async t=>{
  const f=fixture(t),q=f.open();f.host.capabilities.final_result_evidence=true;const{turn}=await running(f,q);q.enqueue(f.command());turn.status='completed';await q.tick();await q.close();
  const valid=JSON.parse(fs.readFileSync(f.stateFile,'utf8'));
  for(const mutate of [c=>{delete c.turn_id;},c=>{c.native_status='inProgress';},c=>{c.result={type:'text',text:'Premature'};}]){
    const value=structuredClone(valid),journal=value.native_control;mutate(journal.commands[journal.order[0]]);fs.writeFileSync(f.stateFile,JSON.stringify(value));
    assert.throws(()=>f.open(),{code:'SESSION_STATE_CORRUPT'});
  }
  const value=structuredClone(valid),journal=value.native_control;journal.commands[journal.order[1]].phase='accepted';fs.writeFileSync(f.stateFile,JSON.stringify(value));
  assert.throws(()=>f.open(),{code:'SESSION_STATE_CORRUPT'});assert.equal(f.calls.length,1);
});
test('legacy hosts without final-result capability retain completion behavior',async t=>{
  const f=fixture(t),q=f.open();f.host.capabilities.final_result_evidence=false;const{turn}=await running(f,q);turn.status='completed';turn.resultComplete=false;
  await q.tick();assert.equal(q.list()[0].phase,'completed');assert.equal(q.list()[0].result,undefined);
});
test('a stop racing with completed native output still waits for the final result evidence',async t=>{
  const f=fixture(t),q=f.open();f.host.capabilities.final_result_evidence=true;const{input,turn}=await running(f,q);
  await q.requestStop({control_id:randomUUID(),command_id:input.command_id,expected_turn_id:turn.turnId});turn.status='completed';await q.tick();
  assert.equal(q.list()[0].phase,'result_pending');turn.resultComplete=true;turn.result={type:'text',text:'Completed before stop'};await q.tick();
  assert.equal(q.list()[0].phase,'completed');assert.equal(q.list()[0].reason,'completed_before_stop');assert.deepEqual(q.list()[0].result,turn.result);
});
test('definitive native admission drop closes only the unstarted command without fabricating a turn',async t=>{
  const f=fixture(t),q=f.open();f.host.capabilities={atomic_queue_append:true};q.enqueue(f.command());await q.tick();
  f.turns.set(f.calls[0].clientUserMessageId,{found:true,status:'rejected',turnId:null});await q.tick();
  assert.equal(q.list()[0].phase,'failed');assert.equal(q.list()[0].turn_id,undefined);assert.equal(f.calls.length,1);
});
test('unknown result structure cannot be persisted as a task result',async t=>{
  const f=fixture(t),q=f.open(),{turn}=await running(f,q);turn.status='completed';turn.result={type:'text',text:'Synthetic final',transcript:'unexpected'};
  await assert.rejects(q.tick(),{code:'SESSION_NATIVE_RESULT_INVALID'});assert.equal(q.list()[0].phase,'running');assert.equal(q.list()[0].result,undefined);
});
test('one flight per session excludes concurrent ticks and enqueues during host await',async t=>{
  const f=fixture(t),q=f.open();q.enqueue(f.command());let release;const status=f.host.status;
  f.host.status=()=>new Promise(resolve=>{release=()=>resolve(status.call(f.host));});const pending=q.tick();
  await assert.rejects(q.tick(),{code:'SESSION_CONTROL_BUSY'});assert.throws(()=>q.enqueue(f.command()),{code:'SESSION_CONTROL_BUSY'});release();await pending;
  assert.equal(f.calls.length,1);
});
test('lost start reply and partial history absence fence following commands across restart and expiry',async t=>{
  const f=fixture(t);let q=f.open();const first=f.command(),second=f.command(),deadline=f.deadline();q.enqueue(first);q.enqueue(second);
  const start=f.host.start;f.host.start=async function(args){await start.call(this,args);throw Object.assign(new Error('synthetic-lost'),{code:'CODEX_DESKTOP_REPLY_TIMEOUT',outcomeUnknown:true});};
  await q.tick();assert.equal(q.list()[0].phase,'outcome_unknown');const original=[...f.turns.entries()][0];f.turns.clear();await q.close();q=f.open();
  f.setTime(deadline+1);await q.tick();assert.equal(q.list()[0].phase,'outcome_unknown');assert.equal(q.list()[1].phase,'expired');assert.equal(f.calls.length,1);
  f.turns.set(...original);await q.tick();assert.equal(q.list()[0].phase,'running');assert.equal(f.calls.length,1);
});
test('native terminal completion advances queue only on the following tick without reading other transcript',async t=>{
  const f=fixture(t),q=f.open(),{turn}=await running(f,q);q.enqueue(f.command());turn.status='completed';await q.tick();
  assert.equal(q.list()[0].phase,'completed');assert.equal(f.calls.length,1);await q.tick();assert.equal(f.calls.length,2);assert(!('result'in q.list()[0]));
});
test('queued cancellation and expired input never call the host; expiry rechecked after status await',async t=>{
  const f=fixture(t),q=f.open();const first=f.command(),second=f.command();q.enqueue(first);q.enqueue(second);q.cancelQueued(first.command_id);
  const deadline=f.deadline();f.host.status=async()=>{f.setTime(deadline+1);return{conversationId:f.host.conversationId,workspace:f.binding.workspace,busy:false};};
  await q.tick();assert.deepEqual(q.list().map(c=>c.phase),['cancelled','expired']);assert.equal(f.calls.length,0);
});
test('workspace mismatch waits and never silently starts in another project',async t=>{
  const f=fixture(t),q=f.open();q.enqueue(f.command());f.host.status=async()=>({conversationId:f.host.conversationId,workspace:'/different',busy:false});
  await q.tick();assert.equal(q.list()[0].reason,'SESSION_HOST_MISMATCH');assert.equal(f.calls.length,0);
});
test('stop acknowledgement is not stopped; exact native terminal and descendant proof permit one same-session resume',async t=>{
  const f=fixture(t),q=f.open(),{input,turn}=await running(f,q),control={control_id:randomUUID(),command_id:input.command_id,expected_turn_id:turn.turnId};
  assert.throws(()=>q.cancelQueued(input.command_id),{code:'SESSION_COMMAND_ALREADY_DISPATCHED'});
  await q.requestStop(control);assert.equal(q.list()[0].phase,'stop_requested');await q.requestStop(control);assert.equal(f.calls.filter(c=>c.interrupt).length,1);
  assert.throws(()=>q.enqueue(f.command({task_id:input.task_id,resume_of:input.command_id})),{code:'SESSION_RESUME_NOT_READY'});
  turn.status='interrupted';await q.tick();assert.equal(q.list()[0].phase,'stop_unconfirmed');
  f.host.proof={conversationId:randomUUID(),turnId:turn.turnId,terminal:true,descendantsStopped:true};await q.tick();assert.equal(q.list()[0].phase,'stop_unconfirmed');
  f.host.proof.conversationId=f.host.conversationId;await q.tick();assert.equal(q.list()[0].phase,'stopped');
  const resume=f.command({task_id:input.task_id,resume_of:input.command_id,text:'Synthetic continuation'});q.enqueue(resume);q.enqueue(resume);
  assert.throws(()=>q.enqueue(f.command({task_id:input.task_id,resume_of:input.command_id})),{code:'SESSION_RESUME_NOT_READY'});
  await q.tick();assert.equal(f.calls.filter(c=>c.text).length,2);assert.equal(q.list()[1].route.session_id,input.route.session_id);
});
test('stale/duplicate interrupt cannot stop a replacement turn and lost receipt is never re-sent',async t=>{
  const f=fixture(t);let q=f.open();const{input,turn}=await running(f,q);
  await assert.rejects(q.requestStop({control_id:randomUUID(),command_id:input.command_id,expected_turn_id:'stale'}),{code:'SESSION_STOP_STALE'});
  const interrupt=f.host.interrupt;f.host.interrupt=async function(id){await interrupt.call(this,id);throw{code:'CODEX_DESKTOP_REPLY_TIMEOUT'};};
  const control={control_id:randomUUID(),command_id:input.command_id,expected_turn_id:turn.turnId};await q.requestStop(control);await q.close();q=f.open();
  await q.requestStop(control);await q.tick();assert.equal(f.calls.filter(c=>c.interrupt).length,1);
  turn.status='completed';await q.tick();assert.equal(q.list()[0].phase,'completed');assert.equal(q.list()[0].reason,'completed_before_stop');
  await assert.rejects(q.requestStop({...control,control_id:randomUUID()}),{code:'SESSION_STOP_STALE'});
});
test('cancelled or expired never-sent continuation can be replaced after reopen',async t=>{
  const f=fixture(t);let q=f.open();const{input,turn}=await running(f,q);turn.status='interrupted';
  f.host.proof={conversationId:f.host.conversationId,turnId:turn.turnId,terminal:true,descendantsStopped:true};await q.tick();
  const first=f.command({task_id:input.task_id,resume_of:input.command_id});q.enqueue(first);q.cancelQueued(first.command_id);await q.close();q=f.open();
  const second=f.command({task_id:input.task_id,resume_of:input.command_id});q.enqueue(second);f.setTime(Date.parse(second.expires_at)+1);await q.tick();await q.close();q=f.open();
  q.enqueue(f.command({task_id:input.task_id,resume_of:input.command_id}));await q.tick();assert.equal(f.calls.filter(c=>c.text).length,2);
  assert.deepEqual(q.list().map(c=>c.phase),['stopped','cancelled','expired','accepted']);await q.close();q=f.open();assert.equal(q.list().length,4);
});
test('invalid receipt and remapped native operation do not unblock input',async t=>{
  const f=fixture(t),q=f.open();q.enqueue(f.command());f.host.start=async()=>({accepted:true,clientUserMessageId:randomUUID()});await q.tick();
  assert.equal(q.list()[0].phase,'outcome_unknown');await q.tick();assert.equal(q.list()[0].reason,'native_operation_not_proven');
  f.host.inspectOperation=async()=>({found:true,turnId:'first',status:'inProgress'});await q.tick();
  f.host.inspectOperation=async()=>({found:true,turnId:'second',status:'completed'});await assert.rejects(q.tick(),{code:'SESSION_NATIVE_TURN_CONFLICT'});assert.equal(q.list()[0].phase,'running');
});
test('failed fsync/rename before dispatch poisons controller and no host mutation follows',async t=>{
  const f=fixture(t),q=f.open();q.enqueue(f.command());const original=fs.renameSync,canonical=fs.realpathSync(f.stateFile);
  t.mock.method(fs,'renameSync',(from,to)=>{if(to===canonical)throw Object.assign(new Error('synthetic-disk'),{code:'ENOSPC'});return original(from,to);});
  await assert.rejects(q.tick(),{code:'ENOSPC'});assert.equal(f.calls.length,0);await assert.rejects(q.tick(),{code:'SESSION_STORAGE_UNCERTAIN'});
});
test('session-wide OS ownership prevents a second ledger from bypassing single-flight',async t=>{
  const f=fixture(t);f.open();assert.throws(()=>SessionControl.open({stateFile:path.join(f.directory,'other.json'),binding:f.binding,host:f.host}),{code:'BRIDGE_IN_USE'});
});
test('hard process death after native send preserves ambiguous intent and releases OS lock without replay',async t=>{
  const f=fixture(t),input=f.command(),moduleUrl=new URL('../hosts/session-control.mjs',import.meta.url).href;
  const code=`import {SessionControl} from ${JSON.stringify(moduleUrl)};const binding=${JSON.stringify(f.binding)},input=${JSON.stringify(input)};
    const host={conversationId:binding.route.session_id,capabilities:{atomic_idle_start:true},status:async()=>({conversationId:binding.route.session_id,workspace:binding.workspace,busy:false}),start:async()=>{setInterval(()=>{},1000);process.stdout.write('native-send\\n');await new Promise(()=>{});}};
    const q=SessionControl.open({stateFile:${JSON.stringify(f.stateFile)},binding,host,clock:()=>${Date.parse('2026-10-25T00:00:00.000Z')}});q.enqueue(input);await q.tick();`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);
  const done=once(child,'exit');t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('synthetic child startup timeout')),5000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(new Error(errors));});child.once('error',reject);});
  child.kill('SIGKILL');const exit=await done;assert.equal(exit[1],'SIGKILL');const q=f.open();await q.tick();assert.equal(q.list()[0].phase,'outcome_unknown');assert.equal(f.calls.length,0);
});
test('corrupt journal and identity replacement stop rather than recreate the queue',async t=>{
  const f=fixture(t),q=f.open();q.enqueue(f.command());await q.close();
  assert.throws(()=>SessionControl.open({stateFile:f.stateFile,binding:{...f.binding,owner_id:'another'},host:f.host}),{code:'STATE_IDENTITY_MISMATCH'});
  const value=JSON.parse(fs.readFileSync(f.stateFile,'utf8'));value.native_control.order.push(randomUUID());fs.writeFileSync(f.stateFile,JSON.stringify(value));
  assert.throws(()=>f.open(),{code:'SESSION_STATE_CORRUPT'});assert.equal(f.calls.length,0);
});

test('native child stop is separately durable, exact-turn, and never resent after reply loss or restart',async t=>{
  const f=fixture(t);let q=f.open();const {input,turn}=await running(f,q);
  f.host.capabilities.exact_turn_child_stop=true;let calls=0;
  f.host.stopChildren=async id=>{
    calls++;assert.equal(id,turn.turnId);
    const saved=JSON.parse(fs.readFileSync(f.stateFile)).native_control.commands[input.command_id];
    assert.equal(saved.child_stop_phase,'prepared');throw Error('native reply lost');
  };
  await q.requestStop({control_id:randomUUID(),command_id:input.command_id,expected_turn_id:turn.turnId});
  turn.status='interrupted';await q.tick();assert.equal(calls,1);assert.equal(q.list()[0].phase,'stop_unconfirmed');
  await q.close();q=f.open();await q.tick();assert.equal(calls,1);
  f.host.proof={conversationId:f.binding.route.session_id,turnId:turn.turnId,terminal:true,descendantsStopped:true};
  await q.tick();assert.equal(q.list()[0].phase,'stopped');assert.equal(calls,1);
});


async function queuedContinuation(f,q){
  const {input,turn}=await running(f,q);
  turn.status='interrupted';f.host.proof={conversationId:f.host.conversationId,turnId:turn.turnId,terminal:true,descendantsStopped:true};
  await q.tick();assert.equal(q.list()[0].phase,'stopped');
  f.host.capabilities.atomic_queue_append=true;f.host.capabilities.atomic_queued_resume=true;
  const resume=f.command({task_id:input.task_id,resume_of:input.command_id,text:'Explicit same-session continuation'});
  q.enqueue(resume);await q.tick();const message=f.calls.at(-1).clientUserMessageId;
  f.turns.set(message,{found:true,status:'queued',turnId:null});return {input,resume,message};
}
test('explicit continuation persists exact queue-start intent and reconciles the original task result',async t=>{
  const f=fixture(t),q=f.open(),{input,resume,message}=await queuedContinuation(f,q);let starts=0;
  f.host.startQueued=async(id,options)=>{
    starts++;assert.equal(id,message);assert.equal(options.expiresAt,resume.expires_at);
    const saved=JSON.parse(fs.readFileSync(f.stateFile,'utf8')).native_control.commands[resume.command_id];
    assert.equal(saved.resume_queue_phase,'prepared');assert.equal(saved.resume_of,input.command_id);
    f.turns.set(id,{found:true,status:'inProgress',turnId:'continued-original-session'});
    return{requested:true,clientUserMessageId:id,turnId:'continued-original-session'};
  };
  await q.tick();await q.tick();assert.equal(q.list()[1].phase,'running');
  f.turns.set(message,{found:true,status:'completed',turnId:'continued-original-session',result:{type:'text',text:'Actual continuation result'}});
  await q.tick();assert.equal(q.list()[1].phase,'completed');assert.equal(q.list()[1].task_id,input.task_id);
  assert.equal(starts,1);assert.equal(f.calls.filter(c=>c.text).length,2);
});
test('lost queue-start reply or restart never repeats native activation',async t=>{
  const f=fixture(t);let q=f.open();const {resume,message}=await queuedContinuation(f,q);let starts=0;
  f.host.startQueued=async()=>{starts++;throw {code:'CODEX_APP_SERVER_REPLY_TIMEOUT'};};
  await q.tick();await q.close();q=f.open();await q.tick();await q.tick();assert.equal(starts,1);
  f.turns.set(message,{found:true,status:'inProgress',turnId:'late-continuation'});await q.tick();assert.equal(q.list()[1].phase,'running');
  const saved=JSON.parse(fs.readFileSync(f.stateFile,'utf8')).native_control.commands[resume.command_id];assert.equal(saved.resume_queue_phase,'outcome_unknown');
});
test('unexpired first input is never activated by continuation hook; expired sent continuation stays observable',async t=>{
  const f=fixture(t),q=f.open(),{resume}=await queuedContinuation(f,q);let starts=0;
  f.host.startQueued=async()=>{starts++;throw Error('must not activate');};
  f.setTime(Date.parse(resume.expires_at)+1);await q.tick();assert.equal(starts,0);
  assert.equal(q.list()[1].phase,'accepted');assert.equal(q.list()[1].reason,'resume_expired_in_native_queue');
  assert.throws(()=>q.cancelQueued(resume.command_id),{code:'SESSION_COMMAND_ALREADY_DISPATCHED'});
});
test('native busy rejection is not steered or repeatedly activated',async t=>{
  const f=fixture(t),q=f.open(),{message}=await queuedContinuation(f,q);let starts=0;
  f.host.startQueued=async id=>{starts++;return {requested:false,clientUserMessageId:id,reason:'thread_busy'};};
  await q.tick();await q.tick();assert.equal(starts,1);assert.equal(q.list()[1].phase,'accepted');
  f.turns.set(message,{found:true,status:'inProgress',turnId:'normal-queue-drain'});await q.tick();assert.equal(q.list()[1].phase,'running');
});


test('normal new input appends without resuming an interrupted native queue',async t=>{
  const f=fixture(t),q=f.open();f.host.capabilities.atomic_queue_append=true;f.host.capabilities.atomic_queued_resume=true;
  f.host.startQueued=async()=>assert.fail('ordinary enqueue must not restore native scheduling');
  q.enqueue(f.command());await q.tick();const message=f.calls[0].clientUserMessageId;
  f.turns.set(message,{found:true,status:'queued',turnId:null});await q.tick();await q.tick();
  assert.equal(q.list()[0].reason,'waiting_in_native_queue');assert.equal(f.calls.length,1);
});


function observedInput(f,patch={}){
  return {...f.command({text:'Approved topic only'}),client_user_message_id:randomUUID(),turn_id:'local-turn-'+randomUUID(),created_at:new Date(f.deadline()-60000).toISOString(),...patch};
}
test('observed current native turn is adopted read-only, restartable and exact-operation fenced',async t=>{
  const f=fixture(t);let q=f.open();const input=observedInput(f);
  f.turns.set(input.client_user_message_id,{found:true,turnId:input.turn_id,status:'inProgress'});
  assert.equal((await q.adoptObserved(input)).phase,'running');assert.equal(f.calls.length,0);
  assert.equal(q.nativeOperationKnown(input.client_user_message_id),true);
  await q.close();q=f.open();assert.equal((await q.adoptObserved(input)).origin,'observed');await q.tick();assert.equal(f.calls.length,0);
  await assert.rejects(q.adoptObserved({...input,turn_id:'replacement-turn'}),{code:'SESSION_COMMAND_CONFLICT'});
  const unknown=observedInput(f);await assert.rejects(q.adoptObserved(unknown),{code:'SESSION_OBSERVED_NOT_PROVEN'});assert.equal(q.list().length,1);
  const wrong=observedInput(f);f.turns.set(wrong.client_user_message_id,{found:true,turnId:'not-the-observed-turn',status:'inProgress'});
  await assert.rejects(q.adoptObserved(wrong),{code:'SESSION_OBSERVED_NOT_PROVEN'});assert.equal(q.list().length,1);
});
test('observed turn can be stopped despite an already-sent queued remote input; unknown proof never permits resume',async t=>{
  const f=fixture(t);let q=f.open();f.host.capabilities.atomic_queue_append=true;
  q.enqueue(f.command());await q.tick();const remoteMessage=f.calls[0].clientUserMessageId;
  f.turns.set(remoteMessage,{found:true,status:'queued',turnId:null});
  const input=observedInput(f),turn={found:true,turnId:input.turn_id,status:'inProgress'};f.turns.set(input.client_user_message_id,turn);
  await q.adoptObserved(input);await q.close();q=f.open();
  await q.requestStop({control_id:randomUUID(),command_id:input.command_id,expected_turn_id:input.turn_id});turn.status='interrupted';await q.tick();
  assert.equal(q.list()[0].phase,'accepted');assert.equal(q.list()[1].phase,'stop_unconfirmed');assert.equal(f.calls.filter(c=>c.interrupt).length,1);
  assert.throws(()=>q.enqueue(f.command({task_id:input.task_id,resume_of:input.command_id})),{code:'SESSION_RESUME_NOT_READY'});
  f.host.proof={conversationId:f.host.conversationId,turnId:input.turn_id,terminal:true,descendantsStopped:true};await q.tick();assert.equal(q.list()[1].phase,'stopped');
  assert.equal(f.calls.filter(c=>c.text).length,1);
});
test('same-task continuation of a proven observed stop is the only native input; first terminal facts are never replayed',async t=>{
  const f=fixture(t),q=f.open(),input=observedInput(f),turn={found:true,turnId:input.turn_id,status:'inProgress'};
  f.turns.set(input.client_user_message_id,turn);await q.adoptObserved(input);
  await q.requestStop({control_id:randomUUID(),command_id:input.command_id,expected_turn_id:input.turn_id});turn.status='interrupted';
  f.host.proof={conversationId:f.host.conversationId,turnId:input.turn_id,terminal:true,descendantsStopped:true};await q.tick();
  const resume=f.command({task_id:input.task_id,resume_of:input.command_id,text:'User explicitly continues the same task'});q.enqueue(resume);await q.tick();await q.tick();
  assert.equal(f.calls.filter(c=>c.text).length,1);assert.equal(q.list()[1].task_id,input.task_id);assert.equal(q.list()[1].resume_of,input.command_id);
  const history=observedInput(f);f.turns.set(history.client_user_message_id,{found:true,turnId:history.turn_id,status:'completed',resultComplete:true,result:{type:'text',text:'Known completed result'}});
  assert.equal((await q.adoptObserved(history)).phase,'completed');assert.equal(f.calls.filter(c=>c.text).length,1);
  // A stale later snapshot cannot revive the historical task.
  f.turns.get(history.client_user_message_id).status='inProgress';await q.adoptObserved(history);await q.tick();assert.equal(q.list().at(-1).phase,'completed');
});
test('natural observed turnover does not block exact control of the current local turn or expose unproved final text',async t=>{
  const f=fixture(t),q=f.open(),old=observedInput(f),next=observedInput(f);
  f.turns.set(old.client_user_message_id,{found:true,turnId:old.turn_id,status:'completed',resultComplete:false,result:{type:'text',text:'Incomplete'}});
  await q.adoptObserved(old);assert.equal(q.list()[0].phase,'result_pending');assert.equal(q.list()[0].result,undefined);
  f.turns.set(next.client_user_message_id,{found:true,turnId:next.turn_id,status:'inProgress'});await q.adoptObserved(next);
  await q.requestStop({control_id:randomUUID(),command_id:next.command_id,expected_turn_id:next.turn_id});assert.equal(f.calls.filter(c=>c.interrupt).length,1);
  const localCancelled=observedInput(f);f.turns.set(localCancelled.client_user_message_id,{found:true,turnId:localCancelled.turn_id,status:'interrupted'});
  assert.equal((await q.adoptObserved(localCancelled)).phase,'failed');assert.equal(f.calls.filter(c=>c.text).length,0);
});
test('an older interrupted observation stays unconfirmed without blocking a different proven stopped task continuation',async t=>{
  const f=fixture(t),q=f.open(),old=observedInput(f),current=observedInput(f);
  const oldTurn={found:true,turnId:old.turn_id,status:'inProgress'},currentTurn={found:true,turnId:current.turn_id,status:'inProgress'};
  f.turns.set(old.client_user_message_id,oldTurn);await q.adoptObserved(old);
  await q.requestStop({control_id:randomUUID(),command_id:old.command_id,expected_turn_id:old.turn_id});oldTurn.status='interrupted';await q.tick();
  assert.equal(q.list()[0].phase,'stop_unconfirmed');
  f.turns.set(current.client_user_message_id,currentTurn);await q.adoptObserved(current);
  await q.requestStop({control_id:randomUUID(),command_id:current.command_id,expected_turn_id:current.turn_id});currentTurn.status='interrupted';
  f.host.proof={conversationId:f.host.conversationId,turnId:current.turn_id,terminal:true,descendantsStopped:true};await q.tick();
  assert.equal(q.list()[1].phase,'stopped');
  assert.throws(()=>q.enqueue(f.command({task_id:old.task_id,resume_of:old.command_id})),{code:'SESSION_RESUME_NOT_READY'});
  q.enqueue(f.command({task_id:current.task_id,resume_of:current.command_id}));await q.tick();await q.tick();
  assert.equal(q.list()[0].phase,'stop_unconfirmed');assert.equal(q.list()[2].phase,'running');assert.equal(f.calls.filter(c=>c.text).length,1);
});
