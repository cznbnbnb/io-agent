import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fork} from 'node:child_process';
import {adminFixture} from '../../material-server/tests/admin-fixture.mjs';import {listen} from '../../material-server/http.mjs';import {SharedInboxSignal} from '../inbox-signal.mjs';import {AgentBridge} from '../bridge.mjs';
const until=async check=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('condition timeout');await new Promise(r=>setTimeout(r,15));}};
async function setup(t){const f=await adminFixture({taskCount:1}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-signals-')),server=await listen(f.store,0,{idleInboxWaitMs:0}),children=[],signals=[],bridges=[];
 const credential=path.join(dir,'credential.json');fs.writeFileSync(credential,JSON.stringify(f.agent),{mode:0o600});const config={schema_version:'1.0',base_url:`http://127.0.0.1:${server.address().port}/v1/`,allow_loopback_http:true,owner_id:f.owner,producer_id:f.agent.producer_id,server_id:f.store.devices.serverId(),credential_file:credential,computer_id:f.routes[0].computer_id,agent_id:f.routes[0].agent_id};
 const requests=[];server.on('request',req=>requests.push(req.url.split('?')[0]));
 t.after(async()=>{for(const b of bridges)await b.stop();for(const s of signals)await s.stop();for(const child of children)if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exited;}server.closeAllConnections();await new Promise(r=>server.close(r));f.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {...f,dir,server,config,requests,signals,bridges,child(){const file=path.join(dir,'worker.json');fs.writeFileSync(file,JSON.stringify({config,directory:path.join(dir,'shared')}));const child=fork(new URL('./fixtures/inbox-signal-worker.mjs',import.meta.url),[file],{stdio:['ignore','ignore','ignore','ipc']});child.on('message',value=>{child.latest=value;});children.push(child);return child;}};}
test('two processes share one wait, both observe changes, hard leader death transfers ownership',async t=>{
 const f=await setup(t),a=f.child(),b=f.child();await until(()=>a.latest?.snapshot?.healthy&&b.latest?.snapshot?.healthy);await until(()=>f.store.inboxWaiters.size===1);
 assert.equal(Number(a.latest.leader)+Number(b.latest.leader),1);assert(f.requests.filter(p=>p==='/v1/inbox/watch').length<=3);
 const before=a.latest.snapshot.key;f.addTask('signal-task','wake both');await until(()=>a.latest.snapshot.key!==before&&b.latest.snapshot.key!==before);
 const leader=a.latest.leader?a:b,other=leader===a?b:a;const exited=new Promise(r=>leader.once('exit',r));leader.kill('SIGKILL');await exited;await until(()=>other.latest.leader&&other.latest.snapshot.healthy);await until(()=>f.store.inboxWaiters.size===1);
 const next=other.latest.snapshot.key;f.addTask('signal-next','after takeover');await until(()=>other.latest.snapshot.key!==next);
});
test('shared bridge stays locally responsive while idle and handles new task exactly once',async t=>{
 const f=await setup(t),seen=[];const adapter={name:'synthetic',capabilities:{can_execute:true},onItem:item=>{if(item.kind==='task')seen.push(item.object_id);return [];},onAnswer:()=>[]};
 const bridge=new AgentBridge({config:f.config,adapter,sharedInbox:true,stateFile:path.join(f.dir,'bridge.json')});f.bridges.push(bridge);await bridge.start();await bridge.pollOnce();seen.length=0;await until(()=>f.store.inboxWaiters.size===1);
 const started=Date.now();for(let i=0;i<30;i++)await bridge.pollOnce();assert(Date.now()-started<500);assert(f.requests.filter(p=>p==='/v1/inbox').length<=3);
 f.addTask('signal-delivery','exactly once');await until(()=>f.requests.filter(p=>p==='/v1/inbox/watch').length>=3);for(let i=0;i<3;i++)await bridge.pollOnce();assert.deepEqual(seen,['signal-delivery']);
});
