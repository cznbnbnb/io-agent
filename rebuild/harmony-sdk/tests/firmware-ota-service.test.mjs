import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';import {loadCore} from './load-core.mjs';
const core=loadCore('./FirmwareOta'),sha='fcbc2d80bca5e64a2e1b1513c63bc0fe4527a85efe2751093bdc6235f8171cd9';
function fixture(initial={}){
 const store=new Map(Object.entries(initial)),sent=[],events=[];
 const p={features:{state:{connected:true},launcherBusy:false,displayActive:false},foreground:true,peerInfo:{peerIdentifier:Uint8Array.of(1,2,3,4,5,6)},peerDeviceId:'route',voice:{active:false,pendingWrites:0},recordingOccupied:()=>false,lifelogOccupied:()=>false,prompterOccupied:()=>false,agentCaptureOccupied:false,agentSuggestionOccupied:false,background:{active:true,stop:async()=>{}},connection:{note:'ready'},onConnection:()=>{},auth:{connectionGeneration:3,firmwareExclusive:false,snapshot:()=>({mtu:512,lastMessage:''}),sendBusiness:async(b,raw)=>{events.push('send');sent.push(core.readOtaMessage(raw));}}};
 const {FirmwareOtaService}=loadApp('FirmwareOtaService',{'turbo_core':core,'./ProbeSession':{probeSession:p},'./NotificationService':{notifications:{occupied:false},suggestionTests:{active:false,busy:false}},'./FirmwareOtaCandidate':{FIRMWARE_CANDIDATE_SHA:sha,FIRMWARE_FILES:[]}});
 const svc=new FirmwareOtaService({filesDir:'/test'},n=>store.get(n),(n,t)=>{events.push('write:'+n);store.set(n,t);});
 function command(action,extra={},digit='1'){const id='fw-'+digit.repeat(32);store.set('firmware-command.json',JSON.stringify({schema:1,id,action,expires_at:Date.now()+30000,candidate_sha256:sha,...extra}));return id;}
 function ready(){const s=svc.session;s.peer=svc.owner();s.connection=3;s.phase='ready';s.freshAt=Date.now();s.battery=90;svc.journal.operation='fw-'+'a'.repeat(32);svc.journal.owner=s.peer;svc.lock();}
 return {svc,p,store,sent,events,command,ready};
}
test('durable intent precedes Mode2 and replayed local command never starts twice',async()=>{
 const f=fixture();f.ready();const id=f.command('start',{expected_binding:f.svc.binding()});await f.svc.poll();
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].type,4);assert.equal(JSON.parse(f.store.get('firmware-journal.json')).started,true);
 assert(f.events.indexOf('write:firmware-journal.json')<f.events.indexOf('send'));await f.svc.poll();assert.equal(f.sent.length,1);assert.equal(JSON.parse(f.store.get(id+'.json')).state,'complete');
});
test('intent write failure prevents Mode2; restored intent locks all ordinary business',async()=>{
 const f=fixture();f.ready();f.svc.write=(n,t)=>{if(n==='firmware-journal.json')throw Error('DISK');f.store.set(n,t);};f.command('start',{expected_binding:f.svc.binding()});await f.svc.poll();assert.equal(f.sent.length,0);assert.equal(f.p.firmwareOccupied,true);
 const restored=fixture({'firmware-journal.json':JSON.stringify({schema:1,operation:'fw-'+'a'.repeat(32),owner:'a'.repeat(64),started:true,startedAt:Date.now(),installAt:0,disconnectAt:0,phase:'transfer',reason:'',requests:10,sentBytes:500,apCovered:500})});
 assert.equal(restored.svc.session.phase,'unknown');assert.equal(restored.p.auth.firmwareExclusive,true);await restored.svc.poll();assert.equal(restored.sent.length,0);assert.equal(restored.svc.journal.requests,10);assert.equal(restored.svc.journal.apCovered,500);
});
test('operator link recovery waits two minutes, allows later recovery and retains unknown intent after connection',async()=>{
 for(const kind of ['allowed','late','too-soon','ap','install','evidence','wrong-operation']){
  const f=fixture();f.ready();f.p.firmwareReconnectAllowed=false;f.svc.session.started=true;f.svc.session.phase='unknown';f.svc.session.requests=7;f.svc.session.sentBytes=358400;Object.assign(f.svc.journal,{started:true,startedAt:Date.now()-(kind==='late'?90000000:kind==='too-soon'?60000:130000),requests:7,sentBytes:358400,apCovered:kind==='ap'?1:0,installAt:kind==='install'?Date.now()-125000:0});
  let recovered=0;f.p.reconnect=async()=>{assert.equal(f.p.firmwareReconnectAllowed,true);recovered++;};
  f.command('recover-link',{expected_binding:kind==='wrong-operation'?'fw-'+'b'.repeat(32):f.svc.journal.operation,inspection:kind==='evidence'?'':'user_observed_setup_after_reported_transfer_failure'});await f.svc.poll();
  assert.equal(recovered,['allowed','late'].includes(kind)?1:0,kind);assert.equal(f.p.firmwareOccupied,true);assert.equal(f.sent.length,0);assert.equal(f.p.firmwareReconnectAllowed,false);
  assert.equal(f.svc.journal.started,true,kind);assert.equal(f.svc.session.phase,'unknown',kind);assert.equal(f.svc.journal.requests,7,kind);assert.equal(f.svc.journal.sentBytes,358400,kind);
 }
});
test('small negotiated MTU prevents any new upgrade start',async()=>{
 const f=fixture();f.ready();f.p.auth.snapshot=()=>({mtu:23,lastMessage:''});f.command('start',{expected_binding:f.svc.binding()});await f.svc.poll();assert.equal(f.sent.length,0);assert.equal(f.svc.journal.started,false);
});

test('manual journal release permits normal App use but cannot re-arm or overwrite the failed OTA',async()=>{
 const journal={schema:1,operation:'fw-'+'a'.repeat(32),owner:'a'.repeat(64),started:false,startedAt:Date.now()-180000,installAt:0,disconnectAt:0,phase:'failed',reason:'OTA_LINK_RECOVERED_NO_AP',requests:0,sentBytes:0,apCovered:0};
 const f=fixture({'firmware-journal.json':JSON.stringify(journal)});assert.notEqual(f.p.firmwareOccupied,true);
 const id=f.command('prepare');await f.svc.poll();assert.equal(f.sent.length,0);assert.equal(JSON.parse(f.store.get(id+'.json')).error,'OTA_MANUAL_RELEASE_NEEDS_INSPECTION');
 assert.deepEqual(JSON.parse(f.store.get('firmware-journal.json')),journal);assert.notEqual(f.p.firmwareOccupied,true);
});
test('changed binding, expired command, low battery and active capture send no Mode2',async()=>{
 for(const kind of ['binding','expired','battery','capture']){const f=fixture();f.ready();let extra={expected_binding:f.svc.binding()};if(kind==='binding')extra.expected_binding='bad';if(kind==='expired')extra.expires_at=1;if(kind==='battery')f.svc.session.battery=49;if(kind==='capture')f.p.voice.active=true;f.command('start',extra);await f.svc.poll();assert.equal(f.sent.length,0,kind);}
});
test('package hash/read failure releases preflight; timeout never retains a prestart lease',async()=>{
 const f=fixture();f.svc.load=()=>{throw Error('OTA_FILE_HASH');};f.command('prepare');await f.svc.poll();assert.equal(f.sent.length,0);assert.equal(f.p.firmwareOccupied,false);
 const g=fixture();g.ready();g.svc.session.phase='version';g.svc.session.deadline=1;await g.svc.poll();assert.equal(g.p.firmwareOccupied,false);assert.equal(g.sent.length,0);
});
test('incomplete HDC inbox is ignored without poisoning the durable upgrade state',async()=>{
 const f=fixture({'firmware-command.json':'{"schema":1,'});await f.svc.poll();assert.equal(f.p.firmwareOccupied,undefined);assert.equal(f.svc.blocked,false);assert.equal(f.sent.length,0);
});
test('fresh readback releases transport for lens testing without claiming lens verification',async()=>{
 const f=fixture();f.ready();f.svc.session.phase='readback_ready';f.svc.session.started=true;f.svc.journal.started=true;
 f.command('release',{expected_binding:f.svc.binding(),inspection:'readback_verified_release_for_lens_check'});await f.svc.poll();
 assert.equal(f.p.firmwareOccupied,false);assert.equal(f.svc.snapshot().lens_verified,false);assert.equal(f.svc.journal.started,false);assert.equal(f.sent.length,0);
});
