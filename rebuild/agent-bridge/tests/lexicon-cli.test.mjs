import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {BridgeClient} from '../client.mjs';
import {MaterialStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';
import {prepareManagedCli,managedCli,drainManagedCli} from '../questions/managed-cli.mjs';

const project=fileURLToPath(new URL('../../../',import.meta.url)),cli=fileURLToPath(new URL('../questions/cli.mjs',import.meta.url));
const candidate={canonical:'合成工程师',category:'person',scope:'合成项目',aliases:['合成工成师'],evidence:[{ref:'Synthetic first-hand message 2026-11-14',quote:'本条是合成工程师本人确认的写法。'}]};
async function fixture(t){
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-lexicon-cli-'))),store=new MaterialStore(path.join(dir,'db.sqlite')),server=await listen(store);
  const paired=store.devices.enroll({owner:'caller701-lexicon-codex',role:'agent',label:'Synthetic first computer'});
  const device=path.join(dir,'agent-device.json'),pairing=path.join(dir,'pairings');fs.mkdirSync(pairing,{mode:0o700});
  const deviceValue={...paired,computer_id:'synthetic-computer',base_url:`http://127.0.0.1:${server.address().port}/v1/`,allow_loopback_http:true};
  fs.writeFileSync(device,JSON.stringify(deviceValue),{mode:0o600});
  const env={...process.env,PATH:path.join(dir,'no-programs'),IO_AGENT_DEVICE_FILE:device,IO_AGENT_PAIRING_HOME:pairing,IO_AGENT_PYTHON:path.join(dir,'no-python')};
  for(const key of ['CODEX_THREAD_ID','CLAUDE_CODE_SESSION_ID','CLAUDE_SESSION_ID','IO_AGENT_CALLER_RUNTIME','IO_AGENT_CALLER_SESSION','IO_AGENT_CONNECTOR_PROFILE'])delete env[key];
  const run=(action,input,{args=[],entry=cli,deviceFile=device}={})=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[entry,action,...args],{cwd:dir,env:{...env,IO_AGENT_DEVICE_FILE:deviceFile},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(JSON.stringify(input));
    const timer=setTimeout(()=>child.kill(),10000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr,value:stdout.trim()?JSON.parse(stdout):null});});
  });
  const config={schema_version:'1.0',base_url:deviceValue.base_url,owner_id:paired.owner_id,producer_id:paired.producer_id,server_id:paired.server_id,credential_file:device,computer_id:deviceValue.computer_id,agent_id:'io-synthetic',allow_loopback_http:true};
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return{dir,store,paired,device,deviceValue,pairing,run,config};
}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});}

// These transport tests use a fake endpoint and never send a credential to a real service.
test('daily correction learns only explicit supplied entries after confirmed storage and preserves duplicate identity',async t=>{
  const f=await fixture(t),calls=[],identity={schema_version:'1.0',owner_id:f.paired.owner_id,producer_id:f.paired.producer_id,server_id:f.paired.server_id};
  const saved={server_stored:true,items:[{...candidate,id:randomUUID()}],content_role:'source_data',requires_context_check:true};
  let duplicate=false;
  const client=new BridgeClient(f.config,{fetchImpl:async(url,options)=>{
    const route=new URL(url).pathname;calls.push({route,input:options.body&&JSON.parse(options.body)});
    if(route==='/v1/identity')return json(identity);
    if(route==='/v1/lifelog-text/correct')return json({material_id:'synthetic',correction_revision:1,server_stored:true,duplicate});
    if(route==='/v1/lexicon/save')return json(saved);
    throw Error('Unexpected synthetic endpoint');
  }});
  const input={material_id:'synthetic',edits:[{block_id:'clip-1',text:'合成工程师确认写法'}],lexicon_entries:[candidate]};
  const result=await client.dailyEdit('daily-correct',input);assert.equal(result.server_stored,true);assert.deepEqual(result.lexicon_learning,saved);
  assert.equal(calls.filter(c=>c.route==='/v1/lifelog-text/correct').length,1);assert.equal(calls.filter(c=>c.route==='/v1/lexicon/save').length,1);
  assert(!Object.hasOwn(calls.find(c=>c.route==='/v1/lifelog-text/correct').input,'lexicon_entries'));
  assert.deepEqual(calls.find(c=>c.route==='/v1/lexicon/save').input,{entries:[candidate]});
  duplicate=true;const retried=await client.dailyEdit('daily-correct',input);assert.equal(retried.duplicate,true);assert.deepEqual(retried.lexicon_learning.items,saved.items);
  const plain=await client.dailyEdit('daily-correct',{material_id:'synthetic',edits:input.edits});assert(!Object.hasOwn(plain,'lexicon_learning'));
  assert.equal(calls.filter(c=>c.route==='/v1/lexicon/save').length,2,'no learning without explicit entries; no inferred words from diff');
});

test('learning failure never turns a saved correction into a failure or automatically resends it',async t=>{
  const f=await fixture(t);let corrections=0,learning=0;
  const identity={schema_version:'1.0',owner_id:f.paired.owner_id,producer_id:f.paired.producer_id,server_id:f.paired.server_id};
  let correctionConfirmed=true,networkFails=false;
  const client=new BridgeClient(f.config,{fetchImpl:async(url)=>{
    const route=new URL(url).pathname;
    if(route==='/v1/identity')return json(identity);
    if(route==='/v1/lifelog-text/correct'){corrections++;return json({server_stored:correctionConfirmed,correction_revision:1});}
    if(route==='/v1/lexicon/save'){learning++;if(networkFails)throw Error('Sensitive synthetic error '+f.paired.token);return json({error:{code:'LEXICON_LIMIT_REACHED'}},409);}
    throw Error('Unexpected synthetic endpoint');
  }});
  const input={edits:[{block_id:'clip-1',text:'合成正文'}],lexicon_entries:[candidate]};
  const failed=await client.dailyEdit('daily-correct',input);assert.equal(failed.server_stored,true);assert.equal(failed.error,undefined);assert.equal(failed.lexicon_learning.error,'LEXICON_LIMIT_REACHED');assert.equal(corrections,1);assert.equal(learning,1);
  networkFails=true;const uncertain=await client.dailyEdit('daily-correct',input);assert.equal(uncertain.server_stored,true);assert.equal(uncertain.lexicon_learning.error,'NETWORK_UNAVAILABLE');assert.equal(uncertain.lexicon_learning.server_stored_unconfirmed,true);assert(!JSON.stringify(uncertain).includes(f.paired.token));assert.equal(corrections,2);assert.equal(learning,2);
  correctionConfirmed=false;const unconfirmed=await client.dailyEdit('daily-correct',input);assert.equal(unconfirmed.lexicon_learning.skipped,true);assert.equal(learning,2);
  await assert.rejects(client.lexicon('save',{entries:[candidate],owner_id:'foreign'}),{code:'INVALID_LEXICON'});assert.equal(learning,2);
  await assert.rejects(client.lexicon('save',{entries:[{...candidate,canonical:'x'.repeat(262145)}]}),{code:'LEXICON_TOO_LARGE'});assert.equal(learning,2,'oversized dictionary writes never reach the service');
});

test('scheduled native CLI shares one account across computers and hides foreign entries without session or Python',async t=>{
  const f=await fixture(t),saved=await f.run('lexicon',{entries:[candidate]},{args:['save']});assert.equal(saved.code,0,saved.stdout+saved.stderr);assert.equal(saved.value.server_stored,true);
  assert.equal(saved.value.content_role,'source_data');assert.equal(saved.value.requires_context_check,true);
  const second=f.store.devices.enroll({owner:f.paired.owner_id,role:'agent',label:'Synthetic second computer'}),secondFile=path.join(f.dir,'second.json');fs.writeFileSync(secondFile,JSON.stringify({...f.deviceValue,...second,computer_id:'second-computer'}),{mode:0o600});
  const same=await f.run('lexicon',{terms:['合成工成师'],scope:candidate.scope},{args:['query'],deviceFile:secondFile});assert.equal(same.code,0,same.stdout+same.stderr);assert.equal(same.value.items.length,1);assert.equal(same.value.items[0].id,saved.value.items[0].id);assert.equal(same.value.items[0].requires_context_check,true);
  const id=saved.value.items[0].id;
  const foreign=f.store.devices.enroll({owner:'caller702-lexicon-codex',role:'agent',label:'Other account'}),foreignFile=path.join(f.dir,'foreign.json');fs.writeFileSync(foreignFile,JSON.stringify({...f.deviceValue,...foreign}),{mode:0o600});
  const hidden=await f.run('lexicon',{}, {args:['query'],deviceFile:foreignFile});assert.equal(hidden.code,0);assert.deepEqual(hidden.value.items,[]);
  for(const action of ['use','delete']){const denied=await f.run('lexicon',{ids:[id]},{args:[action],deviceFile:foreignFile});assert.equal(denied.code,2);assert.equal(denied.value.error,'LEXICON_ENTRY_NOT_FOUND');}
  const used=await f.run('lexicon',{ids:[id]},{args:['use'],deviceFile:secondFile});assert.equal(used.code,0);assert.equal(used.value.items[0].id,id);
  const queried=await f.run('lexicon',{limit:1},{args:['query']});assert.equal(queried.value.items[0].last_used_at,used.value.items[0].last_used_at);assert.equal(queried.value.items[0].expires_at,used.value.items[0].expires_at);
  const invalid=await f.run('lexicon',{owner_id:'foreign'},{args:['query']});assert.equal(invalid.value.error,'INVALID_LEXICON');
  const deleted=await f.run('lexicon',{ids:[id]},{args:['delete']});assert.equal(deleted.code,0);assert.deepEqual(deleted.value.deleted_ids,[id]);
  for(const output of [saved,same,hidden,used,deleted])for(const token of [f.paired.token,second.token,foreign.token])assert(!output.stdout.includes(token));
  assert.deepEqual(fs.readdirSync(f.pairing),[]);assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM queue_revisions').get().n,0);
});

test('portable wrapper forwards exactly one lexicon action and bypasses Python setup',async t=>{
  const f=await fixture(t),folder=path.join(f.dir,'portable');fs.mkdirSync(folder);
  for(const file of ['cz-iot-cli.mjs','io-agent.mjs','setup.mjs','package.json'])fs.copyFileSync(path.join(project,'tools/collab/workbuddy-package',file),path.join(folder,file));
  const source=path.join(project,'rebuild/agent-bridge');fs.cpSync(source,path.join(folder,'rebuild/agent-bridge'),{recursive:true,filter:file=>{
    if(path.relative(source,file).split(path.sep).some(part=>['private','tests','node_modules'].includes(part)))return false;
    return fs.statSync(file).isDirectory()||/\.(?:mjs|cjs|json)$/.test(file);
  }});
  const entry=path.join(folder,'cz-iot-cli.mjs'),saved=await f.run('lexicon',{entries:[candidate]},{entry,args:['save']});assert.equal(saved.code,0,saved.stdout+saved.stderr);
  const read=await f.run('lexicon',{query:'合成'},{entry,args:['query']});assert.equal(read.code,0);assert.equal(read.value.items[0].id,saved.value.items[0].id);
  const invalid=await f.run('lexicon',{}, {entry,args:['query','unexpected']});assert.notEqual(invalid.code,0);
  assert.equal(fs.existsSync(path.join(folder,'.io-agent')),false);assert.deepEqual(fs.readdirSync(f.pairing),[]);
});

test('daily-correct optional learning is stripped from the real correction API and remains compatible without it',async t=>{
  const f=await fixture(t),phone=f.store.mint({owner:f.paired.owner_id,producer:'synthetic-phone',scopes:['materials:write']});
  const source={id:'text-'+'a'.repeat(64),date:'2026-11-14',timezone:'Asia/Shanghai',kind:'transcript',started_at:'2026-11-14T01:00:00Z',ended_at:'2026-11-14T02:00:00Z',blocks:[{id:'clip-1',kind:'utterance',text:'合成工成师确认写法',speaker:'me'}],related_ids:[]};
  f.store.lifelog.upload(phone.token,{base_revision:0,source});
  const correction={material_id:source.id,request_id:randomUUID(),expected_source_revision:1,expected_revision:0,agent:'Synthetic CLI',reason:'Synthetic confirmed name',evidence:[candidate.evidence[0].quote],edits:[{block_id:'clip-1',text:'合成工程师确认写法'}],lexicon_entries:[candidate]};
  const saved=await f.run('daily-correct',correction);assert.equal(saved.code,0,saved.stdout+saved.stderr);assert.equal(saved.value.server_stored,true);assert.equal(saved.value.lexicon_learning.server_stored,true);
  const duplicate=await f.run('daily-correct',correction);assert.equal(duplicate.value.duplicate,true);assert.equal(duplicate.value.lexicon_learning.items[0].id,saved.value.lexicon_learning.items[0].id);
  const client=new BridgeClient(f.config),effective=(await client.daily({date:source.date})).items[0];assert.equal(effective.correction_revision,1);assert.equal(effective.blocks[0].text,'合成工程师确认写法');assert.equal(effective.blocks[0].speaker,'me');
  const plain={...correction,request_id:randomUUID(),expected_revision:1,edits:[{block_id:'clip-1',text:'合成工程师再次确认写法'}]};delete plain.lexicon_entries;
  const unchangedProtocol=await f.run('daily-correct',plain);assert.equal(unchangedProtocol.code,0);assert(!Object.hasOwn(unchangedProtocol.value,'lexicon_learning'));
});

test('managed direct and host mailbox lexicon remain bound to the original turn and session',async t=>{
  const f=await fixture(t),session=randomUUID(),route={computer_id:'synthetic-computer',agent_id:'io-synthetic',project_id:'synthetic-project',session_id:randomUUID()},op={id:randomUUID(),turnId:randomUUID(),status:'inProgress',taskId:'synthetic-lexicon-task'},journal=path.join(f.dir,'journal.json'),expiresAt=new Date(Date.now()+60000).toISOString();
  f.store.queueSubmit(f.paired.token,{schema_version:'1.0',kind:'task',event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:f.paired.producer_id,created_at:new Date().toISOString(),expires_at:expiresAt,body:{task_id:op.taskId,revision:1,route,state:'queued',command:'Synthetic lexicon review',allow_create_session:false}},'task');
  const binding=prepareManagedCli({directory:f.dir,journal,sessionId:session,workspace:f.dir,op,taskId:op.taskId,expiresAt,bridge:f.config,route,contextInWorkspace:true});
  op.cliContext=binding.file;fs.writeFileSync(journal,JSON.stringify({session_id:session,workspace:f.dir,operations:{[op.id]:op}}),{mode:0o600});
  const options={env:{CODEX_THREAD_ID:session}},help=await managedCli('help',{},binding.file,options);assert(help.commands.includes('lexicon'));
  const saved=await managedCli('lexicon',{action:'save',entries:[candidate]},binding.file,options);assert.equal(saved.server_stored,true);
  await assert.rejects(managedCli('lexicon',{action:'query'},binding.file,{env:{CODEX_THREAD_ID:'foreign-native'}}),{code:'MANAGED_CLI_SESSION_MISMATCH'});
  const publicFile=path.join(f.dir,'.io-agent-cli',op.turnId,'context.json'),pending=managedCli('lexicon',{action:'query',terms:[candidate.canonical]},publicFile,{...options,viaHost:true});
  await drainManagedCli(binding.file);const read=await pending;assert.equal(read.items[0].id,saved.items[0].id);assert(!JSON.stringify(read).includes(f.paired.token));
  op.status='completed';fs.writeFileSync(journal,JSON.stringify({session_id:session,workspace:f.dir,operations:{[op.id]:op}}),{mode:0o600});
  await assert.rejects(managedCli('lexicon',{action:'query'},binding.file,options),{code:'MANAGED_CLI_TURN_CLOSED'});
});
