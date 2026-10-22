import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.join(workspace,'rebuild/android-app');
const sources=[path.join(root,'src/com/turboio/addon/OfficialGatewaySigning.java'),path.join(workspace,'tools/android/OfficialGatewaySigningTest.java')];
const tempRoot=fs.realpathSync(os.tmpdir()),out=fs.mkdtempSync(path.join(tempRoot,'io-gateway-signing-'));
const report={schema:1,at:new Date().toISOString(),scope:'Pure Java offline signing with independent Python hashlib/hmac fixed vectors',device:false,network:false,post_transport_enabled:false,current_dart_nonempty_body_vector_verified:false,passed:false};
const run=(command,args)=>{const result=spawnSync(command,args,{cwd:workspace,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1048576});if(result.error?.code==='EPERM'||result.error?.code==='EACCES')throw Error('GATEWAY_SIGNING_JVM_SPAWN_BLOCKED');if(result.error||result.status!==0)throw Error(command==='javac'?'GATEWAY_SIGNING_COMPILE_FAILED':'GATEWAY_SIGNING_TEST_FAILED');return result.stdout;};
try{
 run('javac',['-encoding','UTF-8','-d',out,...sources]);
 const result=run('java',['-cp',out,'com.turboio.addon.OfficialGatewaySigningTest']);
 const match=/^Gateway signing: (\d+) checks passed; 9 Python fixed vectors\s*$/.exec(result);if(!match)throw Error('GATEWAY_SIGNING_RESULT_INVALID');
 report.checks=Number(match[1]);report.fixed_vectors=9;report.passed=true;
 report.sources=[...sources,fileURLToPath(import.meta.url)].map(file=>({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
}catch(error){report.error=/^GATEWAY_SIGNING_[A-Z_]+$/.test(error.message)?error.message:'GATEWAY_SIGNING_TEST_FAILED';process.exitCode=1;}
finally{
 try{const resolved=fs.realpathSync(out);if(path.dirname(resolved)!==tempRoot||!path.basename(resolved).startsWith('io-gateway-signing-')||fs.lstatSync(out).isSymbolicLink())throw Error('GATEWAY_SIGNING_CLEANUP_PATH_INVALID');fs.rmSync(resolved,{recursive:true});report.temporary_classes_removed=true;}
 catch{report.temporary_classes_removed=false;report.passed=false;report.error='GATEWAY_SIGNING_CLEANUP_UNCONFIRMED';process.exitCode=1;}
 fs.writeFileSync(path.join(root,'gateway-signing-test-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
