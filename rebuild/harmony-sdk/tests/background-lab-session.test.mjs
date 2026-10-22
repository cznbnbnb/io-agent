import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
function setup(preexisting=false){let stops=0,closed=0,writes=[],sends=[],health=0,timer=0;const callbacks=new Map();
 const probe={foreground:true,connection:{phase:'ready'},background:{active:preexisting,async start(){this.active=true;},async stop(){this.active=false;stops++;}},auth:{async sendBusiness(b,p){sends.push(b);}},stop(){this.connection.phase='idle';}};
 const fs={OpenMode:{CREATE:1,READ_WRITE:2,TRUNC:4},openSync:()=>({fd:1}),writeSync:(fd,data)=>writes.push(JSON.parse(data)),fsyncSync(){},closeSync(){}};
 class Engine{async healthcheck(){health++;}close(){closed++;}}
 const budget=loadApp('TranscriptionBudget');
 const read=async()=>({conditions:new budget.TranscriptionConditions(),thermalLevel:0,screenKnown:true,screenActive:false});
 const mod=loadApp('BackgroundLabSession',{'turbo_core':{GuestAuthProbeReport:class{statusReplies=0;rxBytes=0;},generalStatusQuery:()=>Uint8Array.of(8,1)},'@kit.AbilityKit':{},'@kit.CoreFileKit':{fileIo:fs},'@kit.NetworkKit':{http:{RequestMethod:{GET:1},createHttp:()=>({request:async()=>({responseCode:200,result:'p12-local-fixture:1'}),destroy(){}})}},'./ProbeSession':{probeSession:probe},'./AsrEngine':{AsrEngineClient:Engine},'./TranscriptionSignals':{readTranscriptionSignals:read},'./TranscriptionBudget':budget},
 {setInterval:fn=>{callbacks.set(++timer,fn);return timer;},setTimeout:fn=>{callbacks.set(++timer,fn);return timer;},clearInterval:id=>callbacks.delete(id),clearTimeout:id=>callbacks.delete(id),Date});
 return{lab:new mod.BackgroundLabSession(),probe,callbacks,writes,sends,stops:()=>stops,closed:()=>closed,health:()=>health};}
test('finite trial only sends read-only status, never saves preference, releases its own task and stops background link',async()=>{
 const t=setup();await t.lab.start({filesDir:'/isolated'});assert.deepEqual(t.sends,[15]);assert.equal(t.health(),1);assert.equal(t.writes[0].samples[0].network,'fixture_received');
 t.probe.foreground=false;await t.lab.stop('deadline');assert.equal(t.stops(),1);assert.equal(t.closed(),1);assert.equal(t.callbacks.size,0);assert.equal(t.probe.connection.phase,'idle');
 assert.equal(t.writes.at(-1).reason,'deadline');assert(t.writes.at(-1).completedAt>0);assert.equal(t.lab.active,false);
});
test('trial preserves a previously granted task and rejects background or disconnected starts',async()=>{
 const t=setup(true);await t.lab.start({filesDir:'/isolated'});await t.lab.stop();assert.equal(t.stops(),0);assert.equal(t.probe.background.active,true);
 t.probe.foreground=false;await t.lab.start({filesDir:'/isolated'});assert.equal(t.health(),1);
 t.probe.foreground=true;t.probe.connection.phase='failed';await t.lab.start({filesDir:'/isolated'});assert.equal(t.health(),1);
});
