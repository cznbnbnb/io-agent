import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.join(workspace,'rebuild/android-app');
const temporaryRoot=fs.realpathSync(os.tmpdir());
const out=fs.mkdtempSync(path.join(temporaryRoot,'io-recording-deletion-'));
const sources=['OfficialRecordingDeletion','OfficialAccountBinding','OfficialLifelogSnapshot','LifelogRevisionMapper','OfficialLifelogJson','MaterialWire','MaterialConnection','WireJson','TaskWire','TaskConnection'].map(name=>path.join(root,'src/com/turboio/addon/'+name+'.java'));
sources.push(path.join(root,'upstream/android-addon/src/com/turboio/addon/BoundedJson.java'),path.join(workspace,'tools/android/OfficialRecordingDeletionTest.java'));
function run(command,args){const result=spawnSync(command,args,{encoding:'utf8',timeout:30000,maxBuffer:1048576});if(result.status!==0)throw Error(result.stderr||'Recording deletion check failed');return result.stdout;}
try{
 run('javac',['-encoding','UTF-8','-d',out,...sources]);
 const output=run('java',['-cp',out,'com.turboio.addon.OfficialRecordingDeletionTest']);
 if(!/^Official recording deletion: \d+ checks passed;/.test(output))throw Error('RECORDING_DELETION_RESULT_INVALID');
 console.log(output.trim());
}finally{
 const real=fs.realpathSync(out);
 if(path.dirname(real)!==temporaryRoot||!path.basename(real).startsWith('io-recording-deletion-')||fs.lstatSync(out).isSymbolicLink())throw Error('RECORDING_DELETION_CLEANUP_UNCONFIRMED');
 fs.rmSync(real,{recursive:true});
}
