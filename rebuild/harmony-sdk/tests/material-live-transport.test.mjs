import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {setupMaterialStore} from './material-fixture.mjs';
import {loadApp} from './load-app.mjs';

// The device run is the real network experiment; this harness only proves the phase
// wiring: an operator-pushed target file is read, exactly one authenticated pump runs,
// and a receipt the service did not send can never be recorded.
function setup(t,{identityPatch={},status=201,ack='real'}={}){
  const f=setupMaterialStore(t),calls=[],principal={ownerId:'turboio-user',producerId:'phone-harmony',serverId:'server-live'};
  let handler=async()=>({responseCode:404,result:'',header:{}});
  let connected=true;
  const platform={'@kit.CoreFileKit':{fileIo:f.io},'@kit.NetworkKit':{connection:{hasDefaultNet:async()=>connected},http:{RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:1},
    createHttp(){const r={destroy(){},async request(url,options){calls.push({url,options});return handler(url,options);}};return r;}}}};
  platform['./LocalAsrQueue']=loadApp('LocalAsrQueue',platform);
  class ClockDate extends Date{static now(){return 1791725000000;}}
  const target=path.join(f.root,'p31-material-outbox-lab');
  fs.mkdirSync(target,{recursive:true});
  const config={schema:1,base_url:'https://cznbnb.cn/io-api/v1',token:'a'.repeat(43),owner_id:principal.ownerId,
    producer_id:principal.producerId,server_id:principal.serverId};
  fs.writeFileSync(path.join(target,'sync-target.json'),JSON.stringify(config));
  const identity={schema_version:'1.0',server_id:principal.serverId,owner_id:principal.ownerId,producer_id:principal.producerId,
    scopes:['materials:write'],expires_at:new Date(1791725000000+3600000).toISOString(),...identityPatch};
  const ackBody={schema_version:'1.1',event_id:'live-1791725000000-r1',material_id:'',revision:1,commit_seq:7,
    stored_at:new Date(1791725000000).toISOString(),duplicate_of:null,
    receipt:{receipt_id:'real-receipt-1',subject_kind:'material',subject_id:'',subject_revision:1,stage:'server_stored',
      actor_id:'server-storage',related_event_id:'live-1791725000000-r1',error:null}};
  const materialId=f.store.idFor('recording','take-'+run.padEnd(32,'0'));
  const mod=loadApp('PersistenceLab',platform,{Date:ClockDate,setTimeout,clearTimeout});
  return {...f,mod,principal,calls,config,identity,ackBody,status,ack,materialId,setHandler:v=>handler=v,setConnected:v=>connected=v,targetDir:target,
    Lab:new mod.PersistenceLab()};
}
const response=(body,status=200)=>({responseCode:status,result:JSON.stringify(body),header:{}});
const run='1791725000000';
test('coordinated native phase discovers three immutable revisions; cold resume retains receipts without HTTP',async t=>{
  const f=setup(t);
  f.setHandler(async(url,o)=>{
    if(url.endsWith('/identity'))return response(f.identity);
    const event=JSON.parse(o.extraData),ack=structuredClone(f.ackBody),revision=event.body.revision;
    Object.assign(ack,{event_id:event.event_id,material_id:event.body.material_id,revision,commit_seq:revision});
    Object.assign(ack.receipt,{receipt_id:'synthetic-'+revision,subject_id:event.body.material_id,subject_revision:revision,related_event_id:event.event_id});
    return response(ack,201);
  });
  const seed=await f.Lab.runCoordinatedLive(f.root,'coordinator-live',run);
  assert.equal(seed.status,'passed',seed.error);assert.equal(seed.outbox.length,3);assert.equal(seed.sync_views[0].revision,3);
  assert.equal(f.calls.filter(c=>c.options.extraData).length,3);const before=f.calls.length;
  const next=new f.mod.PersistenceLab(),resume=await next.runCoordinatedLive(f.root,'coordinator-resume',run);
  assert.equal(resume.status,'passed',resume.error);assert.equal(f.calls.length,before);
  assert.deepEqual([...resume.outbox].map(r=>r.receipt_id),[...seed.outbox].map(r=>r.receipt_id));
});
test('coordinated phase never fabricates a receipt when real identity verification fails',async t=>{
  const f=setup(t);f.setHandler(async()=>response({...f.identity,owner_id:'another-owner'}));
  const report=await f.Lab.runCoordinatedLive(f.root,'coordinator-live',run);
  assert.equal(report.status,'failed');assert.equal(report.error,'COORDINATED_LIVE_FAILED');
  assert(report.outbox.every(r=>r.receipt_id===''));assert.equal(f.calls.filter(c=>c.options.extraData).length,0);
});
test('offline native phase requires observed absent default network and retains undispatched history',async t=>{
  const f=setup(t);f.setConnected(false);f.setHandler(async()=>{throw Error('synthetic no route');});
  const report=await f.Lab.runCoordinatedLive(f.root,'coordinator-offline',run);
  assert.equal(report.status,'passed',report.error);assert.equal(report.default_network_before,false);assert.equal(report.default_network_after,false);
  assert(report.outbox.every(row=>row.attempts===0&&row.receipt_id===''));assert.equal(f.calls.filter(x=>x.options.extraData).length,0);
});
test('offline phase rejects a connected phone before creating synthetic history or issuing HTTP',async t=>{
  const f=setup(t),report=await f.Lab.runCoordinatedLive(f.root,'coordinator-offline',run);
  assert.equal(report.status,'failed');assert.equal(report.default_network_before,true);assert.equal(f.calls.length,0);assert.equal(report.outbox.length,0);
});
// The stubbed service derives the echoed ids from the posted envelope, like the real one.
function ackHandler(f){
  return async url=>{
    if(url.endsWith('/identity'))return response(f.identity);
    const payload=JSON.parse(f.calls.at(-1).options.extraData);
    const ack=structuredClone(f.ackBody);
    ack.event_id=payload.event_id;ack.material_id=payload.body.material_id;
    ack.receipt.subject_id=payload.body.material_id;ack.receipt.related_event_id=payload.event_id;
    return response(ack,201);
  };
}

test('live phase performs one authenticated pump and records only the real server receipt',async t=>{
  const f=setup(t);
  f.setHandler(ackHandler(f));
  const report=await f.Lab.runLive(f.root,'transport-live',run);
  assert.equal(report.status,'passed',report.error);
  assert.deepEqual([...report.checks],['fresh_live_fixture','live_server_stored_receipt','live_server_commit_recorded','live_single_attempt_settled']);
  assert.equal(report.kind,'live_p31_transport');assert.equal(report.target_host,'https://cznbnb.cn/io-api/v1');
  assert.equal(report.target_producer,'phone-harmony');
  assert.equal(f.calls.length,2);assert(f.calls[0].url.endsWith('/identity'));assert(f.calls[1].url.endsWith('/material-events'));
  assert.equal(f.calls[1].options.header.Authorization,'Bearer '+'a'.repeat(43));
  assert.equal(report.outbox[0].state,'server_stored');assert.equal(report.outbox[0].receipt_id,'real-receipt-1');
  assert.equal(report.outbox[0].server_commit_seq,7);assert.equal(report.pump_notes.at(-1),'processed');
  // The token must never be copied into the report, and local sync state stays untouched.
  assert.ok(!JSON.stringify(report).includes('a'.repeat(43)));
  assert.equal(report.local_sync_state,'local');
  assert.equal(report.events[0].producer_id,'phone-harmony');
});

test('live phase refuses a mismatched identity or missing target instead of inventing success',async t=>{
  const mismatched=setup(t,{identityPatch:{server_id:'other-server'}});
  mismatched.setHandler(async url=>url.endsWith('/identity')?response(mismatched.identity):response(mismatched.ackBody,201));
  const rejected=await mismatched.Lab.runLive(mismatched.root,'transport-live',run);
  assert.equal(rejected.status,'failed');
  assert.equal(rejected.outbox[0].state,'queued');assert.equal(rejected.outbox[0].receipt_id,'');
  assert.equal(mismatched.calls.length,1);assert.equal(rejected.pump_notes.at(-1),'IDENTITY_MISMATCH');
  const missing=setup(t);
  fs.rmSync(path.join(missing.targetDir,'sync-target.json'));
  const absent=await missing.Lab.runLive(missing.root,'transport-live',run);
  assert.equal(absent.status,'failed');assert.equal(absent.error,'LIVE_TARGET_MISSING');assert.equal(missing.calls.length,0);
});

test('operator-supplied target is persisted privately and then used like a pushed file',async t=>{
  const f=setup(t);
  fs.rmSync(path.join(f.targetDir,'sync-target.json'));
  f.setHandler(ackHandler(f));
  const pushed={schema:1,base_url:'https://cznbnb.cn/io-api/v1',token:'b'.repeat(43),owner_id:'turboio-user',
    producer_id:'phone-harmony',server_id:'server-live'};
  const report=await f.Lab.runLive(f.root,'transport-live',run,pushed);
  assert.equal(report.status,'passed',report.error);
  const stored=JSON.parse(fs.readFileSync(path.join(f.targetDir,'sync-target.json'),'utf8'));
  assert.deepEqual(stored,pushed);
  assert.equal(f.calls[0].options.header.Authorization,'Bearer '+'b'.repeat(43));
  // A second run must reuse the persisted target, not the supplied one.
  const second={...pushed,token:'c'.repeat(43)};
  const again=await f.Lab.runLive(f.root,'transport-live','1791725000001',second);
  assert.equal(again.status,'passed',again.error);
  assert.equal(f.calls.at(-1).options.header.Authorization,'Bearer '+'b'.repeat(43));
});
