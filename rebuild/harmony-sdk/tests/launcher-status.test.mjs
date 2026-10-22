import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './load-core.mjs';
const {generalStatusQuery,isGeneralStatusQuery,readLauncherEnvelope}=loadCore('./LauncherStatus');
test('general status query reproduces V1 protobuf envelope and finite read-only JSON',()=>{
 const q=generalStatusQuery(),e=readLauncherEnvelope(q);assert.equal(e.type,1);assert.deepEqual(JSON.parse(new TextDecoder().decode(e.json)),{cmd:'request_general_status',payload:{data:'',mode:0,value:0}});assert(isGeneralStatusQuery(q));q[8]^=1;assert(!isGeneralStatusQuery(q));
});
test('launcher parser handles multibyte length and rejects duplicate and truncated input',()=>{
 const payload=new TextEncoder().encode(JSON.stringify({battery:42,detail:'a'.repeat(160)}));const p=Uint8Array.from([8,1,16,1,26,(payload.length&127)|128,payload.length>>7,...payload]);assert.equal(readLauncherEnvelope(p).json.length,payload.length);
 assert.throws(()=>readLauncherEnvelope(p.slice(0,-1)));assert.throws(()=>readLauncherEnvelope(Uint8Array.of(16,1,16,2)));assert.throws(()=>readLauncherEnvelope(Uint8Array.of(26,0,26,0)));assert.throws(()=>readLauncherEnvelope(Uint8Array.of(15)));
});
