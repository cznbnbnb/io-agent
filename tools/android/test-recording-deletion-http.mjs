import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../../rebuild/material-server/store.mjs';
import {listen} from '../../rebuild/material-server/http.mjs';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),app=path.join(workspace,'rebuild/android-app');
const temporaryRoot=fs.realpathSync(os.tmpdir()),work=fs.mkdtempSync(path.join(temporaryRoot,'io-deletion-http-'));
fs.chmodSync(work,0o700);const classes=path.join(work,'classes');fs.mkdirSync(classes);
const names=['OfficialRecordingDeletion','OfficialDeletionSync','OfficialLifelogInventory','OfficialLifelogDiscovery','OfficialDayContext','MaterialConfig','MaterialStorage','MaterialSettingsState','MaterialSyncSession','OfficialLifelogBatch','OfficialLifelogRefresh','OfficialLifelogJson','LifelogRevisionJournal','LifelogRevisionMapper','MaterialCatalog','MaterialLocalLibrary','OfficialLifelogSnapshot','OfficialLifelogLogReader','OfficialHiveCache','OfficialAccountBinding','LifelogImportJournal','MaterialConnection','MaterialWire','MaterialOutbox','MaterialApi','MaterialHttp','MaterialTransfer','AtomicDocument','WireJson','TaskWire','TaskConnection'];
const helpers=['OfficialDeletionHttpTest','MaterialTest','OfficialLifelogDiscoveryTest','OfficialLifelogInventoryTest','OfficialLifelogSnapshotTest','OfficialHiveCacheTest','LifelogImportJournalTest'];
const sources=names.map(n=>path.join(app,'src/com/turboio/addon/'+n+'.java')).concat(path.join(app,'upstream/android-addon/src/com/turboio/addon/BoundedJson.java'),helpers.map(n=>path.join(workspace,'tools/android/'+n+'.java')));
let store,server;const credentials=[],report={at:new Date().toISOString(),scope:'Actual material session/outbox/API and local HTTP/SQLite/audio withdrawal across JVMs; original source is synthetic; no phone or real deletion',phases:[]};
try{
 const compile=spawnSync('javac',['-encoding','UTF-8','-d',classes,...sources],{encoding:'utf8',timeout:60000});assert.equal(compile.status,0,compile.stderr);
 store=new MaterialStore(path.join(work,'synthetic.sqlite'));const owner='synthetic-source-delete-codex';
 const mint=(producer,scopes)=>{const c=store.mint({owner,producer,scopes,ttlMs:3600000});credentials.push(c);return c;};
 const writer=mint('phone',['materials:write']),audio=mint('audio',['audio:write','audio:read']);
 server=await listen(store);const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
 const posts=[];let requests=0;server.on('request',req=>{requests++;if(req.method==='POST'&&req.url==='/v1/material-events')posts.push(req.url);});
 async function run(folder,mode,accountId){
  const directory=path.join(work,folder);fs.mkdirSync(directory,{recursive:true});const fixture=path.join(directory,'fixture.json');
  fs.writeFileSync(fixture,JSON.stringify({endpoint,account_id:accountId,connection:{format:'turboio-material-sync/1',base_url:'https://synthetic.invalid/io-api/v1',owner_id:owner,producer_id:'phone',server_id:store.identity(writer.token).server_id,...writer}}),{mode:0o600});
  await new Promise((resolve,reject)=>{
   const child=spawn('java',['-cp',classes,'com.turboio.addon.OfficialDeletionHttpTest',directory,fixture,mode]);let output='';
   const timer=setTimeout(()=>{child.kill();reject(Error('DELETION_HTTP_TIMEOUT'));},45000);
   for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output+=data;if(output.length>1048576)child.kill();});
   child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error(output));else{process.stdout.write(output);resolve();}});
  });
  report.phases.push(folder+':'+mode);return JSON.parse(fs.readFileSync(path.join(directory,'result.json'))).material_id;
 }
 const stored=await run('stored','seed',610);const bytes=Buffer.from('known synthetic non-audio fixture');const sha=b=>createHash('sha256').update(b).digest('hex');
 const now=Date.now(),upload=store.audio.begin(audio.token,{material_id:stored,material_revision:1,kind:'raw',media_type:'application/vnd.turboio.lifelog-archive',bytes:bytes.length,sha256:sha(bytes),capture:{first_received_at:new Date(now-1000).toISOString(),last_received_at:new Date(now).toISOString(),recording_complete:false}});
 store.audio.put(audio.token,upload.object_id,0,{data:bytes.toString('base64'),sha256:sha(bytes)});store.audio.finalize(audio.token,upload.object_id);
 await run('stored','delete',610);
 assert.throws(()=>store.audio.get(audio.token,upload.object_id),e=>e.code==='MATERIAL_DELETED');
 // Reads deny the tombstone immediately; independent cleanup removes bytes.
 store.audio.prune();
 assert.equal(store.audio.db.prepare('SELECT state FROM audio_objects WHERE object_id=?').get(upload.object_id).state,'withdrawn');
 assert.equal(store.audio.db.prepare('SELECT COUNT(*) n FROM audio_parts WHERE object_id=?').get(upload.object_id).n,0);
 const storedSequence=store.ceiling(owner);await run('stored','delete',610);assert.equal(store.ceiling(owner),storedSequence);
 await run('cancelled','offline-seed',611);const beforePending=requests;await run('cancelled','pending',611);assert.equal(requests,beforePending);
 const beforeHistorical=requests;await run('cancelled','historical',611);assert.equal(requests,beforeHistorical);
 const beforeCancel=posts.length;const cancelled=await run('cancelled','delete',611);assert.equal(posts.length,beforeCancel+1);
 const cancelledHead=store.db.prepare('SELECT revision,deleted FROM materials WHERE owner=? AND id=?').get(owner,cancelled);assert.equal(cancelledHead.revision,1);assert.equal(cancelledHead.deleted,1);
 const cancelledSequence=store.ceiling(owner);await run('cancelled','delete',611);assert.equal(store.ceiling(owner),cancelledSequence);
 await run('rollback','offline-seed',612);await run('rollback','pending',612);const rollback=await run('rollback','rollback',612);assert.equal(store.db.prepare('SELECT deleted FROM materials WHERE owner=? AND id=?').get(owner,rollback).deleted,0);
 await run('lost-cancel','offline-seed',613);const beforeLostCancel=posts.length;await run('lost-cancel','lost-cancel',613);assert.equal(posts.length,beforeLostCancel);await run('lost-cancel','delete',613);
 await run('lost-delete','seed',614);const lostDelete=await run('lost-delete','lost-delete',614);const afterLostDelete=store.ceiling(owner);await run('lost-delete','recover',614);assert.equal(store.ceiling(owner),afterLostDelete);
 assert.equal(store.db.prepare('SELECT deleted FROM materials WHERE owner=? AND id=?').get(owner,lostDelete).deleted,1);
 await run('budget','budget',615);
 for(const material of JSON.parse(fs.readFileSync(path.join(work,'budget/result.json'))).materials){
  const revisions=store.db.prepare('SELECT revision,body FROM revisions WHERE owner=? AND id=?').all(owner,material);
  assert.equal(revisions.length,1);assert.equal(revisions[0].revision,1);assert.equal(JSON.parse(revisions[0].body).operation,'delete');
 }
 report.passed=true;report.original_audio_touched=false;report.server_audio_withdrawal_verified=true;
}finally{
 if(store)for(const c of credentials)store.revoke(c.token_id);
 if(server)await new Promise(resolve=>server.close(resolve));if(store)store.close();
 const real=fs.realpathSync(work);assert.equal(path.dirname(real),temporaryRoot);assert(path.basename(real).startsWith('io-deletion-http-'));assert(!fs.lstatSync(work).isSymbolicLink());fs.rmSync(work,{recursive:true});
 report.temporary_fixture_removed=true;fs.writeFileSync(path.join(app,'build/r4-recording-deletion-http-result.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({passed:true,phases:report.phases.length,server_audio_withdrawal_verified:true}));
