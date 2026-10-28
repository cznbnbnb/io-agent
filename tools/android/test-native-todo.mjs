import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),addon=path.join(root,'rebuild/android-app'),out=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'io-native-todo-'));
try{
 const sources=['NativeTodoSession','TaskWire','WireJson','TaskConnection'].map(n=>path.join(addon,'src/com/turboio/addon',n+'.java')).concat(['OtaFrame','BoundedJson'].map(n=>path.join(addon,'upstream/android-addon/src/com/turboio/addon',n+'.java')),path.join(root,'tools/android/NativeTodoSessionTest.java'));
 for(const [cmd,args] of [['javac',['-encoding','UTF-8','-d',out,...sources]],['java',['-cp',out,'com.turboio.addon.NativeTodoSessionTest']]]){const r=spawnSync(cmd,args,{encoding:'utf8',timeout:30000,maxBuffer:1048576});if(r.error)throw r.error;if(r.status!==0)throw Error(r.stderr||r.stdout);if(cmd==='java')process.stdout.write(r.stdout);}
}finally{fs.rmSync(out,{recursive:true,force:true});}
