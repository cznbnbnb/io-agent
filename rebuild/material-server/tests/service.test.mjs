import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../store.mjs';
import {listen} from '../http.mjs';
import {canonical,parseStrict} from '../json.mjs';

const sample=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/material-v1.1.json',import.meta.url))).events[2];
const epoch=Date.parse('2026-10-11T02:00:00Z');
function event(material='sample',revision=1,text='合成测试：明天提交报告'){
  const e=structuredClone(sample);e.event_id=randomUUID();e.idempotency_key=randomUUID();e.producer_id='phone-test';
  e.created_at=new Date(epoch).toISOString();e.expires_at=new Date(epoch+3600000).toISOString();
  Object.assign(e.body,{material_id:material,revision,base_revision:revision-1,text_revision:revision});e.body.full_text.text=text;return e;
}
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-material-server-'));const db=path.join(dir,'test.sqlite');
  let now=epoch,store=new MaterialStore(db,{clock:()=>now});const scopes=['materials:write','materials:read','changes:read'];
  const primary=store.mint({owner:'owner-a',producer:'phone-test',scopes});
  const foreign=store.mint({owner:'owner-b',producer:'phone-test',scopes});
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,db,primary,foreign,get store(){return store;},setTime:n=>{now=n;},
    restart(){store.close();store=new MaterialStore(db,{clock:()=>now});return store;}};
}
const error=code=>e=>e.code===code;

test('strict JSON rejects duplicates, unsafe Unicode and deep nesting; canonical order is UTF16',()=>{
  assert.equal(canonical({'2':'b','10':'a',z:[-0,1e30],'中':'字'}),'{"10":"a","2":"b","z":[0,1e+30],"中":"字"}');
  assert.deepEqual(parseStrict(' {"x": [{"y":1},true, null], "\\u4e2d":"字"} '),{x:[{y:1},true,null],中:'字'});
  for(const s of ['{"a":1,"\\u0061":2}','[{"x":1,"x":2}]'])assert.throws(()=>parseStrict(s),error('DUPLICATE_JSON_KEY'));
  assert.throws(()=>parseStrict('"\\ud800"'),error('INVALID_UNICODE'));
  assert.throws(()=>parseStrict('['.repeat(66)+'0'+']'.repeat(66)),error('JSON_TOO_DEEP'));
});

test('durable commit, reordered JSON retry, same-key conflict and post-restart receipt identity',t=>{
  const f=setup(t),e=event();const accepted=f.store.submit(f.primary.token,e);assert.equal(accepted.status,201);
  const reordered=Object.fromEntries(Object.entries(e).reverse());assert.deepEqual(f.store.submit(f.primary.token,reordered),{status:200,body:accepted.body});
  const wrong=structuredClone(e);wrong.body.full_text.text='不能覆盖';assert.throws(()=>f.store.submit(f.primary.token,wrong),error('IDEMPOTENCY_CONFLICT'));
  f.restart();assert.deepEqual(f.store.event(f.primary.token,e.event_id),accepted.body);
  assert.equal(f.store.get(f.primary.token,'sample').body.full_text.text,e.body.full_text.text);
  assert.equal(accepted.body.receipt.stage,'server_stored');assert.equal(f.store.ceiling('owner-a'),1);
});

test('owner, producer, scopes, revoke and expiry are independent authorization boundaries',t=>{
  const f=setup(t),e=event();f.store.submit(f.primary.token,e);
  assert.throws(()=>f.store.get(f.foreign.token,'sample'),error('MATERIAL_NOT_FOUND'));
  assert.equal(f.store.page(f.foreign.token,'changes').items.length,0);
  const other=f.store.mint({owner:'owner-a',producer:'other-phone',scopes:['materials:write']});
  assert.throws(()=>f.store.submit(other.token,e),error('FORBIDDEN'));
  assert.throws(()=>f.store.event(other.token,e.event_id),error('EVENT_NOT_FOUND'));
  assert.throws(()=>f.store.get(other.token,'sample'),error('FORBIDDEN'));
  f.store.revoke(other.token_id);assert.throws(()=>f.store.auth(other.token,'materials:write'),error('UNAUTHENTICATED'));
  f.setTime(epoch+3600001);assert.throws(()=>f.store.get(f.primary.token,'sample'),error('UNAUTHENTICATED'));
});

test('authenticated identity binds queue to durable service ID and the actual credential owner/producer',t=>{
  const f=setup(t),a=f.store.identity(f.primary.token),b=f.store.identity(f.foreign.token);
  assert.equal(a.owner_id,'owner-a');assert.equal(b.owner_id,'owner-b');assert.equal(a.server_id,b.server_id);
  assert.equal(a.producer_id,'phone-test');assert(a.scopes.includes('materials:write'));assert(!JSON.stringify(a).includes(f.primary.token));
  f.restart();assert.deepEqual(f.store.identity(f.primary.token),a);
  f.store.revoke(f.primary.token_id);assert.throws(()=>f.store.identity(f.primary.token),error('UNAUTHENTICATED'));
});

test('expired upload can be reissued for an identical immutable revision without rolling head back',t=>{
  const f=setup(t),first=event();f.store.submit(f.primary.token,first);
  const second=event('sample',2,'用户更正的合成文字');f.store.submit(f.primary.token,second);
  const expired=structuredClone(first);expired.expires_at=new Date(epoch).toISOString();
  assert.throws(()=>f.store.submit(f.primary.token,expired),error('EXPIRED'));
  const alias=structuredClone(first);alias.event_id=randomUUID();alias.idempotency_key=randomUUID();
  const result=f.store.submit(f.primary.token,alias);assert.equal(result.status,200);assert.equal(result.body.duplicate_of,first.event_id);
  assert.equal(f.store.get(f.primary.token,'sample').body.revision,2);assert.equal(f.store.ceiling('owner-a'),2);
  assert.equal(f.store.page(f.primary.token,'changes').items.length,2);
});

test('CAS, text revision and tombstones reject stale writes; history never resurfaces after deletion',t=>{
  const f=setup(t);f.store.submit(f.primary.token,event());
  assert.throws(()=>f.store.submit(f.primary.token,event('sample',1,'冲突文字')),error('REVISION_CONFLICT'));
  const wrong=event('sample',2,'已改文字');wrong.body.text_revision=1;
  assert.throws(()=>f.store.submit(f.primary.token,wrong),error('TEXT_REVISION_CONFLICT'));
  const del=event('sample',2,'');del.body.operation='delete';del.body.utterances=[];del.body.text_revision=1;f.store.submit(f.primary.token,del);
  for(const revision of [null,1,2])assert.throws(()=>f.store.get(f.primary.token,'sample',revision),error('MATERIAL_DELETED'));
  assert.equal(f.store.page(f.primary.token,'materials').items.length,0);
  assert.equal(f.store.page(f.primary.token,'changes').items.at(-1).body.operation,'delete');
  assert.equal(f.store.page(f.primary.token,'changes').items.length,1);
  assert.throws(()=>f.store.submit(f.primary.token,event('sample',3)),error('MATERIAL_DELETED'));
});

test('unaltered ArkTS phone exports r1-r5 are accepted in order, including metadata-only growth and delete',t=>{
  const f=setup(t),root=new URL('../../phase1/',import.meta.url);
  const seed=JSON.parse(fs.readFileSync(new URL('device-p21-wire39-seed.json',root)));
  const resume=JSON.parse(fs.readFileSync(new URL('device-p21-wire39-resume.json',root)));
  f.setTime(Date.parse(resume.events.at(-1).created_at));
  const auth=f.store.mint({owner:'fixture-owner',producer:'phone-synthetic-lab',scopes:['materials:write','materials:read','changes:read']});
  for(const e of seed.events)assert.equal(f.store.submit(auth.token,e).status,201);
  f.restart();
  assert.equal(f.store.submit(auth.token,resume.events[0]).status,200);
  for(const e of resume.events.slice(1))assert.equal(f.store.submit(auth.token,e).status,201);
  const changes=f.store.page(auth.token,'changes');assert.equal(changes.items.length,1);assert.equal(changes.items[0].body.revision,5);
  assert.throws(()=>f.store.get(auth.token,seed.events[0].body.material_id,1),error('MATERIAL_DELETED'));
});

test('v1.0 stays readable; incomplete coverage and client claims of server audio are rejected',t=>{
  const f=setup(t),e=event();e.schema_version='1.0';delete e.body.processing;delete e.body.full_text;
  f.store.submit(f.primary.token,e);assert.equal(f.store.get(f.primary.token,'sample').schema_version,'1.0');
  const bad=event('other');bad.body.processing={...bad.body.processing,transcription_state:'complete',covered_ms:10,source_ms:20};
  assert.throws(()=>f.store.submit(f.primary.token,bad),error('INVALID_COVERAGE'));
  bad.body.processing=structuredClone(sample.body.processing);bad.body.audio={state:'stored_verified',sha256:'a'.repeat(64),object_id:'not-finalized'};
  assert.throws(()=>f.store.submit(f.primary.token,bad),error('AUDIO_NOT_VERIFIED'));
  assert.equal(f.store.ceiling('owner-a'),1);
});

test('keyword includes legacy full text; date and speaker queries use bound values',t=>{
  const f=setup(t);f.store.submit(f.primary.token,event());
  const e=event('spoken');e.body.utterances=[{utterance_id:'u1',start_ms:100,end_ms:200,text:'语音样本',speaker_id:'A',speaker_basis:'segment_cluster',overlap:false}];
  f.store.submit(f.primary.token,e);
  assert.equal(f.store.page(f.primary.token,'materials',{keyword:'明天提交'}).items.length,2);
  assert.equal(f.store.page(f.primary.token,'materials',{keyword:"' OR 1=1--"}).items.length,0);
  assert.equal(f.store.page(f.primary.token,'materials',{speaker:'A'}).items[0].body.material_id,'spoken');
  assert.equal(f.store.page(f.primary.token,'materials',{from:'2027-01-01T00:00:00Z'}).items.length,0);
  assert.throws(()=>f.store.page(f.primary.token,'materials',{from:'tomorrow'}),error('INVALID_QUERY'));
});

test('snapshot paging survives concurrent revisions and restart; changes resume after terminal cursor',t=>{
  const f=setup(t);for(const name of ['a','b','c'])f.store.submit(f.primary.token,event(name));
  const page=f.store.page(f.primary.token,'materials',{limit:1});assert.equal(page.items[0].body.material_id,'a');
  f.store.submit(f.primary.token,event('b',2,'第二版'));f.restart();
  const next=f.store.page(f.primary.token,'materials',{limit:2,cursor:page.next_cursor});
  assert.deepEqual(next.items.map(v=>[v.body.material_id,v.body.revision]),[['b',1],['c',1]]);assert.equal(next.has_more,false);
  const changes=f.store.page(f.primary.token,'changes');assert.equal(changes.items.length,4);
  f.store.submit(f.primary.token,event('d'));const tail=f.store.page(f.primary.token,'changes',{cursor:changes.next_cursor});
  assert.deepEqual(tail.items.map(v=>v.body.material_id),['d']);
  assert.throws(()=>f.store.page(f.foreign.token,'materials',{cursor:page.next_cursor}),error('CURSOR_RESET_REQUIRED'));
  assert.throws(()=>f.store.page(f.primary.token,'materials',{cursor:page.next_cursor,keyword:'不同'}),error('CURSOR_RESET_REQUIRED'));
  const altered=page.next_cursor.slice(0,-5)+'aaaaa';assert.throws(()=>f.store.page(f.primary.token,'materials',{cursor:altered}),error('CURSOR_RESET_REQUIRED'));
  f.setTime(epoch+86400001);const fresh=f.store.mint({owner:'owner-a',producer:'phone-test',scopes:['materials:read']});
  assert.throws(()=>f.store.page(fresh.token,'materials',{cursor:page.next_cursor}),error('CURSOR_RESET_REQUIRED'));
});

test('page byte budget continues without dropping large documents',t=>{
  const f=setup(t);for(let i=0;i<6;i++)f.store.submit(f.primary.token,event('big'+i,1,'x'.repeat(245000)));
  const a=f.store.page(f.primary.token,'materials',{limit:50});assert.ok(Buffer.byteLength(JSON.stringify(a))<1048576);assert.ok(a.has_more);
  const b=f.store.page(f.primary.token,'materials',{limit:50,cursor:a.next_cursor});assert.equal(a.items.length+b.items.length,6);assert.equal(b.has_more,false);
});

test('online backup reopens with matching receipts; exclusive publication protects existing files',async t=>{
  const f=setup(t),e=event(),ack=f.store.submit(f.primary.token,e).body,destination=path.join(f.dir,'backup.sqlite');
  assert.equal((await f.store.backupTo(destination)).verified,true);
  await assert.rejects(f.store.backupTo(destination));await assert.rejects(f.store.backupTo(f.db));
  f.store.submit(f.primary.token,event('second'));const ahead=f.store.page(f.primary.token,'changes').next_cursor;
  const recovered=new MaterialStore(destination,{clock:()=>epoch});
  try{
    assert.deepEqual(recovered.event(f.primary.token,e.event_id),ack);
    assert.equal(recovered.get(f.primary.token,'sample').body.full_text.text,e.body.full_text.text);
    assert.throws(()=>recovered.page(f.primary.token,'changes',{cursor:ahead}),error('CURSOR_RESET_REQUIRED'));
  }finally{recovered.close();}
  assert.equal(f.store.ceiling('owner-a'),2);
});

test('SQLite failure after revision insert rolls back head, event and sequence together',t=>{
  const f=setup(t);f.store.db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  const e=event();assert.throws(()=>f.store.submit(f.primary.token,e));assert.equal(f.store.ceiling('owner-a'),0);
  assert.throws(()=>f.store.get(f.primary.token,'sample'),error('MATERIAL_NOT_FOUND'));
  assert.throws(()=>f.store.event(f.primary.token,e.event_id),error('EVENT_NOT_FOUND'));
  f.store.db.exec('DROP TRIGGER fail_event');assert.equal(f.store.submit(f.primary.token,e).status,201);
});

test('process exit before COMMIT leaves no acknowledged revision; retry succeeds after reopen',t=>{
  const f=setup(t),e=event(),input=path.join(f.dir,'input.json');fs.writeFileSync(input,JSON.stringify({token:f.primary.token,e}));
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./worker.mjs',import.meta.url)),f.db,input,'crash'],{encoding:'utf8',env:process.env});
  assert.equal(child.status,73,child.stderr);f.restart();assert.equal(f.store.ceiling('owner-a'),0);
  assert.throws(()=>f.store.event(f.primary.token,e.event_id),error('EVENT_NOT_FOUND'));assert.equal(f.store.submit(f.primary.token,e).status,201);
});

test('two independent processes submitting same event produce one durable effect',async t=>{
  const f=setup(t),input=path.join(f.dir,'input.json');fs.writeFileSync(input,JSON.stringify({token:f.primary.token,e:event()}));
  const worker=fileURLToPath(new URL('./worker.mjs',import.meta.url));
  const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[worker,f.db,input,'submit'],{env:process.env});let out='',err='';child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(new Error(err)));});
  const results=await Promise.all([run(),run()]);assert.deepEqual(results.map(v=>v.status).sort(),[200,201]);assert.deepEqual(results[0].body,results[1].body);
  f.restart();assert.equal(f.store.ceiling('owner-a'),1);
});

test('process exit after COMMIT but before response is reconciled by event ID and identical retry',t=>{
  const f=setup(t),e=event(),input=path.join(f.dir,'lost.json');fs.writeFileSync(input,JSON.stringify({token:f.primary.token,e}));
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./worker.mjs',import.meta.url)),f.db,input,'lost-reply'],{encoding:'utf8',env:process.env});
  assert.equal(child.status,74,child.stderr);assert.equal(child.stdout,'');f.restart();
  const ack=f.store.event(f.primary.token,e.event_id);assert.equal(ack.commit_seq,1);
  assert.deepEqual(f.store.submit(f.primary.token,e),{status:200,body:ack});assert.equal(f.store.ceiling('owner-a'),1);
});

test('CLI token output is exclusive, private-file based and revocable without logging the bearer',t=>{
  const f=setup(t),out=path.join(f.dir,'credential.json'),cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
  const run=(args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env:process.env});
  const args=['mint','--db',f.db,'--owner','cli-owner','--producer','cli-phone','--scopes','materials:read','--out',out];
  const result=run(args);assert.equal(result.status,0,result.stderr);const privateValue=JSON.parse(fs.readFileSync(out));
  assert.equal(result.stdout.includes(privateValue.token),false);assert.equal(result.stderr.includes(privateValue.token),false);
  const before=fs.readFileSync(out,'utf8');assert.equal(run(args).status,1);assert.equal(fs.readFileSync(out,'utf8'),before);
  assert.equal(f.store.auth(privateValue.token,'materials:read').owner,'cli-owner');
  assert.equal(run(['revoke','--db',f.db,'--token-id',privateValue.token_id]).status,0);
  assert.throws(()=>f.store.auth(privateValue.token,'materials:read'),error('UNAUTHENTICATED'));
});

test('real loopback HTTP routes, strict body errors, revoke and server restart',async t=>{
  const f=setup(t);let server=await listen(f.store);t.after(async()=>{if(server.listening)await new Promise(r=>server.close(r));});
  let base='http://127.0.0.1:'+server.address().port;
  const request=(route,options={})=>fetch(base+route,{...options,headers:{Authorization:'Bearer '+f.primary.token,...options.headers}});
  const e=event();let r=await request('/v1/material-events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(e)});
  assert.equal(r.status,201);const ack=await r.json();
  const health=await fetch(base+'/health');assert.equal(health.status,200);
  assert.equal((await (await request('/v1/identity')).json()).owner_id,'owner-a');
  assert.equal((await fetch(base+'/v1/materials')).status,401);
  r=await request('/v1/material-events',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"a":1,"a":2}'});assert.equal((await r.json()).error.code,'DUPLICATE_JSON_KEY');
  r=await request('/v1/material-events',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(262145)});assert.equal(r.status,413);
  assert.equal((await request('/v1/materials?limit=1&limit=2')).status,400);
  assert.equal((await request('/v1/materials/%xx')).status,400);
  await new Promise(resolve=>server.close(resolve));f.restart();server=await listen(f.store);base='http://127.0.0.1:'+server.address().port;
  assert.deepEqual(await (await request('/v1/events/'+e.event_id)).json(),ack);
  assert.equal((await (await request('/v1/materials/sample?revision=1')).json()).body.full_text.text,e.body.full_text.text);
  f.store.revoke(f.primary.token_id);assert.equal((await request('/v1/materials')).status,401);
  await new Promise(resolve=>server.close(resolve));
});
