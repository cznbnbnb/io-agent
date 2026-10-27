import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {discoverCodexEndpoint,trustedCodexUnixEndpoint,DESKTOP_SHARED_DAEMON_ADVICE} from '../hosts/codex-endpoint.mjs';

async function fixture(t){
  // macOS sun_path is bounded; os.tmpdir() includes a long per-user folder.
  const directory=fs.realpathSync(fs.mkdtempSync('/tmp/ce-'));
  fs.chmodSync(directory,0o700);
  const home=path.join(directory,'home'),control=path.join(home,'app-server-control'),workspace=path.join(directory,'work');
  for(const p of [home,control,workspace])fs.mkdirSync(p,{mode:0o700});
  const socket=path.join(control,'app-server-control.sock'),server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});
  let accepts=0;server.on('connection',()=>accepts++);
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
  const conversationId=randomUUID(),calls=[];
  const f={directory,home,control,workspace,socket,server,conversationId,calls,accepts:()=>accepts,
    async probe(input){calls.push(input);return{loaded:true,thread:{id:conversationId,cwd:workspace,canAcceptDirectInput:true,parentThreadId:null}};}};
  f.options=()=>({conversationId,workspace,codexHome:home,probe:f.probe});return f;
}

test('default shared-daemon discovery verifies real socket, exact loaded thread, and /rpc without connecting itself',async t=>{
  const f=await fixture(t),result=await discoverCodexEndpoint(f.options());
  assert.deepEqual(result,{endpoint:'unix://'+f.socket,rpcPath:'/rpc',mode:'shared-daemon'});
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].conversationId,f.conversationId);assert.equal(f.calls[0].workspace,f.workspace);
  assert.equal(f.accepts(),0);assert(Object.isFrozen(result));
});
test('explicit already-running Unix endpoint and default alias preserve their transport paths',async t=>{
  const f=await fixture(t);
  assert.equal((await discoverCodexEndpoint({...f.options(),endpoint:'unix://'+f.socket})).rpcPath,'/');
  assert.equal((await discoverCodexEndpoint({...f.options(),endpoint:'unix://'+f.socket,rpcPath:'/rpc'})).rpcPath,'/rpc');
  assert.equal((await discoverCodexEndpoint({...f.options(),endpoint:'unix://'})).mode,'shared-daemon');
});
test('an explicit native owner can supply its actual workspace rather than the CLI installation folder',async t=>{
  const f=await fixture(t),result=await discoverCodexEndpoint({...f.options(),workspace:undefined,endpoint:'unix://'+f.socket});
  assert.equal(result.workspace,f.workspace);assert.equal(f.calls.length,1);assert.equal(f.calls[0].workspace,undefined);
  await assert.rejects(discoverCodexEndpoint({...f.options(),workspace:undefined,endpoint:'unix://'+f.socket,probe:async input=>{const observed=await f.probe(input);observed.thread.parentThreadId=randomUUID();return observed;}}),{code:'CODEX_SESSION_INPUT_UNAVAILABLE'});
});
test('trusted official stable symlink may point only to a socket in another private owned directory',async t=>{
  const f=await fixture(t),stable=path.join(f.directory,'stable');fs.mkdirSync(stable,{mode:0o700});
  const link=path.join(stable,'control.sock');fs.symlinkSync(f.socket,link);
  assert.equal((await discoverCodexEndpoint({...f.options(),endpoint:'unix://'+link})).endpoint,'unix://'+f.socket);
  fs.chmodSync(f.control,0o755);
  await assert.rejects(discoverCodexEndpoint({...f.options(),endpoint:'unix://'+link}),{code:'CODEX_SESSION_ENDPOINT_UNTRUSTED'});
});
test('missing socket is unavailable; regular files and public socket parents are untrusted before probe',async t=>{
  const f=await fixture(t),missing=path.join(f.control,'missing.sock'),ordinary=path.join(f.control,'ordinary');fs.writeFileSync(ordinary,'synthetic');
  await assert.rejects(discoverCodexEndpoint({...f.options(),endpoint:'unix://'+missing}),{code:'CODEX_SESSION_ENDPOINT_UNAVAILABLE'});
  await assert.rejects(discoverCodexEndpoint({...f.options(),endpoint:'unix://'+ordinary}),{code:'CODEX_SESSION_ENDPOINT_UNTRUSTED'});
  fs.chmodSync(f.control,0o750);await assert.rejects(discoverCodexEndpoint(f.options()),{code:'CODEX_SESSION_ENDPOINT_UNTRUSTED'});
  assert.equal(f.calls.length,0);
});
test('real filesystem socket ownership is checked against the process user',async t=>{
  const f=await fixture(t);assert.equal(fs.lstatSync(f.socket).uid,process.getuid());
  assert.throws(()=>trustedCodexUnixEndpoint(f.socket,{uid:process.getuid()+1}),{code:'CODEX_SESSION_ENDPOINT_UNTRUSTED'});
  assert.equal(trustedCodexUnixEndpoint(f.socket).endpoint,'unix://'+f.socket);
});
test('history presence, a foreign thread or malformed loaded metadata never establish original ownership',async t=>{
  const f=await fixture(t);
  for(const observation of [null,{loaded:false,thread:{id:f.conversationId}},{loaded:true,thread:{id:randomUUID()}},{loaded:1,thread:{id:f.conversationId}}])
    await assert.rejects(discoverCodexEndpoint({...f.options(),probe:async()=>observation}),{code:'CODEX_SESSION_NOT_LOADED'});
});
test('workspace aliases are canonicalized, while another or missing workspace is refused',async t=>{
  const f=await fixture(t),alias=path.join(f.directory,'work-link');fs.symlinkSync(f.workspace,alias);
  await discoverCodexEndpoint({...f.options(),workspace:alias});assert.equal(f.calls.at(-1).workspace,f.workspace);
  const other=path.join(f.directory,'other');fs.mkdirSync(other);
  for(const cwd of [other,path.join(f.directory,'absent'),'relative',null])
    await assert.rejects(discoverCodexEndpoint({...f.options(),probe:async()=>({loaded:true,thread:{id:f.conversationId,cwd,canAcceptDirectInput:true}})}),{code:'CODEX_SESSION_WORKSPACE_MISMATCH'});
});
test('noninteractive, child and ephemeral threads are not silently converted to writable sessions',async t=>{
  const f=await fixture(t);
  for(const patch of [{canAcceptDirectInput:false},{canAcceptDirectInput:undefined},{parentThreadId:randomUUID()},{ephemeral:true}])
    await assert.rejects(discoverCodexEndpoint({...f.options(),probe:async()=>({loaded:true,thread:{id:f.conversationId,cwd:f.workspace,canAcceptDirectInput:true,...patch}})}),{code:'CODEX_SESSION_INPUT_UNAVAILABLE'});
});
test('loopback WebSocket may be explicit, but discovery does not scan ports or trust remote/credential URLs',async t=>{
  const f=await fixture(t);assert.deepEqual(await discoverCodexEndpoint({...f.options(),endpoint:'ws://127.0.0.1:12345/rpc'}),{endpoint:'ws://127.0.0.1:12345/rpc',rpcPath:'/rpc',mode:'explicit'});
  for(const endpoint of ['ws://example.com:12345','ws://127.0.0.1:0','wss://example.com:443','ws://user:secret@127.0.0.1:12345','ws://127.0.0.1:12345/?token=secret','ws://127.0.0.1:12345/#fragment','http://127.0.0.1:12345'])
    await assert.rejects(discoverCodexEndpoint({...f.options(),endpoint}),{code:'CODEX_SESSION_ENDPOINT_UNTRUSTED'});
  await assert.rejects(discoverCodexEndpoint({...f.options(),endpoint:'ws://127.0.0.1:12345/rpc',rpcPath:'/other'}),{code:'CODEX_SESSION_ENDPOINT_INVALID'});
});
test('a failed probe returns unavailable without retaining a potentially sensitive native exception',async t=>{
  const f=await fixture(t);
  await assert.rejects(discoverCodexEndpoint({...f.options(),probe:async()=>{throw Error('private synthetic detail');}}),error=>error.code==='CODEX_SESSION_ENDPOINT_UNAVAILABLE'&&!String(error).includes('private'));
});
test('the stable socket changing during probe invalidates discovery',async t=>{
  const f=await fixture(t),alias=path.join(f.directory,'alias');fs.mkdirSync(alias,{mode:0o700});const link=path.join(alias,'control.sock');fs.symlinkSync(f.socket,link);
  await assert.rejects(discoverCodexEndpoint({...f.options(),endpoint:'unix://'+link,probe:async input=>{fs.unlinkSync(link);fs.symlinkSync(f.socket,link);return f.probe(input);}}),{code:'CODEX_SESSION_ENDPOINT_CHANGED'});
});
test('invalid bindings and RPC request-targets do not invoke the probe',async t=>{
  const f=await fixture(t);
  for(const patch of [{conversationId:'bad'},{workspace:'relative'},{codexHome:'relative'},{rpcPath:'/rpc?token=x'},{rpcPath:'/../rpc'},{rpcPath:'/rpc\r\nX: y'},{probe:null}])
    await assert.rejects(discoverCodexEndpoint({...f.options(),...patch}),{code:'CODEX_SESSION_DISCOVERY_INVALID'});
  assert.equal(f.calls.length,0);assert.equal(DESKTOP_SHARED_DAEMON_ADVICE.optInEnvironmentName,'CODEX_APP_SERVER_USE_LOCAL_DAEMON');
});
