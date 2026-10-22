import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';import {loadApp} from './load-app.mjs';
const require=createRequire(import.meta.url),ts=require(`${process.env.DEVECO_HOME||'D:/APP/DevEcoStudio'}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/LibraryPanel.ets',import.meta.url),'utf8');
function method(name){const m=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);assert(m);const after=source.slice(m.index+m[0].length),next=/\n  (?:private |aboutTo|@Builder|build\()/.exec(after);assert(next);return source.slice(m.index,m.index+m[0].length+next.index);}
const compiled=ts.transpileModule(`class Page {\n${['aboutToAppear','aboutToDisappear','refresh','confirmManuscript','manuscriptAction','chooseManuscript','removeManuscript','saveManuscript','readManuscriptText'].map(method).join('\n')}\n}\nmodule.exports=Page;`,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};},tick=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
async function fixture(){let raw='',rid=0,data=new TextEncoder().encode('中文稿\n第二行😀'),offset=0,closed=0;const scratch=[];
 let backup='';const prefs={get:async(k,d)=>k==='data'?raw:(k==='data_v1_backup'?backup:d),put:async(k,v)=>{if(k==='data')raw=v;else if(k==='data_v1_backup')backup=v;},flush:async()=>{}};
 const module=loadApp('LocalWorkspace',{'@kit.AbilityKit':{},'@kit.ArkData':{preferences:{getPreferences:async()=>prefs}},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(++rid)})})}}});
 const store=new module.LocalWorkspace();await store.load({});const {ManuscriptEditor}=loadApp('ManuscriptEditor',{'./LocalWorkspace':{...module,localWorkspace:store}}),editor=new ManuscriptEditor(store);
 let picked=Promise.resolve(['synthetic-uri']),dialog=Promise.resolve({index:1}),changedSize=false;
 const fileIo={OpenMode:{READ_ONLY:1},openSync(){offset=0;return{fd:8};},statSync(){return{size:data.length+(changedSize&&offset?1:0)};},readSync(fd,buffer){scratch.push(new Uint8Array(buffer));const n=Math.min(5,data.length-offset);new Uint8Array(buffer).set(data.slice(offset,offset+n));offset+=n;return n;},closeSync(){closed++;}};
 const picker={DocumentViewPicker:class{async select(options){assert.equal(options.maxSelectNumber,1);assert.equal(options.fileSuffixFilters[0],'纯文本|.txt,.md');return picked;}}};
 const decoder=class{constructor(name,options){this.decoder=new TextDecoder(name,options);}decodeToString(bytes){return this.decoder.decode(bytes);}};
 const exported={exports:{}};vm.runInNewContext(compiled,{module:exported,exports:exported.exports,localWorkspace:store,manuscriptEditor:editor,probeSession:{features:{state:{connected:false}}},fs:fileIo,picker,util:{TextDecoder:decoder},Uint8Array,ArrayBuffer});
 const mount=()=>{const page=new exported.exports();Object.assign(page,{category:'资料',visible:false,busy:false,onManuscriptEditorRequest(){page.scrolls++;},scrolls:0,getUIContext:()=>({getHostContext:()=>({}),getPromptAction:()=>({showDialog:()=>dialog})})});page.aboutToAppear();return page;};
 return{store,editor,prefs,mount,scratch,closed:()=>closed,fileIo,setData:v=>data=v,pick:p=>picked=p,dialog:p=>dialog=p,grow:()=>changedSize=true};
}
test('ordinary save event remounts into the same busy draft and reports committed row on new page',async()=>{
 const t=await fixture(),gate=defer();t.editor.setTitle('合成');t.editor.setText('正文');t.prefs.flush=()=>gate.promise;const first=t.mount();first.saveManuscript();await tick();assert(first.manuscriptBusy);first.aboutToDisappear();const next=t.mount();assert(next.manuscriptBusy);next.saveManuscript();gate.resolve();await tick();assert.equal(t.store.entries.length,1);assert(!next.manuscriptBusy);assert.equal(next.manuscriptText,'正文');assert(next.manuscriptId);assert.match(next.manuscriptNote,/已保存/);
});
test('ordinary picker reads exact UTF-8 with partial reads and late completion reaches new page',async()=>{
 const t=await fixture(),gate=defer();t.pick(gate.promise);const first=t.mount();first.manuscriptAction(()=>t.editor.importText(()=>first.readManuscriptText(),async()=>true));await tick();first.aboutToDisappear();const next=t.mount();assert(next.manuscriptBusy);gate.resolve(['synthetic-uri']);await tick();assert.equal(next.manuscriptText,'中文稿\n第二行😀');assert.equal(t.store.entries.length,0);assert.equal(t.closed(),1);assert(t.scratch.every(a=>a.every(b=>b===0)));assert(!next.manuscriptBusy);
});
test('invalid UTF-8 and file growth reject import while retaining draft and closing descriptor',async()=>{
 for(const kind of ['invalid','growth']){const t=await fixture();t.editor.setText('保留');const page=t.mount();if(kind==='invalid')t.setData(Uint8Array.of(0xff,0xfe));else t.grow();await assert.rejects(t.editor.importText(()=>page.readManuscriptText(),async()=>true));assert.equal(t.editor.text,'保留');assert.equal(t.closed(),1);assert(t.scratch.every(a=>a.every(b=>b===0)));assert(!t.editor.busy);}
});
test('ordinary edit action chooses owned row and requests parent to show editor',async()=>{
 const t=await fixture();const row=await t.store.saveManuscript('',0,'待修改','正文');const page=t.mount();page.chooseManuscript(row);await tick();assert.equal(page.manuscriptId,row.id);assert.equal(page.manuscriptRevision,1);assert.equal(page.scrolls,1);
});
