// Local synthetic E2E only: unchanged material-server + real desktop AgentBridge.
// This is a deterministic test runtime, not a Codex/Hermes acceptance claim.
import fs from 'node:fs';import path from 'node:path';import https from 'node:https';import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../../rebuild/material-server/store.mjs';
import {createServer} from '../../rebuild/material-server/http.mjs';
import {AgentBridge} from '../../rebuild/agent-bridge/bridge.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../rebuild/android-app/.private');
const dir=path.join(root,'https-fixture'),tls=path.join(root,'fixture-tls');fs.mkdirSync(dir,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const load=(name,fallback)=>fs.existsSync(path.join(dir,name))?JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')):fallback;
const store=new MaterialStore(path.join(dir,'synthetic.sqlite'));
const owner='android-local-e2e',route={computer_id:'fixture-pc',agent_id:'fixture-agent',project_id:'android-e2e',session_id:'synthetic-existing-session'};
const old=load('credentials.json',{});
function credential(key,producer,scopes){const value=old[key];try{if(value){const identity=store.identity(value.token);if(identity.owner_id===owner&&identity.producer_id===producer&&identity.scopes.length===scopes.length&&scopes.every(s=>identity.scopes.includes(s)))return value;}}catch{}return store.mint({owner,producer,scopes,ttlMs:86400000});}
const phone=credential('phone','android-simulator',['tasks:read','tasks:write','tasks:update','requests:read','answers:write','messages:receive','receipts:phone']);
const agent=credential('agent','fixture-runtime',['tasks:read','tasks:update','requests:write','messages:receive','messages:write','receipts:agent']);
write('credentials.json',{phone,agent});write('agent-token.json',agent);
const identity=store.identity(phone.token);
write('task-connection.json',{format:'turboio-task-connection/1',base_url:'https://127.0.0.1/v1',owner_id:owner,producer_id:'android-simulator',server_id:identity.server_id,...phone,...route});
const stats=load('stats.json',{tls_answer_posts:0,dropped_answer_replies:0,task_intakes:0,answer_intakes:0,completed:0});
const ledger=load('runtime.json',{commands:{},answers:{}});
const persist=()=>{write('stats.json',stats);write('runtime.json',ledger);};
persist();
const app=createServer(store);
const secure=https.createServer({key:fs.readFileSync(path.join(tls,'server.key')),cert:fs.readFileSync(path.join(tls,'server.pem')),minVersion:'TLSv1.2'},(req,res)=>{
 const dropFile=path.join(dir,'drop-next-answer.flag');
 if(req.method==='POST'&&req.url==='/v1/answers'){
  stats.tls_answer_posts++;persist();
  if(fs.existsSync(dropFile)){
   const end=res.end.bind(res);res.end=(data,...args)=>{if(res.statusCode>=200&&res.statusCode<300){fs.unlinkSync(dropFile);stats.dropped_answer_replies++;persist();res.destroy();return res;}return end(data,...args);};
  }
 }
 app.emit('request',req,res);
});
const adapter={name:'synthetic-existing-session-fixture',capabilities:{can_execute:true},
 onItem(item){
  if(item.kind!=='task'||item.revision!==1||item.state!=='queued')return [];
  if(JSON.stringify(item.body.route)!==JSON.stringify(route)&&Object.keys(route).some(k=>item.body.route[k]!==route[k]))throw new Error('FIXTURE_ROUTE_INVALID');
  if(ledger.commands[item.object_id])return ledger.commands[item.object_id].actions;
  const actions=[{action:'task_state',state:'agent_received'},{action:'receipt',stage:'agent_received',subject_kind:'task',subject_id:item.object_id,subject_revision:1},{action:'task_state',state:'waiting_answer'},{action:'request',request_id:'request-'+item.object_id,runtime_request_id:'fixture-wait-'+item.object_id,mode:'choice',question:'合成联调：采用哪个方案？可以附上完整限制条件。',options:[{option_id:'A',label:'方案 A'},{option_id:'B',label:'方案 B'}]}];
  ledger.commands[item.object_id]={command:item.body.command,route:item.body.route,actions};stats.task_intakes++;persist();return actions;
 },
 onAnswer(value){
  const {request,answer}=value,key=answer.object_id;if(ledger.answers[key])return ledger.answers[key].actions;
  const text=answer.body.text,task=request.body.task_id;
  const actions=[{action:'receipt',stage:'agent_received',subject_kind:'answer',subject_id:answer.object_id,subject_revision:1},{action:'task_state',state:'running'},{action:'receipt',stage:'task_resumed',subject_kind:'task',subject_id:task,subject_revision:1},{action:'message',message_id:'result-'+key,channel:'result',text:'合成任务已在原会话继续。完整答案：\n'+text},{action:'task_state',state:'completed'},{action:'receipt',stage:'task_completed',subject_kind:'task',subject_id:task,subject_revision:1}];
  ledger.answers[key]={request_id:request.object_id,text,route:answer.body.route,actions};stats.answer_intakes++;stats.completed++;persist();return actions;
 }
};
await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve);});
try{await new Promise((resolve,reject)=>{secure.once('error',reject);secure.listen(443,'127.0.0.1',resolve);});}catch(error){app.close();store.close();throw error;}
const config={schema_version:'1.0',base_url:`http://127.0.0.1:${app.address().port}/v1/`,owner_id:owner,producer_id:'fixture-runtime',server_id:identity.server_id,credential_file:path.join(dir,'agent-token.json'),state_file:path.join(dir,'bridge-state.json'),computer_id:route.computer_id,agent_id:route.agent_id,allow_loopback_http:true};
const bridge=new AgentBridge({config,adapter});await bridge.start();
write('status.json',{schema:1,pid:process.pid,ready:true,https:'https://127.0.0.1/v1',scope:'synthetic data + deterministic fixture runtime; real server/bridge/HTTPS',real_codex:false,real_hermes:false,phone_io:false});
console.log('Synthetic HTTPS + real server/bridge ready on loopback:443');
let busy=false,stopping=false;const interval=setInterval(async()=>{if(busy||stopping)return;busy=true;try{await bridge.pollOnce();}catch(error){write('last-error.json',{code:error.code??'FIXTURE_FAILED',at:new Date().toISOString()});}finally{busy=false;}},250);
async function stop(){if(stopping)return;stopping=true;clearInterval(interval);await bridge.stop();await Promise.all([new Promise(r=>secure.close(r)),new Promise(r=>app.close(r))]);store.close();write('status.json',{ready:false,stopped:true});}
process.once('SIGINT',()=>stop());process.once('SIGTERM',()=>stop());
