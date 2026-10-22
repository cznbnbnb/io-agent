import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

const clone=v=>JSON.parse(JSON.stringify(v));
const scopes=['tasks:read','tasks:write','tasks:update','requests:read','answers:write','messages:receive'];
function fixture(){
  const now=Date.now(),expires=now+3600000,calls=[];
  const target={baseUrl:'https://synthetic.invalid/io-api/v1',token:'a'.repeat(43),principal:{ownerId:'synthetic-owner',producerId:'phone',serverId:'server'}};
  const identity={schema_version:'1.0',owner_id:target.principal.ownerId,producer_id:'phone',server_id:'server',scopes,expires_at:new Date(expires).toISOString()};
  let handler=async()=>({responseCode:200,result:JSON.stringify(identity),header:{'Content-Type':'application/json'}}),destroyed=0;
  const {TaskTransport}=loadApp('TaskTransport',{'@kit.NetworkKit':{http:{RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:1},createHttp(){return{
    destroy(){destroyed++;},async request(url,options){calls.push({url,options});return handler(url,options);}
  };}}}});
  const client=new TaskTransport();client.setForeground(true);
  return {client,target,identity,expires,calls,setHandler:v=>handler=v,get destroyed(){return destroyed;}};
}

test('task registration preflight makes only one authenticated GET and no mailbox or command',async()=>{
  const f=fixture(),before=clone(f.target);const reply=await f.client.preflight(f.target,f.expires);
  assert.equal(reply.owner_id,f.identity.owner_id);assert.deepEqual(f.target,before);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,f.target.baseUrl+'/identity');assert.equal(f.calls[0].options.method,'GET');
  assert.equal(f.calls[0].options.extraData,undefined);assert.equal(f.calls[0].options.maxRedirects,0);assert.equal(f.destroyed,1);
});

test('every phone read/write permission is required and material or agent credentials cannot pass',async()=>{
  for(const scope of scopes){const f=fixture();f.identity.scopes=scopes.filter(s=>s!==scope);
    await assert.rejects(f.client.preflight(f.target),/TASK_(IDENTITY_MISMATCH|PHONE_SCOPE_REQUIRED)/);}
  const f=fixture();f.identity.scopes=['materials:read','materials:write'];await assert.rejects(f.client.preflight(f.target),/TASK_IDENTITY_MISMATCH/);
});

test('wrong authenticated identity, expired credential and mismatched file expiry are not accepted',async()=>{
  for(const key of ['owner_id','producer_id','server_id','schema_version']){const f=fixture();f.identity[key]='other';await assert.rejects(f.client.preflight(f.target),/TASK_IDENTITY_MISMATCH/);}
  const f=fixture();await assert.rejects(f.client.preflight(f.target,f.expires+1000),/TASK_EXPIRY_MISMATCH/);
  f.identity.expires_at=new Date(Date.now()-1).toISOString();await assert.rejects(f.client.preflight(f.target),/TASK_IDENTITY_MISMATCH/);
});

test('invalid target and expired candidate fail before touching the HTTP boundary',async()=>{
  for(const change of [t=>t.token='',t=>t.baseUrl='http://synthetic.invalid/v1',t=>t.baseUrl='https://synthetic.invalid/a/../v1']){
    const f=fixture();change(f.target);await assert.rejects(f.client.preflight(f.target),/TASK_TARGET_INVALID/);assert.equal(f.calls.length,0);}
  const f=fixture();await assert.rejects(f.client.preflight(f.target,Date.now()-1),/TASK_IMPORT_EXPIRED/);assert.equal(f.calls.length,0);
});

test('cancelled late identity cannot enable a candidate; concurrent previews are fenced',async()=>{
  const f=fixture();let release;f.setHandler(()=>new Promise(resolve=>{release=resolve;}));
  const check=f.client.preflight(f.target);await Promise.resolve();
  await assert.rejects(f.client.preflight(f.target),/TASK_PREFLIGHT_BUSY/);
  f.client.cancel();release({responseCode:200,result:JSON.stringify(f.identity),header:{'content-type':'application/json'}});
  await assert.rejects(check,/TASK_PREFLIGHT_CANCELLED/);assert.equal(f.client.note,'paused');
});

test('caller target mutation does not redirect a pending credential check',async()=>{
  const f=fixture();let release;f.setHandler(()=>new Promise(resolve=>{release=resolve;}));
  const expected=clone(f.target),check=f.client.preflight(f.target,f.expires);await Promise.resolve();f.target.baseUrl='https://other.invalid/v1';f.target.token='b'.repeat(43);
  release({responseCode:200,result:JSON.stringify(f.identity),header:{'content-type':'application/json'}});await check;
  assert.equal(f.calls[0].url,expected.baseUrl+'/identity');assert.equal(f.calls[0].options.header.Authorization,'Bearer '+expected.token);
});

test('HTTP, malformed and private platform failures expose bounded codes and do not follow redirects',async()=>{
  for(const status of [301,401,403,500]){const f=fixture();f.setHandler(async()=>({responseCode:status,result:'{}',header:{'content-type':'application/json'}}));
    await assert.rejects(f.client.preflight(f.target),e=>e.message==='TASK_IDENTITY_UNAVAILABLE');assert.equal(f.client.lastIdentityStatus,status);assert.equal(f.calls.length,1);}
  for(const result of ['broken',JSON.stringify({private:'synthetic-secret'})]){const f=fixture();f.setHandler(async()=>({responseCode:200,result,header:{'content-type':'application/json'}}));
    await assert.rejects(f.client.preflight(f.target),e=>/^TASK_IDENTITY_(UNAVAILABLE|MISMATCH)$/.test(e.message));}
  const f=fixture();f.setHandler(async()=>{throw Error('synthetic-private-bearer');});await assert.rejects(f.client.preflight(f.target),e=>e.message==='TASK_IDENTITY_UNAVAILABLE');
});
