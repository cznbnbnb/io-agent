import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.join(workspace,'rebuild/android-app'),out=path.join(root,'build/minute-card-tests');fs.mkdirSync(out,{recursive:true});
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:workspace,encoding:'utf8',timeout:90000,maxBuffer:1024**2});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error||r.status!==0)throw Error('Minute card check failed: '+cmd);return r.stdout;}
const sources=['MinuteCardSession.java','HostBusiness.java','AtomicDocument.java','WireJson.java'].map(n=>path.join(root,'src/com/turboio/addon',n));
sources.push(...['BoundedJson.java','OtaFrame.java'].map(n=>path.join(root,'upstream/android-addon/src/com/turboio/addon',n)),'tools/android/MinuteCardTest.java');
run('javac',['-encoding','UTF-8','-d',out,...sources]);
const fixture=fs.mkdtempSync(path.join(out,'journal-')),result=run('java',['-cp',out,'com.turboio.addon.MinuteCardTest',fixture]);
const match=/minute card: (\d+) assertions passed/.exec(result);if(!match)throw Error('Missing test result');
fs.writeFileSync(path.join(root,'minute-card-test-results.json'),JSON.stringify({schema:1,at:new Date().toISOString(),assertions:Number(match[1]),sources:sources.map(p=>({path:path.relative(root,p),sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')})),scope:'JVM state machine, exact native 21/33/34/35 envelopes and real durable cleanup. No lens or device claim.',phone_tested:false,lens_tested:false},null,2)+'\n');
