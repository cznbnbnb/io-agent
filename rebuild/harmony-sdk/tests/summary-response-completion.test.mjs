import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

// Real RemoteServices.summarize/request code; HTTP is a bounded synthetic port.
// No model/network/device request is made by these fixtures.
const good=(content='**事实回顾**\n原文事实。\n\n**待办候选**\n无。')=>({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content}}]});
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
function setup(value=good()){
 let result=value,gate,afterRead,once=false,destroyed=0;const requests=[];
 const http={RequestMethod:{POST:'POST'},HttpDataType:{STRING:0},createHttp:()=>({destroy(){destroyed++;},async request(url,options){
   requests.push({url,options});if(gate)await gate.promise;return{responseCode:200,get result(){if(afterRead&&!once){once=true;queueMicrotask(afterRead);}return typeof result==='string'?result:JSON.stringify(result);}};
 }})};
 const mod=loadApp('RemoteServices',{'@kit.AssetStoreKit':{asset:{}},'@kit.NetworkKit':{http}}),config=new mod.ServiceConfig();
 config.modelKey='synthetic-summary-secret';config.deepseekSearchEnabled=true;config.tinyfishEnabled=true;config.tinyfishKey='synthetic-no-search';
 const service=new mod.RemoteServices();return{...mod,config,service,requests,set:value=>result=value,defer:()=>gate=deferred(),afterRead:fn=>afterRead=fn,get destroyed(){return destroyed;},run:(text='[08:01:00] 合成日记原文')=>service.summarize(config,'合成当天记录',text)};
}

test('HTTP 200 nonempty but unfinished summaries never become a successful final summary',async t=>{
 for(const reason of['length','content_filter','tool_calls','insufficient_system_resource','aborted','unknown','','STOP',null,undefined]){
  await t.test(String(reason),async()=>{const value=good('开头事实。尚未写出的结尾是不要发送。');value.choices[0].finish_reason=reason;
   const f=setup(value);await assert.rejects(()=>f.run());assert.equal(f.requests.length,1);});
 }
});
test('only one complete assistant text choice is accepted, without tool or provider-error results',async t=>{
 const cases=[['null response',null],['empty response',{}],['no choices',{choices:[]}],['choices is not an array',{choices:{0:good().choices[0],length:1}}],
  ['multiple choices',{choices:[good().choices[0],good().choices[0]]}],['null choice',{choices:[null]}],['missing message',{choices:[{finish_reason:'stop'}]}],
  ['non-assistant',{choices:[{finish_reason:'stop',message:{role:'tool',content:'tool result'}}]}],['missing content',good(undefined)],['empty content',good('')],['whitespace content',good(' \n\t ')],
  ['null content',good(null)],['array content',good(['not plain text'])],['nonempty tools',good()],['invalid tools',good()],['legacy function call',good()],['error plus choices',good()]];
 cases.find(row=>row[0]==='missing content')[1].choices[0].message.content=undefined;
 cases.find(row=>row[0]==='nonempty tools')[1].choices[0].message.tool_calls=[{id:'synthetic-call',type:'function',function:{name:'do_not_execute',arguments:'{}'}}];
 cases.find(row=>row[0]==='invalid tools')[1].choices[0].message.tool_calls={};
 cases.find(row=>row[0]==='legacy function call')[1].choices[0].message.function_call={name:'do_not_execute',arguments:'{}'};
 cases.find(row=>row[0]==='error plus choices')[1].error={message:'private-provider-error synthetic-summary-secret'};
 for(const[name,value]of cases)await t.test(name,async()=>{const f=setup(value);await assert.rejects(()=>f.run(),error=>{assert.doesNotMatch(error.message,/private-provider|synthetic-summary-secret/);return true;});assert.equal(f.requests.length,1);});
});
test('normal stop preserves complete Markdown and supports harmless provider metadata plus an empty tools array',async()=>{
 const text='## 事实回顾\n- 中文和 emoji🙂。\n\n## 待办候选\n- 未确认，不代表本人承诺。\n\n## 待确认问题与建议\n- 完整末句：不要发送。';
 const value=good(' \n'+text+'\n ');Object.assign(value,{id:'synthetic-id',model:'synthetic-provider-version',usage:{prompt_tokens:123,completion_tokens:99},system_fingerprint:'synthetic'});
 Object.assign(value.choices[0],{logprobs:null});Object.assign(value.choices[0].message,{tool_calls:[],reasoning_content:'not part of the final summary'});
 const f=setup(value);assert.equal(await f.run(),text);assert.equal(f.requests.length,1);
 value.choices[0].message.tool_calls=null;value.choices[0].message.function_call=null;f.set(value);
 assert.equal(await f.run(),text,'nullable no-tool fields do not invent a tool action');assert.equal(f.requests.length,2);
});
test('malformed JSON is rejected without echoing private response bytes',async()=>{
 const f=setup('{"choices": SECRET_PRIVATE_SUMMARY_TEXT');await assert.rejects(()=>f.run(),error=>{assert.doesNotMatch(error.message,/SECRET_PRIVATE_SUMMARY_TEXT|choices|Unexpected|JSON/);return true;});
});
test('cancel after request validated the response but before summarize continues cannot return success',async()=>{
 const f=setup();let cancelled=false;f.afterRead(()=>{cancelled=true;f.service.cancel();});await assert.rejects(()=>f.run());assert.equal(cancelled,true);assert.equal(f.requests.length,1);
 f.set(good('新的明确请求可以成功'));assert.equal(await f.run(),'新的明确请求可以成功');assert.equal(f.requests.length,2);
});
test('cancel while HTTP is pending rejects the old generation without issuing another request',async()=>{
 const f=setup(),gate=f.defer(),pending=f.run();f.service.cancel();gate.resolve();await assert.rejects(pending);assert.equal(f.requests.length,1);assert(f.destroyed>=1);
});
test('summary retains HTTPS/authentication/no-search and existing 30000-unit input/output budget',async()=>{
 const f=setup();await f.run('合'.repeat(30000));const {url,options}=f.requests[0],body=JSON.parse(options.extraData);
 assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.header.Authorization,'Bearer '+f.config.modelKey);assert(!url.includes(f.config.modelKey));
 assert.equal(options.maxRedirects,0);assert.equal(options.usingCache,false);assert.equal(options.readTimeout,120000);assert.equal(body.max_tokens,1500);assert.equal(body.stream,false);assert.equal(body.messages.length,2);
 assert.equal(body.tools,undefined);assert.equal(body.tool_choice,undefined);assert.equal(body.n,undefined);assert.deepEqual(body.thinking,{type:'disabled'});
 await assert.rejects(()=>f.run('合'.repeat(30001)),/过长/);await assert.rejects(()=>f.run(' \n\t'),/没有/);assert.equal(f.requests.length,1);
 f.config.modelURL='http://example.invalid';await assert.rejects(()=>f.run(),/地址无效/);assert.equal(f.requests.length,1);
});
test('ordinary chat keeps its existing response contract without summary completion enforcement',async()=>{
 const f=setup({choices:[{message:{content:'旧chat结果'}}]});f.config.deepseekSearchEnabled=false;f.config.tinyfishEnabled=false;
 assert.equal(await f.service.chat(f.config,'合成问题'),'旧chat结果');assert.equal(f.requests.length,1);
});
