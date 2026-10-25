import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.join(workspace,'rebuild/android-app');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'io-task-control-'));
const sources=['TaskControl','TaskMailbox','TaskHub','TaskApi','TaskPresentation','TaskProfiles','TaskConnection','TaskWire','WireJson','AtomicDocument'].map(n=>path.join(root,'src/com/turboio/addon',n+'.java'));
sources.push(path.join(root,'upstream/android-addon/src/com/turboio/addon/BoundedJson.java'),'tools/android/TaskConnectionTest.java','tools/android/TaskControlTest.java');
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:workspace,encoding:'utf8',timeout:30000,maxBuffer:1048576});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error||r.status!==0)throw r.error??Error(cmd+' failed');}
try{run('javac',['--release','8','-encoding','UTF-8','-d',out,'-sourcepath',[path.join(root,'src'),path.join(root,'upstream/android-addon/src')].join(path.delimiter),...sources]);run('java',['-cp',out,'com.turboio.addon.TaskControlTest',out]);}
finally{fs.rmSync(out,{recursive:true,force:true});}
