import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const id=n=>'chn-'+String(n).padStart(32,'0');
function setup(){
 const {ChannelProbeControl,ChannelProbeSnapshot}=loadApp('ChannelProbeControl');const records=new Map(),calls=[];
 let request,failSave=false,failStart=false;const s=new ChannelProbeSnapshot();s.connected=true;s.foreground=true;s.connection=2;
 const control=new ChannelProbeControl({command:()=>JSON.stringify(request),result:k=>records.get(k),save:(k,v)=>{if(failSave)throw Error('disk full');records.set(k,v);},
  status:()=>({...s}),start:async(text,hold,operation,profile)=>{assert.equal(JSON.parse(records.get(operation)).state,'running');calls.push(['start',text,hold,operation,profile]);s.active=true;s.operation_id=operation;s.can_cleanup=true;s.binding='a'.repeat(64);if(failStart)throw Error('ambiguous transport');},
  update:async(text,profile)=>{calls.push(['update',text,profile]);if(failStart)throw Error('ambiguous update');},
  stop:async()=>{calls.push(['stop']);s.closing=true;},
  noticeTiming:async(seconds)=>{calls.push(['notice',seconds]);s.notice_target_seconds=seconds;s.notice_submission='submitted';if(failStart)throw Error('ambiguous timing');}});
 return {s,records,calls,control,set:v=>{request=v;},failSave:v=>failSave=v,failStart:v=>failStart=v,
  run:async(action,extra={},n=records.size+1)=>{request={schema:1,id:id(n),action,expires_at:Date.now()+30000,...extra};await control.poll();return records.has(request.id)?JSON.parse(records.get(request.id)):undefined;}};
}
test('bounded start stores its intent first and never equates send completion with readiness or lens proof',async()=>{
 const s=setup(),r=await s.run('display-start',{text:'中文显示测试',hold_ms:15000});assert.equal(r.state,'complete');assert.equal(r.snapshot.ready,false);assert.equal(r.lens_verified,false);assert.equal(s.calls.length,1);
 await s.control.poll();assert.equal(s.calls.length,1);
});
test('an interrupted start receipt becomes uncertain without replaying hardware writes',async()=>{
 const s=setup(),r=await s.run('display-start',{text:'测试',hold_ms:15000});s.records.set(r.id,JSON.stringify({...r,state:'running'}));await s.control.poll();assert.equal(s.calls.length,1);assert.equal(JSON.parse(s.records.get(r.id)).error,'CHANNEL_INTERRUPTED_NO_REPLAY');
});
test('expired, malformed and out-of-budget commands cannot start a channel',async()=>{
 const s=setup();assert.equal((await s.run('display-start',{text:'测试',hold_ms:15000,expires_at:Date.now()-1})).error,'CHANNEL_EXPIRED');
 for(const extra of [{text:'x',hold_ms:125001},{text:'x',hold_ms:4999},{text:'x'.repeat(97),hold_ms:15000},{text:'x\n',hold_ms:15000}])assert.equal(await s.run('display-start',extra),undefined);
 assert.equal(s.calls.length,0);
});
test('background, occupied, offline and corrupt cleanup states reject starts without any side effect',async()=>{
 for(const change of [s=>s.foreground=false,s=>s.connected=false,s=>s.active=true,s=>s.blocked=true]){const s=setup();change(s.s);const r=await s.run('display-start',{text:'测试',hold_ms:15000});assert.equal(r.state,'error');assert.equal(s.calls.length,0);}
});
test('an independent stop cannot affect a replacement operation or wrong connected peer',async()=>{
 const s=setup();s.s.active=true;s.s.can_cleanup=true;s.s.operation_id=id(20);s.s.binding='a'.repeat(64);
 assert.equal((await s.run('display-stop',{source_id:id(19)})).error,'CHANNEL_SESSION_CHANGED');assert.equal(s.calls.length,0);
 s.s.can_cleanup=false;assert.equal((await s.run('display-stop',{source_id:id(20)})).error,'CHANNEL_SESSION_CHANGED');assert.equal(s.calls.length,0);
 s.s.can_cleanup=true;const r=await s.run('display-stop',{source_id:id(20)});assert.equal(r.state,'complete');assert(r.snapshot.active);assert.equal(r.snapshot.exit_evidence,'none');assert.equal(s.calls.length,1);
});
test('manual stop requires an exact fresh binding; an idle stop sends nothing',async()=>{
 const s=setup();s.s.active=true;s.s.can_cleanup=true;s.s.binding='a'.repeat(64);
 assert.equal((await s.run('display-stop',{binding:'b'.repeat(64)})).error,'CHANNEL_SESSION_CHANGED');assert.equal(s.calls.length,0);
 await s.run('display-stop',{binding:'a'.repeat(64)});assert.equal(s.calls.length,1);s.s.active=false;await s.run('display-stop',{source_id:id(9)});assert.equal(s.calls.length,1);
});
test('failed durable intent prevents a start and an ambiguous transport is never retried',async()=>{
 const s=setup();s.failSave(true);await s.run('display-start',{text:'测试',hold_ms:15000});assert.equal(s.calls.length,0);
 s.failSave(false);s.failStart(true);const r=await s.run('display-start',{text:'测试',hold_ms:15000});assert.equal(r.state,'uncertain');assert(r.snapshot.active);await s.control.poll();assert.equal(s.calls.length,1);
});
test('a duplicate ID with different command bytes cannot overwrite the original receipt',async()=>{
 const s=setup(),r=await s.run('status');s.set({schema:1,id:r.id,action:'display-start',expires_at:Date.now()+30000,text:'bad replay',hold_ms:15000});await s.control.poll();assert.equal(s.calls.length,0);assert.equal(s.records.get(r.id),JSON.stringify(r));
});

test('a profile update requires the live original operation, foreground and ready state',async()=>{
 const s=setup();await s.run('display-start',{text:'old',hold_ms:120000});s.s.ready=true;
 for(const change of [v=>v.operation_id=id(90),v=>v.foreground=false,v=>v.ready=false,v=>v.closing=true,v=>v.can_cleanup=false]){
  const before={...s.s};change(s.s);const r=await s.run('display-update',{text:'new',profile:'source-final',source_id:id(1)});assert.equal(r.error,'CHANNEL_SESSION_CHANGED');Object.assign(s.s,before);
 }
 const r=await s.run('display-update',{text:'中文完整句',profile:'source-final',source_id:id(1)});assert.equal(r.state,'complete');assert.equal(s.calls.filter(c=>c[0]==='update').length,1);
 await s.control.poll();assert.equal(s.calls.filter(c=>c[0]==='update').length,1);
});

test('profile commands stay bounded and an uncertain update is not replayed',async()=>{
 const s=setup();await s.run('display-start',{text:'old',hold_ms:15000,profile:'classic-final'});assert.equal(s.calls[0][4],'classic-final');s.s.ready=true;
 assert.equal(await s.run('display-update',{text:'x',profile:'arbitrary-wire',source_id:id(1)}),undefined);
 s.failStart(true);const r=await s.run('display-update',{text:'new',profile:'dual-final',source_id:id(1)});assert.equal(r.state,'uncertain');await s.control.poll();assert.equal(s.calls.length,2);
});

test('preview separation is a startup property and cannot be pretended by updating an existing session',async()=>{
 const s=setup();await s.run('display-start',{text:'test',hold_ms:125000,profile:'subtitle-no-preview'});assert.equal(s.calls[0][4],'subtitle-no-preview');s.s.ready=true;
 for(const profile of ['subtitle-no-preview','subtitle-preview'])assert.equal(await s.run('display-update',{text:'new',profile,source_id:id(1)}),undefined);
 assert.equal(s.calls.length,1);
});

test('notification timing binds the original connection, saves unknown prior state and never claims lens or readback proof',async()=>{
 const s=setup();s.s.notice_can_configure=true;s.s.notice_binding='a'.repeat(64);
 const r=await s.run('notification-timing',{notice_seconds:120,binding:'a'.repeat(64)});
 assert.equal(r.state,'complete');assert.equal(r.before.notice_target_seconds,-1);assert.equal(r.before.notice_device_value_known,false);
 assert.equal(r.snapshot.notice_target_seconds,120);assert.equal(r.lens_verified,false);assert.deepEqual(s.calls,[['notice',120]]);
 await s.control.poll();assert.equal(s.calls.length,1);
});

test('notification timing rejects stale bindings, offline/background/occupied state and unrelated fields before transport',async()=>{
 for(const change of [v=>v.foreground=false,v=>v.connected=false,v=>v.notice_can_configure=false,v=>v.notice_binding='b'.repeat(64)]){
  const s=setup();s.s.notice_can_configure=true;s.s.notice_binding='a'.repeat(64);change(s.s);
  const r=await s.run('notification-timing',{notice_seconds:120,binding:'a'.repeat(64)});assert.equal(r.error,'CHANNEL_NOTICE_NOT_READY');assert.equal(s.calls.length,0);
 }
 for(const extra of [{notice_seconds:120,binding:['a'.repeat(64)]},{notice_seconds:7,binding:'a'.repeat(64)},{notice_seconds:120,binding:'a'.repeat(64),force:true}]){
  const s=setup();assert.equal(await s.run('notification-timing',extra),undefined);assert.equal(s.calls.length,0);
 }
});

test('notification duration storage or transport failures never trigger automatic reconfiguration',async()=>{
 const s=setup();s.s.notice_can_configure=true;s.s.notice_binding='a'.repeat(64);s.failSave(true);
 await s.run('notification-timing',{notice_seconds:120,binding:'a'.repeat(64)});assert.equal(s.calls.length,0);
 s.failSave(false);s.failStart(true);const r=await s.run('notification-timing',{notice_seconds:120,binding:'a'.repeat(64)});
 assert.equal(r.state,'uncertain');await s.control.poll();assert.equal(s.calls.length,1);
});
