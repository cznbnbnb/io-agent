// Local synthetic fixture only. Never reads production credentials or databases.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MaterialStore} from '../../rebuild/material-server/store.mjs';
import {TrafficLedger} from '../../rebuild/material-server/traffic.mjs';
import {listen} from '../../rebuild/material-server/http.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-admin-preview-'));
const store=new MaterialStore(path.join(dir,'materials.sqlite'));
const mint=(producer,scopes)=>store.mint({owner:'synthetic-preview',producer,scopes});
const phone=mint('synthetic-phone',['tasks:write','tasks:read']);
const pc=mint('synthetic-pc',['tasks:read']);
const admin=mint('synthetic-admin',['operations:read']);
const traffic=new TrafficLedger(path.join(dir,'traffic.sqlite'),store.identity(admin.token).server_id);
const server=await listen(store,0,{traffic});
const base=`http://127.0.0.1:${server.address().port}`;
const sample=JSON.parse(fs.readFileSync(new URL('../../docs/contracts/normal.json',import.meta.url))).events.find(event=>event.kind==='task');
const event={...sample,event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'synthetic-phone',
 created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()};
for(let i=0;i<2;i++){
 const response=await fetch(base+'/v1/tasks',{method:'POST',headers:{Authorization:`Bearer ${phone.token}`,'Content-Type':'application/json'},body:JSON.stringify(event)});
 if(response.status!==(i===0?201:200))throw new Error('PREVIEW_SEED_FAILED');await response.text();
}
await(await fetch(base+'/v1/inbox',{headers:{Authorization:`Bearer ${pc.token}`}})).text();
// Synthetic short-lived token is kept in a private temp file, never printed.
fs.writeFileSync(path.join(dir,'admin.json'),JSON.stringify({url:base+'/v1/admin',...admin}),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({url:base+'/v1/admin',synthetic:true,credential_file:path.join(dir,'admin.json')}));
async function close(){await new Promise(resolve=>server.close(resolve));traffic.close();store.close();fs.rmSync(dir,{recursive:true,force:true});process.exit(0);}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
