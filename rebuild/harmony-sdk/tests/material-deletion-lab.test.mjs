import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setupMaterialStore} from './material-fixture.mjs';
import {loadApp} from './load-app.mjs';

test('synthetic deletion lab cold restart retains tombstones and rejects the same and different late jobs',t=>{
  const f=setupMaterialStore(t),io={...f.io,unlinkSync:fs.unlinkSync};
  const {MaterialDeletionLab}=loadApp('MaterialDeletionLab',{'@kit.CoreFileKit':{fileIo:io}});
  const run='1791857000000',first=new MaterialDeletionLab().run(f.root,'material-delete-seed',run);
  assert.equal(first.status,'passed',first.error);assert.equal(first.checks.length,7);assert.equal(first.source_cleanup_complete,false);
  const next=new MaterialDeletionLab().run(f.root,'material-delete-resume',run);
  assert.equal(next.status,'passed',next.error);assert.equal(next.checks.length,13);assert.equal(next.source_cleanup_complete,true);
  assert.deepEqual(JSON.parse(JSON.stringify(next.material_ids)),JSON.parse(JSON.stringify(first.material_ids)));
  assert.deepEqual(JSON.parse(JSON.stringify(next.revisions)),[3,3]);
  const report=JSON.parse(fs.readFileSync(f.root+'/p32-material-delete-lab/'+run+'/material-delete-resume-report.json','utf8'));
  assert.equal(report.status,'passed');
});

test('deletion lab refuses invalid or reused seed directories without clearing existing files',t=>{
  const f=setupMaterialStore(t),io={...f.io,unlinkSync:fs.unlinkSync};
  const {MaterialDeletionLab}=loadApp('MaterialDeletionLab',{'@kit.CoreFileKit':{fileIo:io}}),lab=new MaterialDeletionLab();
  assert.equal(lab.run(f.root,'material-delete-seed','../outside').error,'DELETE_LAB_PARAMETERS_INVALID');
  const run='1791857000001';assert.equal(lab.run(f.root,'material-delete-seed',run).status,'passed');
  const marker=f.root+'/p32-material-delete-lab/'+run+'/recording-synthetic-source.bin',before=fs.readFileSync(marker);
  assert.equal(lab.run(f.root,'material-delete-seed',run).status,'failed');assert.deepEqual(fs.readFileSync(marker),before);
});
