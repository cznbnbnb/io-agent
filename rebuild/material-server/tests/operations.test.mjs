import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../store.mjs';
import {TrafficLedger} from '../traffic.mjs';
import {listen} from '../http.mjs';

const epoch=Date.parse('2026-10-12T02:15:00Z');
const fixture=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/normal.json',import.meta.url)));
const task=fixture.events.find(event=>event.kind==='task');
async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-operations-'));let now=epoch;
 const store=new MaterialStore(path.join(dir,'main.sqlite'),{clock:()=>now});
 const mint=(producer,scopes,owner='owner-a')=>store.mint({owner,producer,scopes});
 const phone=mint('phone-test',['tasks:write','tasks:read']);
 const agent=mint('pc-test',['tasks:read','tasks:update']);
 const admin=mint('admin-test',['operations:read']);
 const foreign=mint('other-admin',['operations:read'],'owner-b');
 const serverId=store.identity(admin.token).server_id;
 const traffic=new TrafficLedger(path.join(dir,'traffic.sqlite'),serverId,{clock:()=>now});
 const server=await listen(store,0,{traffic}),base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));traffic.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const post=(token,event)=>fetch(base+'/v1/tasks',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:typeof event==='string'?event:JSON.stringify(event)});
 const get=(token,route='/v1/operations/summary')=>fetch(base+route,{headers:token?{Authorization:`Bearer ${token}`}:{}});
 const event={...structuredClone(task),event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'phone-test',created_at:new Date(epoch).toISOString(),expires_at:new Date(epoch+3600000).toISOString()};
 return {dir,store,traffic,serverId,phone,agent,admin,foreign,event,post,get,base,setTime:value=>{now=value;}};
}

test('actual HTTP traffic counts UTF8 bytes and retries separately from immutable queue facts',async t=>{
 const f=await setup(t);f.event.body.command='PRIVATE 合成内容，不应出现在管理统计';
 const first=await f.post(f.phone.token,f.event),firstText=await first.text();assert.equal(first.status,201);
 const replay=await f.post(f.phone.token,f.event),replayText=await replay.text();assert.equal(replay.status,200);
 const queueBefore=f.store.queueCeiling('owner-a');
 const response=await f.get(f.admin.token);assert.equal(response.status,200);
 const text=await response.text(),summary=JSON.parse(text);
 assert.equal(summary.traffic.totals.requests,2);
 assert.equal(summary.traffic.totals.request_bytes,2*Buffer.byteLength(JSON.stringify(f.event)));
 assert.equal(summary.traffic.totals.response_bytes,Buffer.byteLength(firstText)+Buffer.byteLength(replayText));
 assert.deepEqual(summary.queue,[{kind:'task',state:'queued',count:1}]);
 assert.equal(summary.recent.length,1);assert.equal(summary.traffic.recent.length,2);
 assert.equal(f.store.queueCeiling('owner-a'),queueBefore);
 assert.equal(text.includes('PRIVATE'),false);assert.equal(text.includes(f.phone.token),false);
 await f.get(f.admin.token);assert.equal(f.traffic.snapshot('owner-a').totals.requests,2);
});

test('management is scoped read-only; anonymous and other owner traffic do not leak',async t=>{
 const f=await setup(t);
 assert.equal((await f.get()).status,401);
 assert.equal((await f.get(f.phone.token)).status,403);
 assert.equal((await f.post(f.admin.token,f.event)).status,403);
 await f.post(f.phone.token,f.event);
 const foreign=await(await f.get(f.foreign.token)).json();
 assert.deepEqual(foreign.queue,[]);assert.deepEqual(foreign.recent,[]);
 assert.equal(foreign.traffic.totals.requests,0);
 assert.equal((await f.get(f.admin.token,'/v1/operations/summary?token=secret')).status,400);
 assert.equal((await f.get(f.admin.token,'/v1/operations/summary?hours=0')).status,400);
 assert.equal((await f.get(f.admin.token,'/v1/operations/summary?hours=169')).status,400);
 f.store.revoke(f.admin.token_id);assert.equal((await f.get(f.admin.token)).status,401);
});

test('failed authenticated JSON is recorded without saving its body or raw URL',async t=>{
 const f=await setup(t);
 const response=await f.post(f.phone.token,'{"PRIVATE":');assert.equal(response.status,400);await response.text();
 const summary=await(await f.get(f.admin.token)).json();
 assert.equal(summary.traffic.totals.errors,1);assert.equal(summary.traffic.totals.request_bytes,11);
 assert.equal(summary.traffic.recent[0].route,'tasks');
 assert.equal(JSON.stringify(summary).includes('PRIVATE'),false);
});

test('traffic restart, foreign database binding and retention remain separate from user materials',async t=>{
 const f=await setup(t);await(await f.post(f.phone.token,f.event)).text();
 const reopened=new TrafficLedger(path.join(f.dir,'traffic.sqlite'),f.serverId,{clock:()=>epoch});
 assert.equal(reopened.snapshot('owner-a').totals.requests,1);reopened.close();
 assert.throws(()=>new TrafficLedger(path.join(f.dir,'traffic.sqlite'),'other-server'),/TRAFFIC_SERVER_MISMATCH/);
 f.setTime(epoch+31*86400000);f.traffic.prune();assert.equal(f.traffic.snapshot('owner-a').totals.requests,0);
 assert.equal(f.store.queueCeiling('owner-a'),1);
});

test('traffic write failure cannot turn an already committed business event into an upload failure',async t=>{
 const f=await setup(t);f.traffic.record=()=>{throw new Error('PRIVATE disk failure');};
 const response=await f.post(f.phone.token,f.event);assert.equal(response.status,201);await response.text();
 const summary=await(await f.get(f.admin.token)).json();assert.equal(summary.traffic.write_errors,1);
 assert.equal(summary.queue[0].count,1);assert.equal(JSON.stringify(summary).includes('PRIVATE'),false);
});

test('public management shell contains no data and restricts scripts, frames and caching',async t=>{
 const f=await setup(t),response=await fetch(f.base+'/v1/admin');
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.match(await response.text(),/管理后台/);
 const script=await(await fetch(f.base+'/v1/admin/app.js')).text();
 assert.equal(/innerHTML|localStorage|sessionStorage/.test(script),false);
 const consoleScript=await(await fetch(f.base+'/v1/admin/console.js')).text();assert.equal(/innerHTML|sessionStorage/.test(consoleScript),false);
 assert.deepEqual([...consoleScript.matchAll(/localStorage\.(getItem|setItem)\(([^,)]+)/g)].map(m=>m[2]),["'io-admin-daily-view'","'io-admin-daily-view'"]);
 assert.equal((await fetch(f.base+'/v1/admin?token=secret')).status,400);
});

test('actual serve CLI keeps business available when a foreign traffic ledger cannot be opened',{timeout:20000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-operations-cli-')),dbFile=path.join(dir,'main.sqlite');
 const main=new MaterialStore(dbFile),admin=main.mint({owner:'owner-a',producer:'admin-test',scopes:['operations:read']});main.close();
 const ledgerFile=dbFile+'.traffic.sqlite';
 const foreign=new TrafficLedger(ledgerFile,'another-server');foreign.close();
 const reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
 const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../cli.mjs',import.meta.url)),
  'serve','--db',dbFile,'--port',String(port)],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}fs.rmSync(dir,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('CLI_START_TIMEOUT')),10000);
  const done=()=>{if(stdout.includes('"listen":"127.0.0.1"')){clearTimeout(timer);resolve();}};
  child.stdout.on('data',done);child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',()=>{clearTimeout(timer);reject(new Error('CLI_EXIT_BEFORE_READY'));});done();
 });
 const base=`http://127.0.0.1:${port}`,headers={Authorization:`Bearer ${admin.token}`};
 const identity=await fetch(base+'/v1/identity',{headers});assert.equal(identity.status,200);await identity.text();
 const summary=await(await fetch(base+'/v1/operations/summary',{headers})).json();
 assert.equal(summary.traffic.available,false);assert.equal(summary.traffic.initialization_failed,true);
 assert.match(stderr,/TRAFFIC_UNAVAILABLE/);assert.equal((stdout+stderr).includes(admin.token),false);
 const preserved=new TrafficLedger(ledgerFile,'another-server');preserved.close();
});
