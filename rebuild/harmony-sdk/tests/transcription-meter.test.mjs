import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {loadApp} from './load-app.mjs';
function setup(t){
 const prefix=path.join(os.tmpdir(),'turboio-meter-'),root=fs.mkdtempSync(prefix).replaceAll('\\','/');
 t.after(()=>{if(!path.resolve(root).startsWith(path.resolve(prefix)))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true});});
 let fail=false;const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},accessSync:fs.existsSync,statSync:fs.statSync,readTextSync:p=>fs.readFileSync(p,'utf8'),openSync:p=>({fd:fs.openSync(p,'w')}),closeSync:f=>fs.closeSync(f.fd),writeSync:(fd,b)=>fs.writeSync(fd,new Uint8Array(b).slice(0,7)),fsyncSync:fs.fsyncSync,renameSync:(a,b)=>{if(fail)throw Error('synthetic-full');fs.renameSync(a,b);}};
 const {TranscriptionMeter}=loadApp('TranscriptionMeter',{'@kit.CoreFileKit':{fileIo:io}});
 const restart=()=>{const meter=new TranscriptionMeter();meter.initialize(root);return meter;};
 return{root,meter:restart(),restart,fail:v=>fail=v};
}
test('reserve persists before inference; a killed process cannot reset the rolling budget',t=>{
 const s=setup(t);s.meter.reserve(1000,15000);const next=s.restart();
 assert.equal(next.used(2000),15000);assert.throws(()=>next.reserve(2000,5000),/BUSY/);
 assert.equal(next.remaining(61000),20000);next.reserve(61000,15000);
 assert.throws(()=>next.reserve(62000,15000),/EXHAUSTED/);
});
test('settle charges real duration including startup, retains long overrun, and duplicate settlement is inert',t=>{
 const s=setup(t),id=s.meter.reserve(1000,15000);s.meter.settle(id,5000,4000);s.meter.settle(id,5000,0);
 const next=s.restart();assert.equal(next.used(6000),4000);const second=next.reserve(6000,15000);
 next.settle(second,28000,22000);assert.equal(s.restart().remaining(28000),0);
 assert.equal(next.used(66000),22000);assert.equal(next.used(88000),0);
});
test('torn reservation or settlement never grants uncommitted budget; invalid ledger is not overwritten',t=>{
 const s=setup(t);s.fail(true);assert.throws(()=>s.meter.reserve(1000,15000),/synthetic-full/);assert.equal(s.meter.used(2000),0);
 s.fail(false);const id=s.meter.reserve(2000,15000);s.fail(true);assert.throws(()=>s.meter.settle(id,3000,1000));
 assert.equal(s.restart().used(3000),15000);s.fail(false);
 const file=path.join(s.root,'asr-worker-budget.json');fs.writeFileSync(file,'{');assert.throws(()=>s.restart());assert.equal(fs.readFileSync(file,'utf8'),'{');
});
test('backwards wall clock and invalid duration cannot manufacture capacity',t=>{
 const s=setup(t),id=s.meter.reserve(100000,15000);assert.equal(s.meter.remaining(1000),5000);
 assert.throws(()=>s.meter.reserve(1000,5000),/BUSY/);assert.throws(()=>s.meter.settle(id,100001,-1),/TIME_INVALID/);
 s.meter.settle(id,90000,7000);assert.equal(s.restart().used(90000),7000);assert.equal(s.meter.used(160000),0);
});


test('unconfirmed exit keeps the allowance occupied beyond one rolling period and actual tail is settled',t=>{
 const s=setup(t),id=s.meter.reserve(1000,15000);s.meter.markExitPending(id,15000);
 assert.equal(s.restart().remaining(1000000),0);assert.equal(s.restart().hasReservation(1000000),true);
 s.meter.settle(id,90000,89000);assert.equal(s.restart().used(100000),89000);assert.equal(s.meter.remaining(150000),20000);
});
test('orphan recovery charges a fresh conservative cooldown once, including legacy unfinished records',t=>{
 const s=setup(t),id=s.meter.reserve(1000,15000);s.meter.markExitPending(id,25000);const next=s.restart();next.recoverOrphans(100000);
 const file=path.join(s.root,'asr-worker-budget.json'),saved=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(saved.rows[0].accounting,'orphan_conservative');assert.equal(saved.rows[0].usedMs,25000);assert.equal(saved.rows[0].finished,100000);
 const again=s.restart();again.recoverOrphans(110000);assert.equal(again.remaining(159999),0);assert.equal(again.remaining(160000),20000);
 saved.rows[0].finished=0;delete saved.rows[0].exitPending;delete saved.rows[0].accounting;saved.rows[0].usedMs=0;fs.writeFileSync(file,JSON.stringify(saved));
 const legacy=s.restart();legacy.recoverOrphans(200000);assert.equal(legacy.used(200000),20000);
});
test('orphan recovery failure leaves the reservation intact and blocks startup rather than granting capacity',t=>{
 const s=setup(t);s.meter.reserve(1000,15000);s.fail(true);assert.throws(()=>s.meter.recoverOrphans(100000),/synthetic-full/);
 const saved=JSON.parse(fs.readFileSync(path.join(s.root,'asr-worker-budget.json'),'utf8'));assert.equal(saved.rows[0].finished,0);
});

test('next admission predicts the first sufficient expiry without granting budget early',t=>{
 const s=setup(t);assert.equal(s.meter.nextAvailableAt(1000),1000);
 const a=s.meter.reserve(1000);s.meter.settle(a,3000,2000);
 const b=s.meter.reserve(4000);s.meter.settle(b,8000,4000);
 const c=s.meter.reserve(9000,14000);s.meter.settle(c,10000,1000);
 // 7s used; after the first 2s expires, a full 15s allowance fits exactly.
 assert.equal(s.restart().nextAvailableAt(11000),63000);
 assert.equal(s.meter.remaining(62999),13000);assert.throws(()=>s.meter.reserve(62999),/EXHAUSTED/);
 assert.equal(s.meter.remaining(63000),15000);s.meter.reserve(63000);
 assert.throws(()=>s.meter.nextAvailableAt(63000,0),/REQUEST_INVALID/);
});

test('unfinished and exit-pending reservations cannot be bypassed by a predicted wake',t=>{
 const s=setup(t),id=s.meter.reserve(1000);assert.equal(s.meter.nextAvailableAt(2000),61000);
 s.meter.markExitPending(id,20000);assert.equal(s.meter.nextAvailableAt(1000000),0);
 const next=s.restart();next.recoverOrphans(1000000);assert.equal(next.nextAvailableAt(1000001),1060000);
});
