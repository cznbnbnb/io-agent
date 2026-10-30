import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../store.mjs';
import {listen} from '../http.mjs';
const initial='synthetic-initial-password',next='synthetic-personal-password',origin='https://cznbnb.cn';
async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-admin-auth-')),file=path.join(dir,'main.sqlite');let now=Date.now();
 const store=new MaterialStore(file,{clock:()=>now});
 const grant=store.mint({owner:'caller601-admin-codex',producer:'qa',scopes:['operations:read']});
 await store.admin.enroll({username:'Test.Admin',owner:'caller601-admin-codex',password:initial});
 const server=await listen(store,0),base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const request=(route,{input,cookie,requestOrigin=origin}={})=>fetch(base+'/v1/admin/'+route,{method:input===undefined?'GET':'POST',headers:{...(input===undefined?{}:{'Content-Type':'application/json',...(requestOrigin?{Origin:requestOrigin}:{})}),...(cookie?{Cookie:cookie}:{})},body:input===undefined?undefined:JSON.stringify(input)});
 const login=async()=>{const r=await request('login',{input:{username:'test.admin',password:initial}});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],profile:await r.json(),header:r.headers.get('set-cookie')};};
 return {store,dir,file,base,grant,request,login,advance:ms=>{now+=ms;}};
}
test('browser login, mandatory password change, rotation, logout and API boundary',async t=>{
 const f=await setup(t),first=await f.login();
 assert.deepEqual(Object.keys(first.profile).sort(),['expires_at','must_change_password','username']);assert.equal(first.profile.must_change_password,true);
 assert.match(first.header,/HttpOnly; Secure; SameSite=Strict; Max-Age=604800/);assert.match(first.header,/Path=\/io-api\/v1\/admin/);
 assert.equal((await f.request('summary',{cookie:first.cookie})).status,403);
 const second=await f.login();
 assert.equal((await f.request('password',{cookie:first.cookie,input:{current_password:'wrong',new_password:next}})).status,401);
 assert.equal((await f.request('password',{cookie:first.cookie,input:{current_password:initial,new_password:'short'}})).status,400);
 const changed=await f.request('password',{cookie:first.cookie,input:{current_password:initial,new_password:next}});assert.equal(changed.status,200);
 const cookie=changed.headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,first.cookie);assert.equal((await changed.json()).must_change_password,false);
 for(const old of [first.cookie,second.cookie])assert.equal((await f.request('session',{cookie:old})).status,401);
 assert.equal((await f.request('summary',{cookie})).status,200);
 assert.equal((await fetch(f.base+'/v1/operations/summary',{headers:{Cookie:cookie}})).status,401);
 assert.equal((await fetch(f.base+'/v1/operations/summary',{headers:{Authorization:`Bearer ${f.grant.token}`}})).status,200);
 assert.equal((await fetch(f.base+'/v1/tasks',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).status,401);
 assert.equal((await f.request('login',{input:{username:'test.admin',password:initial}})).status,401);
 assert.equal((await f.request('login',{input:{username:'test.admin',password:next}})).status,200);
 const logout=await f.request('logout',{cookie,input:{}});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal((await f.request('session',{cookie})).status,401);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM credentials').get().n,1);
});
test('password and cookie storage, restart persistence, expiry and host reset',async t=>{
 const f=await setup(t),first=await f.login();
 const user=f.store.db.prepare('SELECT * FROM admin_users').get(),sessions=f.store.db.prepare('SELECT * FROM admin_sessions').all();
 assert.equal(JSON.stringify(user).includes(initial),false);assert.equal(JSON.stringify(sessions).includes(first.cookie.split('=')[1]),false);
 const reopened=new MaterialStore(f.file,{clock:f.store.clock});assert.equal(reopened.admin.session(first.cookie.split('=')[1]).username,'test.admin');reopened.close();
 f.advance(7*86400000);assert.equal((await f.request('session',{cookie:first.cookie})).status,401);
 const another=await f.login();await f.store.admin.enroll({username:'test.admin',password:next},true);
 assert.equal((await f.request('session',{cookie:another.cookie})).status,401);
 const r=await f.request('login',{input:{username:'test.admin',password:next}});assert.equal((await r.json()).must_change_password,true);
});
test('cross-site and malformed writes cannot create or alter a browser identity',async t=>{
 const f=await setup(t),input={username:'test.admin',password:initial};
 for(const requestOrigin of ['', 'https://evil.invalid'])for(const route of ['login','logout','password'])assert.equal((await f.request(route,{input,requestOrigin})).status,403);
 assert.equal((await f.request('login',{input:{...input,owner:'foreign'}})).status,400);
 assert.equal((await f.request('register',{input})).status,404);
 assert.equal((await f.request('login')).status,404);
 assert.equal((await f.request('session?token=secret')).status,400);
 const first=await f.login();assert.equal((await f.request('session',{cookie:first.cookie+'; '+first.cookie})).status,401);
 await assert.rejects(f.store.admin.enroll({username:'foreign',owner:'unknown',password:initial}),/ADMIN_OWNER_REQUIRED/);
 await assert.rejects(f.store.admin.enroll({username:'test.admin',owner:'caller601-admin-codex',password:initial}),/ADMIN_ACCOUNT_EXISTS/);
});
test('wrong and unknown passwords have the same response; repeated failures are bounded across restart',async t=>{
 const f=await setup(t);
 for(const name of ['test.admin','unknown']){const r=await f.request('login',{input:{username:name,password:'wrong'}});assert.equal(r.status,401);assert.equal((await r.json()).error.code,'ADMIN_LOGIN_FAILED');}
 for(let i=0;i<9;i++)assert.equal((await f.request('login',{input:{username:'test.admin',password:'wrong'}})).status,401);
 const reopened=new MaterialStore(f.file,{clock:f.store.clock});await assert.rejects(reopened.admin.login({username:'test.admin',password:initial}),/ADMIN_LOGIN_LIMITED/);reopened.close();
 f.advance(15*60000);await f.login();
});
test('browser summary uses the enrolled owner and exposes no credentials or task text',async t=>{
 const f=await setup(t);
 f.store.mint({owner:'foreign-owner',producer:'foreign',scopes:['operations:read']});
 await f.store.admin.enroll({username:'other.admin',owner:'foreign-owner',password:initial});
 // Owner routing is checked at the actual HTTP boundary without manufacturing queue contracts.
 const observed=[];f.store.operationsForOwner=owner=>{observed.push(owner);return {owner_marker:owner};};
 for(const name of ['test.admin','other.admin']){
  const login=await f.request('login',{input:{username:name,password:initial}}),cookie=login.headers.get('set-cookie').split(';')[0];
  const change=await f.request('password',{cookie,input:{current_password:initial,new_password:next}}),nextCookie=change.headers.get('set-cookie').split(';')[0];
  const response=await f.request('summary',{cookie:nextCookie});assert.equal(response.status,200);const text=await response.text();assert.equal(text.includes(initial),false);assert.equal(text.includes(f.grant.token),false);
 }
 assert.deepEqual(observed,['caller601-admin-codex','foreign-owner']);
});
test('host CLI takes a private password file and never prints it',async t=>{
 const f=await setup(t),secret=path.join(f.dir,'password');fs.writeFileSync(secret,initial,{mode:0o600});
 const argv=[fileURLToPath(new URL('../cli.mjs',import.meta.url)),'admin-create','--db',f.file,'--username','cli.admin','--owner','caller601-admin-codex','--password-file',secret];
 const r=spawnSync(process.execPath,argv,{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal((r.stdout+r.stderr).includes(initial),false);assert.equal(JSON.parse(r.stdout).must_change_password,true);
 fs.chmodSync(secret,0o644);assert.equal(spawnSync(process.execPath,[...argv.slice(0,5),'new.admin',...argv.slice(6)],{encoding:'utf8'}).status,1);
});
