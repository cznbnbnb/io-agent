import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const deveco=process.env.DEVECO_HOME||'/Applications/DevEco-Studio.app/Contents';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const settle=()=>new Promise(resolve=>setImmediate(resolve));

// Run actual ordinary page event methods. The canonical/source and platform
// boundaries are explicit substitutes; this does not run ArkUI builders or
// claim native acceptance, active hardware capture, or cloud synchronization.
function method(source,name){
  const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);
  assert(match,`missing page method ${name}`);
  const after=source.slice(match.index+match[0].length);
  const next=/\n  (?:private |aboutTo|@Builder|build\()/.exec(after);
  assert(next,`missing boundary after ${name}`);
  return source.slice(match.index,match.index+match[0].length+next.index);
}
function fixture({failure='',selected='a',leaveDuringRemoval=false,unreadableHead=false,active=false}={}){
  const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/RecordingPanel.ets',import.meta.url),'utf8');
  const names=['run','confirmRemove','aboutToDisappear'];
  // Allow the same assertions to record the unmodified implementation's red.
  if(/^  private clearDeletedSelection\(/m.test(source))names.push('clearDeletedSelection');
  const script=ts.transpileModule(`class Page {\n${names.map(n=>method(source,n)).join('\n')}\n}\nmodule.exports=Page;`,
    {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const item={name:'take-'+'a'.repeat(32)},originalName=item.name;
  let head={operation:'upsert'},removes=0,cancelled=0,page;
  const dialogs=[],toasts=[];
  const recordings={items:[item],active,note:'synthetic recording idle',changed(){},remove:target=>{
    removes++;assert.equal(target.name,originalName,'delete must retain the confirmed identity');
    if(failure==='tombstone')throw new Error('synthetic tombstone write failure');
    head={operation:'delete'};
    if(leaveDuringRemoval)page.aboutToDisappear();
    if(failure==='cleanup')throw new Error('synthetic cleanup failure after tombstone');
    recordings.note='synthetic recording deletion committed';
  }};
  const materials={idFor:(kind,name)=>`${kind}/${name}`,read:id=>{
    if(unreadableHead)throw new Error('synthetic head read failure');
    assert.equal(id,`recording/${originalName}`);return head;
  }};
  const playbackCalls=[],localPlayback={stopSource:(kind,name)=>{playbackCalls.push(['stop-source',kind,name]);return Promise.resolve({});},suspend:reason=>{playbackCalls.push(['suspend',reason]);return Promise.resolve({});}};
  const module={exports:{}};
  vm.runInNewContext(script,{module,exports:module.exports,localPlayback,recordings,materials,
    cancelRecordingCloudTranscription:()=>{cancelled++;}});
  page=new module.exports();
  Object.assign(page,{playbackUnsubscribe(){playbackCalls.push(['unsubscribe']);},visible:true,actionEpoch:1,busy:false,active:false,note:'existing page note',
    transcript:'synthetic selected recording body',textName:selected==='a'?originalName:'take-'+'b'.repeat(32),
    textRevision:7,fullText:true,
    getUIContext:()=>({showAlertDialog:dialog=>dialogs.push(dialog),getPromptAction:()=>({showToast:toast=>toasts.push(toast.message)})})});
  return{playbackCalls,page,item,recordings,dialogs,toasts,removes:()=>removes,cancelled:()=>cancelled,head:()=>head,
    detail:()=>({text:page.transcript,name:page.textName,revision:page.textRevision,full:page.fullText})};
}
function open(s){s.page.confirmRemove(s.item);assert.equal(s.dialogs.length,1);return s.dialogs[0];}
function cleared(s){assert.deepEqual(s.detail(),{text:'',name:'',revision:0,full:false});}

test('ordinary recording deletion clears the currently selected tombstoned transcript',async()=>{
  const s=fixture();open(s).secondaryButton.action();await settle();
  assert.equal(s.removes(),1);assert.equal(s.head().operation,'delete');cleared(s);
  assert.deepEqual(s.playbackCalls,[['stop-source','recording',s.item.name]]);
  assert.equal(s.page.note,'synthetic recording deletion committed');assert.equal(s.page.busy,false);
});
test('delete A preserves selected transcript B',async()=>{
  const s=fixture({selected:'b'}),before=s.detail();open(s).secondaryButton.action();await settle();
  assert.equal(s.head().operation,'delete');assert.deepEqual(s.detail(),before);
});
test('tombstone failure preserves the original transcript and failure message',async()=>{
  const s=fixture({failure:'tombstone'}),before=s.detail();open(s).secondaryButton.action();await settle();
  assert.equal(s.head().operation,'upsert');assert.deepEqual(s.detail(),before);
  assert.equal(s.page.note,'synthetic tombstone write failure');assert.deepEqual(s.toasts,[s.page.note]);
});
test('cleanup failure after tombstone clears A while retaining the original failure',async()=>{
  const s=fixture({failure:'cleanup'});open(s).secondaryButton.action();await settle();
  assert.equal(s.head().operation,'delete');cleared(s);
  assert.equal(s.page.note,'synthetic cleanup failure after tombstone');assert.deepEqual(s.toasts,[s.page.note]);
  assert.equal(s.page.busy,false);
});
test('left-page confirmation cannot initiate recording deletion',async()=>{
  const s=fixture(),before=s.detail(),dialog=open(s);s.page.aboutToDisappear();dialog.secondaryButton.action();await settle();
  assert.equal(s.removes(),0);assert.deepEqual(s.detail(),before);assert.equal(s.toasts.length,0);
});
test('old confirmation cannot initiate deletion after the page reappears',async()=>{
  const s=fixture(),before=s.detail(),dialog=open(s);s.page.aboutToDisappear();s.page.visible=true;s.page.actionEpoch++;
  dialog.secondaryButton.action();await settle();assert.equal(s.removes(),0);assert.deepEqual(s.detail(),before);
});
test('accepted deletion survives page leave without mutating the stale transcript or showing a toast',async()=>{
  const s=fixture({leaveDuringRemoval:true}),before=s.detail();open(s).secondaryButton.action();await settle();
  assert.equal(s.removes(),1);assert.equal(s.head().operation,'delete');assert.deepEqual(s.detail(),before);
  assert.equal(s.toasts.length,0);assert.equal(s.cancelled(),1);
});
test('live recording state prevents opening deletion even when the page active state is stale',()=>{
  const s=fixture({active:true});assert.equal(s.page.active,false);s.page.confirmRemove(s.item);
  assert.equal(s.dialogs.length,0);assert.equal(s.removes(),0);assert.equal(s.head().operation,'upsert');
});
test('a recording started after the dialog opened prevents source deletion at confirmation',async()=>{
  const s=fixture(),before=s.detail(),dialog=open(s);s.recordings.active=true;dialog.secondaryButton.action();await settle();
  assert.equal(s.removes(),0);assert.equal(s.head().operation,'upsert');assert.deepEqual(s.detail(),before);
  assert.match(s.page.note,/停止录音.*删除/);assert.deepEqual(s.toasts,[s.page.note]);assert.equal(s.page.busy,false);
});
test('a changed item identity is refused instead of deleting a different recording',async()=>{
  const s=fixture(),before=s.detail(),dialog=open(s);s.item.name='take-'+'b'.repeat(32);dialog.secondaryButton.action();await settle();
  assert.equal(s.removes(),0);assert.equal(s.head().operation,'upsert');assert.deepEqual(s.detail(),before);
  assert.match(s.page.note,/条目已变化.*刷新/);assert.deepEqual(s.toasts,[s.page.note]);
});
test('an unreadable canonical head does not falsely clear the selected transcript',async()=>{
  const s=fixture({unreadableHead:true}),before=s.detail();open(s).secondaryButton.action();await settle();
  assert.equal(s.head().operation,'delete');assert.deepEqual(s.detail(),before);
  assert.equal(s.page.note,'synthetic recording deletion committed');assert.equal(s.page.busy,false);
});
test('cancel never deletes or clears the selected recording',async()=>{
  const s=fixture(),before=s.detail();open(s).primaryButton.action();await settle();
  assert.equal(s.removes(),0);assert.deepEqual(s.detail(),before);assert.equal(s.toasts.length,0);
});
