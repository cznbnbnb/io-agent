import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BridgeRunLock} from '../run-lock.mjs';

const worker=fileURLToPath(new URL('./fixtures/lock-worker.mjs',import.meta.url));
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-run-lock-')),leases=[],children=[];
  const identity={server_id:randomUUID(),owner_id:'synthetic-owner',computer_id:'synthetic-pc',agent_id:'synthetic-agent'};
  const stateFile=path.join(dir,'state.json');
  t.after(async()=>{
    for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}
    for(const lease of leases)lease.release();fs.rmSync(dir,{recursive:true,force:true});
  });
  return {dir,identity,stateFile,acquire:(options={})=>{const lease=BridgeRunLock.acquire({stateFile,identity,...options});leases.push(lease);return lease;},
    async child(options={}){
      const child=fork(worker,[options.stateFile??stateFile,JSON.stringify(options.identity??identity)],{stdio:['ignore','ignore','ignore','ipc']});children.push(child);
      const ready=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('child readiness timeout'));},5000);
        child.once('message',value=>{clearTimeout(timer);resolve(value);});child.once('error',error=>{clearTimeout(timer);reject(error);});
        child.once('exit',()=>{clearTimeout(timer);reject(new Error('child exited before readiness'));});
      });
      return {child,ready};
    }};
}
test('two independent processes cannot own the same ledger; normal release permits the successor',async t=>{
  const f=setup(t),first=f.acquire(),{child,ready}=await f.child();assert.equal(ready.error,'BRIDGE_IN_USE');
  await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
  first.assertHeld();first.release();const successor=f.acquire();successor.assertHeld();
});
test('hard process death releases OS ownership without deleting a lock file or guessing a PID',async t=>{
  const f=setup(t),{child,ready}=await f.child();assert.equal(ready.ready,true);
  assert.throws(()=>f.acquire(),e=>e.code==='BRIDGE_IN_USE');
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
  const successor=f.acquire();successor.assertHeld();assert.equal(fs.existsSync(`${successor.stateFile}.run-lock.sqlite`),true);
});
test('different ledger files and producer labels cannot bypass ownership of the same runtime',async t=>{
  const f=setup(t),first=f.acquire();
  const {child,ready}=await f.child({stateFile:path.join(f.dir,'other-state.json'),identity:{...f.identity,producer_id:'another-producer'}});
  assert.equal(ready.error,'BRIDGE_IN_USE');first.assertHeld();
  await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
  const independent=f.acquire({stateFile:path.join(f.dir,'independent.json'),identity:{...f.identity,agent_id:'another-agent'}});independent.assertHeld();
});
test('path aliases normalize to one ledger lock and a foreign sidecar is preserved',t=>{
  const f=setup(t),first=f.acquire();
  assert.throws(()=>f.acquire({stateFile:path.join(f.dir,'unused','..','state.json')}),e=>e.code==='BRIDGE_IN_USE');
  first.release();const sidecar=`${f.stateFile}.run-lock.sqlite`;
  const original=fs.readFileSync(sidecar);fs.writeFileSync(sidecar,'foreign data');
  assert.throws(()=>f.acquire(),e=>['LOCK_UNAVAILABLE','LOCK_FILE_INVALID'].includes(e.code));
  assert.equal(fs.readFileSync(sidecar,'utf8'),'foreign data');fs.writeFileSync(sidecar,original);
});
test('hard-linked state files are rejected instead of treating aliases as separate writable ledgers',t=>{
  const f=setup(t);fs.writeFileSync(f.stateFile,'{}');const alias=path.join(f.dir,'hardlink.json');fs.linkSync(f.stateFile,alias);
  assert.throws(()=>f.acquire(),e=>e.code==='STATE_PATH_UNSAFE');assert.equal(fs.readFileSync(f.stateFile,'utf8'),'{}');
});
