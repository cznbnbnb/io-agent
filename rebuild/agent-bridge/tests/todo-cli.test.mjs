import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {MaterialStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';
import {prepareManagedCli,managedCli,drainManagedCli} from '../questions/managed-cli.mjs';

const project=fileURLToPath(new URL('../../../',import.meta.url));
const cli=fileURLToPath(new URL('../questions/cli.mjs',import.meta.url));

async function fixture(t){
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-todo-cli-'))),store=new MaterialStore(path.join(dir,'server.sqlite')),server=await listen(store);
  const paired=store.devices.enroll({owner:'synthetic-todo-owner',role:'agent',label:'Scheduled Agent'});
  const device=path.join(dir,'agent-device.json'),pairing=path.join(dir,'pairings');fs.mkdirSync(pairing,{mode:0o700});
  const deviceValue={...paired,computer_id:'synthetic-computer',base_url:`http://127.0.0.1:${server.address().port}/v1/`,allow_loopback_http:true};
  fs.writeFileSync(device,JSON.stringify(deviceValue),{mode:0o600});
  const env={...process.env,PATH:path.join(dir,'no-programs'),IO_AGENT_DEVICE_FILE:device,IO_AGENT_PAIRING_HOME:pairing,IO_AGENT_PYTHON:path.join(dir,'no-python')};
  for(const key of ['CODEX_THREAD_ID','CLAUDE_CODE_SESSION_ID','CLAUDE_SESSION_ID','IO_AGENT_CALLER_RUNTIME','IO_AGENT_CALLER_SESSION','IO_AGENT_CONNECTOR_PROFILE'])delete env[key];
  const run=(action,input,{entry=cli,deviceFile=device}={})=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[entry,action],{cwd:dir,env:{...env,IO_AGENT_DEVICE_FILE:deviceFile},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(JSON.stringify(input));
    const timer=setTimeout(()=>child.kill(),5000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr,value:stdout.trim()?JSON.parse(stdout):null});});
  });
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return{dir,store,paired,pairing,device,deviceValue,run};
}

test('scheduled CLI needs no native session, join or Python and deduplicates across processes',async t=>{
  const f=await fixture(t),input={todo_key:'daily-2026-10-27-follow-up',content:'确认合成物料进度',source:'Scheduled Agent'};
  const first=await f.run('todo-add',input),retry=await f.run('todo-add',input);
  assert.equal(first.code,0,first.stderr);assert.equal(retry.code,0,retry.stderr);
  assert.deepEqual(retry.value,first.value);assert.equal(first.value.state,'pending_confirmation');assert.equal(first.value.native_created,false);
  const status=await f.run('todo-status',{proposal_id:first.value.proposal_id});assert.equal(status.code,0,status.stderr);assert.deepEqual(status.value,first.value);
  const changed=await f.run('todo-add',{...input,content:'变更合成待办'});assert.equal(changed.code,2);assert.equal(changed.value.error,'TODO_KEY_CONFLICT');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM todo_suggestions').get().n,1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM queue_revisions').get().n,0,'native suggestions do not manufacture an Agent job');
  assert.deepEqual(fs.readdirSync(f.pairing),[],'the CLI does not join or create session state');
});

test('shared CLI reads only the paired account and does not treat posting as a native write',async t=>{
  const f=await fixture(t),input={todo_key:'same-key',content:'合成待办'},first=await f.run('todo-add',input);
  assert.equal(first.code,0,first.stderr);
  const other=f.store.devices.enroll({owner:'different-todo-owner',role:'agent',label:'Other Agent'}),otherFile=path.join(f.dir,'other-device.json');
  fs.writeFileSync(otherFile,JSON.stringify({...f.deviceValue,...other}),{mode:0o600});
  const hidden=await f.run('todo-status',{proposal_id:first.value.proposal_id},{deviceFile:otherFile});assert.equal(hidden.code,2);assert.equal(hidden.value.error,'TODO_SUGGESTION_NOT_FOUND');
  const independent=await f.run('todo-add',input,{deviceFile:otherFile});assert.equal(independent.code,0);assert.notEqual(independent.value.proposal_id,first.value.proposal_id);
  const phone=f.store.devices.enroll({owner:f.paired.owner_id,role:'phone',label:'Synthetic phone'}),id=first.value.proposal_id;
  for(const action of ['show','accept','begin'])f.store.todoSuggestions.phone(phone.token,id,{action});
  const creating=await f.run('todo-status',{proposal_id:id});assert.equal(creating.value.state,'creating');assert.equal(creating.value.native_created,false);
  f.store.todoSuggestions.phone(phone.token,id,{action:'unknown',error:'OFFICIAL_SOURCE_TIMEOUT'});
  const uncertainRetry=await f.run('todo-add',input);assert.equal(uncertainRetry.value.proposal_id,id);assert.equal(uncertainRetry.value.state,'unknown');assert.equal(uncertainRetry.value.native_created,false);
  f.store.todoSuggestions.phone(phone.token,id,{action:'created',native_id:'synthetic-original-todo-id'});
  const created=await f.run('todo-status',{proposal_id:id});assert.equal(created.value.native_created,true);assert.equal(created.value.native_id,'synthetic-original-todo-id');assert.equal(created.value.glasses_display_confirmed,false);
});

test('portable wrapper discovers todo commands and bypasses Python setup without a live session',async t=>{
  const f=await fixture(t),folder=path.join(f.dir,'portable');fs.mkdirSync(folder);
  for(const file of ['cz-iot-cli.mjs','io-agent.mjs','setup.mjs','package.json'])fs.copyFileSync(path.join(project,'tools/collab/workbuddy-package',file),path.join(folder,file));
  const source=path.join(project,'rebuild/agent-bridge');
  fs.cpSync(source,path.join(folder,'rebuild/agent-bridge'),{recursive:true,filter:file=>{
    if(path.relative(source,file).split(path.sep).some(part=>['private','tests','node_modules'].includes(part)))return false;
    return fs.statSync(file).isDirectory()||/\.(?:mjs|cjs|json)$/.test(file);
  }});
  const entry=path.join(folder,'io-agent.mjs'),help=await f.run('help',{}, {entry});
  assert.equal(help.code,0,help.stderr);assert(help.value.commands['todo-add'].includes('confirmation'));assert(help.value.commands['todo-status'].includes('native_created'));
  const added=await f.run('todo-add',{todo_key:'portable-2026-10-27',content:'便携包合成待办'},{entry});assert.equal(added.code,0,added.stderr);assert.equal(added.value.state,'pending_confirmation');
  const status=await f.run('todo-status',{proposal_id:added.value.proposal_id},{entry});assert.equal(status.code,0,status.stderr);assert.equal(status.value.proposal_id,added.value.proposal_id);
  assert.equal(fs.existsSync(path.join(folder,'.io-agent')),false,'Python setup was never invoked');assert.deepEqual(fs.readdirSync(f.pairing),[]);
});

test('managed native-session and restricted Desktop mailbox expose the same confirmation-gated commands',async t=>{
  const f=await fixture(t),native=randomUUID(),op={id:randomUUID(),turnId:'synthetic-turn',status:'inProgress',taskId:'synthetic-phone-task'},journal=path.join(f.dir,'journal.json');
  const route={computer_id:'synthetic-computer',agent_id:'synthetic-agent',project_id:'synthetic-project',session_id:randomUUID()},expiresAt=new Date(Date.now()+60000).toISOString();
  const phone=f.store.devices.enroll({owner:f.paired.owner_id,role:'phone',label:'Synthetic phone'});
  f.store.queueSubmit(phone.token,{schema_version:'1.0',kind:'task',event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:phone.producer_id,created_at:new Date().toISOString(),expires_at:expiresAt,
    body:{task_id:op.taskId,revision:1,route,state:'queued',command:'Synthetic todo suggestion',allow_create_session:false}},'task');
  const bridge={schema_version:'1.0',base_url:f.deviceValue.base_url,owner_id:f.paired.owner_id,producer_id:f.paired.producer_id,server_id:f.paired.server_id,credential_file:f.device,computer_id:route.computer_id,agent_id:route.agent_id,allow_loopback_http:true};
  const binding=prepareManagedCli({directory:f.dir,journal,sessionId:native,workspace:f.dir,op,taskId:op.taskId,expiresAt,bridge,route,contextInWorkspace:true});
  op.cliContext=binding.file;fs.writeFileSync(journal,JSON.stringify({session_id:native,workspace:f.dir,operations:{[op.id]:op}}),{mode:0o600});
  const options={env:{CODEX_THREAD_ID:native}},help=await managedCli('help',{},binding.file,options);
  assert(help.commands.includes('todo-add'));assert(help.commands.includes('todo-status'));assert(binding.briefInstruction.length<1500);
  const input={todo_key:'managed-synthetic',content:'受管会话合成待办'},added=await managedCli('todo-add',input,binding.file,options);
  assert.equal(added.state,'pending_confirmation');assert.equal(added.native_created,false);
  const publicFile=path.join(f.dir,'.io-agent-cli',op.turnId,'context.json');
  const pending=managedCli('todo-status',{proposal_id:added.proposal_id},publicFile,{...options,viaHost:true});
  const drained=await drainManagedCli(binding.file);assert.equal(drained,undefined);
  assert.deepEqual(await pending,added);
  op.status='completed';fs.writeFileSync(journal,JSON.stringify({session_id:native,workspace:f.dir,operations:{[op.id]:op}}),{mode:0o600});
  await assert.rejects(managedCli('todo-add',{...input,todo_key:'stale-turn'},binding.file,options),{code:'MANAGED_CLI_TURN_CLOSED'});
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM todo_suggestions').get().n,1);
});
