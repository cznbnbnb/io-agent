import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'io-wake-gate-'));
function run(command,args){const result=spawnSync(command,args,{cwd:workspace,encoding:'utf8',timeout:30000,maxBuffer:1048576});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error||result.status!==0)throw result.error??Error(command+' failed');}
try{
 run('javac',['--release','8','-encoding','UTF-8','-d',output,'rebuild/android-app/src/com/turboio/addon/Host107WakeGateCore.java','tools/android/Host107WakeGateCoreTest.java']);
 run('java',['-cp',output,'com.turboio.addon.Host107WakeGateCoreTest']);
}finally{fs.rmSync(output,{recursive:true,force:true});}
