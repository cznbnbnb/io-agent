import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
function setup(seed={}){
 const files=new Map(Object.entries(seed)),calls=[],p={phase:'idle',active:false,cleanupSessionId:'',deviceResumeSequence:0,async prepare(text,speed,mode,source,title){calls.push({text,speed,mode,source,title});p.active=true;p.cleanupSessionId='fixture';p.phase='preparing';},async control(){},async stopAndWait(){p.active=false;return true;}};
 const {LongReadingProbeService}=loadApp('LongReadingProbeService',{'./TeleprompterService':{teleprompter:p},
 './NotificationService':{suggestionTests:{active:false,busy:false,pendingUid:'',phase:'idle',command:0},notifications:{occupied:false}},
 './ProbeSession':{probeSession:{features:{state:{connected:true}},foreground:true,peerDeviceId:'synthetic',auth:{connectionGeneration:1},voice:{active:false,pendingWrites:0},recordingOccupied:()=>false,lifelogOccupied:()=>false}}});
 const service=new LongReadingProbeService(k=>files.get(k),(k,v)=>files.set(k,v));
 return{files,calls,service,p,run:async(action,id='1',extra={})=>{const command={schema:1,id:'read-'+id.repeat(32),action,expires_at:Date.now()+30000,...extra};files.set('reading-command.json',JSON.stringify(command));await service.poll();return JSON.parse(files.get(command.id+'.json')||'null');}};
}
test('fixed text-only check prepares once without enabling interactive handoff',async()=>{
 const s=setup();const r=await s.run('check');assert.equal(r.state,'complete');assert.equal(r.record.checkOnly,true);assert.equal(r.lens_verified,false);
 await s.service.poll();assert.equal(s.calls.length,1);assert.equal(s.calls[0].mode,2);assert.equal(s.calls[0].source,'local');
 const status=await s.run('status','2');assert.equal(status.record.phase,'preparing');assert.equal(status.record.choice,0);
});
test('expired and unexpected fields cannot start or submit arbitrary content',async()=>{
 const s=setup();assert.equal((await s.run('start','1',{expires_at:Date.now()-1})).error,'READING_EXPIRED');
 assert.equal(await s.run('start','2',{text:'arbitrary'}),null);assert.deepEqual(s.calls,[]);
});
test('reusing an ID with different action preserves its original result',async()=>{
 const s=setup();await s.run('status');const before=s.files.get('read-'+'1'.repeat(32)+'.json');await s.run('start');assert.equal(s.files.get('read-'+'1'.repeat(32)+'.json'),before);assert.deepEqual(s.calls,[]);
});
test('an interrupted command is reported uncertain with no hardware replay',async()=>{
 const s=setup();await s.run('check');const key='read-'+'1'.repeat(32)+'.json',r=JSON.parse(s.files.get(key));r.state='running';s.files.set(key,JSON.stringify(r));await s.service.poll();assert.equal(JSON.parse(s.files.get(key)).state,'uncertain');assert.equal(s.calls.length,1);
});
test('legacy interactive start is disabled on the phone as well as the host',async()=>{
 const s=setup();assert.equal((await s.run('start')).error,'READING_PROBE_SUSPENDED');assert.deepEqual(s.calls,[]);
});
