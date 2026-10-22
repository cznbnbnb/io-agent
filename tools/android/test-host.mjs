import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classFile} from '../../rebuild/android-app/host-107.mjs';
import {verifySnapshot} from './verify-source.mjs';

test('Resolve exact descriptors despite Windows case collisions and CRLF',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'io-agent-abi-'));
 const put=(name,descriptor)=>{const file=path.join(root,'smali_classes2',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'.class public final '+descriptor+'\r\n.super Ljava/lang/Object;\r\n');return file;};
 try{
  put('Y3/U.smali','LY3/U;');const expected=put('Y3/u.1.smali','LY3/u;');
  put('J4/h.smali','LJ4/h;');const other=put('j4.1/h.1.smali','Lj4/h;');
  assert.equal(classFile(root,'LY3/u;'),expected);assert.equal(classFile(root,'Lj4/h;'),other);
  assert.throws(()=>classFile(root,'LY3/unknown;'),/got 0/);
  put('Y3/u.2.smali','LY3/u;');assert.throws(()=>classFile(root,'LY3/u;'),/got 2/);
  assert.throws(()=>classFile(root,'L../../private;'),/Invalid class/);
 }finally{
  if(!root.startsWith(path.join(os.tmpdir(),'io-agent-abi-')))throw new Error('Unexpected temporary path');
  fs.rmSync(root,{recursive:true});
 }
});
test('All pinned upstream source files are unchanged',()=>{
 assert.equal(verifySnapshot(path.resolve('rebuild/android-app')),237);
});
