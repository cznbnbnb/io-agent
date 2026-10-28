import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sourceRoot=path.join(workspace,'rebuild/android-app/src/com/turboio/addon');
const sources=['OfficialTodoCreate','OfficialLifelogJson','WireJson'].map(name=>path.join(sourceRoot,name+'.java')).concat(
 path.join(workspace,'rebuild/android-app/upstream/android-addon/src/com/turboio/addon/BoundedJson.java'),path.join(workspace,'tools/android/OfficialTodoCreateTest.java'));
const tempRoot=fs.realpathSync(os.tmpdir()),out=fs.mkdtempSync(path.join(tempRoot,'io-official-todo-'));
const report={schema:1,at:new Date().toISOString(),scope:'Pure JVM stock todo create request and ApiResponse<BaseIdDTO> boundary; synthetic data only',device:false,network:false,official_write_executed:false,passed:false};
try{
 for(const [command,args] of [['javac',['-encoding','UTF-8','-d',out,...sources]],['java',['-cp',out,'com.turboio.addon.OfficialTodoCreateTest']]]){
  const result=spawnSync(command,args,{cwd:workspace,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1048576});
  if(result.error)throw result.error;if(result.status!==0)throw Error(result.stderr||result.stdout||'TODO_TEST_FAILED');
  if(command==='java'){const count=/^Todo create: (\d+) synthetic checks passed\s*$/.exec(result.stdout);if(!count)throw Error('TODO_TEST_RESULT_INVALID');report.checks=Number(count[1]);}
 }
 report.passed=true;report.sources=[...sources,fileURLToPath(import.meta.url)].map(file=>({path:path.relative(workspace,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
}finally{fs.rmSync(out,{recursive:true,force:true});}
console.log(JSON.stringify(report));
