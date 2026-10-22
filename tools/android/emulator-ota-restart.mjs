// Synthetic pending journal only, dedicated VM, stopped app, exact-byte cleanup. Never clears a real operation.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../rebuild/android-app'),privateDir=path.join(root,'.private'),ledger=path.join(privateDir,'ota-restart-fixture.json');
const runtime=JSON.parse(fs.readFileSync(path.join(privateDir,'emulator-runtime.json'),'utf8').replace(/^\uFEFF/,''));if(runtime.serial!=='emulator-5582')throw Error('Only dedicated VM allowed');
const target='/data/user/0/com.rayneo.venus.pub/files/io-fixed60-ota-v1.json';const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function adb(args,absent=false){const r=spawnSync(path.join(root,'.tools/sdk/platform-tools/adb.exe'),['-s','emulator-5582',...args],{encoding:'utf8',timeout:30000});if(r.error)throw r.error;if(absent&&r.status===1)return null;if(r.status!==0)throw Error('VM restart fixture operation failed');return r.stdout.trim();}
if(adb(['shell','id','-u'])!=='0'||adb(['shell','pidof','com.rayneo.venus.pub'],true)!==null)throw Error('Root dedicated VM and stopped product required');
const action=process.argv[2];
if(action==='install'){
 if(adb(['shell','test','-e',target],true)!==null)throw Error('Existing OTA history must never be replaced');
 if(fs.existsSync(ledger)&&JSON.parse(fs.readFileSync(ledger)).state!=='removed')throw Error('Existing fixture requires inspection');
 const id=crypto.randomUUID(),profile=JSON.parse(fs.readFileSync(path.join(root,'fixed60-profile.json'),'utf8'));
 const fixture={schema:1,candidate:profile.zip_sha256,operation:id,peer_sha256:sha(Buffer.from('synthetic-ota-restart-only')),pending:true,phase:'UNKNOWN',reason:'DEVICE_ERROR_8',first_failure:'DEVICE_ERROR_8',started_at_epoch_ms:Date.now()-180000,requests:3,confirmed_messages:10,confirmed_bytes:153600,covered_bytes:153600,ap_covered_bytes:0,install_notice:false,boot_readback:false};
 const bytes=Buffer.from(JSON.stringify(fixture)),local=path.join(privateDir,`ota-restart-synthetic-${id}.json`),record={schema:1,kind:'synthetic fixture only; no real OTA history',state:'intent',serial:'emulator-5582',target,local,operation:id,sha256:sha(bytes)};
 fs.writeFileSync(local,bytes,{flag:'wx'});fs.writeFileSync(ledger,JSON.stringify(record,null,2)+'\n');
 const owner=adb(['shell','stat','-c','%u:%g','/data/user/0/com.rayneo.venus.pub/files']);if(!/^\d{5}:\d{5}$/.test(owner))throw Error('Unexpected VM app owner');
 adb(['push',local,target]);adb(['shell','chown',owner,target]);adb(['shell','chmod','600',target]);if(adb(['shell','sha256sum',target]).split(' ')[0]!==record.sha256)throw Error('Fixture delivery differs');
 record.state='installed';fs.writeFileSync(ledger,JSON.stringify(record,null,2)+'\n');console.log('Synthetic pending metadata installed into the stopped dedicated VM; no firmware data or real operation.');
}else if(action==='remove'){
 const record=JSON.parse(fs.readFileSync(ledger));if(record.serial!=='emulator-5582'||record.target!==target||record.state!=='installed'||!/^ota-restart-synthetic-[a-f0-9-]{36}\.json$/.test(path.basename(record.local))||path.dirname(record.local)!==privateDir||fs.lstatSync(record.local).isSymbolicLink()||path.dirname(fs.realpathSync(record.local)).toLowerCase()!==fs.realpathSync(privateDir).toLowerCase())throw Error('Not the owned synthetic fixture');
 if(sha(fs.readFileSync(record.local))!==record.sha256||adb(['shell','sha256sum',target]).split(' ')[0]!==record.sha256)throw Error('Journal changed; never clear unknown state');
 adb(['shell','rm',target]);fs.unlinkSync(record.local);record.state='removed';record.app_did_not_change_synthetic_journal=true;record.removed_at=new Date().toISOString();fs.writeFileSync(ledger,JSON.stringify(record,null,2)+'\n');console.log('Only the exact synthetic pending metadata removed; actual operation history was absent and untouched.');
}else throw Error('Use install or remove');
