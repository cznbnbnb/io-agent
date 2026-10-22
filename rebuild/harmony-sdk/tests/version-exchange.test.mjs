import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './load-core.mjs';
const {androidVersionRequest:request,androidVersionReply:reply}=loadCore('./AndroidVersionExchange');
const {encodeTlvs:encode,decodeTlvs:decode}=loadCore('./ProtocolCodec');
const text=s=>new TextEncoder().encode(s);
const input=()=>({phoneIdentifier:Uint8Array.of(0,17,34,51,68,85),phoneNameUTF8:text('Turbo'),manufacturerUTF8:text('Test'),modelUTF8:text('Native'),accountUTF8:null,publicKey:null,pairValue:null});
const wrap=fields=>encode([{tag:0x11,value:encode(fields)}]);
const base=()=>[{tag:0x10,value:Uint8Array.of(1)},{tag:0x11,value:Uint8Array.of(170,187,204,221,238,255)}];
test('Android version request exact synthetic wire vector, type 2 and tag ordering',()=>{
 assert.equal(Buffer.from(request(input())).toString('hex'),'11002910000101110006001122334455120005547572626f13000102160004546573741700064e6174697665');
 const fields=decode(decode(request({...input(),pairValue:2}))[0].value);
 assert.deepEqual(Array.from(fields,f=>f.tag),[0x10,0x11,0x12,0x13,0x16,0x17,0x1b]);
 assert.deepEqual(fields.at(-1).value,Uint8Array.of(2));
});
test('account/public-key branch explicit and isolated from guest',()=>{
 const key=new Uint8Array(65);key[0]=4;
 const fields=decode(decode(request({...input(),accountUTF8:text('synthetic'),publicKey:key,pairValue:1}))[0].value);
 assert.deepEqual(Array.from(fields,f=>f.tag),[16,17,18,19,22,23,26,25,27]);
 for(const patch of [{accountUTF8:text('x')},{publicKey:key},{accountUTF8:new Uint8Array(),publicKey:key},{accountUTF8:text('x'),publicKey:new Uint8Array(65)}])assert.throws(()=>request({...input(),...patch}));
});
test('request field lengths and pair values bounded',()=>{
 for(const patch of [{phoneIdentifier:new Uint8Array(5)},{phoneNameUTF8:new Uint8Array(249)},{manufacturerUTF8:new Uint8Array(129)},{modelUTF8:new Uint8Array(129)},{pairValue:0},{pairValue:3},{pairValue:NaN}])assert.throws(()=>request({...input(),...patch}));
});
test('reply retains unknown fields and returns independent field copies',()=>{
 const payload=wrap([...base(),{tag:0x18,value:text('firmware-test')}]);const parsed=reply(payload);
 assert.equal(parsed.protocolVersion,1);assert.equal(parsed.peerIdentifier.length,6);
 const value=parsed.field(0x18);value.fill(0);payload.fill(0);
 assert.equal(Buffer.from(parsed.field(0x18)).toString(),'firmware-test');assert.equal(parsed.field(0xff),null);
});
test('reply rejects missing/duplicate/wrong-width and malformed fields',()=>{
 for(const fields of [[],base().slice(1),[base()[0]], [...base(),base()[0]], [...base(),{tag:0x13,value:new Uint8Array(2)}], [...base(),{tag:0x19,value:new Uint8Array(65)}], [{tag:0x10,value:new Uint8Array(2)},base()[1]], [base()[0],{tag:0x11,value:new Uint8Array(5)}]])assert.throws(()=>reply(wrap(fields)));
 assert.throws(()=>reply(Uint8Array.of(0x11,0,4,0)));assert.throws(()=>reply(encode([{tag:0x18,value:encode(base())}])));
});
test('reply limits frame size, field count and individual field size',()=>{
 assert.throws(()=>reply(new Uint8Array(4097)));
 assert.throws(()=>reply(wrap([...base(),{tag:0x20,value:new Uint8Array(1025)}])));
 assert.throws(()=>reply(wrap([...base(),...Array.from({length:31},(_,i)=>({tag:0x30+i,value:new Uint8Array()}))])));
});
