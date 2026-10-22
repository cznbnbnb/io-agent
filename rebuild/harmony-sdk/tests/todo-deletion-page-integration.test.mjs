import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {loadApp} from './load-app.mjs';
import {loadCore} from './load-core.mjs';

const require=createRequire(import.meta.url);
const ts=require(`${process.env.DEVECO_HOME||'D:/APP/DevEcoStudio'}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/LibraryPanel.ets',import.meta.url),'utf8');
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');
const peer='aabbccddeeff',otherPeer='112233445566',clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(value).digest('hex'),turn=()=>new Promise(setImmediate);
const packet=(type,value)=>businessEnvelope(type,new TextEncoder().encode(JSON.stringify(value)));
const originalTodo=(id,boundPeer=peer)=>({id,title:'合成集成待办'+id,completed:false,important:false,created:1700000000,modified:1700000001,revision:1,peer:boundPeer,delivery:boundPeer?'submitted':'local',observed:-1});
const archive={id:'synthetic-conversation-kept',kind:'conversation',title:'保留对话',text:'合成原文',answer:'合成答案',model:'synthetic',created:1700000000000};
const manuscript={id:'synthetic-manuscript-kept',kind:'manuscript',title:'保留稿件',text:'稿件正文不能受待办删除影响',answer:'',model:'',created:1700000000001,revision:2,modified:1700000000002};
function originalRaw(){return JSON.stringify({version:1,todos:[originalTodo(101),originalTodo(102,'')],entries:[archive,manuscript]},null,2)+'\r\n';}
function method(name){
 const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);assert(match,'actual page method missing '+name);
 const after=source.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|@Builder|build\()/.exec(after);assert(next,'method boundary missing '+name);
 return source.slice(match.index,match.index+match[0].length+next.index);
}
const methods=['aboutToAppear','aboutToDisappear','categoryChanged','refresh','todoCurrent','sameTodoReference','todoError','confirmTodoDelete','todoDeletionText','loadTodoDeletions','nextTodoDeletions','cancelTodoDeletion','confirmTodoResend','refreshTodoQuery','todoQueryPhaseText','queryTodos'];
const compiled=ts.transpileModule(`class Page {\n${methods.map(method).join('\n')}\n}\nmodule.exports=Page;`,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
async function until(check,message){for(let at=0;at<100;at++){if(check())return;await turn();}assert.fail(message);}

// Actual page methods + actual workspace/model/protocol/editor. Only the native
// preferences boundary, physical transport and confirmation UI are substituted.
// Preferences remain a real durable D: key/value file, not a single-value stub.
function fixture(t){
 const parent=fs.realpathSync(os.tmpdir());assert.match(parent,/^[Dd]:[\\/]/,'integration scratch must stay on D:');
 const root=fs.mkdtempSync(path.join(parent,'todo095-page-integration-')),token=randomUUID(),owner=path.join(root,'.owner.json'),file=path.join(root,'preferences.json'),temporary=file+'.pending';
 fs.writeFileSync(owner,JSON.stringify({kind:'todo095-page-integration',token,parent,root}));
 const original=originalRaw();fs.writeFileSync(file,JSON.stringify({data:original,unrelated_key:'keep-this-preference'}));
 const originalBytes=fs.readFileSync(file),instances=[],pages=[],flushes=[],preferenceAccess=[];
 const disk=()=>JSON.parse(fs.readFileSync(file,'utf8'));
 function open(){
  let buffered=disk();const probe={foreground:true,features:{state:{connected:false}}};
  const prefs={
   async get(key,fallback){preferenceAccess.push(['get',key]);return Object.hasOwn(buffered,key)?buffered[key]:fallback;},
   async put(key,value){preferenceAccess.push(['put',key]);buffered[key]=value;},
   async flush(){
    const bytes=Buffer.from(JSON.stringify(buffered));let fd;
    try{fd=fs.openSync(temporary,'wx');let offset=0;while(offset<bytes.length){const n=fs.writeSync(fd,bytes,offset,Math.min(97,bytes.length-offset),null);assert(n>0);offset+=n;}fs.fsyncSync(fd);}
    finally{if(fd!==undefined)fs.closeSync(fd);}
    fs.renameSync(temporary,file);flushes.push({keys:Object.keys(buffered).sort(),data_hash:hash(buffered.data),backup_hash:buffered.data_v1_backup?hash(buffered.data_v1_backup):''});
   }
  };
  const module=loadApp('LocalWorkspace',{'@kit.AbilityKit':{},'@kit.ArkData':{preferences:{getPreferences:async(_context,options)=>{assert.equal(options.name,'turboio_workspace_v1');return prefs;}}},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:Uint8Array.from(randomBytes(n))})})}}},{setTimeout,clearTimeout});
  const store=new module.LocalWorkspace();
  const {ManuscriptEditor}=loadApp('ManuscriptEditor',{'./LocalWorkspace':{...module,localWorkspace:store}}),editor=new ManuscriptEditor(store);
  editor.setTitle('未保存的稿件草稿');editor.setText('待办测试期间保留草稿正文');
  const exported={exports:{}};vm.runInNewContext(compiled,{module:exported,exports:exported.exports,localWorkspace:store,manuscriptEditor:editor,probeSession:probe,newWorkspaceTodoDeleteId:module.newWorkspaceTodoDeleteId,JSON,Promise,Error});
  const dialogs=[],answers=[];const page=new exported.exports();Object.assign(page,{category:'待办',visible:false,epoch:0,busy:false,todoBusy:false,todos:[],entries:[],note:'',titleText:'待办输入保留',editing:0,deletions:[],deletionHasMore:false,deletionIncomplete:false,deletionCursor:'',deletionNextCursor:'',todoQueryNote:'',
   getUIContext:()=>({getPromptAction:()=>({showDialog:options=>{dialogs.push(options);return new Promise(resolve=>answers.push(resolve));}})})});
  const transport={peer,ready:false,lease:1,writes:[],fail:false};
  store.setTodoTransport({peer:()=>transport.peer,ready:()=>transport.ready,foreground:()=>probe.foreground,lease:()=>transport.lease,send:async(b,bytes)=>{
   const copy=new Uint8Array(bytes),envelope=readLauncherEnvelope(copy),body=JSON.parse(new TextDecoder().decode(envelope.json));
   const persisted=JSON.parse(disk().data);
   if(envelope.type===7){const claim=persisted.deletions.find(d=>d.todo.id===body.eventIDList[0]);assert(claim,'wire needs persisted deletion');assert.equal(claim.phase,'sending');assert(claim.attempts>0);assert.equal(b,22);}
   transport.writes.push({business:b,type:envelope.type,body,bytes:copy,claims:clone(persisted.deletions||[])});
   if(transport.fail)throw Error('synthetic transport lost after possible write');
  }});
  transport.change=patch=>{if(Object.hasOwn(patch,'foreground'))probe.foreground=patch.foreground;if(Object.hasOwn(patch,'peer'))transport.peer=patch.peer;if(Object.hasOwn(patch,'ready')){transport.ready=patch.ready;probe.features.state.connected=patch.ready;}transport.lease++;store.todoConnectionChanged();};
  const current={store,module,editor,page,probe,prefs,transport,dialogs,
   respond(index){assert(answers.length,'expected actual page confirmation');answers.shift()({index});},
   mount(){page.aboutToAppear();},leave(){page.aboutToDisappear();},
   async deleteByPage(id,index=1){const row=store.todos.find(todo=>todo.id===id);assert(row);const job=page.confirmTodoDelete(row);current.respond(index);await job;},
   async retryByPage(id,index=1){const view=store.todoDeleteStatus(id),job=page.confirmTodoResend(view);current.respond(index);await job;},
   operation(){const page=store.todoPage('deleted',10,'');assert.equal(page.deletions.length,1);return page.deletions[0];},
   deleteWrites(){return transport.writes.filter(write=>write.type===7);}
  };
  instances.push(current);pages.push(page);return current;
 }
 t.after(()=>{
  for(const page of pages)page.aboutToDisappear();for(const instance of instances)instance.store.setTodoTransport(undefined);
  const resolved=fs.realpathSync(root),mark=JSON.parse(fs.readFileSync(owner,'utf8'));
  assert.equal(resolved,path.resolve(root));assert.equal(path.dirname(resolved),parent);assert.equal(mark.token,token);assert.equal(mark.kind,'todo095-page-integration');assert.equal(mark.root,root);assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
  const entries=fs.readdirSync(root);assert(entries.every(name=>['.owner.json','preferences.json','preferences.json.pending'].includes(name)),'unexpected files preserved instead of broad cleanup');
  fs.rmSync(resolved,{recursive:true});
 });
 return{original,originalBytes,disk,file,flushes,preferenceAccess,open};
}

test('actual ordinary page offline deletion migrates exact v1 KV backup, cold shows history, and unsent withdrawal restores revision',async t=>{
 const f=fixture(t),first=f.open();await first.store.load({});first.mount();assert.equal(first.store.ready,true);assert.equal(f.flushes.length,0);assert.deepEqual(fs.readFileSync(f.file),f.originalBytes);
 const originalReference=clone(first.store.todoSnapshot(101).reference);first.page.editing=101;
 await first.deleteByPage(101,0);assert.equal(f.flushes.length,0);assert.deepEqual(fs.readFileSync(f.file),f.originalBytes);
 await first.deleteByPage(101);const deletion=first.operation(),saved=JSON.parse(f.disk().data);
 assert.equal(saved.version,2);assert.equal(f.flushes.length,2);assert.equal(f.flushes[0].backup_hash,hash(f.original));assert.equal(f.flushes[0].data_hash,hash(f.original));assert.equal(f.disk().data_v1_backup,f.original);assert.equal(saved.legacy_backup_sha256,hash(f.original));assert.equal(f.disk().unrelated_key,'keep-this-preference');
 assert.deepEqual(saved.deletions[0].reference,originalReference);assert.equal(deletion.phase,'pending');assert.equal(deletion.attempts,0);assert.equal(deletion.can_cancel,true);assert.deepEqual(saved.todos.map(row=>row.id),[102]);assert.deepEqual(saved.entries,[archive,manuscript]);assert.equal(first.editor.text,'待办测试期间保留草稿正文');assert.equal(first.page.editing,0);assert.equal(first.page.titleText,'');assert.equal(first.transport.writes.length,0);
 first.leave();first.store.setTodoTransport(undefined);const cold=f.open();await cold.store.load({});cold.mount();assert.equal(cold.page.deletions[0].operation_id,deletion.operation_id);assert.equal(cold.page.deletions[0].phase,'pending');assert.equal(cold.page.todos.length,1);assert.equal(cold.transport.writes.length,0);
 await cold.page.cancelTodoDeletion(cold.page.deletions[0]);const restored=cold.store.todoSnapshot(101);assert.equal(restored.reference.revision,originalReference.revision+1);assert.equal(restored.title,deletion.todo.title);assert.equal(cold.operation().phase,'cancelled');assert.equal(f.disk().data_v1_backup,f.original);assert.deepEqual(JSON.parse(f.disk().data).entries,[archive,manuscript]);
 cold.leave();cold.store.setTodoTransport(undefined);const reopened=f.open();await reopened.store.load({});reopened.mount();assert.equal(reopened.store.ready,true);assert.equal(reopened.page.todos.length,2);assert.equal(reopened.page.deletions[0].phase,'cancelled');assert.equal(reopened.transport.writes.length,0);assert.equal(f.disk().unrelated_key,'keep-this-preference');
});

test('actual offline page intent first-sends only on original peer in foreground, with durable claim and observed-only receipts and query',async t=>{
 const f=fixture(t),first=f.open();await first.store.load({});first.mount();await first.deleteByPage(101);const id=first.operation().operation_id;first.leave();first.store.setTodoTransport(undefined);
 const cold=f.open();await cold.store.load({});cold.mount();assert.equal(cold.page.deletions[0].attempts,0);assert.equal(cold.transport.writes.length,0);
 cold.transport.change({ready:true,peer:otherPeer});await turn();assert.equal(cold.deleteWrites().length,0);
 cold.transport.change({peer,foreground:false});await turn();assert.equal(cold.deleteWrites().length,0);
 cold.transport.change({foreground:true});await until(()=>cold.store.todoDeleteStatus(id).phase==='submitted','first send did not settle');
 assert.equal(cold.deleteWrites().length,1);assert.deepEqual(cold.deleteWrites()[0].body,{eventType:1,scheduleTotal:0,todoTotal:1,eventIDList:[101]});assert.equal(cold.deleteWrites()[0].claims[0].attempts,1);assert.equal(cold.page.deletions[0].phase,'submitted');assert.equal(cold.page.deletions[0].can_cancel,false);
 cold.transport.change({});cold.page.refresh();await turn();assert.equal(cold.deleteWrites().length,1);
 cold.store.receiveTodo(peer,packet(14,{sourceType:7,successCount:1}));await until(()=>cold.store.todoDeleteStatus(id).receipt_observed,'receipt not saved');
 assert.equal(cold.operation().receipt_correlation,'unattributed');assert.equal(cold.operation().phase,'submitted');assert.match(cold.page.todoDeletionText(cold.operation()),/仍待核对/);
 await cold.page.queryTodos();assert.equal(cold.transport.writes.filter(write=>write.type===15).length,1,JSON.stringify({page_note:cold.page.note,page_busy:cold.page.todoBusy,foreground:cold.probe.foreground,query:cold.store.todoQueryStatus(),deletion:cold.operation(),write_types:cold.transport.writes.map(write=>write.type)}));
 cold.store.receiveTodo(peer,packet(16,{scheduleTotal:0,todoTotal:0,batchNo:1,isLastBatch:true,needFullData:true,chunkInfo:{chunkId:7,batchNo:1,isLastBatch:true,currentItems:0},dataList:[]}));
 await until(()=>cold.store.todoDeleteStatus(id).query_observation==='absent','complete query observation not saved');assert.equal(cold.store.todoQueryStatus().phase,'complete');assert.equal(cold.store.todoQueryStatus().absence_is_confirmation,false);assert.equal(cold.operation().phase,'submitted');assert.match(cold.page.todoQueryNote,/未查到不代表删除已确认/);assert.equal(cold.page.todos.some(row=>row.id===101),false);assert.equal(f.disk().data_v1_backup,f.original);
});

test('actual uncertain send never auto-replays or withdraws; page requires explicit retry and enforces three persisted attempts',async t=>{
 const f=fixture(t),current=f.open();await current.store.load({});current.mount();await current.deleteByPage(101);const id=current.operation().operation_id;
 current.transport.fail=true;current.transport.change({ready:true});await until(()=>current.store.todoDeleteStatus(id).phase==='uncertain','unknown send not settled');assert.equal(current.deleteWrites().length,1);assert.equal(current.operation().attempts,1);assert.equal(current.operation().can_cancel,false);
 const beforeCancel=f.disk().data;await current.page.cancelTodoDeletion(current.operation());assert.equal(f.disk().data,beforeCancel);assert.equal(current.store.todos.some(row=>row.id===101),false);
 current.transport.change({});current.page.refresh();await turn();assert.equal(current.deleteWrites().length,1);
 await current.retryByPage(id,0);assert.equal(current.deleteWrites().length,1);assert.equal(current.operation().attempts,1);
 await current.retryByPage(id);assert.equal(current.deleteWrites().length,2);assert.equal(current.operation().phase,'uncertain');assert.equal(current.operation().attempts,2);assert.match(current.page.note,/不确定/);
 current.transport.fail=false;await current.retryByPage(id);assert.equal(current.deleteWrites().length,3);assert.equal(current.operation().phase,'submitted');assert.equal(current.operation().attempts,3);assert.equal(current.operation().can_send,false);assert.equal(current.operation().can_cancel,false);
 const dialogs=current.dialogs.length;await current.page.confirmTodoResend(current.operation());assert.equal(current.dialogs.length,dialogs);assert.equal(current.deleteWrites().length,3);
 current.leave();current.store.setTodoTransport(undefined);const cold=f.open();await cold.store.load({});cold.mount();cold.transport.change({ready:true});await turn();assert.equal(cold.deleteWrites().length,0);assert.equal(cold.page.deletions[0].attempts,3);assert.equal(cold.page.deletions[0].phase,'submitted');assert.deepEqual(JSON.parse(f.disk().data).entries,[archive,manuscript]);assert.equal(f.disk().data_v1_backup,f.original);
});

test('actual workspace revision changed during page confirmation prevents deletion and does not migrate the store',async t=>{
 const f=fixture(t),current=f.open();await current.store.load({});current.mount();const task=current.page.confirmTodoDelete(current.store.todos[0]);assert.equal(current.dialogs.length,1);
 await current.store.editTodo(101,'确认期间实际保存的新标题',false);const before=f.disk().data,flushes=f.flushes.length;current.respond(1);await task;
 assert.equal(f.disk().data,before);assert.equal(f.flushes.length,flushes);assert.equal(Object.hasOwn(f.disk(),'data_v1_backup'),false);assert.equal(JSON.parse(f.disk().data).version,1);assert.equal(current.store.todoPage('deleted',10,'').deletions.length,0);assert.equal(current.store.todoSnapshot(101).title,'确认期间实际保存的新标题');assert.equal(current.transport.writes.length,0);assert.match(current.page.note,/已变化/);assert.equal(current.editor.text,'待办测试期间保留草稿正文');
});
