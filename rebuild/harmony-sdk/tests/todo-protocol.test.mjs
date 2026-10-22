import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';
import {loadCore} from './load-core.mjs';
const kit={util:{TextEncoder:class{encodeInto(text){return new TextEncoder().encode(text);}},TextDecoder:class{constructor(name='utf-8',options={}){this.decoder=new TextDecoder(name,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}}};
const p=loadApp('TodoProtocol',{'@kit.ArkTS':kit});
const {businessEnvelope}=loadCore('./BusinessCommands');
const enc=text=>new TextEncoder().encode(text);
const packet=(type,body,binary=[])=>{
 const text=enc(typeof body==='string'?body:JSON.stringify(body));let prefix;
 if(text.length<=7500)prefix=businessEnvelope(type,text);
 else { // Inbound reader allows larger fields than the outbound command writer.
  const n=text.length,variable=n<128?[n]:[n%128|128,Math.floor(n/128)];prefix=Uint8Array.from([8,1,16,type,26,...variable,...text]);
 }
 return Uint8Array.from([...prefix,...(binary.length?[34,binary.length,...binary]:[])]);
};
const item=(id,type=1)=>({eventType:type,eventID:id,status:0,createTime:1792111200,lastModifiedTime:1792111201,isImportant:false,title:'合成待办，不发送眼镜',offlineCompletedModifiedTime:null});
const batch=(no,ids,last=false,patch={})=>({scheduleTotal:0,todoTotal:2,batchNo:no,isLastBatch:last,needFullData:true,
 chunkInfo:{chunkId:12,batchNo:no,isLastBatch:last,currentItems:ids.length},dataList:ids.map(id=>item(id)),offlineCompletedModifiedTime:null,...patch});
const parse=value=>p.parseTodoQueryBatch(packet(16,value));
const json=value=>JSON.parse(JSON.stringify(value));

test('the observed empty chunk object normalizes to absent, while partial chunks still fail closed',()=>{
 const value=batch(0,[10],true,{todoTotal:1,chunkInfo:{}}),parsed=parse(value);
 assert.equal(parsed.chunkInfo,null);
 assert.equal(new p.TodoQueryAccumulator(true).add(parsed).phase,'complete');
 for(const chunkInfo of [{chunkId:null},{batchNo:0},{chunkId:null,batchNo:null,isLastBatch:null,currentItems:null}]){
  assert.equal(new p.TodoQueryAccumulator(true).add(parse({...value,chunkInfo})).phase,'incomplete');
 }
});

test('query rejection shape exposes only bounded field names and types, never values',()=>{
 const value=batch(0,[777777777],true,{todoTotal:1,firmwareShape:42});
 value.dataList[0].title='PRIVATE-SPEECH-123456';value.dataList[0].createTime=1234567890123;
 const bytes=packet(16,value),before=bytes.slice(),note=p.describeTodoQueryBatch(bytes);
 assert.equal(p.parseTodoQueryBatch(bytes),null);assert.match(note,/root=/);assert.match(note,/firmwareShape:n/);assert.match(note,/row=/);
 for(const secret of ['777777777','PRIVATE-SPEECH-123456','1234567890123'])assert.equal(note.includes(secret),false);
 assert(note.length<=480);assert.deepEqual(bytes,before);
});
test('query shape is bounded and rejects malformed envelopes without copying key control text',()=>{
 const value=batch(0,[1]);value['bad\nfield']='PRIVATE';value.dataList[0].title='PRIVATE';
 for(let i=0;i<100;i++)value['oversizedField'+i]=i;
 const note=p.describeTodoQueryBatch(packet(16,value));assert(note.length<=480);assert(!note.includes('bad\nfield'));assert(!note.includes('PRIVATE'));
 assert.match(p.describeTodoQueryBatch(Uint8Array.from([0xff])),/envelope/);
});

test('top-level batches without chunkInfo retain order and count checks',()=>{
 const a=new p.TodoQueryAccumulator();
 const first=batch(0,[10]);delete first.chunkInfo;
 assert.equal(a.add(parse(first)).phase,'collecting');
 const last=batch(1,[20],true);delete last.chunkInfo;
 const result=a.add(parse(last));assert.equal(result.phase,'complete');assert.deepEqual(json(result.todo_ids),[10,20]);
 for(const value of [batch(0,[10],true),batch(0,[],true)]){
  delete value.chunkInfo;
  assert.equal(new p.TodoQueryAccumulator().add(parse(value)).phase,'incomplete','a terminal flag alone cannot replace the exact item count');
 }
});
test('todo-filtered batch totals do not claim the unrelated schedule catalogue was returned',()=>{
 const value=batch(0,[10],true,{todoTotal:1,scheduleTotal:3});delete value.chunkInfo;
 const only=new p.TodoQueryAccumulator(true).add(parse(value));assert.equal(only.phase,'complete');assert.deepEqual(json(only.todo_ids),[10]);assert.equal(only.schedule_total,3);
 assert.equal(new p.TodoQueryAccumulator().add(parse(value)).phase,'incomplete','all-events mode still requires schedule rows');
 const unrelated=batch(0,[10],true,{todoTotal:0,scheduleTotal:1,dataList:[item(10,0)]});delete unrelated.chunkInfo;
 assert.equal(new p.TodoQueryAccumulator(true).add(parse(unrelated)).phase,'incomplete','todo-only queries cannot silently count schedule records');
});
test('optional chunkInfo never permits a missing top-level field, a partial chunk or mixed profiles',()=>{
 for(const key of ['scheduleTotal','todoTotal','batchNo','isLastBatch','needFullData','dataList']){
  const value=batch(0,[10],true,{todoTotal:1});delete value.chunkInfo;delete value[key];
  assert.equal(new p.TodoQueryAccumulator(true).add(parse(value)).phase,'incomplete');
 }
 const partial=batch(0,[10],true,{todoTotal:1});delete partial.chunkInfo.currentItems;
 assert.equal(new p.TodoQueryAccumulator(true).add(parse(partial)).phase,'incomplete');
 for(const beginsWithChunk of [true,false]){
  const a=new p.TodoQueryAccumulator(true),first=batch(0,[10]),last=batch(1,[20],true);
  if(!beginsWithChunk)delete first.chunkInfo;else delete last.chunkInfo;
  assert.equal(a.add(parse(first)).phase,'collecting');assert.equal(a.add(parse(last)).phase,'incomplete');assert.deepEqual(json(a.snapshot().todo_ids),[]);
 }
});

test('actual type14 receipt parser returns bounded observation metadata and does not mutate wire bytes',()=>{
 const bytes=packet(14,{sourceType:7,successCount:1,chunkId:0,scheduleTotal:0,todoTotal:1,failList:[]}),before=bytes.slice();
 const r=p.parseTodoDeleteReceipt(bytes);assert(r);assert.equal(r.sourceType,7);assert.equal(r.successCount,1);assert.deepEqual(json(r.failList),[]);
 assert.equal(Object.hasOwn(r,'confirmed'),false);assert.equal(Object.hasOwn(r,'deleted_id'),false);assert.deepEqual(bytes,before);
 const other=p.parseTodoDeleteReceipt(packet(14,{sourceType:2,successCount:0,failList:[{eventID:7,errorCode:2,errorMessage:'合成拒绝'}]}));
 assert(other);assert.equal(other.sourceType,2);assert.equal(other.failList[0].eventID,7);
});
test('receipt optional fields remain null and cannot manufacture any successful ID',()=>{
 const r=p.parseTodoDeleteReceipt(packet(14,{sourceType:7,successCount:1}));assert(r);assert.equal(r.chunkId,null);assert.equal(r.failList,null);
 assert.deepEqual(Object.keys(r).sort(),['chunkId','failList','scheduleTotal','sourceType','successCount','todoTotal'].sort());
});
for(const [name,body] of [
 ['missing required',{sourceType:7}],['string source',{sourceType:'7',successCount:1}],['negative success',{sourceType:7,successCount:-1}],
 ['fraction count',{sourceType:7,successCount:0.5}],['count cap',{sourceType:7,successCount:401}],['unknown',{sourceType:7,successCount:1,confirmed:true}],
 ['unknown failure',{sourceType:7,successCount:0,failList:[{eventID:7,deleted:true}]}],['duplicate failure',{sourceType:7,successCount:0,failList:[{eventID:7},{eventID:7}]}],
 ['invalid ID',{sourceType:7,successCount:0,failList:[{eventID:0}]}],['invalid message',{sourceType:7,successCount:0,failList:[{errorMessage:'\ud800'}]}],
 ['negative unproved vendor code',{sourceType:7,successCount:0,failList:[{eventID:7,errorCode:-1}]}],
 ['oversized error code',{sourceType:7,successCount:0,failList:[{eventID:7,errorCode:2147483648}]}],
 ['duplicate spelling','{"sourceType":2,"sourceType":7,"successCount":1}'],['escaped duplicate','{"sourceType":2,"source\\u0054ype":7,"successCount":1}']
])test(`receipt rejects ${name}`,()=>assert.equal(p.parseTodoDeleteReceipt(packet(14,body)),null));

test('wrong type, binary, malformed protobuf and fatal-invalid UTF8 cannot enter either parser',()=>{
 for(const read of [p.parseTodoDeleteReceipt,p.parseTodoQueryBatch]){
  assert.equal(read(packet(4,{sourceType:7,successCount:1})),null);assert.equal(read(Uint8Array.of(26,255)),null);
  assert.equal(read(packet(read===p.parseTodoDeleteReceipt?14:16,{},[1])),null);
 }
 const malformed=Uint8Array.from([...enc('{"sourceType":7,"successCount":1,"failList":[{"errorMessage":"'),0xff,...enc('"}]}')]);
 assert.equal(p.parseTodoDeleteReceipt(businessEnvelope(14,malformed)),null);
 const permissive=loadApp('TodoProtocol',{'@kit.ArkTS':{util:{...kit.util,TextDecoder:class{decodeToString(bytes){return new TextDecoder().decode(bytes);}}}}});
 assert.equal(permissive.parseTodoDeleteReceipt(businessEnvelope(14,malformed)),null,'roundtrip check must still reject replacement-decoded input');
});
test('known nullable query metadata parses but missing completeness fields never produces an absence observation',()=>{
 for(const value of [{},{dataList:[]},{scheduleTotal:0,todoTotal:0,isLastBatch:true,dataList:[]},batch(0,[],true,{chunkInfo:null})]){
  const parsed=parse(value);assert(parsed);const a=new p.TodoQueryAccumulator(),r=a.add(parsed);assert.equal(r.phase,'incomplete');assert.deepEqual(json(r.todo_ids),[]);
 }
});
test('complete two-batch query exposes exact TODO IDs as one observation, never device confirmation',()=>{
 const a=new p.TodoQueryAccumulator(),one=parse(batch(0,[10]));assert(one);
 let r=a.add(one);assert.equal(r.phase,'collecting');assert.equal(r.batches,1);assert.equal(r.items,1);assert.deepEqual(json(r.todo_ids),[]);
 r=a.add(parse(batch(1,[20],true)));assert.equal(r.phase,'complete');assert.deepEqual(json(r.todo_ids),[10,20]);assert.equal(r.todo_total,2);assert.equal(r.schedule_total,0);
 assert.match(r.note,/不等于设备已确认删除/);assert.equal(Object.hasOwn(r,'deleted_ids'),false);
 r.todo_ids.push(99);assert.deepEqual(json(a.snapshot().todo_ids),[10,20]);
});
test('one-based contiguous numbering and complete empty dataset are explicitly bounded observations',()=>{
 const a=new p.TodoQueryAccumulator();a.add(parse(batch(1,[1])));assert.equal(a.add(parse(batch(2,[2],true))).phase,'complete');
 const empty=new p.TodoQueryAccumulator().add(parse(batch(0,[],true,{todoTotal:0})));assert.equal(empty.phase,'complete');assert.deepEqual(json(empty.todo_ids),[]);assert.match(empty.note,/观察/);
});
test('mixed all-query counts distinguish schedules from TODO IDs and support same numeric ID in separate types',()=>{
 const value=batch(0,[7],true,{todoTotal:1,scheduleTotal:1,dataList:[item(7,0),item(7,1)],chunkInfo:{chunkId:12,batchNo:0,isLastBatch:true,currentItems:2}});
 const r=new p.TodoQueryAccumulator().add(parse(value));assert.equal(r.phase,'complete');assert.equal(r.items,2);assert.deepEqual(json(r.todo_ids),[7]);
});
test('identical batch retry is ignored while conflicting duplicate is permanently incomplete',()=>{
 const a=new p.TodoQueryAccumulator(),first=parse(batch(0,[1]));a.add(first);let r=a.add(parse(batch(0,[1])));assert.equal(r.batches,1);assert.equal(r.phase,'collecting');
 const conflict=batch(0,[1]);conflict.dataList[0].title='另一份';r=a.add(parse(conflict));assert.equal(r.phase,'incomplete');assert.deepEqual(json(r.todo_ids),[]);
 assert.equal(a.add(parse(batch(1,[2],true))).phase,'incomplete');
});
test('late exact duplicate preserves completed observation but any extra new batch invalidates it',()=>{
 const a=new p.TodoQueryAccumulator();a.add(parse(batch(0,[1])));a.add(parse(batch(1,[2],true)));
 assert.equal(a.add(parse(batch(0,[1]))).phase,'complete');assert.equal(a.add(parse(batch(2,[],true))).phase,'incomplete');assert.deepEqual(json(a.snapshot().todo_ids),[]);
});
test('input mutation after add never changes frozen duplicate matching or accumulated IDs',()=>{
 const a=new p.TodoQueryAccumulator(),first=parse(batch(0,[1]));a.add(first);first.dataList[0].eventID=77;first.todoTotal=1;
 assert.equal(a.add(parse(batch(0,[1]))).phase,'collecting');assert.deepEqual(json(a.add(parse(batch(1,[2],true))).todo_ids),[1,2]);
});
for(const [name,mutate] of [
 ['gap',v=>{v.batchNo=2;v.chunkInfo.batchNo=2;}],['reversed origin',v=>{v.batchNo=3;v.chunkInfo.batchNo=3;}],
 ['changed chunk',v=>v.chunkInfo.chunkId=13],['changed total',v=>v.todoTotal=3],['partial query',v=>v.needFullData=false],
 ['top chunk mismatch',v=>v.chunkInfo.batchNo=4],['terminal mismatch',v=>v.chunkInfo.isLastBatch=false],
 ['row count mismatch',v=>v.chunkInfo.currentItems=0],['missing chunk number',v=>delete v.chunkInfo.batchNo],
 ['missing metadata',v=>delete v.todoTotal],['duplicate item',v=>v.dataList[0].eventID=1],
 ['terminal count short',v=>v.dataList=[]],
])test(`query aggregation rejects ${name} without exposing incomplete IDs`,()=>{
 const a=new p.TodoQueryAccumulator();a.add(parse(batch(0,[1])));const next=batch(1,[2],true);mutate(next);
 const r=a.add(parse(next));assert.equal(r.phase,'incomplete');assert.deepEqual(json(r.todo_ids),[]);
});
test('first batch must begin at 0 or 1 and duplicate rows are never counted as extra results',()=>{
 assert.equal(new p.TodoQueryAccumulator().add(parse(batch(5,[1]))).phase,'incomplete');
 const b=batch(0,[1,1],true);assert.equal(new p.TodoQueryAccumulator().add(parse(b)).phase,'incomplete');
 assert.equal(new p.TodoQueryAccumulator().add(parse(batch(0,[1,2],true,{todoTotal:1}))).phase,'incomplete');
});
for(const [name,mutate] of [
 ['top unknown',v=>v.deleted=true],['chunk unknown',v=>v.chunkInfo.total=1],['row unknown',v=>v.dataList[0].agent='x'],
 ['ID zero',v=>v.dataList[0].eventID=0],['ID unsafe',v=>v.dataList[0].eventID=Number.MAX_SAFE_INTEGER+1],
 ['type unknown',v=>v.dataList[0].eventType=2],['status unknown',v=>v.dataList[0].status=2],
 ['boolean count',v=>v.todoTotal=true],['string terminal',v=>v.isLastBatch='true'],['oversized title',v=>v.dataList[0].title='字'.repeat(1025)],
 ['lone surrogate',v=>v.dataList[0].title='\udc00'],['array object',v=>v.chunkInfo=[]],['important unknown',v=>v.dataList[0].isImportant=2],
])test(`query parser rejects ${name}`,()=>{const value=batch(0,[1]);mutate(value);assert.equal(parse(value),null);});
test('parser retains both known int0/1 and bool importance forms without truthy coercion',()=>{
 for(const value of [0,1,false,true,null]){const b=batch(0,[1]);b.dataList[0].isImportant=value;assert.equal(parse(b).dataList[0].isImportant,value);}
 const bad=batch(0,[1]);bad.dataList[0].isImportant='1';assert.equal(parse(bad),null);
});
test('duplicate keys at nested depth and escaped aliases are rejected, quoted value text is not mistaken for a key',()=>{
 const raw=JSON.stringify(batch(0,[1])).replace('"eventID":1','"eventID":2,"eventID":1');assert.equal(parse(raw),null);
 const b=batch(0,[1]);b.dataList[0].title='包含引号文本："eventID":7, {x}';assert.equal(parse(b).dataList[0].title,b.dataList[0].title);
 const escaped=JSON.stringify(batch(0,[1])).replace('"batchNo":0','"batchNo":1,"batch\\u004eo":0');assert.equal(parse(escaped),null);
});
test('timeout and disconnect invalidate an otherwise complete observation without leaking a caller reason',()=>{
 for(const reason of ['timeout','disconnected','secret-token/url']){
  const a=new p.TodoQueryAccumulator();a.add(parse(batch(0,[],true,{todoTotal:0})));const r=a.invalidate(reason);
  assert.equal(r.phase,'incomplete');assert.deepEqual(json(r.todo_ids),[]);assert.equal(r.note.includes('secret-token'),false);
 }
});
test('64-batch cap and normalized retained-byte budget fail closed without creating unbounded state',()=>{
 const a=new p.TodoQueryAccumulator();for(let i=0;i<64;i++)assert.equal(a.add(parse(batch(i,[],false,{todoTotal:0}))).phase,'collecting');
 assert.equal(a.add(parse(batch(64,[],true,{todoTotal:0}))).phase,'incomplete');
 const b=new p.TodoQueryBatch();b.scheduleTotal=0;b.todoTotal=200;b.batchNo=0;b.isLastBatch=false;b.needFullData=true;
 b.chunkInfo=new p.TodoQueryChunk();Object.assign(b.chunkInfo,{chunkId:1,batchNo:0,isLastBatch:false,currentItems:100});
 b.dataList=Array.from({length:100},(_,i)=>({...item(i+1),title:'字'.repeat(1024)}));
 assert.equal(new p.TodoQueryAccumulator().add(b).phase,'incomplete');
});
test('wire, array, total and DTO injection limits cannot synthesize complete missing-ID evidence',()=>{
 const b=batch(0,[],true,{todoTotal:201});assert.equal(parse(b),null);
 const tooMany=batch(0,[],true,{dataList:Array.from({length:401},(_,i)=>({eventType:1,eventID:i+1}))});assert.equal(parse(tooMany),null);
 const injected=parse(batch(0,[1],true,{todoTotal:1}));injected.deleted_ids=[7];assert.equal(new p.TodoQueryAccumulator().add(injected).phase,'incomplete');
 assert.equal(new p.TodoQueryAccumulator().add(null).phase,'incomplete');
});
