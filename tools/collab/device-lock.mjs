// Shared lock for the one phone, glasses and glasses-question bridge used by Claude and Codex.
// The file lives in the git common directory, so every worktree of this repository sees it.
// node tools/collab/device-lock.mjs status
// node tools/collab/device-lock.mjs acquire --owner claude --minutes 30 --purpose "dev46 摇头探测"
// node tools/collab/device-lock.mjs release --owner claude
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const OWNERS=['claude','codex'];
const file=path.join(path.resolve(execFileSync('git',['rev-parse','--git-common-dir'],{encoding:'utf8'}).trim()),'io-device-lock.json');
const [command,...rest]=process.argv.slice(2);
const arg=name=>{const i=rest.indexOf('--'+name);return i>=0?rest[i+1]:undefined;};
const read=()=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(missing){return null;}};
const live=lock=>lock&&Date.parse(lock.until)>Date.now();
const out=(value,code=0)=>{console.log(JSON.stringify(value));process.exit(code);};
const owner=arg('owner');
if(command==='status'){const lock=read();out(live(lock)?{state:'held',...lock}:{state:'free',expired:lock||undefined});}
if(!OWNERS.includes(owner))out({error:'DEVICE_LOCK_OWNER_INVALID',owners:OWNERS},2);
if(command==='acquire'){
 const minutes=Number(arg('minutes')??30),purpose=String(arg('purpose')??'').slice(0,200);
 if(!Number.isInteger(minutes)||minutes<1||minutes>240||!purpose)out({error:'DEVICE_LOCK_ARGUMENT_INVALID'},2);
 const lock=read();
 if(live(lock)&&lock.owner!==owner)out({error:'DEVICE_LOCK_HELD',...lock},1);
 const next={owner,purpose,since:live(lock)?lock.since:new Date().toISOString(),until:new Date(Date.now()+minutes*60000).toISOString()};
 const temp=file+'.'+process.pid;fs.writeFileSync(temp,JSON.stringify(next,null,1)+'\n');fs.renameSync(temp,file);
 out({state:'held',...next});
}
if(command==='release'){
 const lock=read();
 if(live(lock)&&lock.owner!==owner)out({error:'DEVICE_LOCK_HELD',...lock},1);
 fs.rmSync(file,{force:true});out({state:'free'});
}
out({error:'DEVICE_LOCK_COMMAND_INVALID',commands:['status','acquire','release']},2);
