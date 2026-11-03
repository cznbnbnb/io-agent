import test from 'node:test';import assert from 'node:assert/strict';
import {listen} from '../http.mjs';import {adminFixture} from './admin-fixture.mjs';
const origin='https://cznbnb.cn';
async function setup(t,options={}){
 const f=await adminFixture(options),server=await listen(f.store,0,{traffic:f.traffic,idleInboxWaitMs:options.wait??0}),base=`http://127.0.0.1:${server.address().port}`;
 const cookie='__Secure-io_admin='+f.login.token;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));f.close();});
 const call=async(route,input,extra={})=>{const r=await fetch(base+'/v1/admin/'+route,{method:input===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,...(input===undefined?{}:{'Content-Type':'application/json'}),...extra},body:input===undefined?undefined:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
 return {...f,base,call,session:f.store.admin.session(f.login.token)};
}
test('all admin sections enforce login/owner and lists are bounded; daily excludes non-summary history',async t=>{
 const f=await setup(t,{taskCount:55});
 for(const section of ['overview','devices','sessions','tasks','daily','traffic','audit']){
  const r=await f.call(section);assert.equal(r.status,200,JSON.stringify(r));assert.equal(JSON.stringify(r.body).includes('FOREIGN PRIVATE'),false);assert.equal(JSON.stringify(r.body).includes(f.agent.token),false);
  assert.equal((await f.call(section,undefined,{Cookie:''})).status,401);
 }
 const first=(await f.call('tasks')).body,second=(await f.call('tasks?offset=50')).body;assert.equal(first.items.length,50);assert.equal(second.items.length,5);assert.equal(first.total,55);
 assert.equal((await f.call('tasks?q=会议')).body.items.every(r=>r.title.includes('会议')),true);
 assert.equal((await f.call('daily')).body.items.length,3);assert.equal((await f.call('daily-detail?id=legacy-transcript')).status,404);
 assert.match((await f.call('daily-detail?id=daily-2026-10-29')).body.text,/今日概况/);
 assert.equal((await f.call('task?id=qa-task-0')).body.children[0].body.question,'下一步优先处理哪一项？');
 f.addTask('qa-unrelated','另一个任务');const unrelated={...JSON.parse(f.store.queueRevision(f.owner,'request','qa-question',1).body),request_id:'qa-task-0',task_id:'qa-unrelated'};f.submit('request',unrelated,f.agent);
 assert.equal((await f.call('task?id=qa-task-0')).body.receipts.some(r=>r.subject_kind==='request'&&r.subject_id==='qa-task-0'),false);
 for(const route of ['tasks?offset=-1','devices?owner=foreign','traffic?hours=999','daily?from=2026-02-30','sessions?status=made-up'])assert.equal((await f.call(route)).status,400);
});
test('rename and pause stay scoped; resuming preserves unread cursor and existing phone/agent authentication',async t=>{
 const f=await setup(t),cursor=f.store.inbox(f.agent.token).next_cursor;
 assert.equal((await f.call('action',{action:'rename',device_id:f.foreign.device_id,label:'steal'})).status,404);
 assert.equal((await f.call('action',{action:'rename',device_id:f.agent.device_id,label:'开发电脑'})).status,200);
 assert.equal(f.store.devices.listOwner(f.owner).find(d=>d.device_id===f.agent.device_id).label,'开发电脑');
 assert.equal((await f.call('action',{action:'delivery',device_id:f.agent.device_id,paused:true})).status,200);
 f.addTask('qa-later','暂停期间到达');const paused=f.store.inbox(f.agent.token,{cursor});assert.deepEqual(paused.items,[]);assert.equal(paused.delivery_paused,true);
 assert.equal(f.store.identity(f.agent.token).owner_id,f.owner);
 await f.call('action',{action:'delivery',device_id:f.agent.device_id,paused:false});
 assert(f.store.inbox(f.agent.token,{cursor:paused.next_cursor}).items.some(t=>t.object_id==='qa-later'));
 assert.equal((await f.call('audit')).body.items.length,3);
});
test('default selection preserves compare-and-set, capability and paused-device gates',async t=>{
 const f=await setup(t),directory=(await f.call('sessions')).body;
 const target=directory.items.find(s=>!s.is_default),input={action:'default',key:target.key,expected_revision:directory.default.revision};
 assert.equal((await f.call('action',input)).status,200);assert.equal((await f.call('action',input)).status,409);
 assert.deepEqual(f.store.agentSessions.list(f.agent.token).default.route,target.route);
 await f.call('action',{action:'delivery',device_id:f.agent.device_id,paused:true});
 assert.equal((await f.call('action',{...input,expected_revision:2})).body.error.code,'DEVICE_DELIVERY_PAUSED');
 f.advance(61000);assert.equal((await f.call('sessions?status=offline')).body.items.length,2);
 assert.equal((await f.call('action',{...input,expected_revision:2})).body.error.code,'DEFAULT_SESSION_UNAVAILABLE');
});
test('primary-phone handover never overlaps leases; revoked phone cannot be selected',async t=>{
 const f=await setup(t),before=f.store.phones.update(f.phone.token,{account_binding:'a'.repeat(64)}),input={action:'primary',device_id:f.second.device_id,expected_revision:before.revision};
 assert.equal((await f.call('action',input)).status,200);assert.equal((await f.call('action',input)).status,409);
 assert.equal(f.store.phones.permits(f.store.auth(f.phone.token)),false);assert.equal(f.store.phones.permits(f.store.auth(f.second.token)),false);
 f.advance(20001);assert.equal(f.store.phones.permits(f.store.auth(f.second.token)),true);
 assert.equal((await f.call('action',{action:'unpair',device_id:f.second.device_id})).status,200);assert.throws(()=>f.store.auth(f.second.token));assert.equal(f.store.auth(f.agent.token).owner,f.owner);
 assert.equal((await f.call('action',{action:'primary',device_id:f.second.device_id,expected_revision:2})).status,409);
});
test('bulk record management is atomic, reversible and never mutates execution or immutable events',async t=>{
 const f=await setup(t),before=f.store.queueCeiling(f.owner);
 const mark=(ids,field,value)=>f.call('action',{action:'mark',ids,field,value});
 assert.equal((await mark(['qa-task-0'],'trashed',true)).status,409);
 assert.equal((await mark(['qa-task-1','missing'],'favorite',true)).status,404);assert.equal((await f.call('tasks?group=favorite')).body.total,0);
 assert.equal((await mark(['qa-task-1','qa-task-2'],'favorite',true)).status,200);assert.equal((await f.call('tasks?group=favorite')).body.total,2);
 assert.equal((await mark(['qa-task-1'],'trashed',true)).status,200);assert.equal((await f.call('tasks?group=trash')).body.total,1);
 assert.equal((await mark(['qa-task-1'],'trashed',false)).status,200);assert.equal((await f.call('tasks?group=trash')).body.total,0);
 assert.equal(f.store.queueHead(f.owner,'task','qa-task-1').state,'completed');assert.equal(f.store.queueCeiling(f.owner),before);
});
test('admin writes require same origin and completed password change, without issuing API tokens',async t=>{
 const f=await setup(t),input={action:'delivery',device_id:f.agent.device_id,paused:true},n=f.store.db.prepare('SELECT count(*) n FROM credentials').get().n;
 assert.equal((await f.call('action',input,{Origin:'https://evil.invalid'})).status,403);
 assert.equal((await f.call('action',{...input,owner:'foreign'})).status,400);
 await f.store.admin.enroll({username:'first.admin',owner:f.owner,password:'temporary-initial-password'});const login=await f.store.admin.login({username:'first.admin',password:'temporary-initial-password'});
 assert.equal((await f.call('action',input,{Cookie:'__Secure-io_admin='+login.token})).status,403);
 assert.equal(f.store.console.deliveryPaused(f.owner,f.agent.producer_id),false);assert.equal(f.store.db.prepare('SELECT count(*) n FROM credentials').get().n,n);
});
test('traffic filters retain real totals/rate and exclude admin page refreshes',async t=>{
 const f=await setup(t),before=f.traffic.snapshot(f.owner).totals.requests;
 const report=(await f.call('traffic?status=error')).body;assert.equal(report.totals.errors,1);assert.equal(report.totals.requests,1);
 assert.equal((await f.call('traffic?producer='+f.foreign.producer_id)).body.totals.requests,0);
 const overview=(await f.call('overview')).body;assert.equal(overview.traffic.totals.requests,180);assert(overview.traffic.per_second>=0);assert.equal(f.traffic.snapshot(f.owner).totals.requests,before);
});
test('empty inbox wait picks up a new task and rechecks revoked credentials before delivery',async t=>{
 const f=await setup(t,{wait:120}),cursor=f.store.inbox(f.agent.token).next_cursor;
 const url=f.base+'/v1/inbox?cursor='+encodeURIComponent(cursor),headers={Authorization:'Bearer '+f.agent.token};
 const reading=fetch(url,{headers});await new Promise(r=>setTimeout(r,35));f.addTask('qa-delayed','等待期间新增任务');const reply=await reading;assert.equal(reply.status,200);const page=await reply.json();assert(page.items.some(i=>i.object_id==='qa-delayed'));
 const waiting=fetch(f.base+'/v1/inbox?cursor='+encodeURIComponent(page.next_cursor),{headers});await new Promise(r=>setTimeout(r,35));f.store.devices.revoke(f.agent.device_id);assert.equal((await waiting).status,401);
});
test('lifelog detail and history show effective text, while audited undo restores only the chosen change',async t=>{
 const f=await setup(t),source={id:'text-'+'a'.repeat(64),date:'2026-11-02',timezone:'Asia/Shanghai',kind:'transcript',started_at:'2026-11-02T01:00:00Z',ended_at:'2026-11-02T02:00:00Z',blocks:[{id:'clip',kind:'utterance',text:'CK023 样机'}],related_ids:[]};
 const writer=f.store.mint({owner:f.owner,producer:'qa-text',scopes:['materials:write']});f.store.lifelog.upload(writer.token,{base_revision:0,source});
 f.store.lifelog.correction(f.agent.token,{request_id:'admin-test-edit',material_id:source.id,expected_source_revision:1,expected_revision:0,agent:'Codex',reason:'核对型号',evidence:['BOM'],edits:[{block_id:'clip',text:'S-CK023 样机'}]});
 const list=(await f.call('daily?kind=transcript')).body;assert.equal(list.items[0].text,'S-CK023 样机');assert.equal(list.items[0].blocks,undefined);
 const detail=(await f.call('daily-detail?id='+source.id)).body;assert.equal(detail.correction_revision,1);
 const history=(await f.call('history?id='+source.id)).body;assert.equal(history.original.blocks[0].text,'CK023 样机');
 const undo={action:'lifelog-revert',correction:{request_id:'admin-test-undo',material_id:source.id,expected_source_revision:1,expected_revision:1,agent:'label',reason:'手动撤销',evidence:['人工核对'],revert_revision:1}};
 assert.equal((await f.call('action',undo)).status,200);assert.equal((await f.call('daily-detail?id='+source.id)).body.text,'CK023 样机');assert.equal((await f.call('audit')).body.items[0].action,'lifelog-revert');
 assert.equal((await f.call('action',{...undo,correction:{...undo.correction,request_id:'stale'}})).status,409);
});
