import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

// Run ordinary ArkUI page event methods. Native observation and hardware
// business/file replies are separate acceptance, not provided by this harness.
const require=createRequire(import.meta.url),deveco=process.env.DEVECO_HOME||'D:/APP/DevEcoStudio';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(process.env.TELEPROMPTER_PANEL_SOURCE||new URL('../entry/src/main/ets/pages/TeleprompterPanel.ets',import.meta.url),'utf8');
function method(name){
  const match=new RegExp(`^  (?:private )?${name}\\(`,'m').exec(source);if(!match)return '';
  const tail=source.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|build\()/.exec(tail);
  assert(next,`method boundary ${name}`);return source.slice(match.index,match.index+match[0].length+next.index);
}
const script=ts.transpileModule(`class Page {\n${['aboutToAppear','aboutToDisappear','refresh','remember','choose','saveManuscript','run'].map(method).join('\n')}\n}\nmodule.exports=Page;`,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const turn=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(){
  const draft={title:'synthetic title',text:'synthetic body',speed:180,confirmedSpeed:120,busy:false,note:'',changed(){}};
  const session={phase:'running',note:'device-reported state',progress:100,offset:31,speed:120,changed(){},stop:async()=>{session.stops++;},stops:0};
  const entries=[{id:'synthetic-old',kind:'manuscript',title:'old',text:'old body'}],writes=[];let saving;
  const workspace={entries,async manuscript(title,text){writes.push({title,text});if(saving)await saving;entries.unshift({id:'synthetic-new',kind:'manuscript',title,text});}};
  const catalog={note:'synthetic catalog state',changed(){}};
  const module={exports:{}};vm.runInNewContext(script,{module,exports:module.exports,teleprompter:session,teleprompterDraft:draft,teleprompterCatalog:catalog,localWorkspace:workspace});
  const mount=()=>{const page=new module.exports();Object.assign(page,{visible:false,title:'',text:'',speed:120,busy:false,phase:'idle',note:'',progress:0,readOffset:0,manuscripts:[]});page.aboutToAppear();return page;};
  return{draft,session,workspace,catalog,writes,mount,saveWait:promise=>saving=promise};
}
test('switching ordinary pages preserves the unsaved document and running session without sending exit',()=>{
  const f=fixture(),first=f.mount();assert.equal(first.title,f.draft.title);assert.equal(first.text,f.draft.text);
  first.aboutToDisappear();assert.equal(f.session.stops,0);
  const next=f.mount();assert.equal(next.text,'synthetic body');assert.equal(next.phase,'running');assert.equal(next.readOffset,31);assert.equal(next.speed,180);
});
test('save completes after a page switch and refreshes the new page list without losing its operation state',async()=>{
  const f=fixture(),save=deferred();f.session.phase='idle';f.saveWait(save.promise);const first=f.mount();first.saveManuscript();await turn();
  assert.equal(first.busy,true);first.aboutToDisappear();const next=f.mount();assert.equal(next.busy,true);
  next.run(async()=>assert.fail('the same process must not start a second operation'));
  save.resolve();await turn();assert.equal(next.busy,false);assert.equal(next.manuscripts.length,2);assert.equal(next.manuscripts[0].text,'synthetic body');
  assert.equal(f.writes.length,1);assert.match(next.note,/稿件已保存/);assert.equal(f.session.stops,0);
});
test('failed save after navigation is visible on return and does not add a manuscript',async()=>{
  const f=fixture(),save=deferred();f.session.phase='idle';f.saveWait(save.promise);const first=f.mount();first.saveManuscript();await turn();
  first.aboutToDisappear();save.reject(Error('synthetic durable store failure'));await turn();const next=f.mount();
  assert.equal(next.note,'synthetic durable store failure');assert.equal(next.busy,false);assert.equal(next.manuscripts.length,1);
});
test('confirmed device speed updates the editor, while unrelated progress leaves an unsent slider value intact',()=>{
  const f=fixture(),page=f.mount();f.session.offset=62;f.session.changed();assert.equal(page.speed,180);
  f.session.speed=90;f.session.changed();assert.equal(page.speed,90);assert.equal(f.draft.speed,90);
  page.aboutToDisappear();const next=f.mount();assert.equal(next.speed,90);
});
test('selecting a saved manuscript preserves exact text across remount and cannot replace the active manuscript',()=>{
  const f=fixture();f.session.phase='idle';const page=f.mount();page.choose(0);assert.equal(f.draft.text,'old body');
  page.aboutToDisappear();const next=f.mount();assert.equal(next.text,'old body');
  f.session.phase='running';f.session.changed();f.workspace.entries.unshift({kind:'manuscript',title:'new',text:'new body'});next.refresh();next.choose(0);assert.equal(next.text,'old body');
});
test('leaving the page detaches render callbacks without stopping ability-level routing',()=>{
  const f=fixture(),page=f.mount();page.aboutToDisappear();f.session.phase='paused';f.session.changed();assert.equal(page.phase,'running');
  const next=f.mount();assert.equal(next.phase,'paused');assert.equal(f.session.stops,0);
});
test('workspace finishes loading while the editor is visible and publishes saved manuscripts without a remount',()=>{
  const f=fixture();f.workspace.entries.length=0;const page=f.mount();assert.equal(page.manuscripts.length,0);
  f.workspace.entries.push({kind:'manuscript',title:'loaded',text:'loaded body'});f.workspace.changed();assert.equal(page.manuscripts.length,1);
  page.aboutToDisappear();f.workspace.entries.push({kind:'manuscript',title:'later',text:'later body'});f.workspace.changed();assert.equal(page.manuscripts.length,1);
});
test('catalog observations refresh only the currently visible ordinary page',()=>{
 const f=fixture(),first=f.mount();assert.equal(first.catalogNote,'synthetic catalog state');first.aboutToDisappear();
 f.catalog.note='later observation';f.catalog.changed();assert.equal(first.catalogNote,'synthetic catalog state');
 const next=f.mount();assert.equal(next.catalogNote,'later observation');f.catalog.note='current observation';f.catalog.changed();assert.equal(next.catalogNote,'current observation');
});
