import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'capture-lab-control-'));
 t.after(()=>{assert(path.basename(root).startsWith('capture-lab-control-'));fs.rmSync(root,{recursive:true});});
 let now=1792330000000,sequence=0,originalPeer='private-original-peer',peer=originalPeer,generation=3,connection=9,connected=true,foreground=true,reads=0,onSave,failSave=false,stopWork,cleanupWork;
 let state={phase:'listening',binding:'capture-lab-original113',text:'private spoken words',observationRestored:false,packets:245,pcmBytes:470400,nonzeroPackets:3,
  type1Packets:1,firstType1At:now-100,micWriteStartedAt:now-90,micWriteCompletedAt:now-80,firstDecodedCompressedBytes:80,firstDecodedSamples:960,
  compressedPackets:245,compressedBytes:19600,repeatedCompressedPackets:240,lastCompressedSha256:'a'.repeat(64),pcmRms:0.5,pcmPeak:12,
  stopSubmitted:false,inputSealed:false,workerExited:false,exitEvidence:'none',recorderStop:'not_attempted',exitWrite:'not_attempted',transcriptStatus:'pending',boundaryEvidence:'none'};
 const calls=[],order=[],disk=id=>path.join(root,id+'.json');
 class Clock extends Date{static now(){return now;}}
 const mod=loadApp('AgentCaptureLabControl',{}, {Date:Clock});
 const ports={state:()=>{reads++;order.push('state');return state;},active:()=>['preparing','starting','listening','stopping','cleanup_pending'].includes(state.phase),
  originalPeer:()=>originalPeer,generation:()=>generation,peer:()=>peer,connection:()=>connection,connected:()=>connected,foreground:()=>foreground,
  stop(){calls.push('stop');order.push('stop');state.phase='stopping';state.recorderStop='pending';return stopWork?stopWork():Promise.resolve();},
  cleanup(){calls.push('cleanup');return cleanupWork?cleanupWork():Promise.resolve();},
  command:priority=>{const file=path.join(root,priority?'lab-stop.json':'lab-command.json');return fs.existsSync(file)?fs.readFileSync(file,'utf8'):undefined;},
  receipt:id=>{if(fs.existsSync(disk(id)+'.partial'))throw Error('partial receipt');return fs.existsSync(disk(id))?fs.readFileSync(disk(id),'utf8'):undefined;},
  save(id,raw){order.push('save');if(failSave)throw Error('synthetic promotion failure');if(fs.existsSync(disk(id)+'.partial'))throw Error('partial receipt');fs.writeFileSync(disk(id)+'.partial',raw);fs.renameSync(disk(id)+'.partial',disk(id));onSave?.(JSON.parse(raw));}};
 let controller=new mod.AgentCaptureLabControl(ports);
 const make=(action='status',view)=>{const s=action==='status'?undefined:view||controller.snapshot();return {schema:1,id:'cap-'+(++sequence).toString(16).padStart(32,'0'),action,expires_at:now+30000,
  expected_binding:s?.expected_binding||'',expected_peer:s?.expected_peer||'',expected_connection:s?.expected_connection||0};};
 const put=(command,priority=command.action==='stop')=>fs.writeFileSync(path.join(root,priority?'lab-stop.json':'lab-command.json'),JSON.stringify(command));
 const result=id=>JSON.parse(fs.readFileSync(disk(id),'utf8'));
 return{root,ports,mod,calls,order,make,put,result,disk,flush,get c(){return controller;},get state(){return state;},replace:v=>state=v,
  setPeer:v=>peer=v,setOriginalPeer:v=>originalPeer=v,setGeneration:v=>generation=v,setConnection:v=>connection=v,setConnected:v=>connected=v,setForeground:v=>foreground=v,
  onSave:fn=>onSave=fn,failSave:v=>failSave=v,stop:fn=>stopWork=fn,cleanup:fn=>cleanupWork=fn,advance:ms=>now+=ms,
  get now(){return now;},get reads(){return reads;},restart(){controller.dispose();controller=new mod.AgentCaptureLabControl(ports);return controller;}};
}

test('status is durably claimed before reading state and exposes only the exact lab metadata whitelist',t=>{
 const f=fixture(t),cmd=f.make();f.put(cmd);f.c.poll();const receipt=f.result(cmd.id),view=receipt.snapshot;
 assert.equal(f.order[0],'save');assert.equal(receipt.state,'complete');assert.equal(receipt.control_call_completed,false);assert.equal(view.applicable,true);
 assert.equal(view.attempt_sha256,digest(f.state.binding));assert.equal(view.expected_peer,digest('private-original-peer'));assert.equal(view.expected_connection,9);
 assert.equal(view.first_decoded_samples,960);assert.equal(view.metrics_available,true);assert.equal(view.pcm_rms,0.5);
 assert.deepEqual(Object.keys(view).sort(),Object.keys(new f.mod.CaptureLabSnapshot()).sort());
 const raw=JSON.stringify(receipt);for(const secret of [f.state.binding,f.state.text,'private-original-peer'])assert(!raw.includes(secret));assert.deepEqual(f.calls,[]);
});

test('task-bound, wrong-peer, disconnected and malformed identities expose no lab tokens or metrics',t=>{
 const f=fixture(t),original={...f.state};
 for(const mutate of [()=>f.state.binding='{"format":"turboio-task-voice/1","text":"private"}',()=>f.setPeer('other-peer'),()=>f.setConnected(false),()=>f.setConnection(0),()=>f.setOriginalPeer('')]){
  f.replace({...original});f.setPeer('private-original-peer');f.setOriginalPeer('private-original-peer');f.setConnected(true);f.setConnection(9);mutate();
  const s=f.c.snapshot();assert.equal(s.applicable,false);assert.equal(s.active,true,'global occupancy remains visible for guard preflight');assert.equal(s.expected_binding,'');assert.equal(s.attempt_sha256,'');assert.equal(s.metrics_available,false);assert.equal(s.capture_packets,0);
 }
});

test('cold-restored lab may be inspected and explicitly cleaned but never presents fresh zero measurements',async t=>{
 const f=fixture(t);f.state.observationRestored=true;f.state.phase='cleanup_pending';f.setGeneration(0);
 const s=f.c.snapshot();assert.equal(s.applicable,true);assert.equal(s.metrics_available,false);assert.equal(s.observation_restored,true);assert.equal(s.type1_packets,0);assert.equal(s.last_compressed_sha256,'');
 f.cleanup(async()=>{f.state.phase='idle';f.state.workerExited=true;f.state.inputSealed=true;f.state.exitEvidence='device_event';f.setGeneration(1);});const cmd=f.make('cleanup');f.put(cmd);f.c.poll();await flush();
 assert.deepEqual(f.calls,['cleanup']);assert.equal(f.result(cmd.id).control_call_completed,true);assert.equal(f.result(cmd.id).state,'complete');
});

test('stop lane runs first and pending native or ASR completion never blocks fresh status',async t=>{
 const f=fixture(t);let done;f.stop(()=>new Promise(resolve=>done=resolve));const stop=f.make('stop'),status=f.make();f.put(status);f.put(stop);f.order.length=0;f.c.poll();
 assert.equal(f.result(stop.id).state,'running');assert.equal(f.result(stop.id).control_call_completed,false);assert.equal(f.result(status.id).state,'complete');assert.equal(f.result(status.id).snapshot.phase,'stopping');assert(f.order.indexOf('stop')<f.order.lastIndexOf('state'));
 f.c.poll();assert.deepEqual(f.calls,['stop'],'same ID cannot invoke twice');done();await flush();
 const completed=f.result(stop.id);assert.equal(completed.control_call_completed,true);assert.equal(completed.state,'uncertain');assert.equal(completed.error,'LAB_STOP_UNCONFIRMED');assert.equal(completed.snapshot.exit_evidence,'none');assert.equal(completed.snapshot.active,true);
});

test('last synchronous CAS rejects changed binding, generation, original peer or connection after claim',t=>{
 for(const mutation of [f=>f.state.binding='capture-lab-newround',f=>f.setGeneration(4),f=>f.setOriginalPeer('replacement'),f=>f.setConnection(10),f=>f.setForeground(false)]){
  const f=fixture(t),cmd=f.make('stop');f.onSave(row=>{if(row.state==='running')mutation(f);});f.put(cmd);f.c.poll();const result=f.result(cmd.id);
  assert.equal(result.state,'error');assert.equal(result.control_call_completed,false);assert.deepEqual(f.calls,[]);
 }
});

test('expired, far-future and expiry crossed during claim cannot invoke control',t=>{
 for(const kind of ['past','future','during']){const f=fixture(t),cmd=f.make('stop');if(kind==='past')cmd.expires_at=f.now;if(kind==='future')cmd.expires_at=f.now+60001;if(kind==='during')f.onSave(row=>{if(row.state==='running')f.advance(30001);});f.put(cmd);f.c.poll();assert.equal(f.result(cmd.id).error,'LAB_COMMAND_EXPIRED');assert.deepEqual(f.calls,[]);}
});

test('only stop is accepted in the priority lane and no start, clear, user confirmation or task action exists',t=>{
 const f=fixture(t);
 for(const action of ['start','clear','confirm-exit','voice-cancel','submit','cleanup','status']){const cmd=f.make();cmd.action=action;f.put(cmd,true);f.c.poll();assert.equal(fs.existsSync(f.disk(cmd.id)),false);}
 const stop=f.make('stop');f.put(stop,false);fs.unlinkSync(path.join(f.root,'lab-stop.json'));f.c.poll();assert.equal(fs.existsSync(f.disk(stop.id)),false);assert.deepEqual(f.calls,[]);
});

test('stop cannot implicitly clean cleanup_pending; cleanup requires its own exact explicit command',async t=>{
 const f=fixture(t);f.state.phase='cleanup_pending';const stop=f.make('stop');f.put(stop);f.c.poll();assert.equal(f.result(stop.id).error,'LAB_PHASE_INVALID');assert.deepEqual(f.calls,[]);
 const clean=f.make('cleanup');f.put(clean);f.c.poll();await flush();assert.deepEqual(f.calls,['cleanup']);f.c.poll();assert.deepEqual(f.calls,['cleanup']);assert.equal(f.result(clean.id).state,'uncertain');
});

test('stopping can join the same existing close without authorizing another phase or retrying the same ID',async t=>{
 const f=fixture(t);let done;const closing=new Promise(resolve=>done=resolve);f.state.phase='stopping';f.stop(()=>closing);const cmd=f.make('stop');f.put(cmd);f.c.poll();f.c.poll();assert.deepEqual(f.calls,['stop']);done();await flush();assert.equal(f.result(cmd.id).control_call_completed,true);
});

test('a completed preparation cancellation may advance generation without pretending a different attempt',async t=>{
 const f=fixture(t);f.state.phase='preparing';f.stop(async()=>{f.state.phase='idle';f.state.inputSealed=true;f.state.workerExited=true;f.setGeneration(4);});const cmd=f.make('stop');f.put(cmd);f.c.poll();await flush();assert.equal(f.result(cmd.id).state,'complete');assert.equal(f.result(cmd.id).snapshot.attempt_sha256,digest(f.state.binding));assert.equal(f.result(cmd.id).snapshot.exit_evidence,'none');
});

test('same ID different content, corrupt receipts and orphan partial files are preserved and cannot authorize work',t=>{
 const f=fixture(t),status=f.make();f.put(status);f.c.poll();const old=fs.readFileSync(f.disk(status.id),'utf8'),conflict=f.make('stop');conflict.id=status.id;f.put(conflict);f.c.poll();assert.equal(fs.readFileSync(f.disk(status.id),'utf8'),old);
 for(const broken of ['{',JSON.stringify({...f.result(status.id),snapshot:{...f.result(status.id).snapshot,private_text:'do not repair'}}),JSON.stringify({...f.result(status.id),request_json:'{"id":"'+status.id+'"}'})]){
  fs.writeFileSync(f.disk(conflict.id),broken);f.c.poll();assert.equal(fs.readFileSync(f.disk(conflict.id),'utf8'),broken);
 }
 const partial=f.make('stop');fs.writeFileSync(f.disk(partial.id)+'.partial','private damaged evidence');f.put(partial);f.c.poll();assert.equal(fs.readFileSync(f.disk(partial.id)+'.partial','utf8'),'private damaged evidence');assert.deepEqual(f.calls,[]);
});

test('claim persistence failure prevents all control effects and terminal promotion failure never replays the operation',async t=>{
 const f=fixture(t),cmd=f.make('stop');f.failSave(true);f.put(cmd);f.c.poll();assert.deepEqual(f.calls,[]);assert.equal(fs.existsSync(f.disk(cmd.id)),false);
 f.failSave(false);let done;f.stop(()=>new Promise(resolve=>done=resolve));f.c.poll();assert.deepEqual(f.calls,['stop']);f.failSave(true);done();await flush();assert.equal(f.result(cmd.id).state,'running');f.failSave(false);f.c.poll();assert.equal(f.result(cmd.id).state,'uncertain');assert.equal(f.result(cmd.id).error,'LAB_OPERATION_UNCERTAIN');assert.deepEqual(f.calls,['stop']);
});

test('cold running claims are uncertain without replay or attribution of a new attempts metrics',async t=>{
 const f=fixture(t);let done;f.stop(()=>new Promise(resolve=>done=resolve));const cmd=f.make('stop');f.put(cmd);f.c.poll();f.restart();f.state.binding='capture-lab-otherattempt';f.state.type1Packets=999;f.c.poll();const receipt=f.result(cmd.id);
 assert.equal(receipt.state,'uncertain');assert.equal(receipt.error,'LAB_OPERATION_UNCERTAIN');assert.equal(receipt.snapshot.applicable,false);assert.equal(receipt.snapshot.metrics_available,false);assert.equal(receipt.snapshot.type1_packets,0);assert.deepEqual(f.calls,['stop']);done();await flush();assert.equal(f.result(cmd.id).state,'uncertain');
});

test('late operation completion cannot disclose or affect a replacement attempt',async t=>{
 const f=fixture(t);let done;f.stop(()=>new Promise(resolve=>done=resolve));const cmd=f.make('stop');f.put(cmd);f.c.poll();f.state.binding='capture-lab-replacement';f.state.type1Packets=999;done();await flush();const receipt=f.result(cmd.id);
 assert.equal(receipt.state,'uncertain');assert.equal(receipt.error,'LAB_BINDING_CHANGED');assert.equal(receipt.control_call_completed,true);assert.equal(receipt.snapshot.applicable,false);assert.equal(receipt.snapshot.type1_packets,0);assert.deepEqual(f.calls,['stop']);
});

test('rejected operations and invalid state observations never become exit proof or leak exception bodies',async t=>{
 const f=fixture(t);f.stop(()=>Promise.reject(Error('private driver detail')));const cmd=f.make('stop');f.put(cmd);f.c.poll();await flush();const result=f.result(cmd.id);
 assert.equal(result.state,'error');assert.equal(result.error,'LAB_CONTROL_FAILED');assert.equal(result.control_call_completed,false);assert.equal(result.snapshot.exit_evidence,'none');assert(!JSON.stringify(result).includes('private driver detail'));
 f.ports.state=()=>{throw Error('private source');};const hidden=f.c.snapshot();assert.equal(hidden.active,true);assert.equal(hidden.applicable,false);assert.equal(hidden.metrics_available,false);
});

test('actual DebugCardService lab timer remains independent of a blocked display/settings/task poll',async t=>{
 const f=fixture(t),timers=new Map(),calls=[];let timer=0,releaseChannel,channelCalls=0,taskCalls=0;
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},accessSync:fs.existsSync,mkdirSync:p=>fs.mkdirSync(p),statSync:fs.statSync,readTextSync:p=>fs.readFileSync(p,'utf8'),
  openSync:p=>({fd:fs.openSync(p,'w')}),closeSync:file=>fs.closeSync(file.fd),writeSync:(fd,bytes)=>fs.writeSync(fd,new Uint8Array(bytes)),fsyncSync:fs.fsyncSync,renameSync:fs.renameSync};
 const capture={get state(){return f.state;},get active(){return f.ports.active();},get observationPeer(){return f.ports.originalPeer();},get observationGeneration(){return f.ports.generation();},
  stop(value){calls.push(['stop',value]);return f.ports.stop();},cleanup(){calls.push(['cleanup']);return f.ports.cleanup();}};
 class Clock extends Date{static now(){return f.now;}}
 const service=loadApp('DebugCardService',{
  '@kit.CoreFileKit':{fileIo:io},'./DebugCardControl':{DebugCardControl:class{enable(){}dispose(){}async poll(){taskCalls++;}},DebugCardState:class{}},
  './DeviceSettingsControl':{DeviceSettingsControl:class{async poll(){throw Error('blocked channel must not reach settings');}}},'./DeviceSettingsService':{deviceSettingsPorts:()=>({})},
  './ChannelProbeService':{makeChannelProbeControl:()=>({poll(){channelCalls++;return new Promise(resolve=>releaseChannel=resolve);}})},
  './NotificationService':{suggestionTests:{}},'./AgentCaptureService':{agentCapture:capture},
  './TaskService':{taskService:{decisionDraft:{snapshot:()=>undefined,paused:false}}},'./TaskSuggestionService':{taskVoiceReplies:{},taskSuggestions:{},taskDraftRecovery:{}},
  './ProbeSession':{probeSession:{features:{state:{connected:true}},peerDeviceId:'private-original-peer',auth:{connectionGeneration:9},foreground:true}},
  './MaterialLocalQuery':{LocalMaterialQuery:class{}},'./LocalWorkspace':{localWorkspace:{}},'./RecordingService':{materials:{}}
 },{Date:Clock,setTimeout(fn,ms){timers.set(++timer,{fn,ms});return timer;},clearTimeout:id=>timers.delete(id)});
 service.initializeDebugCards({applicationInfo:{debug:true},filesDir:f.root});
 const main=[...timers.values()].find(value=>value.ms===1000),lab=[...timers.values()].find(value=>value.ms===500);assert(main&&lab);
 main.fn();assert.equal(channelCalls,1);assert.equal(taskCalls,0);
 const stop=f.make('stop'),status=f.make();const directory=path.join(f.root,'io-debug');fs.writeFileSync(path.join(directory,'lab-stop.json'),JSON.stringify(stop));fs.writeFileSync(path.join(directory,'lab-command.json'),JSON.stringify(status));
 lab.fn();await flush();const receipt=JSON.parse(fs.readFileSync(path.join(directory,status.id+'.json'),'utf8'));
 assert.equal(receipt.state,'complete');assert.equal(receipt.snapshot.phase,'stopping');assert.equal(receipt.snapshot.first_decoded_samples,960);assert.deepEqual(calls,[['stop',false]]);assert.equal(taskCalls,0);
 service.disposeDebugCards();assert(![...timers.values()].some(value=>value.ms===500&&value!==lab),'the independently scheduled lab timer is disposed');
 // Settle the unrelated poll without invoking settings or rearming after disposal.
 void releaseChannel;
});
