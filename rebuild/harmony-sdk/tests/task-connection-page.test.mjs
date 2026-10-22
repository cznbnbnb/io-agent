import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {loadApp} from './load-app.mjs';

const require=createRequire(import.meta.url),deveco=process.env.DEVECO_HOME||'/Applications/DevEco-Studio.app/Contents';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/TaskPanel.ets',import.meta.url),'utf8');
function method(name){
  const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);assert(match,name);
  const after=source.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|@Builder|build\()/.exec(after);assert(next,name);
  return source.slice(match.index,match.index+match[0].length+next.index);
}
const names=['current','cancelCheck','clearConnectionDraft','edited','matchesBinding','proposedSettings','expectedExpiry','connectionError','importConnection','cleanupPending','load','save','openQuestion','answer','startGlasses','report'];
const script=ts.transpileModule(`class Page {\n${names.map(method).join('\n')}\n}\nmodule.exports=Page;`,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const clone=v=>JSON.parse(JSON.stringify(v)),turn=()=>new Promise(r=>setImmediate(r));
const {TaskTarget,validateTaskTarget}=loadApp('TaskTransport'),{TaskSettings}=loadApp('TaskSettings',{'@kit.AssetStoreKit':{asset:{}}});
const {TaskRequestBody}=loadApp('TaskWire'),{taskErrorText,taskSendStateText}=loadApp('TaskLabels');
const {TaskDecisionPlan}=loadApp('TaskReplyDraft');
const config=()=>({schema:1,enabled:true,target:{baseUrl:'https://synthetic.invalid/v1',token:'a'.repeat(43),principal:{ownerId:'owner',producerId:'phone',serverId:'server'}},route:{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'existing'}});
const candidate=()=>({target:{...config().target,token:'b'.repeat(43)},route:{...config().route,session_id:'registered-existing'},tokenId:'synthetic-token-id',expiresAt:Date.now()+3600000});
function fixture(){
  const calls={checks:[],saves:[],reads:[],unlinks:[],refreshes:0,bindings:[],answers:[],cards:[]},files=new Map();let saved=config(),checker,pick=async()=>[],answerFailure=false,boundQuestion={};
  class Client{cancel(){}setForeground(){}async preflight(target,expiry){validateTaskTarget(target);calls.checks.push({target:clone(target),expiry});
    return checker?checker(target,expiry):{expires_at:new Date(expiry||Date.now()+3600000).toISOString()};}}
  const service={async settings(){return clone(saved);},async save(v){calls.saves.push(clone(v));saved=clone(v);},
    bindReply(key,id,revision){const b={...boundQuestion,context_key:key,operation_id:'bound-'+calls.bindings.length,request_id:id,request_revision:revision,route:clone(config().route)};calls.bindings.push(clone(b));return b;},
    answerBound(...args){calls.answers.push(clone(args));if(answerFailure)throw Error('TASK_PERSIST_FAILED');return 'awaiting_refresh';}};
  const readTaskConnectionFile=uri=>{calls.reads.push(uri);if(!files.has(uri))throw Error('TASK_IMPORT_READ_FAILED');return clone(files.get(uri));};
  const module={exports:{}};
  vm.runInNewContext(script,{module,exports:module.exports,TaskTransport:Client,TaskTarget,TaskSettings,TaskRequestBody,TaskDecisionPlan,taskErrorText,taskSendStateText,taskService:service,taskSuggestions:{async start(...args){calls.cards.push(clone(args));}},readTaskConnectionFile,
    fs:{unlinkSync(path){calls.unlinks.push(path);files.delete(path);}},picker:{DocumentViewPicker:class{async select(){return pick();}}},Date,Error,JSON});
  const page=new module.exports();Object.assign(page,{visible:true,expanded:true,loaded:false,settingsBusy:false,epoch:0,token:'',hasSavedToken:false,boundExpiry:0,
    credentialExpiry:0,identityClient:new Client(),pendingFile:()=>'/private/task-connection.json',getUIContext:()=>({getHostContext:()=>({})}),refresh(){calls.refreshes++;}});
  return{page,calls,files,get saved(){return saved;},setChecker:v=>checker=v,setPicker:v=>pick=v,setAnswerFailure:v=>answerFailure=v,setQuestion:v=>boundQuestion=v};
}

test('saved task bearer stays out of the password input and cannot follow an edited endpoint or identity',async()=>{
  for(const field of ['baseUrl','owner','producer','server']){
    const f=fixture();await f.page.load();assert.equal(f.page.token,'');assert.equal(f.page.hasSavedToken,true);
    assert.equal(f.page.proposedSettings().target.token,config().target.token);f.page[field]='different';f.page.edited();
    assert.equal(f.page.proposedSettings().target.token,'');await f.page.save();assert.equal(f.calls.checks.length,0);assert.equal(f.calls.saves.length,0);
  }
});

test('cancelled picker preserves both current settings and draft without touching a private pending file',async()=>{
  const f=fixture();await f.page.load();const before=f.page.proposedSettings();await f.page.importConnection(false);
  assert.deepEqual(clone(f.page.proposedSettings()),clone(before));assert.equal(f.calls.checks.length,0);assert.equal(f.calls.reads.length,0);assert.equal(f.calls.saves.length,0);
});

test('registered task import checks identity only, stays disabled and is saved only after an explicit enabled save',async()=>{
  const f=fixture(),c=candidate();f.files.set('/private/task-connection.json',c);await f.page.load();await f.page.importConnection(true);
  assert.equal(f.calls.checks.length,1);assert.equal(f.calls.saves.length,0);assert.equal(f.page.taskEnabled,false);assert.equal(f.page.token,'');
  assert.equal(f.page.session,c.route.session_id);assert.equal(f.page.proposedSettings().target.token,c.target.token);
  f.page.taskEnabled=true;await f.page.save();assert.equal(f.calls.checks.length,2);assert.equal(f.calls.saves.length,1);assert.equal(f.saved.route.session_id,c.route.session_id);
  assert.equal(f.saved.enabled,true);assert.deepEqual(f.calls.unlinks,['/private/task-connection.json']);assert.equal(f.page.token,'');
});

test('pending file replaced during save is retained and selected documents are never deleted',async()=>{
  const f=fixture(),c=candidate();f.files.set('/private/task-connection.json',c);await f.page.load();await f.page.importConnection(true);
  f.files.set('/private/task-connection.json',{...c,tokenId:'replacement'});f.page.taskEnabled=true;await f.page.save();assert.equal(f.calls.saves.length,1);assert.equal(f.calls.unlinks.length,0);
  const g=fixture();g.setPicker(async()=>['file://selected-document']);g.files.set('file://selected-document',candidate());await g.page.load();await g.page.importConnection(false);
  g.page.taskEnabled=true;await g.page.save();assert.equal(g.calls.saves.length,1);assert.equal(g.calls.unlinks.length,0);
});

test('late import identity after leaving settings cannot replace fields or save configuration',async()=>{
  const f=fixture();f.files.set('/private/task-connection.json',candidate());await f.page.load();let resolve;f.setChecker(()=>new Promise(r=>resolve=r));
  const pending=f.page.importConnection(true);await turn();f.page.expanded=false;f.page.clearConnectionDraft();resolve({expires_at:new Date(Date.now()+3600000).toISOString()});await pending;
  assert.equal(f.page.boundTarget,undefined);assert.equal(f.page.token,'');assert.equal(f.calls.saves.length,0);assert.equal(f.calls.unlinks.length,0);
});

test('late enabled-save preflight after closing settings cannot write the vault',async()=>{
  const f=fixture();await f.page.load();let resolve;f.setChecker(()=>new Promise(r=>resolve=r));const pending=f.page.save();await turn();
  f.page.expanded=false;f.page.clearConnectionDraft();resolve({expires_at:new Date(Date.now()+3600000).toISOString()});await pending;assert.equal(f.calls.saves.length,0);
});

test('failed identity leaves saved settings unchanged; pausing an existing target remains possible offline',async()=>{
  const f=fixture();await f.page.load();f.setChecker(async()=>{throw Error('TASK_IDENTITY_MISMATCH');});await f.page.save();assert.equal(f.calls.saves.length,0);assert.equal(f.saved.enabled,true);
  f.page.taskEnabled=false;await f.page.save();assert.equal(f.calls.saves.length,1);assert.equal(f.saved.enabled,false);assert.equal(f.saved.target.token,config().target.token);
});

test('normal phone answer freezes its operation and route when opened, retaining them after uncertain local save',()=>{
 const f=fixture();Object.assign(f.page,{summary:{contextKey:'original-context'},canAnswer:()=>true});
 const item={object_id:'original-request',revision:3,expires_at:new Date(Date.now()+60000).toISOString(),body:{request_id:'original-request',revision:3,task_id:'original-task'}};
 f.page.openQuestion(item);f.page.answerText='用新价格，但运费沿用上次';f.page.option='';f.setAnswerFailure(true);f.page.answer();
 assert.equal(f.page.question.request_id,'original-request');assert.equal(f.calls.bindings.length,1);f.setAnswerFailure(false);f.page.answer();
 assert.equal(f.calls.answers.length,2);assert.deepEqual(f.calls.answers[0],f.calls.answers[1]);assert.equal(f.calls.answers[1][0].route.session_id,'existing');assert.equal(f.calls.answers[1][3],'phone');
 assert.equal(f.page.question.request_id,'');f.page.answer();assert.equal(f.calls.answers.length,2,'late duplicate click cannot start a new answer operation');
});

test('a stale editor cannot submit another question using its previous binding',()=>{
 const f=fixture();Object.assign(f.page,{summary:{contextKey:'original-context'},canAnswer:()=>true});
 f.page.openQuestion({object_id:'q1',revision:1,expires_at:new Date(Date.now()+60000).toISOString(),body:{request_id:'q1',revision:1}});
 f.page.question.request_id='q2';f.page.answerText='禁止错投';f.page.answer();assert.equal(f.calls.answers.length,0);assert.match(f.page.note,/已更新/);
});
test('normal glasses entry uses the displayed request and explicit adopted option, independently of the phone answer operation',()=>{
 const f=fixture();Object.assign(f.page,{summary:{contextKey:'original-context'},question:{request_id:'q',revision:3},option:'b'});
 f.setQuestion({mode:'choice',options:[{option_id:'a',label:'旧价格'},{option_id:'b',label:'新价格'}]});f.page.startGlasses();
 assert.equal(f.calls.cards.length,1);assert.equal(f.calls.cards[0][0].request_id,'q');assert.equal(f.calls.cards[0][0].request_revision,3);
 assert.equal(f.calls.cards[0][1].adopt_option_id,'b');assert.equal(f.calls.cards[0][1].adopt_text,'新价格');assert.equal(f.calls.cards[0][1].decline_option_id,null);assert.equal(f.calls.cards[0][1].decline_text,'未采用当前方案');
 f.page.option='';f.page.startGlasses();assert.equal(f.calls.cards.length,1,'no guessed option mapping');assert.match(f.page.note,/先指定采用项/);
});
