// Real public HTTPS and SQLite service; all subjects and phone-role input are
// synthetic PC driver data. No physical phone, glasses or model in this test.
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {cloudQueue} from './cloud-verification-client.mjs';
const args=process.argv.slice(2),at=args.indexOf('--config');
if(!args.includes('--run-cloud')||at<0||!args[at+1])throw new Error('EXPLICIT_CLOUD_TEST_REQUIRED');
const report={at:new Date().toISOString(),status:'running',scope:'real public HTTPS; synthetic owner and PC phone-role driver; no phone/glasses/model',checks:[],
  not_verified:['physical phone/glasses task end-to-end','eight-hour stability','authenticated dashboard UI']};
const requireValue=(value,code)=>{if(!value)throw new Error(code);};
const check=label=>report.checks.push({case:label,passed:true});
try{
  const q=await cloudQueue(args[at+1]);report.run_id=q.bundle.run_id;
  const manifest=JSON.parse(fs.readFileSync(new URL('../../rebuild/phase1/io-server-20261012-r2-manifest.json',import.meta.url)));
  for(const [route,name] of [['admin','index.html'],['admin/app.js','app.js'],['admin/style.css','style.css']]){
    const response=await fetch(q.bundle.agent.base_url+route,{redirect:'manual',signal:AbortSignal.timeout(10000)});
    const bytes=Buffer.from(await response.arrayBuffer());
    requireValue(response.status===200&&bytes.length<65536&&response.headers.get('cache-control')?.includes('no-store'),'PUBLIC_ASSET_INVALID');
    requireValue(createHash('sha256').update(bytes).digest('hex')===manifest.files['rebuild/material-server/admin/'+name].sha256,'PUBLIC_ASSET_HASH_MISMATCH');
    if(route==='admin')requireValue(response.headers.get('content-security-policy')?.includes("default-src 'none'"),'PUBLIC_ADMIN_CSP_MISSING');
  }
  for(const route of ['identity','operations/summary']){
    const response=await fetch(q.bundle.agent.base_url+route,{redirect:'manual',signal:AbortSignal.timeout(10000)});
    await response.arrayBuffer();requireValue(response.status===401,'UNAUTHENTICATED_ACCESS_ALLOWED');
  }
  check('public dashboard assets match release hashes, CSP/no-store present, identity and statistics require authentication');
  const route={computer_id:q.bundle.agent.computer_id,agent_id:q.bundle.agent.agent_id,project_id:'synthetic-cloud-lifecycle',session_id:'synthetic-unexecuted-session'};
  const envelope=(kind,body,role='phone',ttl=60000)=>({schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind,
    producer_id:q.bundle[role].producer_id,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+ttl).toISOString(),body});
  const task={task_id:'synthetic-lifecycle-task',revision:1,route,command:'Synthetic API test; never execute this task.',state:'queued',allow_create_session:false};
  const event=envelope('task',task),ack=await q.phone.post('task',event),replay=await q.phone.post('task',event),lookup=await q.phone.event(event.event_id,event);
  requireValue([replay,lookup].every(value=>value.commit_seq===ack.commit_seq&&value.receipt.receipt_id===ack.receipt.receipt_id),'REPLAY_NOT_STABLE');
  check('identical task event retry and event lookup return the original server-stored acknowledgement');
  const question=id=>({request_id:id,revision:1,task_id:task.task_id,route,mode:'free_text',question:'Synthetic API question; no user action requested.',options:[],state:'pending',runtime_request_id:id});
  const expiring=envelope('request',question('synthetic-expiring-question'),'agent',4000);
  await q.agent.post('request',expiring);
  const live=await q.agent.reconcileRequest(expiring.body.request_id,1);requireValue(live.state==='pending','QUESTION_NOT_LIVE');
  const denied=await q.call('phone','requests/'+live.object_id+'/reconcile',{method:'POST',body:{schema_version:'1.0',request_revision:1}});
  requireValue(denied.status===403,'PHONE_LIFECYCLE_SCOPE_NOT_ENFORCED');
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(expiring.expires_at)-Date.now()+400)));
  const closed=await q.agent.reconcileRequest(live.object_id,1),duplicate=await q.agent.reconcileRequest(live.object_id,1);
  const receipt=closed.receipts.filter(value=>value.subject_kind==='request'&&value.stage==='expired');
  requireValue(closed.state==='expired'&&closed.revision===1&&closed.event_id===live.event_id&&closed.body.state==='pending'&&closed.answer===null&&
    receipt.length===1&&duplicate.receipts.length===closed.receipts.length&&duplicate.receipts[0].receipt_id===closed.receipts[0].receipt_id,'EXPIRY_NOT_DURABLE');
  const answer=id=>({answer_id:id,request_id:closed.object_id,request_revision:1,task_id:task.task_id,route,option_id:null,text:'synthetic PC driver answer',input_source:'phone',raw_action:null});
  let lateRejected=false;try{await q.phone.post('answer',envelope('answer',answer('synthetic-late-answer')));}catch(error){lateRejected=error.code==='REQUEST_CLOSED';}
  requireValue(lateRejected,'LATE_ANSWER_ACCEPTED');
  check('real server clock closes the immutable question once; phone cannot reconcile; late answer is rejected');
  const accepted=envelope('request',question('synthetic-answered-question'),'agent');await q.agent.post('request',accepted);
  await q.phone.post('answer',envelope('answer',{...answer('synthetic-accepted-answer'),request_id:accepted.body.request_id}));
  const withdrawn=envelope('request',question('synthetic-withdrawn-question'),'agent');await q.agent.post('request',withdrawn);
  await q.phone.post('task',envelope('task',{...task,revision:2,state:'cancel_requested'}));
  const kept=await q.agent.reconcileRequest(accepted.body.request_id,1),removed=await q.agent.reconcileRequest(withdrawn.body.request_id,1),parent=await q.get('task',task.task_id);
  requireValue(kept.state==='answered'&&kept.answer.object_id==='synthetic-accepted-answer'&&removed.state==='withdrawn'&&
    removed.receipts.some(r=>r.subject_kind==='request'&&r.stage==='cancelled')&&parent.state==='cancel_requested'&&
    !parent.receipts.some(r=>r.stage==='cancelled'),'CANCELLATION_FACTS_CONFLATED');
  check('parent cancel request withdraws only unanswered question, keeps accepted answer, and does not claim task stopped');
  const summary=await q.call('operations','operations/summary');
  requireValue(summary.status===200&&summary.body.traffic?.available===true,'TRAFFIC_UNAVAILABLE');
  const producers=summary.body.traffic.producers;
  for(const producer of ['cloud-phone','cloud-agent'])requireValue(producers.some(v=>v.producer_id===producer&&v.requests>0&&v.request_bytes>0&&v.response_bytes>0),'PRODUCER_TRAFFIC_MISSING');
  const before=summary.body.traffic.totals.requests,again=await q.call('operations','operations/summary');
  requireValue(again.body.traffic.totals.requests===before,'SUMMARY_COUNTS_ITSELF');
  requireValue((await q.call('phone','operations/summary')).status===403,'PHONE_CAN_READ_ADMIN');
  requireValue((await q.call('operations','tasks',{method:'POST',body:envelope('task',{...task,task_id:'synthetic-forbidden-task'})})).status===403,'OPERATIONS_CAN_WRITE_TASK');
  report.traffic={meaning:'API JSON body bytes, excludes HTTP/TLS overhead and other owners',producers:producers.filter(v=>['cloud-phone','cloud-agent'].includes(v.producer_id))};
  check('owner-scoped traffic distinguishes PC phone-role and agent producers; read-only operations scope cannot submit tasks');
  report.status='passed';
}catch(error){report.status='failed';report.error_code=/^[A-Z][A-Z0-9_]{0,90}$/.test(error.code??error.message)?error.code??error.message:'CLOUD_TEST_FAILED';process.exitCode=1;}
finally{
  report.source_sha256=Object.fromEntries(['verify-cloud-queue.mjs','cloud-verification-client.mjs'].map(name=>['tools/phase1/'+name,createHash('sha256').update(fs.readFileSync(new URL(name,import.meta.url))).digest('hex')]));
  fs.writeFileSync(new URL('../../rebuild/phase1/cloud-queue-verification-2026-10-13.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,error_code:report.error_code}));
}
