import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
test('stopping an already inactive task does not call native stop or replace useful state with 9800005',async()=>{
 const t=setup();await t.b.stop();assert.equal(t.stops(),0);await t.b.start({});await t.b.stop();const count=t.stops();await t.b.stop();assert.equal(t.stops(),count);
});
function setup(){const handlers=new Map();let target;let starts=0,stops=0,resolveStart,fail=false,delay=false;
 const manager={BackgroundMode:{BLUETOOTH_INTERACTION:5},on:(type,cb)=>handlers.set(type,cb),off:type=>handlers.delete(type),
  async startBackgroundRunning(ctx,mode){assert.equal(mode,5);starts++;if(fail)throw {code:9800005};if(delay)await new Promise(r=>resolveStart=r);},
  async stopBackgroundRunning(){stops++;}};
 const agent={OperationType:{START_ABILITY:1},WantAgentFlags:{UPDATE_PRESENT_FLAG:1},
  async getWantAgent(info){target=info.wants[0].abilityName;assert.equal(info.wants[0].bundleName,'org.turboio.harmony.research');return {};}};
 const {BluetoothBackground}=loadApp('BluetoothBackground',{'@kit.AbilityKit':{wantAgent:agent},'@kit.BackgroundTasksKit':{backgroundTaskManager:manager},'@kit.BasicServicesKit':{}});
 return {b:new BluetoothBackground(),handlers,target:()=>target,starts:()=>starts,stops:()=>stops,delay:()=>delay=true,fail:()=>fail=true,release:()=>resolveStart()};
}
test('background active only after native grant; duplicate enable does not create second task',async()=>{
 const t=setup();t.delay();const p=t.b.start({});await flush();assert.equal(t.b.active,false);assert.equal(t.b.pending,true);
 t.b.start({});assert.equal(t.starts(),1);t.release();await p;assert.equal(t.b.active,true);assert.equal(t.b.pending,false);
 await t.b.stop();assert.equal(t.b.active,false);assert.equal(t.handlers.size,0);assert(t.stops()>0);
});
test('permission/task denial never enables background and reports numeric code only',async()=>{
 const t=setup();t.fail();await t.b.start({});assert.equal(t.b.active,false);assert.match(t.b.note,/9800005/);assert.equal(t.handlers.size,0);
});
test('turning off during native start cancels late grant and cleans listeners',async()=>{
 const t=setup();t.delay();const p=t.b.start({});await flush();const stop=t.b.stop();t.release();await p;await stop;
 assert.equal(t.b.active,false);assert.equal(t.b.pending,false);assert.equal(t.handlers.size,0);assert(t.stops()>0);
});
test('system cancellation and suspension revoke local active state',async()=>{
 for(const event of ['continuousTaskCancel','continuousTaskSuspend']){
  const t=setup();let revoked=0;t.b.revoked=()=>revoked++;await t.b.start({});
  t.handlers.get(event)({});await flush();assert.equal(t.b.active,false);assert.equal(revoked,1);assert.equal(t.handlers.size,0);
 }
});

test('lab background notification targets the isolated ability; invalid target opens nothing',async()=>{
 const t=setup();t.b.targetAbility='SuggestionLabAbility';await t.b.start({});assert.equal(t.target(),'SuggestionLabAbility');await t.b.stop();
 t.b.targetAbility='OtherAbility';await assert.rejects(t.b.start({}),/target-invalid/);assert.equal(t.starts(),1);
});
test('requesting Ability context takes precedence over an earlier lab target in the shared process',async()=>{
 const t=setup();t.b.targetAbility='SuggestionLabAbility';await t.b.start({abilityInfo:{name:'EntryAbility'}});assert.equal(t.target(),'EntryAbility');await t.b.stop();
 await t.b.start({abilityInfo:{name:'SuggestionLabAbility'}});assert.equal(t.target(),'SuggestionLabAbility');await t.b.stop();
});

test('daily coordinator experiment uses its registered Ability for the real background task request',async()=>{
 const t=setup();await t.b.start({abilityInfo:{name:'DailyLabAbility'}});
 assert.equal(t.target(),'DailyLabAbility');assert.equal(t.starts(),1);assert.equal(t.b.active,true);
 await t.b.stop();assert.equal(t.b.active,false);
});
