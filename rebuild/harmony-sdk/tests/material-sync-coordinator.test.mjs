import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';
import {MaterialStore as ServerStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';

const response=(body,status=200)=>({responseCode:status,result:JSON.stringify(body),header:{}});
function fixture(t){
  const f=setupMaterialStore(t),calls=[],timers=new Map();let now=Date.now(),timerId=0;
  const principal={ownerId:'synthetic-owner',producerId:'synthetic-phone',serverId:'synthetic-server'};
  const target={baseUrl:'https://synthetic.invalid/v1',token:'a'.repeat(43),principal};
  const identity=()=>({schema_version:'1.0',server_id:principal.serverId,owner_id:principal.ownerId,producer_id:principal.producerId,
    scopes:['materials:write'],expires_at:new Date(now+86400000).toISOString()});
  const ack=e=>({schema_version:'1.1',event_id:e.event_id,material_id:e.body.material_id,revision:e.body.revision,
    commit_seq:e.body.revision,stored_at:new Date(now).toISOString(),receipt:{receipt_id:'receipt-'+e.body.revision,subject_kind:'material',
      subject_id:e.body.material_id,subject_revision:e.body.revision,stage:'server_stored',actor_id:'server-storage',related_event_id:e.event_id,error:null}});
  let handler=async(url,o)=>url.endsWith('/identity')?response(identity()):response(ack(JSON.parse(o.extraData)),201);
  const platform={'@kit.CoreFileKit':{fileIo:f.io},'@kit.NetworkKit':{http:{RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:1},
    createHttp(){const request={destroy(){},async request(url,options){calls.push({url,options});return handler(url,options);}};return request;}}}};
  class ClockDate extends Date{static now(){return now;}}
  const globals={Date:ClockDate,setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)};
  const {MaterialSyncCoordinator}=loadApp('MaterialSyncCoordinator',platform,globals);
  const coordinators=[];
  const create=()=>{const c=new MaterialSyncCoordinator(f.root,f.store);coordinators.push(c);return c;};
  t.after(async()=>{for(const c of coordinators)await c.stop();});
  return {...f,target,principal,identity,ack,calls,timers,platform,globals,create,setHandler:h=>handler=h,advance:ms=>now+=ms};
}

test('default/paused coordinator never discovers or sends; bounded foreground turns avoid idle HTTP',async t=>{
  const f=fixture(t),c=f.create();f.store.ensure(f.source,'仅合成文字');
  c.setForeground(true);await c.tick();assert.equal(f.calls.length,0);assert.equal(c.summary().enabled,false);
  assert(!fs.existsSync(path.join(f.root,'material-outbox')));
  c.setForeground(false);await c.configure(f.target);await c.tick();assert.equal(f.calls.length,0);assert.equal(c.summary().queued,0);
  c.setForeground(true);await c.tick();assert.equal(f.calls.length,2);assert.equal(c.summary().stored,1);
  await c.tick();assert.equal(f.calls.length,2,'no identity heartbeat when there is nothing to send');
  assert(f.timers.size<=1);assert([...f.timers.values()].every(x=>x.delay>=1000&&x.delay<=30000));
});

test('receipt view follows latest immutable revision, correction and tombstone without claiming audio uploaded',async t=>{
  const f=fixture(t),c=f.create(),a=f.store.ensure(f.source,'合成原文');
  await c.configure(f.target);c.setForeground(true);await c.tick();
  const original=fs.readFileSync(path.join(f.root,'materials',a.material_id,'revision-000000001.json'),'utf8');
  assert.equal(c.view(a.material_id).state,'server_stored');assert.equal(c.view(a.material_id).commitSeq,1);
  f.store.appendTranscript(a.material_id,1,f.input,'synthetic-asr');
  assert.equal(c.view(a.material_id).state,'local');assert.equal(c.view(a.material_id).storedRevision,1);assert.equal(c.view(a.material_id).receiptId,'');
  await c.tick();assert.equal(c.view(a.material_id).state,'server_stored');assert.equal(c.view(a.material_id).revision,2);
  f.store.delete(a.material_id,2);await c.tick();assert.equal(c.view(a.material_id).commitSeq,3);
  assert.equal(c.view(a.material_id).audioState,'not_scheduled');assert.equal(f.store.read(a.material_id).sync_state,'local');
  assert.equal(fs.readFileSync(path.join(f.root,'materials',a.material_id,'revision-000000001.json'),'utf8'),original);
  assert.equal(JSON.parse(f.calls.filter(x=>x.options.extraData).at(-1).options.extraData).body.operation,'delete');
});

test('unknown POST survives coordinator restart and is looked up without replaying or changing event bytes',async t=>{
  const f=fixture(t),c=f.create(),a=f.store.ensure(f.source,'合成断网资料');let accepted;
  f.setHandler(async(url,o)=>{if(url.endsWith('/identity'))return response(f.identity());accepted=JSON.parse(o.extraData);throw Error('synthetic lost reply');});
  await c.configure(f.target);c.setForeground(true);await c.tick();assert.equal(c.view(a.material_id).state,'retry_wait');
  await c.stop();f.advance(60000);
  const next=f.create();f.setHandler(async url=>url.endsWith('/identity')?response(f.identity()):response(f.ack(accepted)));
  await next.configure(f.target);next.setForeground(true);await next.tick();
  assert.equal(next.view(a.material_id).state,'server_stored');assert.equal(f.calls.filter(x=>x.options.extraData).length,1);
  assert(f.calls.at(-1).url.endsWith('/events/'+accepted.event_id));
});

test('disable drains cancelled exchange before re-enabling same ledger and fences its late receipt',async t=>{
  const f=fixture(t),c=f.create(),a=f.store.ensure(f.source,'合成晚回复');let release,event;
  f.setHandler(async(url,o)=>{if(url.endsWith('/identity'))return response(f.identity());event=JSON.parse(o.extraData);return new Promise(r=>release=r);});
  await c.configure(f.target);c.setForeground(true);const running=c.tick();await new Promise(setImmediate);
  assert.equal(c.view(a.material_id).state,'sending');let configured=false;
  const disabled=c.configure(undefined),enabled=c.configure(f.target).then(()=>configured=true);
  await new Promise(setImmediate);assert.equal(configured,false);assert.equal(c.view(a.material_id).receiptId,'');
  release(response(f.ack(event),201));await Promise.all([running,disabled,enabled]);
  assert.equal(c.view(a.material_id).state,'retry_wait');assert.equal(c.view(a.material_id).receiptId,'');
  f.advance(60000);f.setHandler(async url=>url.endsWith('/identity')?response(f.identity()):response(f.ack(event)));
  await c.tick();assert.equal(c.view(a.material_id).state,'server_stored');assert.equal(f.calls.filter(x=>x.options.extraData).length,1);
});

test('pause cancels pending identity; invalid identity and blocked predecessors cannot upload later history',async t=>{
  const f=fixture(t),c=f.create(),a=f.store.ensure(f.source,'合成隐私');f.store.appendTranscript(a.material_id,1,f.input,'asr');let release;
  f.setHandler(async()=>new Promise(r=>release=r));await c.configure(f.target);c.setForeground(true);
  const running=c.tick();await new Promise(setImmediate);c.setForeground(false);release(response(f.identity()));await running;
  assert.equal(f.calls.length,1);assert.equal(c.summary().note,'paused');assert.equal(c.view(a.material_id).storedRevision,0);
  f.setHandler(async()=>response({...f.identity(),owner_id:'another-owner'}));c.setForeground(true);await c.tick();
  assert.equal(c.summary().note,'IDENTITY_MISMATCH');assert.equal(f.calls.filter(x=>x.options.extraData).length,0);
  assert.equal([...f.timers.values()][0].delay,30000);
  f.advance(60000);f.setHandler(async(url)=>url.endsWith('/identity')?response(f.identity()):response({error:{code:'MATERIAL_CONFLICT'}},409));
  await c.tick();assert.equal(c.summary().blocked,1);assert.equal(c.view(a.material_id).state,'queued');
  assert.equal(f.calls.filter(x=>x.options.extraData).length,1,'revision two cannot bypass rejected revision one');
  await c.tick();assert.equal(f.calls.filter(x=>x.options.extraData).length,1);assert.equal([...f.timers.values()][0].delay,30000);
});

test('one turn has bounded discovery and four uploads even with a large backlog; concurrent ticks share one flight',async t=>{
  const f=fixture(t),c=f.create();for(let n=0;n<12;n++)f.store.ensure({...f.source,name:'take-'+n.toString(16).padStart(32,'0')},'合成积压');
  await c.configure(f.target);c.setForeground(true);const one=c.tick(),two=c.tick();assert.equal(one,two);await one;
  assert.equal(c.summary().stored,4);assert.equal(c.summary().queued,4);assert.equal(f.calls.filter(x=>x.options.extraData).length,4);
  await c.tick();assert.equal(c.summary().stored,8);assert.equal(c.summary().queued,4);
});

test('coordinator sends original/update/delete to real local service and restart preserves matching durable receipts',async t=>{
  const f=fixture(t),service=new ServerStore(path.join(f.root,'service.sqlite'));
  const auth=service.mint({owner:f.principal.ownerId,producer:f.principal.producerId,scopes:['materials:write','materials:read']});
  const identity=service.identity(auth.token);f.principal.serverId=identity.server_id;f.target.token=auth.token;
  const server=await listen(service),base='http://127.0.0.1:'+server.address().port;
  try{
    f.setHandler(async(url,o)=>{const r=await fetch(base+new URL(url).pathname,{method:o.method,headers:o.header,body:o.extraData});return {responseCode:r.status,result:await r.text(),header:{}};});
    const a=f.store.ensure(f.source,'合成真实本机服务');f.store.appendTranscript(a.material_id,1,f.input,'asr');f.store.delete(a.material_id,2);
    const c=f.create();await c.configure(f.target);c.setForeground(true);await c.tick();
    const view=JSON.parse(JSON.stringify(c.view(a.material_id)));assert.equal(view.state,'server_stored');assert.equal(view.commitSeq,3);
    assert.equal(service.ceiling(f.principal.ownerId),3);await c.stop();
    const next=f.create();await next.configure(f.target);next.setForeground(true);await next.tick();
    assert.deepEqual(JSON.parse(JSON.stringify(next.view(a.material_id))),view);assert.equal(service.ceiling(f.principal.ownerId),3);
    assert.equal((await fetch(base+'/v1/materials/'+a.material_id,{headers:{Authorization:'Bearer '+auth.token}})).status,410);
  }finally{await new Promise(resolve=>server.close(resolve));service.close();}
});

test('expired delivery requires an authenticated absence check before explicit renewal of the same body',async t=>{
  const f=fixture(t),c=f.create(),a=f.store.ensure(f.source,'合成过期资料');
  f.setHandler(async()=>{throw Error('synthetic offline before dispatch');});
  await c.configure(f.target);c.setForeground(true);await c.tick();
  const partition=path.join(f.root,'material-outbox',fs.readdirSync(path.join(f.root,'material-outbox'))[0]);
  const original=JSON.parse(fs.readFileSync(path.join(partition,'state.json'),'utf8')).rows[0];
  const body=JSON.parse(fs.readFileSync(path.join(partition,original.queue_id+'.payload.json'),'utf8')).body;
  f.advance(8*86400000);f.setHandler(async url=>url.endsWith('/identity')?response(f.identity()):response({schema_version:'1.0',error:{code:'EVENT_NOT_FOUND',retryable:false}},404));
  await c.tick();let problem=c.problems()[0];assert.equal(problem.state,'expired');assert.equal(problem.canRenew,false);
  assert.throws(()=>c.recover(problem.queueId,'renew'),/REQUIRES_ABSENCE/);
  c.recover(problem.queueId,'recheck');await c.tick();problem=c.problems()[0];assert.equal(problem.canRenew,true);
  c.recover(problem.queueId,'renew');assert.equal(c.view(a.material_id).state,'queued');assert.equal(c.problems().length,0);
  f.setHandler(async(url,o)=>url.endsWith('/identity')?response(f.identity()):response(f.ack(JSON.parse(o.extraData)),201));
  await c.tick();const submitted=JSON.parse(f.calls.at(-1).options.extraData);
  assert.notEqual(submitted.event_id,original.event_id);assert.deepEqual(submitted.body,body);assert.equal(c.view(a.material_id).state,'server_stored');
  assert.equal(f.store.read(a.material_id).revision,1);
});

test('explicit recovery addresses one principal-bound row and reconciles an incomplete ACK without bulk retry',async t=>{
  const f=fixture(t),c=f.create();f.store.ensure(f.source,'private synthetic one');
  f.store.ensure({...f.source,name:'take-'+'b'.repeat(32)},'private synthetic two');const accepted=new Map();
  f.setHandler(async(url,o)=>{if(url.endsWith('/identity'))return response(f.identity());const e=JSON.parse(o.extraData);accepted.set(e.event_id,e);return response({incomplete:true},201);});
  await c.configure(f.target);c.setForeground(true);await c.tick();assert.equal(c.problems().length,2);
  const first=c.problems()[0];assert(first.canRecheck);assert(!JSON.stringify(c.problems()).includes('private synthetic'));
  f.setHandler(async url=>url.endsWith('/identity')?response(f.identity()):response(f.ack(accepted.get(decodeURIComponent(url.split('/').at(-1))))));
  c.recover(first.queueId,'recheck');await c.tick();assert.equal(c.summary().stored,1);assert.equal(c.summary().blocked,1);
  assert.equal(f.calls.filter(x=>x.options.extraData).length,2,'no second POST after reconciliation');
  const stale=c.problems()[0];await c.configure({...f.target,principal:{...f.principal,ownerId:'different-owner'}});
  assert.throws(()=>c.recover(stale.queueId,'recheck'),/NOT_FOUND/);assert.equal(c.summary().blocked,0);
  await c.configure(undefined);assert.throws(()=>c.recover(stale.queueId,'recheck'),/BUSY/);
});

test('corrupted payload remains blocked and cannot be unlocked by the recovery control',async t=>{
  const f=fixture(t),c=f.create();f.store.ensure(f.source,'synthetic original');
  f.setHandler(async()=>{
    const root=path.join(f.root,'material-outbox',fs.readdirSync(path.join(f.root,'material-outbox'))[0]);
    for(const file of fs.readdirSync(root).filter(x=>x.endsWith('.payload.json')))fs.writeFileSync(path.join(root,file),'broken');
    return response(f.identity());
  });
  await c.configure(f.target);c.setForeground(true);await c.tick();const problem=c.problems()[0];
  assert.equal(problem.error,'PAYLOAD_CORRUPT');assert.equal(problem.canRecheck,false);assert.equal(problem.canRenew,false);
  assert.throws(()=>c.recover(problem.queueId,'recheck'),/NOT_ALLOWED/);assert.equal(c.summary().blocked,1);
});
