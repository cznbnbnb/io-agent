import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const digest='a'.repeat(64),scan='lscan1:'+digest+':'+'b'.repeat(64)+':0';
const filter=changes=>({from:0,to:0,keyword:'运费',speaker:'',limit:10,scan_cursor:'',hit_cursor:'',...changes});
function fixture(){
 const {DebugCardControl,DebugCardState}=loadApp('DebugCardControl');let raw,sequence=0,foreground=true,failSave=false;const disk=new Map(),calls=[];
 const forbidden=()=>assert.fail('scan cannot open microphone, mutate sources/tasks, display a card or access network');
 const ports={command:()=>raw,result:id=>disk.get(id),save(id,json){if(failSave)throw Error('synthetic save');disk.set(id,json);},foreground:()=>foreground,status:()=>new DebugCardState(),
  show:forbidden,remove:forbidden,taskStatus:forbidden,voice:forbidden,reviewCard:forbidden,recoveryStatus:forbidden,restoreDraft:forbidden,todoPage:forbidden,
  localQuery:forbidden,localScan(value){calls.push(JSON.parse(JSON.stringify(value)));return{schema:1,scope:'local_canonical_window',hits:[]};}};
 const control=new DebugCardControl(ports);control.enable(true);
 const put=(value,extra={})=>{const now=Date.now(),request={schema:11,id:'dbg-'+(++sequence).toString(16).padStart(32,'0'),action:'scan-local',created_at:new Date(now).toISOString(),expires_at:new Date(now+60000).toISOString(),expected_uid:'',local_scan:value,...extra};raw=JSON.stringify(request);return request;};
 return{control,ports,disk,calls,put,result:r=>JSON.parse(disk.get(r.id)),foreground:value=>foreground=value,failSave:value=>failSave=value,reload:()=>{const c=new DebugCardControl(ports);c.enable(true);return c;}};
}
test('schema11 accepts only closed scan filters and preserves separate window and hit cursors',async()=>{
 const f=fixture();for(const value of[filter(),filter({scan_cursor:scan,hit_cursor:digest+':10',limit:2}),filter({scan_cursor:scan.replace(/:0$/,':9007199254740991'),keyword:'',speaker:'人A',from:1,to:2000})]){
  const command=f.put(value);await f.control.poll();const result=f.result(command);assert.equal(result.state,'complete');assert.equal(result.control_call_completed,true);assert.equal(result.local_scan.scope,'local_canonical_window');assert.equal(result.local_query,undefined);assert.equal(result.task_snapshot,undefined);assert.deepEqual(f.calls.at(-1),value);
 }
});
test('schema11 rejects old selectors, ambiguous cursors, unsafe limits/dates and invalid Unicode before claim',async()=>{
 const f=fixture();const invalid=[filter({cursor:''}),filter({scan_cursor:'A'.repeat(64)}),filter({scan_cursor:scan.replace(/:0$/,':01')}),filter({scan_cursor:scan.replace(/:0$/,':9007199254740992')}),
  filter({hit_cursor:digest+':1'}),filter({scan_cursor:scan,hit_cursor:digest+':01'}),filter({keyword:'\ud800'}),filter({speaker:'\u0080'}),filter({keyword:'',speaker:''}),filter({limit:true}),filter({limit:11}),filter({to:8640000000000001}),filter({from:1,to:1})];
 for(const value of invalid){const r=f.put(value);await f.control.poll();assert.equal(f.disk.has(r.id),false);}
 for(const extra of[{schema:5},{action:'search-local'},{expected_uid:'card'},{local_query:{}},{todo:{}},{annotation:{}},{arbitrary_wire:22}]){const r=f.put(filter(),extra);await f.control.poll();assert.equal(f.disk.has(r.id),false);}
 assert.deepEqual(f.calls,[]);
});
test('scan saved and running receipts do not rescan on repeated command or cold controller',async()=>{
 const f=fixture(),r=f.put(filter());await f.control.poll();const bytes=f.disk.get(r.id);await f.control.poll();await f.reload().poll();assert.equal(f.calls.length,1);assert.equal(f.disk.get(r.id),bytes);
 const running=f.put(filter({scan_cursor:scan}));f.disk.set(running.id,JSON.stringify({schema:1,id:running.id,request_json:JSON.stringify(running),state:'running'}));await f.reload().poll();assert.equal(f.calls.length,1);
});
test('scan claim failure, release/background and expiry do not execute the scanner',async()=>{
 const f=fixture();f.put(filter());f.failSave(true);await f.control.poll();f.failSave(false);f.control.enable(false);await f.control.poll();f.control.enable(true);f.foreground(false);await f.control.poll();assert.deepEqual(f.calls,[]);assert.equal(f.disk.size,0);
 f.foreground(true);const now=Date.now(),r=f.put(filter(),{created_at:new Date(now-120000).toISOString(),expires_at:new Date(now-60000).toISOString()});await f.control.poll();assert.equal(f.result(r).error,'DEBUG_COMMAND_EXPIRED');assert.deepEqual(f.calls,[]);
});
test('scan exposes only the three safe errors, with no raw filesystem or transcript text',async()=>{
 const f=fixture();for(const code of['LOCAL_QUERY_INVALID','LOCAL_QUERY_STALE','LOCAL_SCAN_UNAVAILABLE','D:/private/user/full-text']){f.ports.localScan=()=>{throw Error(code);};const r=f.put(filter());await f.control.poll();const result=f.result(r);assert.equal(result.error,code.startsWith('LOCAL_')?code:'DEBUG_OPERATION_FAILED');assert.equal(result.local_scan,undefined);assert.equal(JSON.stringify(result).includes('D:/private'),false);}
});
