import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.join(workspace,'rebuild/android-app');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'io-material-task-draft-'));
const sources=['MaterialCatalog','MaterialDocument','MaterialTaskDraft','MaterialWire','WireJson','TaskWire','TaskConnection'].map(name=>path.join(root,'src/com/turboio/addon',name+'.java')).concat(path.join(root,'upstream/android-addon/src/com/turboio/addon/BoundedJson.java'),'tools/android/TaskConnectionTest.java','tools/android/MaterialTaskDraftTest.java');
function run(command,args){const result=spawnSync(command,args,{cwd:workspace,encoding:'utf8',timeout:30000,maxBuffer:1048576});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error||result.status!==0)throw result.error??Error(command+' failed');}
try{run('javac',['-encoding','UTF-8','-d',output,...sources]);run('java',['-cp',output,'com.turboio.addon.MaterialTaskDraftTest',path.join(workspace,'docs/contracts/material-v1.2.json')]);}finally{fs.rmSync(output,{recursive:true,force:true});}
