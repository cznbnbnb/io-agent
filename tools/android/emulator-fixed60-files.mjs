// Only this task's Android16 VM. Temporary picker inputs; no app-private data or device commands.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {exe} from './host-tools.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../rebuild/android-app'),privateDir=path.join(root,'.private'),ledger=path.join(privateDir,'fixed60-ui-delivery.json');
const runtime=JSON.parse(fs.readFileSync(path.join(privateDir,'emulator-runtime.json'),'utf8').replace(/^\uFEFF/,''));if(runtime.serial!=='emulator-5582')throw Error('Only Android16 emulator allowed');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function adb(args,absent=false){const r=spawnSync(path.join(root,'.tools/sdk/platform-tools',exe('adb')),['-s','emulator-5582',...args],{encoding:'utf8',timeout:30000,maxBuffer:1024**2});if(r.error)throw r.error;if(absent&&r.status===1)return null;if(r.status!==0)throw Error('VM fixture file operation failed');return r.stdout.trim();}
function save(r){fs.writeFileSync(ledger,JSON.stringify(r,null,2)+'\n');}
const action=process.argv[2];
if(action==='deliver'){
 if(fs.existsSync(ledger)&&JSON.parse(fs.readFileSync(ledger)).state!=='cleaned')throw Error('Existing owned delivery must be inspected first');
 const id=crypto.randomUUID(),candidate=path.resolve(root,'../phase1/device-private/stock-firmware-1.0.5.5/suggestion60-candidate/StrixOS-1.0.5.5-SUGGEST60-OFFLINE-01-UNFLASHED.zip');
 const profile=JSON.parse(fs.readFileSync(path.join(root,'fixed60-profile.json'),'utf8')),bad=path.join(privateDir,`fixed60-invalid-${id}.zip`),badBytes=Buffer.from('synthetic invalid firmware input\n');
 if(sha(fs.readFileSync(candidate))!==profile.zip_sha256)throw Error('Reviewed candidate changed');
 const files=[{kind:'candidate',local:candidate,remote:`/sdcard/Download/io-fw-${id}-candidate.zip`,sha256:profile.zip_sha256},{kind:'invalid',local:bad,remote:`/sdcard/Download/io-fw-${id}-invalid.zip`,sha256:sha(badBytes)}];
 for(const file of files)if(adb(['shell','test','-e',file.remote],true)!==null)throw Error('Fixture target already exists');
 const record={schema:1,at:new Date().toISOString(),state:'intent',serial:'emulator-5582',files};save(record);fs.writeFileSync(bad,badBytes,{flag:'wx'});
 for(const file of files){adb(['push',file.local,file.remote]);if(adb(['shell','sha256sum',file.remote]).split(' ')[0]!==file.sha256)throw Error('Delivered bytes differ');}
 record.state='delivered';save(record);console.log(JSON.stringify({serial:record.serial,files:files.map(f=>path.posix.basename(f.remote)),firmware_sent_to_glasses:false}));
}else if(action==='cleanup'){
 const record=JSON.parse(fs.readFileSync(ledger,'utf8'));if(record.serial!=='emulator-5582'||!['delivered','intent'].includes(record.state)||record.files.length!==2)throw Error('No owned delivery');
 for(const file of record.files){
  if(!/^\/sdcard\/Download\/io-fw-[a-f0-9-]{36}-(candidate|invalid)\.zip$/.test(file.remote))throw Error('Unexpected VM cleanup path');
  const exists=adb(['shell','test','-e',file.remote],true)!==null;if(exists){if(adb(['shell','sha256sum',file.remote]).split(' ')[0]!==file.sha256)throw Error('VM fixture bytes changed; not removed');adb(['shell','rm',file.remote]);}
  if(file.kind==='invalid'&&fs.existsSync(file.local)){if(path.dirname(file.local)!==privateDir||!/^fixed60-invalid-[a-f0-9-]{36}\.zip$/.test(path.basename(file.local))||fs.lstatSync(file.local).isSymbolicLink()||path.dirname(fs.realpathSync(file.local)).toLowerCase()!==fs.realpathSync(privateDir).toLowerCase()||sha(fs.readFileSync(file.local))!==file.sha256)throw Error('Local fixture cleanup scope changed');fs.unlinkSync(file.local);}
 }
 record.state='cleaned';record.cleaned_at=new Date().toISOString();save(record);console.log('Two owned VM picker inputs and the local synthetic invalid file removed; original research ZIP retained.');
}else throw Error('Use deliver or cleanup');
