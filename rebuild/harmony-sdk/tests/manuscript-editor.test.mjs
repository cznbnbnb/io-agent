import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const legacy={id:'manuscript-owned',kind:'manuscript',title:'原题',text:'原文',answer:'',model:'',created:1700000000000};
const defer=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
async function setup(){let value=JSON.stringify({version:1,todos:[],entries:[legacy]}),random=0;
 let backup='';const prefs={get:async(k,d)=>k==='data'?value:(k==='data_v1_backup'?backup:d),put:async(k,v)=>{if(k==='data')value=v;else if(k==='data_v1_backup')backup=v;},flush:async()=>{}};
 const storeModule=loadApp('LocalWorkspace',{'@kit.AbilityKit':{},'@kit.ArkData':{preferences:{getPreferences:async()=>prefs}},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(++random)})})}}});
 const store=new storeModule.LocalWorkspace();await store.load({});const {ManuscriptEditor}=loadApp('ManuscriptEditor',{'./LocalWorkspace':{...storeModule,localWorkspace:store}});const editor=new ManuscriptEditor(store);
 return{store,editor,prefs,value:()=>value};
}
test('save freezes inputs and process-owned result survives replacing the page listener',async()=>{
 const t=await setup(),gate=defer();t.editor.setTitle('合成新稿');t.editor.setText('正文');t.prefs.flush=()=>gate.promise;
 let old=0,next=0;t.editor.changed=()=>old++;const saving=t.editor.save();await tick();assert(t.editor.busy);
 t.editor.changed=()=>next++;t.editor.setTitle('不应写入');t.editor.setText('不应清除');await assert.rejects(t.editor.save());
 gate.resolve();await saving;assert(!t.editor.busy);assert.equal(t.editor.title,'合成新稿');assert.equal(t.editor.text,'正文');assert.equal(t.editor.revision,1);assert.equal(t.store.entries.length,2);assert.equal(old,1);assert(next>0);
});
test('failed save retains draft and visible error for the next mounted page',async()=>{
 const t=await setup();t.editor.setTitle('未确认');t.editor.setText('未确认正文');t.prefs.flush=async()=>{throw Error('storage failure');};await assert.rejects(t.editor.save());
 assert.equal(t.editor.text,'未确认正文');assert.equal(t.editor.id,'');assert(!t.editor.busy);assert.match(t.editor.note,/未确认/);assert.equal(t.store.entries.length,1);
});
test('editing saves same ID and stale baseline remains available for explicit save-as-new',async()=>{
 const t=await setup();await t.editor.choose(legacy.id,async()=>true);t.editor.setText('我的草稿');await t.store.saveManuscript(legacy.id,1,'外部修改','新的原文');await assert.rejects(t.editor.save(),/已变化/);
 assert.equal(t.editor.text,'我的草稿');assert.equal(t.editor.revision,1);await t.editor.save(true);assert.notEqual(t.editor.id,legacy.id);assert.equal(t.store.manuscriptSnapshot(legacy.id).text,'新的原文');
});
test('delete dialog freezes revision and refuses a changed row; cancellation does not write',async()=>{
 const t=await setup(),gate=defer();const deletion=t.editor.remove(legacy.id,()=>gate.promise);await tick();assert(t.editor.busy);await t.store.saveManuscript(legacy.id,1,'已变','已变正文');gate.resolve(true);await assert.rejects(deletion,/已变化/);assert.equal(t.store.entries.length,1);
 const value=t.value();await t.editor.remove(legacy.id,async()=>false);assert.equal(t.value(),value);assert.match(t.editor.note,/已取消/);
});
test('deleting selected row keeps an unsaved draft and requires explicit new save',async()=>{
 const t=await setup();await t.editor.choose(legacy.id,async()=>true);t.editor.setText('未保存修订');await t.editor.remove(legacy.id,async()=>true);
 assert.equal(t.store.entries.length,0);assert.equal(t.editor.id,'');assert.equal(t.editor.text,'未保存修订');await t.editor.save();assert.equal(t.store.entries.length,1);assert.notEqual(t.editor.id,legacy.id);
});
test('late import is retained across page listeners, creates new draft, and picker cancellation preserves it',async()=>{
 const t=await setup(),gate=defer();await t.editor.choose(legacy.id,async()=>true);const importing=t.editor.importText(()=>gate.promise,async()=>true);await tick();assert(t.editor.busy);t.editor.changed=()=>{};
 gate.resolve('导入正文\n第二行');await importing;assert.equal(t.editor.id,'');assert.equal(t.editor.text,'导入正文\n第二行');assert.equal(t.store.entries.length,1);assert.equal(t.store.entries[0].text,legacy.text);
 await t.editor.importText(async()=>undefined,async()=>true);assert.equal(t.editor.text,'导入正文\n第二行');assert(!t.editor.busy);
});
test('discard cancellation and invalid imported text cannot replace a user draft',async()=>{
 const t=await setup();t.editor.setText('保留草稿');await t.editor.choose(legacy.id,async()=>false);assert.equal(t.editor.text,'保留草稿');await t.editor.fresh(async()=>false);assert.equal(t.editor.text,'保留草稿');
 let called=0;await t.editor.importText(async()=>{called++;return '替换';},async()=>false);assert.equal(called,0);
 await assert.rejects(t.editor.importText(async()=> 'bad\u0000data',async()=>true));assert.equal(t.editor.text,'保留草稿');assert(!t.editor.busy);
});

test('binding echoes after selection, import, and fresh retain operation feedback without another edit',async()=>{
 const t=await setup();await t.editor.choose(legacy.id,async()=>true);
 for(const operation of ['choose','import','fresh']){
  if(operation==='import')await t.editor.importText(async()=> '中文新稿\n第二行😀',async()=>true);
  if(operation==='fresh')await t.editor.fresh(async()=>true);
  const note=t.editor.note,dirty=t.editor.dirty,id=t.editor.id;let events=0;t.editor.changed=()=>events++;
  t.editor.setTitle(t.editor.title);t.editor.setText(t.editor.text);
  assert.equal(t.editor.note,note,operation);assert.equal(t.editor.dirty,dirty);assert.equal(t.editor.id,id);assert.equal(events,0);
 }
});

test('real title or body editing still clears prior feedback and preserves revision identity',async()=>{
 const t=await setup();await t.editor.choose(legacy.id,async()=>true);t.editor.setTitle('人工标题');
 assert.equal(t.editor.note,'');assert(t.editor.dirty);assert.equal(t.editor.id,legacy.id);assert.equal(t.editor.revision,1);
 await t.editor.save();assert.match(t.editor.note,/已保存/);t.editor.setText('人工正文');assert.equal(t.editor.note,'');assert(t.editor.dirty);assert.equal(t.editor.revision,2);
});
