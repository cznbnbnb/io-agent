import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

// The production adapter runs against explicit MediaKit/AudioKit substitutes.
// No codec, sound route, device or audible-output acceptance is implied.
const turn=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(options={}){
 let timer=0;const timers=new Map(),events=[],calls=[],listeners=new Map(),player={state:'idle',currentTime:-1,duration:-1};
 const globals={setTimeout(fn,ms){timers.set(++timer,{fn,ms});return timer;},clearTimeout(id){timers.delete(id);},setInterval(fn,ms){timers.set(++timer,{fn,ms,repeat:true});return timer;},clearInterval(id){timers.delete(id);}};
 const emit=(type,...args)=>{listeners.get(type)?.(...args);},state=value=>{player.state=value;emit('stateChange',value,1);};
 Object.defineProperties(player,{fdSrc:{set(value){calls.push(['fdSrc',value]);if(options.fdThrow)throw Error('raw-private-path');if(options.autoInit!==false)state('initialized');}},
  audioRendererInfo:{set(value){assert.equal(player.state,'initialized');calls.push(['renderer',value]);}},audioInterruptMode:{set(value){assert.equal(player.state,'prepared');calls.push(['mode',value]);}}});
 Object.assign(player,{on(type,callback){calls.push(['on',type]);listeners.set(type,callback);},off(type,callback){assert.equal(listeners.get(type),callback);listeners.delete(type);calls.push(['off',type]);},
  prepare(){calls.push(['prepare']);const done=()=>{player.duration=options.duration??60000;player.currentTime=0;state('prepared');};if(options.prepareGate)return options.prepareGate.promise.then(done);done();return Promise.resolve();},
  play(){calls.push(['play']);state('playing');return options.playGate?.promise??Promise.resolve();},
  pause(){calls.push(['pause']);state('paused');return Promise.resolve();},
  seek(value){calls.push(['seek',value]);if(options.seekThrow)throw Error('raw seek file path');if(options.autoSeek!==false){player.currentTime=Math.max(0,value-5);emit('seekDone',value);}},
  release(){calls.push(['release']);if(options.releaseFailure)return Promise.reject(Error('raw private release error'));const done=()=>state('released');if(options.releaseGate)return options.releaseGate.promise.then(done);done();return Promise.resolve();}});
 const audio={StreamUsage:{STREAM_USAGE_MUSIC:1},InterruptMode:{INDEPENDENT_MODE:1},InterruptType:{INTERRUPT_TYPE_BEGIN:1,INTERRUPT_TYPE_END:2},
  InterruptHint:{INTERRUPT_HINT_PAUSE:2,INTERRUPT_HINT_STOP:3,INTERRUPT_HINT_RESUME:1},AudioStreamDeviceChangeReason:{REASON_OLD_DEVICE_UNAVAILABLE:2}};
 const platform={'@kit.MediaKit':{media:{createAVPlayer(){calls.push(['create']);return options.createGate?options.createGate.promise:Promise.resolve(player);}}},
  '@kit.AudioKit':{audio},'@kit.ArkTS':{util:{generateRandomUUID:()=> 'a'.repeat(32)}}};
 const {createNativePlaybackDriver}=loadApp('NativePlaybackDriver',platform,globals),driver=createNativePlaybackDriver();
 const lease={reference:{kind:'recording',name:'take-'+'a'.repeat(32),audio_sha256:'b'.repeat(64),format:'wav',revision:0,utterance_id:''},fd:88,length:1024,start_ms:0,check(){},close(){calls.push(['close']);}};
 return{driver,lease,events,calls,listeners,player,emit,state,options,audio,platform,globals,createNativePlaybackDriver,
  prepare:()=>driver.prepare(lease,event=>events.push(JSON.parse(JSON.stringify(event)))),fire(){for(const [id,value]of[...timers]){if(!value.repeat)timers.delete(id);value.fn();}},timers};
}
test('native construction is lazy; prepare uses initialized renderer/prepared interrupt configuration and owned descriptor',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);await f.prepare();assert.equal(f.player.state,'prepared');
 assert.deepEqual(f.calls.filter(row=>['fdSrc','renderer','prepare','mode'].includes(row[0])).map(row=>row[0]),['fdSrc','renderer','prepare','mode']);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(row=>row[0]==='fdSrc')[1])),{fd:88,offset:0,length:1024});assert.equal(f.events.at(-1).duration_ms,60000);
 await f.driver.play();await f.driver.pause();await f.driver.release();assert.equal(f.listeners.size,0);assert.equal(f.calls.some(row=>row[0]==='close'),false);assert.equal(f.timers.size,0);
});
test('prepare waits for initialized and does not auto-play',async()=>{
 const f=fixture({autoInit:false});let done=false;const pending=f.prepare().then(()=>done=true);await turn();assert.equal(done,false);assert.equal(f.calls.some(row=>row[0]==='prepare'),false);
 f.state('initialized');await pending;assert.equal(f.calls.some(row=>row[0]==='play'),false);await f.driver.release();
});
test('synchronous seekDone is safe, reports actual currentTime instead of callback request and respects media bounds',async()=>{
 const f=fixture();await f.prepare();await f.driver.seek(15000);const event=f.events.find(row=>row.kind==='seek_done');assert.equal(event.position_ms,14995);
 for(const value of[-1,1.2,60001,86400001,NaN])await assert.rejects(()=>f.driver.seek(value),/PLAYBACK_INVALID/);
 assert.equal(f.calls.filter(row=>row[0]==='seek').length,1);await f.driver.release();
});
test('timeUpdate is an observed callback, cannot finish seek; mismatched seekDone does not claim current operation',async()=>{
 const f=fixture({autoSeek:false});await f.prepare();let done=false;const pending=f.driver.seek(10000).then(()=>done=true);await turn();
 f.player.currentTime=100;f.emit('timeUpdate',1234);assert.equal(f.events.at(-1).position_ms,1234);await turn();assert.equal(done,false);
 f.emit('seekDone',9000);await turn();assert.equal(done,false);await assert.rejects(()=>f.driver.seek(11000),/PLAYBACK_BUSY/);
 f.player.currentTime=9991;f.emit('seekDone',10000);await pending;assert.equal(f.events.at(-1).position_ms,9991);await f.driver.release();
});
test('seek timeout retires instance; a late old completion cannot authorize another seek or play',async()=>{
 const f=fixture({autoSeek:false});await f.prepare();const pending=f.driver.seek(1000),rejection=assert.rejects(pending,/PLAYBACK_PLAYER_FAILED/);f.fire();await rejection;
 f.player.currentTime=995;f.emit('seekDone',1000);await assert.rejects(()=>f.driver.seek(1000),/PLAYBACK_PLAYER_FAILED/);await assert.rejects(()=>f.driver.play(),/PLAYBACK_PLAYER_FAILED/);
 assert.equal(f.calls.filter(row=>row[0]==='seek').length,1);await f.driver.release();
});
test('pause handles a system-paused instance without an invalid second native pause',async()=>{
 const f=fixture();await f.prepare();await f.driver.play();f.state('paused');await f.driver.pause();assert.equal(f.calls.some(row=>row[0]==='pause'),false);await f.driver.release();
});
test('interrupt BEGIN maps pause/stop and output loss; END/RESUME never starts playback or changes volume/route',async()=>{
 const f=fixture();await f.prepare();await f.driver.play();f.emit('audioInterrupt',{eventType:1,forceType:0,hintType:2});assert.equal(f.events.at(-1).kind,'interrupt_pause');
 f.emit('audioInterrupt',{eventType:1,forceType:1,hintType:3});assert.equal(f.events.at(-1).kind,'interrupt_stop');const count=f.events.length;
 f.emit('audioInterrupt',{eventType:2,forceType:0,hintType:1});assert.equal(f.events.length,count);assert.equal(f.calls.filter(row=>row[0]==='play').length,1);
 f.emit('audioOutputDeviceChangeWithInfo',{changeReason:2,devices:[]});assert.equal(f.events.at(-1).kind,'output_lost');await f.driver.release();
});
test('creation cancelled before it resolves is released without assigning source or starting audio',async()=>{
 const gate=deferred(),f=fixture({createGate:gate});const preparing=f.prepare(),rejected=assert.rejects(preparing,/PLAYBACK_PLAYER_FAILED/);const releasing=f.driver.release();
 gate.resolve(f.player);await releasing;await rejected;assert.equal(f.calls.some(row=>row[0]==='fdSrc'),false);assert.equal(f.calls.some(row=>row[0]==='play'),false);assert.equal(f.listeners.size,0);
});
test('creation timeout keeps pending ownership until late create and release complete',async()=>{
 const gate=deferred(),f=fixture({createGate:gate});const preparing=f.prepare(),rejected=assert.rejects(preparing,/PLAYBACK_PLAYER_FAILED/);f.fire();await rejected;
 const releasing=f.driver.release();gate.resolve(f.player);await releasing;assert.equal(f.calls.filter(row=>row[0]==='release').length,1);assert.equal(f.calls.some(row=>row[0]==='fdSrc'),false);assert.equal(f.events.at(-1).kind,'release_done');
});
test('release timeout is not success; late positive native completion emits cleanup evidence exactly once',async()=>{
 const gate=deferred(),f=fixture({releaseGate:gate});await f.prepare();const releasing=f.driver.release(),rejected=assert.rejects(releasing,/PLAYBACK_CLEANUP_PENDING/);await turn();f.fire();await rejected;
 assert.equal(f.events.some(row=>row.kind==='release_done'),false);gate.resolve();await turn();assert.equal(f.events.filter(row=>row.kind==='release_done').length,1);assert.equal(f.listeners.size,0);await f.driver.release();assert.equal(f.calls.filter(row=>row[0]==='release').length,1);
});
test('failed release can retry the same instance and no native error payload is exposed',async()=>{
 const f=fixture({releaseFailure:true});await f.prepare();await assert.rejects(()=>f.driver.release(),/PLAYBACK_CLEANUP_PENDING/);assert.equal(f.events.some(row=>row.kind==='release_done'),false);
 f.options.releaseFailure=false;await f.driver.release();assert.equal(f.calls.filter(row=>row[0]==='create').length,1);assert.equal(f.calls.filter(row=>row[0]==='release').length,2);assert(!JSON.stringify(f.events).includes('private'));
});
test('SDK error rejects outstanding operations and release still works; setter/seek sync exceptions do not escape raw details',async()=>{
 const f=fixture({autoSeek:false});await f.prepare();const seeking=f.driver.seek(1000),rejected=assert.rejects(seeking,/PLAYBACK_PLAYER_FAILED/);f.emit('error',{code:123,message:'C:/private.opus'});await rejected;assert.equal(f.events.at(-1).error,'PLAYBACK_PLAYER_FAILED');await f.driver.release();
 const g=fixture({fdThrow:true});await assert.rejects(()=>g.prepare(),/PLAYBACK_PLAYER_FAILED/);await g.driver.release();
 const h=fixture({seekThrow:true});await h.prepare();await assert.rejects(()=>h.driver.seek(100),/PLAYBACK_PLAYER_FAILED/);await h.driver.release();
});
test('real controller and real native adapter keep release-before-close even across a create-cancel race',async()=>{
 const gate=deferred(),f=fixture({createGate:gate});const {PlaybackController}=loadApp('PlaybackController',f.platform,f.globals);let closed=0;
 f.lease.close=()=>{closed++;assert.equal(f.player.state,'released');};const controller=new PlaybackController({resolve:()=>f.lease,create:f.createNativePlaybackDriver,foreground:()=>true});
 const playing=controller.play({kind:'recording',name:f.lease.reference.name,revision:0,utterance_id:''}),rejected=assert.rejects(playing,/PLAYBACK_PLAYER_FAILED|PLAYBACK_STALE_SESSION/);
 const stopping=controller.stop(controller.snapshot().session_id);await turn();assert.equal(closed,0);gate.resolve(f.player);await stopping;await rejected;assert.equal(closed,1);assert.equal(controller.snapshot().audio_output_verified,false);assert.equal(f.calls.some(row=>row[0]==='play'),false);
});
