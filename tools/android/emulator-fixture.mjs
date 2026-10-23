// Test environment only. Never changes the APK's TLS policy or a physical device.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {exe} from './host-tools.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../rebuild/android-app');
const runtime=JSON.parse(fs.readFileSync(path.join(root,'.private/emulator-runtime.json'),'utf8').replace(/^\uFEFF/,''));
if(runtime.serial!=='emulator-5582'||runtime.api!==36)throw new Error('This fixture only supports the project Android16 emulator');
const adb=path.join(root,'.tools/sdk/platform-tools',exe('adb')),env={...process.env,ANDROID_USER_HOME:path.join(root,'.private/android-user')};
function run(args){const r=spawnSync(adb,['-s',runtime.serial,...args],{env,encoding:'utf8',timeout:30000,maxBuffer:1024**2});if(r.error)throw r.error;if(r.status!==0)throw new Error('Emulator fixture ADB step failed: '+args.slice(0,2).join(' '));return r.stdout.trim();}
const certFile=path.join(root,'.private/fixture-tls/server.pem'),pem=fs.readFileSync(certFile),cert=new crypto.X509Certificate(pem);
if(!cert.ca||cert.checkIP('127.0.0.1')!=='127.0.0.1'||cert.subject!==cert.issuer||Date.parse(cert.validFrom)>Date.now()||Date.parse(cert.validTo)<=Date.now())throw new Error('Only the current short-lived local fixture CA is allowed');
const metadata=JSON.parse(fs.readFileSync(path.join(root,'.private/fixture-tls/metadata.json'),'utf8').replace(/^\uFEFF/,'')),hash=metadata.subject_hash_old;
if(!/^[a-f0-9]{8}$/.test(hash))throw new Error('Invalid fixture certificate hash');
const stateFile=path.join(root,'.private/emulator-fixture-trust.json'),dir='/data/local/tmp/io-agent-test-ca-01a15382',target='/apex/com.android.conscrypt/cacerts';
const action=process.argv[2]??'status';
function state(){return fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;}
function save(value){fs.writeFileSync(stateFile,JSON.stringify(value,null,2)+'\n');}
function assertRoot(){run(['root']);run(['wait-for-device']);if(!run(['shell','id']).startsWith('uid=0(root)'))throw new Error('The dedicated emulator must permit ADB root');}
function mounted(pid){return run(['shell','nsenter','-t',String(pid),'-m','--','cat','/proc/self/mountinfo']).split('\n').some(line=>{const fields=line.split(' ');return fields[4]===target&&fields[3].endsWith('/'+path.posix.basename(dir));});}
if(action==='setup'){
 assertRoot();const prior=state();if(prior?.active)throw new Error('Fixture trust is already active; inspect status before reusing it');
 const zygote=run(['shell','pidof','zygote64']);if(!/^\d+$/.test(zygote))throw new Error('Expected one Android16 zygote64');
 if(run(['shell','test','!','-e',dir])!=='')throw new Error('Unexpected fixture directory response');
 // Fixed, task-owned guest path. No existing directory may be adopted or overwritten.
 run(['shell','mkdir',dir]);run(['shell','sh','-c',`'set -e; cp -p ${target}/* ${dir}/'`]);
 run(['push',certFile,dir+'/'+hash+'.0']);
 run(['shell','sh','-c',`'set -e; chown -R 0:0 ${dir}; chmod 755 ${dir}; chmod 644 ${dir}/*; chcon -R u:object_r:system_security_cacerts_file:s0 ${dir}'`]);
 const value={schema:1,serial:runtime.serial,active:false,dir,target,zygote:Number(zygote),certificate_sha256:cert.fingerprint256,apk_changed:false,physical_device:false,at:new Date().toISOString()};save(value);
 // Zygote children get the additional test root; existing roots remain present.
 run(['shell','nsenter','-t',zygote,'-m','--','mount','--bind',dir,target]);value.active=true;save(value);
 if(!mounted(zygote))throw new Error('Fixture CA mount was not observed in zygote namespace');
 run(['reverse','tcp:443','tcp:443']);console.log('Dedicated emulator trusts the local synthetic test CA; normal APK TLS validation remains enabled.');
}else if(action==='deliver'){
 const active=state();if(!active?.active||!mounted(active.zygote))throw new Error('Fixture trust not active');
 const source=path.join(root,'.private/https-fixture/task-connection.json'),bytes=fs.readFileSync(source),connection=JSON.parse(bytes);
 if(bytes.length>8192||connection.format!=='turboio-task-connection/1'||connection.base_url!=='https://127.0.0.1/v1'||connection.owner_id!=='android-local-e2e'||connection.producer_id!=='android-simulator'||Date.parse(connection.expires_at)<=Date.now())throw new Error('Only unexpired synthetic local fixture credentials may be delivered');
 const remote='/sdcard/Android/data/com.rayneo.venus.pub/files/connection-import';run(['shell','mkdir','-p',remote]);run(['push',source,remote+'/task-connection.json']);console.log('Synthetic registration delivered to the emulator app import directory; token not printed.');
}else if(action==='status'){
 const active=state();console.log(JSON.stringify({active:!!active?.active,mount_observed:active?.active?mounted(active.zygote):false,physical_device:false}));
}else if(action==='remove'){
 const active=state();if(!active?.active)throw new Error('No active fixture trust record');assertRoot();
 // Stop only our test app before removing its inherited test mount.
 run(['shell','am','force-stop','com.rayneo.venus.pub']);
 if(!mounted(active.zygote))throw new Error('Expected owned mount missing; inspect before cleanup');
 run(['shell','nsenter','-t',String(active.zygote),'-m','--','umount',target]);active.active=false;active.removed_at=new Date().toISOString();save(active);
 if(run(['reverse','--list']).split('\n').some(line=>line.trim().endsWith('tcp:443 tcp:443')))run(['reverse','--remove','tcp:443']);
 run(['shell','rm','-r',dir]);active.fixture_directory_removed=true;save(active);console.log('Synthetic CA unmounted, its owned guest directory removed, and test reverse removed.');
}else throw new Error('Unknown emulator fixture action');
