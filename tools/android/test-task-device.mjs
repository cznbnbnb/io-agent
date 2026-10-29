// JVM checks for TaskDevice (one-time phone pairing, renewal and derived per-session connections).
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.join(workspace,'rebuild/android-app'),out=path.join(root,'build/task-device-tests');fs.mkdirSync(out,{recursive:true});
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:workspace,encoding:'utf8',timeout:90000});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error||r.status!==0)throw Error('Task device check failed: '+cmd);return r.stdout;}
const sources=['PhonePresence.java','SessionPairingCode.java','TaskDevice.java','TaskConnection.java','TaskProfiles.java','TaskWire.java','WireJson.java'].map(n=>path.join(root,'src/com/turboio/addon',n));
sources.push(path.join(root,'upstream/android-addon/src/com/turboio/addon/BoundedJson.java'),path.join(workspace,'tools/android/TaskDeviceTest.java'),path.join(workspace,'tools/android/SessionPairingCodeTest.java'));
run('javac',['-encoding','UTF-8','-d',out,'-sourcepath',[path.join(root,'src'),path.join(root,'upstream/android-addon/src')].join(path.delimiter),...sources]);
if(!/task device: \d+ checks passed/.test(run('java',['-cp',out,'com.turboio.addon.TaskDeviceTest'])))throw Error('Missing test result');

run('java',['-cp',out,'com.turboio.addon.SessionPairingCodeTest']);
