import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {desktopJoinWorkspace} from '../questions/cli.mjs';
import {validateResidentConfig} from '../hosts/resident-manager.mjs';
import {sessionFile} from '../questions/session-pair-cli.mjs';
import {MaterialStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';

test('desktop join takes cwd from only the exact original owner and always closes its read-only probe',async t=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-join-owner-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const session=randomUUID();let closes=0;
  const connect=async id=>{assert.equal(id,session);return{status:async()=>({conversationId:session,workspace:dir,busy:true}),close:()=>closes++};};
  assert.equal(await desktopJoinWorkspace(session,{connect}),dir);assert.equal(closes,1);
  await assert.rejects(desktopJoinWorkspace(session,{connect:async()=>({status:async()=>({conversationId:randomUUID(),workspace:dir}),close:()=>closes++})}),{code:'CALLER_NATIVE_WORKSPACE_INVALID'});
  assert.equal(closes,2);
  const binding={server_id:'synthetic',owner_id:'synthetic',host_kind:'codex',workspace:dir,route:{computer_id:'c',agent_id:'a',project_id:'p',session_id:session}};
  const config={schema_version:1,runtime:'codex',control:'desktop',binding,agent:{...binding,computer_id:'c',agent_id:'a',credential_file:path.join(dir,'device.json')},owner:{pid:42,executable:'codex',started:'synthetic'},label:'Synthetic',legacyTaskIds:[]};
  assert.equal(validateResidentConfig(config).control,'desktop');
  assert.throws(()=>validateResidentConfig({...config,endpoint:'unix:///tmp/test.sock'}),{code:'RESIDENT_CONFIG_INVALID'});
});

test('explicit computer migration keeps native chat identity, checks owner before publish, and remembers the selected transport',async t=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-join-migration-'))),project=fileURLToPath(new URL('../../../',import.meta.url)),copy=path.join(dir,'project'),nativeWorkspace=path.join(dir,'native-project');
  fs.mkdirSync(nativeWorkspace);fs.cpSync(path.join(project,'rebuild/agent-bridge'),path.join(copy,'rebuild/agent-bridge'),{recursive:true,filter:p=>!['private','node_modules','__pycache__','tests'].includes(path.basename(p))});
  fs.cpSync(path.join(project,'docs/contracts'),path.join(copy,'docs/contracts'),{recursive:true});fs.mkdirSync(path.join(copy,'rebuild/agent-bridge/private'),{mode:0o700});
  // This fixture never opens a real Desktop socket or starts a resident.
  fs.writeFileSync(path.join(copy,'rebuild/agent-bridge/hosts/codex-desktop.mjs'),`export class CodexDesktopSession{static async connect(id){return{status:async()=>({conversationId:id,workspace:${JSON.stringify(nativeWorkspace)},busy:true}),close(){}}}}`);
  const manager=path.join(copy,'rebuild/agent-bridge/hosts/resident-manager.mjs');fs.writeFileSync(manager,fs.readFileSync(manager,'utf8').replace('owner=nativeOwner(runtime,{read})','owner=null'));
  const store=new MaterialStore(':memory:'),server=await listen(store),session=randomUUID(),device=path.join(dir,'computer.json');
  const env={...process.env,CODEX_THREAD_ID:session,IO_AGENT_PAIRING_HOME:path.join(dir,'pairings'),IO_AGENT_DEVICE_FILE:device,IO_AGENT_RESIDENT_HOME:path.join(dir,'residents')};
  for(const key of ['CLAUDE_CODE_SESSION_ID','CLAUDE_SESSION_ID','IO_AGENT_CALLER_RUNTIME','IO_AGENT_CALLER_SESSION','IO_AGENT_CONNECTOR_PROFILE','IO_AGENT_CODEX_ENDPOINT','IO_AGENT_CODEX_RPC_PATH'])delete env[key];
  const scoped=sessionFile({runtime:'codex',session},copy,env),old=store.devices.enroll({owner:'synthetic-owner',role:'agent',label:'Old scoped'}),paired=store.devices.enroll({owner:'synthetic-owner',role:'agent',label:'Computer'});
  const base={computer_id:'computer-paired',base_url:`http://127.0.0.1:${server.address().port}/v1/`,allow_loopback_http:true};
  fs.mkdirSync(path.dirname(scoped),{recursive:true,mode:0o700});fs.writeFileSync(scoped,JSON.stringify({...base,...old,computer_id:'old-scoped'}),{mode:0o600});
  fs.writeFileSync(device,JSON.stringify({...base,...paired,owner_id:'different-owner'}),{mode:0o600});
  const cli=path.join(copy,'rebuild/agent-bridge/questions/cli.mjs'),python=path.join(project,'.runtime/hermes-agent/.venv/bin/python3');
  const run=(input)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'join'],{cwd:copy,env,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.stdin.end(JSON.stringify(input));const timer=setTimeout(()=>child.kill(),30000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve({code,value:JSON.parse(out),err});});});
  t.after(async()=>{await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const input={topic:'Synthetic native join',python,control:'desktop',pairing:'computer'};
  assert.equal((await run(input)).value.error,'CALLER_PAIRING_OWNER_MISMATCH');assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM queue_revisions').get().n,0);
  fs.writeFileSync(device,JSON.stringify({...base,...paired,server_id:'different-server'}),{mode:0o600});
  assert.equal((await run(input)).value.error,'CALLER_PAIRING_OWNER_MISMATCH');assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM queue_revisions').get().n,0);
  fs.writeFileSync(device,JSON.stringify({...base,...paired}),{mode:0o600});
  const joined=await run(input);assert.equal(joined.code,0,joined.err+JSON.stringify(joined.value));assert.equal(joined.value.joined,true);assert.equal(joined.value.creates_codex_session,false);
  const callerKey=createHash('sha256').update(JSON.stringify([copy.toLowerCase(),session])).digest('hex').slice(0,24),caller=path.join(copy,'rebuild/agent-bridge/private','codex-'+callerKey);
  const active=JSON.parse(fs.readFileSync(path.join(caller,'active.json'))),registration=path.join(caller,'registrations',active.profile),context=JSON.parse(fs.readFileSync(path.join(registration,'context.json')));
  assert.equal(context.route.session_id,session);assert.equal(context.route.computer_id,'computer-paired');
  assert.equal(context.route.project_id,'workspace-'+createHash('sha256').update(nativeWorkspace).digest('hex').slice(0,24));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(registration,'native-control.json'))),{schema:1,control:'desktop',native_workspace:nativeWorkspace,session_id:session});
  const again=await run({topic:input.topic,python});assert.equal(again.code,0,JSON.stringify(again.value));assert.equal(again.value.task_id,joined.value.task_id);assert.equal(again.value.reused,true);
  assert(fs.existsSync(scoped),'old credential/history stays intact');assert(!fs.existsSync(env.IO_AGENT_RESIDENT_HOME),'fixture must not launch a worker');
});
