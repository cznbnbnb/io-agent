import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Publish metadata from retained evidence only; never operate a device here.
// Keep raw layouts, manuscript libraries, system logs and credentials private.
const root=process.cwd(),privateRoot=path.join(root,'rebuild/phase1/device-private');
const evidence=path.join(privateRoot,'prompter065-evidence');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const build=read(path.join(root,'rebuild/phase1/prompter065-build-2026-10-14.json'));
const installed=read(path.join(evidence,'install-ledger.json'));
const short=read(path.join(evidence,'chain-ledger.json'));
const long=read(path.join(evidence,'long-controls-ledger.json'));
const cycle=read(path.join(evidence,'cycle-controls-ledger.json'));
const finalRetained=read(path.join(evidence,'retained-final.json'));
assert.equal(installed.version_code,10065);assert.notEqual(installed.pid_before,installed.pid_after);
assert.equal(installed.hap_sha256,build.signed_hap_sha256);
assert.equal(sha(path.join(root,build.signed_hap)),build.signed_hap_sha256);
assert(Object.values(installed.retained_bytes_unchanged).every(v=>v===true));
assert(Object.values(finalRetained.after_protocol_retained_bytes_unchanged).every(v=>v===true));
const manifestFile=path.join(root,`rebuild/phase1/candidate-runs/${build.run_id}/source-hashes.json`);
assert.equal(sha(manifestFile),build.source_manifest_sha256);
const manifest=read(manifestFile);
for(const item of manifest)assert.equal(sha(path.join(root,'rebuild',item.path)),item.sha256.toLowerCase(),`changed source: ${item.path}`);

const expectedBody='06420261014'+'73928642'.repeat(240);
const expectedHash=createHash('sha256').update(expectedBody).digest('hex');
for(const ledger of [long,cycle]){
  assert.equal(ledger.sha256,expectedHash);assert.equal(ledger.utf8_bytes,1931);
  assert(ledger.unsaved_draft_only&&!ledger.original_saved_entry_modified);
}
function ownEditor(file){
  const nodes=[];const visit=n=>{nodes.push(n);for(const child of n.children||[])visit(child);};
  visit(read(path.join(privateRoot,file)));
  const roots=nodes.filter(n=>n.attributes?.type==='root'&&n.attributes.focused==='true'&&n.attributes.bundleName==='org.turboio.harmony.research');
  assert.equal(roots.length,1);
  const attrs=nodes.map(n=>n.attributes||{}).filter(a=>a.hostWindowId===roots[0].attributes.hostWindowId&&a.visible==='true');
  assert(attrs.some(a=>a.text==='TURBO IO'));
  const title=attrs.filter(a=>a.type==='TextInput'),body=attrs.filter(a=>a.type==='TextArea');
  assert.equal(title.length,1);assert.equal(body.length,1);
  return{title_exact:title[0].text==='20261014064',body_exact:body[0].text===expectedBody,body_disabled:body[0].enabled==='false'};
}
const switched=ownEditor('prompter065-long-switch-editor.json');
assert(switched.title_exact&&switched.body_exact&&switched.body_disabled);

const lines=new Set();
for(const name of ['prompter-protocol.log','prompter-protocol-after-long.log','prompter-protocol-after-cycle.log']){
  for(const line of fs.readFileSync(path.join(evidence,name),'utf8').split(/\r?\n/)){
    const prefix=/^(\S+)\s+(\S+)\s+(\d+)\s+/.exec(line);
    if(prefix&&prefix[3]===installed.pid_after)lines.add(line.trim());
  }
}
const events=[];
for(const line of [...lines].sort()){
  const match=/prompter (state|tx|rx|file-tx|file-rx|failure) did=([0-9a-f-]*) (.*)$/.exec(line);
  if(!match)continue;
  const fields={};for(const [,key,value] of match[3].matchAll(/(phase|progress|speed|offset|business|type|action|code|match|bytes|start|size|state|reason)=([a-z_-]+|\d+)/g))
    fields[key]=/^\d+$/.test(value)?Number(value):value==='true'?true:value==='false'?false:value;
  const [date,time]=line.split(/\s+/);
  events.push({sequence:events.length+1,local_time:`${date} ${time}`,kind:match[1],did:match[2],...fields});
}
const dids=events.filter(e=>e.kind==='tx'&&e.type===2&&e.action===1).map(e=>e.did);
assert.equal(new Set(dids).size,3,'three bounded native submissions must be retained');
function protocol(did){
  const own=events.filter(e=>e.did===did);
  const sent=type=>own.some(e=>e.kind==='tx'&&e.type===type&&e.action===1);
  const ack=type=>sent(type)&&own.some(e=>e.kind==='rx'&&e.type===type&&e.action===2&&e.code===1);
  const state=phase=>own.some(e=>e.kind==='state'&&e.phase===phase);
  const ready=own.some(e=>e.kind==='file-tx'&&e.type===1&&e.business===17)
    &&own.some(e=>e.kind==='file-rx'&&e.type===5&&e.match&&e.state===0)
    &&own.some(e=>e.kind==='rx'&&e.type===2&&e.action===2&&e.code===7)
    &&own.some(e=>e.kind==='state'&&e.phase==='ready'&&e.progress===100);
  return{did,complete_file_and_business_ready:ready,
    requested_file_bytes:own.filter(e=>e.kind==='file-rx'&&e.type===3&&e.match).map(e=>({start:e.start,size:e.size})),
    matching_start_ack:ack(3)&&state('running'),
    eye_requested_pause:own.some(e=>e.kind==='rx'&&e.type===4&&e.action===1&&e.code===1)&&state('paused'),
    matching_phone_pause_ack:ack(4)&&state('paused'),matching_resume_ack:ack(5)&&state('running'),
    matching_speed_ack:ack(7),confirmed_speeds:[...new Set(own.filter(e=>e.kind==='state'&&e.phase!=='controlling').map(e=>e.speed))],
    matching_exit_ack:ack(6),failures:own.filter(e=>e.kind==='failure'),events:own};
}
const protocols=dids.map(protocol),shortProtocol=protocols[0],longProtocol=protocols[1],cycleProtocol=protocols[2];
const fullCycle=cycleProtocol.complete_file_and_business_ready&&cycleProtocol.matching_start_ack
  &&cycleProtocol.matching_phone_pause_ack&&cycleProtocol.matching_resume_ack&&cycleProtocol.matching_exit_ack&&cycle.final_idle;
const speedConfirmed=long.speed_submitted&&longProtocol.matching_speed_ack&&longProtocol.confirmed_speeds.includes(long.requested_speed);
const result={date:'2026-10-14',version:'0.1.65',synthetic:true,build,installed,final_retained:finalRetained,
  source_manifest_files_unchanged:manifest.length,
  fixtures:{short:{utf8_bytes:11},long:{utf8_bytes:1931,sha256:expectedHash,unsaved_draft_only:true,new_capture:false,new_asr:false,task_execution:false}},
  automation_limits:{input_text_appended_to_existing_draft:true,initial_exact_text_guard_stopped_without_sending:true,initial_centre_swipe_was_consumed_by_textarea:true,corrected_live_outer_scroll_gutter:true},
  native_ui:{short,long,cycle,active_page_switch:switched},
  protocol:{short:shortProtocol,long:longProtocol,control_cycle:cycleProtocol,event_count:events.length},
  conclusions:{file_channel17_native_verified:protocols.every(p=>p.complete_file_and_business_ready),
    short_start_and_exit_native_verified:shortProtocol.matching_start_ack&&shortProtocol.matching_exit_ack&&short.stopped,
    phone_control_cycle_native_verified:fullCycle,confirmed_speed180_native_verified:speedConfirmed&&long.requested_speed===180,
    active_phone_page_switch_native_verified:long.page_switch_preserved&&switched.body_disabled,
    observed_eye_pause_cause_known:false,lens_visual_verified:false,base08_complete:false,
    background_exit_native_verified:false,maximum48k_transfer_native_verified:false,unicode_lens_layout_verified:false,file_import_native_verified:false},
  limitations:['Synthetic digits are not lens readability evidence.','Short and long starts both received unsolicited eye pause; the cause is unknown.','Source metadata and matching control ACKs do not prove visible scrolling or lens speed.','Code2/3 meaning remains unconfirmed; ACK guards were not relaxed.']};
const output=path.join(root,'rebuild/phase1/prompter065-native-device-2026-10-14.json');
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
process.stdout.write(JSON.stringify({output,version:result.version,event_count:events.length,conclusions:result.conclusions})+'\n');
