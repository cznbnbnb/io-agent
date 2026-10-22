import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';import {loadCore} from './load-core.mjs';
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');
const peer='aabbccddeeff',other='112233445566',settle=()=>new Promise(r=>setImmediate(r));
test('native colon-separated uppercase Bluetooth address sends and routes completion using one canonical identity',async()=>{
 const s=setup();await s.store.load({});await s.store.addTodo('地址回归 7392');const id=s.store.todos[0].id;let sent=0;
 await s.store.sendTodo(id,'AA:BB:CC:DD:EE:FF',async()=>{sent++;});assert.equal(sent,1);assert.equal(s.store.todos[0].peer,peer);
 s.store.receiveTodo('aa:bb:cc:dd:ee:ff',event(4,{eventID:id,status:1}));await settle();assert(s.store.todos[0].completed);
 const reload=setup(s.value());await reload.store.load({});assert(reload.store.ready);assert(reload.store.todos[0].completed);
 for(const address of ['not-a-device','AA:BB:CC:DD:EE','AA::BB:CC:DD:EE:FF'])await assert.rejects(s.store.sendTodo(id,address,async()=>assert.fail()));
});
const event=(type,row)=>businessEnvelope(type,new TextEncoder().encode(JSON.stringify(row)));
function setup(raw=''){let value=raw,backup='',id=0,flushes=0;const prefs={get:async(k,d)=>k==='data'?value:(k==='data_v1_backup'?backup:d),put:async(k,v)=>{if(k==='data')value=v;else if(k==='data_v1_backup')backup=v;},flush:async()=>{flushes++;}};
 const {LocalWorkspace}=loadApp('LocalWorkspace',{'@kit.AbilityKit':{},'@kit.ArkData':{preferences:{getPreferences:async()=>prefs}},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(++id)})})}}});
 return {store:new LocalWorkspace(),prefs,value:()=>value,flushes:()=>flushes};}
test('empty store initializes; invalid stored data is preserved and blocks writes',async()=>{const s=setup('{bad');await s.store.load({});assert(!s.store.ready);await assert.rejects(s.store.addTodo('test'));assert.equal(s.value(),'{bad');assert.equal(s.flushes(),0);});
test('parallel edits serialize and survive reload',async()=>{const s=setup();await s.store.load({});await Promise.all([s.store.addTodo('一'),s.store.addTodo('二')]);assert.equal(s.store.todos.length,2);const r=setup(s.value());await r.store.load({});assert.equal(r.store.todos.length,2);});
test('only single-item type2 wire is sent after ownership flush; submission is not ACK',async()=>{const s=setup();await s.store.load({});await s.store.addTodo('合成待办');const id=s.store.todos[0].id;let sent;await s.store.sendTodo(id,peer,async(b,p)=>{assert.equal(b,22);assert.equal(JSON.parse(s.value()).todos[0].peer,peer);sent=readLauncherEnvelope(p);});assert.equal(sent.type,2);const body=JSON.parse(new TextDecoder().decode(sent.json));assert.equal(body.eventType,1);assert.equal(body.title,'合成待办');assert.equal(body.eventID,id);assert.equal(s.store.todos[0].delivery,'submitted');await assert.rejects(s.store.sendTodo(id,other,async()=>assert.fail()),/另一副/);});
test('unknown IDs, unsafe IDs, unrelated peers and unknown status never modify owned tasks',async()=>{const s=setup();await s.store.load({});await s.store.addTodo('一');const id=s.store.todos[0].id;await s.store.sendTodo(id,peer,async()=>{});for(const [p,row]of [[other,{eventID:id,status:1}],[peer,{eventID:id+1,status:1}],[peer,{eventID:9007199254740992,status:1}],[peer,{eventID:id,status:7}]])s.store.receiveTodo(p,event(4,row));await settle();assert(!s.store.todos[0].completed);});
test('physical completion persists with no echo and edit conflicts require user choice',async()=>{const s=setup();await s.store.load({});await s.store.addTodo('一');const id=s.store.todos[0].id;await s.store.sendTodo(id,peer,async()=>{});s.store.receiveTodo(peer,event(4,{eventID:id,status:1}));await settle();assert(s.store.todos[0].completed);assert.equal(s.store.todos[0].delivery,'confirmed');await s.store.editTodo(id,'本机修改',false);s.store.receiveTodo(peer,event(4,{eventID:id,status:1}));await settle();assert.equal(s.store.todos[0].delivery,'conflict');assert(!s.store.todos[0].completed);await assert.rejects(s.store.sendTodo(id,peer,async()=>assert.fail()),/冲突/);await s.store.resolveTodo(id,true);assert(s.store.todos[0].completed);});
test('failed send retains same persisted ID for explicit retry, without automatic replay',async()=>{const s=setup();await s.store.load({});await s.store.addTodo('一');const id=s.store.todos[0].id;await assert.rejects(s.store.sendTodo(id,peer,async()=>{throw Error('busy');}));assert.equal(s.store.todos[0].delivery,'pending');assert.equal(s.store.todos[0].id,id);});
test('edit during in-flight send must remain pending after old revision submits',async()=>{const s=setup();await s.store.load({});await s.store.addTodo('一');const id=s.store.todos[0].id;let unblock;const sent=s.store.sendTodo(id,peer,()=>new Promise(r=>unblock=r));await settle();await s.store.editTodo(id,'二',false);unblock();await sent;assert.equal(s.store.todos[0].delivery,'pending');assert.equal(s.store.todos[0].title,'二');});
test('conversation archive is idempotent and markdown contains time, text, model and answer',async()=>{const s=setup();await s.store.load({});await s.store.conversation('turn1','你好','回答','synthetic');await s.store.conversation('turn1','你好','回答','synthetic');assert.equal(s.store.entries.length,1);const md=s.store.markdown(s.store.entries[0]);for(const t of ['# 你好','## 我','回答 · synthetic'])assert(md.includes(t));await s.store.manuscript('测试稿','正文');assert.equal(s.store.entries[0].kind,'manuscript');assert(!s.value().includes('apiKey'));});
test('uncertain flush locks further writes instead of overwriting a possibly committed revision',async()=>{const s=setup();await s.store.load({});await s.store.addTodo('原件');s.prefs.flush=async()=>{throw Error('disk');};await assert.rejects(s.store.addTodo('未确认'));assert(!s.store.ready);assert.equal(s.store.todos.length,1);const uncertain=s.value();await assert.rejects(s.store.addTodo('不能覆盖'));await assert.rejects(s.store.load({}));assert.equal(s.value(),uncertain);});
test('appQueryGlasses full query wire shape and appQueryResponse imports glasses todos grouped by status',async()=>{
 const s=setup();await s.store.load({});
 let sent;await s.store.queryGlasses(peer,async(b,p)=>{assert.equal(b,22);sent=readLauncherEnvelope(p);});
 assert.equal(sent.type,15);const q=JSON.parse(new TextDecoder().decode(sent.json));
 assert.deepEqual(q,{queryType:0,eventType:1,lastSyncTime:0,eventIDList:[],needFullData:true});
 const resp={scheduleTotal:0,todoTotal:2,batchNo:1,isLastBatch:true,needFullData:true,chunkInfo:{chunkId:1,batchNo:1,isLastBatch:true,currentItems:2},dataList:[
  {eventType:1,eventID:101,status:0,createTime:1700000000,lastModifiedTime:1700000001,isImportant:1,title:'眼镜待办甲'},
  {eventType:1,eventID:102,status:1,createTime:1700000002,lastModifiedTime:1700000003,isImportant:0,title:'眼镜待办乙'},
  {eventType:0,eventID:103,status:0,createTime:1700000004,lastModifiedTime:1700000005,isImportant:0,title:'日程不入待办'}]};
 s.store.receiveTodo(peer,event(16,resp));await settle();
 assert.equal(s.store.todos.length,2);
 const a=s.store.todos.find(t=>t.id===101),c=s.store.todos.find(t=>t.id===102);
 assert.equal(a.title,'眼镜待办甲');assert(!a.completed);assert(a.important);assert.equal(a.delivery,'confirmed');assert.equal(a.peer,peer);
 assert(c.completed);assert(!c.important);
 // 再次回报更新已有条目状态（不改标题冲突），本机 pending 修改不被覆盖
 await s.store.addTodo('本机待办');const local=s.store.todos.find(t=>t.title==='本机待办');
 const resp2={dataList:[{eventType:1,eventID:101,status:1,createTime:1700000000,lastModifiedTime:1700000006,isImportant:0,title:'眼镜待办甲'}]};
 s.store.receiveTodo(peer,event(16,resp2));await settle();
 assert(s.store.todos.find(t=>t.id===101).completed);
 // 异 id 冲突（同 id 不同标题且非本 peer）不导入不覆盖
 const otherS=setup(s.value());await otherS.store.load({});const before=otherS.store.todos.length;
 otherS.store.receiveTodo(other,event(16,{dataList:[{eventType:1,eventID:101,status:1,createTime:1,lastModifiedTime:2,isImportant:0,title:'另一副眼镜的'}]}));await settle();
 assert.equal(otherS.store.todos.length,before);
});
