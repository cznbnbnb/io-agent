import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Offline publication of retained metadata. This tool never operates a phone.
const root=process.cwd(),privateRoot=path.join(root,'rebuild/phase1/device-private');
const evidence=path.join(privateRoot,'prompter065-background-evidence');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const initial=read(path.join(evidence,'background-ledger.json'));
const finish=read(path.join(evidence,'finish-ledger.json'));
const recovery=read(path.join(evidence,'recovery-ledger.json'));
const current=read(path.join(evidence,'current-version-and-retention.json'));
const build=read(path.join(root,'rebuild/phase1/prompter065-build-2026-10-14.json'));
const installed=read(path.join(privateRoot,'prompter065-evidence/install-ledger.json'));
assert.equal(current.version_code,10065);assert.equal(current.pid,initial.pid_before);
assert.equal(current.pid,finish.pid_after);assert.equal(current.pid,installed.pid_after);
assert.equal(current.version,'0.1.65');assert.equal(installed.hap_sha256,build.signed_hap_sha256);
assert.equal(sha(path.join(root,build.signed_hap)),build.signed_hap_sha256);
assert(initial.recording_idle&&initial.lifelog_idle&&initial.asr_idle);
assert(Object.values(current.retained_bytes_unchanged).every(v=>v===true));
const manifestFile=path.join(root,`rebuild/phase1/candidate-runs/${build.run_id}/source-hashes.json`);
assert.equal(sha(manifestFile),build.source_manifest_sha256);
const manifest=read(manifestFile);
for(const item of manifest)assert.equal(sha(path.join(root,'rebuild',item.path)),item.sha256.toLowerCase(),`source changed: ${item.path}`);

const ability=fs.readFileSync(path.join(evidence,'ability-before-return.txt'),'utf8');
const states=[...ability.matchAll(/^\s*app name \[org\.turboio\.harmony\.research\].*?main name \[EntryAbility\].*?\bstate #([A-Z_]+)/gms)];
assert.equal(states.length,1);assert.equal(states[0][1],'BACKGROUND');
const body='06420261014'+'73928642'.repeat(240);
assert.equal(initial.sha256,createHash('sha256').update(body).digest('hex'));
function editor(file){
  const nodes=[];const visit=n=>{nodes.push(n);for(const c of n.children||[])visit(c);};
  visit(read(path.join(privateRoot,file)));
  const roots=nodes.filter(n=>n.attributes?.type==='root'&&n.attributes.focused==='true'&&n.attributes.bundleName==='org.turboio.harmony.research');assert.equal(roots.length,1);
  const own=nodes.map(n=>n.attributes||{}).filter(a=>a.hostWindowId===roots[0].attributes.hostWindowId&&a.visible==='true');
  assert(own.some(a=>a.text==='TURBO IO'));
  const titles=own.filter(a=>a.type==='TextInput'),bodies=own.filter(a=>a.type==='TextArea');assert.equal(titles.length,1);assert.equal(bodies.length,1);
  return{title_exact:titles[0].text==='20261014064',body_exact:bodies[0].text===body,editor_enabled:bodies[0].enabled==='true'};
}
const returnedEditor=editor('prompter065-bg-final-draft.json');
assert(returnedEditor.title_exact&&returnedEditor.body_exact&&returnedEditor.editor_enabled);
function events(file){
  return fs.readFileSync(path.join(evidence,file),'utf8').split(/\r?\n/).flatMap(line=>{
    const prefix=/^(\S+)\s+(\S+)\s+(\d+)\s+/.exec(line);
    const match=/prompter (state|tx|rx|file-tx|file-rx|failure) did=([0-9a-f-]*) (.*)$/.exec(line);
    if(!prefix||prefix[3]!==current.pid||!match)return [];
    assert.equal(prefix[1],'10-14');
    const at=`2026-10-14T${prefix[2]}+08:00`;
    if(Date.parse(at)<Date.parse(initial.at))return [];
    const fields={};for(const [,key,value] of match[3].matchAll(/(phase|progress|speed|offset|business|type|action|code|match|bytes|start|size|state|reason)=([a-z_-]+|\d+)/g))
      fields[key]=/^\d+$/.test(value)?Number(value):value==='true'?true:value==='false'?false:value;
    return [{at,kind:match[1],did:match[2],...fields}];
  });
}
const before=events('prompter-protocol-before-actual-return.log');
const final=events('prompter-protocol-after-recovery.log');
const all=[...new Map([...before,...final].map(e=>[JSON.stringify(e),e])).values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
const dids=[...new Set(all.filter(e=>e.kind==='tx'&&e.type===2&&e.action===1).map(e=>e.did))];assert.equal(dids.length,2);
function describe(did){
  const own=all.filter(e=>e.did===did);
  const complete=own.some(e=>e.kind==='file-tx'&&e.type===1&&e.business===17)
    &&own.some(e=>e.kind==='file-rx'&&e.type===5&&e.match&&e.state===0)
    &&own.some(e=>e.kind==='rx'&&e.type===2&&e.action===2&&e.code===7)
    &&own.some(e=>e.kind==='state'&&e.phase==='ready'&&e.progress===100);
  const ack=type=>own.some(e=>e.kind==='tx'&&e.type===type&&e.action===1)&&own.some(e=>e.kind==='rx'&&e.type===type&&e.action===2&&e.code===1);
  return{did,complete_file_and_business_ready:complete,start_ack:ack(3),resume_ack:ack(5),exit_ack:ack(6),events:own};
}
const background=describe(dids[0]),reprepared=describe(dids[1]);
const exitsBeforeReturn=before.filter(e=>e.did===background.did&&e.kind==='rx'&&e.type===6&&e.action===2&&e.code===1&&Date.parse(e.at)<Date.parse(finish.before_return_at));
const idleBeforeReturn=before.some(e=>e.kind==='state'&&e.phase==='idle'&&Date.parse(e.at)>=Date.parse(initial.before_background_at)&&Date.parse(e.at)<Date.parse(finish.before_return_at));
const connectionTransitions=fs.readFileSync(path.join(evidence,'debug-conn-final.log'),'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))
  .filter(e=>e.t>=Date.parse(initial.before_background_at)&&e.t<=Date.parse(recovery.final_status.at)).map(e=>({at:new Date(e.t).toISOString(),phase:e.phase,retries:e.retries}));
const result={date:'2026-10-14',version:'0.1.65',product_code_changed:false,synthetic:true,
  reused_build:{run_id:build.run_id,hap_sha256:build.signed_hap_sha256,source_manifest_sha256:build.source_manifest_sha256,source_files_unchanged:manifest.length,original_host_tests:build.host_app_tests},
  fixture:{utf8_bytes:1931,sha256:initial.sha256,unsaved_draft_only:true,new_capture:false,new_asr:false,task_execution:false},
  current,initial,finish,recovery,returned_editor:returnedEditor,
  protocol:{background,reprepared,exit_ack_present_in_before_return_capture:exitsBeforeReturn.length===1,idle_before_return:idleBeforeReturn,connection_transitions:connectionTransitions},
  conclusions:{background_exit_ack_native_verified:initial.home_requested&&background.complete_file_and_business_ready&&background.start_ack&&background.resume_ack&&exitsBeforeReturn.length===1&&idleBeforeReturn,
    same_process_draft_return_native_verified:finish.same_process&&returnedEditor.body_exact&&returnedEditor.editor_enabled&&finish.final_prepare_enabled,
    reprepare_after_return_native_verified:recovery.ready&&reprepared.complete_file_and_business_ready&&reprepared.exit_ack&&recovery.final_idle,
    no_reauthentication_observed_in_connection_trace:connectionTransitions.length===0,
    background_without_native_grant_verified:false,screen_lock_variant_native_verified:false,lens_cleared_verified:false,official_background_parity_verified:false,base08_complete:false},
  limitations:['Home transition accessibility provided no focused bundle; independent AbilityMgr BACKGROUND evidence was retained.','Return UI observation stopped while the header was occluded; no new card was sent during retries.','Scoped marker fallback was not exercised in the successful return check.','Native background qualification was not toggled in this batch. The no-grant path still closes radios immediately after asynchronous stop; that race is not fixed or verified.','Current background-exit policy is not evidence of official lock-screen teleprompter parity.']};
const output=path.join(root,'rebuild/phase1/prompter065-background-native-2026-10-14.json');
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
process.stdout.write(JSON.stringify({output,conclusions:result.conclusions,connection_transitions:connectionTransitions.length})+'\n');
