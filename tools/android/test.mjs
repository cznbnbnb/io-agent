import {writeTestProductInfo} from './profile.mjs';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import {PYTHON} from './host-tools.mjs';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.join(workspace,'rebuild/android-app');
const output=path.join(root,'build/host-tests');fs.mkdirSync(output,{recursive:true});
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:workspace,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw new Error('Test command failed: '+cmd);}
const original=['BoundedJson.java','OtaFrame.java'].map(n=>path.join(root,'upstream/android-addon/src/com/turboio/addon',n));
const overlay=['Host107Abi.java','HeadGestureGate.java','CardInputClosure.java','SuggestionGate.java','HeadGestureSession.java','FixedPeerHash.java','FirmwareQueue.java','Fixed60Firmware.java','Fixed60Profile.java','NavReflect.java','TaskConnection.java','TaskProfiles.java','TaskHub.java','WireJson.java','TaskWire.java','AtomicDocument.java','TaskMailbox.java','TaskApi.java','TaskHttp.java'].map(n=>path.join(root,'src/com/turboio/addon',n));
run('node',['tools/android/test-host.mjs']);
run(PYTHON,['-S','-X','utf8','tools/android/test-manifest.py']);
overlay.push(writeTestProductInfo(output));
// Pure-JVM dependencies added since this list was written (e.g. VoiceAnswerSession) come from
// -sourcepath; Host107Abi's recording gate is a no-owner stub here and is tested by test-voice.mjs.
overlay.push(path.join(workspace,'tools/android/host-policy-fixtures/com/turboio/addon/Host107Recording.java'));
run('javac',['-encoding','UTF-8','-d',output,'-sourcepath',[path.join(root,'src'),path.join(root,'upstream/android-addon/src')].join(path.delimiter),...original,...overlay,'tools/android/fixtures/Y3/D.java','tools/android/fixtures/O4/H.java','tools/android/AtomicDocumentTest.java','tools/android/HostPolicyTest.java','tools/android/TaskConnectionTest.java','tools/android/WireJsonTest.java','tools/android/TaskMailboxTest.java','tools/android/TaskHttpsTest.java','tools/android/TaskContextsTest.java']);
run('java',['-cp',output,'com.turboio.addon.AtomicDocumentTest',output]);
run('java',['-cp',output,'com.turboio.addon.HostPolicyTest']);
run('java',['-cp',output,'com.turboio.addon.TaskConnectionTest']);
run('java',['-cp',output,'com.turboio.addon.WireJsonTest']);
run('java',['-cp',output,'com.turboio.addon.TaskMailboxTest']);
run('java',['-cp',output,'com.turboio.addon.TaskContextsTest']);
if(process.argv.includes('--https'))run('java',['-cp',output,'com.turboio.addon.TaskHttpsTest']);
fs.writeFileSync(path.join(root,'test-results.json'),JSON.stringify({schema:2,date:new Date().toISOString(),host_resolver:'passed',upstream_237_files:'passed',local_launcher_manifest:'passed',ota_readonly_gate:'passed',task_connection_contract:'passed',wire_json:'passed',durable_task_mailbox:'passed',https:process.argv.includes('--https')?'passed':'not_run',sources:overlay.map(file=>({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')})),kind:'JVM/Node and optional local HTTPS integration; no physical-device acceptance',device:false,emulator:false},null,2)+'\n');
