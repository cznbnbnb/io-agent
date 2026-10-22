import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';
const legacy={id:'manuscript-legacy',kind:'manuscript',title:'旧稿',text:'旧正文',answer:'',model:'',created:1700000000000};
const conversation={id:'turn-original',kind:'conversation',title:'对话',text:'问题',answer:'答案',model:'synthetic',created:1700000000001};
const raw=(entries)=>JSON.stringify({version:1,todos:[],entries});
function setup(value=raw([legacy,conversation])){
 let stored=value,backup='',puts=0,next=1;const prefs={get:async(k,d)=>k==='data'?stored:(k==='data_v1_backup'?backup:d),put:async(k,v)=>{puts++;if(k==='data')stored=v;else if(k==='data_v1_backup')backup=v;},flush:async()=>{}};
 const crypto={createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(next++)})})};
 const {LocalWorkspace}=loadApp('LocalWorkspace',{'@kit.AbilityKit':{},'@kit.ArkData':{preferences:{getPreferences:async()=>prefs}},'@kit.CryptoArchitectureKit':{cryptoFramework:crypto}});
 return{w:new LocalWorkspace(),prefs,stored:()=>stored,puts:()=>puts,repeatRandom:()=>next=1};
}
test('legacy revision is read as one without rewriting store or unrelated archive',async()=>{
 const t=setup();await t.w.load({});assert(t.w.ready);const s=t.w.manuscriptSnapshot(legacy.id);assert.equal(s.revision,1);assert.equal(s.modified,legacy.created);assert.equal(t.puts(),0);assert.equal(t.stored(),raw([legacy,conversation]));
 s.text='external mutation';assert.equal(t.w.entries[0].text,legacy.text);
});
test('edit retains ID and creation time, advances revision, and preserves unrelated bytes',async()=>{
 const t=setup();await t.w.load({});const changed=await t.w.saveManuscript(legacy.id,1,'修改标题','修改正文');
 assert.equal(changed.id,legacy.id);assert.equal(changed.revision,2);assert.equal(changed.created,legacy.created);assert(changed.modified>=legacy.created);
 const stored=JSON.parse(t.stored());assert.equal(stored.entries.length,2);assert.deepEqual(stored.entries[1],conversation);
 const reloaded=setup(t.stored());await reloaded.w.load({});assert.equal(reloaded.w.manuscriptSnapshot(legacy.id).text,'修改正文');assert.equal(reloaded.w.manuscriptSnapshot(legacy.id).revision,2);
});
test('stale edit/delete and conversation IDs cannot overwrite or remove a manuscript',async()=>{
 const t=setup();await t.w.load({});await t.w.saveManuscript(legacy.id,1,'最新','最新正文');const before=t.stored(),puts=t.puts();
 await assert.rejects(t.w.saveManuscript(legacy.id,1,'迟到','旧正文'),/已变化/);await assert.rejects(t.w.deleteManuscript(legacy.id,1),/已变化/);
 await assert.rejects(t.w.saveManuscript(conversation.id,1,'误改','正文'),/稿件/);await assert.rejects(t.w.deleteManuscript(conversation.id,1),/稿件/);
 assert.equal(t.stored(),before);assert.equal(t.puts(),puts);
});
test('single delete commits only its owned manuscript and reload cannot resurrect it',async()=>{
 const t=setup();await t.w.load({});await t.w.deleteManuscript(legacy.id,1);assert.deepEqual(JSON.parse(t.stored()).entries,[conversation]);
 const r=setup(t.stored());await r.w.load({});assert.equal(r.w.entries.length,1);assert.throws(()=>r.w.manuscriptSnapshot(legacy.id),/稿件/);
});
test('new IDs cannot collide and ambiguous legacy IDs refuse edits without clearing data',async()=>{
 const t=setup(raw([]));await t.w.load({});const first=await t.w.saveManuscript('',0,'合成','正文');assert(first.id);assert.equal(first.revision,1);t.repeatRandom();await assert.rejects(t.w.saveManuscript('',0,'碰撞','另一正文'),/标识/);assert.equal(t.w.entries.length,1);
 const duplicate=setup(raw([legacy,{...legacy,text:'另一个'}]));await duplicate.w.load({});const before=duplicate.stored();await assert.rejects(duplicate.w.saveManuscript(legacy.id,1,'标题','正文'),/标识/);assert.equal(duplicate.stored(),before);assert.equal(duplicate.puts(),0);
});
test('uncertain flush preserves in-memory baseline and blocks subsequent manuscript writes',async()=>{
 const t=setup();await t.w.load({});t.prefs.flush=async()=>{throw Error('synthetic storage failure');};await assert.rejects(t.w.saveManuscript(legacy.id,1,'未确认','未确认正文'));
 assert.equal(t.w.entries[0].text,legacy.text);assert(!t.w.ready);const uncertain=t.stored();await assert.rejects(t.w.deleteManuscript(legacy.id,1));assert.equal(t.stored(),uncertain);
});
