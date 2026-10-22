import test from 'node:test';
import assert from 'node:assert/strict';
import {setupMaterialStore} from './material-fixture.mjs';
import {loadApp} from './load-app.mjs';
test('native outbox diagnostic remains synthetic and checks separate process-state phases',t=>{
  const f=setupMaterialStore(t),platform={'@kit.CoreFileKit':{fileIo:f.io}};
  platform['./LocalAsrQueue']=loadApp('LocalAsrQueue',platform);
  platform['./MaterialSyncTransport']=loadApp('MaterialSyncTransport',platform);
  const mod=loadApp('PersistenceLab',platform),run='1791725000000';
  const seed=new mod.PersistenceLab().run(f.root,'outbox-seed',run);assert.equal(seed.status,'passed',seed.error);assert.equal(seed.outbox[0].state,'sending');
  const resume=new mod.PersistenceLab().run(f.root,'outbox-resume',run);assert.equal(resume.status,'passed',resume.error);assert.equal(resume.outbox[1].needs_lookup,true);
  const check=new mod.PersistenceLab().run(f.root,'outbox-check',run);assert.equal(check.status,'passed',check.error);assert.equal(check.kind,'isolated_p31_outbox_filesystem');
  assert.equal(check.outbox[0].receipt_id,'synthetic-receipt-'+run+'-r1');assert.equal(check.outbox[1].state,'retry_wait');
});

test('native transport target diagnostic validates configuration without creating requests or user data',t=>{
  const f=setupMaterialStore(t),platform={'@kit.CoreFileKit':{fileIo:f.io}};
  platform['./LocalAsrQueue']=loadApp('LocalAsrQueue',platform);platform['./MaterialSyncTransport']=loadApp('MaterialSyncTransport',platform);
  const mod=loadApp('PersistenceLab',platform),report=new mod.PersistenceLab().run(f.root,'outbox-transport-guard','1791725000001');
  assert.equal(report.status,'passed',report.error);assert.equal(report.checks.length,4);assert.equal(report.outbox.length,0);assert.equal(report.events.length,0);
});

test('native discovery diagnostic resumes immutable revisions without transport or synthetic storage acknowledgement',t=>{
  const f=setupMaterialStore(t),platform={'@kit.CoreFileKit':{fileIo:f.io}};
  platform['./LocalAsrQueue']=loadApp('LocalAsrQueue',platform);
  const {PersistenceLab}=loadApp('PersistenceLab',platform),run='1791725000002';
  const seed=new PersistenceLab().run(f.root,'discovery-seed',run);assert.equal(seed.status,'passed',seed.error);
  const resume=new PersistenceLab().run(f.root,'discovery-resume',run);assert.equal(resume.status,'passed',resume.error);
  assert.equal(resume.outbox.length,3);assert(resume.outbox.every(row=>row.receipt_id===''));
  assert.equal(resume.claim.action,'lookup');assert.equal(resume.outbox[2].attempts,0);
});

test('native renewal diagnostic preserves successor and lineage across a new coordinator without real HTTP',t=>{
  const f=setupMaterialStore(t),platform={'@kit.CoreFileKit':{fileIo:f.io}};
  platform['./LocalAsrQueue']=loadApp('LocalAsrQueue',platform);const {PersistenceLab}=loadApp('PersistenceLab',platform),run='1791725000003';
  const seed=new PersistenceLab().run(f.root,'renewal-seed',run);assert.equal(seed.status,'passed',seed.error);
  const resume=new PersistenceLab().run(f.root,'renewal-resume',run);assert.equal(resume.status,'passed',resume.error);
  assert.equal(resume.events.length,2);assert.equal(JSON.stringify(seed.events[0].body),JSON.stringify(seed.events[1].body));assert.equal(resume.claim.action,'lookup');
  assert.equal(resume.outbox[0].history.length,1);assert.equal(resume.outbox[0].receipt_id,'');
});
