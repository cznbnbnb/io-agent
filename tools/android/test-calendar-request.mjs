import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.join(workspace,'rebuild/android-app');
const sources=[path.join(root,'src/com/turboio/addon/OfficialLifelogCalendarRequest.java'),path.join(workspace,'tools/android/OfficialLifelogCalendarRequestTest.java')];
const tempRoot=fs.realpathSync(os.tmpdir()),out=fs.mkdtempSync(path.join(tempRoot,'io-calendar-request-'));
const report={schema:1,at:new Date().toISOString(),scope:'Pure Java explicit single-month request construction; no response, HTTP or production integration',device:false,network:false,calendar_sync_available:false,passed:false};
const run=(command,args)=>{const result=spawnSync(command,args,{cwd:workspace,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1048576});if(result.error?.code==='EPERM'||result.error?.code==='EACCES')throw Error('CALENDAR_JVM_SPAWN_BLOCKED');if(result.error||result.status!==0)throw Error(command==='javac'?'CALENDAR_COMPILE_FAILED':'CALENDAR_TEST_FAILED');return result.stdout;};
try{
 run('javac',['-encoding','UTF-8','-d',out,...sources]);
 const result=run('java',['-cp',out,'com.turboio.addon.OfficialLifelogCalendarRequestTest']);
 const match=/^Calendar request: (\d+) checks passed\s*$/.exec(result);if(!match)throw Error('CALENDAR_TEST_RESULT_INVALID');
 report.checks=Number(match[1]);report.passed=true;
 report.sources=[...sources,fileURLToPath(import.meta.url)].map(file=>({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
}catch(error){report.error=/^CALENDAR_[A-Z_]+$/.test(error.message)?error.message:'CALENDAR_TEST_FAILED';process.exitCode=1;}
finally{
 try{const resolved=fs.realpathSync(out);if(path.dirname(resolved)!==tempRoot||!path.basename(resolved).startsWith('io-calendar-request-')||fs.lstatSync(out).isSymbolicLink())throw Error('CALENDAR_CLEANUP_PATH_INVALID');fs.rmSync(resolved,{recursive:true});report.temporary_classes_removed=true;}
 catch{report.temporary_classes_removed=false;report.passed=false;report.error='CALENDAR_CLEANUP_UNCONFIRMED';process.exitCode=1;}
 fs.writeFileSync(path.join(root,'calendar-request-test-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
