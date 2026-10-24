// One-time enrollment of this computer as a paired device of the user's account (2026-10-24, user:
// pair once instead of importing a connection file per session). Runs the server's local admin
// `cli.mjs enroll` over the operator's SSH key; the credential travels only through captured stdout
// into ~/.turboio/agent-device.json (0600) and is never printed. Afterwards:
//   node rebuild/agent-bridge/device.mjs pair-phone "我的手机"   (one-time phone code)
//   echo '{"topic":"…"}' | node rebuild/agent-bridge/questions/cli.mjs join   (per agent session)
// node tools/collab/enroll-computer.mjs --computer-id io-mac-computer --label "Mac mini"
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {deviceFile} from '../../rebuild/agent-bridge/questions/cli.mjs';
const HOST='ubuntu@43.142.59.131',BASE='https://cznbnb.cn/io-api/v1/',OWNER='turboio-user';
const args=process.argv.slice(2),arg=name=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:undefined;};
const out=(value,code=0)=>{console.log(JSON.stringify(value));process.exit(code);};
const computerId=arg('computer-id')??'io-mac-computer',label=arg('label')??computerId,file=deviceFile();
if(!/^[A-Za-z0-9_.-]{1,128}$/.test(computerId)||!label||label.length>64||label.trim()!==label)out({error:'ENROLL_ARGUMENT_INVALID'},2);
if(fs.existsSync(file))out({error:'DEVICE_ALREADY_ENROLLED',device_file:file,hint:'先用 device.mjs devices / unpair 处理旧设备，再删除该文件'},1);
const run=randomUUID(),script=`import json,pathlib,subprocess,sys
p=json.loads(${JSON.stringify(JSON.stringify({run,owner:OWNER,label}))})
root=pathlib.Path('/var/lib/turboio-material/devices');root.mkdir(mode=0o700,exist_ok=True)
target=root/(p['run']+'.json')
r=subprocess.run(['/opt/turboio/node22/bin/node','/opt/turboio/rebuild/material-server/cli.mjs','enroll','--db','/var/lib/turboio-material/materials.sqlite','--owner',p['owner'],'--role','agent','--label',p['label'],'--out',str(target)],stdin=subprocess.DEVNULL,capture_output=True,timeout=20)
if r.returncode: print(json.dumps({'error':'ENROLL_COMMAND_FAILED'})); sys.exit(1)
try: sys.stdout.write(target.read_text())
finally: target.unlink()
`;
const remote=spawnSync('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15',HOST,'sudo -n /usr/bin/python3 -'],{input:script,encoding:'utf8',timeout:60000,maxBuffer:65536});
let credential;try{credential=JSON.parse(remote.stdout);}catch{out({error:'ENROLL_REMOTE_UNREADABLE',status:remote.status},1);}
if(remote.status!==0||credential.error||!/^[A-Za-z0-9_-]{43}$/.test(credential.token??'')||credential.role!=='agent')out({error:credential.error??'ENROLL_REMOTE_FAILED'},1);
fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.chmodSync(path.dirname(file),0o700);
const fd=fs.openSync(file,'wx',0o600);
try{fs.writeFileSync(fd,JSON.stringify({...credential,base_url:BASE,computer_id:computerId})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
out({enrolled:true,device_file:file,device_id:credential.device_id,producer_id:credential.producer_id,computer_id:computerId,expires_at:credential.expires_at});
