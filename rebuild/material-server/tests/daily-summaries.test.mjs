import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID,randomBytes} from 'node:crypto';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../store.mjs';import {listen} from '../http.mjs';
import {BridgeClient} from '../../agent-bridge/client.mjs';
import {prepareManagedCli,managedCli,drainManagedCli} from '../../agent-bridge/questions/managed-cli.mjs';

async function setup(t){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-daily-cli-'))),store=new MaterialStore(path.join(dir,'server.sqlite')),server=await listen(store);
 const agent=store.devices.enroll({owner:'daily-owner',role:'agent',label:'Synthetic computer'}),writer=store.mint({owner:'daily-owner',producer:'daily-phone',scopes:['materials:write']}),credential=path.join(dir,'device.json');
 const config={schema_version:'1.0',base_url:`http://127.0.0.1:${server.address().port}/v1/`,owner_id:agent.owner_id,producer_id:agent.producer_id,server_id:agent.server_id,computer_id:'daily-computer',agent_id:'io-current-codex',credential_file:credential,timeout_ms:5000,allow_loopback_http:true};
 fs.writeFileSync(credential,JSON.stringify({...agent,computer_id:config.computer_id,base_url:config.base_url,allow_loopback_http:true}),{mode:0o600});
 t.after(async()=>{await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const submit=(date,text='Synthetic summary',revision=1,id='daily-'+date)=>{
  const start=Date.parse(date+'T00:00:00Z'),body={material_id:id,revision,base_revision:revision-1,operation:'upsert',source:'agent_analysis',started_at:new Date(start).toISOString(),ended_at:new Date(start+86400000).toISOString(),completeness:'complete',text_revision:revision,utterances:[],speakers:[],audio:{state:'not_retained',sha256:null,object_id:null},full_text:{format:'markdown',text:'# '+date+' 每日 AI 总结\n\n'+text,origin:'legacy'},processing:{transcription_state:'unknown',covered_ms:null,source_ms:null,speaker:'unavailable',boundary:'unknown',recognition_channel:'unknown',user_edited:false}};
  const e={schema_version:'1.2',kind:'material.revision',event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'daily-phone',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),body};store.submit(writer.token,e);return e;
 };
 return {dir,store,server,agent,writer,config,submit,client:new BridgeClient(config)};
}

test('paired computer reads only synced daily summaries, with exact text and source revision',async t=>{
 const f=await setup(t),first=f.submit('2026-10-23','Delivery plan'),second=f.submit('2026-10-24','Meeting notes');f.submit('2026-10-24','not a daily id',1,'old-transcript');
 const raw=structuredClone(first);raw.schema_version='1.1';delete raw.body.speakers;raw.body.material_id='daily-old-transcript';raw.event_id=raw.idempotency_key=randomUUID();raw.body.utterances=[{utterance_id:'u1',text:'private raw words',start_ms:100,end_ms:600,speaker_id:'A',speaker_basis:'segment_cluster',overlap:false}];f.store.submit(f.writer.token,raw);
 const all=await f.client.dailySummaries({});assert.deepEqual(all.items.map(i=>i.date),['2026-10-23','2026-10-24']);assert.equal(all.items[0].text,first.body.full_text.text);assert.equal(all.items[1].source_ref.revision,second.body.revision);assert.equal(all.items[0].content_role,'source_data');
 assert.equal(all.coverage.phone_sync_status,'unknown');assert.equal(all.coverage.scope,'server_stored_daily_ai_summaries');assert(!JSON.stringify(all).includes('private raw words'));assert(!Object.hasOwn(all.items[0],'audio'));assert(!Object.hasOwn(all.items[0],'utterances'));assert(!Object.hasOwn(all.items[0],'body'));
 const day=await f.client.dailySummaries({date:'2026-10-24',keyword:'Meeting'});assert.equal(day.items.length,1);assert.equal(day.items[0].text,second.body.full_text.text);
 assert.equal((await f.client.dailySummaries({from:'2026-10-25',to:'2026-10-26'})).items.length,0);
 assert.throws(()=>f.store.get(f.agent.token,first.body.material_id),{code:'FORBIDDEN'},'daily permission does not grant the general material API');
});

test('daily cursors preserve snapshots and filters; another owner cannot read the account',async t=>{
 const f=await setup(t);f.submit('2026-10-23','first');f.submit('2026-10-24','original');
 const page=await f.client.dailySummaries({limit:1});assert.equal(page.has_more,true);f.submit('2026-10-24','new revision',2);
 const next=await f.client.dailySummaries({limit:1,cursor:page.next_cursor});assert.equal(next.items[0].revision,1);assert(next.items[0].text.endsWith('original'));assert.equal(next.has_more,false);
 await assert.rejects(f.client.dailySummaries({limit:1,keyword:'different',cursor:page.next_cursor}),{code:'CURSOR_RESET_REQUIRED'});
 const foreign=f.store.devices.enroll({owner:'another-owner',role:'agent',label:'Other account'}),file=path.join(f.dir,'foreign.json');fs.writeFileSync(file,JSON.stringify(foreign),{mode:0o600});
 const other=new BridgeClient({...f.config,owner_id:foreign.owner_id,producer_id:foreign.producer_id,credential_file:file});assert.equal((await other.dailySummaries({})).items.length,0);
 await assert.rejects(other.dailySummaries({cursor:page.next_cursor}),{code:'CURSOR_RESET_REQUIRED'});
});

test('invalid CLI query values fail before network I/O; permission and revocation failures stay explicit',async t=>{
 const f=await setup(t);let calls=0;f.server.prependListener('request',()=>calls++);
 for(const input of [null,[],{owner:'another-owner'},{date:'2026-02-30'},{date:''},{date:'2026-10-24',from:'2026-10-23'},{from:'2026-10-25',to:'2026-10-23'},{limit:0},{keyword:null},{cursor:2}])await assert.rejects(f.client.dailySummaries(input),{code:'INVALID_QUERY'});
 assert.equal(calls,0);f.submit('2026-10-24');await f.client.dailySummaries({});f.store.devices.revoke(f.agent.device_id);await assert.rejects(f.client.dailySummaries({}),{code:'AUTH_REQUIRED'});
});

test('legacy single-session pairing stays restricted even after a device-token refresh',async t=>{
 const f=await setup(t),phone=f.store.devices.enroll({owner:'daily-owner',role:'phone',label:'Phone'}),input={id:randomUUID(),claim_secret:randomBytes(32).toString('base64url'),metadata:{runtime:'codex',route:{computer_id:'c',agent_id:'io-current-codex',project_id:'p',session_id:'s'},topic:'Legacy',workspace:'test'}};
 const started=f.store.sessionPairings.start(input),q=new URLSearchParams(new URL(started.qr_url).hash.slice(1));f.store.sessionPairings.approve(phone.token,{id:q.get('id'),code:q.get('code')});
 const session=f.store.sessionPairings.claim({id:input.id,claim_secret:input.claim_secret}),renewed=f.store.devices.refresh(session.token);assert(!f.store.identity(renewed.token).scopes.includes('daily-summaries:read'));
 const r=await fetch(f.config.base_url+'daily-summaries',{headers:{Authorization:'Bearer '+renewed.token}});assert.equal(r.status,403);assert.equal((await r.json()).error.code,'SESSION_SCOPE_REQUIRED');
});

test('standalone daily CLI supports scheduled jobs without a session, join, Python or a phone task',async t=>{
 const f=await setup(t);f.submit('2026-10-24','Scheduled-reader fixture');
 const root=fileURLToPath(new URL('../../../',import.meta.url)),env={...process.env,IO_AGENT_DEVICE_FILE:f.config.credential_file,IO_AGENT_PYTHON:'/not-installed/python'};for(const k of ['CODEX_THREAD_ID','CLAUDE_CODE_SESSION_ID','CLAUDE_SESSION_ID','IO_AGENT_CALLER_RUNTIME','IO_AGENT_CALLER_SESSION','IO_AGENT_CONNECTOR_PROFILE'])delete env[k];
 const child=spawn(process.execPath,['rebuild/agent-bridge/questions/cli.mjs','daily'],{cwd:root,env}),out=[],err=[];child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));child.stdin.end(JSON.stringify({date:'2026-10-24'}));const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(status,0,Buffer.concat(err).toString());const result=JSON.parse(Buffer.concat(out));assert.equal(result.items[0].date,'2026-10-24');assert(result.items[0].text.endsWith('Scheduled-reader fixture'));assert.equal(f.store.db.prepare('SELECT count(*) n FROM queue_heads').get().n,0,'read never creates a task');
});

test('managed CLI advertises daily and returns more than 64 KiB through the existing mailbox',async t=>{
 const f=await setup(t);f.submit('2026-10-24','测'.repeat(30000));const route={computer_id:'daily-computer',agent_id:'io-current-codex',project_id:'p',session_id:randomUUID()},taskId='daily-task',sessionId='native-daily',op={id:'op1',turnId:randomUUID(),taskId,status:'inProgress'},journal=path.join(f.dir,'acp.json');
 f.store.queueSubmit(f.agent.token,{schema_version:'1.0',kind:'task',event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:f.agent.producer_id,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),body:{task_id:taskId,revision:1,route,command:'Read a summary',state:'queued',allow_create_session:false}},'task');
 const prepared=prepareManagedCli({directory:f.dir,journal,sessionId,workspace:f.dir,op,taskId,expiresAt:new Date(Date.now()+600000).toISOString(),bridge:f.config,route});op.cliContext=prepared.file;fs.writeFileSync(journal,JSON.stringify({session_id:sessionId,workspace:f.dir,operations:{op1:op}}),{mode:0o600});
 assert(prepared.instruction.includes('daily {'));assert((await managedCli('help',{},prepared.file,{env:{}})).commands.includes('daily'));
 const waiting=managedCli('daily',{date:'2026-10-24'},prepared.file,{env:{},viaHost:true});await drainManagedCli(prepared.file);const result=await waiting;assert.equal(result.items.length,1);assert.equal(result.items[0].text.slice(-30000),'测'.repeat(30000));assert(Buffer.byteLength(JSON.stringify(result))>65536);
 op.status='completed';fs.writeFileSync(journal,JSON.stringify({session_id:sessionId,workspace:f.dir,operations:{op1:op}}));await assert.rejects(managedCli('daily',{},prepared.file,{env:{}}),{code:'MANAGED_CLI_TURN_CLOSED'});
});
