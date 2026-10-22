import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadApp} from './load-app.mjs';

const now=Date.parse('2026-10-14T02:00:00.000Z');
const valid=()=>({format:'turboio-task-connection/1',base_url:'https://synthetic.invalid/io-api/v1',
  owner_id:'synthetic-import-owner',producer_id:'synthetic-phone',server_id:'synthetic-server',token:'a'.repeat(43),
  token_id:'c0ffee00-0000-4000-8000-000000000001',expires_at:'2026-10-14T03:00:00.000Z',computer_id:'synthetic-pc',agent_id:'hermes',project_id:'synthetic-project',session_id:'registered-session'});
const encode=text=>new TextEncoder().encode(text);
const validBytes=()=>encode(JSON.stringify(valid()));
const strictKit={
  '@kit.ArkTS':{
    util:{
      TextEncoder:class {encodeInto(text){return encode(text);}},
      TextDecoder:class {constructor(label='utf-8',options={}){this.decoder=new TextDecoder(label,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}
    }
  }
};
const pure=()=>loadApp('TaskConnectionImport',strictKit);
function rejectCode(action,code='TASK_IMPORT_INVALID'){
  assert.throws(action,error=>error.message===code);
}

test('a valid import returns a disabled candidate without network, vault or caller-buffer changes',()=>{
  let requests=0;
  const mod=loadApp('TaskConnectionImport',{...strictKit,'@kit.NetworkKit':{http:{createHttp(){requests++;throw Error('must not connect');}}}});
  const bytes=validBytes(),original=Uint8Array.from(bytes),candidate=mod.parseTaskConnection(bytes,now);
  assert.equal(candidate.target.baseUrl,valid().base_url);assert.equal(candidate.target.principal.ownerId,valid().owner_id);
  assert.equal(candidate.target.principal.producerId,valid().producer_id);assert.equal(candidate.target.principal.serverId,valid().server_id);
  assert.deepEqual(JSON.parse(JSON.stringify(candidate.route)),{computer_id:valid().computer_id,agent_id:valid().agent_id,project_id:valid().project_id,session_id:valid().session_id});
  assert.equal(candidate.target.token,valid().token);assert.equal(candidate.tokenId,valid().token_id);
  assert.equal(candidate.expiresAt,Date.parse(valid().expires_at));assert.equal(candidate.enabled,undefined);
  assert.deepEqual(bytes,original);assert.equal(requests,0);
  const withSlash={...valid(),base_url:valid().base_url+'/'};
  assert.equal(mod.parseTaskConnection(encode(JSON.stringify(withSlash)),now).target.baseUrl,valid().base_url);
});

test('field order and valid string escapes are supported without assuming canonical JSON',()=>{
  const mod=pure(),entries=Object.entries(valid()).reverse();
  const text=' \r\n'+JSON.stringify(Object.fromEntries(entries)).replace('"token"','"tok\\u0065n"')+'\t';
  assert.equal(mod.parseTaskConnection(encode(text),now).target.token,valid().token);
});

test('duplicate keys including escaped spelling and any unknown field are rejected',()=>{
  const mod=pure(),text=JSON.stringify(valid()),prefix=text.slice(0,-1);
  for(const append of ['"token":"'+valid().token+'"','"tok\\u0065n":"'+valid().token+'"','"enabled":"true"','"__proto__":"x"'])
    rejectCode(()=>mod.parseTaskConnection(encode(prefix+','+append+'}'),now));
});

test('the import is exactly one flat object with all twelve string fields',()=>{
  const mod=pure();
  for(const key of Object.keys(valid())){
    for(const value of [null,true,123,[],{}])rejectCode(()=>mod.parseTaskConnection(encode(JSON.stringify({...valid(),[key]:value})),now));
    const missing=valid();delete missing[key];rejectCode(()=>mod.parseTaskConnection(encode(JSON.stringify(missing)),now));
  }
  for(const text of ['[]','{}','null',JSON.stringify([valid()]),JSON.stringify(valid())+' false',JSON.stringify(valid()).slice(0,-1),
    JSON.stringify(valid()).slice(0,-1)+',}','/*comment*/'+JSON.stringify(valid()),JSON.stringify(valid()).replace(':',':/*comment*/')])
    rejectCode(()=>mod.parseTaskConnection(encode(text),now));
});

test('UTC expiration validates real calendar values and rejects the exact deadline',()=>{
  const mod=pure();
  for(const expires_at of ['2026-10-14T02:00:00.000Z','2026-10-14T01:59:59Z'])
    rejectCode(()=>mod.parseTaskConnection(encode(JSON.stringify({...valid(),expires_at})),now),'TASK_IMPORT_EXPIRED');
  for(const expires_at of ['2026-02-30T03:00:00Z','2027-02-29T03:00:00Z','2026-13-01T03:00:00Z','2026-10-14T24:00:00Z',
    '2026-10-14T03:00:60Z','2026-10-14 03:00:00Z','2026-10-14T03:00:00','2026-10-14T03:00:00+00:00',
    '2026-10-14T03:00:00.1234567890Z','2026-10-14T03:00:00Z '])
    rejectCode(()=>mod.parseTaskConnection(encode(JSON.stringify({...valid(),expires_at})),now));
  for(const expires_at of ['2026-10-14T03:00:00Z','2026-10-14T03:00:00.1Z','2026-10-14T03:00:00.123456789Z'])
    assert(mod.parseTaskConnection(encode(JSON.stringify({...valid(),expires_at})),now).expiresAt>now);
  assert.equal(mod.parseTaskConnection(encode(JSON.stringify({...valid(),expires_at:'2028-02-29T03:00:00Z'})),now).expiresAt,
    Date.parse('2028-02-29T03:00:00Z'));
});

test('existing target validation rejects unsafe endpoints, malformed identities and bearer values',()=>{
  const mod=pure();
  for(const patch of [{format:'turboio-material-sync/2'},{base_url:'http://synthetic.invalid/v1'},
    {base_url:'https://user:secret@synthetic.invalid/v1'},{base_url:'https://synthetic.invalid/v1?token=x'},
    {base_url:'https://synthetic.invalid/v1#x'},{base_url:'https://synthetic.invalid/a%2fv1'},
    {base_url:'https://synthetic.invalid/io-api/../v1'},{base_url:'https://synthetic.invalid/io-api/../../v1'},
    {base_url:'https://synthetic.invalid/./v1'},
    {base_url:'https://synthetic.invalid/v1\\evil'},{owner_id:''},{producer_id:'bad identity'},{server_id:'\u0000'},
    {token:'x'},{token:'a'.repeat(43)+' '},{token_id:'not-a-uuid'},
    {token_id:'c0ffee00-0000-1000-8000-000000000001'},{token_id:'c0ffee00-0000-4000-0000-000000000001'},
    {token_id:'C0FFEE00-0000-4000-8000-000000000001'}])
    rejectCode(()=>mod.parseTaskConnection(encode(JSON.stringify({...valid(),...patch})),now));
});

test('strict UTF-8 does not silently replace malformed bytes or echo parser input',()=>{
  const mod=pure(),prefix=encode('{"private-synthetic-detail":"');
  for(const invalid of [[0xc3,0x28],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0xe2,0x82]]){
    const bytes=new Uint8Array(prefix.length+invalid.length);bytes.set(prefix);bytes.set(invalid,prefix.length);
    rejectCode(()=>mod.parseTaskConnection(bytes,now));
  }
  rejectCode(()=>mod.parseTaskConnection(encode('{"private-synthetic-token":"sensitive parse failure'),now));
});

test('8 KB is a byte bound and invalid clock arguments cannot bypass expiration',()=>{
  const mod=pure(),text=JSON.stringify(valid()),padding=' '.repeat(8192-encode(text).length);
  assert.equal(mod.parseTaskConnection(encode(text+padding),now).tokenId,valid().token_id);
  rejectCode(()=>mod.parseTaskConnection(encode(text+padding+' '),now));rejectCode(()=>mod.parseTaskConnection(new Uint8Array(0),now));
  for(const clock of [NaN,Infinity,-1,0.5])rejectCode(()=>mod.parseTaskConnection(validBytes(),clock));
});

function realFile(t,{chunk=17,truncate=false,grow=false,readError=false,closeError=false}={}){
  const prefix=path.join(os.tmpdir(),'turboio-import-test-'),root=fs.mkdtempSync(prefix),filename=path.join(root,'synthetic.json');
  fs.writeFileSync(filename,validBytes());const buffers=[],decoded=[],opened=[],closed=[];let stats=0,reads=0;
  t.after(()=>{for(const file of opened)if(!closed.includes(file.fd)){try{fs.closeSync(file.fd);}catch{}}
    if(!path.resolve(root).startsWith(path.resolve(prefix)))throw Error('Unsafe test cleanup');fs.rmSync(root,{recursive:true});});
  const io={OpenMode:{READ_ONLY:0},openSync(uri,mode){assert.equal(mode,0);const file={fd:fs.openSync(uri,'r')};opened.push(file);return file;},
    statSync(fd){assert.equal(typeof fd,'number');const stat=fs.fstatSync(fd);if(++stats===1){
      if(truncate)fs.truncateSync(filename,23);if(grow)fs.appendFileSync(filename,' ');
    }return stat;},
    readSync(fd,buffer,options){buffers.push(new Uint8Array(buffer));reads++;if(readError)throw Error('private-synthetic-path and bearer');
      return fs.readSync(fd,new Uint8Array(buffer),0,Math.min(chunk,options.length),null);},
    closeSync(file){fs.closeSync(file.fd);closed.push(file.fd);if(closeError)throw Error('private-synthetic-close detail');}};
  const fileKit={util:{...strictKit['@kit.ArkTS'].util,
    TextDecoder:class {constructor(label='utf-8',options={}){this.decoder=new TextDecoder(label,options);}decodeToString(bytes){decoded.push(bytes);return this.decoder.decode(bytes);}}}};
  const mod=loadApp('TaskConnectionImport',{'@kit.ArkTS':fileKit,'@kit.CoreFileKit':{fileIo:io}});
  return {...mod,filename,buffers,decoded,opened,closed,getReads:()=>reads};
}

test('actual file descriptors read all short chunks, close and clear every owned read buffer',t=>{
  const f=realFile(t),before=fs.readFileSync(f.filename),candidate=f.readTaskConnectionFile(f.filename,now);
  assert.deepEqual(JSON.parse(JSON.stringify(candidate.route)),{computer_id:valid().computer_id,agent_id:valid().agent_id,project_id:valid().project_id,session_id:valid().session_id});
  assert.equal(candidate.target.token,valid().token);assert(f.getReads()>2);assert.equal(f.opened.length,1);assert.equal(f.closed.length,1);
  assert(f.buffers.length>2);assert(f.buffers.every(buffer=>buffer.every(byte=>byte===0)));
  assert.equal(f.decoded.length,1);assert(f.decoded.every(buffer=>buffer.every(byte=>byte===0)));
  assert.deepEqual(fs.readFileSync(f.filename),before);
});

test('actual file parse failures still close descriptors and clear owned buffers',t=>{
  for(const [content,code] of [[Buffer.from([0xc3,0x28]),'TASK_IMPORT_INVALID'],[Buffer.alloc(8193,32),'TASK_IMPORT_INVALID'],
    [Buffer.alloc(0),'TASK_IMPORT_INVALID'],[encode(JSON.stringify({...valid(),expires_at:'2026-10-14T01:00:00Z'})),'TASK_IMPORT_EXPIRED']]){
    const f=realFile(t);fs.writeFileSync(f.filename,content);rejectCode(()=>f.readTaskConnectionFile(f.filename,now),code);
    assert.equal(f.closed.length,1);assert(f.buffers.every(buffer=>buffer.every(byte=>byte===0)));assert(f.decoded.every(buffer=>buffer.every(byte=>byte===0)));
  }
});

test('real truncation and growth after stat cannot produce a partial successful import',t=>{
  for(const changes of [{truncate:true},{grow:true}]){
    const f=realFile(t,changes);rejectCode(()=>f.readTaskConnectionFile(f.filename,now),'TASK_IMPORT_READ_FAILED');
    assert.equal(f.closed.length,1);assert(f.buffers.every(buffer=>buffer.every(byte=>byte===0)));assert(f.decoded.every(buffer=>buffer.every(byte=>byte===0)));
  }
});

test('file open, read and close failures expose only bounded codes',t=>{
  const absent=realFile(t);rejectCode(()=>absent.readTaskConnectionFile(absent.filename+'-private-synthetic-token',now),'TASK_IMPORT_READ_FAILED');
  assert.equal(absent.opened.length,0);
  for(const changes of [{readError:true},{closeError:true}]){
    const f=realFile(t,changes);rejectCode(()=>f.readTaskConnectionFile(f.filename,now),'TASK_IMPORT_READ_FAILED');
    assert.equal(f.closed.length,1);assert(f.buffers.every(buffer=>buffer.every(byte=>byte===0)));assert(f.decoded.every(buffer=>buffer.every(byte=>byte===0)));
  }
  rejectCode(()=>absent.readTaskConnectionFile('bad\u0000path',now),'TASK_IMPORT_READ_FAILED');
  for(const thrown of [null,undefined,'private-synthetic-bearer']){
    const mod=loadApp('TaskConnectionImport',{...strictKit,'@kit.CoreFileKit':{fileIo:{OpenMode:{READ_ONLY:0},openSync(){throw thrown;}}}});
    rejectCode(()=>mod.readTaskConnectionFile('synthetic-only.json',now),'TASK_IMPORT_READ_FAILED');
  }
});


test('task connection rejects material format and missing or unsafe route rather than creating a session',()=>{
  const mod=pure();
  for(const change of [{format:'turboio-material-sync/1'},{session_id:''},{project_id:'../other'},{computer_id:'pc/other'},{agent_id:'hermes '+String.fromCharCode(0)}])
    rejectCode(()=>mod.parseTaskConnection(encode(JSON.stringify({...valid(),...change})),now));
});
