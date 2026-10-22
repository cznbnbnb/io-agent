// Read-only join: native receipts, original producer lookup, PC deletion view.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createHash} from 'node:crypto';
import {MaterialQueryClient,readPrivateJson} from '../../rebuild/material-server/query/client.mjs';

try{
  const [filename,resumeFilename,output,mode]=process.argv.slice(2);assert(filename&&resumeFilename&&output);
  assert(mode===undefined||mode==='--offline');const offline=mode==='--offline';
  const bytes=fs.readFileSync(filename),resumeBytes=fs.readFileSync(resumeFilename);assert(bytes.length<1000000&&resumeBytes.length<1000000);
  const report=JSON.parse(bytes),resume=JSON.parse(resumeBytes);
  for(const r of [report,resume]){
    assert.equal(r.schema,1);assert.equal(r.kind,'live_p31_coordinator');assert.equal(r.status,'passed');assert.equal(r.error,'');assert.match(r.run_id,/^[0-9]{13}$/);
    assert.equal(r.outbox.length,3);assert.equal(r.sync_views.length,1);
  }
  assert.equal(report.phase,offline?'coordinator-offline':'coordinator-live');assert.equal(resume.phase,offline?'coordinator-online':'coordinator-resume');assert.equal(resume.run_id,report.run_id);
  assert.equal(resume.target_host,report.target_host);assert.equal(resume.target_producer,report.target_producer);
  if(offline){
    assert.equal(report.default_network_before,false);assert.equal(report.default_network_after,false);assert.equal(report.coordinator_note,'IDENTITY_UNAVAILABLE');
    assert.equal(resume.default_network_before,true);assert.equal(resume.default_network_after,true);
    assert.equal(report.sync_views[0].state,'queued');assert.equal(report.sync_views[0].storedRevision,0);assert.equal(report.sync_views[0].receiptId,'');
    for(const [index,row] of report.outbox.entries()){
      assert.equal(row.state,'queued');assert.equal(row.attempts,0);assert.equal(row.needs_lookup,false);assert.equal(row.receipt_id,'');assert.equal(row.server_commit_seq,0);
      for(const field of ['queue_id','event_id','material_id','revision','payload_hash','payload_bytes','expires_at','history'])assert.deepEqual(row[field],resume.outbox[index][field]);
    }
  }else{assert.deepEqual(resume.outbox,report.outbox);assert.deepEqual(resume.sync_views,report.sync_views);}
  const settled=offline?resume:report;
  const privateRoot=path.resolve('rebuild/material-server/private'),config=readPrivateJson(path.join(privateRoot,'query-config.json'));
  config.credential_file=path.resolve(privateRoot,config.credential_file);
  assert.equal(report.target_host.replace(/\/$/,''),config.base_url.replace(/\/$/,''));assert.equal(report.target_producer,'phone-harmony');
  const phone=readPrivateJson(path.join(privateRoot,'phone-harmony.json'),4096);
  const read=async relative=>{
    const response=await fetch(new URL(relative,config.base_url),{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+phone.token}});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^application\/json/);
    const reader=response.body.getReader(),chunks=[];let length=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>16384){await reader.cancel();assert.fail('ACK_TOO_LARGE');}chunks.push(value);}}
    finally{reader.releaseLock();}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  };
  const identity=await read('identity');assert.equal(identity.server_id,config.server_id);assert.equal(identity.owner_id,config.owner_id);assert.equal(identity.producer_id,report.target_producer);
  const materialId='mat-recording-'+report.run_id.padEnd(32,'c'),acknowledgements=[];let seq=0;
  for(const [index,row] of settled.outbox.entries()){
    assert.equal(row.material_id,materialId);assert.equal(row.revision,index+1);assert.equal(row.state,'server_stored');assert.equal(row.attempts,1);assert.equal(row.needs_lookup,false);
    const ack=await read('events/'+encodeURIComponent(row.event_id));
    assert.equal(ack.schema_version,'1.1');assert.equal(ack.material_id,materialId);assert.equal(ack.event_id,row.event_id);assert.equal(ack.revision,row.revision);
    assert.equal(ack.commit_seq,row.server_commit_seq);assert(ack.commit_seq>seq);seq=ack.commit_seq;
    assert.equal(ack.stored_at,row.server_stored_at);assert.equal(ack.receipt.receipt_id,row.receipt_id);assert.equal(ack.receipt.stage,'server_stored');
    assert.equal(ack.receipt.subject_kind,'material');assert.equal(ack.receipt.subject_id,materialId);assert.equal(ack.receipt.subject_revision,row.revision);
    assert.equal(ack.receipt.actor_id,'server-storage');assert.equal(ack.receipt.related_event_id,row.event_id);assert.equal(ack.receipt.error,null);
    acknowledgements.push({event_id:row.event_id,revision:row.revision,receipt_id:row.receipt_id,commit_seq:ack.commit_seq});
  }
  const view=settled.sync_views[0];assert.equal(view.materialId,materialId);assert.equal(view.revision,3);assert.equal(view.state,'server_stored');
  assert.equal(view.commitSeq,seq);assert.equal(view.receiptId,settled.outbox[2].receipt_id);assert.equal(view.audioState,'not_scheduled');
  const query=new MaterialQueryClient(config);await assert.rejects(query.get({material_id:materialId}),e=>e.code==='MATERIAL_DELETED'&&e.status===410);
  let cursor,found;
  for(let n=0;n<10;n++){
    const page=await query.changes({limit:50,...(cursor?{cursor}:{})});
    found=page.items.find(x=>x.body.material_id===materialId&&x.body.revision===3);
    if(found||!page.has_more)break;cursor=page.next_cursor;
  }
  assert(found);assert.equal(found.body.operation,'delete');assert.equal(found.commit_seq,seq);
  const result={at:new Date().toISOString(),status:'passed',candidate:offline?'0.1.48':'0.1.47',run_id:report.run_id,material_id:materialId,acknowledgements,
    native_report_sha256:createHash('sha256').update(bytes).digest('hex'),resume_report_sha256:createHash('sha256').update(resumeBytes).digest('hex'),
    verified:['native bounded discovery submits original/update/delete over public HTTPS','three actual receipts match original-producer event lookups',
      ...(offline?['phone observed no default network before/after real failed preflight; all revisions remain durable and undispatched',
        'after phone process restart and actual network restoration exact original event IDs/hashes/deadlines upload once']:
        ['cold phone process restores exact receipt rows with attempts still one']),
      'latest text view reflects tombstone without audio claim','independent PC sees deletion and changes tombstone'],
    not_verified:['real daily history opt-in and foreground UI operation','phone disconnection after POST dispatch / lost reply','audio upload','background network lease','credential renewal','8-hour stability'],
    scope:'isolated synthetic text history only; no user material or Agent task'};
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch{console.error(JSON.stringify({status:'failed',code:'PHONE_COORDINATOR_EVIDENCE_MISMATCH'}));process.exitCode=1;}
