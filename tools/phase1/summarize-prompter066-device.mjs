import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Offline, metadata-only publication of retained evidence; never operates USB.
const root=process.cwd(),privateRoot=path.join(root,'rebuild/phase1/device-private');
const evidence=path.join(privateRoot,'prompter066-evidence'),bg=path.join(privateRoot,'prompter066-background-evidence');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const build=read(path.join(root,'rebuild/phase1/prompter066-build-2026-10-14.json'));
const installed=read(path.join(evidence,'install-ledger.json')),current=read(path.join(evidence,'current-version-and-retention.json'));
const before=read(path.join(evidence,'preferences-before.json')),restored=read(path.join(evidence,'preferences-restored.json'));
const fixture=read(path.join(evidence,'fixture.json')),run=read(path.join(bg,'background-ledger.json'));
assert.equal(installed.version_code,10066);assert.equal(current.version_code,10066);assert.equal(current.pid,installed.pid_after);assert.notEqual(installed.pid_before,installed.pid_after);
assert.equal(installed.hap_sha256,build.signed_hap_sha256);assert.equal(sha(path.join(root,build.signed_hap)),build.signed_hap_sha256);
assert(Object.values(installed.retained_bytes_unchanged).every(v=>v===true));assert(Object.values(current.retained_bytes_unchanged).every(v=>v===true));
assert(before.background_disabled_verified&&restored.background_restored);
assert.equal(before.background_enabled,restored.background_enabled);assert.equal(before.auto_connect,restored.auto_connect);
assert(run.recording_idle&&run.lifelog_idle&&run.asr_idle&&run.ability_background_verified);
assert.equal(run.failure,'');assert.equal(run.pid_before,current.pid);assert.equal(run.pid_after,current.pid);
const body=fs.readFileSync(path.join(evidence,'fixture-body.txt'),'utf8');
assert(/^\d{1931}$/.test(body));assert.equal(createHash('sha256').update(body).digest('hex'),fixture.sha256);assert.equal(run.sha256,fixture.sha256);
const manifestFile=path.join(root,`rebuild/phase1/candidate-runs/${build.run_id}/source-hashes.json`),manifest=read(manifestFile);
assert.equal(sha(manifestFile),build.source_manifest_sha256);
for(const item of manifest)assert.equal(sha(path.join(root,'rebuild',item.path)),item.sha256.toLowerCase(),`source changed: ${item.path}`);

function events(file){
 return fs.readFileSync(path.join(bg,file),'utf8').split(/\r?\n/).flatMap(line=>{
  const prefix=/^(\S+)\s+(\S+)\s+(\d+)\s+/.exec(line);if(!prefix||prefix[3]!==current.pid)return [];
  assert.equal(prefix[1],'10-14');const at=`2026-10-14T${prefix[2]}+08:00`;
  if(Date.parse(at)<Date.parse(run.at))return [];
  const m=/prompter (state|tx|rx|file-tx|file-rx|failure) did=([0-9a-f-]*) (.*)$/.exec(line);
  const close=/prompter-bg-close (.*)$/.exec(line);if(!m&&!close)return [];
  const fields={};for(const [,key,value] of (m?m[3]:close[1]).matchAll(/(phase|progress|speed|offset|business|type|action|code|match|bytes|start|size|state|reason|budget)=([a-z_-]+|\d+)/g))
   fields[key]=/^\d+$/.test(value)?Number(value):value==='true'?true:value==='false'?false:value;
  return [{at,kind:m?m[1]:'background-close',did:m?m[2]:'',...fields}];
 });
}
const initialEvents=events('prompter-protocol-before-return.log'),finalEvents=events('prompter-protocol-final.log');
const all=[...new Map([...initialEvents,...finalEvents].map(e=>[JSON.stringify(e),e])).values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
const dids=[...new Set(all.filter(e=>e.kind==='tx'&&e.type===2&&e.action===1).map(e=>e.did))];assert.equal(dids.length,1);
const did=dids[0],own=all.filter(e=>e.did===did);
const ack=type=>own.some(e=>e.kind==='tx'&&e.type===type&&e.action===1)&&own.some(e=>e.kind==='rx'&&e.type===type&&e.action===2&&e.code===1);
const ready=own.some(e=>e.kind==='file-rx'&&e.type===5&&e.match&&e.state===0)&&own.some(e=>e.kind==='rx'&&e.type===2&&e.action===2&&e.code===7)&&own.some(e=>e.kind==='state'&&e.phase==='ready'&&e.progress===100);
const window=initialEvents.find(e=>e.kind==='background-close'&&e.budget>0),exit=initialEvents.find(e=>e.kind==='rx'&&e.did===did&&e.type===6&&e.action===2&&e.code===1);
const release=initialEvents.find(e=>e.kind==='background-close'&&e.reason==='ack');
assert(window&&exit&&release);assert(window.budget<=10000);
assert(Date.parse(window.at)<=Date.parse(exit.at)&&Date.parse(exit.at)<=Date.parse(release.at));assert(Date.parse(exit.at)<Date.parse(run.before_return_at));
assert(!all.some(e=>e.kind==='background-close'&&['native-expired','budget-expired','window-denied','no-window','unconfirmed'].includes(e.reason)));
assert(!fs.readFileSync(path.join(bg,'prompter-protocol-before-return.log'),'utf8').includes('release-unconfirmed'));
const transitions=fs.readFileSync(path.join(evidence,'debug-conn-final.log'),'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l))
 .filter(e=>e.t>=Date.parse(run.before_background_at)&&e.t<=Date.parse(run.final_status.at)).map(e=>({at:new Date(e.t).toISOString(),phase:e.phase,retries:e.retries}));
const closed=transitions.find(e=>e.phase==='idle'),connecting=transitions.find(e=>e.phase==='connecting'&&e.at>=run.before_return_at),reconnected=transitions.find(e=>e.phase==='ready'&&e.at>=run.before_return_at);
assert(closed&&connecting&&reconnected);assert(Date.parse(closed.at)>=Date.parse(exit.at));
const result={date:'2026-10-14',version:'0.1.66',synthetic:true,build,installed,current,fixture,
 preferences:{before,restored},native_run:run,protocol:{did,ready,start_ack:ack(3),resume_ack:ack(5),exit_ack:ack(6),window,exit,release,connection_transitions:transitions,events:all},
 conclusions:{without_continuous_grant_exit_native_verified:ready&&ack(3)&&ack(5)&&ack(6)&&run.ability_background_verified,
  bounded_native_window_verified:true,exit_ack_before_radio_release_verified:true,
  foreground_reauthentication_and_draft_native_verified:run.draft_exact&&run.editor_enabled_after_return&&run.final_prepare_enabled&&!!reconnected,
  original_background_preference_restored:true,
  immediate_foreground_late_ack_native_verified:false,native_expiry_or_denial_verified:false,screen_lock_variant_native_verified:false,
  lens_visual_verified:false,official_background_parity_verified:false,base08_complete:false},
 limitations:['Faults, late ACK, duplicate lifecycle and immediate return are source/platform-substitute tests; they are not native fault injection.','Home is independently confirmed by AbilityMgr BACKGROUND; launcher pixels are not claimed.','Current background-exit policy and stock teleprompter display still require H01/H12 observation.']};
const output=path.join(root,'rebuild/phase1/prompter066-native-device-2026-10-14.json');fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
process.stdout.write(JSON.stringify({output,conclusions:result.conclusions,transitions:transitions.length})+'\n');
