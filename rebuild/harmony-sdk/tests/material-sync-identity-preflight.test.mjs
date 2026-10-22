import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

function setup(){
  const calls=[],requests=[],fileCalls=[];
  let now=10000,handler=async()=>({responseCode:404,result:'',header:{}}),destroyError=false;
  const principal={ownerId:'owner-preview',producerId:'phone-preview',serverId:'server-preview'};
  const platform={
    '@kit.CoreFileKit':{fileIo:new Proxy({}, {get(_target,key){return (..._args)=>{fileCalls.push(key);throw Error('Unexpected material/outbox file access');};}})},
    '@kit.NetworkKit':{http:{RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:1},createHttp(){
      const request={destroyCalls:0,destroy(){this.destroyCalls++;if(destroyError)throw Error('private destroy bearer');},
        async request(url,options){calls.push({url,options,request});return handler(url,options);}};
      requests.push(request);return request;
    }}}
  };
  class ClockDate extends Date {static now(){return now;}}
  const mod=loadApp('MaterialSyncTransport',platform,{Date:ClockDate});
  const target={baseUrl:'https://preview.invalid/io-api/v1',token:'a'.repeat(43),principal};
  const identity={schema_version:'1.0',server_id:principal.serverId,owner_id:principal.ownerId,producer_id:principal.producerId,
    scopes:['materials:write','materials:read'],expires_at:new Date(100000).toISOString(),material_schema_versions:['1.0','1.1','1.2']};
  return {target,identity,calls,requests,fileCalls,client:new mod.MaterialSyncTransport(),
    setHandler(value){handler=value;},setTime(value){now=value;},setDestroyError(value){destroyError=value;}};
}
const response=(body,status=200,header={})=>({responseCode:status,result:JSON.stringify(body),header});
const settled=()=>new Promise(setImmediate);
function rejectedCode(expected){return error=>{assert.equal(error.message,expected);return true;};}

test('preview performs exactly one bounded GET and returns only authenticated identity fields without material/outbox I/O',async()=>{
  const f=setup(),secret='unknown-response-secret';
  f.setHandler(async()=>response({...f.identity,token:secret,debug:{bearer:secret},materials:[{text:secret}]}));
  const actual=await f.client.preflight(f.target,f.identity.expires_at,'1.2');
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),f.identity);assert(!JSON.stringify(actual).includes(secret));
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'https://preview.invalid/io-api/v1/identity');
  assert.equal(f.calls[0].options.method,'GET');assert.equal(f.calls[0].options.extraData,undefined);
  assert.equal(f.calls[0].options.header.Authorization,'Bearer '+f.target.token);
  assert.equal(f.calls[0].options.maxRedirects,0);assert.equal(f.calls[0].options.usingCache,false);
  assert.equal(f.calls[0].options.connectTimeout,5000);assert.equal(f.calls[0].options.readTimeout,10000);
  assert.equal(f.calls[0].options.maxLimit,16384);assert.equal(f.client.note,'verified');
  assert.equal(f.client.lastIdentityStatus,200);assert.equal(f.requests[0].destroyCalls,1);assert.deepEqual(f.fileCalls,[]);
});

test('owner, producer, service, protocol, permission and expiry mismatches never authenticate a preview',async()=>{
  for(const patch of [{owner_id:'wrong-owner'},{producer_id:'wrong-phone'},{server_id:'wrong-server'},{schema_version:'2.0'},
    {scopes:['materials:read']},{scopes:'materials:write'},{scopes:['materials:write',null]},
    {scopes:['materials:write','Bearer private']},{scopes:Array(33).fill('materials:write')},
    {expires_at:new Date(9999).toISOString()},{expires_at:'invalid'},{expires_at:null}]){
    const f=setup();f.setHandler(async()=>response({...f.identity,...patch}));
    await assert.rejects(f.client.preflight(f.target),rejectedCode('SYNC_IDENTITY_MISMATCH'));
    assert.equal(f.calls.length,1);assert.equal(f.requests[0].destroyCalls,1);assert.deepEqual(f.fileCalls,[]);
  }
});

test('unsafe or malformed targets fail locally with a fixed code before creating HTTP',async()=>{
  const f=setup();
  for(const baseUrl of ['http://preview.invalid/v1','https://user:secret@preview.invalid/v1','https://preview.invalid/v1?token=secret',
    'https://preview.invalid/v1#secret','https://preview.invalid/%2fv1','https://preview.invalid/v1\\secret',
    'https://preview.invalid/io-api/../v1','https://preview.invalid/io-api/../../v1','https://preview.invalid/./v1']){
    await assert.rejects(f.client.preflight({...f.target,baseUrl}),rejectedCode('SYNC_TARGET_INVALID'));
  }
  for(const target of [null,{}, {...f.target,token:'short'},{...f.target,principal:{...f.target.principal,ownerId:'wrong owner'}}])
    await assert.rejects(f.client.preflight(target),rejectedCode('SYNC_TARGET_INVALID'));
  assert.equal(f.requests.length,0);assert.deepEqual(f.fileCalls,[]);
});

test('registered expiry is compared by its exact instant, with equivalent offsets accepted and mismatches rejected',async()=>{
  const f=setup();f.setHandler(async()=>response(f.identity));
  await f.client.preflight(f.target,'1970-01-01T08:01:40+08:00','1.2');
  await assert.rejects(f.client.preflight(f.target,new Date(100001).toISOString(),'1.2'),rejectedCode('SYNC_EXPIRY_MISMATCH'));
  assert.equal(f.requests.length,2);assert(f.requests.every(request=>request.destroyCalls===1));assert.deepEqual(f.fileCalls,[]);
});

test('required 1.2 refuses missing capabilities, unsupported versions and malformed declarations while legacy preview remains valid',async()=>{
  for(const versions of [undefined,['1.0','1.1'],[],null,'1.2',['1.2',5],['1.2','private schema'],Array(17).fill('1.2')]){
    const f=setup();f.setHandler(async()=>response({...f.identity,material_schema_versions:versions}));
    const expected=versions===undefined||Array.isArray(versions)&&versions.every(v=>typeof v==='string'&&/^\d+\.\d+$/.test(v))&&versions.length<=16?
      'SYNC_SCHEMA_UNSUPPORTED':'SYNC_IDENTITY_MISMATCH';
    await assert.rejects(f.client.preflight(f.target,f.identity.expires_at,'1.2'),rejectedCode(expected));
    assert.equal(f.calls.length,1);assert.equal(f.requests[0].destroyCalls,1);assert.deepEqual(f.fileCalls,[]);
  }
  const f=setup();f.setHandler(async()=>{const legacy={...f.identity};delete legacy.material_schema_versions;return response(legacy);});
  const actual=await f.client.preflight(f.target);assert.equal(actual.material_schema_versions,undefined);assert.equal(f.client.note,'verified');
});

test('invalid or expired import constraints are rejected before starting HTTP',async()=>{
  const f=setup();
  for(const expiry of ['invalid',new Date(9999).toISOString(),'x'.repeat(65),null])
    await assert.rejects(f.client.preflight(f.target,expiry,'1.2'),rejectedCode('SYNC_EXPIRY_INVALID'));
  for(const schema of ['',null,'1','1.2/private','1.'.repeat(10)])
    await assert.rejects(f.client.preflight(f.target,f.identity.expires_at,schema),rejectedCode('SYNC_SCHEMA_INVALID'));
  assert.equal(f.requests.length,0);assert.deepEqual(f.fileCalls,[]);
});

test('invalid JSON and non-object identity responses fail without exposing their bodies',async()=>{
  for(const result of ['', 'private-not-json', 'null','[]','42','"private-string"']){
    const f=setup();f.setHandler(async()=>({responseCode:200,result,header:{}}));
    await assert.rejects(f.client.preflight(f.target),rejectedCode('SYNC_IDENTITY_MISMATCH'));
    assert.equal(f.client.note,'IDENTITY_MISMATCH');assert.equal(f.requests[0].destroyCalls,1);assert.deepEqual(f.fileCalls,[]);
  }
});

test('redirects and every non-200 identity response fail without following or exposing secret response data',async()=>{
  for(const status of [201,204,301,302,307,308,401,403,404,429,500]){
    const f=setup();f.setHandler(async()=>response({token:f.target.token,message:'private-body-12345678'},status,{Location:'https://private.invalid/?token='+f.target.token}));
    await assert.rejects(f.client.preflight(f.target),rejectedCode('SYNC_IDENTITY_UNAVAILABLE'));
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.maxRedirects,0);assert.equal(f.client.lastIdentityStatus,status);
    assert(!JSON.stringify([f.client.note,f.client.lastErrorCode]).includes('private'));assert.equal(f.requests[0].destroyCalls,1);assert.deepEqual(f.fileCalls,[]);
  }
});

test('UTF-8 response limit is enforced even when the injected HTTP implementation ignores maxLimit',async()=>{
  for(const privateField of ['x'.repeat(17000),'界'.repeat(6000)]){
    const f=setup();f.setHandler(async()=>response({...f.identity,private:privateField}));
    await assert.rejects(f.client.preflight(f.target),rejectedCode('SYNC_IDENTITY_UNAVAILABLE'));
    assert.equal(f.client.lastIdentityStatus,0);assert.equal(f.client.lastErrorCode,'TRANSPORT_FAILED');
    assert.equal(f.requests[0].destroyCalls,1);assert.deepEqual(f.fileCalls,[]);
  }
});

test('HTTP failures never copy URL, bearer, body or digits extracted from a secret message into errors or diagnostics',async()=>{
  const f=setup();f.setHandler(async()=>{throw Error('https://private.invalid/v1 Bearer '+f.target.token+' private-body-12345678');});
  await assert.rejects(f.client.preflight(f.target),rejectedCode('SYNC_IDENTITY_UNAVAILABLE'));
  assert.equal(f.client.lastErrorCode,'TRANSPORT_FAILED');assert.equal(f.client.note,'IDENTITY_UNAVAILABLE');
  assert.equal(f.requests[0].destroyCalls,1);assert.deepEqual(f.fileCalls,[]);
});

test('numeric platform code is bounded diagnostics while the transport message stays hidden',async()=>{
  const f=setup();f.setHandler(async()=>{throw Object.assign(Error('private bearer'),{code:2300006});});
  await assert.rejects(f.client.preflight(f.target),rejectedCode('SYNC_IDENTITY_UNAVAILABLE'));
  assert.equal(f.client.lastErrorCode,'E2300006');assert.equal(f.requests[0].destroyCalls,1);
});

test('a busy preview rejects a second request and releases its operation fence only after settlement',async()=>{
  const f=setup();let release;f.setHandler(async()=>new Promise(resolve=>release=resolve));
  const running=f.client.preflight(f.target);await settled();
  await assert.rejects(f.client.preflight(f.target),rejectedCode('SYNC_PREFLIGHT_BUSY'));assert.equal(f.calls.length,1);
  release(response(f.identity));await running;f.setHandler(async()=>response(f.identity));await f.client.preflight(f.target);
  assert.equal(f.calls.length,2);assert(f.requests.every(request=>request.destroyCalls===1));assert.deepEqual(f.fileCalls,[]);
});

test('cancel destroys the active request, fences a late success and prevents a second request until the cancelled operation settles',async()=>{
  const f=setup();let release;f.setHandler(async()=>new Promise(resolve=>release=resolve));
  const running=f.client.preflight(f.target,f.identity.expires_at,'1.2');await settled();f.client.cancel();
  assert.equal(f.requests[0].destroyCalls,1);assert.equal(f.client.note,'paused');
  await assert.rejects(f.client.preflight(f.target),rejectedCode('SYNC_PREFLIGHT_BUSY'));
  release(response({...f.identity,private:'late-private-body'}));await assert.rejects(running,rejectedCode('SYNC_PREFLIGHT_CANCELLED'));
  assert.equal(f.client.note,'paused');assert.equal(f.client.lastIdentityStatus,0);assert.deepEqual(f.fileCalls,[]);
  f.setHandler(async()=>response(f.identity));await f.client.preflight(f.target);assert.equal(f.calls.length,2);
});

test('cancel plus late network failure and a throwing destroy still produce only a fixed cancellation code',async()=>{
  const f=setup();let reject;f.setHandler(async()=>new Promise((_resolve,fail)=>reject=fail));
  const running=f.client.preflight(f.target);await settled();f.setDestroyError(true);assert.doesNotThrow(()=>f.client.cancel());
  reject(Error('private bearer '+f.target.token));await assert.rejects(running,rejectedCode('SYNC_PREFLIGHT_CANCELLED'));
  assert.equal(f.client.note,'paused');assert.equal(f.client.lastIdentityStatus,0);assert(f.requests[0].destroyCalls>=1);assert.deepEqual(f.fileCalls,[]);
});

test('mutable pending settings cannot replace the endpoint, bearer or principal of the authenticated preview',async()=>{
  const f=setup(),oldToken=f.target.token;let release;f.setHandler(async()=>new Promise(resolve=>release=resolve));
  const running=f.client.preflight(f.target,f.identity.expires_at,'1.2');await settled();
  f.target.token='b'.repeat(43);f.target.baseUrl='https://changed.invalid/v1';f.target.principal.ownerId='changed-owner';
  release(response(f.identity));const actual=await running;
  assert.equal(actual.owner_id,'owner-preview');assert.equal(f.calls[0].url,'https://preview.invalid/io-api/v1/identity');
  assert.equal(f.calls[0].options.header.Authorization,'Bearer '+oldToken);assert.equal(f.calls.length,1);assert.deepEqual(f.fileCalls,[]);
});

test('a credential that expires while identity is pending is rejected at response time',async()=>{
  const f=setup();let release;f.setHandler(async()=>new Promise(resolve=>release=resolve));
  const running=f.client.preflight(f.target,f.identity.expires_at,'1.2');await settled();f.setTime(100000);release(response(f.identity));
  await assert.rejects(running,rejectedCode('SYNC_IDENTITY_MISMATCH'));assert.equal(f.requests[0].destroyCalls,1);assert.deepEqual(f.fileCalls,[]);
});

test('pump and preview share the operation fence in both directions without claiming a preview queue',async()=>{
  const f=setup();let release,claims=0;
  const queue={matches(){return true;},claim(){claims++;return undefined;},all(){return [];}};
  f.setHandler(async()=>new Promise(resolve=>release=resolve));const preview=f.client.preflight(f.target);await settled();
  assert.equal(await f.client.pump(queue,f.target),false);assert.equal(claims,0);assert.equal(f.calls.length,1);
  release(response(f.identity));await preview;
  const pump=f.client.pump(queue,f.target);await settled();await assert.rejects(f.client.preflight(f.target),rejectedCode('SYNC_PREFLIGHT_BUSY'));
  assert.equal(f.calls.length,2);release(response(f.identity));assert.equal(await pump,false);assert.equal(claims,1);assert.deepEqual(f.fileCalls,[]);
});

test('manual read-only preview neither obeys nor alters the queued pump retry schedule',async()=>{
  const f=setup();f.client.nextCheckAt=500000;f.setHandler(async()=>response(f.identity));
  await f.client.preflight(f.target,f.identity.expires_at,'1.2');assert.equal(f.client.nextCheckAt,500000);
  assert.equal(f.calls.length,1);assert.deepEqual(f.fileCalls,[]);
});
