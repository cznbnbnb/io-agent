import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {loadApp} from './load-app.mjs';import {setupMaterialStore} from './material-fixture.mjs';
import {MaterialStore as ServerStore} from '../../material-server/store.mjs';import {listen} from '../../material-server/http.mjs';
const require=createRequire(import.meta.url);function dependency(name){try{return require(name);}catch{return require('../../../tools/deveco-cli/node_modules/'+name);}}
const Ajv=dependency('ajv/dist/2020.js'),formats=dependency('ajv-formats'),ajv=new Ajv({strict:false,allErrors:true});formats(ajv);
const contracts=new URL('../../../docs/contracts/',import.meta.url);for(const name of ['event-v1.schema.json','event-v1.1.schema.json'])ajv.addSchema(JSON.parse(fs.readFileSync(new URL(name,contracts))));
const v12=ajv.compile(JSON.parse(fs.readFileSync(new URL('event-v1.2.schema.json',contracts)))),v11=ajv.getSchema('https://turboio.local/contracts/v1.1/event.schema.json');
const plain=v=>JSON.parse(JSON.stringify(v));
function setup(t){
 const f=setupMaterialStore(t),calls=[],requests=[],principal={ownerId:'synthetic-owner',producerId:'synthetic-phone',serverId:'synthetic-server'};let now=10000,handler=async()=>({responseCode:404,result:'',header:{}});
 const platform={'@kit.CoreFileKit':{fileIo:f.io},'@kit.NetworkKit':{http:{RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:1},createHttp(){const request={destroyed:false,destroy(){request.destroyed=true;},async request(url,options){calls.push({url,options});return handler(url,options);}};requests.push(request);return request;}}}};
 class Clock extends Date{static now(){return now;}}
 const w=loadApp('MaterialWire',platform),out=loadApp('MaterialOutbox',platform),transport=loadApp('MaterialSyncTransport',platform,{Date:Clock});
 const queue=new out.MaterialOutbox();queue.initialize(f.root,principal);const client=new transport.MaterialSyncTransport(),target={baseUrl:'https://synthetic.invalid/v1',token:'s'.repeat(43),principal};
 const identity={schema_version:'1.0',owner_id:principal.ownerId,producer_id:principal.producerId,server_id:principal.serverId,scopes:['materials:write'],expires_at:new Date(1000000).toISOString()};
 f.input.text='今日中文🙂建议。';f.input.utterances[0].text=f.input.text;Object.assign(f.input,{transcriptionState:'complete',coveredMs:60000,sourceMs:60000,speakerProcessing:'pending',boundaryProcessing:'token_starts'});
 const first=f.store.ensure(f.source),second=f.store.appendTranscript(first.material_id,1,f.input,'synthetic-asr');
 const op=new f.MaterialSpeakerCorrection();Object.assign(op,{operation_id:'synthetic-rename-op',kind:'rename',speaker_id:'speaker-0',label:'合成项目记录人'});const third=f.store.correctSpeakers(first.material_id,2,op);
 const make=(revision=3,id=first.material_id)=>w.materialRevisionEvent(f.store,id,revision,{eventId:'synthetic-event-'+id+'-'+revision,idempotencyKey:'synthetic-idem-'+id+'-'+revision,producerId:principal.producerId,createdAt:1000,expiresAt:1000000});
 const ack=e=>({schema_version:e.schema_version,event_id:e.event_id,material_id:e.body.material_id,revision:e.body.revision,commit_seq:e.body.revision,stored_at:new Date(now).toISOString(),receipt:{receipt_id:'synthetic-receipt-'+e.event_id,subject_kind:'material',subject_id:e.body.material_id,subject_revision:e.body.revision,stage:'server_stored',actor_id:'server-storage',related_event_id:e.event_id,error:null}});
 function confirmPredecessors(){for(const n of [1,2]){const e=make(n);queue.enqueue(e);const c=queue.claim(now);assert.equal(c.eventId,e.event_id);queue.finish(c,201,JSON.stringify(ack(e)),now);}}
 return {...f,w,out,transport,queue,client,target,identity,principal,calls,requests,first,second,third,make,ack,confirmPredecessors,setTime:v=>now=v,now:()=>now,setHandler:v=>handler=v,
  restart(){const q=new out.MaterialOutbox();q.initialize(f.root,principal);return q;}};
}
const response=(body,status=200)=>({responseCode:status,result:JSON.stringify(body),header:{}});

test('wire upgrades only dictionary revisions, preserves exact split ranges/null times and excludes private speaker metadata',t=>{
 const f=setup(t),legacy=f.make(2),named=f.make(3);assert.equal(legacy.schema_version,'1.1');assert(v11(legacy),JSON.stringify(v11.errors));assert.equal(Object.hasOwn(legacy.body,'speakers'),false);assert.equal(Object.hasOwn(legacy.body.utterances[0],'source_range'),false);
 assert.equal(named.schema_version,'1.2');assert(v12(named),JSON.stringify(v12.errors));assert.equal(named.body.speakers[0].label,'合成项目记录人');assert.equal(named.body.speakers[0].label_basis,'user_confirmed');assert.equal(named.body.utterances[0].speaker_basis,'segment_cluster');assert.equal(named.body.processing.speaker,'pending');
 const op=new f.MaterialSpeakerCorrection();Object.assign(op,{operation_id:'synthetic-split-op',kind:'split',utterance_ids:[f.third.utterances[0].utterance_id],split_offset:4});const split=f.store.correctSpeakers(f.first.material_id,3,op),e=f.make(4);
 assert(v12(e),JSON.stringify(v12.errors));assert.equal(e.body.utterances[0].start_ms,null);assert.equal(e.body.utterances[0].end_ms,null);assert.deepEqual(plain(e.body.utterances[0].source_range),plain(split.utterances[0].source_range));assert.equal(e.body.processing.boundary,'unknown');
 const noisy=plain(split);Object.assign(noisy.speakers[0],{embedding:'private-voice',bio:'private-bio',role:{private:true}});
 const sanitized=f.w.materialRevisionEvent({read:()=>noisy},f.first.material_id,4,{eventId:'sanitized-event',idempotencyKey:'sanitized-idem',producerId:f.principal.producerId,createdAt:1000,expiresAt:1000000});
 assert.deepEqual(Object.keys(sanitized.body.speakers[0]).sort(),['is_self','label','label_basis','speaker_id']);assert(!JSON.stringify(sanitized).includes('private-'));
 assert(v12(sanitized),JSON.stringify(v12.errors));assert.equal(f.store.read(f.first.material_id,2).speakers,undefined,'legacy immutable version remains old format');
});

test('empty dictionary tombstones remain 1.2 while no-dictionary ordinary rows stay 1.1',t=>{
 const f=setup(t),deleted=f.store.delete(f.first.material_id,3),event=f.make(4);assert.equal(event.schema_version,'1.2');assert(v12(event),JSON.stringify(v12.errors));assert.deepEqual(plain(event.body.speakers),[]);assert.deepEqual(plain(event.body.utterances),[]);assert.equal(event.body.full_text.text,'');
 const row=plain(f.second);row.utterances[0].start_ms=null;row.utterances[0].end_ms=null;
 assert.throws(()=>f.w.materialRevisionEvent({read:()=>row},row.material_id,2,{eventId:'no-dictionary',idempotencyKey:'no-dictionary-idem',producerId:f.principal.producerId,createdAt:1000,expiresAt:1000000}),/SCHEMA_REQUIRED/);
});

test('unsupported schema never claims a send, survives restart and later uploads the same bytes after server upgrade',async t=>{
 const f=setup(t);f.confirmPredecessors();const e=f.make(),enqueued=f.queue.enqueue(e),original=JSON.stringify(e);f.setHandler(async()=>response(f.identity));
 assert.equal(await f.client.pump(f.queue,f.target),false);assert.equal(f.calls.length,1);assert.equal(f.client.note,'SCHEMA_UNSUPPORTED');assert.equal(f.client.nextCheckAt,40000);
 const held=f.queue.all().find(r=>r.queue_id===enqueued.queue_id);assert.equal(held.state,'queued');assert.equal(held.attempts,0);assert.equal(held.needs_lookup,false);assert.equal(held.last_error,'SCHEMA_UNSUPPORTED');assert.equal(held.next_attempt_at,40000);
 for(let i=0;i<3;i++)assert.equal(await f.client.pump(f.queue,f.target),false);assert.equal(f.calls.length,1,'no tight preflight loop');
 const restarted=f.restart();assert.equal(restarted.all().find(r=>r.queue_id===held.queue_id).payload_hash,held.payload_hash);assert.equal(restarted.claim(39999,['1.1','1.2']),undefined);
 f.setTime(40000);f.setHandler(async url=>url.endsWith('/identity')?response({...f.identity,material_schema_versions:['1.0','1.1','1.2']}):response(f.ack(e),201));
 assert(await f.client.pump(restarted,f.target));assert.equal(f.calls.at(-1).options.extraData,original);assert.equal(restarted.all().find(r=>r.queue_id===held.queue_id).state,'server_stored');assert.equal(restarted.all().find(r=>r.queue_id===held.queue_id).attempts,1);
});

test('schema gate lets unrelated 1.1 work continue and malformed or empty advertisements cannot grant 1.2',async t=>{
 const f=setup(t);f.confirmPredecessors();const modern=f.make();f.queue.enqueue(modern);
 const other=f.store.ensure({...f.source,name:'take-'+'b'.repeat(32)},'另一条旧格式合成文字'),legacy=f.make(1,other.material_id);f.queue.enqueue(legacy);
 f.setHandler(async url=>url.endsWith('/identity')?response(f.identity):response(f.ack(legacy),201));assert(await f.client.pump(f.queue,f.target));assert.equal(f.calls.at(-1).options.extraData,JSON.stringify(legacy));assert.equal(f.queue.all().find(r=>r.material_id===modern.body.material_id&&r.revision===3).attempts,0);
 for(const malformed of [null,'1.2',[1.2],['1.2\n']]){const g=setup(t);g.confirmPredecessors();g.queue.enqueue(g.make());g.setHandler(async()=>response({...g.identity,material_schema_versions:malformed}));assert.equal(await g.client.pump(g.queue,g.target),false);assert.equal(g.calls.length,1);assert.equal(g.client.note,'IDENTITY_MISMATCH');assert.equal(g.queue.all().at(-1).last_error,'');}
 const g=setup(t);g.confirmPredecessors();g.queue.enqueue(g.make());g.setHandler(async()=>response({...g.identity,material_schema_versions:[]}));await g.client.pump(g.queue,g.target);assert.equal(g.client.note,'SCHEMA_UNSUPPORTED');assert.equal(g.queue.all().at(-1).needs_lookup,false);
});

test('uncertain 1.2 lookup still works against a server without version advertising, and 404 only gates the next POST',async t=>{
 const f=setup(t);f.confirmPredecessors();const e=f.make();f.queue.enqueue(e);const sent=f.queue.claim(10000);f.queue.finish(sent,0,'',10000);f.setTime(12000);
 f.setHandler(async url=>url.endsWith('/identity')?response(f.identity):response(f.ack(e)));assert(await f.client.pump(f.queue,f.target));assert(f.calls.at(-1).url.endsWith('/events/'+e.event_id));assert.equal(f.calls.at(-1).options.extraData,undefined);assert.equal(f.queue.all().at(-1).state,'server_stored');
 const g=setup(t);g.confirmPredecessors();const unknown=g.make();g.queue.enqueue(unknown);g.queue.finish(g.queue.claim(10000),0,'',10000);g.setTime(12000);g.setHandler(async url=>url.endsWith('/identity')?response(g.identity):response({schema_version:'1.0',error:{code:'EVENT_NOT_FOUND',retryable:false}},404));
 assert(await g.client.pump(g.queue,g.target));assert.equal(g.queue.all().at(-1).needs_lookup,false);const attempts=g.queue.all().at(-1).attempts;
 assert.equal(await g.client.pump(g.queue,g.target),false);assert.equal(g.queue.all().at(-1).attempts,attempts);assert.equal(g.queue.all().at(-1).last_error,'SCHEMA_UNSUPPORTED');assert(g.calls.every(call=>call.options.extraData===undefined));
});

test('1.2 expired renewal retains schema and exact body, and mismatched ACK versions never confirm storage',t=>{
 const f=setup(t);f.confirmPredecessors();const e=f.make(),row=f.queue.enqueue(e);assert.equal(f.queue.claim(1000001),undefined);assert(f.queue.recheckExpired(row.queue_id));const lookup=f.queue.claim(1000001,[]);assert.equal(lookup.action,'lookup');f.queue.finish(lookup,404,JSON.stringify({schema_version:'1.0',error:{code:'EVENT_NOT_FOUND',retryable:false}}),1000001);
 const renewed=f.queue.renewExpired(row.queue_id,1000002),claim=f.queue.claim(1000002,['1.2']),payload=JSON.parse(claim.payload);assert.equal(payload.schema_version,'1.2');assert.deepEqual(payload.body,plain(e.body));assert.equal(renewed.history.length,1);
 f.queue.finish(claim,201,JSON.stringify({...f.ack(payload),schema_version:'1.1'}),1000002);assert.equal(f.queue.all().at(-1).state,'blocked');assert.equal(f.queue.all().at(-1).last_error,'ACK_INVALID');assert.equal(f.queue.all().at(-1).receipt_id,'');
});
test('a schema wait does not postpone an unrelated earlier uncertain lookup',async t=>{
 const f=setup(t);f.confirmPredecessors();f.queue.enqueue(f.make());
 const input=new f.MaterialTextInput();input.text='其他资料的合成已存文字';input.speakers=[];
 const other=f.store.ensure({...f.source,name:'take-'+'c'.repeat(32)},input.text,input),event=f.make(1,other.material_id);f.queue.enqueue(event);
 const sent=f.queue.claim(10000);assert.equal(sent.eventId,event.event_id);f.queue.finish(sent,0,'',10000);f.setHandler(async url=>url.endsWith('/identity')?response(f.identity):response(f.ack(event)));
 assert.equal(await f.client.pump(f.queue,f.target),false);assert.equal(f.client.note,'SCHEMA_UNSUPPORTED');assert.equal(f.client.nextCheckAt,11000);
 f.setTime(11000);assert(await f.client.pump(f.queue,f.target));assert(f.calls.at(-1).url.endsWith('/events/'+event.event_id));assert.equal(f.queue.all().find(r=>r.event_id===event.event_id).state,'server_stored');assert.equal(f.queue.all().find(r=>r.revision===3).attempts,0);
});

test('schema deferral disk failure cannot create dispatch uncertainty or a phantom persisted hold',async t=>{
 const f=setup(t);f.confirmPredecessors();f.queue.enqueue(f.make());f.failPromotion(true);f.setHandler(async()=>response(f.identity));assert.equal(await f.client.pump(f.queue,f.target),false);assert.equal(f.client.note,'OUTBOX_PERSIST_FAILED');
 const row=f.queue.all().at(-1);assert.equal(row.state,'queued');assert.equal(row.needs_lookup,false);assert.equal(row.attempts,0);assert.equal(row.last_error,'');assert.equal(f.calls.length,1);f.failPromotion(false);assert.equal(f.restart().all().at(-1).needs_lookup,false);
});

test('actual ArkTS wire/outbox/transport POST 1.2 corrections losslessly to temporary HTTP and SQLite',async t=>{
 const f=setup(t),serverStore=new ServerStore(path.join(f.root,'speaker-wire-server.sqlite'),{clock:()=>10000}),auth=serverStore.mint({owner:'synthetic-owner',producer:'synthetic-phone',scopes:['materials:write','materials:read','changes:read']}),server=await listen(serverStore),base='http://127.0.0.1:'+server.address().port;
 try{
  const p=serverStore.identity(auth.token);Object.assign(f.principal,{ownerId:p.owner_id,producerId:p.producer_id,serverId:p.server_id});f.queue.initialize(f.root,f.principal);Object.assign(f.target,{token:auth.token,principal:f.principal});
  f.setHandler(async(url,options)=>{const result=await fetch(base+url.slice('https://synthetic.invalid'.length),{method:options.method,headers:options.header,...(options.extraData?{body:options.extraData}:{})});return {responseCode:result.status,result:await result.text(),header:{}};});
  const op=new f.MaterialSpeakerCorrection();Object.assign(op,{operation_id:'http-split-source-op',kind:'split',utterance_ids:[f.third.utterances[0].utterance_id],split_offset:4});f.store.correctSpeakers(f.first.material_id,3,op);
  for(const n of [1,2,3,4])f.queue.enqueue(f.make(n));for(let i=0;i<4;i++)assert(await f.client.pump(f.queue,f.target));
  assert(f.queue.all().every(row=>row.state==='server_stored'));const response=await fetch(base+'/v1/materials/'+encodeURIComponent(f.first.material_id),{headers:{Authorization:'Bearer '+auth.token}});assert.equal(response.status,200);const saved=await response.json();
  assert.deepEqual(saved.body,plain(f.make(4).body));assert.equal(saved.body.utterances[0].start_ms,null);assert.equal(saved.body.speakers[0].label,'合成项目记录人');assert.equal(serverStore.ceiling(p.owner_id),4);
  f.store.delete(f.first.material_id,4);const tombstone=f.make(5);f.queue.enqueue(tombstone);assert(await f.client.pump(f.queue,f.target));assert.equal(f.queue.all().find(row=>row.revision===5).state,'server_stored');assert.equal(tombstone.schema_version,'1.2');assert.deepEqual(tombstone.body.speakers,[]);assert.equal(serverStore.ceiling(p.owner_id),5);
 }finally{await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});serverStore.close();}
});
