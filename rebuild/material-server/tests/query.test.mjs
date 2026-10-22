import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../store.mjs';
import {listen} from '../http.mjs';
import {MaterialQueryClient,QueryError,readPrivateJson} from '../query/client.mjs';

const sample=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/material-v1.1.json',import.meta.url))).events[2];
const epoch=Date.parse('2026-10-11T02:00:00Z'),run=promisify(execFile);
const error=code=>value=>value instanceof QueryError&&value.code===code;
function event(id='daily',revision=1,text='合成讨论：交付改为周四'){
  const value=structuredClone(sample);Object.assign(value,{event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'phone-test',
    created_at:new Date(epoch).toISOString(),expires_at:new Date(epoch+3600000).toISOString()});
  Object.assign(value.body,{material_id:id,revision,base_revision:revision-1,text_revision:revision});value.body.full_text.text=text;
  return value;
}
async function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'turboio-query-'));let now=epoch;
  const store=new MaterialStore(path.join(dir,'test.sqlite'),{clock:()=>now});
  const writer=store.mint({owner:'owner-a',producer:'phone-test',scopes:['materials:write']});
  const reader=store.mint({owner:'owner-a',producer:'computer-query',scopes:['materials:read','changes:read']});
  const credential=path.join(dir,'reader.json');fs.writeFileSync(credential,JSON.stringify(reader),{mode:0o600});
  const server=await listen(store),identity=store.identity(reader.token),requests=[];
  server.prependListener('request',req=>requests.push({method:req.method,url:req.url}));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const config={schema_version:'1.0',base_url:`http://127.0.0.1:${server.address().port}/v1/`,owner_id:identity.owner_id,
    producer_id:identity.producer_id,server_id:identity.server_id,credential_file:credential,allow_loopback_http:true};
  return {dir,store,writer,reader,server,requests,config,client:new MaterialQueryClient(config,{clock:()=>now}),setTime:value=>{now=value;}};
}

test('real SQLite/HTTP: time, keyword and speaker search return exact text, coverage and source references',async t=>{
  const f=await setup(t),e=event();e.body.processing={...e.body.processing,transcription_state:'partial',covered_ms:10020,source_ms:60000,speaker:'pending'};
  e.body.utterances=[{utterance_id:'u1',start_ms:100,end_ms:600,text:'请改为周四交付',speaker_id:'A',speaker_basis:'segment_cluster',overlap:false}];
  f.store.submit(f.writer.token,e);
  const result=await f.client.search({from:'2026-10-11T00:00:00Z',to:'2026-10-11T00:01:00Z',keyword:'周四',speaker:'A'});
  assert.equal(result.items.length,1);const item=result.items[0];assert.deepEqual(item.body,e.body);
  assert.equal(item.evidence.transcription_state,'partial');assert.equal(item.evidence.speaker_processing,'pending');
  assert.equal(item.evidence.audio_playback_available,false);assert.equal(result.freshness.phone_sync_status,'unknown');
  assert.equal(result.freshness.fresh_until,result.freshness.server_time);
  const spoken=item.matches.find(v=>v.kind==='utterance');assert.equal(spoken.source_ref.utterance_id,'u1');
  assert.equal(spoken.source_ref.start_ms,100);assert.equal(spoken.speaker_basis,'segment_cluster');
  assert.equal(item.matches[0].source_ref.start_ms,null);assert.equal(item.source_ref.revision,1);
  assert(f.requests.every(req=>req.method==='GET'&&!req.url.includes(f.reader.token)));
});

test('immutable original revision survives later correction; unknown v1.0 coverage stays unknown',async t=>{
  const f=await setup(t);const first=event();f.store.submit(f.writer.token,first);f.store.submit(f.writer.token,event('daily',2,'用户更正：周三'));
  const old=await f.client.get({material_id:'daily',revision:1});assert.deepEqual(old.items[0].body,first.body);
  assert.equal(old.freshness.server_time,null);assert.equal(old.freshness.fresh_until,null);
  assert.equal((await f.client.get({material_id:'daily'})).items[0].body.revision,2);
  const legacy=event('legacy');legacy.schema_version='1.0';delete legacy.body.processing;delete legacy.body.full_text;
  f.store.submit(f.writer.token,legacy);const item=(await f.client.get({material_id:'legacy'})).items[0];
  assert.equal(item.evidence.transcription_state,'unknown');assert.equal(item.evidence.processing,null);assert.equal(item.matches.length,0);
});

test('bounded snapshot pages preserve filters and revision, and explicitly reject changed/expired cursors',async t=>{
  const f=await setup(t);for(const id of ['a','b','c'])f.store.submit(f.writer.token,event(id));
  const first=await f.client.search({limit:1,keyword:'周四'});assert.equal(first.has_more,true);
  f.store.submit(f.writer.token,event('b',2,'后来改为周三'));
  const next=await f.client.search({limit:2,keyword:'周四',cursor:first.next_cursor});
  assert.deepEqual(next.items.map(v=>[v.body.material_id,v.body.revision]),[['b',1],['c',1]]);assert.equal(next.has_more,false);
  await assert.rejects(f.client.search({keyword:'周三',cursor:first.next_cursor}),e=>error('CURSOR_RESET_REQUIRED')(e)&&e.resetRequired);
  f.setTime(epoch+86400001);const renewed=f.store.mint({owner:'owner-a',producer:'computer-query',scopes:['materials:read','changes:read']});
  fs.writeFileSync(f.config.credential_file,JSON.stringify(renewed));
  await assert.rejects(f.client.search({keyword:'周四',cursor:first.next_cursor}),error('CURSOR_RESET_REQUIRED'));
  assert.equal((await f.client.search({keyword:'无匹配'})).items.length,0);
});

test('changes terminal cursor resumes offline backlog including deletion, without old content resurrection',async t=>{
  const f=await setup(t);f.store.submit(f.writer.token,event('a'));const checkpoint=(await f.client.changes()).next_cursor;
  const port=f.server.address().port;await new Promise(resolve=>f.server.close(resolve));
  await assert.rejects(f.client.changes({cursor:checkpoint}),e=>error('NETWORK_UNAVAILABLE')(e)&&e.retryable);
  f.store.submit(f.writer.token,event('a',2,'用户修订'));f.store.submit(f.writer.token,event('b'));
  const deletion=event('a',3,'');deletion.body.operation='delete';deletion.body.text_revision=2;deletion.body.utterances=[];
  f.store.submit(f.writer.token,deletion);
  await new Promise(resolve=>f.server.listen(port,'127.0.0.1',resolve));
  // Recreate the client as a new process would; only the caller's cursor persists.
  const restarted=new MaterialQueryClient(f.config,{clock:()=>epoch});
  const tail=await restarted.changes({cursor:checkpoint,limit:1});assert.equal(tail.items[0].body.material_id,'b');assert.equal(tail.has_more,true);
  const tombstone=await restarted.changes({cursor:tail.next_cursor});assert.equal(tombstone.items.length,1);
  assert.equal(tombstone.items[0].body.operation,'delete');assert.equal(tombstone.items[0].withdrawn,true);assert.equal(tombstone.items[0].matches.length,0);
  assert.equal(tombstone.items[0].body.full_text.text,'');assert.deepEqual(tombstone.items[0].body.utterances,[]);
  await assert.rejects(restarted.get({material_id:'a',revision:1}),e=>error('MATERIAL_DELETED')(e)&&e.status===410);
  assert.equal((await restarted.changes({cursor:tombstone.next_cursor})).items.length,0);
});

test('owner/producer/service identity and read scopes are verified before any source query',async t=>{
  const f=await setup(t);f.store.submit(f.writer.token,event());
  for(const key of ['owner_id','producer_id','server_id']){
    f.requests.length=0;const wrong=new MaterialQueryClient({...f.config,[key]:'wrong'},{clock:()=>epoch});
    await assert.rejects(wrong.search(),error('IDENTITY_MISMATCH'));assert.deepEqual(f.requests.map(v=>v.url),['/v1/identity']);
  }
  fs.writeFileSync(f.config.credential_file,JSON.stringify(f.writer));
  const wrongProducer=new MaterialQueryClient({...f.config,producer_id:'phone-test'},{clock:()=>epoch});
  await assert.rejects(wrongProducer.search(),error('FORBIDDEN'));
  f.store.revoke(f.writer.token_id);await assert.rejects(wrongProducer.search(),error('UNAUTHENTICATED'));
});

test('reject insecure endpoints, ambiguous options and credential files without leaking their content',async t=>{
  const f=await setup(t);
  for(const base_url of ['http://example.com/v1/','http://localhost/v1/','https://secret@example.com/v1/','https://example.com/v1/?token=secret','https://example.com/']){
    assert.throws(()=>new MaterialQueryClient({...f.config,base_url}),e=>e instanceof QueryError);
  }
  assert.throws(()=>new MaterialQueryClient({...f.config,allow_loopback_http:false}),error('HTTPS_REQUIRED'));
  await assert.rejects(f.client.search({project:'ignored-filter'}),error('INVALID_QUERY'));
  await assert.rejects(f.client.changes({keyword:'ignored-filter'}),error('INVALID_QUERY'));
  await assert.rejects(f.client.get({material_id:'daily',keyword:'ignored'}),error('INVALID_QUERY'));
  for(const limit of [0,51,1.5,'2'])await assert.rejects(f.client.search({limit}),error('INVALID_QUERY'));
  assert.equal(f.requests.length,0);
  fs.writeFileSync(f.config.credential_file,'{"token":"secret","token":"also-secret"}');
  await assert.rejects(f.client.search(),e=>error('INVALID_PRIVATE_FILE')(e)&&!JSON.stringify(e.toJSON()).includes('secret'));
  fs.writeFileSync(f.config.credential_file,'x'.repeat(5000));assert.throws(()=>readPrivateJson(f.config.credential_file,4096),error('INVALID_PRIVATE_FILE'));
});

test('CLI reads actual loopback service, accepts file-only bearer and returns safe machine-readable errors',async t=>{
  const f=await setup(t),now=Date.now();
  // CLI uses the real wall clock, so mint its disposable credential on that clock.
  f.setTime(now);const reader=f.store.mint({owner:'owner-a',producer:'computer-query',scopes:['materials:read','changes:read']});
  const writer=f.store.mint({owner:'owner-a',producer:'phone-test',scopes:['materials:write']});
  fs.writeFileSync(f.config.credential_file,JSON.stringify(reader));
  const e=event();e.created_at=new Date(now).toISOString();e.expires_at=new Date(now+3600000).toISOString();f.store.submit(writer.token,e);
  const config=path.join(f.dir,'query.json');fs.writeFileSync(config,JSON.stringify({...f.config,credential_file:'reader.json'}));
  const cli=fileURLToPath(new URL('../query/cli.mjs',import.meta.url));
  const result=await run(process.execPath,[cli,'search','--config',config,'--keyword','周四']);
  const value=JSON.parse(result.stdout);assert.equal(value.ok,true);assert.equal(value.items[0].body.material_id,'daily');assert(!result.stdout.includes(reader.token));
  await assert.rejects(run(process.execPath,[cli,'get','--config',config,'--material-id','missing']),e=>{
    const value=JSON.parse(e.stderr);assert.equal(value.error.code,'MATERIAL_NOT_FOUND');assert.equal(value.error.status,404);assert.equal(e.stdout,'');return true;
  });
  await assert.rejects(run(process.execPath,[cli,'search','--config',config,'--token',reader.token]),e=>{
    assert.equal(JSON.parse(e.stderr).error.code,'INVALID_ARGUMENTS');assert(!e.stderr.includes(reader.token));return true;
  });
});

test('real CLI covers time, keyword, speaker, immutable original, incremental changes and source references',async t=>{
  const f=await setup(t),now=Date.now();f.setTime(now);
  const reader=f.store.mint({owner:'owner-a',producer:'computer-query',scopes:['materials:read','changes:read']});
  const writer=f.store.mint({owner:'owner-a',producer:'phone-test',scopes:['materials:write']});
  fs.writeFileSync(f.config.credential_file,JSON.stringify(reader));
  const config=path.join(f.dir,'query.json');fs.writeFileSync(config,JSON.stringify({...f.config,credential_file:'reader.json'}));
  const cli=fileURLToPath(new URL('../query/cli.mjs',import.meta.url));
  const call=(...args)=>run(process.execPath,[cli,...args,'--config',config]);
  const mailed=value=>{value.created_at=new Date(now).toISOString();value.expires_at=new Date(now+3600000).toISOString();return value;};
  const first=mailed(event('daily',1,'周一讨论：交付定为周四'));
  first.body.processing={...first.body.processing,transcription_state:'partial',covered_ms:10020,source_ms:60000,speaker:'pending'};
  first.body.utterances=[{utterance_id:'u1',start_ms:100,end_ms:600,text:'请把交付改为周四',speaker_id:'A',speaker_basis:'segment_cluster',overlap:false}];
  f.store.submit(writer.token,first);
  const search=JSON.parse((await call('search','--from','2026-10-11T00:00:00Z','--to','2026-10-11T00:01:00Z','--keyword','周四','--speaker','A')).stdout);
  assert.equal(search.items.length,1);assert.equal(search.items[0].body.full_text.text,first.body.full_text.text);
  const spoken=search.items[0].matches.find(v=>v.kind==='utterance');
  assert.deepEqual([spoken.source_ref.material_id,spoken.source_ref.revision,spoken.source_ref.utterance_id,spoken.source_ref.start_ms],
    ['daily',1,'u1',100]);
  assert.equal(spoken.speaker_basis,'segment_cluster');
  // Incomplete coverage must stay visible, so "no match" is not reported as "never said".
  assert.equal(search.items[0].evidence.transcription_state,'partial');assert.equal(search.items[0].body.completeness,'complete');
  const checkpoint=JSON.parse((await call('changes')).stdout);assert.equal(checkpoint.items.length,1);assert.equal(checkpoint.has_more,false);
  f.store.submit(writer.token,mailed(event('daily',2,'用户更正：周三交付')));
  const delta=JSON.parse((await call('changes','--cursor',checkpoint.next_cursor)).stdout);
  assert.deepEqual(delta.items.map(v=>[v.body.material_id,v.body.revision]),[['daily',2]]);
  const original=JSON.parse((await call('get','--material-id','daily','--revision','1')).stdout);
  assert.equal(original.items[0].body.full_text.text,first.body.full_text.text);
  assert.equal(original.items[0].source_ref.revision,1);assert.equal(original.freshness.server_time,null);
  assert.equal(JSON.parse((await call('get','--material-id','daily')).stdout).items[0].body.revision,2);
  assert(!JSON.stringify([search,checkpoint,delta,original]).includes(reader.token));
});

async function stub(t,handler){
  const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return server;
}
function send(res,value){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));}

test('redirect response never follows Location or forwards bearer to another endpoint',async t=>{
  const f=await setup(t);let leaked=0;const destination=await stub(t,(_req,res)=>{leaked++;res.end();});
  const redirect=await stub(t,(_req,res)=>{res.writeHead(302,{location:`http://127.0.0.1:${destination.address().port}/stolen`});res.end();});
  const client=new MaterialQueryClient({...f.config,base_url:`http://127.0.0.1:${redirect.address().port}/v1/`},{clock:()=>epoch});
  await assert.rejects(client.search(),error('REDIRECT_REFUSED'));assert.equal(leaked,0);
});

test('streaming limits, duplicate-key JSON and unsupported versions fail before presenting source evidence',async t=>{
  const f=await setup(t),identity=f.store.identity(f.reader.token);let mode='duplicate';
  const server=await stub(t,(req,res)=>{
    if(req.url==='/v1/identity'){send(res,identity);return;}
    res.writeHead(200,{'content-type':'application/json'});
    if(mode==='duplicate')res.end('{"items":[],"items":[]}');
    else if(mode==='large'){res.write('x'.repeat(600000));res.end('x'.repeat(600000));}
    else {const value=f.store.page(f.reader.token,'materials');value.items[0].schema_version='9.0';res.end(JSON.stringify(value));}
  });
  const client=new MaterialQueryClient({...f.config,base_url:`http://127.0.0.1:${server.address().port}/v1/`},{clock:()=>epoch});
  await assert.rejects(client.search(),error('INVALID_RESPONSE'));mode='large';await assert.rejects(client.search(),error('RESPONSE_TOO_LARGE'));
  f.store.submit(f.writer.token,event());mode='version';await assert.rejects(client.search(),error('INVALID_RESPONSE'));
});

test('request has a total deadline and explicit cancellation without starting another request',async t=>{
  const f=await setup(t);let calls=0;const server=await stub(t,()=>{calls++;});
  const client=new MaterialQueryClient({...f.config,base_url:`http://127.0.0.1:${server.address().port}/v1/`,timeout_ms:100},{clock:()=>epoch});
  await assert.rejects(client.search(),e=>error('TIMEOUT')(e)&&e.retryable);assert.equal(calls,1);
  const controller=new AbortController();const pending=client.search({},controller.signal);setTimeout(()=>controller.abort(),20);
  await assert.rejects(pending,error('CANCELLED'));assert.equal(calls,2);
  await assert.rejects(client.search({},controller.signal),error('CANCELLED'));assert.equal(calls,2);
});
