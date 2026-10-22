import {writeTestProductInfo} from './profile.mjs';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.join(workspace,'rebuild/android-app');
const output=path.join(root,'build/fixed60-tests');fs.mkdirSync(output,{recursive:true});
function run(command,args){const result=spawnSync(command,args,{cwd:workspace,encoding:'utf8'});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error)throw result.error;if(result.status!==0)throw new Error(command+' failed');return result.stdout;}
run('python',['-S','-X','utf8','tools/android/fixed60-profile.py','--check']);
const original=['BoundedJson.java','OtaFrame.java','OtaRecoveryGuard.java'].map(n=>path.join(root,'upstream/android-addon/src/com/turboio/addon',n));
const sources=['Fixed60Profile.java','Fixed60Firmware.java','Fixed60Journal.java','Fixed60Session.java','FirmwareRecoverySelection.java','GlassesConnection.java','FirmwareQueue.java','Host107Abi.java','HeadGestureGate.java','CardInputClosure.java','SuggestionGate.java','HeadGestureSession.java','FixedPeerHash.java','NavReflect.java','AtomicDocument.java','WireJson.java'].map(n=>path.join(root,'src/com/turboio/addon',n));
sources.push(writeTestProductInfo(output));
run('javac',['-encoding','UTF-8','-d',output,...original,...sources,'tools/android/fixtures/Y3/D.java','tools/android/Fixed60Test.java','tools/android/HostPolicyTest.java']);
run('java',['-cp',output,'com.turboio.addon.HostPolicyTest']);
const base=path.join(workspace,'rebuild/phase1/device-private/stock-firmware-1.0.5.5');
const result=run('java',['-cp',output,'com.turboio.addon.Fixed60Test',path.join(base,'suggestion60-candidate/StrixOS-1.0.5.5-SUGGEST60-OFFLINE-01-UNFLASHED.zip'),path.join(base,'Strix-OS-1.0.5.5-original.zip'),output]);
const count=/Fixed60 offline checks: (\d+) passed/.exec(result);if(!count)throw new Error('Missing test completion marker');
fs.writeFileSync(path.join(root,'fixed60-test-results.json'),JSON.stringify({schema:1,at:new Date().toISOString(),kind:'JVM: actual pinned firmware verification and simulated protocol/SDK receipts',checks:Number(count[1]),candidate:JSON.parse(fs.readFileSync(path.join(root,'fixed60-profile.json'),'utf8')).zip_sha256,sources:sources.map(file=>({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')})),device_io:false,network_io:false,firmware_written:false,android_sdk_transport_tested:false,real_installation_verified:false,lens_duration_verified:false,overall:'passed_for_stated_offline_scope'},null,2)+'\n');
