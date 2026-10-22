import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
test('fresh device asset-not-found gets editable defaults; lock/access failures never become empty credentials',async()=>{
 const s=setup(),vault=new s.SecureServiceConfig();s.assets.get=()=>{throw {code:24000002};};
 const fresh=await vault.load();assert.equal(fresh.modelKey,'');assert.equal(fresh.automaticVoice,true);
 s.assets.get=()=>{throw {code:24000011};};await assert.rejects(vault.load(),/不会用空配置覆盖/);
});
test('POI search uses explicit results with validated coordinates and safe errors',async()=>{
 const s=setup([{status:'1',pois:[{name:'测试站',address:'测试路1号',location:'116.4,39.9'},{name:'错误点',location:'999,900'}]},{status:'0',infocode:'10001'}]);
 const c=new s.ServiceConfig();c.amapKey='synthetic';const r=new s.RemoteServices(),places=await r.searchPlaces(c,'测试站','北京');
 assert.equal(places.length,1);assert.equal(places[0].location,'116.400000,39.900000');assert(s.requests[0].url.includes('/v3/place/text?'));
 await assert.rejects(r.searchPlaces(c,'测试站','北京'),/10001/);c.amapKey='';await assert.rejects(r.searchPlaces(c,'测试站','北京'),/Web/);assert.equal(s.requests.length,2);
});
function setup(replies=[]){const requests=[],assets=new Map();const asset={Tag:{ALIAS:1,SECRET:2,ACCESSIBILITY:3,CONFLICT_RESOLUTION:4,RETURN_TYPE:5},Accessibility:{DEVICE_UNLOCKED:2},ConflictResolution:{OVERWRITE:0},ReturnType:{ALL:0},add:async a=>{assets.set('entry',new Map([...a].map(([k,v])=>[k,v instanceof Uint8Array?v.slice():v])));},query:async()=>{const a=assets.get('entry');return a?[new Map([...a].map(([k,v])=>[k,v instanceof Uint8Array?v.slice():v]))]:[];},remove:async()=>assets.clear()};
 const http={RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:0},createHttp:()=>({destroy:()=>{},request:async(url,options)=>{requests.push({url,options});const response=replies.shift();if(response instanceof Error)throw response;return {responseCode:200,result:JSON.stringify(response)};}})};
 const mod=loadApp('RemoteServices',{'@kit.AssetStoreKit':{asset},'@kit.NetworkKit':{http}});
 // Existing cases exercise the Chat Completions/TinyFish adapters explicitly.
 class LegacyConfig extends mod.ServiceConfig{constructor(){super();this.deepseekSearchEnabled=false;}}
 return {...mod,ServiceConfig:LegacyConfig,DefaultServiceConfig:mod.ServiceConfig,requests,assets};}
test('configuration uses native asset store, can read and delete; source contains no real key',async()=>{
 const c=setup(),v=new c.SecureServiceConfig(),config=new c.ServiceConfig();config.modelKey='synthetic-test-only';await v.save(config);assert.equal(c.assets.get('entry').get(3),2);assert.equal((await v.load()).modelKey,'synthetic-test-only');await v.clear();assert.equal((await v.load()).modelKey,'');
 config.modelURL='http://example.invalid';await assert.rejects(v.save(config),/HTTPS/);
});
test('model requests keep credentials in headers, disable redirects and carry conversation history',async()=>{
 const s=setup([{choices:[{message:{content:'one'}}]},{choices:[{message:{content:'two'}}]}]),r=new s.RemoteServices(),c=new s.ServiceConfig();c.modelKey='synthetic-test-only';assert.equal(await r.chat(c,'hello'),'one');assert.equal(await r.chat(c,'again'),'two');
 const req=s.requests[1];assert.equal(req.options.maxRedirects,0);assert.equal(req.options.usingCache,false);assert(!req.url.includes(c.modelKey));assert.equal(JSON.parse(req.options.extraData).messages.length,4);
});
test('network errors are redacted rather than reflecting SDK URL containing key',async()=>{
 const s=setup([new Error('https://example.invalid?key=private-test')]),r=new s.RemoteServices(),c=new s.ServiceConfig();c.modelKey='test';await assert.rejects(r.chat(c,'hello'),e=>!e.message.includes('private-test')&&!e.message.includes('https://'));
});
test('QWeather follows existing v1 contract and refuses invalid host before request',async()=>{
 const s=setup([{temperature:{value:26.6,unit:'°C'},condition:{code:'101',text:'多云'},metadata:{attributions:['QWeather']}}]),r=new s.RemoteServices(),c=new s.ServiceConfig();c.weatherHost='test.re.qweatherapi.com';c.weatherKey='synthetic';const w=await r.weather(c);assert.equal(w.temp,27);assert.equal(w.icon,101);assert(s.requests[0].url.includes('/weather/v1/current/39.92/116.41'));c.weatherHost='attacker.invalid';await assert.rejects(r.weather(c));assert.equal(s.requests.length,1);
});
test('route lookup uses Web-service key and preserves actual returned steps',async()=>{
 const s=setup([{status:'1',geocodes:[{location:'116.40,39.90'}]},{status:'1',geocodes:[{location:'116.41,39.91'}]},{status:'1',route:{paths:[{distance:'1000',duration:'600',steps:[{instruction:'向北行走',road:'测试路',distance:'1000',polyline:'116.40,39.90;116.41,39.91'}]}]}}]),r=new s.RemoteServices(),c=new s.ServiceConfig();c.amapKey='synthetic';const p=await r.route(c,'start','end','北京',false);assert.equal(p.steps[0].instruction,'向北行走');assert(s.requests[2].url.includes('/v3/direction/walking'));
});
test('cycling parses v4 errcode/data response, not walking status/route',async()=>{
 const s=setup([{errcode:0,data:{paths:[{distance:100,duration:60,steps:[{instruction:'骑行向北',road:'',distance:100,polyline:'116.4,39.9;116.4,39.91'}]}]}}]),c=new s.ServiceConfig();c.amapKey='synthetic';const result=await new s.RemoteServices().routeCoordinates(c,'116.4,39.9','116.4,39.91','bicycling');assert.equal(result.distance,'100');assert(s.requests[0].url.includes('/v4/direction/bicycling'));
});
test('native GPS conversion explicitly requests gps and refuses failed conversion',async()=>{
 const s=setup([{status:'1',locations:'116.4,39.9'},{status:'0'}]),c=new s.ServiceConfig();c.amapKey='synthetic';const service=new s.RemoteServices();assert.equal(await service.gpsCoordinate(c,116.39,39.89),'116.400000,39.900000');assert(s.requests[0].url.includes('coordsys=gps'));await assert.rejects(service.gpsCoordinate(c,116.39,39.89));
});
test('invalid coordinate or mode is rejected before external request',async()=>{
 const s=setup(),c=new s.ServiceConfig();c.amapKey='synthetic';const service=new s.RemoteServices();await assert.rejects(service.routeCoordinates(c,'181,0','1,2','walking'));await assert.rejects(service.routeCoordinates(c,'1,2','1,3','flying'));assert.equal(s.requests.length,0);
});
const searchCall=(query,id='call_search')=>({id,type:'function',function:{name:'web_search',arguments:JSON.stringify({query})}});
test('TinyFish registers only when enabled, completes model -> search -> model with actual sources',async()=>{
 const s=setup([{choices:[{message:{content:null,tool_calls:[searchCall('公开测试')]}}]},{results:[{title:'官方文档',url:'https://docs.example.com/page',snippet:'资料'},{title:'invalid',url:'javascript:bad',snippet:'no'}]},{choices:[{message:{content:'据来源 https://docs.example.com/page 回答'}}]}]);
 const c=new s.ServiceConfig();c.modelKey='synthetic-model';c.tinyfishKey='synthetic-search';c.tinyfishEnabled=true;const r=new s.RemoteServices(),statuses=[];r.onToolStatus=x=>statuses.push(x);
 assert.match(await r.chat(c,'搜索公开测试'),/据来源/);assert.equal(s.requests.length,3);
 const first=JSON.parse(s.requests[0].options.extraData);assert.equal(first.tools[0].function.name,'web_search');assert.equal(first.tool_choice,'auto');
 assert(s.requests[1].url.startsWith('https://api.search.tinyfish.ai?query='));assert.equal(s.requests[1].options.header['X-API-Key'],c.tinyfishKey);assert(!s.requests[1].url.includes(c.tinyfishKey));
 const last=JSON.parse(s.requests[2].options.extraData).messages.at(-1);assert.equal(last.role,'tool');assert.equal(last.tool_call_id,'call_search');assert.equal(JSON.parse(last.content).results.length,1);assert.equal(JSON.parse(last.content).untrusted_external_data,true);assert.equal(statuses.length,2);
});
test('TinyFish rejects disabled, unknown, duplicate and credential-bearing calls before search',async()=>{
 for(const variant of ['disabled','unknown','duplicate','secret','extra']){
  const call=searchCall(variant==='secret'?'请查询 synthetic-model':'公开测试');if(variant==='unknown')call.function.name='delete_file';if(variant==='extra')call.function.arguments='{"query":"公开测试","private":"anything"}';
  const s=setup([{choices:[{message:{tool_calls:variant==='duplicate'?[call,call]:[call]}}]}]),c=new s.ServiceConfig();c.modelKey='synthetic-model';c.tinyfishKey='synthetic-search';c.tinyfishEnabled=variant!=='disabled';
  await assert.rejects(new s.RemoteServices().chat(c,'搜索'));assert.equal(s.requests.length,1,variant);
 }
});
test('TinyFish stops at two searches and rejects model ignoring tool_choice none',async()=>{
 const s=setup([{choices:[{message:{tool_calls:[searchCall('第一次','a'),searchCall('第二次','b')]}}]},{results:[]},{results:[]},{choices:[{message:{tool_calls:[searchCall('第三次','c')]}}]}]);
 const c=new s.ServiceConfig();c.modelKey='synthetic-model';c.tinyfishKey='synthetic-search';c.tinyfishEnabled=true;
 await assert.rejects(new s.RemoteServices().chat(c,'搜索'),/次数/);assert.equal(s.requests.length,4);assert.equal(JSON.parse(s.requests[3].options.extraData).tool_choice,'none');
});
test('TinyFish failure is a tool error, not invented results, and cancellation stops followup request',async()=>{
 const s=setup([{choices:[{message:{tool_calls:[searchCall('公开测试')]}}]},new Error('secret platform details'),{choices:[{message:{content:'搜索失败'}}]}]),c=new s.ServiceConfig();c.modelKey='synthetic-model';c.tinyfishKey='synthetic-search';c.tinyfishEnabled=true;
 assert.equal(await new s.RemoteServices().chat(c,'搜索'),'搜索失败');const msg=JSON.parse(s.requests[2].options.extraData).messages.at(-1);assert(!msg.content.includes('secret platform'));assert.equal(JSON.parse(msg.content).results.length,0);
 const t=setup([{choices:[{message:{tool_calls:[searchCall('公开测试')]}}]},{results:[]}]);const r=new t.RemoteServices();r.onToolStatus=()=>r.cancel();await assert.rejects(r.chat(c,'搜索'));assert(t.requests.length<=2);
});

test('DeepSeek Flash answers and searches in one native Messages request with the same key',async()=>{
 const s=setup([{content:[{type:'server_tool_use',name:'web_search'},{type:'web_search_tool_result',content:[{type:'web_search_result',url:'https://example.com/current',title:'实际来源'}]},{type:'text',text:'已查到最新资料',citations:[{url:'https://example.com/current',title:'重复来源'}]}],stop_reason:'end_turn'}]);
 const c=new s.DefaultServiceConfig();c.modelKey='synthetic-official';const r=new s.RemoteServices(),states=[];r.onToolStatus=x=>states.push(x);
 const answer=await r.chat(c,'搜索最新公开资料');assert.match(answer,/实际来源/);assert.match(answer,/https:\/\/example.com\/current/);assert.equal(s.requests.length,1);
 const req=s.requests[0],body=JSON.parse(req.options.extraData);assert.equal(req.url,'https://api.deepseek.com/anthropic/v1/messages');assert.equal(req.options.header['x-api-key'],c.modelKey);assert(!req.url.includes(c.modelKey));assert.equal(body.model,'deepseek-flash');assert.equal(body.tools[0].type,'web_search_20250305');assert.equal(body.tools[0].max_uses,2);assert.match(states.at(-1),/1 条来源/);
});
test('native DeepSeek non-search turns retain conversation history and require no second credential',async()=>{
 const s=setup([{content:[{type:'text',text:'你好'}]},{content:[{type:'text',text:'第二轮'}]}]),c=new s.DefaultServiceConfig();c.modelKey='synthetic';const r=new s.RemoteServices();
 assert.equal(await r.chat(c,'你好'),'你好');assert.equal(await r.chat(c,'继续'),'第二轮');assert.equal(JSON.parse(s.requests[1].options.extraData).messages.length,3);
});
test('native search rejects missing/error result blocks and incomplete answers, without inventing success',async()=>{
 for(const response of [{content:[{type:'server_tool_use',name:'web_search'},{type:'text',text:'猜测'}]},
  {content:[{type:'web_search_tool_result',content:{type:'web_search_tool_result_error',error_code:'unavailable'}}]},
  {content:[{type:'text',text:'尚未完成'}],stop_reason:'pause_turn'}]){
  const s=setup([response]),c=new s.DefaultServiceConfig();c.modelKey='synthetic';await assert.rejects(new s.RemoteServices().chat(c,'搜索'));
 }
});
test('native search is restricted to official DeepSeek origin; custom backends keep their key on their endpoint',async()=>{
 const s=setup([{choices:[{message:{content:'自有后端'}}]}]),c=new s.DefaultServiceConfig();c.modelURL='https://example.com/v1';c.modelKey='synthetic-custom';
 assert.equal(await new s.RemoteServices().chat(c,'你好'),'自有后端');assert.equal(s.requests[0].url,'https://example.com/v1/chat/completions');assert.equal(s.requests.length,1);
});
test('native search cancellation stops before dispatch and source links discard unsafe schemes',async()=>{
 const s=setup([]),c=new s.DefaultServiceConfig();c.modelKey='synthetic';const r=new s.RemoteServices();r.onToolStatus=()=>r.cancel();await assert.rejects(r.chat(c,'搜索'));assert.equal(s.requests.length,0);
 const t=setup([{content:[{type:'text',text:'回答',citations:[{url:'javascript:evil',title:'bad'},{url:'https://user:pass@example.com',title:'bad'}]}]}]);assert.equal(await new t.RemoteServices().chat(c,'你好'),'回答');
});
