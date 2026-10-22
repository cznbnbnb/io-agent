import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';import {loadCore} from './load-core.mjs';
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');const peer='aabbccddeeff';
function setup(store={raw:'',fail:false}){const sent=[],timers=new Map();let id=0,occupied=false,reject=false,callback,currentPeer=peer;
 const {NotificationSession}=loadApp('NotificationSession',{'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(7)})})}}},{setTimeout:(f,ms)=>{timers.set(++id,{f,ms});return id;},clearTimeout:id=>timers.delete(id)});
 const session=new NotificationSession(async(b,p)=>{if(reject)throw Error('busy');const e=readLauncherEnvelope(p);sent.push({b,type:e.type,json:JSON.parse(new TextDecoder().decode(e.json)),length:p.length});if(callback)callback(e.type);},()=>currentPeer,()=>!occupied);
 session.initialize({load:()=>store.raw,save:json=>{if(store.fail)throw Error('synthetic storage failure');store.raw=json;}});
 const receive=(type,j,from=peer)=>session.receive(from,businessEnvelope(type,new TextEncoder().encode(JSON.stringify(j))));return {session,sent,timers,receive,store,changePeer:v=>currentPeer=v,occupy:()=>occupied=true,fail:()=>reject=true,onSend:f=>callback=f};
}
test('manual notification requires explicit master; does not replace source or timing settings',async()=>{const s=setup();await assert.rejects(s.session.notify('a','b'));await s.session.setEnabled(true);assert.equal(s.sent[0].b,21);assert.equal(s.sent[0].type,18);assert.deepEqual(s.sent[0].json,{notification:true});await s.session.notify('通知测试','合成内容5826');const p=s.sent[1];assert.equal(p.type,2);assert.equal(p.json.appId,'org.turboio.harmony.research');assert.equal(p.json.reply,false);assert(/^[1-9][0-9]*$/.test(p.json.notificationUID));assert(/T\d{2}:\d{2}:\d{2}\.\d{3}$/.test(p.json.timestamp));assert(s.session.waiting);});
test('only same UID and peer status settle pending; ACK never releases display ownership',async()=>{const s=setup();await s.session.setEnabled(true);s.onSend(type=>{if(type===2)s.receive(3,{notificationUID:s.session.uid,state:1});});await s.session.notify('a','b');assert(!s.session.waiting);assert.match(s.session.note,/同 UID 回报/);assert(s.session.occupied);await assert.rejects(s.session.notify('a','b'));s.session.confirmDismissed(s.session.pendingUid);s.onSend(()=>{});await s.session.notify('a','b');s.receive(3,{notificationUID:'wrong',state:1});s.receive(3,{notificationUID:s.session.uid,state:1},'other');assert(s.session.waiting);s.receive(3,{notificationUID:s.session.uid,state:3});assert(!s.session.waiting);assert.match(s.session.note,/勿扰/);assert(s.session.occupied);});
test('timeout never retries and disconnect resets local grant',async()=>{const s=setup();await s.session.setEnabled(true);await s.session.notify('a','b');[...s.timers.values()][0].f();assert.equal(s.sent.length,2);assert(!s.session.waiting);s.session.disconnected();assert(!s.session.enabled);await assert.rejects(s.session.notify('a','b'));});
test('private ANCS, malformed frames and operation callbacks never trigger tools or additional sends',async()=>{const s=setup();await s.session.setEnabled(true);await s.session.notify('a','b');const n=s.sent.length;s.receive(1,{content:'not retained'});s.session.receive(peer,Uint8Array.of(255));s.receive(4,{notificationUID:s.session.uid,cmd:9});assert.equal(s.sent.length,n);assert(!s.session.note.includes('not retained'));s.receive(18,{notification:false});assert(!s.session.enabled);});
test('content bounds fit negotiated 512 MTU; occupied and failed calls do not claim success',async()=>{const s=setup();await s.session.setEnabled(true);await s.session.notify('题'.repeat(16),'文'.repeat(48));assert(s.sent.at(-1).length+10<=509);s.session.disconnected();s.session.confirmDismissed(s.session.pendingUid);await s.session.setEnabled(true);s.occupy();await assert.rejects(s.session.notify('a','b'));const f=setup();f.fail();await assert.rejects(f.session.setEnabled(true));assert(!f.session.enabled);});

test('the 8-second receipt deadline preserves the two-minute display owner through disconnect and cold restart without replay',async()=>{
 const s=setup();await s.session.setDisplaySeconds(120);await s.session.setEnabled(true);await s.session.notify('a','b');
 const uid=s.session.pendingUid;[...s.timers.values()][0].f();assert(!s.session.waiting);assert(s.session.occupied);
 const metadata=JSON.parse(s.store.raw);assert.deepEqual(Object.keys(metadata).sort(),['peer','schema','uid']);assert.equal(metadata.uid,uid);assert(!s.store.raw.includes('content'));
 s.session.disconnected();assert(s.session.occupied);assert.equal(s.session.pendingUid,uid);
 const restart=setup(s.store);assert(restart.session.occupied);assert.equal(restart.session.pendingUid,uid);assert.equal(restart.sent.length,0);assert.equal(restart.timers.size,0);
 await assert.rejects(restart.session.setDisplaySeconds(5));await assert.rejects(restart.session.setEnabled(true));assert.equal(restart.sent.length,0);
 restart.changePeer('different');assert.throws(()=>restart.session.confirmDismissed(uid));restart.changePeer(peer);
 assert.throws(()=>restart.session.confirmDismissed('old-uid'));restart.session.confirmDismissed(uid);assert(!restart.session.occupied);assert.equal(restart.sent.length,0);
 assert.equal(setup(s.store).session.occupied,false);
});

test('an ambiguous notification write and malformed or mismatched callbacks cannot erase durable ownership',async()=>{
 const s=setup();await s.session.setEnabled(true);s.fail();await assert.rejects(s.session.notify('a','b'));const uid=s.session.pendingUid;
 assert(s.session.occupied);s.receive(3,{notificationUID:'old-uid',state:0});s.receive(4,{notificationUID:uid,cmd:1});assert(s.session.occupied);
 s.session.receive(peer,Uint8Array.of(255));assert(s.session.occupied);assert.equal(setup(s.store).session.pendingUid,uid);
});

test('durable intent failure prevents sending, and failed clear or corrupt restart cannot release the owner',async()=>{
 const s=setup();await s.session.setEnabled(true);s.store.fail=true;await assert.rejects(s.session.notify('a','b'));assert.equal(s.sent.length,1);assert(s.session.occupied);
 const live=setup();await live.session.setEnabled(true);await live.session.notify('a','b');live.store.fail=true;
 assert.throws(()=>live.session.confirmDismissed(live.session.pendingUid));assert(live.session.occupied);
 for(const raw of ['{bad',JSON.stringify({schema:1,uid:'2',peer:''}),JSON.stringify({schema:1,uid:'2',peer,extra:'unknown'})]){
  const broken=setup({raw,fail:false});assert(broken.session.occupied);await assert.rejects(broken.session.setEnabled(true));assert.equal(broken.sent.length,0);
 }
});

test('duration changes only the ordinary-notification partial setting; it is not a suggestion TTL or device readback',async()=>{
 const s=setup();await s.session.setDisplaySeconds(120);
 assert.equal(s.sent.length,1);assert.equal(s.sent[0].b,21);assert.equal(s.sent[0].type,18);
 assert.deepEqual(s.sent[0].json,{displayTime:120});assert.equal(s.session.enabled,false);
 assert.equal(s.session.timingSeconds,120);assert.equal(s.session.timingSubmission,'submitted');
 assert.match(s.session.note,/设备原值未读回/);assert.equal(s.timers.size,0);
});

test('unsupported durations and occupied channels cannot overwrite settings; ambiguous writes are not automatically retried',async()=>{
 for(const value of [0,7,119,121,256,5.5,'120']){const s=setup();await assert.rejects(s.session.setDisplaySeconds(value));assert.equal(s.sent.length,0);}
 const busy=setup();busy.occupy();await assert.rejects(busy.session.setDisplaySeconds(30));assert.equal(busy.sent.length,0);
 const failed=setup();failed.fail();await assert.rejects(failed.session.setDisplaySeconds(120));
 assert.equal(failed.session.timingSeconds,120);assert.equal(failed.session.timingSubmission,'uncertain');assert.equal(failed.timers.size,0);
});

test('a disconnect during the timing write cannot label the new connection as configured or replay old settings',async()=>{
 const s=setup();s.onSend(()=>s.session.disconnected());await assert.rejects(s.session.setDisplaySeconds(120));
 assert.equal(s.sent.length,1);assert.equal(s.session.timingSeconds,-1);assert.equal(s.session.timingSubmission,'none');assert.equal(s.session.busy,false);
});
