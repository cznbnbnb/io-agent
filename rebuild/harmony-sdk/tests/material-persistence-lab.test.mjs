import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {setupMaterialStore} from './material-fixture.mjs';import {loadApp} from './load-app.mjs';
function lab(s){return loadApp('PersistenceLab',{'@kit.CoreFileKit':{fileIo:s.io},'./LocalAsrQueue':{LocalAsrQueue:class{}}});}
test('bounded native diagnostic seeds and resumes only synthetic revisions, with identical historical retry',t=>{
 const s=setupMaterialStore(t),run='1791676800000',first=lab(s);
 const seed=new first.PersistenceLab().run(s.root,'wire-seed',run);assert.equal(seed.status,'passed',seed.error);assert.equal(seed.events.length,3);
 const next=lab(s),resume=new next.PersistenceLab().run(s.root,'wire-resume',run);
 assert.equal(resume.status,'passed',resume.error);assert.equal(resume.events.length,3);
 assert.equal(JSON.stringify(seed.events[1]),JSON.stringify(resume.events[0]));
 assert.equal(resume.events[1].body.processing.covered_ms,10000);assert.equal(resume.events[1].body.processing.source_ms,70000);
 assert.equal(resume.events[2].body.operation,'delete');assert.equal(resume.events[2].body.full_text.text,'');
 const disk=JSON.parse(fs.readFileSync(path.join(s.root,'p21-material-wire-lab','run-'+run,'wire-resume-report.json')));
 assert.equal(disk.status,'passed');assert.equal(s.store.ids().length,0,'diagnostic never touches production fixture materials');
});
test('diagnostic rejects path parameters and resume without a seed instead of manufacturing success',t=>{
 const s=setupMaterialStore(t),{PersistenceLab}=lab(s);
 const bad=new PersistenceLab().run(s.root,'wire-seed','../../outside');assert.equal(bad.status,'failed');assert.equal(bad.error,'LAB_RUN_ID_INVALID');
 const absent=new PersistenceLab().run(s.root,'wire-resume','1791676800001');assert.equal(absent.status,'failed');assert.equal(absent.events.length,0);
 assert.equal(s.store.ids().length,0);
});
