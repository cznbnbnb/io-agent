// Offline entry-point tests: actual BridgeClient, real Response streams, no network.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const entry=path.join(workspace,'tools/android/context-cloud-check.mjs');
const client=path.join(workspace,'rebuild/agent-bridge/client.mjs');
const self=fileURLToPath(import.meta.url);
const resultFile=path.join(workspace,'rebuild/android-app/context-voice-fixture-test-results.json');
const runId='voice999-'+crypto.randomBytes(12).toString('hex');
const runParent=path.join(workspace,'rebuild/agent-bridge/private');
const scopeParent=path.join(workspace,'rebuild/android-app/.private');
const run=path.join(runParent,'cloud-'+runId),scopeDir=path.join(scopeParent,runId);
const owned=[];let checks=0,imports=0;const cases=[];
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const sourceHashes=Object.fromEntries([entry,client,self].map(file=>[path.relative(workspace,file).replaceAll('\\','/'),sha(fs.readFileSync(file))]));
const yes=(value)=>{checks++;assert.ok(value);};
const equal=(a,b)=>{checks++;assert.deepEqual(a,b);};
function noLinks(file){
 const absolute=path.resolve(file),parts=absolute.slice(path.parse(absolute).root.length).split(path.sep);let current=path.parse(absolute).root;
 for(const part of parts){current=path.join(current,part);const stat=fs.lstatSync(current);if(stat.isSymbolicLink())throw Error('FIXTURE_LINK_REJECTED');}
 if(path.resolve(fs.realpathSync(absolute)).toLowerCase()!==absolute.toLowerCase())throw Error('FIXTURE_PATH_CHANGED');
}
function createOwned(directory,parent){fs.mkdirSync(parent,{recursive:true,mode:0o700});noLinks(parent);if(path.dirname(path.resolve(directory))!==path.resolve(parent)||fs.existsSync(directory))throw Error('FIXTURE_DIRECTORY_INVALID');fs.mkdirSync(directory,{mode:0o700});noLinks(directory);owned.push({directory,parent});}
function removeOwned({directory,parent}){
 noLinks(parent);noLinks(directory);if(path.dirname(path.resolve(directory))!==path.resolve(parent)||!path.basename(directory).endsWith(runId))throw Error('FIXTURE_CLEANUP_SCOPE_INVALID');
 const pending=[directory];while(pending.length){const folder=pending.pop();for(const name of fs.readdirSync(folder)){const file=path.join(folder,name);noLinks(file);const stat=fs.lstatSync(file);if(stat.isDirectory())pending.push(file);else if(!stat.isFile())throw Error('FIXTURE_CLEANUP_TYPE_INVALID');}}
 fs.rmSync(directory,{recursive:true});
}
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});
const owner='synthetic-cloud-'+runId,base='https://cznbnb.cn/io-api/v1/',token='X'.repeat(43);
const at=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString();
const contexts=['codex','hermes','qa'].map(key=>({key,task_id:'fixture-task-'+key,request_id:'fixture-request-'+key,route:{computer_id:'fixture-computer',agent_id:'fixture-'+key,project_id:'fixture-project',session_id:'fixture-'+key}}));
const scopeBase={schema:1,kind:'normal-voice-synthetic-routing',destination:base,run_id:runId,owner_id:owner};
const transcript='先预览。\n不要修改文件，保留全部资料。\n请在星期五继续，附加条件也要完整保留。';
const scopeFile=path.join(scopeDir,'scope.json'),credentialFile=path.join(run,'credential.json');
const credential={token,expires_at:expires};
const config={schema_version:'1.0',base_url:base,owner_id:owner,producer_id:'fixture-agent',server_id:'fixture-server',credential_file:credentialFile};
function object(kind,id,body){return {schema_version:'1.0',kind,object_id:id,revision:1,commit_seq:1,stored_at:at,event_id:'fixture-event-'+kind,body};}
function response(value){
 const bytes=Buffer.from(JSON.stringify(value));let offset=0;
 return new Response(new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}const end=Math.min(offset+7,bytes.length);controller.enqueue(new Uint8Array(bytes.subarray(offset,end)));offset=end;}}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8'}});
}
const original={argv:process.argv,fetch:globalThis.fetch,exit:process.exit,console:Object.fromEntries(['log','error','warn','info','debug','trace','dir'].map(k=>[k,console[k]]))};
let failure=null,cleaned=false;
async function scenario(name,{key='codex',text=transcript,scope={},mutate=()=>{},expected=null,expectedCalls=2,args=null,identityPatch={},objectPatch={}}={}){
 write(scopeFile,{...scopeBase,...scope});const c=contexts.find(c=>c.key===key);
 const answer=object('answer','fixture-answer-'+key,{answer_id:'fixture-answer-'+key,request_id:c.request_id,request_revision:1,task_id:c.task_id,route:{...c.route},input_source:'voice',text});
 mutate(answer.body);const request={...object('request',c.request_id,{request_id:c.request_id,task_id:c.task_id,revision:1,route:{...c.route}}),state:'answered',answer,...objectPatch};
 const calls=[],logs=[];for(const k of Object.keys(original.console))console[k]=(...values)=>logs.push(values);
 globalThis.fetch=async(url,options)=>{
  // No call to the saved fetch exists. Every unexpected endpoint fails closed.
  const target=new URL(url);calls.push(target.pathname);
  equal(options.method,'GET');equal(options.redirect,'manual');equal(options.headers.Authorization,'Bearer '+token);equal(target.origin,'https://cznbnb.cn');equal(target.search,'');yes(!('body' in options));
  if(target.href===base+'identity')return response({schema_version:'1.0',owner_id:owner,producer_id:config.producer_id,server_id:config.server_id,...identityPatch});
  if(target.href===base+'requests/'+c.request_id)return response(request);
  throw Error('FIXTURE_UNEXPECTED_ENDPOINT');
 };
 process.argv=[process.execPath,entry,'--verify','--apply','--scope-file',scopeFile,...(args??['--context',key,'--transcript-sha256',sha(text)])];
 let error=null;try{await import(pathToFileURL(entry).href+'?fixture='+runId+'-'+(++imports));}catch(e){error=e.message;}
 equal(error,expected);equal(calls.length,expectedCalls);equal(calls.slice(0,2),expectedCalls===2?['/io-api/v1/identity','/io-api/v1/requests/'+c.request_id]:expectedCalls===1?['/io-api/v1/identity']:[]);
 const result=path.join(run,'context-server-check-voice-'+key+'.json');
 if(expected===null){
  const report=JSON.parse(fs.readFileSync(result,'utf8'));equal(report.rows.length,1);equal(report.rows[0].key,key);equal(report.rows[0].complete_voice_transcript_sha256,sha(text));equal(report.rows[0].voice_input_source,true);equal(report.model_or_agent_launched,false);equal(report.normal_voice_requires_independent_device_evidence,true);equal(report.glasses_or_voice_verified,false);
  const stored=JSON.parse(fs.readFileSync(path.join(run,'context-server-objects-voice-'+key+'.json'),'utf8'));equal(stored[0].answer.body.text,text);equal(logs.length,1);
 }else{equal(logs.length,0);yes(!fs.existsSync(result));}
 // Remove only files emitted by this case inside this test's private directory.
 for(const suffix of ['context-server-check-voice-','context-server-objects-voice-']){const file=path.join(run,suffix+key+'.json');if(fs.existsSync(file)){noLinks(file);fs.unlinkSync(file);}}
 cases.push({name,passed:true,mock_gets:calls.length});
}
try{
 createOwned(run,runParent);createOwned(scopeDir,scopeParent);
 write(credentialFile,credential);write(path.join(run,'bundle.json'),{run_id:runId,agent:config,phone:{...config,producer_id:'cloud-phone'}});write(path.join(run,'context-check.json'),{schema:1,run_id:runId,created_at:at,expires_at:expires,contexts});
 process.exit=()=>{throw Error('FIXTURE_UNEXPECTED_EXIT');};
 for(const key of ['codex','hermes','qa'])await scenario('complete_multiline_'+key,{key});
 await scenario('friday_alternative',{text:transcript.replace('星期五','周五')});
 await scenario('wrong_input_source',{mutate:a=>a.input_source='text',expected:'COMPLETE_ORIGINAL_VOICE_NOT_VERIFIED'});
 for(const field of ['computer_id','agent_id','project_id','session_id'])await scenario('wrong_route_'+field,{mutate:a=>a.route[field]='fixture-wrong',expected:'ORIGINAL_ANSWER_NOT_VERIFIED'});
 await scenario('wrong_task',{mutate:a=>a.task_id='fixture-wrong',expected:'ORIGINAL_ANSWER_NOT_VERIFIED'});
 await scenario('wrong_request',{mutate:a=>a.request_id='fixture-wrong',expected:'ORIGINAL_ANSWER_NOT_VERIFIED'});
 await scenario('wrong_revision',{mutate:a=>a.request_revision=2,expected:'ORIGINAL_ANSWER_NOT_VERIFIED'});
 await scenario('wrong_full_text_hash',{args:['--context','codex','--transcript-sha256','0'.repeat(64)],expected:'COMPLETE_ORIGINAL_VOICE_NOT_VERIFIED'});
 for(const condition of ['预览','不要修改文件','保留全部资料','星期五'])await scenario('missing_condition_'+['预览','不要修改文件','保留全部资料','星期五'].indexOf(condition),{text:transcript.replace(condition,''),expected:'COMPLETE_ORIGINAL_VOICE_NOT_VERIFIED'});
 await scenario('missing_context',{args:['--transcript-sha256',sha(transcript)],expected:'EXACT_VOICE_CONTEXT_AND_TRANSCRIPT_REQUIRED',expectedCalls:0});
 await scenario('missing_hash',{args:['--context','codex'],expected:'EXACT_VOICE_CONTEXT_AND_TRANSCRIPT_REQUIRED',expectedCalls:0});
 await scenario('missing_both',{args:[],expected:'EXACT_VOICE_CONTEXT_AND_TRANSCRIPT_REQUIRED',expectedCalls:0});
 await scenario('nonisolated_owner',{scope:{owner_id:'fixture-real-user'},expected:'EXPLICIT_SYNTHETIC_TEST_REQUIRED',expectedCalls:0});
 await scenario('nonisolated_run',{scope:{run_id:'fixture-real-run',owner_id:'synthetic-cloud-fixture-real-run'},expected:'EXPLICIT_SYNTHETIC_TEST_REQUIRED',expectedCalls:0});
 await scenario('invalid_hash',{args:['--context','codex','--transcript-sha256','bad'],expected:'TRANSCRIPT_HASH_INVALID',expectedCalls:0});
 await scenario('identity_mismatch',{identityPatch:{owner_id:'fixture-wrong'},expected:'IDENTITY_MISMATCH',expectedCalls:1});
 await scenario('malformed_bridge_object',{objectPatch:{commit_seq:0},expected:'INVALID_RESPONSE'});
}catch(error){failure=error;}finally{
 process.argv=original.argv;process.exit=original.exit;globalThis.fetch=original.fetch;for(const [k,v]of Object.entries(original.console))console[k]=v;
 try{for(const directory of owned.reverse())removeOwned(directory);cleaned=true;}catch(error){failure??=error;}
}
const report={schema:1,at:new Date().toISOString(),passed:failure===null,checks,cases,source_sha256:sourceHashes,real_bridge_client:true,real_response_streams:true,global_fetch_mocked:true,real_network_requests:0,services_started:0,credentials_issued:0,fixture_token_is_dummy:true,device_operations:0,temporary_directories_cleaned:cleaned,globals_restored:process.argv===original.argv&&globalThis.fetch===original.fetch&&process.exit===original.exit};
if(failure)report.error='CONTEXT_VOICE_FIXTURE_FAILED';
write(resultFile,report);console.log(JSON.stringify({passed:report.passed,checks,cases:cases.length,temporary_directories_cleaned:cleaned,network_requests:0}));
if(failure)throw Error('CONTEXT_VOICE_FIXTURE_FAILED');
