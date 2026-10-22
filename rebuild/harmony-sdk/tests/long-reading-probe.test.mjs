import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const id='read-'+'1'.repeat(32);
test('check-only run waits for confirmed running, exits on deadline and never offers a card',async()=>{
 for(const physicalBack of [false,true]){
  const s=setup();await s.p.start(id,true);s.v.prompterPhase='ready';await s.p.tick();
  s.v.prompterPhase='starting';await s.p.tick();assert(!s.calls.includes(4));
  s.v.prompterPhase='running';await s.p.tick();s.now(7000);await s.p.tick();await s.p.tick();assert.equal(s.p.record.phase,'reading');
  if(physicalBack){await s.back();s.now(131000);await s.p.tick();}
  else{s.now(127000);await s.p.tick();assert(s.calls.includes('exit'));assert.equal(s.p.record.phase,'pending');assert.equal(s.p.record.error,'');assert.equal(s.p.record.readEnded,127000);}
  assert(!s.calls.includes('show'));assert.equal(s.p.record.choice,0);
 }
});
function setup(prior){
 const {LongReadingProbe,ReadingView}=loadApp('LongReadingProbe');const v=new ReadingView(),calls=[],saved=[];
 Object.assign(v,{connected:true,foreground:true,idle:true,peer:'synthetic-peer',connection:1});let time=1000,exitOK=true,failSave=false;
 const ports={now:()=>time,view:()=>({...v}),save:r=>{if(failSave)throw Error('disk');saved.push(JSON.parse(JSON.stringify(r)));},
 prepare:async()=>{assert.equal(saved.at(-1).phase,'preparing');calls.push('prepare');Object.assign(v,{did:'fixture-did',prompterActive:true,prompterPhase:'preparing',idle:false});},
 control:async n=>{calls.push(n);v.prompterPhase=n===3?'running':'paused';},
 exit:async()=>{calls.push('exit');if(exitOK)Object.assign(v,{prompterActive:false,did:'',idle:true,prompterPhase:'idle'});return exitOK;},
 show:async()=>{assert.equal(saved.at(-1).exitConfirmed,true);assert.equal(v.prompterActive,false);calls.push('show');Object.assign(v,{cardActive:true,uid:'test-card',cardPhase:'waiting',idle:false});},
 ack:async()=>{assert.equal(saved.at(-1).choice,v.choice);calls.push('ack');},remove:async()=>{calls.push('remove');Object.assign(v,{cardActive:false,uid:'',idle:true});}};
 const p=new LongReadingProbe(ports,prior);
 return {p,v,calls,saved,ports,now:n=>time=n,exitOK:b=>exitOK=b,failSave:b=>failSave=b,
 reading:async()=>{await p.start(id);v.prompterPhase='ready';await p.tick();await p.tick();time=7000;await p.tick();await p.tick();assert.equal(p.record.phase,'reading');},
 resume:async()=>{v.resumeSequence++;v.prompterPhase='running';await p.tick();},
 back:async()=>{Object.assign(v,{localBackSequence:v.localBackSequence+1,localBackDid:'fixture-did',prompterActive:false,prompterPhase:'idle',did:'',idle:true});await p.tick();},
 choose:async()=>{Object.assign(v,{localBackSequence:v.localBackSequence+1,localBackDid:'fixture-did',prompterActive:false,prompterPhase:'idle',did:'',idle:true});await p.tick();time+=1000;await p.tick();}};
}
test('long reading waits for the original local back candidate before a single synthetic card',async()=>{
 const s=setup();await s.reading();assert.equal(s.p.record.deadline,127000);await s.choose();
 assert.deepEqual(s.calls,['prepare',3,4,'show']);assert.equal(s.p.record.choice,0);assert.equal(s.p.record.phase,'choosing');
 await s.p.tick();assert.equal(s.calls.filter(c=>c==='show').length,1);
 s.v.cardPhase='observed';s.v.choice=2;await s.p.tick();assert.equal(s.p.record.outcome,'modify_test_only');
 s.now(11000);await s.p.tick();assert.equal(s.p.record.phase,'done');assert.equal(s.calls.at(-1),'remove');
});
test('short press and phone resume no longer stop the text or trigger the known failed transition',async()=>{
 const s=setup();await s.reading();s.v.prompterPhase='running';await s.p.tick();await s.resume();assert.deepEqual(s.calls,['prepare',3,4]);assert.equal(s.p.record.choice,0);assert.equal(s.p.record.deadline,127000);
});
test('read timeout exits and keeps pending without a choice or second card',async()=>{
 const s=setup();await s.reading();s.now(127000);await s.p.tick();assert.deepEqual(s.calls,['prepare',3,4,'exit']);assert.equal(s.p.record.phase,'pending');assert.equal(s.p.record.outcome,'pending');
});
test('remote stop ACK, stale local event, foreign did and late back cannot become readiness',async()=>{
 for(const patch of [{},{localBackSequence:1,localBackDid:'other'},{localBackSequence:0,localBackDid:'fixture-did'}]){
  const s=setup();await s.reading();Object.assign(s.v,{prompterActive:false,did:'',idle:true},patch);await s.p.tick();assert(!s.calls.includes('show'));assert.equal(s.p.record.choice,0);
 }
 const late=setup();await late.reading();late.now(127000);await late.back();assert(!late.calls.includes('show'));assert.equal(late.p.record.choice,0);
 const stopped=setup();await stopped.reading();await stopped.p.stop(id);assert.equal(stopped.p.record.exitOrigin,'remote_stop_ack');assert(!stopped.calls.includes('show'));
});
test('disconnect, new generation or different owner never controls a replacement',async()=>{
 for(const patch of [{connected:false},{peer:'other'},{connection:2},{did:'replacement'}]){
  const s=setup();await s.reading();Object.assign(s.v,patch);await s.resume();assert.equal(s.p.record.phase,'interrupted');assert.deepEqual(s.calls,['prepare',3,4]);
 }
});
test('backgrounding stops the original reading without presenting another surface',async()=>{
 const s=setup();await s.reading();s.v.foreground=false;await s.p.tick();assert.equal(s.calls.at(-1),'exit');assert.equal(s.p.record.phase,'pending');
});
test('a missed or expired selection is pending, never refusal, and is not redisplayed',async()=>{
 for(const ended of [true,false]){const s=setup();await s.reading();await s.choose();if(ended)s.v.cardActive=false;else s.now(69000);
  await s.p.tick();await s.p.tick();assert.equal(s.p.record.phase,'pending');assert.equal(s.p.record.choice,0);assert.equal(s.calls.filter(x=>x==='show').length,1);}
});
test('restart retains the binding and answer but never replays prepare, card or ack',async()=>{
 const s=setup();await s.reading();await s.choose();const next=setup(JSON.parse(JSON.stringify(s.p.record)));await next.p.tick();
 assert.equal(next.p.record.phase,'interrupted');assert.equal(next.p.record.operation,id);assert.deepEqual(next.calls,[]);
});
test('durable failure, occupied device and repeated operation forbid another start',async()=>{
 const s=setup();s.failSave(true);await assert.rejects(s.p.start(id));assert.deepEqual(s.calls,[]);
 const occupied=setup();occupied.v.idle=false;await assert.rejects(occupied.p.start(id));assert.deepEqual(occupied.calls,[]);
 const normal=setup();await normal.reading();await assert.rejects(normal.p.start(id));assert.equal(normal.calls.filter(x=>x==='prepare').length,1);
});
test('stop needs original operation and cannot remove another card',async()=>{
 const s=setup();await s.reading();await assert.rejects(s.p.stop('read-'+'2'.repeat(32)));assert(!s.calls.includes('exit'));
 await s.choose();s.v.uid='other';await assert.rejects(s.p.stop(id));assert(!s.calls.includes('remove'));
});
test('settle window is cancelable and never treated as proof of Launcher navigation',async()=>{
 for(const patch of [{foreground:false},{connected:false},{connection:2},{idle:false},{cardActive:true}]){
  const s=setup();await s.reading();await s.back();assert.equal(s.p.record.phase,'returning');assert(!s.calls.includes('show'));
  Object.assign(s.v,patch);s.now(8000);await s.p.tick();assert(!s.calls.includes('show'));
 }
 const disposed=setup();await disposed.reading();await disposed.back();disposed.p.dispose();disposed.now(8000);await disposed.p.tick();assert(!disposed.calls.includes('show'));
 const canceled=setup();await canceled.reading();await canceled.back();await canceled.p.stop(id);canceled.now(8000);await canceled.p.tick();assert.equal(canceled.p.record.phase,'pending');assert(!canceled.calls.includes('show'));
});
test('a removal that leaves cleanup pending cannot be reported done',async()=>{
 const s=setup();await s.reading();await s.choose();s.ports.remove=async()=>{};await s.p.stop(id);assert.equal(s.p.record.phase,'interrupted');
});
test('failed preparation or control attempts exactly one same-connection cleanup, never a card',async()=>{
 for(const phase of ['preparing','starting','pausing','reading']){
  const s=setup();await s.p.start(id);s.p.record.phase=phase;s.v.prompterPhase='error';
  await s.p.tick();await s.p.tick();
  assert.equal(s.calls.filter(x=>x==='exit').length,1);assert(!s.calls.includes('show'));
  assert.equal(s.p.record.phase,'pending');assert.equal(s.p.record.error,'PROMPTER_NOT_READY');assert.equal(s.p.record.choice,0);
 }
});
test('failed cleanup retains interruption and never retries; changed connection gets no cleanup command',async()=>{
 const s=setup();await s.reading();s.exitOK(false);s.v.prompterPhase='error';await s.p.tick();await s.p.tick();
 assert.equal(s.calls.filter(x=>x==='exit').length,1);assert.equal(s.p.record.phase,'interrupted');assert(!s.calls.includes('show'));
 assert.equal(s.p.record.readEnded,0);assert.equal(s.p.record.exitConfirmed,false);
 const changed=setup();await changed.reading();changed.v.prompterPhase='error';changed.v.connection++;
 await changed.p.tick();assert(!changed.calls.includes('exit'));assert.equal(changed.p.record.error,'CONNECTION_CHANGED');
});

 test('automatic pause requires six seconds of observed running and resets on nonrunning state',async()=>{
 const s=setup();await s.p.start(id,true);s.v.prompterPhase='ready';await s.p.tick();
 s.v.prompterPhase='starting';s.now(6000);await s.p.tick();assert(!s.calls.includes(4));
 s.v.prompterPhase='running';await s.p.tick();s.now(11999);await s.p.tick();assert(!s.calls.includes(4));
 s.v.prompterPhase='starting';await s.p.tick();s.v.prompterPhase='running';s.now(12000);await s.p.tick();
 s.now(17999);await s.p.tick();assert(!s.calls.includes(4));s.now(18000);await s.p.tick();assert.equal(s.calls.filter(x=>x===4).length,1);
 await s.p.tick();assert.equal(s.p.record.phase,'reading');assert.equal(s.p.record.deadline,138000);
});
 test('starting timeout still exits once when confirmed running never arrives',async()=>{
 const s=setup();await s.p.start(id,true);s.v.prompterPhase='ready';await s.p.tick();s.v.prompterPhase='starting';
 s.now(26000);await s.p.tick();await s.p.tick();assert(!s.calls.includes(4));assert.equal(s.calls.filter(x=>x==='exit').length,1);
 assert.equal(s.p.record.error,'READING_DEADLINE');assert.equal(s.p.record.readStarted,0);
});
