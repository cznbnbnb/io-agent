import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {spawn,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../../../material-server/store.mjs';import {listen} from '../../../material-server/http.mjs';
// One-time pairing (2026-10-24): an enrolled computer joins each agent session without any phone-side
// import, the phone paired once sees every session's task, and the computer credential renews itself.
const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url)),device=fileURLToPath(new URL('../../device.mjs',import.meta.url)),workspace=path.resolve(path.dirname(cli),'../../..');
const pythonProbe=spawnSync('python',['-S','-c','import sys;print(sys.executable)'],{encoding:'utf8',timeout:5000});if(pythonProbe.status!==0)throw Error('Explicit Python interpreter required for join tests');const python=pythonProbe.stdout.trim();
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
function run(script,args,input,env){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[script,...args],{cwd:workspace,env:{...process.env,CODEX_THREAD_ID:'',CLAUDE_CODE_SESSION_ID:'',IO_AGENT_CALLER_RUNTIME:'',IO_AGENT_CALLER_SESSION:'',...env}});let out='';const timer=setTimeout(()=>{p.kill();reject(Error('timeout'));},45000);p.stdout.on('data',b=>out+=b);p.on('exit',code=>{clearTimeout(timer);try{resolve({code,value:JSON.parse(out)});}catch{reject(Error('Invalid JSON: '+out.slice(0,300)));}});p.stdin.end(input===undefined?'':JSON.stringify(input));});}

test('an enrolled computer joins sessions without phone imports and renews its credential',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'io-join-')),session='test-'+crypto.randomUUID();
 const registrations=path.join(workspace,'rebuild/agent-bridge/private','claude-code-'+sha(JSON.stringify([workspace.toLowerCase(),'claude-code',session])).slice(0,24));
 const store=new MaterialStore(path.join(temp,'queue.sqlite')),server=await listen(store);
 t.after(async()=>{await new Promise(r=>server.close(r));store.close();fs.rmSync(registrations,{recursive:true,force:true});fs.rmSync(temp,{recursive:true,force:true});});
 const file=path.join(temp,'device','agent-device.json'),env={CLAUDE_CODE_SESSION_ID:session,IO_AGENT_DEVICE_FILE:file};
 assert.equal((await run(cli,['join'],{topic:'配对测试',python},env)).value.error,'DEVICE_NOT_ENROLLED');
 const enrolled=store.devices.enroll({owner:'turboio-user',role:'agent',label:'Mac mini'});
 fs.mkdirSync(path.dirname(file),{mode:0o700});
 fs.writeFileSync(file,JSON.stringify({...enrolled,base_url:`http://127.0.0.1:${server.address().port}/v1/`,allow_loopback_http:true,computer_id:'io-mac-computer'}),{mode:0o600});
 // The phone pairs once with a code the computer shows.
 const pairing=await run(device,['pair-phone','我的手机'],undefined,env);assert.equal(pairing.code,0,JSON.stringify(pairing.value));
 const phone=store.devices.pair({code:pairing.value.code});
 const joined=await run(cli,['join'],{topic:'配对测试',python},env);assert.equal(joined.code,0,JSON.stringify(joined.value));
 assert.equal(joined.value.phone_import_required,false);assert.equal(joined.value.reused,false);assert.ok(Array.isArray(joined.value.contract));
 const task=store.queueGet(phone.token,'task',joined.value.task_id);
 assert.deepEqual(task.body.route,{computer_id:'io-mac-computer',agent_id:'io-claude-code',project_id:'rayneo-io-agent',session_id:session});
 assert.equal(task.body.command,'配对测试');assert.ok(Date.parse(task.command_expires_at)>Date.now()+11*3600000);
 assert.ok(store.inbox(phone.token,{}).items.some(i=>i.kind==='task'&&i.object_id===joined.value.task_id),'the single phone pairing sees the session');
 const again=await run(cli,['join'],{topic:'配对测试',python},env);assert.equal(again.value.task_id,joined.value.task_id);assert.equal(again.value.reused,true);
 // Renewal: once past refresh_after the next call swaps the token in place and keeps the device.
 const before=JSON.parse(fs.readFileSync(file));fs.writeFileSync(file,JSON.stringify({...before,refresh_after:new Date(Date.now()-1000).toISOString()}),{mode:0o600});
 const notice={notification_key:'pairing-renewal',text:'续期后仍能推送到眼镜',expires_at:new Date(Date.now()+300000).toISOString()};
 const notified=await run(cli,['notify'],notice,env);assert.equal(notified.code,0,JSON.stringify(notified.value));
 const after=JSON.parse(fs.readFileSync(file));assert.notEqual(after.token,before.token);assert.equal(after.device_id,before.device_id);
 assert.equal(after.computer_id,'io-mac-computer');assert.ok(Date.parse(after.refresh_after)>Date.now());assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.equal(store.queueGet(phone.token,'message',notified.value.message_id).body.text,notice.text);
 // A new topic is a new task on the same phone pairing; the device list shows both devices.
 const other=await run(cli,['join'],{topic:'另一个话题',python},env);assert.notEqual(other.value.task_id,joined.value.task_id);
 const listed=await run(device,['devices'],undefined,env);assert.deepEqual(listed.value.devices.map(d=>d.role).sort(),['agent','phone']);
 assert.equal((await run(device,['unpair',phone.device_id],undefined,env)).value.revoked,true);
 assert.throws(()=>store.auth(phone.token),e=>e.code==='UNAUTHENTICATED');
});
