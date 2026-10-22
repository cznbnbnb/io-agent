import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const {buildJournalDay,JournalSources}=loadApp('JournalExport',{'./LifelogSession':{LifelogDayText:class{}},'./RecordingSession':{}});
function journal(flag){
 const src=new JournalSources();src.lifelogItems=[{name:'seg-synthetic',created:1000,ended:61000,bytes:240000,hasText:true}];
 src.transcriptJson=()=>JSON.stringify({transcription_complete:flag,utterances:[{start:1,end:2,text:'合成样本',speaker:-1}]});
 return buildJournalDay(0,src,'');
}
test('partial recognized words are exportable but do not satisfy whole-day summary completion',()=>{
 const day=journal(false);assert.equal(day.total,1);assert.equal(day.transcribed,0);assert.match(day.markdown,/合成样本/);assert.match(day.markdown,/剩余音频仍在处理/);
});
test('sealed windows and legacy transcripts retain completion semantics',()=>{
 assert.equal(journal(true).transcribed,1);assert.equal(journal(undefined).transcribed,1);
});
test('saved legacy manual text with unknown coverage does not claim continued window processing or complete coverage',()=>{
 const src=new JournalSources();src.lifelogItems=[{name:'seg-synthetic',created:1000,ended:61000,bytes:240000,hasText:true}];
 src.transcriptJson=()=>JSON.stringify({transcription_complete:false,transcription_state:'unknown',speaker_processing:'processed',utterances:[{start:1,end:2,text:'旧资料完整识别结果',speaker:0}]});
 const day=buildJournalDay(0,src,'');assert.equal(day.transcribed,0);assert.match(day.markdown,/覆盖范围尚未核实/);assert.doesNotMatch(day.markdown,/剩余音频仍在处理|说话人分析待处理/);
});


test('daily export retains pending-speaker and unverified-boundary provenance for current and legacy windows',()=>{
 const src=new JournalSources();src.lifelogItems=[{name:'seg-synthetic',created:1000,ended:61000,bytes:240000,hasText:true}];
 const render=(extra)=>{src.transcriptJson=()=>JSON.stringify({transcription_complete:true,utterances:[{start:1,end:2,text:'合成样本',speaker:-1}],...extra});return buildJournalDay(0,src,'').markdown;};
 const current=render({covered_frames:100,speaker_processing:'pending',boundary_processing:'unverified'});assert.match(current,/说话人分析待处理/);assert.match(current,/窗口边界未核实/);
 assert.match(render({windowed:true}),/窗口边界未核实/);
 assert.doesNotMatch(render({covered_frames:100,boundary_processing:'token_starts'}),/窗口边界未核实/);
 assert.doesNotMatch(render({}),/窗口边界未核实/);
});
