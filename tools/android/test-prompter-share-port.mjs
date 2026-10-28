import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const root=path.resolve('rebuild/android-app'),out=fs.mkdtempSync(path.join(os.tmpdir(),'io-share110-'));
const port=path.join(root,'src/com/turboio/addon/PrompterSharePort.java');
const stubs={
 'android/os/Handler.java':'package android.os;import java.util.*;public class Handler {static final List<Runnable> jobs=new ArrayList<>();public void post(Runnable r){jobs.add(r);}public static void drain(){while(!jobs.isEmpty())jobs.remove(0).run();}}',
 'android/util/Log.java':'package android.util;public class Log {public static int i(String a,String b){return 0;}}'
};
function run(command,args){const r=spawnSync(command,args,{encoding:'utf8',timeout:60000});if(r.error)throw r.error;return r;}
const report={schema:1,scope:'Production PrompterSharePort; synthetic reflection/pinned SDK shape and queued Android handler; no device IO',passed:false};
try{
 const generated=[];for(const [name,source] of Object.entries(stubs)){const file=path.join(out,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);generated.push(file);}
 const built=run('javac',['-encoding','UTF-8','-d',out,...generated,port,'tools/android/PrompterSharePortTest.java']);if(built.status!==0)throw Error(built.stderr);
 const result=run('java',['-cp',out,'com.turboio.addon.PrompterSharePortTest']);if(result.status!==0)throw Error(result.stderr);console.log(result.stdout.trim());report.checks=Number(/SHARE: (\d+)/.exec(result.stdout)[1]);
 const old=path.join(out,'PrompterSharePort.java');fs.writeFileSync(old,fs.readFileSync(port,'utf8').replace('NavReflect.field(c,"i")','NavReflect.field(c,"h")'));
 const oldBuild=run('javac',['-encoding','UTF-8','-cp',out,'-d',out,old]);if(oldBuild.status!==0)throw Error(oldBuild.stderr);
 const oldResult=run('java',['-cp',out,'com.turboio.addon.PrompterSharePortTest']);if(oldResult.status===0||!oldResult.stderr.includes('SHARE_RX_LIST'))throw Error('Old RX-list regression was not detected');
 report.old_h_list_regression_detected=true;report.passed=true;report.sources=[port,'tools/android/PrompterSharePortTest.java','tools/android/test-prompter-share-port.mjs'].map(p=>({path:path.relative(root,p),sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}));console.log('Old h-list regression detected');
}finally{fs.rmSync(out,{recursive:true,force:true});fs.writeFileSync(path.join(root,'prompter-share-port-test-results.json'),JSON.stringify(report,null,2)+'\n');}
