import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadCore} from './load-core.mjs';
function setup(bad=false){
 const cryptoFramework={createMd:()=>{let bytes;return {
  updateSync:input=>{bytes=input.data;},digestSync:()=>({data:bad?new Uint8Array(32):Uint8Array.from(createHash('sha256').update(bytes).digest())})
 };}};
 return loadCore('./ProtocolSelfTest',{'@kit.CryptoArchitectureKit':{cryptoFramework}});
}
test('the App offline self-test exercises five checks without a radio module',()=>{
 const report=setup().runProtocolSelfTest();assert.equal(report.passed,5);assert.equal(report.total,5);
 assert(report.lines.every(s=>s.endsWith('通过')));
});
test('incorrect native hash fails only the cryptographic self-test, never pretends success',()=>{
 const report=setup(true).runProtocolSelfTest();assert.equal(report.passed,4);assert.equal(report.total,5);
 assert(report.lines.some(s=>s.includes('SHA-256')&&s.endsWith('失败')));
});
