// Compile the current addon sources without rewriting the shared host/APK stage.
// The temporary output is removed on success and failure; stdout is a small proof.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {productInfoSource} from './profile.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../rebuild/android-app');
const sdk=path.join(root,'.tools/sdk'),androidJar=path.join(sdk,'platforms/android-36/android.jar');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function sourceFiles(){
  const result=new Map();
  for(const directory of ['upstream/android-addon/src/com/turboio/addon','src/com/turboio/addon'])
    for(const name of fs.readdirSync(path.join(root,directory)).filter(name=>name.endsWith('.java')).sort())
      result.set(name,path.join(root,directory,name));
  return [...result].sort(([a],[b])=>a.localeCompare(b));
}
const manifest=files=>files.map(([name,file])=>[name,sha(fs.readFileSync(file))]);
function run(command,args){
  const result=spawnSync(command,args,{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
  if(result.stderr)process.stderr.write(result.stderr);
  if(result.error||result.status!==0)throw result.error??Error(command+' failed ('+result.status+'): '+result.stdout);
  return result.stdout.trim();
}
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'io-addon-source-check-'));
let proof;
try{
  const files=sourceFiles(),before=manifest(files),product=productInfoSource();
  const generated=path.join(stage,'ProductInfo.java'),classes=path.join(stage,'classes'),dex=path.join(stage,'dex');
  fs.writeFileSync(generated,product);fs.mkdirSync(classes);fs.mkdirSync(dex);
  const sources=[...files.map(([,file])=>file),generated],argsFile=path.join(stage,'javac.args');
  fs.writeFileSync(argsFile,['-encoding','UTF-8','-source','8','-target','8','-cp',JSON.stringify(androidJar),'-d',JSON.stringify(classes),...sources.map(p=>JSON.stringify(p))].join('\n'));
  const java=run('javac',['-version']);
  run('javac',['-J-Dfile.encoding=UTF-8','@'+argsFile]);
  run('jar',['cf',path.join(stage,'addon.jar'),'-C',classes,'.']);
  run('java',['-Xmx2048m','-cp',path.join(sdk,'build-tools/36.0.0/lib/d8.jar'),'com.android.tools.r8.D8','--lib',androidJar,'--min-api','29','--output',dex,path.join(stage,'addon.jar')]);
  if(JSON.stringify(before)!==JSON.stringify(manifest(sourceFiles()))||product!==productInfoSource())throw Error('Addon sources changed during verification');
  proof={source_count:sources.length,source_manifest_sha256:sha(JSON.stringify(before)),product_source_sha256:sha(product),source_hash_unchanged:true,
    dex:fs.readdirSync(dex).sort().map(name=>({name,bytes:fs.statSync(path.join(dex,name)).size,sha256:sha(fs.readFileSync(path.join(dex,name)))})),
    java,temporary_output_removed:true,apk_built:false,device_used:false,shared_stage_modified:false};
}finally{fs.rmSync(stage,{recursive:true,force:true});}
console.log(JSON.stringify(proof));
