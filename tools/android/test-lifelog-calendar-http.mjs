import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.join(workspace,'rebuild/android-app');
const sourceRoot=path.join(root,'src/com/turboio/addon');
const sources=['Host107LifelogHttp.java','OfficialLifelogCalendarRequest.java','OfficialGatewaySigning.java','OfficialTodoCreate.java','OfficialLifelogJson.java','WireJson.java'].map(name=>path.join(sourceRoot,name));
sources.push(path.join(root,'upstream/android-addon/src/com/turboio/addon/BoundedJson.java'));
sources.push(path.join(workspace,'tools/android/Host107LifelogCalendarHttpTest.java'));
const temporaryRoot=fs.realpathSync(os.tmpdir()),out=fs.mkdtempSync(path.join(temporaryRoot,'io-calendar-http-'));
const report={schema:1,at:new Date().toISOString(),scope:'Unmodified production calendar HTTP transport with synthetic Android/login/HTTPS doubles; real 30-second independent disconnect',device:false,network:false,installed_apk_or_credentials_read:false,passed:false};
function run(command,args,timeout=30000){const result=spawnSync(command,args,{cwd:workspace,encoding:'utf8',windowsHide:true,timeout,maxBuffer:1048576});if(['EPERM','EACCES'].includes(result.error?.code))throw Error('CALENDAR_HTTP_JVM_SPAWN_BLOCKED');if(result.error||result.status!==0){if(result.stderr)console.error(result.stderr);throw Error(command==='javac'?'CALENDAR_HTTP_COMPILE_FAILED':'CALENDAR_HTTP_TEST_FAILED');}return result.stdout;}
try{
 const stubs={
  'android/content/Context.java':'package android.content; public class Context {public Context getApplicationContext(){return this;} public android.content.pm.ApplicationInfo getApplicationInfo(){return new android.content.pm.ApplicationInfo();}}',
  'android/content/pm/ApplicationInfo.java':'package android.content.pm; public class ApplicationInfo {public String sourceDir="unused-synthetic-apk";}',
  'android/os/SystemClock.java':'package android.os; public final class SystemClock {public static long elapsedRealtime(){return java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime());}}'
 };
 const stubPaths=[];for(const [name,source] of Object.entries(stubs)){const file=path.join(out,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);stubPaths.push(file);}
 run('javac',['-encoding','UTF-8','-d',out,...stubPaths,...sources]);
 const output=run('java',['-cp',out,'com.turboio.addon.Host107LifelogCalendarHttpTest'],45000);
 const result=/^Calendar transport: (\d+) checks passed; fake HTTPS only, real independent deadline\s*$/.exec(output);if(!result)throw Error('CALENDAR_HTTP_RESULT_INVALID');
 report.checks=Number(result[1]);report.passed=true;report.sources=[...sources,fileURLToPath(import.meta.url)].map(file=>({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
}catch(error){report.error=/^CALENDAR_HTTP_[A-Z_]+$/.test(error.message)?error.message:'CALENDAR_HTTP_TEST_FAILED';process.exitCode=1;}
finally{
 try{const resolved=fs.realpathSync(out);if(path.dirname(resolved)!==temporaryRoot||!path.basename(resolved).startsWith('io-calendar-http-')||fs.lstatSync(out).isSymbolicLink())throw Error('CALENDAR_HTTP_CLEANUP_PATH_INVALID');fs.rmSync(resolved,{recursive:true});report.temporary_classes_removed=true;}
 catch{report.temporary_classes_removed=false;report.passed=false;report.error='CALENDAR_HTTP_CLEANUP_UNCONFIRMED';process.exitCode=1;}
 fs.writeFileSync(path.join(root,'lifelog-calendar-http-test-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
