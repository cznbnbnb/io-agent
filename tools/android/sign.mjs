import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {PRODUCT,OFFICIAL_SOURCE_ROUTING} from './profile.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../rebuild/android-app');
const build=path.join(root,'build'),privateDir=path.join(root,'.private/signing'),sdk=path.join(root,'.tools/sdk/build-tools/36.0.0');
const source=path.join(build,PRODUCT.apk_stem+'-unsigned.apk'),aligned=path.join(build,'aligned.apk');
const dest=path.join(root,'artifacts',PRODUCT.apk_stem+'.apk');
const key=path.join(privateDir,'io-agent.jks'),passFile=path.join(privateDir,'keystore-pass.txt');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(!fs.existsSync(source))throw new Error('Build the audited APK first');
if(fs.existsSync(path.join(build,'build.lock')))throw new Error('Build still owns the workspace');
if(fs.existsSync(dest)&&!(process.argv.includes('--resume')&&!fs.existsSync(path.join(root,'candidate.json'))))throw new Error('Signed candidate already exists; inspect retention before replacing');
fs.mkdirSync(privateDir,{recursive:true});fs.mkdirSync(path.dirname(dest),{recursive:true});
if(fs.existsSync(key)&&!fs.existsSync(passFile))throw new Error('Signing password missing; do not replace the persistent key');
if(!fs.existsSync(key)&&fs.existsSync(passFile))throw new Error('Partial key generation; inspect before retrying');
if(!fs.existsSync(passFile))fs.writeFileSync(passFile,crypto.randomBytes(32).toString('base64url'),{flag:'wx',mode:0o600});
const env={...process.env,IO_AGENT_SIGN_PASS:fs.readFileSync(passFile,'utf8')};
function run(command,args,capture=false){const r=spawnSync(command,args,{env,encoding:'utf8',stdio:capture?'pipe':'inherit'});if(r.error)throw r.error;if(r.status!==0)throw new Error(command+' failed: '+r.status);return r.stdout;}
if(!fs.existsSync(key))run('keytool',['-genkeypair','-alias','io-agent','-keystore',key,'-storepass:env','IO_AGENT_SIGN_PASS','-keypass:env','IO_AGENT_SIGN_PASS','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=iO Agent Android, OU=Development, O=iO Agent, C=CN','-storetype','JKS','-noprompt']);
run('python',['-S','-X','utf8',path.join(root,'assemble.py'),'--add-notices',source]);
run(path.join(sdk,'zipalign.exe'),['-P','16','-f','4',source,aligned]);
const signer=path.join(sdk,'lib/apksigner.jar');
run('java',['-jar',signer,'sign','--ks',key,'--ks-key-alias','io-agent','--ks-pass','env:IO_AGENT_SIGN_PASS','--key-pass','env:IO_AGENT_SIGN_PASS','--v1-signing-enabled','false','--v2-signing-enabled','true','--v3-signing-enabled','true','--v4-signing-enabled','false','--out',dest,aligned]);
const verification=run('java',['-Duser.language=en','-Duser.country=US','-jar',signer,'verify','--min-sdk-version','24','--verbose','--print-certs',dest],true);
if(!/Verified using v2 scheme.*true/.test(verification)||!/Verified using v3 scheme.*true/.test(verification))throw new Error('Required APK signatures missing');
fs.writeFileSync(path.join(build,'signature-verification.txt'),verification);
run(path.join(sdk,'zipalign.exe'),['-c','-P','16','4',dest]);
const audit=JSON.parse(run('python',['-S','-X','utf8',path.join(root,'assemble.py'),path.join(root,'.private/hosts/RayNeo-1.0.7-230-original.apk'),path.join(build,'classes2-hooked.dex'),path.join(build,'dex/classes.dex'),dest,'--audit'],true));
const privateAudit=JSON.parse(run('python',['-S','-X','utf8',path.resolve(root,'../../tools/android/audit-private.py'),dest],true));
const dexAudit=JSON.parse(run('python',['-S','-X','utf8',path.resolve(root,'../../tools/android/audit-dex.py'),dest],true));
const sourceRecord=JSON.parse(fs.readFileSync(path.join(build,'compile-status.json'),'utf8'));
if(sourceRecord.product_sha256!==hash(path.join(root,'product.json'))||sourceRecord.addon_sha256!==hash(path.join(build,'dex/classes.dex'))||sourceRecord.host_dex_sha256!==hash(path.join(build,'classes2-hooked.dex')))throw new Error('Compile provenance mismatch');
if((sourceRecord.native_route_policy_sha256??null)!==(OFFICIAL_SOURCE_ROUTING?hash(path.join(root,"native_route107.py")):null))throw new Error("Native source-routing policy changed after compilation");
for(const item of sourceRecord.sources)if(hash(path.join(root,item.path))!==item.sha256)throw new Error('Source changed after compilation');
fs.writeFileSync(path.join(root,'candidate-source.json'),JSON.stringify(sourceRecord,null,2)+'\n');
fs.writeFileSync(path.join(root,'private-audit.json'),JSON.stringify(privateAudit,null,2)+'\n');
const certificate=verification.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1];
if(!certificate)throw new Error('Certificate digest unavailable');
const metadata={schema:1,product:PRODUCT.name,version:PRODUCT.version,version_code:PRODUCT.version_code,revision:PRODUCT.revision,host_version:'1.0.7',host_code:230,signed:new Date().toISOString(),apk:path.relative(root,dest),bytes:fs.statSync(dest).size,sha256:hash(dest),signer_sha256:certificate,signature_v2:true,signature_v3:true,native_library_zip_page_alignment:16384,general_zip_alignment:4,audit,dex_audit:dexAudit,installed:false,phone_disconnected_by_user:true,one_minute_card_passed:false,release_gate_passed:false};
const previous=path.join(root,'candidate.json');if(fs.existsSync(previous)){
 const old=JSON.parse(fs.readFileSync(previous)),rollbackFile=path.join(root,'rollback-candidate.json'),rollback=fs.existsSync(rollbackFile)?JSON.parse(fs.readFileSync(rollbackFile,'utf8')):null;
 if(old.apk!==metadata.apk){
  // While the phone is unplugged, preserve its last actually installed APK.
  // A newer emulator-only candidate must not silently displace that rollback.
  if(rollback?.installed&&(!old.installed||old.retention_eligible_rollback===false)){fs.writeFileSync(path.join(root,'superseded-candidate.json'),JSON.stringify(old,null,2)+'\n');}
  else fs.writeFileSync(rollbackFile,JSON.stringify(old,null,2)+'\n');
 }
}
fs.writeFileSync(path.join(root,'candidate.json'),JSON.stringify(metadata,null,2)+'\n');
// Only remove our two known intermediate APKs after the signed package passes.
for(const file of [source,aligned]){if(path.dirname(file)!==build)throw new Error('Cleanup scope mismatch');fs.unlinkSync(file);}
console.log(JSON.stringify(metadata,null,2));
