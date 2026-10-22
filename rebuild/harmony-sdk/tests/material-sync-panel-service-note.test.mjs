import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {loadApp} from './load-app.mjs';

const require=createRequire(import.meta.url);
const deveco=process.env.DEVECO_HOME||'/Applications/DevEco-Studio.app/Contents';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/MaterialSyncPanel.ets',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));

// Load actual ordinary page event methods. Platform, Service and transport
// boundaries are explicit substitutes; ArkUI builders are not executed and
// these checks make no device, native Asset or cloud acceptance claim.
function method(name){
  const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);
  assert(match,`missing page method ${name}`);
  const after=source.slice(match.index+match[0].length);
  const next=/\n  (?:private |aboutTo|@Builder|build\()/.exec(after);
  assert(next,`missing boundary after ${name}`);
  return source.slice(match.index,match.index+match[0].length+next.index);
}
const names=['aboutToAppear','aboutToDisappear','pendingDirectory','pendingFile','current','cancelCheck',
  'clearDraft','changedDraft','copyTarget','sameTarget','matchesBinding','proposed','expectedExpiry',
  'failureText','refresh','load','importConnection','cleanupPending','save'];
const script=ts.transpileModule(`class Page {\n${names.map(method).join('\n')}\n}\nmodule.exports=Page;`,
  {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const {MaterialSyncTarget,validateMaterialSyncTarget}=loadApp('MaterialSyncTransport');
const {MaterialSyncSettings,validateMaterialSyncSettings}=loadApp('MaterialSyncSettings',{
  '@kit.AssetStoreKit':{asset:{query(){assert.fail('page must use the Service storage boundary');},add(){assert.fail('page must not write Asset directly');}}}
});
const now=Date.parse('2026-10-14T02:00:00.000Z'),expiry=now+7200000;
const unavailable='同步配置暂不可读，请解锁后重试；未覆盖已保存配置';
function target(letter='a'){
  return{baseUrl:'https://synthetic.invalid/io-api/v1',token:letter.repeat(43),
    principal:{ownerId:'synthetic-owner',producerId:'synthetic-phone',serverId:'synthetic-server'}};
}
function fixture(){
  const calls={loads:0,saves:[],checks:[],pickers:0,reads:[],unlinks:[],changed:0};
  let persisted={schema:1,enabled:true,target:target()},settingsHandler,saveHandler,pickerHandler,identityHandler;
  const files=new Map(),clients=[];
  class Client{
    constructor(){this.cancelled=0;this.lastIdentityStatus=0;clients.push(this);}
    cancel(){this.cancelled++;}
    async preflight(value,expected,schema){
      validateMaterialSyncTarget(value);calls.checks.push({target:clone(value),expected,schema});
      return identityHandler?identityHandler():{expires_at:new Date(expiry).toISOString()};
    }
  }
  const service={changed(){},settingsNote:'',
    async settings(){calls.loads++;return settingsHandler?settingsHandler():clone(persisted);},
    async save(value){
      const saved=clone(value);validateMaterialSyncSettings(saved);calls.saves.push(saved);
      if(saveHandler)await saveHandler();persisted=saved;this.changed();
    },
    summary(){return{enabled:persisted.enabled,foreground:true,busy:false,note:'ready',stored:32,queued:0,issues:0};},
    problems(){return[];},
    reload(){assert.fail('a status refresh must not reload saved settings');},
    syncNow(){assert.fail('a status refresh must not start or cancel synchronization');}
  };
  const fileIo={accessSync:path=>files.has(path),mkdirSync:path=>files.set(path,true),
    unlinkSync:path=>{assert(files.has(path));calls.unlinks.push(path);files.delete(path);}};
  const readImport=uri=>{calls.reads.push(uri);if(!files.has(uri))throw Error('SYNC_IMPORT_READ_FAILED');return clone(files.get(uri));};
  class DocumentViewPicker{async select(){calls.pickers++;return pickerHandler?pickerHandler():['content://synthetic/connection.json'];}}
  class ClockDate extends Date{static now(){return now;}}
  const module={exports:{}};
  vm.runInNewContext(script,{module,exports:module.exports,MaterialSyncTarget,MaterialSyncSettings,
    MaterialSyncTransport:Client,materialSyncService:service,readMaterialSyncImportFile:readImport,
    fs:fileIo,picker:{DocumentViewPicker},Date:ClockDate});
  const page=new module.exports();
  Object.assign(page,{visible:true,expanded:true,loaded:true,busy:false,loadGeneration:0,operation:'',
    lastServiceNote:'',syncEnabled:true,baseUrl:persisted.target.baseUrl,tokenEntry:'',hasSavedToken:true,
    owner:persisted.target.principal.ownerId,producer:persisted.target.principal.producerId,server:persisted.target.principal.serverId,
    boundTarget:clone(persisted.target),boundExpiry:0,credentialExpiry:0,verifiedTarget:undefined,
    pendingSource:false,pendingCandidate:undefined,identityClient:new Client(),summary:{},problems:[],note:'',
    onChanged(){calls.changed++;},getUIContext:()=>({getHostContext:()=>({filesDir:'/synthetic-app-private'})})});
  const candidate={target:target('b'),expiresAt:expiry,tokenId:'c0ffee00-0000-4000-8000-000000000001'};
  files.set(page.pendingFile(),clone(candidate));files.set('content://synthetic/connection.json',clone(candidate));
  page.aboutToAppear();service.settingsNote=unavailable;service.changed();assert.equal(page.note,unavailable);
  return{page,service,calls,clients,files,setSettings:handler=>{settingsHandler=handler;},setSave:handler=>{saveHandler=handler;},
    setPicker:handler=>{pickerHandler=handler;},setIdentity:handler=>{identityHandler=handler;}};
}
function stableState(f){
  return{loads:f.calls.loads,saves:f.calls.saves.length,checks:f.calls.checks.length,pickers:f.calls.pickers,
    reads:f.calls.reads.length,unlinks:f.calls.unlinks.length,cancels:f.clients.reduce((total,client)=>total+client.cancelled,0),
    baseUrl:f.page.baseUrl,owner:f.page.owner,producer:f.page.producer,server:f.page.server,tokenEntry:f.page.tokenEntry,
    syncEnabled:f.page.syncEnabled,loaded:f.page.loaded,busy:f.page.busy,operation:f.page.operation,
    generation:f.page.loadGeneration,expiry:f.page.credentialExpiry,hasSavedToken:f.page.hasSavedToken,
    privateBinding:JSON.stringify(f.page.boundTarget),privateCandidate:JSON.stringify(f.page.pendingCandidate)};
}
function recover(f){
  const before=stableState(f);f.service.settingsNote='';f.service.changed();assert.deepEqual(stableState(f),before);
  assert.equal(f.page.summary.stored,32);assert.equal(f.page.summary.queued,0);assert.equal(f.page.summary.issues,0);
}

test('Service recovery withdraws its stale notice without rereading settings or changing the draft',()=>{
  const f=fixture();recover(f);assert.equal(f.page.note,'');assert.equal(f.calls.loads,0);assert.equal(f.calls.checks.length,0);
});
test('repeated same Service notice and later recovery preserve actual changed-draft feedback',()=>{
  const f=fixture();f.page.baseUrl='https://changed.invalid/io-api/v1';f.page.changedDraft();const note=f.page.note;
  assert.match(note,/配置已修改/);f.service.changed();assert.equal(f.page.note,note);recover(f);assert.equal(f.page.note,note);
});
for(const fromComputer of [true,false]){
  test(`${fromComputer?'computer registration':'system picker'} import feedback survives repeated notice and recovery`,async()=>{
    const f=fixture();await f.page.importConnection(fromComputer);const note=f.page.note;assert.match(note,/尚未保存/);
    f.service.changed();assert.equal(f.page.note,note);recover(f);assert.equal(f.page.note,note);
    assert.equal(f.page.syncEnabled,false);assert.equal(f.page.tokenEntry,'');assert.equal(f.calls.saves.length,0);
  });
}
test('import identity failure feedback remains after the unrelated Service recovers',async()=>{
  const f=fixture();f.setIdentity(async()=>{throw Error('SYNC_SCHEMA_UNSUPPORTED');});await f.page.importConnection(true);
  const note=f.page.note;assert.match(note,/资料1.2/);recover(f);assert.equal(f.page.note,note);
});
test('cancelled picker feedback survives Service recovery without touching saved configuration',async()=>{
  const f=fixture();f.setPicker(async()=>[]);await f.page.importConnection(false);const note=f.page.note;
  assert.match(note,/已取消导入/);recover(f);assert.equal(f.page.note,note);assert.equal(f.calls.saves.length,0);
});
test('durable save success feedback is not erased by a healthy refresh',async()=>{
  const f=fixture();f.page.syncEnabled=false;f.setSave(()=>{f.service.settingsNote='';});await f.page.save();
  const note=f.page.note;assert.match(note,/同步已暂停/);f.service.changed();assert.equal(f.page.note,note);
  assert.equal(f.calls.saves.length,1);assert.equal(f.calls.loads,0);
});
test('failed explicit save feedback survives the unrelated Service recovery',async()=>{
  const f=fixture();f.page.syncEnabled=false;f.setSave(async()=>{throw Error('synthetic save failure');});await f.page.save();
  const note=f.page.note;assert.match(note,/重读实际配置/);recover(f);assert.equal(f.page.note,note);
});
test('successful explicit load stays clear after recovery without an extra configuration read',async()=>{
  const f=fixture();await f.page.load();assert.equal(f.page.note,'');recover(f);
  assert.equal(f.page.note,'');assert.equal(f.calls.loads,1);assert.equal(f.page.tokenEntry,'');
});
test('the page own load failure is not cleared merely because the Service recovers',async()=>{
  const f=fixture();f.setSettings(async()=>{throw Error('SYNC_SETTINGS_UNAVAILABLE');});await f.page.load();
  const note=f.page.note;assert.equal(note,'配置暂不可读，请解锁后重试；不会覆盖已有设置');recover(f);
  assert.equal(f.page.note,note);assert.equal(f.page.loaded,false);assert.equal(f.calls.loads,1);
});
test('a changed Service error is shown and its own notice is withdrawn on recovery',()=>{
  const f=fixture();f.service.settingsNote='同步配置未启用，请检查配置并重试';f.service.changed();
  assert.equal(f.page.note,f.service.settingsNote);recover(f);assert.equal(f.page.note,'');
});
test('reappearing after recovery withdraws the old Service notice without loading settings',()=>{
  const f=fixture();f.page.aboutToDisappear();f.service.settingsNote='';f.page.aboutToAppear();
  assert.equal(f.page.note,'');assert.equal(f.calls.loads,0);assert.equal(f.calls.checks.length,0);
});
