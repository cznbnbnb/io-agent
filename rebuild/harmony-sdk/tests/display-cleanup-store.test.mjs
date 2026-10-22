import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setupMaterialStore} from './material-fixture.mjs';
import {loadApp} from './load-app.mjs';
const pending=JSON.stringify({schema:1,peer:'synthetic-original',sid:'a'.repeat(32),evidence:'none'});

function setup(t){
 const files=setupMaterialStore(t),{DisplayCleanupStore}=loadApp('DisplayCleanupStore',{'@kit.CoreFileKit':{fileIo:files.io}});
 const create=()=>{const store=new DisplayCleanupStore();store.initialize(files.root);return store;};return {...files,store:create(),create};
}
test('short writes are fully persisted and survive a fresh store instance',t=>{
 const s=setup(t);assert.equal(s.store.load(),'');s.store.save(pending);assert.equal(s.create().load(),pending);assert(!fs.existsSync(s.root+'/display-cleanup.json.partial'));
});
test('an interrupted promotion preserves both records and refuses to trust the older terminal state',t=>{
 const s=setup(t),cleared=JSON.stringify({schema:1,peer:'',sid:'',evidence:'device_event'});s.store.save(cleared);s.failPromotion(true);
 assert.throws(()=>s.store.save(pending),/synthetic/);assert.equal(fs.readFileSync(s.root+'/display-cleanup.json','utf8'),cleared);
 assert.equal(fs.readFileSync(s.root+'/display-cleanup.json.partial','utf8'),pending);assert.throws(()=>s.store.load(),/PARTIAL/);
});
test('oversized records are rejected without replacing existing data',t=>{
 const s=setup(t);s.store.save(pending);assert.throws(()=>s.store.save('x'.repeat(1025)),/SIZE/);assert.equal(s.store.load(),pending);
 fs.writeFileSync(s.root+'/display-cleanup.json','x'.repeat(1025));assert.throws(()=>s.store.load(),/SIZE/);
});

test('an existing empty cleanup ledger is corrupt, distinct from a first launch with no ledger',t=>{
 const s=setup(t);assert.equal(s.store.load(),'');fs.writeFileSync(s.root+'/display-cleanup.json','');
 assert.throws(()=>s.store.load(),/SIZE/);assert.equal(fs.statSync(s.root+'/display-cleanup.json').size,0);
});
test('a zero-progress file write cannot publish a successful record',t=>{
 const s=setup(t);s.io.writeSync=()=>0;assert.throws(()=>s.store.save(pending),/WRITE/);assert.throws(()=>s.store.load(),/PARTIAL/);
});

test('notification ownership uses a separate bounded atomic record and cannot select an arbitrary path',t=>{
 const s=setup(t),{DisplayCleanupStore}=loadApp('DisplayCleanupStore',{'@kit.CoreFileKit':{fileIo:s.io}});
 s.store.save(pending);const notices=new DisplayCleanupStore();notices.initialize(s.root,'notification-cleanup.json');assert.equal(notices.load(),'');
 const owner=JSON.stringify({schema:1,uid:'42',peer:'synthetic'});notices.save(owner);assert.equal(notices.load(),owner);assert.equal(s.store.load(),pending);
 assert.throws(()=>new DisplayCleanupStore().initialize(s.root,'../display-cleanup.json'),/NAME/);
});

test('teleprompter cleanup keeps its own atomic record and never overwrites display or notification ownership',t=>{
 const s=setup(t),{DisplayCleanupStore}=loadApp('DisplayCleanupStore',{'@kit.CoreFileKit':{fileIo:s.io}});
 s.store.save(pending);const notices=new DisplayCleanupStore();notices.initialize(s.root,'notification-cleanup.json');notices.save('{"owner":"notification-fixture"}');
 const prompter=new DisplayCleanupStore();prompter.initialize(s.root,'teleprompter-cleanup.json');const raw=JSON.stringify({schema:1,peer:'original',did:'a'.repeat(36),fileStarted:true,evidence:'none'});prompter.save(raw);
 assert.equal(prompter.load(),raw);assert.equal(s.store.load(),pending);assert.equal(notices.load(),'{"owner":"notification-fixture"}');s.failPromotion(true);
 assert.throws(()=>prompter.save('{}'));assert.throws(()=>prompter.load(),/PARTIAL/);assert.equal(s.store.load(),pending);
});

test('voice recording and day capture have distinct bounded atomic ledgers',t=>{
 const s=setup(t),{DisplayCleanupStore}=loadApp('DisplayCleanupStore',{'@kit.CoreFileKit':{fileIo:s.io}});
 const names=['voice-cleanup.json','recording-cleanup.json','lifelog-cleanup.json'];
 const stores=names.map((name,i)=>{const store=new DisplayCleanupStore();store.initialize(s.root,name);assert.equal(store.load(),'');store.save(JSON.stringify({fixture:i}));return store;});
 stores.forEach((store,i)=>assert.equal(store.load(),JSON.stringify({fixture:i})));
 assert.equal(s.store.load(),'');assert.throws(()=>new DisplayCleanupStore().initialize(s.root,'other-cleanup.json'),/NAME/);
});
