import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {BridgeState} from '../state.mjs';

// The actual Windows handle test needs Python, but no developer-specific path.
// An explicit override is a required dependency; automatic discovery is optional.
function testPython(){
  if(process.platform!=='win32')return null;
  const configured=process.env.TURBOIO_TEST_PYTHON;
  const candidates=configured?[[configured,[]]]:[['python',[]],['py',['-3']],['python3',[]]];
  for(const [command,prefix] of candidates){
    const result=spawnSync(command,[...prefix,'-I','-S','-B','-c','import sys;print(sys.executable)'],
      {encoding:'utf8',windowsHide:true,timeout:5000});
    const executable=result.stdout?.trim();
    if(result.status===0&&executable&&fs.existsSync(executable))return executable;
  }
  if(configured)throw new Error('TEST_PYTHON_UNAVAILABLE');
  return null;
}
const python=testPython();
function setup(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'io-state-save-')),file=path.join(directory,'state.json');
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const state=BridgeState.load(file);state.bind({server_id:'synthetic-server',owner_id:'synthetic-owner',producer_id:'synthetic-pc'});state.save();
  return {state,file};
}
test('Windows actual reader without delete sharing releases and the same ledger replaces atomically',
  {skip:process.platform!=='win32'?'requires Windows':!python?'Python not found; set TURBOIO_TEST_PYTHON':false},async t=>{
  const {state,file}=setup(t);
  const code="import ctypes,sys,time; k=ctypes.WinDLL('kernel32',use_last_error=True); k.CreateFileW.argtypes=[ctypes.c_wchar_p,ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p,ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p]; k.CreateFileW.restype=ctypes.c_void_p; k.CloseHandle.argtypes=[ctypes.c_void_p]; h=k.CreateFileW(sys.argv[1],0x80000000,3,None,3,0,None); assert h not in {None,ctypes.c_void_p(-1).value}; print('locked',flush=True); time.sleep(0.12); k.CloseHandle(h)";
  const child=spawn(python,['-I','-S','-B','-c',code,file],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('SYNTHETIC_READER_FAILED')));});
  await new Promise((resolve,reject)=>{child.stdout.once('data',bytes=>String(bytes).includes('locked')?resolve():reject(new Error('SYNTHETIC_READER_NOT_READY')));child.once('error',reject);child.once('exit',()=>reject(new Error('SYNTHETIC_READER_EXITED_EARLY')));});
  const rename=fs.renameSync;let denied=0;
  t.mock.method(fs,'renameSync',(from,to)=>{try{return rename(from,to);}catch(error){if(['EPERM','EACCES','EBUSY'].includes(error.code))denied++;throw error;}});
  state.cursor='synthetic-new-cursor';state.save();await closed;
  assert(denied>0,'actual Windows lock must deny at least one replacement');assert.equal(stderr,'');
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).cursor,'synthetic-new-cursor');
  assert(!fs.existsSync(`${file}.${process.pid}.tmp`));
});
test('permanent replacement failure preserves old bytes and never dispatches runtime work',{skip:process.platform!=='win32'},async t=>{
  const {state,file}=setup(t),before=fs.readFileSync(file);let calls=0,attempts=0;
  t.mock.method(fs,'renameSync',()=>{attempts++;throw Object.assign(new Error('SYNTHETIC_DENIED'),{code:'EPERM'});});
  await assert.rejects(state.dispatch('synthetic-delivery',()=>{calls++;return [];}),error=>error.code==='EPERM');
  assert.equal(attempts,6);assert.equal(calls,0);assert.deepEqual(fs.readFileSync(file),before);
  assert.equal(JSON.parse(fs.readFileSync(`${file}.${process.pid}.tmp`,'utf8')).dispatches['synthetic-delivery'].state,'prepared');
});
test('ownership loss during transient retry forbids another replacement',{skip:process.platform!=='win32'},()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'io-state-fenced-'));
  try{
    const file=path.join(directory,'state.json'),state=BridgeState.load(file);state.bind({server_id:'s',owner_id:'o',producer_id:'p'});state.save();
    const before=fs.readFileSync(file);let owned=true,attempts=0;
    state.guardWrites(()=>{if(!owned)throw Object.assign(new Error('SYNTHETIC_LEASE_LOST'),{code:'LOCK_LOST'});});
    const rename=fs.renameSync;fs.renameSync=()=>{attempts++;owned=false;throw Object.assign(new Error('SYNTHETIC_LOCK'),{code:'EPERM'});};
    try{state.cursor='forbidden';assert.throws(()=>state.save(),error=>error.code==='LOCK_LOST');}finally{fs.renameSync=rename;}
    assert.equal(attempts,1);assert.deepEqual(fs.readFileSync(file),before);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
