import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setupMaterialStore} from './material-fixture.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const digest=value=>createHash('sha256').update(value).digest('hex');
function full(t,sourceOverride={}){
 const s=setupMaterialStore(t);Object.assign(s.source,sourceOverride);s.input.transcriptionState='complete';s.input.coveredMs=60000;s.input.sourceMs=60000;
 s.input.speakerProcessing='pending';s.input.boundaryProcessing='token_starts';
 s.input.utterances=[
  {...plain(s.input.utterances[0]),speaker_id:'segment-0',text:'第一句🙂，我负责记录。',start_ms:2000,end_ms:5000},
  {...plain(s.input.utterances[0]),speaker_id:'segment-1',text:'第二句\n保留原段落。',start_ms:5000,end_ms:9000},
  {...plain(s.input.utterances[0]),speaker_id:'segment-0',text:'第三句 *原样保留*。',start_ms:9000,end_ms:13000},
  {...plain(s.input.utterances[0]),speaker_id:'',speaker_basis:'unknown',text:'无法确认归属。',start_ms:13000,end_ms:14000},
 ];s.input.text='旧渲染全文';const initial=s.store.ensure(s.source),row=s.store.appendTranscript(initial.material_id,1,s.input,'finished-asr');
 return {...s,id:row.material_id,row};
}
function op(s,kind,data={},name='test-op-'+kind){const value=new s.MaterialSpeakerCorrection();Object.assign(value,{operation_id:name,kind},data);return value;}
function edit(s,row,kind,data={},name){return s.store.correctSpeakers(s.id,row.revision,op(s,kind,data,name));}
function revisionFile(s,n){return path.join(s.root,'materials',s.id,`revision-${String(n).padStart(9,'0')}.json`);}
function readRestart(s){const store=new s.MaterialStore();store.initialize(s.root);return store;}
function assertUser(old,next){assert.equal(next.revision,old.revision+1);assert.equal(next.text_revision,old.text_revision+1);
 assert.equal(next.user_edited,true);assert.equal(next.text_origin,'user');assert.equal(next.sync_state,'local');assert.equal(next.applied_job,'');
 assert.equal(next.speaker_processing,old.speaker_processing);assert.equal(next.transcription_state,old.transcription_state);
 assert.equal(next.covered_ms,old.covered_ms);assert.equal(next.transcription_source_ms,old.transcription_source_ms);assert.deepEqual(plain(next.source),plain(old.source));}

test('legacy anonymous labels are read-only; rename normalizes only the new material revision without confirming utterance identity',t=>{
 const s=full(t),before=fs.readFileSync(revisionFile(s,2));const labels=s.deriveMaterialSpeakers(s.row);
 assert.deepEqual(plain(labels).map(row=>[row.speaker_id,row.label,row.is_self]),[['segment-0','说话人 A',false],['segment-1','说话人 B',false]]);
 const next=edit(s,s.row,'rename',{speaker_id:'segment-0',label:'项目 *记录人*'});assertUser(s.row,next);
 const renamed=next.speakers.find(row=>row.label==='项目 *记录人*');assert.equal(renamed.label_basis,'user_confirmed');assert.equal(renamed.is_self,false);
 assert.match(renamed.speaker_id,new RegExp(`^${s.id}-s[a-f0-9]{20}$`));
 assert.equal(next.utterances[0].speaker_basis,'segment_cluster');assert.equal(next.utterances[2].speaker_basis,'segment_cluster');
 assert.equal(next.utterances[1].speaker_basis,'segment_cluster');assert.equal(next.utterances[3].speaker_basis,'unknown');
 assert.equal(next.text,s.renderMaterialTranscript(next));assert.ok(next.text.includes('项目 \\*记录人\\*'));assert.ok(next.text.includes('第二句\n保留原段落。'));
 assert.deepEqual(fs.readFileSync(revisionFile(s,2)),before);assert.equal(readRestart(s).read(s.id).speakers[0].label,'项目 *记录人*');
});

test('merge moves only source utterances, retaining stable IDs, original text, time and other speaker provenance',t=>{
 const s=full(t);const next=edit(s,s.row,'merge',{speaker_id:'segment-1',target_speaker_id:'segment-0'});assertUser(s.row,next);
 assert.equal(next.speakers.length,1);assert.equal(next.utterances[1].speaker_basis,'user');assert.equal(next.utterances[0].speaker_basis,'segment_cluster');
 assert.equal(next.utterances[1].speaker_id,next.utterances[0].speaker_id);
 for(let i=0;i<s.row.utterances.length;i++){const old=s.row.utterances[i],part=next.utterances[i];
  assert.equal(part.utterance_id,old.utterance_id);assert.equal(part.text,old.text);assert.equal(part.start_ms,old.start_ms);assert.equal(part.end_ms,old.end_ms);}
 assert.equal(s.store.read(s.id,2).utterances[1].speaker_id,'segment-1');
});

test('new-label assignment and reassignment are selected-utterance operations, isolated between two materials',t=>{
 const s=full(t),other=s.store.ensure({...s.source,name:'take-'+'b'.repeat(32)}),otherRow=s.store.appendTranscript(other.material_id,1,s.input,'other-asr');
 const selection=[s.row.utterances[1].utterance_id,s.row.utterances[3].utterance_id];
 const assigned=edit(s,s.row,'assign',{utterance_ids:selection,label:'仅本段的来访者'});assertUser(s.row,assigned);
 const newLabel=assigned.speakers.find(row=>row.label==='仅本段的来访者');assert.equal(newLabel.label_basis,'user_confirmed');assert.equal(newLabel.is_self,false);
 for(const index of [1,3]){assert.equal(assigned.utterances[index].speaker_id,newLabel.speaker_id);assert.equal(assigned.utterances[index].speaker_basis,'user');}
 assert.equal(assigned.utterances[0].speaker_basis,'segment_cluster');assert.equal(s.store.read(other.material_id).revision,otherRow.revision);
 assert.equal(s.store.read(other.material_id).utterances[1].speaker_id,'segment-1');
 const target=assigned.utterances[0].speaker_id;const moved=edit(s,assigned,'assign',{utterance_ids:[assigned.utterances[1].utterance_id],target_speaker_id:target},'reassign-selected');
 assert.equal(moved.utterances[1].speaker_id,target);assert.equal(moved.utterances[3].speaker_id,newLabel.speaker_id);
 assert.throws(()=>s.store.correctSpeakers(other.material_id,2,op(s,'assign',{utterance_ids:[otherRow.utterances[0].utterance_id],target_speaker_id:newLabel.speaker_id},'foreign-scope-op')),/SPEAKER_NOT_FOUND/);
});

test('unknown attribution is explicit; marking self requires a user action and replaces at most one existing self',t=>{
 const s=full(t),named=edit(s,s.row,'rename',{speaker_id:'segment-0',label:'我'});assert.equal(named.speakers[0].is_self,false,'a name is not self verification');
 const first=edit(s,named,'self',{speaker_id:named.speakers[0].speaker_id},'mark-self-first');assert.equal(first.speakers[0].is_self,true);
 assert.equal(first.utterances[0].speaker_basis,'segment_cluster','self label does not claim a human reassigned every clustered utterance');
 const second=edit(s,first,'self',{speaker_id:first.speakers[1].speaker_id,label:'本人'},'mark-self-second');assert.equal(second.speakers.filter(row=>row.is_self).length,1);
 assert.equal(second.speakers[0].is_self,false);assert.equal(second.speakers[1].is_self,true);assert.equal(second.speakers[1].label_basis,'user_confirmed');
 const unknown=edit(s,second,'unknown',{utterance_ids:[second.utterances[1].utterance_id]},'clear-one-attribution');
 assert.equal(unknown.utterances[1].speaker_id,'');assert.equal(unknown.utterances[1].speaker_basis,'unknown');assert.equal(unknown.utterances[1].text,second.utterances[1].text);
 assert.ok(unknown.text.includes('未确定'));assertUser(second,unknown);
});

test('split uses exact UTF-16 parent ranges and unknown child timing rather than a fabricated duration ratio',t=>{
 const s=full(t),parent=s.row.utterances[0],offset=parent.text.indexOf('，');
 const emoji=parent.text.indexOf('🙂');assert.throws(()=>edit(s,s.row,'split',{utterance_ids:[parent.utterance_id],split_offset:emoji+1},'bad-surrogate-split'),/SPLIT_OFFSET_INVALID/);
 const next=edit(s,s.row,'split',{utterance_ids:[parent.utterance_id],split_offset:offset},'split-with-provenance');assertUser(s.row,next);
 const [left,right]=next.utterances;assert.equal(left.text+right.text,parent.text);assert.equal(left.start_ms,null);assert.equal(left.end_ms,null);assert.equal(right.start_ms,null);
 assert.notEqual(left.utterance_id,right.utterance_id);assert.notEqual(left.utterance_id,parent.utterance_id);assert.equal(next.boundary_processing,'unknown');
 assert.deepEqual(plain(left.source_range),{parent_utterance_id:parent.utterance_id,parent_revision:2,start_ms:2000,end_ms:5000,text_start:0,text_end:offset});
 assert.equal(right.source_range.text_start,offset);assert.equal(right.source_range.text_end,parent.text.length);assert.ok(next.text.includes('句内时间未确定'));
 assert.equal(s.store.read(s.id,2).utterances[0].end_ms,5000);assert.equal(readRestart(s).read(s.id).utterances[0].start_ms,null);
 const repeated=edit(s,next,'split',{utterance_ids:[right.utterance_id],split_offset:2},'nested-split-operation');
 assert.equal(repeated.utterances[1].source_range.parent_revision,3);assert.equal(repeated.utterances[1].source_range.parent_utterance_id,right.utterance_id);
 assert.equal(repeated.utterances[1].source_range.start_ms,2000);assert.equal(repeated.utterances.slice(0,3).map(row=>row.text).join(''),parent.text);
 assert.equal(readRestart(s).read(s.id).revision,4);
});

test('editing a split child keeps original source provenance and never rewrites the parent history',t=>{
 const s=full(t),split=edit(s,s.row,'split',{utterance_ids:[s.row.utterances[1].utterance_id],split_offset:3},'split-before-text');
 const child=split.utterances[1],next=edit(s,split,'text',{utterance_ids:[child.utterance_id],text:'人工补正文字'},'edit-split-text');
 assert.equal(next.utterances[1].utterance_id,child.utterance_id);assert.deepEqual(plain(next.utterances[1].source_range),plain(child.source_range));
 assert.equal(next.utterances[1].start_ms,null);assert.equal(next.boundary_processing,'unknown');assert.equal(s.store.read(s.id,3).utterances[1].text,child.text);
 assert.equal(readRestart(s).read(s.id).utterances[1].text,'人工补正文字');assertUser(split,next);
});

test('repeated split provenance reads each immutable parent once within a validation traversal, then rechecks later disk damage',t=>{
 const s=full(t);s.input.utterances[0].text='abcdefghijklmnopqrstuvwxyz0123456789';
 const otherSource={...s.source,name:'take-'+'c'.repeat(32)},first=s.store.ensure(otherSource),initial=s.store.appendTranscript(first.material_id,1,s.input,'long-parent-asr');
 s.id=initial.material_id;let row=initial;
 for(let count=0;count<12;count++)row=edit(s,row,'split',{utterance_ids:[row.utterances[count].utterance_id],split_offset:1},'iterative-split-'+String(count).padStart(3,'0'));
 let reads=0;const read=s.io.readTextSync;s.io.readTextSync=p=>{reads++;return read(p);};
 assert.equal(readRestart(s).read(s.id).revision,14);assert.ok(reads<=14,'one read per parent revision, rather than exponential recursive history scans');
 const historical=revisionFile(s,2),saved=fs.readFileSync(historical);fs.writeFileSync(historical,'{');assert.throws(()=>readRestart(s).read(s.id));
 fs.writeFileSync(historical,saved);assert.equal(readRestart(s).read(s.id).revision,14);
});

test('same operation replay survives cold restart and returns the original immutable commit after newer corrections',t=>{
 const s=full(t),operation=op(s,'rename',{speaker_id:'segment-0',label:'第一位'},'repeatable-rename-op');
 const first=s.store.correctSpeakers(s.id,2,operation),later=edit(s,first,'rename',{speaker_id:first.speakers[0].speaker_id,label:'新名字'},'later-rename-operation');
 const restarted=readRestart(s),replayed=restarted.correctSpeakers(s.id,2,operation);
 assert.equal(replayed.revision,first.revision);assert.equal(replayed.speakers[0].label,'第一位');assert.equal(restarted.read(s.id).revision,later.revision);
 assert.throws(()=>restarted.correctSpeakers(s.id,2,{...operation,label:'换内容'}),/SPEAKER_OPERATION_CONFLICT/);
 assert.throws(()=>restarted.correctSpeakers(s.id,3,operation),/SPEAKER_OPERATION_CONFLICT/);
});

test('no-op has a durable receipt but no text revision; same ID cannot acquire another payload after restart',t=>{
 const s=full(t),operation=op(s,'unknown',{utterance_ids:[s.row.utterances[3].utterance_id]},'durable-noop-operation');
 const before=fs.readFileSync(revisionFile(s,2)),result=s.store.correctSpeakers(s.id,2,operation);assert.equal(result.revision,2);
 assert.deepEqual(fs.readFileSync(revisionFile(s,2)),before);assert.equal(fs.existsSync(revisionFile(s,3)),false);
 const later=edit(s,s.row,'rename',{speaker_id:'segment-0',label:'稍后改名'},'noop-following-rename'),restarted=readRestart(s);
 assert.equal(restarted.correctSpeakers(s.id,2,operation).revision,2);assert.equal(restarted.read(s.id).revision,later.revision);
 assert.throws(()=>restarted.correctSpeakers(s.id,2,{...operation,utterance_ids:[s.row.utterances[0].utterance_id]}),/SPEAKER_OPERATION_CONFLICT/);
 const directory=path.join(s.root,'materials',s.id),receiptFile=fs.readdirSync(directory).find(name=>/^speaker-noop-.*\.json$/.test(name)),receiptPath=path.join(directory,receiptFile);
 const receipt=JSON.parse(fs.readFileSync(receiptPath));receipt.base_revision=3;fs.writeFileSync(receiptPath,JSON.stringify(receipt));
 assert.throws(()=>restarted.correctSpeakers(s.id,2,operation),/MATERIAL_SPEAKER_OPERATION_INVALID/,'a corrupted no-op base cannot point at a later unrelated revision');
});

test('write and rename failures preserve the old revision and allow exact operation recovery without extra commits',t=>{
 const s=full(t),operation=op(s,'rename',{speaker_id:'segment-0',label:'原子写入'},'atomic-rename-operation');const write=s.io.writeSync;
 s.io.writeSync=()=>0;assert.throws(()=>s.store.correctSpeakers(s.id,2,operation),/MATERIAL_WRITE_FAILED/);assert.equal(readRestart(s).read(s.id).revision,2);
 s.io.writeSync=write;s.failPromotion(true);assert.throws(()=>s.store.correctSpeakers(s.id,2,operation),/disk-failure/);assert.equal(readRestart(s).read(s.id).revision,2);
 s.failPromotion(false);const saved=readRestart(s).correctSpeakers(s.id,2,operation);assert.equal(saved.revision,3);
 assert.equal(readRestart(s).correctSpeakers(s.id,2,operation).revision,3);assert.equal(fs.existsSync(revisionFile(s,4)),false);
 const noop=op(s,'merge',{speaker_id:saved.speakers[0].speaker_id,target_speaker_id:saved.speakers[0].speaker_id},'atomic-noop-operation');
 s.failPromotion(true);assert.throws(()=>s.store.correctSpeakers(s.id,3,noop),/disk-failure/);assert.equal(readRestart(s).read(s.id).revision,3);
 s.failPromotion(false);assert.equal(readRestart(s).correctSpeakers(s.id,3,noop).revision,3);assert.equal(fs.existsSync(revisionFile(s,4)),false);
});

test('stale operations, tombstones and late ASR cannot overwrite a user label correction',t=>{
 const s=full(t),operation=op(s,'rename',{speaker_id:'segment-0',label:'保护更正'},'protected-speaker-op'),next=s.store.correctSpeakers(s.id,2,operation);
 assert.throws(()=>edit(s,s.row,'rename',{speaker_id:'segment-1',label:'过期更正'},'stale-speaker-operation'),/REVISION_CONFLICT/);
 assert.throws(()=>s.store.appendTranscript(s.id,3,s.input,'finished-asr'),/USER_REVISION_PROTECTED/);
 assert.throws(()=>s.store.appendTranscript(s.id,2,s.input,'later-asr'),/REVISION_CONFLICT/);
 assert.equal(s.store.ensure(s.source,'旧目录迟到文字').text,next.text);s.store.delete(s.id,3);
 assert.throws(()=>s.store.correctSpeakers(s.id,2,operation),/MATERIAL_DELETED/);assert.equal(s.store.read(s.id).operation,'delete');
});

test('deleting corrected speaker labels clears only the tombstone dictionary and receipt across cold restart',t=>{
 const s=full(t),named=edit(s,s.row,'rename',{speaker_id:'segment-0',label:'本段本人'},'rename-before-delete');
 const self=edit(s,named,'self',{speaker_id:named.speakers[0].speaker_id,label:'本段本人'},'self-before-delete');
 const oldBytes=fs.readFileSync(revisionFile(s,self.revision)),deleted=s.store.delete(s.id,self.revision);
 assert.equal(deleted.operation,'delete');assert.equal(deleted.text,'');assert.deepEqual(plain(deleted.utterances),[]);
 assert.deepEqual(plain(deleted.speakers),[]);assert.equal(deleted.speaker_correction,undefined);
 const restarted=readRestart(s),current=restarted.read(s.id);assert.deepEqual(plain(current.speakers),[]);
 assert.equal(current.speaker_correction,undefined);assert.deepEqual(fs.readFileSync(revisionFile(s,self.revision)),oldBytes);
 const history=restarted.read(s.id,self.revision);assert.equal(history.speakers[0].label,'本段本人');assert.equal(history.speakers[0].is_self,true);
 assert.equal(history.speaker_correction.operation_id,'self-before-delete');assert.equal(restarted.ensure(s.source,'旧文字').operation,'delete');
 const legacy=full(t),old=legacy.store.delete(legacy.id,legacy.row.revision);assert.equal(old.speakers,undefined,'legacy tombstones retain the absent dictionary shape');
});

test('complete text can be corrected without original audio; growing, interrupted or unconfirmed coverage remain explicit blockers',t=>{
 const s=full(t,{audioAvailable:false,audioBytes:0});const row=s.row;
 const good=edit(s,row,'rename',{speaker_id:'segment-0',label:'原音缺失时保留文字'},'text-only-speaker-op');assert.equal(good.source.audioAvailable,false);assert.equal(good.speaker_processing,'pending');
 const unknown=setupMaterialStore(t),unconfirmed=unknown.store.ensure({...unknown.source,audioAvailable:false,audioBytes:0},'只有旧文字',unknown.input);
 assert.throws(()=>unknown.store.correctSpeakers(unconfirmed.material_id,1,op(unknown,'rename',{speaker_id:'speaker-0',label:'名字'},'unknown-coverage-op')),/COVERAGE_UNCONFIRMED/);
 for(const source of [{complete:false},{interrupted:true}]){
  const state=full(t),changed=state.store.ensure({...state.source,...source});
  assert.throws(()=>state.store.correctSpeakers(state.id,changed.revision,op(state,'rename',{speaker_id:'segment-0',label:'名字'},'unsealed-speaker-op')),/SOURCE_UNSEALED/);
 }
});

test('new dictionaries reject foreign IDs, dangling references, unsafe labels and unconfirmed or multiple self identities',t=>{
 const s=full(t),next=edit(s,s.row,'rename',{speaker_id:'segment-0',label:'有效名字'}),file=revisionFile(s,3),bytes=fs.readFileSync(file);
 const invalids=[
  row=>row.speakers[0].speaker_id='mat-recording-'+ 'b'.repeat(32)+'-s'+ 'a'.repeat(20),
  row=>row.speakers[0].label='坏\n名字',
  row=>row.speakers[0].label='x'.repeat(81),
  row=>{row.speakers[0].is_self=true;row.speakers[0].label_basis='role_match';},
  row=>{for(const speaker of row.speakers){speaker.is_self=true;speaker.label_basis='user_confirmed';}},
  row=>row.speakers[0].bio=[1,2],row=>row.speakers.push({...row.speakers[0]}),
  row=>row.utterances[0].speaker_id=s.id+'-s'+'f'.repeat(20),
  row=>{row.utterances[0].speaker_id='';row.utterances[0].speaker_basis='user';},
 ];for(const invalid of invalids){const value=plain(next);invalid(value);fs.writeFileSync(file,JSON.stringify(value));assert.throws(()=>readRestart(s).read(s.id),/SPEAKERS_INVALID/);}
 fs.writeFileSync(file,bytes);assert.equal(readRestart(s).read(s.id).revision,3);
 assert.throws(()=>edit(s,next,'rename',{speaker_id:next.speakers[0].speaker_id,label:'bad\u0000name'},'invalid-label-operation'),/SPEAKER_LABEL_INVALID/);
});

test('split provenance rejects fabricated timing, missing or future parents, wrong UTF-16 ranges and exact-looking child times',t=>{
 const s=full(t),next=edit(s,s.row,'split',{utterance_ids:[s.row.utterances[0].utterance_id],split_offset:6},'validate-parent-range'),file=revisionFile(s,3),bytes=fs.readFileSync(file);
 const invalids=[
  row=>row.utterances[0].source_range.parent_revision=3,
  row=>row.utterances[0].source_range.parent_utterance_id='another-material-utterance',
  row=>row.utterances[0].source_range.start_ms=2001,
  row=>row.utterances[0].source_range.text_end=999,
  row=>row.utterances[0].source_range.text_end=4,
  row=>row.utterances[0].source_range.embedding=[1],
 ];for(const invalid of invalids){const value=plain(next);invalid(value);fs.writeFileSync(file,JSON.stringify(value));assert.throws(()=>readRestart(s).read(s.id),/SOURCE_RANGE_INVALID/);}
 const known=plain(next);known.utterances[0].start_ms=2000;known.utterances[0].end_ms=2500;fs.writeFileSync(file,JSON.stringify(known));assert.throws(()=>readRestart(s).read(s.id),/UTTERANCE_INVALID/);
 const precise=plain(next);precise.boundary_processing='token_starts';fs.writeFileSync(file,JSON.stringify(precise));assert.throws(()=>readRestart(s).read(s.id),/UTTERANCE_INVALID/);
 fs.writeFileSync(file,bytes);assert.equal(readRestart(s).read(s.id).revision,3);
});

test('explicit supplied dictionaries persist without embeddings; role-match label is not automatically self',t=>{
 const s=setupMaterialStore(t),id=s.store.idFor(s.source.kind,s.source.name),speaker=new s.MaterialSpeaker();
 speaker.speaker_id=id+'-s'+ 'a'.repeat(20);speaker.label='可能为本人';speaker.label_basis='role_match';speaker.is_self=false;
 s.input.speakers=[speaker];s.input.utterances[0].speaker_id=speaker.speaker_id;s.input.transcriptionState='complete';s.input.coveredMs=60000;s.input.sourceMs=60000;s.input.speakerProcessing='unavailable';
 const first=s.store.ensure(s.source),asr=s.store.appendTranscript(id,1,s.input,'dict-asr');assert.equal(readRestart(s).read(id).speakers[0].is_self,false);
 const selected=asr.utterances[0].utterance_id,next=s.store.correctSpeakers(id,2,op(s,'assign',{utterance_ids:[selected],target_speaker_id:speaker.speaker_id},'dict-assign-operation'));
 assert.equal(next.speakers[0].label_basis,'role_match');assert.equal(next.speakers[0].is_self,false);assert.equal(next.speaker_processing,'unavailable');assert.equal(next.utterances[0].speaker_basis,'user');
 assert.equal(fs.existsSync(path.join(s.root,s.source.name)),false,'the correction core does not move or recreate original audio');assert.equal(first.revision,1);
});
