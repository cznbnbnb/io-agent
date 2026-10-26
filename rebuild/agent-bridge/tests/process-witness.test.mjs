import test from 'node:test';
import assert from 'node:assert/strict';
import {ProcessWitness,readProcessTable} from '../hosts/process-witness.mjs';

const row=(pid,ppid=1,pgid=pid,started='Mon Oct 26 12:00:00 2026',executable='python3')=>
  ({pid,ppid,pgid,started,executable,uid:process.getuid(),state:'S'});
function fixture(t){
  let now=10000,rows=new Map([[123,row(123,1,123,undefined,'claude')]]);
  const witness=new ProcessWitness({clock:()=>now,read:async()=>{if(rows instanceof Error)throw rows;return rows;}});
  t.after(()=>witness.close());
  return{witness,rows,set:value=>rows=value,advance:n=>now+=n};
}
test('actual process reader parses identities without argv or output',async()=>{
  const rows=await readProcessTable();assert(rows.has(process.pid));
  assert.equal(Object.hasOwn(rows.get(process.pid),'args'),false);
});
test('requires quiet independent observations and invalidates on root PID reuse',async t=>{
  const f=fixture(t);await f.witness.bind(123);await f.witness.begin("turn");
  assert.equal((await f.witness.inspect("turn")).quiescent,false);
  f.advance(500);assert.equal((await f.witness.inspect("turn")).quiescent,true);
  f.rows.set(123,row(123,1,123,'Mon Oct 26 12:00:01 2026','claude'));
  assert.equal((await f.witness.inspect("turn")).observed,false);
});
test('orphaned child and late group descendants fence stop until all actually exit',async t=>{
  const f=fixture(t);await f.witness.bind(123);await f.witness.begin("turn");
  f.rows.set(200,row(200,123,200));await f.witness.sample();
  f.rows.set(201,row(201,200,200));await f.witness.sample();
  f.rows.delete(200);f.rows.set(201,row(201,1,200));f.advance(600);
  assert.equal((await f.witness.inspect("turn")).quiescent,false);
  f.rows.set(202,row(202,1,200));f.rows.delete(201);await f.witness.sample();
  assert.equal((await f.witness.inspect("turn")).quiescent,false);
  f.rows.delete(202);await f.witness.sample();f.advance(500);
  assert.equal((await f.witness.inspect("turn")).quiescent,true);
});
test('observation failures, missed windows, root exit and closed observers never certify stop',async t=>{
  for(const kind of ['failure','gap','root_exit','closed']){
    const f=fixture(t);await f.witness.bind(123);await f.witness.begin("turn");f.advance(500);assert.equal((await f.witness.inspect("turn")).quiescent,true);
    if(kind==='failure')f.set(new Error('read denied'));
    if(kind==='gap')f.advance(2000);
    if(kind==='root_exit')f.rows.delete(123);
    if(kind==='closed')f.witness.close();
    assert.equal((await f.witness.inspect("turn")).quiescent,false,kind);
  }
});
test('an unrelated process cannot register as the native Claude engine',async t=>{
  const f=fixture(t);f.rows.set(123,row(123));
  await assert.rejects(f.witness.bind(123),/ROOT_UNTRUSTED/);
});

test('a pre-tool baseline preserves existing services while their new descendants still block the exact turn',async t=>{
  const f=fixture(t);f.rows.set(300,row(300,123,300,undefined,'mcp-server'));
  await f.witness.bind(123);await f.witness.begin('owned');f.advance(500);
  assert.equal((await f.witness.inspect('owned')).quiescent,true);
  f.rows.set(301,row(301,300,300));await f.witness.sample();f.advance(500);
  assert.equal((await f.witness.inspect('owned')).quiescent,false);
  f.rows.delete(301);await f.witness.sample();f.advance(500);
  assert.equal((await f.witness.inspect('owned')).quiescent,true);
  assert.equal((await f.witness.inspect('unknown-turn')).quiescent,false);
});
