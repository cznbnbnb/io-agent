import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyPhoneReport} from './verify-phone-live-sync.mjs';

function fixture(){
  // Previously failed native synthetic fixture, made explicitly synthetic here.
  const report=JSON.parse(fs.readFileSync(new URL('../../rebuild/phase1/device-p31-live-sync.json',import.meta.url)));
  report.status='passed';report.error='';report.identity_status=200;report.transport_error='';
  const [row]=report.outbox;
  Object.assign(row,{state:'server_stored',attempts:1,needs_lookup:false,receipt_id:'synthetic-receipt',server_commit_seq:7,
    server_stored_at:'2026-10-11T16:20:44.000Z'});
  const ack={schema_version:'1.1',event_id:row.event_id,material_id:row.material_id,revision:row.revision,
    commit_seq:row.server_commit_seq,stored_at:row.server_stored_at,receipt:{receipt_id:row.receipt_id,stage:'server_stored',
      related_event_id:row.event_id,subject_kind:'material',subject_id:row.material_id,subject_revision:row.revision}};
  const result={items:[{body:structuredClone(report.events[0].body),commit_seq:7,
    source_ref:{material_id:row.material_id,revision:row.revision}}]};
  const query={get:async()=>result},lookup=async()=>ack;
  return {report,ack,result,query,lookup};
}
test('matching phone, storage receipt and query evidence join successfully',async()=>{
  const f=fixture(),joined=await verifyPhoneReport(f.report,f);
  assert.equal(joined.receipt_id,'synthetic-receipt');assert.equal(joined.commit_seq,7);
});
test('local pass label without the same actual storage receipt is refused',async()=>{
  const f=fixture();f.ack.receipt.receipt_id='different';
  await assert.rejects(verifyPhoneReport(f.report,f));
});
test('same material ID with altered queried text or wrong source revision is refused',async()=>{
  for(const change of [f=>{f.result.items[0].body.full_text.text='altered';},f=>{f.result.items[0].source_ref.revision=2;}]){
    const f=fixture();change(f);await assert.rejects(verifyPhoneReport(f.report,f));
  }
});
test('a failed native report never becomes passing because the server has data',async()=>{
  const f=fixture();f.report.status='failed';let called=false;f.lookup=async()=>{called=true;return f.ack;};
  await assert.rejects(verifyPhoneReport(f.report,f));assert.equal(called,false);
});
