import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

const require=createRequire(import.meta.url);
const ts=require(`${process.env.DEVECO_HOME||'D:/APP/DevEcoStudio'}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/LibraryPanel.ets',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(setImmediate);
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function method(name){
 const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);assert(match,'actual method missing '+name);
 const after=source.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|@Builder|build\()/.exec(after);assert(next,'method boundary missing '+name);
 return source.slice(match.index,match.index+match[0].length+next.index);
}
const names=['aboutToAppear','aboutToDisappear','categoryChanged','refresh','todoCurrent','sameTodoReference','todoError','confirmTodoDelete','todoDeletionText','loadTodoDeletions','nextTodoDeletions','cancelTodoDeletion','confirmTodoResend','refreshTodoQuery','todoQueryPhaseText','queryTodos'];
const compiled=ts.transpileModule(`class Page {\n${names.map(method).join('\n')}\n}\nmodule.exports=Page;`,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;

// Actual LibraryPanel event methods. Workspace persistence, connection and
// confirmation UI are controlled ports; this is not device/protocol evidence.
function fixture({category='待办',connected=false,foreground=true}={}){
 const row={id:17,title:'合成单条待办',completed:false,important:false,created:10,modified:11,revision:2,peer:'aabbccddeeff',delivery:'confirmed',observed:-1};
 const other={...clone(row),id:18,title:'保留的另一条'};
 const calls=[],dialogs=[],pending=[],operations=new Map();let idSequence=0,pageFailure=false,deleteFailure=false,queryFailure=false,deleteGate;
 const probe={foreground,features:{state:{connected}}};
 const editor={title:'稿件草稿',text:'正文保留',id:'manuscript-keep',revision:4,busy:false,note:'稿件状态保留',changed(){}};
 const snapshot=value=>({reference:{id:value.id,revision:value.revision,peer:value.peer,content_sha256:createHash('sha256').update(JSON.stringify(value)).digest('hex')},title:value.title,completed:value.completed,important:value.important,created:value.created,modified:value.modified,delivery:value.delivery});
 const query={schema:1,phase:'idle',batches:0,received:0,absence_is_confirmation:false};
 const store={ready:true,autoQueried:false,note:'本机资料',todos:[row,other],entries:[{id:'entry-keep',kind:'manuscript',title:'保留稿件',text:'原文'}],changed(){},
  todoSnapshot(id){calls.push(['snapshot',id]);const value=this.todos.find(todo=>todo.id===id);if(!value)throw Error('TODO_NOT_FOUND');return snapshot(value);},
  async deleteTodo(id,reference){calls.push(['delete',id,clone(reference)]);if(deleteFailure)throw Error('D:/private/secret token=unredacted');
   const item=this.todoSnapshot(reference.id);assert.deepEqual(item.reference,clone(reference));this.todos=this.todos.filter(todo=>todo.id!==reference.id);
   const view={schema:1,operation_id:id,state_sha256:'1'.repeat(64),revision:1,phase:item.reference.peer?'pending':'local_deleted',note:'仅受控端口',todo:item,attempts:0,max_attempts:3,can_cancel:true,can_send:!!item.reference.peer,receipt_observed:false,receipt_success_count:-1,receipt_failure_code:-1,receipt_at:'',receipt_correlation:'none',query_observation:'not_queried',query_at:''};
   operations.set(id,view);this.changed();if(deleteGate)await deleteGate.promise;return clone(view);},
  todoDeleteStatus(id){calls.push(['status',id]);const value=operations.get(id);return value?clone(value):{operation_id:id,state_sha256:'',phase:'missing',can_cancel:false,can_send:false,attempts:0};},
  async cancelTodoDelete(id,sha){calls.push(['cancel',id,sha]);const view=operations.get(id);assert.equal(view.state_sha256,sha);assert.equal(view.attempts,0);assert(view.can_cancel);view.phase='cancelled';view.can_cancel=false;view.can_send=false;view.state_sha256='2'.repeat(64);this.todos.push({...clone(row),...clone(view.todo),id:view.todo.reference.id,revision:view.todo.reference.revision,peer:view.todo.reference.peer});this.changed();return clone(view);},
  async sendTodoDelete(id,sha){calls.push(['send',id,sha]);const view=operations.get(id);assert.equal(view.state_sha256,sha);assert(view.can_send);view.attempts++;view.phase='submitted';view.can_cancel=false;view.state_sha256='3'.repeat(64);this.changed();return clone(view);},
  todoPage(scope,limit,cursor){calls.push(['page',scope,limit,cursor]);assert.equal(scope,'deleted');assert.equal(limit,10);if(pageFailure)throw Error('TODO_STALE');return{schema:1,scope,todos:[],deletions:cursor?[]:[...operations.values()].map(clone),next_cursor:cursor?'':'tcur-'+'a'.repeat(64)+'-10',has_more:!cursor,snapshot_sha256:'a'.repeat(64),scanned:operations.size,incomplete:false,incomplete_reason:''};},
  todoQueryStatus(){calls.push(['query-status']);return clone(query);},
  async queryCurrentTodos(){calls.push(['query']);if(queryFailure)throw Error('D:/private/query token=secret');Object.assign(query,{phase:'waiting'});this.changed();return clone(query);},
  queryGlasses(){assert.fail('legacy query bypassed current query controller');}
 };
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,localWorkspace:store,manuscriptEditor:editor,probeSession:probe,JSON,Promise,Error,
  newWorkspaceTodoDeleteId:()=>`tdel-${(++idSequence).toString(16).padStart(32,'0')}`});
 const page=new module.exports();Object.assign(page,{category,visible:false,epoch:0,busy:false,todoBusy:false,todos:[],entries:[],note:'',titleText:'草稿输入',editing:0,deletions:[],deletionHasMore:false,deletionIncomplete:false,deletionCursor:'',deletionNextCursor:'',todoQueryNote:'',
  getUIContext:()=>({getPromptAction:()=>({showDialog(options){dialogs.push(options);const gate=deferred();pending.push(gate);return gate.promise;}})})});
 const mounted=()=>page.aboutToAppear(),respond=index=>{assert(pending.length,'confirmation not requested');pending.shift().resolve({index});};
 const seed=(overrides={})=>{const view={schema:1,operation_id:'tdel-'+'b'.repeat(32),state_sha256:'a'.repeat(64),revision:1,phase:'uncertain',note:'不信任端口自由文本',todo:snapshot(row),attempts:1,max_attempts:3,can_cancel:false,can_send:true,receipt_observed:false,receipt_success_count:-1,receipt_failure_code:-1,receipt_at:'',receipt_correlation:'none',query_observation:'not_queried',query_at:'',...overrides};operations.set(view.operation_id,view);return clone(view);};
 const change=kind=>{
  if(kind==='revision'){row.revision++;row.title='新版';}
  else if(kind==='same-revision'){row.title='同版本内容改变';}
  else if(kind==='peer')row.peer='112233445566';
  else if(kind==='removed')store.todos=store.todos.filter(todo=>todo.id!==row.id);
  else if(kind==='background')probe.foreground=false;
  else if(kind==='remount'){page.aboutToDisappear();page.aboutToAppear();page.note='新页面说明';}
  else if(kind==='category'){page.category='资料';page.categoryChanged();page.category='待办';page.categoryChanged();page.note='新分类说明';}
 };
 return{page,row,other,store,editor,probe,calls,dialogs,operations,query,mount:mounted,respond,seed,change,
  failPage:()=>pageFailure=true,failDelete:()=>deleteFailure=true,failQuery:()=>queryFailure=true,deferDelete:()=>deleteGate=deferred(),
  names:()=>calls.map(call=>call[0])};
}

test('ordinary todo mount reads bounded deletion metadata without deleting, retrying or querying offline',()=>{
 const f=fixture();f.seed();f.mount();assert.equal(f.page.todos.length,2);assert.equal(f.page.deletions.length,1);assert(f.calls.some(call=>call[0]==='page'&&call[1]==='deleted'&&call[2]===10));
 assert.equal(f.names().some(name=>['delete','cancel','send','query'].includes(name)),false);assert.match(f.page.todoQueryNote,/未查到不代表删除已确认/);
 assert.match(source,/Button\('删除'\)/);assert.match(source,/this\.confirmTodoDelete\(row\)/);assert.match(source,/删除记录/);
});

test('ordinary single delete confirmation cancellation keeps all todos and manuscript draft',async()=>{
 const f=fixture();f.mount();const before=clone(f.store.todos),entries=clone(f.store.entries),task=f.page.confirmTodoDelete(f.row);assert.equal(f.page.todoBusy,true);assert.match(f.dialogs[0].message,/合成单条待办/);f.respond(0);await task;
 assert.deepEqual(f.store.todos,before);assert.deepEqual(f.store.entries,entries);assert.equal(f.editor.text,'正文保留');assert.equal(f.page.titleText,'草稿输入');assert.equal(f.names().includes('delete'),false);assert.equal(f.page.todoBusy,false);
});

test('confirmed single deletion passes exact immutable reference once and keeps other todo and manuscript',async()=>{
 const f=fixture();f.mount();const expected=f.store.todoSnapshot(f.row.id).reference;f.page.editing=f.row.id;
 const task=f.page.confirmTodoDelete(f.row);f.respond(1);await task;const call=f.calls.find(call=>call[0]==='delete');assert.match(call[1],/^tdel-[a-f0-9]{32}$/);assert.deepEqual(call[2],expected);
 assert.deepEqual(f.store.todos.map(row=>row.id),[f.other.id]);assert.equal(f.store.entries.length,1);assert.equal(f.editor.text,'正文保留');assert.equal(f.page.editing,0);assert.equal(f.page.titleText,'');assert.match(f.page.note,/等待原眼镜/);assert.equal(f.names().includes('send'),false);
});

for(const change of ['revision','same-revision','peer','removed','background','remount','category'])test(`delete dialog cannot act after ${change}`,async()=>{
 const f=fixture();f.mount();const task=f.page.confirmTodoDelete(f.row);f.change(change);const note=f.page.note;f.respond(1);await task;assert.equal(f.names().includes('delete'),false);assert.equal(f.operations.size,0);
 if(['background','remount','category'].includes(change))assert.equal(f.page.note,note);
});

test('duplicate delete click while confirmation is pending produces one operation',async()=>{
 const f=fixture();f.mount();const first=f.page.confirmTodoDelete(f.row),second=f.page.confirmTodoDelete(f.row);assert.equal(f.dialogs.length,1);f.respond(1);await Promise.all([first,second]);assert.equal(f.calls.filter(call=>call[0]==='delete').length,1);
});

test('late accepted deletion cannot overwrite remounted page state or reset a newer operation busy flag',async()=>{
 const f=fixture();f.mount();const gate=f.deferDelete(),task=f.page.confirmTodoDelete(f.row);f.respond(1);await tick();assert(f.names().includes('delete'));f.page.aboutToDisappear();f.mount();f.page.note='新页面说明';f.page.todoBusy=true;gate.resolve();await task;assert.equal(f.page.note,'新页面说明');assert.equal(f.page.todoBusy,true);assert.equal(f.page.todos.length,1);
});

test('deletion history pagination uses returned cursor and stale history never hides active source rows',()=>{
 const f=fixture();f.seed();f.mount();assert.equal(f.page.deletionHasMore,true);const cursor=f.page.deletionNextCursor;f.page.nextTodoDeletions();assert(f.calls.some(call=>call[0]==='page'&&call[3]===cursor));assert.equal(f.page.deletionHasMore,false);
 f.page.loadTodoDeletions('');assert.equal(f.page.deletions.length,1);f.failPage();f.page.refresh();assert.equal(f.page.deletionIncomplete,true);assert.equal(f.page.deletions.length,0);assert.equal(f.page.todos.length,2);assert.equal(f.store.todos.length,2);
});

test('only an unchanged zero-attempt deletion can be withdrawn and restored locally',async()=>{
 const f=fixture(),view=f.seed({phase:'pending',attempts:0,can_cancel:true});f.mount();await f.page.cancelTodoDeletion(view);assert.deepEqual(f.calls.find(call=>call[0]==='cancel'),['cancel',view.operation_id,view.state_sha256]);assert.match(f.page.note,/已撤销未发送/);assert.equal(f.names().includes('send'),false);
});

for(const change of ['sha','attempted','forbidden'])test(`withdraw refuses ${change} history`,async()=>{
 const f=fixture(),view=f.seed({phase:'pending',attempts:0,can_cancel:true});f.mount();const current=f.operations.get(view.operation_id);
 if(change==='sha')current.state_sha256='c'.repeat(64);else if(change==='attempted')current.attempts=1;else current.can_cancel=false;
 await f.page.cancelTodoDeletion(view);assert.equal(f.names().includes('cancel'),false);assert.equal(f.names().includes('send'),false);assert.doesNotMatch(f.page.note,/已撤销/);
});

test('retry always asks explicitly and sends only the confirmed operation and state',async()=>{
 const f=fixture(),view=f.seed();f.mount();const task=f.page.confirmTodoResend(view);assert.equal(f.names().includes('send'),false);assert.match(f.dialogs[0].message,/可能重复发送/);assert.match(f.dialogs[0].message,/最多3次/);f.respond(1);await task;
 assert.deepEqual(f.calls.find(call=>call[0]==='send'),['send',view.operation_id,view.state_sha256]);assert.match(f.page.note,/已提交/);assert.doesNotMatch(f.page.note,/眼镜已确认删除/);
});

test('cancelled retry confirmation never sends or changes attempts',async()=>{
 const f=fixture(),view=f.seed();f.mount();const task=f.page.confirmTodoResend(view);f.respond(0);await task;assert.equal(f.names().includes('send'),false);assert.equal(f.operations.get(view.operation_id).attempts,1);
});

for(const change of ['sha','forbidden','background','remount','category'])test(`retry dialog cannot send after ${change}`,async()=>{
 const f=fixture(),view=f.seed();f.mount();const task=f.page.confirmTodoResend(view);
 if(change==='sha')f.operations.get(view.operation_id).state_sha256='c'.repeat(64);else if(change==='forbidden')f.operations.get(view.operation_id).can_send=false;else f.change(change);
 const note=f.page.note;f.respond(1);await task;assert.equal(f.names().includes('send'),false);if(['background','remount','category'].includes(change))assert.equal(f.page.note,note);
});

test('refresh and receipt or query observations never convert submitted deletion into confirmed success',()=>{
 const f=fixture(),view=f.seed({phase:'submitted',receipt_observed:true,receipt_correlation:'unattributed',receipt_success_count:1,query_observation:'not_seen',query_at:'2026-10-16T00:00:00Z'});f.query.phase='complete';f.mount();f.page.refresh();
 assert.equal(f.page.deletions[0].phase,'submitted');assert.match(f.page.todoDeletionText(view),/仍待核对/);assert.match(f.page.todoQueryNote,/未查到不代表删除已确认/);assert.equal(f.names().some(name=>['delete','cancel','send','query'].includes(name)),false);
 assert.match(source,/缺少本条成功标识，不能据此确认删除/);assert.match(source,/receipt_correlation==='failure_id'/);assert.doesNotMatch(source,/眼镜已确认删除/);
});

test('explicit query uses the tracked controller and presents bounded collection state without deletion certainty',async()=>{
 const f=fixture();f.mount();await f.page.queryTodos();assert.equal(f.calls.filter(call=>call[0]==='query').length,1);assert.match(f.page.todoQueryNote,/等待眼镜分批回报/);assert.match(f.page.note,/不能单独确认删除/);assert.equal(f.names().includes('send'),false);
});

test('foreground connected mount asks for current todos once; remount does not retry deletion',async()=>{
 const f=fixture({connected:true});f.seed();f.mount();await tick();assert.equal(f.calls.filter(call=>call[0]==='query').length,1);assert.equal(f.store.autoQueried,true);f.page.aboutToDisappear();f.mount();await tick();assert.equal(f.calls.filter(call=>call[0]==='query').length,1);assert.equal(f.names().includes('send'),false);
});

test('background connected mount cannot query, delete, restore or retry',async()=>{
 const f=fixture({connected:true,foreground:false}),view=f.seed({attempts:0,can_cancel:true});f.mount();await f.page.confirmTodoDelete(f.row);await f.page.cancelTodoDeletion(view);await f.page.confirmTodoResend(view);await f.page.queryTodos();
 assert.equal(f.dialogs.length,0);assert.equal(f.names().some(name=>['delete','cancel','send','query'].includes(name)),false);assert.equal(f.store.autoQueried,false);
});

test('new destructive action failures do not expose raw file paths or tokens',async()=>{
 const f=fixture();f.mount();f.failDelete();const task=f.page.confirmTodoDelete(f.row);f.respond(1);await task;assert.doesNotMatch(f.page.note,/D:\/|private|token=|unredacted/);assert.match(f.page.note,/尚未确认完成/);assert.equal(f.page.todoBusy,false);
 f.failQuery();await f.page.queryTodos();assert.doesNotMatch(f.page.note,/D:\/|private|token=|secret/);assert.equal(f.page.todoBusy,false);
});

test('other library category only refreshes existing manuscript data and never reads deletion history',()=>{
 const f=fixture({category:'资料',connected:true});f.mount();assert.equal(f.page.manuscriptText,'正文保留');assert.equal(f.page.manuscriptRevision,4);assert.equal(f.page.entries.length,1);assert.equal(f.names().length,0);
});
