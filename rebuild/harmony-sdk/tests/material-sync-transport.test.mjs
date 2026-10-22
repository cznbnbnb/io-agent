import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

function setup(t){
  const f=setupMaterialStore(t),calls=[],pending=[],principal={ownerId:'owner-test',producerId:'phone-test',serverId:'server-test'};
  let now=10000,handler=async()=>({responseCode:404,result:'',header:{}});
  const platform={'@kit.CoreFileKit':{fileIo:f.io},'@kit.NetworkKit':{http:{RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:1},
    createHttp(){const r={destroyed:false,destroy(){r.destroyed=true;},async request(url,options){calls.push({url,options,request:r});return handler(url,options);}};pending.push(r);return r;}}}};
  class ClockDate extends Date{static now(){return now;}}
  const out=loadApp('MaterialOutbox',platform),transport=loadApp('MaterialSyncTransport',platform,{Date:ClockDate}),wire=loadApp('MaterialWire',platform);
  const queue=new out.MaterialOutbox();queue.initialize(f.root,principal);const row=f.store.ensure(f.source,'合成网络文字');
  const e=wire.materialRevisionEvent(f.store,row.material_id,1,{eventId:'event-network-test',idempotencyKey:'idem-network-test',producerId:principal.producerId,createdAt:1000,expiresAt:100000});queue.enqueue(e);
  const target={baseUrl:'https://test.invalid/io-api/v1',token:'a'.repeat(43),principal},client=new transport.MaterialSyncTransport();
  const identity={schema_version:'1.0',server_id:principal.serverId,owner_id:principal.ownerId,producer_id:principal.producerId,scopes:['materials:write'],expires_at:new Date(100000).toISOString()};
  const ack={schema_version:'1.1',event_id:e.event_id,material_id:row.material_id,revision:1,commit_seq:1,stored_at:new Date(10000).toISOString(),receipt:{receipt_id:'receipt-network-test',subject_kind:'material',subject_id:row.material_id,subject_revision:1,stage:'server_stored',actor_id:'server-storage',related_event_id:e.event_id,error:null}};
  return{...f,...transport,queue,client,target,calls,pending,e,identity,ack,setHandler:v=>handler=v,setTime:v=>now=v};
}
const response=(body,status=200,header={})=>({responseCode:status,result:JSON.stringify(body),header});

test('transport confirms actual identity before POST and uses bounded HTTPS without redirects/cache',async t=>{
  const f=setup(t);f.setHandler(async url=>url.endsWith('/identity')?response(f.identity):response(f.ack,201));
  assert(await f.client.pump(f.queue,f.target));assert.equal(f.calls.length,2);assert(f.calls[0].url.endsWith('/identity'));
  const posted=f.calls[1];assert.equal(posted.options.extraData,JSON.stringify(f.e));assert.equal(posted.options.header.Authorization,'Bearer '+f.target.token);
  assert.equal(posted.options.maxRedirects,0);assert.equal(posted.options.usingCache,false);assert.equal(posted.options.maxLimit,16384);
  assert.equal(f.queue.all()[0].state,'server_stored');assert(f.pending.every(r=>r.destroyed));
});

test('wrong credential owner, producer, service, scope or expiry cannot send private text',async t=>{
  for(const patch of [{owner_id:'other'},{producer_id:'other'},{server_id:'other'},{scopes:['materials:read']},{expires_at:new Date(9999).toISOString()}]){
    const f=setup(t);f.setHandler(async()=>response({...f.identity,...patch}));assert.equal(await f.client.pump(f.queue,f.target),false);
    assert.equal(f.calls.length,1);assert.equal(f.queue.all()[0].attempts,0);assert.equal(f.client.note,'IDENTITY_MISMATCH');
  }
});

test('endpoint validation rejects insecure/userinfo/query/fragment/path ambiguity before creating HTTP',async t=>{
  const f=setup(t);
  for(const baseUrl of ['http://test.invalid/v1','https://user:secret@test.invalid/v1','https://test.invalid/v1?token=x','https://test.invalid/v1#x','https://test.invalid/a%2fv1','https://test.invalid/v1\\evil']){
    await assert.rejects(f.client.pump(f.queue,{...f.target,baseUrl}),/SYNC_TARGET_INVALID/);
  }
  await assert.rejects(f.client.pump(f.queue,{...f.target,principal:{...f.target.principal,ownerId:'other'}}),/SYNC_TARGET_INVALID/);
  assert.equal(f.calls.length,0);
});

test('network failure after POST reconciles by event ID and preserves the original payload',async t=>{
  const f=setup(t);let phase='fail';
  f.setHandler(async url=>{if(url.endsWith('/identity'))return response(f.identity);if(phase==='fail')throw new Error('private URL token details');return response(f.ack);});
  assert.equal(await f.client.pump(f.queue,f.target),false);assert.equal(f.queue.all()[0].needs_lookup,true);assert.equal(f.client.note,'TRANSPORT_UNKNOWN');
  phase='recover';f.setTime(12000);assert(await f.client.pump(f.queue,f.target));
  assert(f.calls.at(-1).url.endsWith('/events/'+f.e.event_id));assert.equal(f.calls.at(-1).options.extraData,undefined);
  assert.equal(f.queue.all()[0].state,'server_stored');assert(!JSON.stringify(f.queue.all()).includes('private URL'));
});

test('cancel after dispatch persists uncertainty and fences late successful response',async t=>{
  const f=setup(t);let release;f.setHandler(async url=>url.endsWith('/identity')?response(f.identity):new Promise(r=>release=r));
  const running=f.client.pump(f.queue,f.target);await new Promise(setImmediate);assert.equal(f.queue.all()[0].state,'sending');
  f.client.cancel();assert.equal(f.queue.all()[0].state,'retry_wait');assert(f.calls.at(-1).request.destroyed);
  assert.equal(await f.client.pump(f.queue,f.target),false);release(response(f.ack,201));assert.equal(await running,false);
  assert.equal(f.queue.all()[0].receipt_id,'');assert.equal(f.queue.all()[0].needs_lookup,true);
});

test('preflight failure obeys Retry-After without claiming an upload',async t=>{
  const f=setup(t);f.setHandler(async()=>response({error:{retry_after_ms:12000}},429,{'Retry-After':'9'}));
  assert.equal(await f.client.pump(f.queue,f.target),false);assert.equal(f.client.nextCheckAt,22000);assert.equal(f.queue.all()[0].attempts,0);
  f.setTime(21999);await f.client.pump(f.queue,f.target);assert.equal(f.calls.length,1);
  assert.equal(f.materialSyncRetryAfter({'Retry-After':new Date(30000).toUTCString()},'',10000),20000);
});

test('an account change while identity is pending never sends the new account text with the previous credential',async t=>{
  const f=setup(t);let release;f.setHandler(async()=>new Promise(resolve=>release=resolve));
  const running=f.client.pump(f.queue,f.target);await new Promise(setImmediate);assert.equal(f.calls.length,1);
  f.queue.initialize(f.root,{...f.target.principal,ownerId:'different-owner'});f.queue.enqueue({...f.e,body:{...f.e.body,full_text:{...f.e.body.full_text,text:'第二账户的合成文字'}}});
  release(response(f.identity));assert.equal(await running,false);assert.equal(f.calls.length,1);assert.equal(f.queue.all()[0].attempts,0);assert.equal(f.client.note,'IDENTITY_CHANGED');
});

test('mutable settings cannot replace an in-flight operation endpoint or bearer after identity validation',async t=>{
  const f=setup(t),originalToken=f.target.token,originalBase=f.target.baseUrl;let release;
  f.setHandler(async url=>url.endsWith('/identity')?new Promise(resolve=>release=resolve):response(f.ack,201));
  const running=f.client.pump(f.queue,f.target);await new Promise(setImmediate);
  f.target.token='b'.repeat(43);f.target.baseUrl='https://changed.invalid/v1';f.target.principal.ownerId='different-owner';
  release(response(f.identity));assert(await running);assert.equal(f.calls.length,2);
  assert.equal(f.calls[1].options.header.Authorization,'Bearer '+originalToken);assert.equal(f.calls[1].url,originalBase+'/material-events');
});

test('late POST success cannot confirm the new account ledger after coordinator reinitialization',async t=>{
  const f=setup(t);let release;f.setHandler(async url=>url.endsWith('/identity')?response(f.identity):new Promise(resolve=>release=resolve));
  const running=f.client.pump(f.queue,f.target);await new Promise(setImmediate);assert.equal(f.queue.all()[0].state,'sending');
  f.queue.initialize(f.root,{...f.target.principal,ownerId:'different-owner'});f.queue.enqueue(f.e);f.queue.claim(10000);
  release(response(f.ack,201));assert.equal(await running,false);assert.equal(f.client.note,'IDENTITY_CHANGED');assert.equal(f.queue.all()[0].receipt_id,'');
});
