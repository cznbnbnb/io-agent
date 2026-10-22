import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.join(workspace,'rebuild/android-app');
const sources=['OfficialLifelogMonthDiscovery','OfficialLifelogCalendar','OfficialLifelogCalendarRequest','OfficialLifelogInventory','OfficialLifelogJson','OfficialAccountBinding','WireJson','MaterialWire','TaskWire','TaskConnection'].map(n=>path.join(root,'src/com/turboio/addon/'+n+'.java')).concat(path.join(root,'upstream/android-addon/src/com/turboio/addon/BoundedJson.java'),path.join(workspace,'tools/android/OfficialLifelogMonthDiscoveryTest.java'));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceHashes=[...sources,fileURLToPath(import.meta.url)].map(file=>({path:path.relative(root,file),sha256:sha(file)}));
const tempRoot=fs.realpathSync(os.tmpdir()),out=fs.mkdtempSync(path.join(tempRoot,'io-month-discovery-'));
const report={schema:1,at:new Date().toISOString(),scope:'Pure JVM month discovery; synthetic account, response and in-memory transport only',device:false,network:false,android_build:false,real_response_verified_by_wrapper:false,passed:false};
const run=(command,args)=>{const r=spawnSync(command,args,{cwd:workspace,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1048576});if(r.error?.code==='EPERM'||r.error?.code==='EACCES')throw Error('MONTH_DISCOVERY_JVM_SPAWN_BLOCKED');if(r.error||r.status!==0){if(r.stderr)console.error(r.stderr);throw Error(command==='javac'?'MONTH_DISCOVERY_COMPILE_FAILED':'MONTH_DISCOVERY_TEST_FAILED');}return r.stdout;};
try{
 run('javac',['-encoding','UTF-8','-d',out,...sources]);
 const result=/^Month discovery: (\d+) synthetic checks passed\s*$/.exec(run('java',['-cp',out,'com.turboio.addon.OfficialLifelogMonthDiscoveryTest']));if(!result)throw Error('MONTH_DISCOVERY_RESULT_INVALID');
 if(sourceHashes.some(source=>sha(path.resolve(root,source.path))!==source.sha256))throw Error('MONTH_DISCOVERY_SOURCES_CHANGED');
 report.checks=Number(result[1]);report.sources=sourceHashes;report.passed=true;
}catch(error){report.error=/^MONTH_DISCOVERY_[A-Z_]+$/.test(error.message)?error.message:'MONTH_DISCOVERY_TEST_FAILED';process.exitCode=1;}
finally{
 try{const resolved=fs.realpathSync(out);if(path.dirname(resolved)!==tempRoot||!path.basename(resolved).startsWith('io-month-discovery-')||fs.lstatSync(out).isSymbolicLink())throw Error('MONTH_DISCOVERY_CLEANUP_PATH_INVALID');fs.rmSync(resolved,{recursive:true});report.temporary_classes_removed=true;}catch{report.temporary_classes_removed=false;report.passed=false;report.error='MONTH_DISCOVERY_CLEANUP_UNCONFIRMED';process.exitCode=1;}
 fs.writeFileSync(path.join(root,'lifelog-month-discovery-test-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
