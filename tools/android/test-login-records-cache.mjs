import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'io-login-cache-'));
function run(c,args){const r=spawnSync(c,args,{cwd:workspace,encoding:'utf8',timeout:60000});if(r.error||r.status!==0)throw Error(r.stderr||r.error?.message||'LOGIN_CACHE_TEST_FAILED');return r.stdout;}
try{run('javac',['-encoding','UTF-8','-d',out,path.join(workspace,'rebuild/android-app/src/com/turboio/addon/LoginRecordsCache.java'),path.join(workspace,'tools/android/LoginRecordsCacheTest.java')]);console.log(run('java',['-cp',out,'com.turboio.addon.LoginRecordsCacheTest']).trim());}
finally{fs.rmSync(out,{recursive:true,force:true});}
