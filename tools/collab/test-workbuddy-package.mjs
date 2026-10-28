import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawn,spawnSync} from 'node:child_process';
import {MaterialStore} from '../../rebuild/material-server/store.mjs';import {listen} from '../../rebuild/material-server/http.mjs';
const repo=process.cwd(),python=path.join(repo,'.runtime/hermes-agent/.venv/bin/python3'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'workbuddy-package-')),dir=path.join(temp,'cz-iot-cli');
const unpack=spawnSync(python,['-I','-S','-B','-c','import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',path.resolve(process.argv[2]??path.join(repo,'outputs/cz-iot-cli.zip')),temp]);assert.equal(unpack.status,0);
const env={...process.env,CODEX_THREAD_ID:'',CLAUDE_CODE_SESSION_ID:'',IO_AGENT_CALLER_RUNTIME:'workbuddy',IO_AGENT_CALLER_SESSION:'synthetic-package-'+crypto.randomUUID(),IO_AGENT_PYTHON:python,IO_AGENT_PAIRING_HOME:path.join(temp,'pairings')};
function run(script,args=[],input){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[path.join(dir,script),...args],{cwd:temp,env});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);const timer=setTimeout(()=>{p.kill();reject(Error('PACKAGE_TIMEOUT'));},45000);p.on('exit',code=>{clearTimeout(timer);try{resolve({code,value:JSON.parse(out||err)});}catch{reject(Error('PACKAGE_NON_JSON '+(out||err).slice(0,1600)));}});p.stdin.end(input===undefined?'':JSON.stringify(input));});}
const store=new MaterialStore(':memory:'),server=await listen(store);
try{
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'MANIFEST.json')));
 for(const [file,digest] of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex'),digest);
 const help=await run('cz-iot-cli.mjs',['help']);assert.equal(help.code,0);assert.deepEqual(await run('io-agent.mjs',['help']),help);
 assert.equal(manifest.format,'cz-iot-cli-package/1');assert.equal(manifest.entrypoint,'cz-iot-cli.mjs');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'package.json'))).bin['cz-iot-cli'],'cz-iot-cli.mjs');
 const install=spawnSync('npm',['install','--global','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',path.join(temp,'installed'),'--cache',path.join(temp,'npm-cache'),dir],{cwd:temp,env,encoding:'utf8',timeout:30000});assert.equal(install.status,0,install.stderr);
 const binary=spawnSync(path.join(temp,'installed/bin/cz-iot-cli'),['help'],{cwd:temp,env,encoding:'utf8',timeout:30000});assert.equal(binary.status,0,binary.stderr);assert.deepEqual(JSON.parse(binary.stdout),help.value);
 assert.equal((await run('cz-iot-cli.mjs',['connector','help'])).code,0);
 assert.equal((await run('setup.mjs',['doctor'])).code,0);
 assert.equal((await run('cz-iot-cli.mjs',['join'],{topic:'合成问答'})).value.error,'DEVICE_NOT_ENROLLED');
 // A test-only preload redirects the fixed HTTPS service to this isolated in-memory fixture.
 const hook=path.join(temp,'loopback.mjs');fs.writeFileSync(hook,`const original=globalThis.fetch;globalThis.fetch=(url,options)=>{const value=String(url);if(!value.startsWith('https://cznbnb.cn/io-api/v1/'))throw Error('unexpected server');return original(value.replace('https://cznbnb.cn/io-api/v1/','http://127.0.0.1:${server.address().port}/v1/'),options);};`);env.NODE_OPTIONS='--import '+hook;
 const phone=store.devices.enroll({owner:'synthetic-workbuddy',role:'phone',label:'Synthetic phone'});
 const pair=await run('cz-iot-cli.mjs',['pair'],{topic:'合成问答',workspace:'/synthetic/project'});assert.equal(pair.code,0,JSON.stringify(pair.value));
 assert.equal((await run('cz-iot-cli.mjs',['pair-status'],{})).value.waiting_for_phone,true);
 const html=fs.readFileSync(pair.value.qr_html,'utf8');assert(html.includes('<svg')&&html.includes(pair.value.pairing_string));
 const [prefix,id,code]=pair.value.pairing_string.split(':');assert.equal(prefix,'io-agent-pair/1');
 const preview=store.sessionPairings.preview(phone.token,{id,code});assert.equal(preview.metadata.route.session_id,env.IO_AGENT_CALLER_SESSION);assert.equal(preview.metadata.mode,'computer');store.sessionPairings.approve(phone.token,{id,code});
 assert.equal((await run('cz-iot-cli.mjs',['pair-status'],{})).value.paired,true);
 const daily=JSON.parse(fs.readFileSync(new URL('../../docs/contracts/material-v1.1.json',import.meta.url))).events[2];
 Object.assign(daily,{event_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),producer_id:phone.producer_id,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString()});
 Object.assign(daily.body,{material_id:'daily-package-fixture',revision:1,base_revision:0,text_revision:1,source:'agent_analysis',started_at:'2026-10-26T00:00:00Z',ended_at:'2026-10-27T00:00:00Z',utterances:[],audio:{state:'not_retained',sha256:null,object_id:null},full_text:{format:'markdown',text:'# 2026-10-26 每日 AI 总结\n\nPortable daily fixture',origin:'legacy'}});store.submit(phone.token,daily);
 const readerEnv={runtime:env.IO_AGENT_CALLER_RUNTIME,session:env.IO_AGENT_CALLER_SESSION,python:env.IO_AGENT_PYTHON};delete env.IO_AGENT_CALLER_RUNTIME;delete env.IO_AGENT_CALLER_SESSION;env.IO_AGENT_PYTHON='/not-installed/python';
 const read=await run('cz-iot-cli.mjs',['daily'],{date:'2026-10-26'});assert.equal(read.code,0,JSON.stringify(read.value));assert.equal(read.value.items[0].text,daily.body.full_text.text);assert.equal(read.value.coverage.scope,'server_stored_daily_ai_summaries');const legacyRead=await run('io-agent.mjs',['daily'],{date:'2026-10-26'});assert.equal(legacyRead.code,0);for(const key of ['operation','service','filters','items','has_more','coverage'])assert.deepEqual(legacyRead.value[key],read.value[key]);
 const todoInput={todo_key:'portable-name-test',content:'Synthetic portable rename todo',source:'WorkBuddy'};
 const todo=await run('cz-iot-cli.mjs',['todo-add'],todoInput);assert.equal(todo.code,0,JSON.stringify(todo.value));assert.equal(todo.value.state,'pending_confirmation');assert.equal(todo.value.native_created,false);
 const sameTodo=await run('io-agent.mjs',['todo-add'],todoInput);assert.equal(sameTodo.code,0);assert.equal(sameTodo.value.proposal_id,todo.value.proposal_id);
 const todoStatus={proposal_id:todo.value.proposal_id};assert.deepEqual(await run('cz-iot-cli.mjs',['todo-status'],todoStatus),await run('io-agent.mjs',['todo-status'],todoStatus));
 env.IO_AGENT_CALLER_RUNTIME=readerEnv.runtime;env.IO_AGENT_CALLER_SESSION=readerEnv.session;env.IO_AGENT_PYTHON=readerEnv.python;
 const joined=await run('cz-iot-cli.mjs',['join'],{topic:'合成问答'});assert.equal(joined.code,0,JSON.stringify(joined.value));assert.equal(joined.value.joined,true);
 assert.equal((await run('cz-iot-cli.mjs',['config'],{glasses_progress:false})).code,0);
 const ask=await run('cz-iot-cli.mjs',['ask'],{question_key:'workbuddy-package-first',question:'Synthetic choice',mode:'choice',options:[{option_id:'yes',label:'Yes'},{option_id:'no',label:'No'}],expires_at:new Date(Date.now()+300000).toISOString()});assert.equal(ask.code,0,JSON.stringify(ask.value));
 const requestRow=store.queueGet(phone.token,'request',ask.value.request_id);
 store.queueSubmit(phone.token,{schema_version:'1.0',event_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),kind:'answer',producer_id:phone.producer_id,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString(),body:{answer_id:'synthetic-workbuddy-answer',task_id:joined.value.task_id,request_id:requestRow.object_id,request_revision:requestRow.revision,route:requestRow.body.route,option_id:'yes',text:'Synthetic package answer',input_source:'phone',raw_action:null}},'answer');
 const waited=await run('cz-iot-cli.mjs',['wait'],{request_id:ask.value.request_id,wait_seconds:0});assert.equal(waited.code,0,JSON.stringify(waited.value));assert.equal(waited.value.state,'answered');assert.equal(waited.value.answer.body.option_id,'yes');assert.equal(requestRow.body.route.agent_id,'io-workbuddy');assert.equal(requestRow.body.route.session_id,env.IO_AGENT_CALLER_SESSION);
 env.IO_AGENT_CALLER_SESSION='synthetic-new-'+crypto.randomUUID();
 const reused=await run('io-agent.mjs',['pair'],{});assert.equal(reused.value.paired,true);assert.equal(reused.value.scope,'computer');
 const second=await run('cz-iot-cli.mjs',['notify'],{notification_key:'new-session-auto-join',text:'Synthetic auto-join notice',expires_at:new Date(Date.now()+300000).toISOString()});assert.equal(second.code,0,JSON.stringify(second.value));assert.equal(second.value.server_stored,true);
 console.log(JSON.stringify({canonical_cli:'cz-iot-cli',offline_local_bin_install:true,compatibility_entry_same_help_daily_pairing:true,todo_alias_reuses_same_proposal_without_session_python:true,computer_pair_once_new_session_reuses:true,passed:true,files:Object.keys(manifest.files).length,zip_hashes_verified:true,standalone_help_doctor_pair_string_qr:true,no_registration_reports_error:true,generic_workbuddy_join_ask_wait:true,synthetic_answer_received:true,daily_read_without_session_or_python:true,real_devices_or_public_server_accessed:false,windows_tested:false}));
}finally{await new Promise(r=>server.close(r));store.close();fs.rmSync(temp,{recursive:true,force:true});}
