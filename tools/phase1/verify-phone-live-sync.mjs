// Join an isolated native-phone report to the actual cloud receipt and queried
// material. Read-only: neither this verifier nor the query tool uploads data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {MaterialQueryClient,readPrivateJson} from '../../rebuild/material-server/query/client.mjs';

export async function verifyPhoneReport(report,{query,lookup}){
  assert.equal(report.schema,1);assert.equal(report.kind,'live_p31_transport');
  assert.equal(report.phase,'transport-live');assert.match(report.run_id,/^[0-9]{13}$/);
  assert.equal(report.status,'passed');assert.equal(report.error,'');
  assert.equal(report.events.length,1);assert.equal(report.outbox.length,1);
  assert.equal(report.identity_status,200);assert.equal(report.transport_error,'');
  const [event]=report.events,[row]=report.outbox;
  assert.equal(event.event_id,`live-${report.run_id}-r1`);
  assert.equal(event.kind,'material.revision');assert.equal(event.body.operation,'upsert');
  assert.equal(event.body.full_text.text,'真机联网自检：合成资料，不是用户内容');
  assert.equal(row.state,'server_stored');assert.equal(row.event_id,event.event_id);
  assert.equal(row.material_id,event.body.material_id);assert.equal(row.revision,event.body.revision);
  assert.equal(row.attempts,1);assert.equal(row.needs_lookup,false);
  assert(typeof row.receipt_id==='string'&&row.receipt_id.length>0);
  const ack=await lookup(event.event_id);
  assert.equal(ack.event_id,event.event_id);assert.equal(ack.material_id,row.material_id);
  assert.equal(ack.revision,row.revision);assert.equal(ack.commit_seq,row.server_commit_seq);
  assert.equal(ack.stored_at,row.server_stored_at);assert.equal(ack.receipt.receipt_id,row.receipt_id);
  assert.equal(ack.receipt.stage,'server_stored');assert.equal(ack.receipt.related_event_id,event.event_id);
  assert.equal(ack.receipt.subject_kind,'material');assert.equal(ack.receipt.subject_id,row.material_id);
  assert.equal(ack.receipt.subject_revision,row.revision);
  const read=await query.get({material_id:row.material_id,revision:row.revision});
  assert.equal(read.items.length,1);assert.deepEqual(read.items[0].body,event.body);
  assert.equal(read.items[0].commit_seq,ack.commit_seq);
  assert.equal(read.items[0].source_ref.material_id,row.material_id);
  assert.equal(read.items[0].source_ref.revision,row.revision);
  return {material_id:row.material_id,event_id:event.event_id,revision:row.revision,
    receipt_id:row.receipt_id,commit_seq:ack.commit_seq,stored_at:ack.stored_at};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const options={},args=process.argv.slice(2);
    for(let i=0;i<args.length;i+=2){assert(['--report','--output','--phone-credential'].includes(args[i])&&args[i+1]&&!options[args[i]]);options[args[i]]=args[i+1];}
    assert(options['--report']&&options['--output']&&options['--phone-credential']);
    assert(fs.statSync(options['--report']).size<1000000);
    const bytes=fs.readFileSync(options['--report']);assert(bytes.length<1000000);
    const report=JSON.parse(bytes),configPath=path.resolve('rebuild/material-server/private/query-config.json');
    const config=readPrivateJson(configPath);
    config.credential_file=path.resolve(path.dirname(configPath),config.credential_file);
    const query=new MaterialQueryClient(config),token=readPrivateJson(options['--phone-credential'],4096).token;
    // Event reconciliation is producer-private. The query principal can read
    // materials but cannot read the phone producer's accepted event receipt.
    const read=async relative=>{
      const response=await fetch(new URL(relative,config.base_url),{
        redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`}});
      assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^application\/json/);
      const reader=response.body.getReader(),parts=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
        if(size>16384){await reader.cancel();assert.fail('ACK_TOO_LARGE');}parts.push(value);}}
      finally{reader.releaseLock();}
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
    };
    const identity=await read('identity');
    assert.equal(identity.server_id,config.server_id);assert.equal(identity.owner_id,config.owner_id);
    assert.equal(identity.producer_id,report.target_producer);assert.equal(identity.producer_id,report.events[0].producer_id);
    const lookup=id=>read('events/'+encodeURIComponent(id));
    const joined=await verifyPhoneReport(report,{query,lookup});
    const result={at:new Date().toISOString(),status:'passed',candidate:'0.1.46',...joined,
      native_report_sha256:createHash('sha256').update(bytes).digest('hex'),base_url:config.base_url,
      verified:['phone isolated synthetic upload','actual server_stored receipt matches phone row',
        'computer query exact same material revision with source reference'],
      not_verified:['user recording discovery and automatic sync','revision/delete on phone','offline phone recovery',
        'audio upload','Agent model execution','long-run stability'],
      scope:'phone -> real HTTPS server -> computer query; synthetic text only; no Agent execution'};
    fs.writeFileSync(options['--output'],JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result));
  }catch(error){console.error(JSON.stringify({status:'failed',code:'PHONE_CLOUD_EVIDENCE_MISMATCH'}));process.exitCode=1;}
}
