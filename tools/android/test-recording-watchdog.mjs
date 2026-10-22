import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {runRecordingWatchdog,safeRecordingStatus,recordingRequest} from './recording-watchdog.mjs';

const id='0123456789abcdef0123456789abcdef';let checks=0;
function yes(v){checks++;assert.ok(v);}
async function server(handler,body){const s=net.createServer(socket=>{let data='';socket.on('error',()=>{});socket.on('data',chunk=>{data+=chunk;if(!data.includes('\n'))return;try{handler(socket,JSON.parse(data.split('\n')[0]));}catch{socket.destroy();}});});await new Promise(r=>s.listen(0,'127.0.0.1',r));try{await body(s.address().port);}finally{await new Promise(r=>s.close(r));}}
const status=(mode,extra={})=>({schema:1,probe_id:id,mode,phase:'PREFLIGHT_READY',armed:false,safe_to_disarm:false,recording_released:false,...extra});
const full=status('capture',{armed:true,safe_to_disarm:true,stop_accepted:true,device_idle_verified:true,coordinator_released:true,native_released:true,recording_released:true,native_start_attempted:true,native_stopped_verified:true});
yes(safeRecordingStatus(full,id,'capture'));
for(const k of ['safe_to_disarm','stop_accepted','device_idle_verified','coordinator_released','native_released','recording_released','native_stopped_verified'])yes(!safeRecordingStatus({...full,[k]:false},id,'capture'));
yes(!safeRecordingStatus({...full,probe_id:'f'.repeat(32)},id,'capture'));
yes(!safeRecordingStatus({...full,armed:'false'},id,'capture'));
yes(!safeRecordingStatus(full,id,'preflight'));
// The separate deadline sends stop while the regular status request is still
// hung; no model, audio player, TTS or parent action drives this stop.
let stopped=false,ops=[];
await server((s,c)=>{ops.push(c.op);if(c.op==='ping')s.end(JSON.stringify(status('capture',{armed:true,phase:'AWAITING_AUDIO'}))+'\n');else if(c.op==='stop'){stopped=true;s.end(JSON.stringify(full)+'\n');}else if(stopped)s.end(JSON.stringify(full)+'\n');},async port=>{
 const events=[];const r=await runRecordingWatchdog({port,probeId:id,mode:'capture',deadlineMs:100,pollMs:5,onEvent:e=>events.push(e.event)});
 yes(r.disarmed&&r.deadline_fired&&stopped);yes(ops.includes('stop'));yes(events.indexOf('armed')<events.indexOf('deadline_reached'));yes(events.includes('safe_disarmed'));
});
// A preflight stop proves dispatch, never pretends there was a live microphone.
stopped=false;
await server((s,c)=>{if(c.op==='stop')stopped=true;s.end(JSON.stringify(status('preflight',{safe_to_disarm:stopped,recording_released:stopped}))+'\n');},async port=>{
 const r=await runRecordingWatchdog({port,probeId:id,mode:'preflight',deadlineMs:500,pollMs:5});yes(r.disarmed&&!r.last.armed&&r.stop_requests===1);
});
// A stop receipt without fresh idle is insufficient; preserve unresolved duty.
await server((s,c)=>s.end(JSON.stringify({...full,device_idle_verified:false})+'\n'),async port=>{
 const abort=new AbortController();const events=[];setTimeout(()=>abort.abort(),150);
 const r=await runRecordingWatchdog({port,probeId:id,mode:'capture',deadlineMs:50,pollMs:5,signal:abort.signal,onEvent:e=>events.push(e.event)});
 yes(!r.disarmed&&r.state==='cancelled_unsafe');yes(!events.includes('safe_disarmed'));yes(r.stop_requests>0);
});
await server(s=>s.end(JSON.stringify({...full,probe_id:'f'.repeat(32)})+'\n'),async port=>{await assert.rejects(recordingRequest(port,id,'status'),/OWNER_INVALID/);checks++;});
await server(s=>s.end('x'.repeat(8200)+'\n'),async port=>{await assert.rejects(recordingRequest(port,id,'status'),/BUDGET/);checks++;});
// Real OS child: block this parent after the handshake. Its model/player lane
// cannot prevent the child's deadline event and exact-owner stop request.
await server((s,c)=>{if(c.op==='stop')stopped=true;s.end(JSON.stringify(stopped?full:status('capture',{armed:true,phase:'AWAITING_AUDIO'}))+'\n');},async port=>{
 stopped=false;const directory=path.resolve('rebuild/android-app/.private/recording-watchdog-test-'+crypto.randomUUID()),report=path.join(directory,'guard.json');const events=[];let blocked=false;
 const child=spawn(process.execPath,[path.resolve('tools/android/recording-watchdog.mjs'),JSON.stringify({port,probeId:id,mode:'capture',deadlineMs:100,report})],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 let errors='';child.stderr.on('data',b=>errors+=b);child.on('message',e=>{events.push(e);if(e.event==='armed'&&!blocked){blocked=true;const until=Date.now()+250;while(Date.now()<until){} }});
 const code=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('CHILD_GUARD_TIMEOUT'));},5000);child.once('exit',code=>{clearTimeout(timeout);resolve(code);});child.once('error',reject);});
 try{yes(code===0&&errors==='');yes(child.pid!==process.pid&&blocked);const fired=events.find(e=>e.event==='deadline_reached'),armed=events.find(e=>e.event==='armed');yes(fired&&fired.elapsed_ms-armed.elapsed_ms<220);const saved=JSON.parse(await fs.readFile(report,'utf8'));yes(saved.disarmed&&saved.deadline_fired&&saved.stop_requests>0);}finally{await fs.unlink(report).catch(()=>{});await fs.unlink(report+'.partial').catch(()=>{});await fs.rmdir(directory).catch(()=>{});}
});
// Real IPC teardown: reporting disappears after admission, while the guard's
// deadline and socket stop remain independently live.
await server((s,c)=>{if(c.op==='stop')stopped=true;s.end(JSON.stringify(stopped?full:status('capture',{armed:true,phase:'AWAITING_AUDIO'}))+'\n');},async port=>{
 stopped=false;const directory=path.resolve('rebuild/android-app/.private/recording-watchdog-test-'+crypto.randomUUID()),report=path.join(directory,'guard.json');let disconnected=false;
 const child=spawn(process.execPath,[path.resolve('tools/android/recording-watchdog.mjs'),JSON.stringify({port,probeId:id,mode:'capture',deadlineMs:350,report})],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
 let errors='';child.stderr.on('data',b=>errors+=b);child.on('message',e=>{if(e.event==='armed'&&!disconnected){disconnected=true;child.disconnect();}});
 const code=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('DISCONNECTED_GUARD_TIMEOUT'));},5000);child.once('exit',code=>{clearTimeout(timeout);resolve(code);});child.once('error',reject);});
 try{yes(disconnected&&code===0&&errors==='');yes(stopped);const saved=JSON.parse(await fs.readFile(report,'utf8'));yes(saved.disarmed&&saved.deadline_fired&&saved.stop_requests>0);yes(saved.history.some(e=>e.event==='deadline_reached'));}finally{await fs.unlink(report).catch(()=>{});await fs.unlink(report+'.partial').catch(()=>{});await fs.rmdir(directory).catch(()=>{});}
});
// A short-lived intermediate parent starts the actual detached guard, then
// exits after its handshake. This test process only owns the fake endpoint and
// observes the final file; it does not drive the orphan guard's stop timer.
await server((s,c)=>{if(c.op==='stop')stopped=true;s.end(JSON.stringify(stopped?full:status('capture',{armed:true,phase:'AWAITING_AUDIO'}))+'\n');},async port=>{
 stopped=false;const directory=path.resolve('rebuild/android-app/.private/recording-watchdog-test-'+crypto.randomUUID()),report=path.join(directory,'guard.json');
 const launch=`const {spawn}=require('node:child_process');const cfg=JSON.parse(process.argv[1]);const child=spawn(process.execPath,[cfg.script,JSON.stringify(cfg.guard)],{detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});child.on('error',()=>process.exit(2));child.on('message',e=>{if(e.event==='armed'){process.stdout.write(JSON.stringify({guard_pid:child.pid,parent_pid:process.pid})+'\\n',()=>process.exit(0));}});setTimeout(()=>process.exit(3),3000);`;
 const parent=spawn(process.execPath,['-e',launch,JSON.stringify({script:path.resolve('tools/android/recording-watchdog.mjs'),guard:{port,probeId:id,mode:'capture',deadlineMs:700,report}})],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='',errors='';parent.stdout.on('data',b=>output+=b);parent.stderr.on('data',b=>errors+=b);
 const code=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{parent.kill();reject(Error('GUARD_PARENT_TIMEOUT'));},5000);parent.once('exit',code=>{clearTimeout(timeout);resolve(code);});parent.once('error',reject);});
 let saved=null;const until=Date.now()+5000;while(Date.now()<until){try{saved=JSON.parse(await fs.readFile(report,'utf8'));if(saved.disarmed)break;}catch{}await new Promise(r=>setTimeout(r,30));}
 try{yes(code===0&&errors==='');const ids=JSON.parse(output.trim());yes(Number.isInteger(ids.guard_pid)&&ids.guard_pid!==ids.parent_pid&&ids.parent_pid===parent.pid);yes(stopped);yes(saved?.disarmed===true&&saved.deadline_fired&&saved.stop_requests>0);yes(saved.history.some(e=>e.event==='deadline_reached'));}finally{await fs.unlink(report).catch(()=>{});await fs.unlink(report+'.partial').catch(()=>{});await fs.rmdir(directory).catch(()=>{});}
});
console.log(`Recording watchdog: ${checks} assertions passed; synthetic loopback endpoints only`);
