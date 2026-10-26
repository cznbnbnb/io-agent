import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawn,spawnSync} from 'node:child_process';
import {MaterialStore} from '../../rebuild/material-server/store.mjs';import {listen} from '../../rebuild/material-server/http.mjs';
const repo=process.cwd(),python=path.join(repo,'.runtime/hermes-agent/.venv/bin/python3'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'workbuddy-package-')),dir=path.join(temp,'io-agent-workbuddy');
const unpack=spawnSync(python,['-I','-S','-B','-c','import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',path.join(repo,'outputs/io-agent-workbuddy-session-pairing-2026-10-26.zip'),temp]);assert.equal(unpack.status,0);
const env={...process.env,CODEX_THREAD_ID:'',CLAUDE_CODE_SESSION_ID:'',IO_AGENT_CALLER_RUNTIME:'workbuddy',IO_AGENT_CALLER_SESSION:'synthetic-package-'+crypto.randomUUID(),IO_AGENT_PYTHON:python};
function run(script,args=[],input){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[path.join(dir,script),...args],{cwd:temp,env});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);const timer=setTimeout(()=>{p.kill();reject(Error('PACKAGE_TIMEOUT'));},45000);p.on('exit',code=>{clearTimeout(timer);try{resolve({code,value:JSON.parse(out||err)});}catch{reject(Error('PACKAGE_NON_JSON '+(out||err).slice(0,1600)));}});p.stdin.end(input===undefined?'':JSON.stringify(input));});}
const store=new MaterialStore(':memory:'),server=await listen(store);
try{
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'MANIFEST.json')));
 for(const [file,digest] of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex'),digest);
 assert.equal((await run('io-agent.mjs',['help'])).code,0);
 assert.equal((await run('setup.mjs',['doctor'])).code,0);
 assert.equal((await run('io-agent.mjs',['join'],{topic:'合成问答'})).value.error,'DEVICE_NOT_ENROLLED');
 // A test-only preload redirects the fixed HTTPS service to this isolated in-memory fixture.
 const hook=path.join(temp,'loopback.mjs');fs.writeFileSync(hook,`const original=globalThis.fetch;globalThis.fetch=(url,options)=>{const value=String(url);if(!value.startsWith('https://cznbnb.cn/io-api/v1/'))throw Error('unexpected server');return original(value.replace('https://cznbnb.cn/io-api/v1/','http://127.0.0.1:${server.address().port}/v1/'),options);};`);env.NODE_OPTIONS='--import '+hook;
 const phone=store.devices.enroll({owner:'synthetic-workbuddy',role:'phone',label:'Synthetic phone'});
 const pair=await run('io-agent.mjs',['pair'],{topic:'合成问答',workspace:'/synthetic/project'});assert.equal(pair.code,0,JSON.stringify(pair.value));
 assert.equal((await run('io-agent.mjs',['pair-status'],{})).value.waiting_for_phone,true);
 const html=fs.readFileSync(pair.value.qr_html,'utf8');assert(html.includes('<svg')&&html.includes(pair.value.pairing_string));
 const [prefix,id,code]=pair.value.pairing_string.split(':');assert.equal(prefix,'io-agent-pair/1');
 const preview=store.sessionPairings.preview(phone.token,{id,code});assert.equal(preview.metadata.route.session_id,env.IO_AGENT_CALLER_SESSION);store.sessionPairings.approve(phone.token,{id,code});
 assert.equal((await run('io-agent.mjs',['pair-status'],{})).value.paired,true);
 const joined=await run('io-agent.mjs',['join'],{topic:'合成问答'});assert.equal(joined.code,0,JSON.stringify(joined.value));assert.equal(joined.value.joined,true);
 assert.equal((await run('io-agent.mjs',['config'],{glasses_progress:false})).code,0);
 const ask=await run('io-agent.mjs',['ask'],{question_key:'workbuddy-package-first',question:'Synthetic choice',mode:'choice',options:[{option_id:'yes',label:'Yes'},{option_id:'no',label:'No'}],expires_at:new Date(Date.now()+300000).toISOString()});assert.equal(ask.code,0,JSON.stringify(ask.value));
 const requestRow=store.queueGet(phone.token,'request',ask.value.request_id);
 store.queueSubmit(phone.token,{schema_version:'1.0',event_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),kind:'answer',producer_id:phone.producer_id,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString(),body:{answer_id:'synthetic-workbuddy-answer',task_id:joined.value.task_id,request_id:requestRow.object_id,request_revision:requestRow.revision,route:requestRow.body.route,option_id:'yes',text:'Synthetic package answer',input_source:'phone',raw_action:null}},'answer');
 const waited=await run('io-agent.mjs',['wait'],{request_id:ask.value.request_id,wait_seconds:0});assert.equal(waited.code,0,JSON.stringify(waited.value));assert.equal(waited.value.state,'answered');assert.equal(waited.value.answer.body.option_id,'yes');assert.equal(requestRow.body.route.agent_id,'io-workbuddy');assert.equal(requestRow.body.route.session_id,env.IO_AGENT_CALLER_SESSION);
 console.log(JSON.stringify({passed:true,files:Object.keys(manifest.files).length,zip_hashes_verified:true,standalone_help_doctor_pair_string_qr:true,no_registration_reports_error:true,generic_workbuddy_join_ask_wait:true,synthetic_answer_received:true,real_devices_or_public_server_accessed:false,windows_tested:false}));
}finally{await new Promise(r=>server.close(r));store.close();fs.rmSync(temp,{recursive:true,force:true});}
