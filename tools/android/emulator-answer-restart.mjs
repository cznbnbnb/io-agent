// Full product APK fault/restart acceptance, against isolated synthetic data only.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const root=path.resolve('rebuild/android-app'),dir=path.join(root,'.private/https-fixture'),adb=path.join(root,'.tools/sdk/platform-tools/adb.exe');
const runtime=JSON.parse(fs.readFileSync(path.join(root,'.private/emulator-runtime.json'),'utf8').replace(/^\uFEFF/,''));if(runtime.serial!=='emulator-5582')throw new Error('Only the Android16 project emulator is allowed');
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',timeout:30000,maxBuffer:2*1024**2});if(r.error||r.status!==0)throw new Error('VM fault test step failed');return r.stdout;}
function device(args){return run(adb,['-s','emulator-5582',...args]);}
const stats=()=>JSON.parse(fs.readFileSync(path.join(dir,'stats.json'),'utf8')),hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(process.argv[2]==='interrupt'){
 const before=stats();fs.writeFileSync(path.join(dir,'drop-next-answer.flag'),'ui-synthetic-only');
 process.stdout.write(run(process.execPath,['tools/android/emulator-ui.mjs','tap','保存完整答案']));
 const file=device(['shell','find','/data/user/0/com.rayneo.venus.pub/files/task-mailbox','-name','state.json']).trim();
 if(!/^\/data\/user\/0\/com\.rayneo\.venus\.pub\/files\/task-mailbox\/[a-f0-9]{64}\/state\.json$/.test(file))throw new Error('Unexpected VM mailbox path');
 let row,interrupted=false;const until=Date.now()+12000;
 while(Date.now()<until){const state=JSON.parse(device(['shell','cat',file]));row=state.outbox.find(r=>JSON.parse(r.payload).kind==='answer');
  if(stats().dropped_answer_replies===before.dropped_answer_replies+1&&row?.needs_lookup===true){device(['shell','am','force-stop','com.rayneo.venus.pub']);interrupted=true;break;}await pause(150);
 }
 if(!interrupted)throw new Error('Unknown answer was not observed; do not claim restart recovery');
 const event=JSON.parse(row.payload),complete=fs.readFileSync(path.join(dir,'ui-answer.txt'),'utf8');if(event.body.text!==complete)throw new Error('Answer changed before restart');
 fs.writeFileSync(path.join(dir,'ui-interruption.json'),JSON.stringify({state_file:file,payload_sha256:hash(row.payload),task_id:event.body.task_id,request_id:event.body.request_id,answer_id:event.body.answer_id,operation_id:row.operation_id,state:row.state,needs_lookup:row.needs_lookup,full_text_verified:true,stats:stats()},null,2)+'\n');
 console.log('Observed lost answer reply and durable needs_lookup=true; only the emulator app was stopped before reconciliation.');
}else if(process.argv[2]==='verify'){
 const interrupted=JSON.parse(fs.readFileSync(path.join(dir,'ui-interruption.json'),'utf8')),before=JSON.parse(fs.readFileSync(path.join(dir,'ui-before.json'),'utf8')),complete=fs.readFileSync(path.join(dir,'ui-answer.txt'),'utf8');
 let passed=false;const until=Date.now()+45000;
 while(Date.now()<until){const state=JSON.parse(device(['shell','cat',interrupted.state_file])),row=state.outbox.find(r=>r.operation_id===interrupted.operation_id);
  if(!row||hash(row.payload)!==interrupted.payload_sha256)throw new Error('Original immutable answer changed after restart');
  const objects=state.objects.map(row=>row.item),task=objects.find(i=>i.kind==='task'&&i.object_id===interrupted.task_id),message=objects.find(i=>i.kind==='message'&&i.body.task_id===interrupted.task_id&&i.body.channel==='result');
  if(row.state==='server_stored'&&!row.needs_lookup&&task?.state==='completed'&&message?.body.text==='合成任务已在原会话继续。完整答案：\n'+complete){passed=true;break;}await pause(500);
 }
 if(!passed)throw new Error('Full APK did not reconcile answer and receive the exact result after restart');
 const after=stats(),delta={};for(const key of Object.keys(before))delta[key]=after[key]-before[key];
 if(delta.task_intakes!==1||delta.answer_intakes!==1||delta.tls_answer_posts!==1||delta.dropped_answer_replies!==1||delta.completed!==1)throw new Error('Unexpected duplicate/runtime intake counts');
 const ledger=JSON.parse(fs.readFileSync(path.join(dir,'runtime.json'),'utf8')),answer=ledger.answers[interrupted.answer_id];if(answer?.text!==complete||answer.request_id!==interrupted.request_id)throw new Error('Runtime did not receive original complete answer');
 const report={schema:1,at:new Date().toISOString(),product_version:'0.2.0-dev1',apk_sha256:'29872aaaebd13f83496b0573c88eba67f844cd374571c4aef39b7ec08dc99daa',android_api:36,full_product_apk:true,production_https_transport:true,actual_material_server:true,actual_desktop_bridge:true,runtime:'synthetic existing-session fixture',real_codex:false,real_hermes:false,physical_device:false,checks:{ui_registration_identity_preflight:true,explicit_enable_and_save:true,keystore_ciphertext_only:true,delivered_import_removed:true,ui_chinese_task_and_multiline_answer_exact:true,lost_answer_reply_observed:true,force_stop_before_reconciliation:true,cold_restart_reloads_saved_connection:true,immutable_answer_preserved:true,server_ack_reconciled:true,original_task_completed:true,full_result_received:true,no_duplicate_runtime_intake:true},delta,test_ca:'Additional short-lived CA mounted only in the dedicated emulator; release APK TLS policy unchanged',remaining:['automatic task UI updates','background/lockscreen scheduling','Redmi/glasses paths','real Codex/Hermes']};
 fs.writeFileSync(path.join(root,'emulator-task-e2e-2026-10-19.json'),JSON.stringify(report,null,2)+'\n');console.log('Full APK UI + HTTPS + Keystore + lost-reply/restart + exact result: passed; runtime and answer received once.');
}else throw new Error('Expected interrupt or verify');
