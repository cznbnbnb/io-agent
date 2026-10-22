import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

// Synthetic media boundaries: these checks cannot establish audible output.
const turn=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function clock(){let id=0;const timers=new Map();return{timers,globals:{setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},setInterval(fn,ms){timers.set(++id,{fn,ms,repeat:true});return id;},clearInterval(id){timers.delete(id);}},fire(ms){for(const [id,value]of [...timers])if(value.ms===ms){if(!value.repeat)timers.delete(id);value.fn();}}};}
function fixture(){
 const time=clock();let uuid=0,foreground=true,valid=true,hash='a'.repeat(64),resolveError='',start=0,duration=60000;
 const leases=[],drivers=[],checks=[],calls=[];
 const {PlaybackController}=loadApp('PlaybackController',{'@kit.ArkTS':{util:{generateRandomUUID:()=> (++uuid).toString(16).padStart(32,'0')}}},time.globals);
 const selection={kind:'recording',name:'take-'+'b'.repeat(32),revision:0,utterance_id:''};
 const ports={foreground:()=>foreground,resolve(value){calls.push('resolve');if(resolveError)throw Error(resolveError);
   const lease={reference:{...value,audio_sha256:hash,format:'wav'},fd:100+leases.length,length:1024,start_ms:start,closed:0,
    check(strong){checks.push(strong);if(!valid)throw Error('PLAYBACK_SOURCE_CHANGED');},close(){this.closed++;}};leases.push(lease);return lease;},
  create(){const driver={events:[],calls:[],prepareGate:null,playGate:null,pauseGate:null,seekGate:null,releaseGate:null,releaseFailure:false,
    emit(value){this.event?.({kind:'time',native_state:'',position_ms:-1,duration_ms:-1,error:'',note:'',...value});},
    async prepare(lease,event){this.event=event;this.calls.push(['prepare',lease.fd]);if(this.prepareGate)await this.prepareGate.promise;this.emit({kind:'state',native_state:'prepared',position_ms:0,duration_ms:duration});},
    async play(){this.calls.push(['play']);if(this.playGate)await this.playGate.promise;this.emit({kind:'state',native_state:'playing'});},
    async pause(){this.calls.push(['pause']);if(this.pauseGate)await this.pauseGate.promise;this.emit({kind:'state',native_state:'paused'});},
    async seek(position){this.calls.push(['seek',position]);if(this.seekGate)await this.seekGate.promise;this.emit({kind:'seek_done',position_ms:Math.max(0,position-7)});},
    async release(){this.calls.push(['release']);if(this.releaseFailure)throw Error('private file path must not leak');if(this.releaseGate)await this.releaseGate.promise;this.emit({kind:'release_done',native_state:'released'});}};
   drivers.push(driver);return driver;}};
 const controller=new PlaybackController(ports);
 return{controller,ports,selection,leases,drivers,checks,calls,time,first:()=>drivers[0],setForeground:value=>foreground=value,setValid:value=>valid=value,setHash:value=>hash=value,setError:value=>resolveError=value,setStart:value=>start=value,setDuration:value=>duration=value};
}

test('construction/status are pure, subscriptions and exposed source are isolated',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.controller.snapshot().audio_output_verified,false);
 let notify=0;const unsubscribe=f.controller.subscribe(()=>{notify++;throw Error('view is gone');});const state=await f.controller.play(f.selection);
 assert.deepEqual(f.checks,[true,true],'one fresh check after prepare and after play, without synchronous duplicate full hashes');
 state.phase='forged';state.source.audio_sha256='forged';assert.equal(f.controller.snapshot().phase,'playing');assert.equal(f.controller.snapshot().source.audio_sha256,'a'.repeat(64));
 const before=f.checks.length;f.controller.snapshot();assert.equal(f.checks.length,before);unsubscribe();const n=notify;await f.controller.pause(state.session_id);assert.equal(notify,n);
 await f.controller.stop(state.session_id);assert.equal(f.leases[0].closed,1);assert.equal(f.time.timers.size,0);
});
test('pause/resume use same native source, stale sessions cannot act on another source',async()=>{
 const f=fixture(),a=await f.controller.play(f.selection);await f.controller.pause(a.session_id);const b=await f.controller.resume(a.session_id);
 assert.equal(b.session_id,a.session_id);assert.equal(f.drivers.length,1);assert.equal(f.first().calls.filter(row=>row[0]==='play').length,2);
 const next=await f.controller.play({...f.selection,name:'take-'+'c'.repeat(32)});assert.notEqual(next.session_id,a.session_id);assert.equal(f.leases[0].closed,1);
 for(const action of[()=>f.controller.pause(a.session_id),()=>f.controller.resume(a.session_id),()=>f.controller.seek(a.session_id,0),()=>f.controller.stop(a.session_id)])await assert.rejects(action,/PLAYBACK_STALE_SESSION/);
 assert.equal(f.controller.snapshot().session_id,next.session_id);await f.controller.stop(next.session_id);
});
test('seek waits for driver completion and reports observed position rather than requested position',async()=>{
 const f=fixture(),s=await f.controller.play(f.selection);f.first().seekGate=deferred();const seeking=f.controller.seek(s.session_id,5000);
 assert.equal(f.controller.snapshot().phase,'seeking');assert.equal(f.controller.snapshot().position_ms,0);
 await assert.rejects(()=>f.controller.seek(s.session_id,6000),/PLAYBACK_BUSY/);f.first().seekGate.resolve();const result=await seeking;
 assert.equal(result.position_ms,4993);assert.equal(result.phase,'playing');await f.controller.pause(s.session_id);
 await f.controller.seek(s.session_id,6000);assert.equal(f.controller.snapshot().phase,'paused');assert.equal(f.first().calls.filter(row=>row[0]==='play').length,1);await f.controller.stop(s.session_id);
});
test('unknown duration permits full playback but denies seek, invalid targets never reach driver',async()=>{
 const f=fixture();f.setDuration(-1);const s=await f.controller.play(f.selection);assert.equal(s.duration_known,false);
 await assert.rejects(()=>f.controller.seek(s.session_id,100),/PLAYBACK_UNAVAILABLE/);await assert.rejects(()=>f.controller.seek(s.session_id,NaN),/PLAYBACK_INVALID/);
 assert.equal(f.first().calls.filter(row=>row[0]==='seek').length,0);await f.controller.stop(s.session_id);
});
test('canonical start comes from the lease and is validated against actual media duration',async()=>{
 const f=fixture();f.setStart(12345);const s=await f.controller.play({...f.selection,revision:2,utterance_id:'sentence-2'});
 assert.deepEqual(f.first().calls.map(row=>row[0]),['prepare','seek','play']);assert.equal(f.first().calls[1][1],12345);assert.equal(s.position_ms,12338);await f.controller.stop(s.session_id);
 const g=fixture();g.setStart(70000);await assert.rejects(()=>g.controller.play({...g.selection,revision:2,utterance_id:'sentence-2'}),/PLAYBACK_INVALID/);assert.equal(g.first().calls.some(row=>row[0]==='play'),false);assert.equal(g.leases[0].closed,1);
});
test('stop cancels a pending prepare before later callbacks can start or corrupt replacement source',async()=>{
 const f=fixture(),create=f.ports.create;let gate=deferred();f.ports.create=()=>{const driver=create();driver.prepareGate=gate;return driver;};
 const old=f.controller.play(f.selection);const rejection=assert.rejects(old,/PLAYBACK_STALE_SESSION/);const oldId=f.controller.snapshot().session_id;
 await f.controller.stop(oldId);f.ports.create=create;const next=await f.controller.play({...f.selection,name:'take-'+'c'.repeat(32)});
 gate.resolve();await rejection;f.drivers[0].emit({kind:'time',position_ms:59999});assert.equal(f.controller.snapshot().session_id,next.session_id);assert.equal(f.controller.snapshot().position_ms,0);assert.equal(f.drivers[0].calls.some(row=>row[0]==='play'),false);await f.controller.stop(next.session_id);
});
test('foreground loss revokes pending autoplay synchronously and foreground restore never resumes',async()=>{
 const f=fixture(),create=f.ports.create,gate=deferred();f.ports.create=()=>{const d=create();d.prepareGate=gate;return d;};
 const old=f.controller.play(f.selection),rejection=assert.rejects(old,/PLAYBACK_STALE_SESSION/);f.controller.setForeground(false);await turn();gate.resolve();await rejection;
 f.controller.setForeground(true);await turn();assert.equal(f.first().calls.some(row=>row[0]==='play'),false);assert.equal(f.leases[0].closed,1);assert.equal(f.controller.snapshot().phase,'idle');
 f.setForeground(false);await assert.rejects(()=>f.controller.play(f.selection),/PLAYBACK_NOT_FOREGROUND/);
});
test('release failure quarantines one driver and descriptor, stop retry releases before allowing new source',async()=>{
 const f=fixture(),s=await f.controller.play(f.selection);f.first().releaseFailure=true;
 await assert.rejects(()=>f.controller.stop(s.session_id),/PLAYBACK_CLEANUP_PENDING/);assert.equal(f.controller.snapshot().phase,'blocked');assert.equal(f.leases[0].closed,0);
 assert.throws(()=>f.controller.assertSourceReleased(f.selection.kind,f.selection.name),/PLAYBACK_IN_USE/);await assert.rejects(()=>f.controller.play(f.selection),/PLAYBACK_CLEANUP_PENDING/);assert.equal(f.drivers.length,1);
 f.first().releaseFailure=false;await f.controller.stop(s.session_id);f.controller.assertSourceReleased(f.selection.kind,f.selection.name);assert.equal(f.leases[0].closed,1);
 await f.controller.stop(s.session_id);assert.equal(f.leases[0].closed,1);
});
test('release timeout retains fd, late positive completion closes it exactly once',async()=>{
 const f=fixture(),s=await f.controller.play(f.selection);f.first().releaseGate=deferred();const stopping=f.controller.stop(s.session_id),rejection=assert.rejects(stopping,/PLAYBACK_CLEANUP_PENDING/);
 f.time.fire(10000);await rejection;assert.equal(f.leases[0].closed,0);assert.equal(f.controller.snapshot().phase,'blocked');
 f.first().releaseGate.resolve();await turn();assert.equal(f.leases[0].closed,1);assert.equal(f.controller.snapshot().phase,'idle');assert.equal(f.time.timers.size,0);
});
test('guard and operation rechecks revoke changed/deleted source without copying or resuming',async()=>{
 const f=fixture(),s=await f.controller.play(f.selection);const checks=f.checks.length;
 for(let i=0;i<100;i++)f.first().emit({kind:'time',position_ms:i});assert.equal(f.checks.length,checks,'position callbacks do not perform source IO');
 f.setValid(false);f.time.fire(1000);await turn();assert.equal(f.controller.snapshot().error,'PLAYBACK_SOURCE_CHANGED');assert.equal(f.leases[0].closed,1);
 const g=fixture(),p=await g.controller.play(g.selection);await g.controller.pause(p.session_id);g.setValid(false);await assert.rejects(()=>g.controller.resume(p.session_id),/PLAYBACK_SOURCE_CHANGED/);await turn();assert.equal(g.leases[0].closed,1);
 const h=fixture();for(const code of['PLAYBACK_SOURCE_UNAVAILABLE','PLAYBACK_INCOMPLETE','PLAYBACK_DELETED','PLAYBACK_ANCHOR_STALE','PLAYBACK_TIME_UNKNOWN']){h.setError(code);await assert.rejects(()=>h.controller.play(h.selection),new RegExp(code));assert.equal(h.controller.snapshot().error,code);}
});
test('PAUSE interrupt preserves position and same-session explicit resume; already paused never repeats pause',async()=>{
 const f=fixture(),s=await f.controller.play(f.selection);f.first().emit({kind:'interrupt_pause',native_state:'playing',position_ms:4321});await turn();
 assert.equal(f.controller.snapshot().phase,'paused');assert.equal(f.controller.snapshot().position_ms,4321);assert.equal(f.leases[0].closed,0);
 const before=f.first().calls.filter(row=>row[0]==='pause').length;f.first().emit({kind:'interrupt_pause',native_state:'paused'});await turn();assert.equal(f.first().calls.filter(row=>row[0]==='pause').length,before);
 await f.controller.resume(s.session_id);assert.equal(f.drivers.length,1);assert.equal(f.controller.snapshot().position_ms,4321);await f.controller.stop(s.session_id);
});
test('STOP/output-loss keeps only memory resume position, explicit resume revalidates and seekDone before play',async()=>{
 for(const kind of['interrupt_stop','output_lost']){
  const f=fixture(),s=await f.controller.play(f.selection);f.first().emit({kind,position_ms:5678});await turn();assert.equal(f.controller.snapshot().phase,'paused');assert.equal(f.leases[0].closed,1);assert.equal(f.drivers.length,1);
  const result=await f.controller.resume(s.session_id);assert.equal(result.session_id,s.session_id);assert.equal(f.drivers.length,2);assert.deepEqual(f.drivers[1].calls.map(row=>row[0]),['prepare','seek','play']);assert.equal(f.drivers[1].calls[1][1],5678);assert.equal(result.position_ms,5671);await f.controller.stop(s.session_id);
 }
});
test('released interrupt cannot resume changed media or unknown observed time as an invented rewind',async()=>{
 const f=fixture(),s=await f.controller.play(f.selection);f.first().emit({kind:'output_lost',position_ms:5000});await turn();f.setHash('c'.repeat(64));await assert.rejects(()=>f.controller.resume(s.session_id),/PLAYBACK_SOURCE_CHANGED/);assert.equal(f.drivers.length,1);assert.equal(f.leases[1].closed,1);
 const g=fixture(),create=g.ports.create;g.ports.create=()=>{const d=create();d.prepare=async function(_lease,event){this.event=event;this.emit({kind:'state',native_state:'prepared',duration_ms:60000});};return d;};
 const a=await g.controller.play(g.selection);assert.equal(a.position_known,false);g.first().emit({kind:'interrupt_stop'});await turn();await assert.rejects(()=>g.controller.resume(a.session_id),/PLAYBACK_UNAVAILABLE/);assert.equal(g.drivers.length,1);
});
test('unrelated deletion has no playback effect; source deletion awaits release and synchronous fence stays closed',async()=>{
 const f=fixture(),s=await f.controller.play(f.selection);await f.controller.stopSource('lifelog','seg-'+'a'.repeat(32));assert.equal(f.first().calls.some(row=>row[0]==='release'),false);
 f.first().releaseGate=deferred();const stopping=f.controller.stopSource(f.selection.kind,f.selection.name);assert.throws(()=>f.controller.assertSourceReleased(f.selection.kind,f.selection.name),/PLAYBACK_IN_USE/);
 f.first().releaseGate.resolve();await stopping;f.controller.assertSourceReleased(f.selection.kind,f.selection.name);assert.equal(f.controller.snapshot().phase,'idle');await assert.rejects(()=>f.controller.resume(s.session_id),/PLAYBACK_UNAVAILABLE/);
});
test('source cannot auto-start after change during prepare and SDK errors remain sanitized',async()=>{
 const f=fixture(),create=f.ports.create,gate=deferred();f.ports.create=()=>{const d=create();d.prepareGate=gate;return d;};const result=f.controller.play(f.selection),rejection=assert.rejects(result,/PLAYBACK_SOURCE_CHANGED/);
 f.setValid(false);gate.resolve();await rejection;await turn();assert.equal(f.first().calls.some(row=>row[0]==='play'),false);assert.equal(f.leases[0].closed,1);
 const g=fixture(),s=await g.controller.play(g.selection);g.first().emit({kind:'error',error:'private C:/secret.opus'});await turn();assert.equal(g.controller.snapshot().error,'PLAYBACK_PLAYER_FAILED');assert(!JSON.stringify(g.controller.snapshot()).includes('secret'));assert.equal(g.leases[0].closed,1);
});
test('PAUSE during pending play cancels that continuation and only a later explicit resume can play again',async()=>{
 const f=fixture(),create=f.ports.create,gate=deferred();f.ports.create=()=>{const d=create();d.playGate=gate;return d;};
 const starting=f.controller.play(f.selection),rejected=assert.rejects(starting,/PLAYBACK_STALE_SESSION/);await turn();const id=f.controller.snapshot().session_id;
 f.first().emit({kind:'interrupt_pause',native_state:'playing',position_ms:2500});await turn();assert.equal(f.controller.snapshot().phase,'paused');
 gate.resolve();await rejected;await turn();assert.equal(f.controller.snapshot().phase,'paused');assert.equal(f.controller.snapshot().native_state,'paused');assert.equal(f.first().calls.filter(row=>row[0]==='play').length,1);assert.equal(f.leases[0].closed,0);
 await f.controller.resume(id);assert.equal(f.first().calls.filter(row=>row[0]==='play').length,2);assert.equal(f.controller.snapshot().session_id,id);await f.controller.stop(id);
});
test('stop preempts a pending seek and its later completion cannot resume released playback',async()=>{
 const f=fixture(),s=await f.controller.play(f.selection);f.first().seekGate=deferred();const seeking=f.controller.seek(s.session_id,5000),rejected=assert.rejects(seeking,/PLAYBACK_STALE_SESSION/);
 await f.controller.stop(s.session_id);f.first().seekGate.resolve();await rejected;assert.equal(f.controller.snapshot().phase,'idle');assert.equal(f.first().calls.filter(row=>row[0]==='play').length,1);assert.equal(f.leases[0].closed,1);
});
