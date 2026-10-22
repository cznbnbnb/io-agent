import test from 'node:test';import assert from 'node:assert/strict';import {loadCore} from './load-core.mjs';
const core=loadCore('./FirmwareOta'),{FirmwareOtaSession,OtaCoverage,otaMessage,readOtaMessage,isOtaOutbound}=core;
const enc=s=>new TextEncoder().encode(s),packet=(type,body={},binary=new Uint8Array())=>otaMessage(type,enc(JSON.stringify(body)),binary);
const files=()=>Array.from({length:15},(_,i)=>({name:i===0?'nuttx_ap.bin':`file${i}.bin`,size:i===0?7208648:16,sha256:'a'.repeat(64),md5:'b'.repeat(32)}));
function prepared(){const s=new FirmwareOtaSession();assert.equal(s.prepare('peer',3,files(),JSON.stringify(files()),1000).type,1);return s;}
function ready(){const s=prepared();assert.equal(s.receive('peer',3,packet(1,{OsVersion:'Strix OS 1.0.5.5',OtaValidationState:'idle',OtaValidationConfirmed:true,PackageTypes:['files']}),1100).type,2);assert.equal(s.receive('peer',3,packet(2,{BatteryLevel:93}),1200).type,3);assert.equal(s.receive('peer',3,packet(3,{Result:true}),1300).type,11);s.receive('peer',3,packet(11,{Result:true}),1400);assert.equal(s.phase,'ready');return s;}
function transferring(){const s=ready();assert.equal(s.start('peer',3,1500).type,4);s.receive('peer',3,packet(4,{Result:true}),1600);assert.equal(s.receive('peer',3,packet(5),1700).type,5);assert.equal(s.receive('peer',3,packet(6,{OtaVersion:'Strix OS 1.0.5.5'}),1800).type,6);assert.equal(s.phase,'transfer');return s;}
test('read-only protocol policy rejects every start/data form without exclusive lease',()=>{
 for(const type of [1,2,11])assert.equal(isOtaOutbound(packet(type),false),true);
 assert.equal(isOtaOutbound(packet(3,{OtaSize:8735334}),false),true);
 for(const type of [4,5,6,7])assert.equal(isOtaOutbound(packet(type),false),false);
 assert.equal(isOtaOutbound(packet(4,{Mode:2}),true),true);assert.equal(isOtaOutbound(packet(4,{Mode:1}),true),false);
 assert.equal(isOtaOutbound(packet(1,{Mode:2}),false),false);assert.equal(isOtaOutbound(packet(3,{OtaSize:999}),true),false);
});
test('protobuf duplicates, overflow, unsupported flags and excess data fail closed',()=>{
 const good=packet(1);assert.equal(readOtaMessage(good).type,1);assert.equal(readOtaMessage(packet(255)).type,255);
 for(const raw of [Uint8Array.from([...good,16,1]),Uint8Array.from([...good,40,1]),Uint8Array.from([8,1,16,1,26,255,255,255,255,255]),new Uint8Array(53000)])assert.throws(()=>readOtaMessage(raw));
 assert.throws(()=>otaMessage(7,enc('{}'),new Uint8Array(51201)));
});
test('prepare binds exact package layout and rejects wrong AP/duplicate or unsafe filenames',()=>{
 for(const list of [files().slice(1),files().map(f=>({...f,name:'same'})),files().map(f=>({...f,size:1})),files().map(f=>({...f,name:'../bad'}))])assert.throws(()=>new FirmwareOtaSession().prepare('peer',3,list,'[]',1000));
});
test('wrong OS and unconfirmed boot cannot progress from read-only preparation',()=>{
 for(const body of [{OsVersion:'1.0.4.12',OtaValidationState:'idle',OtaValidationConfirmed:true,PackageTypes:['files']},{OsVersion:'Strix OS 1.0.5.5',OtaValidationState:'installing',OtaValidationConfirmed:true,PackageTypes:['files']},{OsVersion:'Strix OS 1.0.5.5',OtaValidationState:'idle',OtaValidationConfirmed:false,PackageTypes:['files']}]){const s=prepared();assert.equal(s.receive('peer',3,packet(1,body),1100),undefined);assert.equal(s.phase,'failed');assert.equal(s.started,false);}
});
test('start is single use, tied to peer/generation and fresh complete preflight',()=>{
 const s=ready();assert.throws(()=>s.start('other',3,1500));assert.equal(s.started,false);
 const expired=ready();assert.throws(()=>expired.start('peer',3,122000));assert.equal(expired.started,false);
 const live=ready();live.start('peer',3,1500);assert.throws(()=>live.start('peer',3,1501));assert.equal(live.started,true);
});
test('timeouts before start fail; after start become unknown with no restart action',()=>{
 const before=prepared();before.check('peer',3,17000);assert.equal(before.phase,'failed');
 const after=transferring();after.check('peer',3,65000);assert.equal(after.phase,'unknown');assert.equal(after.receive('peer',3,packet(5),65001),undefined);assert.throws(()=>after.start('peer',3,65002));
});
test('device failure is recorded explicitly without an automatic reply or restart',()=>{
 const s=transferring();assert.equal(s.receive('peer',3,packet(10,{errcode:8}),2000),undefined);assert.equal(s.phase,'unknown');assert.equal(s.reason,'OTA_DEVICE_ERROR_8');assert.equal(s.requests,0);assert.throws(()=>s.start('peer',3,2100));
});
test('duplicate and overlapping device slice requests do not inflate successful coverage',()=>{
 const c=new OtaCoverage();for(const [a,b] of [[5,10],[0,6],[0,10],[8,16],[20,25],[16,20]])c.add(a,b);assert.equal(c.bytes,25);assert.equal(c.ranges.length,1);
 const s=transferring();for(let i=0;i<2;i++){const a=s.receive('peer',3,packet(7,{Name:'nuttx_ap.bin',Start:0,Size:51200}),1900+i);assert.equal(s.coverage.size,0+i);s.sent(a);}assert.equal(s.coverage.get('nuttx_ap.bin').bytes,51200);
});
test('progress notification between slice requests does not fail the transfer',()=>{
 const s=transferring();const a=s.receive('peer',3,packet(7,{Name:'nuttx_ap.bin',Start:0,Size:51200}),1900);assert.equal(a.type,7);s.sent(a);
 assert.equal(s.receive('peer',3,packet(8,{Progress:1}),1901),undefined);assert.equal(s.phase,'transfer');assert.equal(s.progress,1);
 const b=s.receive('peer',3,packet(7,{Name:'nuttx_ap.bin',Start:51200,Size:51200}),1902);assert.equal(b.type,7);
});
test('unknown file, overflow range, zero/oversized slice and unsolicited reply hold unknown',()=>{
 for(const body of [{Name:'../x',Start:0,Size:1},{Name:'nuttx_ap.bin',Start:7208647,Size:2},{Name:'nuttx_ap.bin',Start:0,Size:0},{Name:'nuttx_ap.bin',Start:0,Size:51201}]){const s=transferring();assert.equal(s.receive('peer',3,packet(7,body),1900),undefined);assert.equal(s.phase,'unknown');assert.equal(s.requests,0);}
});
test('installation is distinct from transfer and only accepted after committed AP coverage',()=>{
 const early=transferring();early.receive('peer',3,packet(9),1900);assert.equal(early.phase,'unknown');
 const s=transferring();for(let at=0;at<7208648;at+=51200){const action=s.receive('peer',3,packet(7,{Name:'nuttx_ap.bin',Start:at,Size:Math.min(51200,7208648-at)}),1900+at/51200);s.sent(action);}
 assert.equal(s.coverage.get('nuttx_ap.bin').bytes,7208648);s.receive('peer',3,packet(9),3000);assert.equal(s.phase,'installing');assert.equal(s.installSeenAt,3000);
 s.check('',0,4000);assert.equal(s.phase,'installing');assert.throws(()=>s.readback('other',5,130000));
 assert.equal(s.readback('peer',5,130000).type,1);assert.equal(s.receive('peer',5,packet(1,{OsVersion:'Strix OS 1.0.5.5',OtaValidationState:'idle',OtaValidationConfirmed:true,PackageTypes:['files']}),130001).type,11);s.receive('peer',5,packet(11,{Result:true}),130002);assert.equal(s.phase,'readback_ready');
});
