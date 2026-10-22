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
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

// Execute the actual ordinary page event methods, as in the manual transcription
// page checks. ArkUI builders and native observation are deliberately not run.
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
  '@kit.AssetStoreKit':{asset:{query(){assert.fail('page must use its service storage boundary');},add(){assert.fail('page must not write the vault directly');}}}
});
const now=Date.parse('2026-10-14T02:00:00.000Z');
const expiryA=now+3600000,expiryB=now+7200000;
function target(letter='a',owner='synthetic-owner'){
  return{baseUrl:'https://synthetic.invalid/io-api/v1',token:letter.repeat(43),
    principal:{ownerId:owner,producerId:'synthetic-phone',serverId:'synthetic-server'}};
}
const settings=(t=target(),enabled=true)=>({schema:1,enabled,target:clone(t)});
const candidate=(t=target('b'),expiresAt=expiryB,tokenId='c0ffee00-0000-4000-8000-000000000001')=>({target:clone(t),expiresAt,tokenId});
function identity(t,expiresAt=expiryB){
  return{schema_version:'1.0',owner_id:t.principal.ownerId,producer_id:t.principal.producerId,
    server_id:t.principal.serverId,scopes:['materials:write'],expires_at:new Date(expiresAt).toISOString(),
    material_schema_versions:['1.0','1.1','1.2']};
}

function fixture(config=settings()){
  const calls={loads:0,saves:[],checks:[],pickers:0,reads:[],unlinks:[],mkdirs:[],changed:0};
  let persisted=clone(config),settingsHandler,saveHandler,pickerHandler,identityHandler;
  const files=new Map(),clients=[];
  class Client{
    constructor(){this.cancelled=0;this.lastIdentityStatus=0;clients.push(this);}
    cancel(){this.cancelled++;}
    async preflight(t,expected,schema){
      // The production target validator also prevents an empty cached bearer
      // from reaching the explicit substitute for the HTTP boundary.
      validateMaterialSyncTarget(t);
      const request={target:clone(t),expected,schema,client:this};calls.checks.push(request);
      return identityHandler?identityHandler(request):identity(t);
    }
  }
  const service={changed(){},settingsNote:'',
    async settings(){calls.loads++;return settingsHandler?settingsHandler():clone(persisted);},
    async save(value){
      const snapshot=clone(value);validateMaterialSyncSettings(snapshot);calls.saves.push(snapshot);
      if(saveHandler)await saveHandler(snapshot);
      persisted=snapshot;this.changed();
    },
    summary(){return{enabled:persisted.enabled,foreground:true,busy:false,note:'ready'};},
    problems(){return[];}
  };
  const fileIo={
    accessSync:path=>files.has(path),
    mkdirSync:path=>{calls.mkdirs.push(path);files.set(path,true);},
    unlinkSync:path=>{assert(files.has(path),'only an existing fixed candidate can be removed');calls.unlinks.push(path);files.delete(path);}
  };
  const readImport=uri=>{
    calls.reads.push(uri);if(!files.has(uri))throw Error('SYNC_IMPORT_READ_FAILED');
    return clone(files.get(uri));
  };
  class DocumentViewPicker{
    async select(options){calls.pickers++;assert.equal(options.maxSelectNumber,1);return pickerHandler?pickerHandler():['content://synthetic/connection.json'];}
  }
  class ClockDate extends Date{static now(){return now;}}
  const module={exports:{}};
  vm.runInNewContext(script,{module,exports:module.exports,MaterialSyncTarget,MaterialSyncSettings,
    MaterialSyncTransport:Client,materialSyncService:service,readMaterialSyncImportFile:readImport,
    fs:fileIo,picker:{DocumentViewPicker},Date:ClockDate});
  const page=new module.exports();
  Object.assign(page,{visible:true,expanded:true,loaded:true,busy:false,loadGeneration:0,operation:'',
    syncEnabled:config.enabled,baseUrl:config.target.baseUrl,tokenEntry:'',hasSavedToken:!!config.target.token,
    owner:config.target.principal.ownerId,producer:config.target.principal.producerId,server:config.target.principal.serverId,
    boundTarget:clone(config.target),boundExpiry:0,credentialExpiry:0,verifiedTarget:undefined,
    pendingSource:false,pendingCandidate:undefined,identityClient:new Client(),summary:{},problems:[],note:'',
    onChanged(){calls.changed++;},getUIContext:()=>({getHostContext:()=>({filesDir:'/app-private'})})});
  const pending=page.pendingFile(),picked='content://synthetic/connection.json';
  files.set(pending,candidate());files.set(picked,candidate());
  return{page,service,calls,files,clients,pending,picked,config,
    saved:()=>clone(persisted),setSettings:f=>settingsHandler=f,setSave:f=>saveHandler=f,
    setPicker:f=>pickerHandler=f,setIdentity:f=>identityHandler=f};
}

test('a late vault load cannot replace a new page load or copy a saved bearer into reactive input',async()=>{
  const f=fixture(),old=deferred(),next=deferred();let reads=0;
  f.setSettings(()=>++reads===1?old.promise:next.promise);
  const first=f.page.load();await turn();f.page.aboutToDisappear();f.page.aboutToAppear();
  const second=f.page.load();next.resolve(settings(target('c','synthetic-new-owner'),false));await second;
  old.resolve(f.config);await first;
  assert.equal(f.page.owner,'synthetic-new-owner');assert.equal(f.page.boundTarget.token,'c'.repeat(43));
  assert.equal(f.page.tokenEntry,'');assert.equal(f.page.loaded,true);assert.equal(f.page.busy,false);
  assert.equal(f.calls.saves.length,0);assert.equal(f.calls.checks.length,0);
});

test('a late picker completion after collapse cannot read credentials, preview identity or save',async()=>{
  const f=fixture(),pick=deferred();f.setPicker(()=>pick.promise);
  const work=f.page.importConnection(false);await turn();
  f.page.expanded=false;f.page.clearDraft();pick.resolve([f.picked]);await work;
  assert.equal(f.calls.reads.length,0);assert.equal(f.calls.checks.length,0);assert.equal(f.calls.saves.length,0);
  assert.equal(f.page.boundTarget,undefined);assert.equal(f.page.busy,false);assert.equal(f.page.tokenEntry,'');
  assert.deepEqual(f.saved(),f.config);
});

test('a cancelled picker leaves the active saved configuration and imported file untouched',async()=>{
  const f=fixture();f.setPicker(async()=>[]);await f.page.importConnection(false);
  assert.equal(f.calls.reads.length,0);assert.equal(f.calls.checks.length,0);assert.equal(f.calls.saves.length,0);
  assert.equal(f.calls.unlinks.length,0);assert(f.files.has(f.pending));assert.deepEqual(f.saved(),f.config);
});

test('a late imported identity cannot overwrite a new vault load after leaving and returning',async()=>{
  const f=fixture(),check=deferred();f.setIdentity(()=>check.promise);
  const work=f.page.importConnection(true);await turn();const oldClient=f.calls.checks[0].client;
  f.page.aboutToDisappear();assert(oldClient.cancelled>0);f.page.aboutToAppear();
  const replacement=settings(target('c','synthetic-reloaded-owner'),false);f.setSettings(async()=>replacement);
  await f.page.load();check.resolve(identity(target('b')));await work;
  assert.equal(f.page.owner,'synthetic-reloaded-owner');assert.equal(f.page.boundTarget.token,'c'.repeat(43));
  assert.equal(f.page.pendingCandidate,undefined);assert.equal(f.page.verifiedTarget,undefined);
  assert.equal(f.page.tokenEntry,'');assert.equal(f.page.busy,false);assert.equal(f.calls.saves.length,0);
});

test('both import entrances only preview the private candidate, default its draft off and preserve existing sync',async()=>{
  for(const fromComputer of [false,true]){
    const f=fixture();await f.page.importConnection(fromComputer);
    assert.equal(f.calls.reads[0],fromComputer?f.pending:f.picked);
    assert.equal(f.calls.checks.length,1);assert.equal(f.calls.checks[0].schema,'1.2');
    assert.equal(f.calls.checks[0].expected,new Date(expiryB).toISOString());
    assert.equal(f.page.boundTarget.token,'b'.repeat(43));assert.equal(f.page.tokenEntry,'');
    assert.equal(f.page.syncEnabled,false);assert.equal(f.page.credentialExpiry,expiryB);
    assert.equal(f.calls.saves.length,0);assert.equal(f.calls.unlinks.length,0);assert.deepEqual(f.saved(),f.config);
  }
});

test('an edited endpoint cannot reuse the privately cached bearer or send it for preview',async()=>{
  const f=fixture();f.page.baseUrl='https://changed.invalid/io-api/v1';f.page.changedDraft();
  assert.equal(f.page.proposed().token,'');assert.equal(f.page.verifiedTarget,undefined);
  await f.page.save();assert.equal(f.calls.checks.length,0);assert.equal(f.calls.saves.length,0);
  assert.deepEqual(f.saved(),f.config);
});

test('enabled save keeps the accepted A target snapshot even if draft fields become B while identity is pending',async()=>{
  const f=fixture(),check=deferred();f.setIdentity(()=>check.promise);
  const work=f.page.save();await turn();const accepted=clone(f.calls.checks[0].target);
  f.page.baseUrl='https://later.invalid/io-api/v1';f.page.owner='synthetic-later-owner';f.page.tokenEntry='c'.repeat(43);
  check.resolve(identity(accepted));await work;
  assert.equal(f.calls.saves.length,1);assert.deepEqual(f.calls.saves[0].target,accepted);
  assert.deepEqual(f.saved().target,accepted);assert.equal(f.page.tokenEntry,'');
});

test('a late save identity reply cannot call the durable service after page leave and a new load',async()=>{
  const f=fixture(),check=deferred();f.setIdentity(()=>check.promise);
  const work=f.page.save();await turn();const proposed=clone(f.calls.checks[0].target);
  assert.equal(f.calls.saves.length,0);f.page.aboutToDisappear();f.page.aboutToAppear();
  const replacement=settings(target('c','synthetic-current-owner'),false);f.setSettings(async()=>replacement);
  await f.page.load();check.resolve(identity(proposed));await work;
  assert.equal(f.calls.saves.length,0);assert.equal(f.page.owner,'synthetic-current-owner');
  assert.equal(f.page.boundTarget.token,'c'.repeat(43));assert.equal(f.page.verifiedTarget,undefined);
  assert.equal(f.page.tokenEntry,'');assert.equal(f.page.busy,false);assert.deepEqual(f.saved(),f.config);
});

test('replaced bearer E2 retains its own expiry on the next enabled save instead of the old import expiry',async()=>{
  const f=fixture();f.page.boundExpiry=expiryA;f.page.tokenEntry='b'.repeat(43);
  f.setIdentity(request=>identity(request.target,expiryB));await f.page.save();
  assert.equal(f.page.boundExpiry,expiryB);assert.equal(f.page.credentialExpiry,expiryB);assert.equal(f.page.tokenEntry,'');
  assert.equal(f.calls.checks[0].expected,undefined);await f.page.save();
  assert.equal(f.calls.checks[1].expected,new Date(expiryB).toISOString());assert.equal(f.calls.saves.length,2);
});

test('a disabled replacement saves without network and clears the expiry bound to the old bearer',async()=>{
  const f=fixture();f.page.boundExpiry=expiryA;f.page.credentialExpiry=expiryA;f.page.tokenEntry='b'.repeat(43);f.page.syncEnabled=false;
  f.setIdentity(()=>{assert.fail('pausing must not depend on a working network');});await f.page.save();
  assert.equal(f.calls.checks.length,0);assert.equal(f.calls.saves.length,1);assert.equal(f.saved().enabled,false);
  assert.equal(f.saved().target.token,'b'.repeat(43));assert.equal(f.page.boundExpiry,0);assert.equal(f.page.credentialExpiry,0);
});

test('leaving after explicit service acceptance fences UI and cleanup while the durable accepted save continues',async()=>{
  const f=fixture(),save=deferred();await f.page.importConnection(true);f.page.syncEnabled=true;
  f.setSave(()=>save.promise);const work=f.page.save();await turn();assert.equal(f.calls.saves.length,1);
  const accepted=clone(f.calls.saves[0]);f.page.aboutToDisappear();const hiddenNote=f.page.note;
  save.resolve();await work;
  assert.deepEqual(f.saved(),accepted);assert.equal(f.page.note,hiddenNote);assert.equal(f.page.boundTarget,undefined);
  assert.equal(f.calls.unlinks.length,0);assert(f.files.has(f.pending));assert.equal(f.page.tokenEntry,'');
});

test('pending cleanup deletes only the unchanged fixed candidate after successful current save, never picker input',async()=>{
  for(const mode of ['unchanged','changed','picker']){
    const f=fixture();await f.page.importConnection(mode!=='picker');f.page.syncEnabled=true;
    if(mode==='changed')f.files.set(f.pending,candidate(target('b'),expiryB,'c0ffee00-0000-4000-8000-000000000002'));
    await f.page.save();assert.equal(f.calls.saves.length,1);
    assert.deepEqual(f.calls.unlinks,mode==='unchanged'?[f.pending]:[]);
    assert(f.files.has(f.picked));assert.equal(f.files.has(f.pending),mode!=='unchanged');
  }
});

test('preflight failure never saves or clears old configuration, and accepted save failure requests actual reread',async()=>{
  const failedCheck=fixture();failedCheck.setIdentity(()=>{throw Error('SYNC_IDENTITY_MISMATCH');});
  await failedCheck.page.save();assert.equal(failedCheck.calls.saves.length,0);assert.deepEqual(failedCheck.saved(),failedCheck.config);
  assert.equal(failedCheck.calls.unlinks.length,0);
  const failedSave=fixture();await failedSave.page.importConnection(true);failedSave.page.syncEnabled=true;
  failedSave.setSave(()=>{throw Error('synthetic storage unavailable');});await failedSave.page.save();
  assert.equal(failedSave.calls.saves.length,1);assert.match(failedSave.page.note,/重读实际配置/);
  assert(!failedSave.page.note.includes('synthetic'));assert.deepEqual(failedSave.saved(),failedSave.config);
  assert.equal(failedSave.calls.unlinks.length,0);assert(failedSave.files.has(failedSave.pending));assert.equal(failedSave.page.busy,false);
});
