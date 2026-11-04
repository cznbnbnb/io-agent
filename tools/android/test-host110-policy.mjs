import {writeTestProductInfo} from './profile.mjs';
import {PYTHON} from './host-tools.mjs';
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const workspace=process.cwd(),root=path.join(workspace,'rebuild/android-app'),out=path.join(root,'build/host110-policy-tests');fs.mkdirSync(out,{recursive:true});
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:workspace,encoding:'utf8',timeout:60000});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error||r.status!==0)throw Error('Host110 policy check failed: '+cmd);return r.stdout;}
run(PYTHON,['-S','-X','utf8','-c',`import pathlib,sys,zipfile
root=pathlib.Path('rebuild/android-app');sys.path.insert(0,str(root));import native_route110 as p
with zipfile.ZipFile(root/'.private/hosts/RayNeo-1.0.10-258-original.apk') as z:original=z.read(p.MEMBER)
patched=p.patch_library(original);assert len(patched)==len(original)
feed=(root/'src/com/turboio/addon/Fixed60OfficialFeed.java').read_text()
assert 'PORT=18795' in feed
def string_hash(value):
 h=0
 for byte in value:
  h=((h+byte)*1025)&0xffffffff
  h^=h>>6
 h=(h*9)&0xffffffff
 h^=h>>11
 return ((h*32769)&0x3fffffff) or 1
last=0
for offset,old,new in sorted(p.SLOTS):
 assert len(old)==len(new) and string_hash(old)==string_hash(new)
 assert new.startswith(b'http://127.0.0.1:18795/g/')
 assert '"'+new.split(b':18795',1)[1].decode()+'"' in feed
 assert patched[last:offset]==original[last:offset]
 assert patched[offset:offset+len(new)]==new
 assert patched.count(new)==1 and old not in patched
 last=offset+len(old)
assert patched[last:]==original[last:]
assert b'http://127.0.0.1:18794' not in patched
for wrong in [patched,original[:-1],b'unknown',bytes([original[0]^1])+original[1:]]:
 try:p.patch_library(wrong);raise AssertionError('wrong/repeated input accepted')
 except ValueError:pass
print('Android110 route: pinned source/result, unchanged instructions/headers, exact two same-hash strings on isolated port 18795, no old routes, wrong input/repeated patch refused')`]);
const sources=['Fixed60OfficialFeed.java','Fixed60Firmware.java','Fixed60Profile.java','Host107Abi.java','HeadGestureGate.java','CardInputClosure.java','SuggestionGate.java','HeadGestureSession.java','FixedPeerHash.java','FirmwareQueue.java','NavReflect.java','LifelogState.java','TaskAttention.java'].map(n=>path.join(root,'src/com/turboio/addon',n));const original=['BoundedJson.java','OtaFrame.java'].map(n=>path.join(root,'upstream/android-addon/src/com/turboio/addon',n));
sources.push(writeTestProductInfo(out));
run('javac',['-encoding','UTF-8','-d',out,'-sourcepath',[path.join(root,'src'),path.join(root,'upstream/android-addon/src')].join(path.delimiter),'tools/android/host-policy-fixtures/com/turboio/addon/Host107Recording.java',...sources,...original,'tools/android/fixtures/Y3/D.java','tools/android/fixtures/O4/H.java','tools/android/HostPolicyTest.java','tools/android/Fixed60OfficialFeedTest.java']);
run('java',['-cp',out,'com.turboio.addon.HostPolicyTest']);
run('java',['-cp',out,'com.turboio.addon.Fixed60OfficialFeedTest','--coexistence-only']);
