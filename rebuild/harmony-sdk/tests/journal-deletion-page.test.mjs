import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const deveco=process.env.DEVECO_HOME||'/Applications/DevEco-Studio.app/Contents';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const settle=()=>new Promise(resolve=>setImmediate(resolve));

// Exercise the ordinary page's actual event methods, with explicit service and
// UI substitutes. These are event/lifecycle checks, not native UI acceptance or
// a replacement for MaterialDeletion's real store/filesystem regression.
function method(source,name){
  const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);
  assert(match,`missing page method ${name}`);
  const after=source.slice(match.index+match[0].length);
  const next=/\n  (?:private |aboutTo|@Builder|build\()/.exec(after);
  assert(next,`missing boundary after ${name}`);
  return source.slice(match.index,match.index+match[0].length+next.index);
}
function fixture({kind='lifelog',failure='',selected='a',leaveDuringRemoval=false,unreadableHead=false}={}){
  const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/JournalPanel.ets',import.meta.url),'utf8');
  const names=['run','confirmRemove','aboutToDisappear'];
  // This keeps the baseline red executable before the helper is implemented.
  if(/^  private clearDeletedSelection\(/m.test(source))names.push('clearDeletedSelection');
  const script=ts.transpileModule(`class Page {\n${names.map(n=>method(source,n)).join('\n')}\n}\nmodule.exports=Page;`,
    {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const item={name:(kind==='lifelog'?'seg-':'take-')+'a'.repeat(32)};
  const otherName=(kind==='lifelog'?'seg-':'take-')+'b'.repeat(32);
  const row={kind,[kind==='lifelog'?'lifelogItem':'recordingItem']:item};
  let head={operation:'upsert'},removes=0,refreshes=0,cancelled=0;
  const dialogs=[],toasts=[],removedNames=[];
  let page;
  const remove=target=>{
    removes++;removedNames.push(target.name);
    if(failure==='tombstone')throw new Error('synthetic tombstone write failure');
    head={operation:'delete'};
    if(leaveDuringRemoval)page.aboutToDisappear();
    if(failure==='cleanup')throw new Error('synthetic cleanup failure after tombstone');
  };
  const lifelog={items:kind==='lifelog'?[item]:[],changed(){},remove},recordings={items:kind==='recording'?[item]:[],changed(){},remove},lifelogASR={changed(){}};
  const materials={idFor:(type,name)=>`${type}/${name}`,read:id=>{
    if(unreadableHead)throw new Error('synthetic head read failure');
    assert.equal(id,`${kind}/${item.name}`);return head;
  }};
  const playbackCalls=[],localPlayback={stopSource:(kind,name)=>{playbackCalls.push(['stop-source',kind,name]);return Promise.resolve({});},suspend:reason=>{playbackCalls.push(['suspend',reason]);return Promise.resolve({});}};
  const module={exports:{}};
  vm.runInNewContext(script,{module,exports:module.exports,localPlayback,lifelog,recordings,lifelogASR,materials,
    cancelRecordingCloudTranscription:()=>{cancelled++;},cancelLifelogManualPublication:()=>{cancelled++;}});
  page=new module.exports();
  Object.assign(page,{playbackUnsubscribe(){playbackCalls.push(['unsubscribe']);},visible:true,actionEpoch:1,busy:false,note:'existing note',text:'synthetic selected body',
    textKind:kind,textName:selected==='a'?item.name:otherName,textRevision:7,textNeedsFull:true,fullText:true,
    refresh:()=>{refreshes++;},
    getUIContext:()=>({showAlertDialog:dialog=>dialogs.push(dialog),getPromptAction:()=>({showToast:toast=>toasts.push(toast.message)})})});
  return{playbackCalls,page,row,item,dialogs,toasts,removedNames,removes:()=>removes,refreshes:()=>refreshes,cancelled:()=>cancelled,
    head:()=>head,detail:()=>({text:page.text,kind:page.textKind,name:page.textName,revision:page.textRevision,
      needsFull:page.textNeedsFull,full:page.fullText})};
}
function open(s){s.page.confirmRemove(s.row);assert.equal(s.dialogs.length,1);return s.dialogs[0];}
function cleared(s){assert.deepEqual(s.detail(),{text:'',kind:'',name:'',revision:0,needsFull:false,full:false});}

for(const kind of ['lifelog','recording']){
  test(`ordinary Journal ${kind} delete clears only its selected tombstoned detail`,async()=>{
    const s=fixture({kind});open(s).secondaryButton.action();await settle();
    assert.equal(s.removes(),1);assert.equal(s.head().operation,'delete');cleared(s);
    assert.deepEqual(s.playbackCalls,[['stop-source',kind,s.item.name]]);
    assert.equal(s.page.note,'existing note');assert.equal(s.page.busy,false);
  });
}
test('delete A preserves the currently selected detail B',async()=>{
  const s=fixture({selected:'b'}),before=s.detail();open(s).secondaryButton.action();await settle();
  assert.equal(s.removes(),1);assert.equal(s.head().operation,'delete');assert.deepEqual(s.detail(),before);
});
test('tombstone failure preserves source detail and the original failure message',async()=>{
  const s=fixture({failure:'tombstone'}),before=s.detail();open(s).secondaryButton.action();await settle();
  assert.equal(s.head().operation,'upsert');assert.deepEqual(s.detail(),before);
  assert.equal(s.page.note,'synthetic tombstone write failure');assert.deepEqual(s.toasts,[s.page.note]);
});
test('cleanup failure after the durable tombstone clears A but preserves the failure message',async()=>{
  const s=fixture({failure:'cleanup'});open(s).secondaryButton.action();await settle();
  assert.equal(s.head().operation,'delete');cleared(s);
  assert.equal(s.page.note,'synthetic cleanup failure after tombstone');assert.deepEqual(s.toasts,[s.page.note]);
  assert.equal(s.page.busy,false);
});
test('confirming after leaving the page cannot start deletion',async()=>{
  const s=fixture(),before=s.detail(),dialog=open(s);s.page.aboutToDisappear();dialog.secondaryButton.action();await settle();
  assert.equal(s.removes(),0);assert.deepEqual(s.detail(),before);assert.equal(s.toasts.length,0);
});
test('an old dialog cannot delete after the same page instance reappears',async()=>{
  const s=fixture(),before=s.detail(),dialog=open(s);s.page.aboutToDisappear();s.page.visible=true;s.page.actionEpoch++;
  dialog.secondaryButton.action();await settle();assert.equal(s.removes(),0);assert.deepEqual(s.detail(),before);
});
test('page leave after deletion is accepted suppresses stale detail updates and toasts',async()=>{
  const s=fixture({leaveDuringRemoval:true}),before=s.detail();open(s).secondaryButton.action();await settle();
  assert.equal(s.removes(),1);assert.equal(s.head().operation,'delete');assert.deepEqual(s.detail(),before);
  assert.equal(s.toasts.length,0);assert.equal(s.cancelled(),2);
});
test('the dialog captures the intended source even if a row reference is reused',async()=>{
  const s=fixture(),dialog=open(s),intended=s.item.name;
  s.row.kind='recording';s.row.lifelogItem=undefined;s.row.recordingItem={name:'take-'+'b'.repeat(32)};
  dialog.secondaryButton.action();await settle();assert.deepEqual(s.removedNames,[intended]);cleared(s);
});
test('unreadable canonical head does not falsely clear the selected detail',async()=>{
  const s=fixture({unreadableHead:true}),before=s.detail();open(s).secondaryButton.action();await settle();
  assert.equal(s.head().operation,'delete');assert.deepEqual(s.detail(),before);
  assert.equal(s.page.note,'existing note');assert.equal(s.page.busy,false);
});
test('cancel preserves the selected detail and does not call source deletion',async()=>{
  const s=fixture(),before=s.detail();open(s).primaryButton.action();await settle();
  assert.equal(s.removes(),0);assert.deepEqual(s.detail(),before);assert.equal(s.toasts.length,0);
});
