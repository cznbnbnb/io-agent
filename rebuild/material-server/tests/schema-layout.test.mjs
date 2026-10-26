import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const source=fileURLToPath(new URL('../',import.meta.url));
const names=['event-v1.schema.json','event-v1.1.schema.json','event-v1.2.schema.json'];
async function fixture(t,{local=true,marker=true}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'io-schema-layout-')),runtime=path.join(root,'rebuild/material-server'),shared=path.join(root,'docs/contracts');
  fs.mkdirSync(runtime,{recursive:true});fs.mkdirSync(shared,{recursive:true});
  for(const n of ['validation.mjs','json.mjs'])fs.copyFileSync(path.join(source,n),path.join(runtime,n));
  fs.symlinkSync(path.join(source,'node_modules'),path.join(runtime,'node_modules'),'dir');
  const files={};if(local)fs.mkdirSync(path.join(runtime,'contracts'));
  for(const n of names){const data=fs.readFileSync(new URL('../../../docs/contracts/'+n,import.meta.url));files[n]=createHash('sha256').update(data).digest('hex');
    fs.writeFileSync(path.join(shared,n),data);if(local)fs.writeFileSync(path.join(runtime,'contracts',n),data);}
  if(marker)fs.writeFileSync(path.join(runtime,'release-contracts.json'),JSON.stringify({schema:1,files}));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return{root,runtime,shared,files,api:await import(pathToFileURL(path.join(runtime,'validation.mjs')))};
}
test('source and historical layouts continue using their shared schemas',async t=>{
  const f=await fixture(t,{local:false,marker:false});assert.equal(typeof f.api.createValidator(),'function');assert.equal(typeof f.api.createQueueValidator(),'function');
});
test('release-local contracts are used even when shared schemas are unusable',async t=>{
  const f=await fixture(t);for(const n of names)fs.writeFileSync(path.join(f.shared,n),'broken shared schema');
  assert.equal(typeof f.api.createValidator(),'function');assert.equal(typeof f.api.createQueueValidator(),'function');
});
test('missing or damaged release files never fall back to valid shared schemas',async t=>{
  for(const mutation of ['directory','schema','hash','marker','marker-json'])await t.test(mutation,async t=>{
    const f=await fixture(t);
    if(mutation==='directory')fs.rmSync(path.join(f.runtime,'contracts'),{recursive:true});
    if(mutation==='schema')fs.unlinkSync(path.join(f.runtime,'contracts',names[0]));
    if(mutation==='hash')fs.appendFileSync(path.join(f.runtime,'contracts',names[1]),' ');
    if(mutation==='marker')fs.unlinkSync(path.join(f.runtime,'release-contracts.json'));
    if(mutation==='marker-json')fs.writeFileSync(path.join(f.runtime,'release-contracts.json'),'{}');
    assert.throws(()=>f.api.createValidator(),/RELEASE_CONTRACT_/);assert.throws(()=>f.api.createQueueValidator(),/RELEASE_CONTRACT_/);
  });
});
