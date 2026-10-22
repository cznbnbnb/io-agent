import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Reconcile retained evidence only. No phone operation or raw system publication.
const root=process.cwd(),priv=path.join(root,'rebuild/phase1/device-private'),evidence=path.join(priv,'prompter066-lock-evidence');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const build=read(path.join(root,'rebuild/phase1/prompter066-build-2026-10-14.json'));
const installed=read(path.join(priv,'prompter066-evidence/install-ledger.json'));
const current=read(path.join(evidence,'current-version-and-retention.json')),run=read(path.join(evidence,'background-ledger.json'));
const before=read(path.join(evidence,'preferences-before.json')),restored=read(path.join(evidence,'preferences-restored.json'));
assert.equal(current.version_code,10066);assert.equal(current.pid,installed.pid_after);assert.equal(run.pid_before,current.pid);assert.equal(run.pid_after,current.pid);
assert.equal(sha(path.join(root,build.signed_hap)),build.signed_hap_sha256);assert.equal(installed.hap_sha256,build.signed_hap_sha256);
const mf=path.join(root,`rebuild/phase1/candidate-runs/${build.run_id}/source-hashes.json`),manifest=read(mf);assert.equal(sha(mf),build.source_manifest_sha256);
for(const m of manifest)assert.equal(sha(path.join(root,'rebuild',m.path)),m.sha256.toLowerCase());
assert(Object.values(current.retained_bytes_unchanged).every(v=>v===true));
assert(before.background_disabled_verified&&restored.background_restored);assert.equal(before.background_enabled,restored.background_enabled);assert.equal(before.auto_connect,restored.auto_connect);
assert(run.recording_idle&&run.lifelog_idle&&run.asr_idle);assert.equal(run.failure,'');assert(run.power_requested&&run.lock_verified&&run.screen_off_verified&&run.unlocked_verified);
const screen=(file)=>{const text=fs.readFileSync(path.join(evidence,file),'utf8');const locked=/screenLocked\s+(true|false)/.exec(text),on=/screenState\s+(true|false)/.exec(text);assert(locked&&on);return{locked:locked[1]==='true',screen_on:on[1]==='true'};};
const offFiles=fs.readdirSync(evidence).filter(f=>/^screen-after-power-\d+\.txt$/.test(f)).sort();assert(offFiles.length);
const powerSamples=offFiles.map(f=>({file:f,...screen(f)}));assert(powerSamples.some(s=>s.locked&&!s.screen_on));
const preUnlock=screen('screen-before-unlock.txt'),postUnlock=screen('screen-after-unlock.txt');assert(preUnlock.locked&&!postUnlock.locked);
const ability=fs.readFileSync(path.join(evidence,'ability-after-power.txt'),'utf8');
const abilityStates=[...ability.matchAll(/^\s*app name \[org\.turboio\.harmony\.research\].*?main name \[EntryAbility\].*?\bstate #([A-Z_]+)/gms)];assert.equal(abilityStates.length,1);assert.equal(abilityStates[0][1],'BACKGROUND');
function events(file){return fs.readFileSync(path.join(evidence,file),'utf8').split(/\r?\n/).flatMap(l=>{
 const p=/^(\S+)\s+(\S+)\s+(\d+)\s+/.exec(l);if(!p||p[3]!==current.pid)return [];assert.equal(p[1],'10-14');const at=`2026-10-14T${p[2]}+08:00`;if(Date.parse(at)<Date.parse(run.at))return [];
 const m=/prompter (state|tx|rx|file-tx|file-rx|failure) did=([0-9a-f-]*) (.*)$/.exec(l),c=/prompter-bg-close (.*)$/.exec(l);if(!m&&!c)return [];
 const fields={};for(const [,key,value] of (m?m[3]:c[1]).matchAll(/(phase|progress|speed|offset|business|type|action|code|match|bytes|start|size|state|reason|budget)=([a-z_-]+|\d+)/g))fields[key]=/^\d+$/.test(value)?Number(value):value==='true'?true:value==='false'?false:value;
 return[{at,kind:m?m[1]:'background-close',did:m?m[2]:'',...fields}];
});}
const capturedBeforeUnlock=events('prompter-protocol-before-return.log'),final=events('prompter-protocol-final.log');
const all=[...new Map([...capturedBeforeUnlock,...final].map(e=>[JSON.stringify(e),e])).values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
const dids=[...new Set(all.filter(e=>e.kind==='tx'&&e.type===2&&e.action===1).map(e=>e.did))];assert.equal(dids.length,1);const did=dids[0],own=all.filter(e=>e.did===did);
const ready=own.some(e=>e.kind==='file-rx'&&e.type===5&&e.match&&e.state===0)&&own.some(e=>e.kind==='rx'&&e.type===2&&e.action===2&&e.code===7)&&own.some(e=>e.kind==='state'&&e.phase==='ready'&&e.progress===100);
const ack=type=>own.some(e=>e.kind==='tx'&&e.type===type&&e.action===1)&&own.some(e=>e.kind==='rx'&&e.type===type&&e.action===2&&e.code===1);
const window=capturedBeforeUnlock.find(e=>e.kind==='background-close'&&e.budget>0),exit=capturedBeforeUnlock.find(e=>e.did===did&&e.kind==='rx'&&e.type===6&&e.action===2&&e.code===1),release=capturedBeforeUnlock.find(e=>e.kind==='background-close'&&e.reason==='ack');
assert(window&&exit&&release&&window.budget<=10000);assert(Date.parse(window.at)<=Date.parse(exit.at)&&Date.parse(exit.at)<=Date.parse(release.at)&&Date.parse(exit.at)<Date.parse(run.before_return_at));
const transitions=fs.readFileSync(path.join(evidence,'debug-conn-final.log'),'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l)).filter(e=>e.t>=Date.parse(run.before_power_at)&&e.t<=Date.parse(run.final_status.at)).map(e=>({at:new Date(e.t).toISOString(),phase:e.phase,retries:e.retries}));
assert(transitions.some(e=>e.phase==='idle'&&Date.parse(e.at)>=Date.parse(exit.at)));assert(transitions.some(e=>e.phase==='ready'&&Date.parse(e.at)>=Date.parse(run.before_return_at)));
const result={date:'2026-10-14',version:'0.1.66',product_code_changed:false,synthetic:true,
 reused_build:{run_id:build.run_id,hap_sha256:build.signed_hap_sha256,source_manifest_sha256:build.source_manifest_sha256,source_files_unchanged:manifest.length},current,
 preferences:{before,restored},native_run:run,screen:{after_power:powerSamples,before_unlock:preUnlock,after_unlock:postUnlock,ability_after_power:abilityStates[0][1]},
 protocol:{did,ready,start_ack:ack(3),resume_ack:ack(5),exit_ack:ack(6),window,exit,release,connection_transitions:transitions,events:all},
 conclusions:{power_lock_triggered_exit_native_verified:ready&&ack(3)&&ack(5)&&ack(6)&&run.lock_verified&&run.screen_off_verified,
  same_process_unlock_reauthentication_and_draft_native_verified:run.foreground_returned&&run.draft_exact&&run.editor_enabled_after_return&&run.final_prepare_enabled,
  continuous_eight_second_screen_off_verified:false,screen_auto_wake_cause_known:false,
  original_background_preference_restored:true,lens_cleared_verified:false,official_locked_teleprompter_parity_verified:false,base08_complete:false},
 limitations:['The first sample is locked and screen-off; the sample before explicit wake is still locked but screen-on. No continuous eight-second screen-off claim.','No screen-wake cause has been established.','Normal unlocked return was automated using an observed system keypad, with credentials kept private.','This is a short text-only teleprompter lifecycle case, not long recording/background/power acceptance.']};
const output=path.join(root,'rebuild/phase1/prompter066-lock-native-2026-10-14.json');fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
process.stdout.write(JSON.stringify({output,conclusions:result.conclusions,screen:result.screen,transitions:transitions.length})+'\n');
