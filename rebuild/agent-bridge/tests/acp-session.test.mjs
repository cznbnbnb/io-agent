import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
import {AcpSession} from '../hosts/acp-session.mjs';
import {initializeConnector,readConnector,connectorConfig} from '../connector.mjs';
const peer=fileURLToPath(new URL('./fixtures/acp-agent.mjs',import.meta.url));
function setup(t){
 const directory=fs.realpathSync(fs.mkdtempSync('/tmp/io-acp-unit-')),command=[process.execPath,peer],hosts=[];
 t.after(async()=>{for(const h of hosts)await h.close();fs.rmSync(directory,{recursive:true,force:true});});
 return{directory,command,ledger:()=>JSON.parse(fs.readFileSync(path.join(directory,'fixture-native.json'))),
  async open(sessionId){const h=await AcpSession.connect({command,workspace:directory,stateFile:path.join(directory,'acp.json'),sessionId});hosts.push(h);return h;}};
}
const start=(h,text,id=randomUUID())=>h.start({text,clientUserMessageId:id,expiresAt:new Date(Date.now()+60000).toISOString()}).then(()=>id);
async function finished(h,id){for(let i=0;i<100;i++){const op=await h.inspectOperation(id);if(op.status!=='inProgress')return op;await new Promise(r=>setTimeout(r,10));}assert.fail('prompt did not settle');}
test('new/load have no prompts, context survives native restart, and replay never becomes a result',async t=>{
 const f=setup(t);f.command.push('');const a=await f.open();assert.deepEqual(f.ledger().prompts,[]);const first=await start(a,'one');assert.equal((await finished(a,first)).result.text,'answer:one');
 const id=a.sessionId;await a.close();const b=await f.open(id);assert.equal(b.sessionId,id);assert.equal((await b.inspectOperation(first)).result.text,'answer:one');
 const second=await start(b,'two');assert.equal((await finished(b,second)).result.text,'answer:one|two');assert.deepEqual(f.ledger().prompts,['one','two']);
});
test('one flight, duplicate operation and expired input cannot submit another prompt',async t=>{
 const f=setup(t),h=await f.open(),id=await start(h,'one');await finished(h,id);await start(h,'one',id);assert.deepEqual(f.ledger().prompts,['one']);
 await assert.rejects(start(h,'different',id),{code:'ACP_OPERATION_CONFLICT'});
 await assert.rejects(h.start({text:'expired',clientUserMessageId:randomUUID(),expiresAt:new Date(0).toISOString()}),{code:'ACP_INPUT_EXPIRED'});
 const wait=await start(h,'wait');await assert.rejects(start(h,'next'),{code:'ACP_HOST_BUSY'});
 await assert.rejects(h.interrupt('wrong-turn'),{code:'ACP_STOP_STALE'});
 const turn=await h.inspectOperation(wait);await h.interrupt(turn.turnId);assert.equal((await finished(h,wait)).status,'interrupted');
 assert.equal((await h.inspectStop(turn.turnId)).descendantsStopped,false);
});
test('permission is cancelled rather than auto-approved and does not report successful completion',async t=>{
 const f=setup(t),h=await f.open(),id=await start(h,'permission');assert.equal((await finished(h,id)).status,'failed');
 assert.deepEqual(f.ledger().permission,{outcome:{outcome:'cancelled'}});
});
test('lost transport is unknown and loading history never replays the input',async t=>{
 const f=setup(t),h=await f.open(),id=await start(h,'disconnect');assert.equal((await finished(h,id)).status,'unknown');await h.close();
 const next=await f.open(h.sessionId);assert.equal((await next.inspectOperation(id)).status,'unknown');await start(next,'disconnect',id);
 assert.deepEqual(f.ledger().prompts,['disconnect']);
});
test('foreign session updates cannot be published as this task result',async t=>{
 const f=setup(t),h=await f.open(),id=await start(h,'foreign');assert.equal((await finished(h,id)).status,'unknown');assert.equal(h.ready,false);
});
test('connector creates a distinct managed identity for opaque ACP sessions and rejects overwrite',async t=>{
 const f=setup(t),input={runtime:'workbuddy',label:'隔离连接器',workspace:f.directory,command:[...f.command,'']};
 const result=await initializeConnector(f.directory,input);assert.equal(result.managed,true);assert.match(result.session_id,/^[a-f0-9-]{36}$/);assert.equal(result.native_process_started,false);
 const profile=readConnector(f.directory);assert.equal(profile.route_session_id,result.session_id);assert.equal(profile.native_session_id,undefined);
 assert.equal(fs.existsSync(path.join(f.directory,'fixture-native.json')),false);await assert.rejects(initializeConnector(f.directory,input),{code:'CONNECTOR_ALREADY_INITIALIZED'});
 const device=path.join(f.directory,'device.json');fs.writeFileSync(device,JSON.stringify({role:'agent',computer_id:'fixture-computer',owner_id:'fixture-owner',producer_id:'agent-00000001',server_id:'fixture-server',base_url:'http://127.0.0.1/v1/'}));
 const config=connectorConfig(f.directory,{deviceFile:device});assert.equal(config.native_runtime.sessions[0].host_kind,'acp');assert.equal(config.native_runtime.sessions[0].acp.session_id,null);
});

test('a complete result above the small resident metadata limit survives reopening the ACP journal',async t=>{
 const f=setup(t),h=await f.open(),id=await start(h,'long');assert.equal((await finished(h,id)).result.text.length,40000);await h.close();
 const next=await f.open(h.sessionId);assert.equal((await next.inspectOperation(id)).result.text,'中'.repeat(40000));
});

test('managed CLI mapping requires the real native session identity and never overrides conflicting callers',async t=>{
 const f=setup(t),h=await f.open(),id=await start(h,'one');await finished(h,id);
 const profile={schema_version:1,managed:true,runtime:'codex',label:'Synthetic managed',workspace:f.directory,command:f.command,route_session_id:randomUUID()};
 const file=path.join(f.directory,'connector.json');fs.writeFileSync(file,JSON.stringify(profile),{mode:0o600});
 const {caller}=await import('../questions/cli.mjs');
 const result=caller({CODEX_THREAD_ID:h.sessionId,IO_AGENT_CONNECTOR_PROFILE:file});assert.equal(result.session,profile.route_session_id);assert.equal(result.managed.workspace,f.directory);
 assert.equal(caller({CODEX_THREAD_ID:randomUUID(),IO_AGENT_CONNECTOR_PROFILE:file}).error,'CALLER_MANAGED_MAPPING_INVALID');
 assert.equal(caller({CODEX_THREAD_ID:h.sessionId,CLAUDE_CODE_SESSION_ID:randomUUID(),IO_AGENT_CONNECTOR_PROFILE:file}).error,'CALLER_RUNTIME_AMBIGUOUS');
});
