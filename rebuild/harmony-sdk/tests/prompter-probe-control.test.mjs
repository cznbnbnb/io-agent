import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const {PrompterProbeControl,PrompterProbeSnapshot}=loadApp('PrompterProbeControl');
function setup(){
 const files=new Map(),view=new PrompterProbeSnapshot();Object.assign(view,{active:true,connected:true,can_stop:true,phase:'paused',binding:'a'.repeat(64)});
 let stops=0,now=1000,writeFailure='',stopResult=true,onStop,viewHook,capacityFailure=false;
 const ports={now:()=>now,read:k=>files.get(k),write:(k,v)=>{if(k===writeFailure)throw Error('disk');files.set(k,v);},capacity:()=>{if(capacityFailure)throw Error('full');},view:()=>{if(viewHook)viewHook();return {...view};},stop:async()=>{stops++;if(onStop)await onStop();if(stopResult){view.active=false;view.can_stop=false;view.phase='idle';view.binding='';view.exit_evidence='device_event';}return stopResult;}};
 const control=new PrompterProbeControl(ports);
 const put=(action='status',extra={},id='1')=>{const c={schema:1,id:'prm-'+id.repeat(32),action,expires_at:now+10000,...extra};files.set(action==='stop'?'prompter-stop.json':'prompter-command.json',JSON.stringify(c));return c;};
 return{control,files,view,put,stops:()=>stops,setNow:v=>now=v,failWrite:k=>writeFailure=k,setResult:v=>stopResult=v,onStop:f=>onStop=f,viewHook:f=>viewHook=f,capacityFail:()=>capacityFailure=true,result:c=>JSON.parse(files.get(c.id+'.json'))};
}
test('status observes existing owner without hardware calls and snapshots change only on state changes',async()=>{
 const s=setup(),c=s.put();await s.control.poll();const r=s.result(c);assert.equal(r.state,'complete');assert.equal(r.snapshot.phase,'paused');assert.equal(r.lens_verified,false);assert.equal(s.stops(),0);
 await s.control.poll();assert.equal(s.result(c).state,'complete');assert.equal(s.stops(),0);
 assert(!JSON.stringify(r).includes('manuscript'));assert(!JSON.stringify(r).includes('peer'));
});
test('one exact-owner stop waits for exit and replay cannot stop again',async()=>{
 const s=setup(),c=s.put('stop',{expected_binding:s.view.binding});await s.control.poll();assert.equal(s.stops(),1);assert.equal(s.result(c).exit_wait_confirmed,true);assert.equal(s.result(c).snapshot.exit_evidence,'device_event');
 await s.control.poll();assert.equal(s.stops(),1);
});
test('expired, foreign owner, disconnected and already-closing requests never send stop',async()=>{
 for(const kind of ['expired','foreign','disconnected','closing']){
  const s=setup(),c=s.put('stop',{expected_binding:kind==='foreign'?'b'.repeat(64):s.view.binding});
  if(kind==='expired')s.setNow(c.expires_at);if(kind==='disconnected')s.view.connected=false;if(kind==='closing')s.view.can_stop=false;
  await s.control.poll();assert.equal(s.stops(),0);assert.equal(s.result(c).state,'error');assert.equal(s.view.active,true);
 }
});
test('binding change at final view prevents stopping a new owner',async()=>{
 const s=setup(),c=s.put('stop',{expected_binding:s.view.binding});let count=0;s.viewHook(()=>{if(++count===3)s.view.binding='c'.repeat(64);});
 await s.control.poll();assert.equal(s.stops(),0);assert.equal(s.result(c).error,'PROMPTER_OWNER_CHANGED');
});
test('false exit is uncertain and retains the active owner',async()=>{
 const s=setup();s.setResult(false);const c=s.put('stop',{expected_binding:s.view.binding});await s.control.poll();assert.equal(s.result(c).state,'uncertain');assert.equal(s.result(c).exit_wait_confirmed,false);assert(s.result(c).snapshot.active);
});
test('restarted running intent is reconciled as uncertain without hardware replay',async()=>{
 const s=setup(),c=s.put('stop',{expected_binding:s.view.binding});s.files.set(c.id+'.json',JSON.stringify({schema:1,id:c.id,request_json:JSON.stringify(c),state:'running'}));
 await s.control.poll();assert.equal(s.result(c).error,'INTERRUPTED_NO_REPLAY');assert.equal(s.stops(),0);
});
test('same ID with changed command keeps the original receipt',async()=>{
 const s=setup(),c=s.put();await s.control.poll();const before=s.files.get(c.id+'.json');s.put('stop',{expected_binding:s.view.binding});await s.control.poll();assert.equal(s.files.get(c.id+'.json'),before);assert.equal(s.stops(),0);
});
test('failed intent persistence or receipt capacity prevents hardware mutation',async()=>{
 for(const kind of ['write','capacity']){const s=setup(),c=s.put('stop',{expected_binding:s.view.binding});if(kind==='write')s.failWrite(c.id+'.json');else s.capacityFail();await assert.rejects(s.control.poll());assert.equal(s.stops(),0);}
});
test('unknown actions, arbitrary text and malformed binding are rejected',async()=>{
 for(const [action,extra] of [['start',{}],['status',{text:'private'}],['stop',{expected_binding:'wrong'}]]){const s=setup(),c=s.put(action,extra);await s.control.poll();assert.equal(s.files.has(c.id+'.json'),false);assert.equal(s.stops(),0);}
});
test('concurrent polls and disposal cannot replay or claim a pending stop succeeded',async()=>{
 const s=setup();let release;s.onStop(()=>new Promise(r=>release=r));const c=s.put('stop',{expected_binding:s.view.binding});const p=s.control.poll();await Promise.resolve();await s.control.poll();assert.equal(s.stops(),1);s.control.dispose();release();await p;
 assert.equal(s.result(c).state,'running');await s.control.poll();assert.equal(s.stops(),1);
});
test('separate stop inbox wins over status and completed stop does not starve later observation',async()=>{
 const s=setup(),stop=s.put('stop',{expected_binding:s.view.binding}),status=s.put('status',{},'2');
 await s.control.poll();assert.equal(s.stops(),1);assert.equal(s.result(stop).state,'complete');assert.equal(s.files.has(status.id+'.json'),false);
 await s.control.poll();assert.equal(s.result(status).state,'complete');assert.equal(s.result(status).snapshot.active,false);assert.equal(s.stops(),1);
});
test('invalid stop inbox and a stop in the status inbox cannot invoke hardware',async()=>{
 const s=setup(),c=s.put();s.files.set('prompter-stop.json','{broken');await s.control.poll();assert.equal(s.result(c).state,'complete');
 const stop=s.put('stop',{expected_binding:s.view.binding},'3');const raw=s.files.get('prompter-stop.json');s.files.delete('prompter-stop.json');s.files.set('prompter-command.json',raw);
 await s.control.poll();assert.equal(s.files.has(stop.id+'.json'),false);assert.equal(s.stops(),0);
});
