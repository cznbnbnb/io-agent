import {writeTestProductInfo} from './profile.mjs';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.join(workspace,'rebuild/android-app'),out=path.join(root,'build/official-preparation-tests');fs.mkdirSync(out,{recursive:true});
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const reference=path.join(root,'reference/patch-ios105-ota-source.mjs');assert.equal(hash(reference),'6a60840d547782e042e1ca7d0d6c1dbb319d5f854f79357e29954356037e9806');
const {stringHash}=await import('../../rebuild/android-app/reference/patch-ios105-ota-source.mjs');
for(const [old,replacement] of [['/xrlauncherapi/v1/signApi/gray/upgrade','http://127.0.0.1:18794/g/xxxxxxxA78p2M'],['/xrlauncherhwapi/v1/signApi/gray/upgrade','http://127.0.0.1:18794/g/xxxxxxxxxxCCXhB']]){assert.equal(old.length,replacement.length);assert.equal(stringHash(old),stringHash(replacement));}
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:workspace,encoding:'utf8',maxBuffer:1024**2});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error||r.status!==0)throw Error('Official preparation check failed: '+cmd);return r.stdout;}
run('python',['-S','-X','utf8','-c',`import pathlib,sys,zipfile,hashlib,json
root=pathlib.Path('rebuild/android-app');sys.path.insert(0,str(root));import native_route107 as p
with zipfile.ZipFile(root/'.private/hosts/RayNeo-1.0.7-230-original.apk') as z:original=z.read(p.MEMBER)
patched=p.patch_library(original);assert len(patched)==len(original)
last=0
for offset,old,new in sorted(p.SLOTS):
 assert patched[last:offset]==original[last:offset]
 assert patched[offset:offset+len(new)]==new
 last=offset+len(old)
assert patched[last:]==original[last:]
for wrong in [patched,original[:-1],b'unknown',bytes([original[0]^1])+original[1:]]:
 try:p.patch_library(wrong);raise AssertionError('wrong/repeated input accepted')
 except ValueError:pass
print('Android107 route: pinned source/result, unchanged instructions/headers, exact two strings, wrong input/repeated patch refused')`]);
const sources=['Fixed60OfficialFeed.java','Fixed60Firmware.java','Fixed60Profile.java','Host107Abi.java','HeadGestureGate.java','CardInputClosure.java','SuggestionGate.java','HeadGestureSession.java','FixedPeerHash.java','FirmwareQueue.java','NavReflect.java'].map(n=>path.join(root,'src/com/turboio/addon',n));const original=['BoundedJson.java','OtaFrame.java'].map(n=>path.join(root,'upstream/android-addon/src/com/turboio/addon',n));
sources.push(writeTestProductInfo(out));
run('javac',['-encoding','UTF-8','-d',out,...sources,...original,'tools/android/fixtures/Y3/D.java','tools/android/Fixed60OfficialFeedTest.java','tools/android/HostPolicyTest.java']);
run('java',['-cp',out,'com.turboio.addon.HostPolicyTest']);
const candidate=path.join(workspace,'rebuild/phase1/device-private/stock-firmware-1.0.5.5/suggestion60-candidate/StrixOS-1.0.5.5-SUGGEST60-OFFLINE-01-UNFLASHED.zip');
const result=run('java',['-cp',out,'com.turboio.addon.Fixed60OfficialFeedTest',candidate]);const match=/source\/guard: (\d+) assertions passed/.exec(result);if(!match)throw Error('Missing fixed60 feed result');
fs.writeFileSync(path.join(root,'official-preparation-test-results.json'),JSON.stringify({schema:1,at:new Date().toISOString(),kind:'Pinned Android107 data-only routing and actual fixed60 ZIP local HTTP preparation; no phone/firmware writes',assertions:Number(match[1]),canonical_string_size_and_hash_preserved:true,exact_native_allowlist:true,sdk_ambient_write_policy:'passed',sources:[...sources,path.join(root,'native_route107.py')].map(p=>({path:path.relative(root,p),sha256:hash(p)})),phone_tested:false,official_downloader_tested:false,firmware_written:false,overall:'passed_for_stated_offline_scope'},null,2)+'\n');
