import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Read only scoped, privately retained native UI evidence and protocol metadata.
// No credentials, manuscript library contents or raw system logs are published.
const root=process.cwd(),privateRoot=path.join(root,'rebuild/phase1/device-private');
const first=path.join(privateRoot,'prompter064-evidence'),last=path.join(privateRoot,'prompter064-candidate2-evidence');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function editor(file){
  const nodes=[];const visit=n=>{nodes.push(n);for(const child of n.children||[])visit(child);};visit(read(path.join(privateRoot,file)));
  const roots=nodes.filter(n=>n.attributes?.type==='root'&&n.attributes.focused==='true'&&n.attributes.bundleName==='org.turboio.harmony.research');assert.equal(roots.length,1);
  const attrs=nodes.map(n=>n.attributes||{}).filter(a=>a.hostWindowId===roots[0].attributes.hostWindowId);
  assert(attrs.some(a=>a.text==='TURBO IO'));
  const title=attrs.filter(a=>a.type==='TextInput'),body=attrs.filter(a=>a.type==='TextArea');assert.equal(title.length,1);assert.equal(body.length,1);
  return{title_exact:title[0].text==='20261014064',body_exact:body[0].text==='06420261014',both_empty:!title[0].text&&!body[0].text};
}
const oldEntered=editor('prompter063-draft-entered.json'),oldReturn=editor('prompter063-switch-return.json');
const newEntered=editor('prompter064-draft-entered.json'),newReturn=editor('prompter064-switch-result.json');
assert(oldEntered.title_exact&&oldEntered.body_exact&&oldReturn.both_empty);
assert(newEntered.title_exact&&newEntered.body_exact&&newReturn.title_exact&&newReturn.body_exact);
const selected=editor('prompter064-saved-selected.json'),cold=editor('prompter064-candidate2-cold-selected.json');
assert(selected.title_exact&&selected.body_exact&&cold.title_exact&&cold.body_exact);
const build=read(path.join(root,'rebuild/phase1/prompter064-candidate2-build-2026-10-14.json'));
assert.equal(sha(path.join(root,build.signed_hap)),build.signed_hap_sha256);assert(build.compile_succeeded&&build.source_and_stage_unchanged_after_sign);
const installed=read(path.join(last,'install-ledger.json')),chain=read(path.join(last,'chain-ledger.json'));
assert.equal(installed.hap_sha256,build.signed_hap_sha256);assert.equal(installed.version_code,10064);assert.notEqual(installed.pid_before,installed.pid_after);
assert(Object.values(installed.retained_bytes_unchanged).every(v=>v===true));assert(chain.cold_saved_selection_exact&&chain.cold_empty_unsaved_draft);
const finalRetained=read(path.join(last,'retained-final.json'));assert(Object.values(finalRetained.after_protocol_retained_bytes_unchanged).every(v=>v===true));
const initialManifest=read(path.join(root,'rebuild/phase1/candidate-runs/20261014-130235056-254963ca/source-hashes.json'));
const finalManifest=read(path.join(root,`rebuild/phase1/candidate-runs/${build.run_id}/source-hashes.json`));
for(const name of ['TeleprompterService.ets','pages/TeleprompterPanel.ets','pages/FeaturePanel.ets']){
  const sourcePath=`harmony-sdk/entry/src/main/ets/${name}`;
  assert.equal(initialManifest.find(r=>r.path===sourcePath).sha256,finalManifest.find(r=>r.path===sourcePath).sha256);
}
const saved=read(path.join(first,'save-observed.json'));assert(saved.notes.some(n=>n.startsWith('稿件已保存到本机资料')));
const events=[];
for(const line of fs.readFileSync(path.join(last,'prompter-protocol.log'),'utf8').split(/\r?\n/)){
  const match=/prompter (state|tx|rx) did=([0-9a-f-]*) (.*)$/.exec(line);if(!match)continue;
  const fields=Object.fromEntries([...match[3].matchAll(/(phase|progress|speed|offset|type|action|code)=([a-z_]+|\d+)/g)].map(m=>[m[1],/^\d+$/.test(m[2])?Number(m[2]):m[2]]));
  events.push({sequence:events.length+1,kind:match[1],did:match[2],...fields});
}
assert(events.length>0,'final native logger must actually emit');
const dids=[...new Set(events.filter(e=>e.kind==='tx'&&e.type===2&&e.action===1).map(e=>e.did))];assert.equal(dids.length,1,'bounded candidate2 run must contain one preparation');
const did=dids[0],matched=events.filter(e=>e.did===did);
const ack=type=>matched.some(e=>e.kind==='rx'&&e.type===type&&e.action===2&&e.code===1);
const ready=matched.some(e=>e.kind==='state'&&e.phase==='ready'&&e.progress===100)&&matched.some(e=>e.kind==='rx'&&e.type===2&&e.action===2&&e.code===7);
const ownEyeExit=matched.some(e=>e.kind==='rx'&&e.type===6&&e.action===1);
const result={date:'2026-10-14',version:'0.1.64',candidate:2,synthetic:true,
  fixture:{title:'20261014064',text:'06420261014',new_capture:false,new_asr:false,task_execution:false},
  build,installed:{...installed,retained_hashes:installed.retained_hashes},final_retained:finalRetained,editor_source_identical_between_candidates:true,
  old_native_regression:{entered:oldEntered,returned:oldReturn},
  ordinary_editor:{entered:newEntered,returned:newReturn,saved_feedback:true,saved_selection_exact:true,cold_saved_selection_exact:true,cold_unsaved_draft_empty:true},
  native_chain:chain,
  protocol:{did,event_count:events.length,complete_file_and_business_ready:ready,matching_start_ack:ack(3),matching_pause_ack:ack(4),matching_resume_ack:ack(5),matching_exit_ack:ack(6),eye_requested_exit:ownEyeExit,events},
  conclusions:{page_switch_and_saved_manuscript_native_verified:true,protocol_control_cycle_verified:ready&&ack(3)&&ack(4)&&ack(5)&&ack(6)&&chain.running&&chain.paused&&chain.resumed&&chain.stopped,lens_visual_verified:false,base08_complete:false,
    background_exit_native_verified:false,live_device_page_switch_verified:false,speed_change_native_verified:false,file_import_native_verified:false}};
const output=path.join(root,'rebuild/phase1/prompter064-native-device-2026-10-14.json');fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
process.stdout.write(JSON.stringify({output,version:result.version,candidate:2,conclusions:result.conclusions,protocol_ready:ready,protocol_events:events.length,eye_requested_exit:ownEyeExit})+'\n');
