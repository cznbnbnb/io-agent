import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {exe} from './host-tools.mjs';
const root=path.resolve('rebuild/android-app'),dir=path.join(root,'.private/https-fixture'),adb=path.join(root,'.tools/sdk/platform-tools',exe('adb'));
const environment=JSON.parse(fs.readFileSync(path.join(root,'.private/emulator-runtime.json'),'utf8').replace(/^\uFEFF/,''));if(environment.serial!=='emulator-5582')throw new Error('Only the dedicated Android16 VM is allowed');
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',timeout:30000,maxBuffer:2*1024**2});if(r.error||r.status!==0)throw new Error('Offline UI test step failed: '+cmd);return r.stdout;}
const device=args=>run(adb,['-s','emulator-5582',...args]),ui=(...args)=>run(process.execPath,['tools/android/emulator-ui.mjs',...args]);
const stats=()=>JSON.parse(fs.readFileSync(path.join(dir,'stats.json'),'utf8')),hash=value=>crypto.createHash('sha256').update(value).digest('hex'),pause=ms=>new Promise(r=>setTimeout(r,ms));
function mailboxFile(){const file=device(['shell','find','/data/user/0/com.rayneo.venus.pub/files/task-mailbox','-name','state.json']).trim();if(!/^\/data\/user\/0\/com\.rayneo\.venus\.pub\/files\/task-mailbox\/[a-f0-9]{64}\/state\.json$/.test(file))throw new Error('Unexpected VM state path');return file;}
const recordFile=path.join(dir,'ui-offline.json');
if(process.argv[2]==='queue'){
 const before=stats(),command='离线界面联调 '+crypto.randomUUID()+'：仅生成预览。\n不发送、不发布，不修改已有资料。';
 fs.writeFileSync(path.join(dir,'ui-offline-command.txt'),command);device(['reverse','--remove','tcp:443']);
 ui('tap','委托电脑任务');ui('set-file','ui-offline-command.txt');ui('tap','保存并提交到当前会话');
 const file=mailboxFile(),state=JSON.parse(device(['shell','cat',file])),row=state.outbox.find(row=>JSON.parse(row.payload).body.command===command);
 if(!row||JSON.parse(row.payload).kind!=='task'||row.state==='server_stored'||stats().task_intakes!==before.task_intakes)throw new Error('Offline task not durably queued before network restoration');
 const event=JSON.parse(row.payload);fs.writeFileSync(recordFile,JSON.stringify({state_file:file,operation_id:row.operation_id,task_id:event.body.task_id,payload_sha256:hash(row.payload),before},null,2)+'\n');
 process.stdout.write(ui('snapshot'));device(['shell','am','force-stop','com.rayneo.venus.pub']);console.log('Offline task preserved without runtime execution; emulator app stopped.');
}else if(process.argv[2]==='restore-home'){
 const record=JSON.parse(fs.readFileSync(recordFile,'utf8'));process.stdout.write(ui('start'));device(['reverse','tcp:443','tcp:443']);
 let received=false;const until=Date.now()+45000;
 while(Date.now()<until){const state=JSON.parse(device(['shell','cat',record.state_file])),row=state.outbox.find(row=>row.operation_id===record.operation_id);if(!row||hash(row.payload)!==record.payload_sha256)throw new Error('Offline command changed after restart');
  if(row.state==='server_stored'&&stats().task_intakes===record.before.task_intakes+1){received=true;break;}await pause(500);
 }
 if(!received)throw new Error('Saved queue did not resume from the local home');
 const shot=JSON.parse(ui('snapshot').trim().split('\n').at(-1));if(!shot.labels.includes('眼镜 · 手机 · 电脑')||shot.labels.includes('连接设置'))throw new Error('Queue test was not on the local home');
 record.queued_offline=true;record.immutable_after_restart=true;record.resumed_from_home_without_task_page=true;fs.writeFileSync(recordFile,JSON.stringify(record,null,2)+'\n');process.stdout.write(ui('tap','电脑任务'));console.log('Offline queue resumed from the no-login home with exactly one task intake; no manual task refresh.');
}else if(process.argv[2]==='answer-auto'){
 const record=JSON.parse(fs.readFileSync(recordFile,'utf8'));let visible=false;const until=Date.now()+30000;
 while(Date.now()<until){const shot=JSON.parse(ui('snapshot').trim().split('\n').at(-1));if(shot.labels.includes('问题 · 等待回答')&&shot.labels.includes('查看与回答')){visible=true;break;}await pause(1000);}
 if(!visible)throw new Error('Question did not appear automatically in the actual UI');
 ui('tap','查看与回答');ui('tap','方案 A');ui('set-file','ui-answer.txt');ui('tap','保存完整答案');record.actual_question_ui_updated_without_refresh=true;fs.writeFileSync(recordFile,JSON.stringify(record,null,2)+'\n');console.log('New question appeared automatically; complete synthetic answer submitted from its actual UI.');
}else if(process.argv[2]==='verify-auto'){
 const record=JSON.parse(fs.readFileSync(recordFile,'utf8')),complete=fs.readFileSync(path.join(dir,'ui-answer.txt'),'utf8');let done=false;const until=Date.now()+45000;
 while(Date.now()<until){const state=JSON.parse(device(['shell','cat',record.state_file])),objects=state.objects.map(row=>row.item),task=objects.find(item=>item.kind==='task'&&item.object_id===record.task_id),message=objects.find(item=>item.kind==='message'&&item.body.task_id===record.task_id&&item.body.channel==='result');
  if(task?.state==='completed'&&message?.body.text==='合成任务已在原会话继续。完整答案：\n'+complete){done=true;break;}await pause(500);
 }
 if(!done||record.actual_question_ui_updated_without_refresh!==true)throw new Error('Offline task did not complete with its original full answer and automatic question UI');
 let visible=false;for(let step=0;step<6;step++){const result=JSON.parse(ui('snapshot').trim().split('\n').at(-1));if(result.labels.includes('电脑结果')&&result.labels.some(text=>text==='合成任务已在原会话继续。完整答案：\n'+complete)){visible=true;break;}ui('scroll','forward');}
 if(!visible)throw new Error('Full result did not appear in the actual UI after scrolling; no refresh was issued');
 const after=stats(),delta={};for(const key of Object.keys(record.before))delta[key]=after[key]-record.before[key];if(delta.task_intakes!==1||delta.answer_intakes!==1||delta.completed!==1)throw new Error('Runtime intake was duplicated');
 const candidate=JSON.parse(fs.readFileSync(path.join(root,'candidate.json'),'utf8'));const report={schema:1,at:new Date().toISOString(),product_version:candidate.version,apk_sha256:candidate.sha256,android_api:36,full_product_apk:true,physical_device:false,real_codex:false,real_hermes:false,runtime:'synthetic existing-session fixture',checks:{in_place_upgrade_kept_encrypted_connection_and_history:true,offline_ui_task_durably_queued:true,immutable_command_after_force_stop:true,resumed_from_no_login_home_without_opening_tasks:true,actual_question_ui_updated_without_refresh:true,full_answer_result_ui_updated_without_refresh:true,no_duplicate_runtime_intake:true},delta,remaining:['background and lockscreen','physical Redmi/glasses','real runtime integration']};
 fs.writeFileSync(path.join(root,'emulator-offline-ui-2026-10-19.json'),JSON.stringify(report,null,2)+'\n');console.log('Full APK upgrade + offline restart + home queue resume + automatic question/result UI: passed.');
}else throw new Error('Expected queue, restore-home, answer-auto or verify-auto');
