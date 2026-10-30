import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
import {MaterialStore} from '../../material-server/store.mjs';import {listen} from '../../material-server/http.mjs';
import {initializeConnector,connectorConfig,runConnector} from '../connector.mjs';
const peer=fileURLToPath(new URL('./fixtures/acp-agent.mjs',import.meta.url));
async function wait(check){for(let n=0;n<120;n++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,25));}assert.fail('bounded ACP bridge wait expired');}
async function fixture(t,{expectedError=null}={}){
 const directory=fs.realpathSync(fs.mkdtempSync('/tmp/io-acp-bridge-'));fs.chmodSync(directory,0o700);
 const store=new MaterialStore(path.join(directory,'server.sqlite')),server=await listen(store);
 const agent=store.devices.enroll({owner:'synthetic-acp',role:'agent',label:'Synthetic ACP'}),pair=store.devices.createPairing(agent.token,{role:'phone',label:'Synthetic phone'}),phone=store.devices.pair({code:pair.code});
 const deviceFile=path.join(directory,'device.json');fs.writeFileSync(deviceFile,JSON.stringify({...agent,computer_id:'fixture-computer',base_url:`http://127.0.0.1:${server.address().port}/v1/`,allow_loopback_http:true}),{mode:0o600});
 await initializeConnector(directory,{runtime:'workbuddy',label:'Synthetic ACP',workspace:directory,command:[process.execPath,peer,'']});
 const route=connectorConfig(directory,{deviceFile}).native_runtime.sessions[0].route,abort=new AbortController();let running;
 t.after(async()=>{abort.abort();const stopped=expectedError?await assert.rejects(running,{code:expectedError}):await running;if(stopped){assert.equal(stopped.status.started,false);assert.equal(stopped.status.owns_run,false);}await new Promise(r=>server.close(r));store.close();fs.rmSync(directory,{recursive:true,force:true});});
 const submit=(body)=>store.queueSubmit(phone.token,{schema_version:'1.0',kind:'task',event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:phone.producer_id,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),body},'task');
 const task=id=>store.queueGet(phone.token,'task',id);
 return{directory,store,phone,route,task,submit,server,deviceFile,start:(options={})=>{running=runConnector(directory,{deviceFile,signal:abort.signal,maximumMs:15000,...options});return running;},
  request:(id,text)=>submit({task_id:id,revision:1,route,state:'queued',command:text,allow_create_session:false})};
}
test('phone HTTP task reaches managed ACP, result returns, exact stop remains unconfirmed without child proof',async t=>{
 const f=await fixture(t);f.start();
 await wait(()=>f.store.agentSessions.list(f.phone.token).sessions.find(s=>s.online));
 const entry=f.store.agentSessions.list(f.phone.token).sessions[0];assert.equal(entry.host_kind,'acp');assert.equal(entry.capabilities.can_execute,true);
 f.request('first','hello');await wait(()=>f.task('first').state==='completed');
 const messages=f.store.db.prepare("SELECT body FROM queue_revisions WHERE kind='message' ORDER BY seq").all().map(r=>JSON.parse(r.body));assert.equal(messages.map(v=>v.text).join(''),'answer:hello');
 f.request('second','again');await wait(()=>f.task('second').state==='completed');
 const results=f.store.db.prepare("SELECT body FROM queue_revisions WHERE kind='message' ORDER BY seq").all().map(r=>JSON.parse(r.body));assert(results.some(v=>v.text==='answer:hello|again'));
 f.request('approval','permission');
 const request=await wait(()=>{const row=f.store.db.prepare("SELECT body FROM queue_revisions WHERE kind='request' ORDER BY seq DESC LIMIT 1").get();return row&&JSON.parse(row.body);});
 assert.equal(request.task_id,'approval');assert.deepEqual(request.options.map(o=>o.option_id),['allow_once','deny_once']);
 f.store.queueSubmit(f.phone.token,{schema_version:'1.0',kind:'answer',event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:f.phone.producer_id,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),
  body:{answer_id:'fixture-approval-answer',task_id:'approval',request_id:request.request_id,request_revision:request.revision,route:f.route,option_id:'allow_once',text:'仅允许本次',input_source:'phone',raw_action:null}},'answer');
 await wait(()=>f.task('approval').state==='completed');
 f.request('waiting','wait');await wait(()=>f.task('waiting').state==='running');const current=f.task('waiting').body;
 f.submit({...current,revision:current.revision+1,state:'stop_requested',control:{control_id:randomUUID(),kind:'stop',expected_command_id:current.execution.command_id,expected_turn_id:current.execution.turn_id,expires_at:new Date(Date.now()+60000).toISOString()}});
 await wait(()=>f.task('waiting').state==='stop_unconfirmed');assert.equal(f.task('waiting').body.execution.phase,'stop_unconfirmed');
});

test('a gateway outage retains the active native turn and resumes polling without prompt replay',async t=>{
 const f=await fixture(t),statuses=[];let outage=false;
 const [handle]=f.server.listeners('request');f.server.removeListener('request',handle);
 f.server.on('request',(req,res)=>{
  if(outage&&req.url.startsWith('/v1/inbox')){res.writeHead(502,{'Content-Type':'text/html'});res.end('<h1>Bad Gateway</h1>');}
  else handle(req,res);
 });
 f.start({onStatus:event=>statuses.push(event)});await wait(()=>f.store.agentSessions.list(f.phone.token).sessions.find(s=>s.online));
 f.request('outage-turn','delayed');await wait(()=>f.task('outage-turn').state==='running');
 const read=()=>JSON.parse(fs.readFileSync(path.join(f.directory,'acp.json'))),before=read(),operation=Object.values(before.operations)[0];
 assert.equal(operation.status,'inProgress');outage=true;
 await wait(()=>statuses.find(e=>e.event==='connection_retry'));
 assert.equal(statuses[0].error,'UNAVAILABLE');assert.equal(read().session_id,before.session_id);
 assert.equal(Object.values(read().operations)[0].status,'inProgress');
 outage=false;await wait(()=>statuses.find(e=>e.event==='connection_recovered'));
 await wait(()=>f.task('outage-turn').state==='completed');
 f.request('after-outage','after');await wait(()=>f.task('after-outage').state==='completed');
 assert.equal(read().session_id,before.session_id);
 const native=JSON.parse(fs.readFileSync(path.join(f.directory,'fixture-native.json')));assert.deepEqual(native.prompts,['delayed','after']);
});

test('network exceptions retry but permanent authorization failure still ends the connector',async t=>{
 const f=await fixture(t,{expectedError:'FORBIDDEN'}),statuses=[];let failure='network';const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(url.pathname.endsWith('/inbox')){
   if(failure==='network')throw new Error('Synthetic transport unavailable');
   if(failure==='auth')return new Response(JSON.stringify({error:{code:'FORBIDDEN'}}),{status:403,headers:{'Content-Type':'application/json'}});
  }
  return original(url,options);
 };
 t.after(()=>{globalThis.fetch=original;});
 const running=f.start({onStatus:event=>statuses.push(event)});
 const failed=assert.rejects(running,{code:'FORBIDDEN'});
 await wait(()=>statuses.find(e=>e.event==='connection_retry'));assert.equal(statuses[0].error,'NETWORK_UNAVAILABLE');
 failure='';await wait(()=>statuses.find(e=>e.event==='connection_recovered'));
 failure='auth';await failed;
});

test('new paired-computer session automatically gets a real CLI bound to the original phone task',async t=>{
 const f=await fixture(t);f.start();await wait(()=>f.store.agentSessions.list(f.phone.token).sessions.find(s=>s.online));
 f.request('glasses-task','glasses-roundtrip');
 const q=await wait(()=>{const row=f.store.db.prepare("SELECT body FROM queue_revisions WHERE kind='request' ORDER BY seq DESC LIMIT 1").get();return row&&JSON.parse(row.body);});
 assert.equal(q.task_id,'glasses-task');assert.deepEqual(q.route,f.route);
 f.store.queueSubmit(f.phone.token,{schema_version:'1.0',kind:'answer',event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:f.phone.producer_id,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),
  body:{answer_id:'fixture-glasses-answer',task_id:'glasses-task',request_id:q.request_id,request_revision:1,route:f.route,option_id:'two',text:'The second choice',input_source:'glasses_semantic',raw_action:null}},'answer');
 await wait(()=>f.task('glasses-task').state==='completed');
 const requests=f.store.db.prepare("SELECT count(*) n FROM queue_revisions WHERE kind='request'").get();assert.equal(requests.n,1);
 const messages=f.store.db.prepare("SELECT body FROM queue_revisions WHERE kind='message' ORDER BY seq").all().map(r=>JSON.parse(r.body));
 assert(messages.some(m=>m.channel==='progress'&&m.text==='Synthetic Agent notice'&&m.task_id==='glasses-task'));
 assert(messages.some(m=>m.channel==='result'&&m.text==='received:The second choice'));
 assert(f.store.db.prepare("SELECT body FROM queue_revisions WHERE kind='receipt'").all().map(r=>JSON.parse(r.body)).some(r=>r.subject_id==='fixture-glasses-answer'&&r.stage==='agent_received'));
 const journal=JSON.parse(fs.readFileSync(path.join(f.directory,'acp.json'))),op=Object.values(journal.operations)[0];
 const {managedCli}=await import('../questions/managed-cli.mjs');
 await assert.rejects(managedCli('help',{},op.cliContext,{env:{}}),{code:'MANAGED_CLI_TURN_CLOSED'});
 await assert.rejects(managedCli('help',{},op.cliContext,{env:{CODEX_THREAD_ID:'foreign'}}),{code:'MANAGED_CLI_SESSION_MISMATCH'});
});
