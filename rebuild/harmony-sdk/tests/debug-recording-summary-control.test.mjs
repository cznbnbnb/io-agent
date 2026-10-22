import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

// Actual control/journal state machine; summary ports are explicit synthetic
// boundaries. No native IO, HDC, model request, microphone or Agent is reached.
const job='rsum-'+'a'.repeat(32),hash='b'.repeat(64);
const reference=()=>({material_id:'mat-recording-'+'c'.repeat(32),revision:2,text_revision:1,utterance_id:'u-1',content_sha256:'d'.repeat(64)});
function fixture(){
 const {DebugCardControl,DebugCardState}=loadApp('DebugCardControl');let command,sequence=0,foreground=true,saveFailure=false,handler;
 const disk=new Map(),calls=[];const view={job_id:job,state_sha256:hash,phase:'queued',entries:[]};
 const ports={command:()=>command,result:id=>disk.get(id),save(id,raw){if(saveFailure)throw Error('synthetic journal failure');disk.set(id,raw);},foreground:()=>foreground,
  status:()=>new DebugCardState(),show:async()=>assert.fail('no card'),remove:async()=>assert.fail('no card'),voice:async()=>assert.fail('no microphone'),reviewCard:async()=>assert.fail('no card'),
  taskStatus:()=>assert.fail('no unrelated task read'),recoveryStatus:()=>assert.fail('no recovery read'),restoreDraft:()=>assert.fail('no restore'),
  recordingSummaryPreview(ref){calls.push(['preview',ref]);return{schema:1,text_units:22,pieces:1,leaf_count:1,max_calls:30,transcription_state:'partial'};},
  async recordingSummaryStart(id,ref){calls.push(['start',id,ref]);assert.equal(JSON.parse(disk.get(JSON.parse(command).id)).state,'running');if(handler)await handler();return view;},
  recordingSummaryStatus(id){calls.push(['status',id]);return view;},recordingSummaryCancel(id,sha){calls.push(['cancel',id,sha]);return{...view,phase:'paused'};},
  async recordingSummaryResume(id,sha){calls.push(['resume',id,sha]);if(handler)await handler();return view;},
  recordingSummaryList(id,limit,cursor){calls.push(['list',id,limit,cursor]);return{items:[],next_cursor:'',has_more:false,snapshot_sha256:hash,scanned:0,incomplete:false,incomplete_reason:''};},
  recordingSummaryRead(...args){calls.push(['read',...args]);return{job_id:job,state_sha256:hash,format:'md',text:'完整😀',offset:0,next_offset:4,total_utf16:4,has_more:false};},
  recordingSummaryCitation(...args){calls.push(['citation',...args]);return{id:'piece-0001',text:'原文'};}};
 const control=new DebugCardControl(ports);control.enable(true);
 const put=(action,selection,extra={})=>{const now=Date.now(),r={schema:9,id:'dbg-'+(++sequence).toString(16).padStart(32,'0'),action,created_at:new Date(now).toISOString(),expires_at:new Date(now+60000).toISOString(),expected_uid:'',recording_summary:selection,...extra};command=JSON.stringify(r);return r;};
 return{control,ports,disk,calls,put,result:r=>JSON.parse(disk.get(r.id)),setForeground:v=>foreground=v,failSave:v=>saveFailure=v,onEffect:fn=>handler=fn,
  reload:()=>{const c=new DebugCardControl(ports);c.enable(true);return c;}};
}

test('schema9 eight actions delegate exact source/job/checkpoint and never touch the old device ports',async()=>{
 const f=fixture(),selections={preview:{reference:reference()},start:{job_id:job,reference:reference(),confirm_send:true},status:{job_id:job},
  cancel:{job_id:job,state_sha256:hash},resume:{job_id:job,state_sha256:hash,confirm_send:true},list:{material_id:reference().material_id,limit:2,cursor:''},
  read:{job_id:job,state_sha256:hash,format:'md',offset:0,max_chars:4},citation:{job_id:job,state_sha256:hash,piece_id:'piece-0001'}};
 for(const [action,selection]of Object.entries(selections)){const r=f.put('recording-summary-'+action,selection);await f.control.poll();assert.equal(f.result(r).state,'complete');assert.equal(f.result(r).control_call_completed,true);assert.equal(f.result(r).task_snapshot,undefined);assert.equal(f.result(r).playback_snapshot,undefined);}
 assert.deepEqual(f.calls,[['preview',reference()],['start',job,reference()],['status',job],['cancel',job,hash],['resume',job,hash],['list',reference().material_id,2,''],['read',job,hash,'md',0,4],['citation',job,'piece-0001',hash]]);
});

test('queued control completion is distinct from a ready summary and replay/reconcile never starts another model job',async()=>{
 const f=fixture(),r=f.put('recording-summary-start',{job_id:job,reference:reference(),confirm_send:true});await f.control.poll();await f.control.poll();await f.reload().poll();
 assert.equal(f.calls.length,1);assert.equal(f.result(r).state,'complete');assert.equal(f.result(r).recording_summary_view.phase,'queued');assert.deepEqual(f.result(r).recording_summary_view.entries,[]);
});

test('durable claim failure, release and background states never enter the summary effect port',async()=>{
 const f=fixture();f.put('recording-summary-start',{job_id:job,reference:reference(),confirm_send:true});f.failSave(true);await f.control.poll();assert.equal(f.calls.length,0);
 f.failSave(false);f.control.enable(false);await f.control.poll();f.control.enable(true);f.setForeground(false);await f.control.poll();assert.equal(f.calls.length,0);assert.equal(f.disk.size,0);
});

test('cold running and dispose during async start preserve the ambiguous claim and never replay it',async()=>{
 const f=fixture(),r=f.put('recording-summary-start',{job_id:job,reference:reference(),confirm_send:true});let finish;f.onEffect(()=>new Promise(resolve=>finish=resolve));const work=f.control.poll();
 while(!finish)await new Promise(setImmediate);await f.reload().poll();assert.equal(f.calls.length,1);f.control.dispose();finish();await work;assert.equal(f.result(r).state,'running');await f.reload().poll();assert.equal(f.calls.length,1);
});

test('job reference/checkpoint substitution under an already claimed command id is refused',async()=>{
 const f=fixture(),r=f.put('recording-summary-status',{job_id:job});await f.control.poll();const bytes=f.disk.get(r.id);f.put('recording-summary-start',{job_id:'rsum-'+'e'.repeat(32),reference:reference(),confirm_send:true},{id:r.id});await f.control.poll();
 assert.equal(f.control.note,'DEBUG_JOURNAL_INVALID');assert.equal(f.disk.get(r.id),bytes);assert.deepEqual(f.calls,[['status',job]]);
});

test('summary selectors reject unconfirmed writes, mixed schemas, arbitrary paths and malformed canonical references before claim',async()=>{
 const f=fixture(),ref=reference();const variants=[
  ['start',{job_id:job,reference:ref}],['start',{job_id:job,reference:ref,confirm_send:false}],['resume',{job_id:job,state_sha256:hash}],
  ['start',{job_id:job,reference:{...ref,path:'/private/audio'},confirm_send:true}],['preview',{reference:{...ref,material_id:'mat-lifelog-'+'c'.repeat(32)}}],
  ['preview',{reference:{...ref,revision:true}}],['preview',{reference:{...ref,text_revision:3}}],['preview',{reference:{...ref,content_sha256:'D'.repeat(64)}}],
  ['preview',{reference:{...ref,source_range:null}}],['preview',{reference:{...ref,utterance_id:'\ud800'}}],['status',{job_id:job,confirm_send:true}],
  ['cancel',{job_id:job,state_sha256:''}],['citation',{job_id:job,state_sha256:hash,piece_id:'../escape'}],['citation',{job_id:job,state_sha256:hash,piece_id:'piece-0000'}],
  ['list',{material_id:ref.material_id,limit:11,cursor:''}],['list',{material_id:ref.material_id,limit:1,cursor:hash+':01'}],['read',{job_id:job,state_sha256:hash,format:'path',offset:0,max_chars:2}]];
 for(const [action,value]of variants){const r=f.put('recording-summary-'+action,value);await f.control.poll();assert.equal(f.disk.has(r.id),false,action);}
 for(const extra of [{expected_uid:'p10-wrong'},{playback:{}},{schema:8},{arbitrary_text:'private'}]){const r=f.put('recording-summary-status',{job_id:job},extra);await f.control.poll();assert.equal(f.disk.has(r.id),false);}
 assert.deepEqual(f.calls,[]);
});

test('standard split source_range remains intact through preview, with exact revision lineage',async()=>{
 const f=fixture(),ref={...reference(),source_range:{parent_utterance_id:'parent',parent_revision:1,start_ms:0,end_ms:1200,text_start:2,text_end:7}};
 const r=f.put('recording-summary-preview',{reference:ref});await f.control.poll();assert.equal(f.result(r).state,'complete');assert.deepEqual(f.calls,[['preview',ref]]);
});

test('expired summary writes persist only an expired receipt; private exception text is never returned',async()=>{
 const f=fixture(),now=Date.now(),r=f.put('recording-summary-resume',{job_id:job,state_sha256:hash,confirm_send:true},{created_at:new Date(now-120000).toISOString(),expires_at:new Date(now-60000).toISOString()});
 await f.control.poll();assert.equal(f.result(r).error,'DEBUG_COMMAND_EXPIRED');assert.deepEqual(f.calls,[]);
 for(const [code,expected]of [['RECORDING_SUMMARY_STALE','RECORDING_SUMMARY_STALE'],['D:/private/key model input secret','DEBUG_OPERATION_FAILED']]){f.onEffect(()=>{throw Error(code);});const q=f.put('recording-summary-start',{job_id:job,reference:reference(),confirm_send:true});await f.control.poll();assert.equal(f.result(q).error,expected);assert.equal(f.result(q).recording_summary_view,undefined);if(code!==expected)assert.equal(JSON.stringify(f.result(q)).includes(code),false);}
});
