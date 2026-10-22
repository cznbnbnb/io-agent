import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';
function fixture(useActualQuery=false,savedInstance=undefined,noteInstance=undefined,realIo=undefined,playbackInstance=undefined,recordingInstance=undefined,workspaceInstance=undefined,materialInstance=undefined){
 const {TaskReplyBinding,TaskDecisionRecord}=loadApp('TaskReplyDraft'),{DebugCardState}=loadApp('DebugCardControl');
 const binding=Object.assign(new TaskReplyBinding(),{context_key:'full-original-context',operation_id:'reply-original',request_id:'request-original',request_revision:2,
  task_id:'task-original',route:{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'original'},expires_at:new Date(Date.now()+60000).toISOString(),question:'private question',mode:'free_text'});
 const record=Object.assign(new TaskDecisionRecord(),{binding,stage:'voice_authorized'}),calls=[];
 const capture={active:true,state:{phase:'listening',binding:JSON.stringify({format:'turboio-task-voice/1',attempt_id:'voice-'+'a'.repeat(32),peer:'original-peer',reply:binding}),text:'private condition',exitEvidence:'none'}};
 const recordingCapture={state:{active:false,phase:'idle',binding:'',text:'',exitEvidence:'none',transcriptStatus:'none'}};
 const value={ports:undefined,filesystem:0,timers:0,record,capture,recordingCapture,calls,voiceStopBindings:[],foreground:true,context:binding.context_key,
  review:{ready:false,reason:'not_reviewing',binding_sha256:''},
  recovery:{phase:'protected',inspection_sha256:'d'.repeat(64),transaction_id:'',can_resume:false,reason:'',
   main:{present:true,valid:true,eligible:true,bytes:320,text_length:17,sha256:'e'.repeat(64),stage:'review',reason:''},
   partial:{present:false,valid:false,eligible:false,bytes:0,text_length:0,sha256:'',stage:'',reason:'missing'}},
  recoveryInspections:0,recoveryRestores:[],failRestore:false,queryPorts:undefined,queryCalls:[],scanCalls:[],scanResult:{schema:1,scope:'local_canonical_window',hits:[],legacy_not_indexed:true},queryResult:{schema:1,scope:'local_canonical_only',hits:[],legacy_not_indexed:true},
  materialRows:new Map([['local-material',{material_id:'local-material',revision:2,textRevision:2}]]),summaryCalls:[],summaryPage:{schema:1,scope:'local_saved_journals',items:[]},summaryChunk:{schema:1,markdown:'explicit chunk'},noteCalls:[],playbackCalls:[],recordingSummaryCalls:[],todoCalls:[]};
 const taskVoiceReplies={canRecover:true,async stop(){calls.push('stop');const state=recordingCapture.state.binding||recordingCapture.state.active?recordingCapture.state:capture.state;value.voiceStopBindings.push(state.binding);state.phase='stopping';},cancel(){calls.push('cancel');},async recover(){calls.push('recover');}};
 const platform={
  './DebugCardControl':{DebugCardState,DebugCardControl:class{constructor(ports){value.ports=ports;}enable(){}dispose(){}async poll(){}}},
  './DebugTaskSnapshot':loadApp('DebugTaskSnapshot'),
  './ChannelProbeService':{makeChannelProbeControl:()=>({async poll(){}})},
  './PrompterProbeService':{makePrompterProbeControl:()=>{throw Error('prompter probe isolated from task fixture');}},
  './LongReadingProbeService':{LongReadingProbeService:class{constructor(){throw Error('isolated probe not enabled in task fixture');}}},
  './AgentCaptureService':{agentCapture:capture},'./TaskRecordingService':{taskRecordingCapture:recordingCapture},'./TaskService':{taskService:{decisionDraft:{snapshot:()=>record,paused:false},summary:()=>({contextKey:value.context})}},
  './TaskSuggestionService':{taskVoiceReplies,taskSuggestions:{reviewStatus:()=>value.review,async showReview(expected){
   if(expected!==value.review.binding_sha256)throw Error('TASK_REVIEW_BINDING_CHANGED');calls.push(['review-card',expected]);}},
   taskDraftRecovery:{inspect(){value.recoveryInspections++;return JSON.parse(JSON.stringify(value.recovery));},restore(source,expected){
    if(expected!==value.recovery.inspection_sha256)throw Error('TASK_RECOVERY_CHANGED');
    value.recoveryRestores.push([source,expected]);if(value.failRestore){value.recovery={...value.recovery,inspection_sha256:'f'.repeat(64),can_resume:true};throw Error('synthetic interrupted local recovery');}}}},
  './ProbeSession':{probeSession:{features:{state:{connected:true}},peerDeviceId:'original-peer',get foreground(){return value.foreground;},agentSuggestionOccupied:false,agentCaptureOccupied:true}},
  './NotificationService':{suggestionTests:{phase:'idle',active:false,busy:false,pendingUid:'',command:0,remainingMs:0,note:'',async start(){calls.push('card-start');},async remove(){calls.push('card-remove');}}},
  './MaterialLocalQuery':{LocalMaterialQuery:class{constructor(ports){value.queryPorts=ports;}query(filter){value.queryCalls.push(structuredClone(filter));return structuredClone(value.queryResult);}scan(filter){value.scanCalls.push(structuredClone(filter));return structuredClone(value.scanResult);}}},
  './LocalWorkspace':{localWorkspace:workspaceInstance||{
   todoPage(...args){value.todoCalls.push(['page',...args]);return{scope:args[0],todos:[],deletions:[]};},async deleteTodo(...args){value.todoCalls.push(['delete',...args]);return{phase:'pending'};},
   todoDeleteStatus(...args){value.todoCalls.push(['status',...args]);return{phase:'missing'};},async cancelTodoDelete(...args){value.todoCalls.push(['cancel',...args]);return{phase:'cancelled'};},
   async sendTodoDelete(...args){value.todoCalls.push(['send',...args]);return{phase:'submitted'};},async queryCurrentTodos(){value.todoCalls.push(['query']);return{phase:'waiting',absence_is_confirmation:false};},
   todoQueryStatus(){value.todoCalls.push(['query-status']);return{phase:'idle',absence_is_confirmation:false};}}},
  './RecordingService':{materials:materialInstance||{ids:()=>[...value.materialRows.keys()],read:id=>value.materialRows.get(id),queryCatalog:()=>({ids:[...value.materialRows.keys()].sort(),snapshot_sha256:'a'.repeat(64)})},savedJournalSummaries:savedInstance||{
   list(filter){value.summaryCalls.push(['list',structuredClone(filter)]);return value.summaryPage;},
    chunk(ref,offset,maxChars){value.summaryCalls.push(['chunk',structuredClone(ref),offset,maxChars]);return value.summaryChunk;}},journalSummaryNotes:noteInstance||{
     save(input){value.noteCalls.push(['save',input]);return{state:'saved'};},resume(input){value.noteCalls.push(['resume',input]);return{state:'pending'};},
     inspect(op){value.noteCalls.push(['inspect',op]);return{state:'missing'};},list(filter){value.noteCalls.push(['list',filter]);return{scope:'local_summary_notes',items:[]};},
     chunk(ref,format,offset,max){value.noteCalls.push(['chunk',ref,format,offset,max]);return{text:'note chunk',format};},
     pendingInput(op,sha){value.noteCalls.push(['pending',op,sha]);return{operation_id:op,text:'explicit complete pending input'};}},localPlayback:playbackInstance||{
     snapshot(){value.playbackCalls.push(['status']);return{schema:1,phase:'idle',audio_output_verified:false};},
     async play(selection){value.playbackCalls.push(['play',selection]);return{schema:1,phase:'playing',audio_output_verified:false};},
     async pause(id){value.playbackCalls.push(['pause',id]);return{schema:1,phase:'paused',audio_output_verified:false};},
     async resume(id){value.playbackCalls.push(['resume',id]);return{schema:1,phase:'playing',audio_output_verified:false};},
     async seek(id,position){value.playbackCalls.push(['seek',id,position]);return{schema:1,phase:'paused',audio_output_verified:false};},
     async stop(id){value.playbackCalls.push(['stop',id]);return{schema:1,phase:'idle',audio_output_verified:false};}},recordingSummaries:recordingInstance||{
      preview(ref){value.recordingSummaryCalls.push(['preview',ref]);return{text_units:20};},async start(id,ref){value.recordingSummaryCalls.push(['start',id,ref]);return{job_id:id,phase:'queued'};},
      status(id){value.recordingSummaryCalls.push(['status',id]);return{job_id:id,phase:'queued'};},cancel(id,sha){value.recordingSummaryCalls.push(['cancel',id,sha]);return{job_id:id,phase:'paused'};},
      async resume(id,sha){value.recordingSummaryCalls.push(['resume',id,sha]);return{job_id:id,phase:'queued'};},list(id,limit,cursor){value.recordingSummaryCalls.push(['list',id,limit,cursor]);return{items:[]};},
      chunk(...args){value.recordingSummaryCalls.push(['chunk',...args]);return{text:'exact chunk'};},citation(...args){value.recordingSummaryCalls.push(['citation',...args]);return{id:args[1],text:'original text'};}}},
   '@kit.CoreFileKit':{fileIo:realIo||{accessSync(){value.filesystem++;return false;},mkdirSync(){value.filesystem++;}}}
 };
 value.io=platform['@kit.CoreFileKit'].fileIo;
 if(useActualQuery)delete platform['./MaterialLocalQuery'];
 const module=loadApp('DebugCardService',platform,{setTimeout(){value.timers++;return 1;},clearTimeout(){}});
 return{...value,value,module};
}

test('todo debug ports call only normal workspace APIs with exact operation/ref/CAS arguments',async()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const p=f.value.ports,op='tdel-'+'a'.repeat(32),sha='b'.repeat(64),ref={id:101,revision:2,peer:'aabbccddeeff',content_sha256:'c'.repeat(64)};
 p.todoPage('deleted',2,'');await p.todoDelete(op,ref);p.todoDeleteStatus(op);await p.todoDeleteCancel(op,sha);await p.todoDeleteSend(op,sha);await p.todoQuery();p.todoQueryStatus();
 assert.deepEqual(f.value.todoCalls,[['page','deleted',2,''],['delete',op,ref],['status',op],['cancel',op,sha],['send',op,sha],['query'],['query-status']]);
 assert.deepEqual(f.calls,[]);assert.deepEqual(f.value.noteCalls,[]);assert.deepEqual(f.value.playbackCalls,[]);assert.deepEqual(f.value.recordingSummaryCalls,[]);assert.equal(f.value.recoveryInspections,0);assert.equal(f.capture.active,true);f.module.disposeDebugCards();
});

test('actual LocalWorkspace singleton backs schema10 local deletion, cold status and explicit unsent cancellation',async()=>{
 const values=new Map(),prefs={get:async(key,fallback)=>values.has(key)?values.get(key):fallback,put:async(key,value)=>values.set(key,value),flush:async()=>{}},platform={
  '@kit.AbilityKit':{},'@kit.ArkData':{preferences:{getPreferences:async()=>prefs}},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(7)})})}}};
 const actual=loadApp('LocalWorkspace',platform),workspace=actual.localWorkspace;await workspace.load({});await workspace.addTodo('仅合成本机待办，禁止设备发送');
 const f=fixture(false,undefined,undefined,undefined,undefined,undefined,workspace);f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});
 const {DebugCardControl}=loadApp('DebugCardControl'),control=new DebugCardControl(f.value.ports),io=f.value.io,disk=new Map();let command='',sequence=0;
 // Keep the real service ports, replace only the HDC command/result filesystem boundary.
 f.value.ports.command=()=>command;f.value.ports.result=id=>disk.get(id);f.value.ports.save=(id,raw)=>disk.set(id,raw);control.enable(true);
 const issue=async(action,todo)=>{const now=Date.now(),id='dbg-'+(++sequence).toString(16).padStart(32,'0');command=JSON.stringify({schema:10,id,action,created_at:new Date(now).toISOString(),expires_at:new Date(now+60000).toISOString(),expected_uid:'',todo});await control.poll();return JSON.parse(disk.get(id));};
 try{
  const page=(await issue('todo-list',{scope:'active',limit:10,cursor:''})).todo_page;assert.equal(page.todos.length,1);const ref=page.todos[0].reference;assert.equal(ref.peer,'');assert.match(ref.content_sha256,/^[a-f0-9]{64}$/);
  const op='tdel-'+'e'.repeat(32),deleted=(await issue('todo-delete',{operation_id:op,reference:ref,confirm:true})).todo_deletion;
  assert.equal(deleted.phase,'local_deleted');assert.equal(deleted.attempts,0);assert.equal(deleted.can_cancel,true);assert.equal(deleted.can_send,false);assert.equal(deleted.receipt_observed,false);assert.equal(workspace.todos.length,0);
  const coldModule=loadApp('LocalWorkspace',platform);await coldModule.localWorkspace.load({});const cold=coldModule.localWorkspace.todoDeleteStatus(op);assert.equal(cold.state_sha256,deleted.state_sha256);assert.equal(cold.phase,'local_deleted');
  assert.equal((await issue('todo-delete-status',{operation_id:op})).todo_deletion.state_sha256,deleted.state_sha256);
  const cancelled=(await issue('todo-delete-cancel',{operation_id:op,state_sha256:deleted.state_sha256})).todo_deletion;assert.equal(cancelled.phase,'cancelled');assert.equal(workspace.todos.length,1);
  assert.equal((await issue('todo-query-status',{})).todo_query.phase,'idle');assert.equal((await issue('todo-query',{})).error,'TODO_BLOCKED');
  assert.deepEqual(f.value.todoCalls,[],'actual singleton export handled the commands');assert.deepEqual(f.calls,[]);assert.equal(f.value.recoveryInspections,0);assert.equal(f.capture.active,true);
 }finally{control.dispose();f.module.disposeDebugCards();}
});
test('release build never creates the HDC command poller or reads private task state',()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:false},filesDir:'/private'});
 assert.equal(f.value.ports,undefined);assert.equal(f.value.filesystem,0);assert.equal(f.value.timers,0);assert.deepEqual(f.calls,[]);
});
test('debug service wires exact task voice controls to existing service APIs and never starts capture',async()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const ports=f.value.ports,s=ports.taskStatus();
 assert.equal(s.request_id,'request-original');assert.equal(s.capture_active,true);assert.equal(s.draft_saved,false);assert.equal(s.binding_sha256.length,64);
 await ports.voice('voice-finish',s.binding_sha256);assert.equal(ports.taskStatus().capture_phase,'stopping');assert.equal(ports.taskStatus().draft_saved,false);
 await ports.voice('voice-cancel',s.binding_sha256);await ports.voice('voice-recover',s.binding_sha256);assert.deepEqual(f.calls,['stop','cancel','recover']);
 await assert.rejects(ports.voice('voice-finish','b'.repeat(64)),/BINDING_CHANGED/);f.value.context='another-profile';
 await assert.rejects(ports.voice('voice-cancel',s.binding_sha256),/BINDING_CHANGED/);assert.deepEqual(f.calls,['stop','cancel','recover']);
 f.module.disposeDebugCards();
});

test('actual CLI task-status selects the new recording attempt and voice-finish rejects the retained old capture binding',async()=>{
 const f=fixture(),oldToken=f.capture.state.binding,token=JSON.stringify({...JSON.parse(oldToken),attempt_id:'voice-'+'b'.repeat(32)});
 Object.assign(f.capture.state,{packets:777,pcmBytes:55555,compressedPackets:777,pcmRms:123,micWriteCompletedAt:1001,firstDecodedSamples:960,observationRestored:false});
 Object.assign(f.recordingCapture.state,{active:true,phase:'listening',binding:token,text:'private recording reply',transcriptStatus:'pending',
  packets:888,pcmBytes:99999,pcmRms:456,inputSealed:true,workerExited:true});
 f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});
 const {DebugCardControl}=loadApp('DebugCardControl'),disk=new Map(),ports=f.value.ports;let command='',sequence=0;
 ports.command=()=>command;ports.result=id=>disk.get(id);ports.save=(id,raw)=>disk.set(id,raw);const control=new DebugCardControl(ports);control.enable(true);
 const issue=async(action,expected='')=>{const now=Date.now(),id='dbg-'+(++sequence).toString(16).padStart(32,'0');
  command=JSON.stringify({schema:2,id,action,created_at:new Date(now).toISOString(),expires_at:new Date(now+60000).toISOString(),expected_uid:'',expected_voice_binding:expected});
  await control.poll();return JSON.parse(disk.get(id));};
 try{
  const status=await issue('task-status'),view=status.task_snapshot;assert.equal(status.state,'complete');assert.equal(view.binding_sha256,createHash('sha256').update(token).digest('hex'));
  assert.equal(view.attempt_id,'voice-'+'b'.repeat(32));assert.equal(view.binding_applicable,true);assert.equal(view.capture_phase,'listening');assert.equal(view.capture_metrics_available,false);
  for(const key of ['capture_packets','pcm_bytes','compressed_packets','pcm_rms','mic_write_completed_at','first_decoded_samples'])assert.equal(view[key],0);
  assert.equal(view.input_sealed,false);assert.equal(view.worker_exited,false);assert(!JSON.stringify(view).includes('private recording reply'));assert.deepEqual(f.calls,[]);
  const refused=await issue('voice-finish',createHash('sha256').update(oldToken).digest('hex'));assert.equal(refused.state,'error');assert.deepEqual(f.calls,[]);
  const finished=await issue('voice-finish',view.binding_sha256);assert.equal(finished.state,'complete');assert.equal(finished.task_snapshot.capture_phase,'stopping');
  assert.equal(finished.task_snapshot.capture_metrics_available,false);assert.equal(finished.task_snapshot.draft_saved,false);assert.deepEqual(f.value.voiceStopBindings,[token]);assert.deepEqual(f.calls,['stop']);
  assert.equal(f.capture.state.phase,'listening','the retained assistant attempt was not stopped');
 }finally{control.dispose();f.module.disposeDebugCards();}
});

test('recording transcribing status is visible without borrowing assistant measurements or accepting its previous attempt hash',async()=>{
 const f=fixture(),token=JSON.stringify({...JSON.parse(f.capture.state.binding),attempt_id:'voice-'+'c'.repeat(32)});
 Object.assign(f.recordingCapture.state,{active:true,phase:'transcribing',binding:token,text:'',exitEvidence:'device_event',transcriptStatus:'pending'});
 Object.assign(f.capture.state,{packets:245,pcmBytes:59520,compressedPackets:245,pcmRms:0.115,workerExited:true,stopSubmitted:true,observationRestored:false});
 f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});
 try{const p=f.value.ports,view=p.taskStatus();assert.equal(view.capture_phase,'transcribing');assert.equal(view.capture_active,true);assert.equal(view.transcript_status,'pending');assert.equal(view.exit_evidence,'device_event');
  assert.equal(view.capture_metrics_available,false);assert.equal(view.capture_packets,0);assert.equal(view.pcm_bytes,0);assert.equal(view.pcm_rms,0);assert.equal(view.worker_exited,false);assert.equal(view.stop_submitted,false);
  f.recordingCapture.state.binding=JSON.stringify({...JSON.parse(token),attempt_id:'voice-'+'d'.repeat(32)});await assert.rejects(p.voice('voice-finish',view.binding_sha256),/BINDING_CHANGED/);assert.deepEqual(f.calls,[]);
 }finally{f.module.disposeDebugCards();}
});

test('debug review display is wired exclusively to the normal task suggestion service full-reply CAS',async()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const ports=f.value.ports,hash='c'.repeat(64);
 assert.equal(ports.taskStatus().review_ready,false);assert.equal(ports.taskStatus().review_block_reason,'not_reviewing');
 f.value.review={ready:true,reason:'ready',binding_sha256:hash};const status=ports.taskStatus();
 assert.equal(status.reply_binding_sha256,hash);assert.equal(status.review_ready,true);assert.notEqual(status.binding_sha256,hash);
 await assert.rejects(ports.reviewCard(status.binding_sha256),/BINDING_CHANGED/);await ports.reviewCard(hash);
 assert.deepEqual(f.calls,[['review-card',hash]]);assert.equal(f.record.stage,'voice_authorized');assert.equal(f.record.text,'');
 f.value.foreground=false;await assert.rejects(ports.reviewCard(hash),/BINDING_CHANGED/);assert.deepEqual(f.calls,[['review-card',hash]]);
 f.module.disposeDebugCards();
});

test('debug recovery metadata and restore wire only to the explicit local recovery service stub',()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const ports=f.value.ports,view=ports.recoveryStatus();
 assert.deepEqual(JSON.parse(JSON.stringify(view)),f.value.recovery);assert.equal(f.value.recoveryInspections,1);
 const visible=JSON.stringify(view);for(const secret of [f.record.binding.question,f.record.binding.context_key,f.capture.state.text,f.record.binding.route.session_id])assert.equal(visible.includes(secret),false);
 assert.throws(()=>ports.restoreDraft('partial','b'.repeat(64)),/RECOVERY_CHANGED/);assert.deepEqual(f.value.recoveryRestores,[]);
 for(const source of ['main','partial','resume'])ports.restoreDraft(source,view.inspection_sha256);
 assert.deepEqual(f.value.recoveryRestores,['main','partial','resume'].map(source=>[source,view.inspection_sha256]));
 assert.equal(f.record.stage,'voice_authorized');assert.equal(f.record.text,'');assert.deepEqual(f.calls,[],'no card, voice, model or answer API is used');
 assert.equal(f.capture.active,true,'metadata control cannot impersonate microphone cleanup');f.module.disposeDebugCards();
});

test('failed local restore remains inspectable for an explicit resume without invoking device or task controls',()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const ports=f.value.ports,view=ports.recoveryStatus();f.value.failRestore=true;
 assert.throws(()=>ports.restoreDraft('partial',view.inspection_sha256),/interrupted local recovery/);const after=ports.recoveryStatus();
 assert.equal(after.can_resume,true);assert.equal(after.inspection_sha256,'f'.repeat(64));assert.equal(f.value.recoveryRestores.length,1);
 assert.equal(ports.taskStatus().draft_saved,false);assert.deepEqual(f.calls,[]);assert.equal(f.capture.active,true);f.module.disposeDebugCards();
});

test('local query port uses canonical materials IDs/read and returns local references without task, microphone or display effects',()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const ports=f.value.ports,filter={from:0,to:0,keyword:'运费',speaker:'',limit:10,cursor:''};
 assert.deepEqual(f.value.queryPorts.ids(),['local-material']);assert.equal(f.value.queryPorts.read('local-material'),f.value.materialRows.get('local-material'));
 f.value.queryResult={schema:1,scope:'local_canonical_only',hits:[{reference:{material_id:'local-material',revision:2,text_revision:2,content_sha256:'e'.repeat(64)},start_ms:null,end_ms:null,excerpt:'运费沿用上次'}],
  scanned:1,unreadable:0,incomplete:false,incomplete_reason:'',legacy_not_indexed:true,next_cursor:'',has_more:false,snapshot_sha256:'a'.repeat(64)};
 const result=ports.localQuery(filter);assert.deepEqual(result,f.value.queryResult);assert.deepEqual(f.value.queryCalls,[filter]);assert.deepEqual(f.calls,[]);
 assert.equal(f.value.recoveryInspections,0);assert.equal(f.capture.active,true);assert.equal(f.record.stage,'voice_authorized');f.module.disposeDebugCards();
});
test('service constructs the actual LocalMaterialQuery export and queries canonical data without a query-module substitute',()=>{
 const f=fixture(true),id='mat-recording-'+'a'.repeat(32),row={schema_version:1,material_id:id,revision:3,text_revision:2,operation:'upsert',
  source:{kind:'recording',name:'take-'+'a'.repeat(32),started:1000,ended:2000,audioAvailable:true},text:'运费沿用上次',transcription_state:'partial',
  utterances:[{utterance_id:'utterance-original',start_ms:100,end_ms:800,text:'运费沿用上次',speaker_id:'speaker-0',speaker_basis:'segment_cluster',overlap:false}],
  speakers:[{speaker_id:'speaker-0',label:'发言人A',label_basis:'anonymous',is_self:false}]};
 f.value.materialRows.clear();f.value.materialRows.set(id,row);const frozen=JSON.stringify(row);
 f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});
 const page=f.value.ports.localQuery({from:1000,to:2000,keyword:'运费',speaker:'发言人A',limit:10,cursor:''});
 assert.equal(f.value.queryPorts,undefined,'the stub query constructor is not used');assert.deepEqual(f.value.queryCalls,[]);
 assert.equal(page.scope,'local_canonical_only');assert.equal(page.hits.length,1);assert.equal(page.scanned,1);assert.equal(page.unreadable,0);assert.equal(page.incomplete,false);
 const hit=page.hits[0];assert.equal(hit.excerpt,'运费沿用上次');assert.equal(hit.reference.material_id,id);assert.equal(hit.reference.revision,3);assert.equal(hit.reference.text_revision,2);
 assert.equal(hit.reference.utterance_id,'utterance-original');assert.match(hit.reference.content_sha256,/^[a-f0-9]{64}$/);assert.equal(hit.transcription_state,'partial');
 assert.equal(hit.speaker_label,'发言人A');assert.equal(hit.is_self,false);assert.equal(page.legacy_not_indexed,true);assert.equal(JSON.stringify(row),frozen);
 assert.deepEqual(f.calls,[]);assert.equal(f.capture.active,true);assert.equal(f.record.stage,'voice_authorized');f.module.disposeDebugCards();
});

test('scan port delegates the exact filter and supplies catalog separately from legacy IDs/read',()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const filter={from:0,to:0,keyword:'运费',speaker:'',limit:2,scan_cursor:'',hit_cursor:''};
 assert.deepEqual(f.value.ports.localScan(filter),f.value.scanResult);assert.deepEqual(f.value.scanCalls,[filter]);assert.deepEqual(f.value.queryCalls,[]);
 assert.deepEqual(f.value.queryPorts.catalog(),{ids:['local-material'],snapshot_sha256:'a'.repeat(64)});assert.deepEqual(f.calls,[]);assert.deepEqual(f.value.todoCalls,[]);assert.equal(f.capture.active,true);f.module.disposeDebugCards();
});

test('actual Store catalog and actual scanner reach record513 through Control without changing the old first-window query or stored bytes',async t=>{
 const real=setupMaterialStore(t);assert.match(real.root,/^[dD]:\//);real.io.lstatSync=name=>{const s=fs.lstatSync(name);return{ino:s.ino,size:s.size,mtime:s.mtimeMs,ctime:s.ctimeMs,isFile:()=>s.isFile(),isDirectory:()=>s.isDirectory(),isSymbolicLink:()=>s.isSymbolicLink()};};
 real.source.name='take-'+(0).toString(16).padStart(32,'0');const base=real.store.ensure(real.source);real.input.text='运费第一条';real.input.utterances[0].text=real.input.text;const row=real.store.appendTranscript(base.material_id,base.revision,real.input),original=JSON.stringify(row),files=[];
 for(let index=0;index<513;index++){
  const copy=JSON.parse(original),suffix=index.toString(16).padStart(32,'0');copy.material_id='mat-recording-'+suffix;copy.source.name='take-'+suffix;
  copy.text=index<2?'运费第一窗'+index:index===512?'运费第513条':'不匹配的合成记录';copy.utterances[0].text=copy.text;
  const directory=real.root+'/materials/'+copy.material_id;if(!fs.existsSync(directory))fs.mkdirSync(directory);const file=directory+'/revision-000000002.json';fs.writeFileSync(file,JSON.stringify(copy));files.push([file,fs.readFileSync(file)]);
 }
 const f=fixture(true,undefined,undefined,real.io,undefined,undefined,undefined,real.store);f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:real.root});
 const {DebugCardControl}=loadApp('DebugCardControl'),control=new DebugCardControl(f.value.ports),disk=new Map();let raw='',sequence=0;f.value.ports.command=()=>raw;f.value.ports.result=id=>disk.get(id);f.value.ports.save=(id,value)=>disk.set(id,value);control.enable(true);
 const filter={from:0,to:0,keyword:'运费',speaker:'',limit:1,scan_cursor:'',hit_cursor:''};
 const issue=async(selection)=>{const now=Date.now(),id='dbg-'+(++sequence).toString(16).padStart(32,'0');raw=JSON.stringify({schema:11,id,action:'scan-local',created_at:new Date(now).toISOString(),expires_at:new Date(now+60000).toISOString(),expected_uid:'',local_scan:selection});await control.poll();return JSON.parse(disk.get(id));};
 try{
  const legacy=f.value.ports.localQuery({from:0,to:0,keyword:'运费',speaker:'',limit:10,cursor:''});assert.equal(legacy.scope,'local_canonical_only');assert.equal(legacy.scanned,512);assert.equal(legacy.hits.length,2);assert.equal(legacy.incomplete_reason,'scan_limit');assert.equal(Object.hasOwn(legacy,'scan_cursor'),false);
  const first=(await issue(filter)).local_scan;assert.equal(first.scope,'local_canonical_window');assert.equal(first.catalog_total,513);assert.equal(first.window_start,0);assert.equal(first.window_end,512);assert.equal(first.scan_has_more,true);assert.equal(first.has_more,true);assert.equal(first.hits.length,1);assert.equal(first.incomplete,true);
  const same=(await issue({...filter,scan_cursor:first.scan_cursor,hit_cursor:first.next_cursor})).local_scan;assert.equal(same.window_start,0);assert.equal(same.window_end,512);assert.equal(same.snapshot_sha256,first.snapshot_sha256);assert.equal(same.has_more,false);assert.notEqual(same.hits[0].reference.material_id,first.hits[0].reference.material_id);
  const last=(await issue({...filter,scan_cursor:first.next_scan_cursor})).local_scan;assert.equal(last.window_start,512);assert.equal(last.window_end,513);assert.equal(last.scan_has_more,false);assert.equal(last.stop_reason,'end');assert.equal(last.incomplete,true);assert.equal(last.incomplete_reason,'window_only');assert.equal(last.hits[0].excerpt,'运费第513条');
  const {LocalMaterialQuery}=loadApp('MaterialLocalQuery'),query=new LocalMaterialQuery({ids:()=>real.store.ids(),read:id=>real.store.read(id),catalog:()=>real.store.queryCatalog()});assert.equal(query.resolve(last.hits[0].reference).material_id,last.hits[0].reference.material_id);
  for(const[file,bytes]of files)assert.deepEqual(fs.readFileSync(file),bytes,'query must not modify stored canonical rows');
  real.store.correctText(row.material_id,row.revision,row.utterances[0].utterance_id,'来源发生明确修订');const stale=await issue({...filter,scan_cursor:first.next_scan_cursor});assert.equal(stale.error,'LOCAL_QUERY_STALE');assert.equal(stale.local_scan,undefined);
  assert.deepEqual(f.value.scanCalls,[],'actual LocalMaterialQuery export handles scanning');assert.deepEqual(f.calls,[]);assert.deepEqual(f.value.todoCalls,[]);assert.equal(f.capture.active,true);assert.equal(f.value.recoveryInspections,0);
 }finally{control.dispose();f.module.disposeDebugCards();}
});
test('local search receipts allow bounded 64KiB while commands remain 2KiB and oversized results are not written',()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const ports=f.value.ports,io=f.value.io;let reads=0,writes=0;
 const receipt='x'.repeat(50000);io.accessSync=()=>true;io.statSync=()=>({size:50000});io.readTextSync=()=>{reads++;return receipt;};
 assert.equal(ports.result('dbg-'+'a'.repeat(32)),receipt);assert.equal(reads,1);assert.throws(()=>ports.command(),/DEBUG_FILE_INVALID/);assert.equal(reads,1);
 io.statSync=()=>({size:65537});assert.throws(()=>ports.result('dbg-'+'a'.repeat(32)),/DEBUG_FILE_INVALID/);assert.equal(reads,1);
 io.openSync=()=>{writes++;throw Error('must not open an oversized result');};assert.throws(()=>ports.save('dbg-'+'a'.repeat(32),'中'.repeat(22000)),/DEBUG_RESULT_TOO_LARGE/);assert.equal(writes,0);
 f.module.disposeDebugCards();
});
test('saved summary ports delegate only to the existing production singleton list/chunk APIs',()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const ports=f.value.ports;
 const filter={day:'2026-10-15',limit:10,cursor:''},ref={day:filter.day,summary_id:'saved-'+filter.day+'-cache',content_sha256:'a'.repeat(64)};
 assert.equal(ports.summaryList(filter),f.value.summaryPage);assert.equal(ports.summaryRead(ref,3,4000),f.value.summaryChunk);
 assert.deepEqual(f.value.summaryCalls,[['list',filter],['chunk',ref,3,4000]]);assert.deepEqual(f.value.queryCalls,[]);assert.equal(f.value.recoveryInspections,0);
 assert.deepEqual(f.calls,[]);assert.equal(f.capture.active,true);assert.equal(f.record.stage,'voice_authorized');f.module.disposeDebugCards();
});
test('service uses the actual SavedJournalSummary export against real writer/store files and refuses a later changed source',t=>{
 const store=setupMaterialStore(t);assert.match(store.root,/^[dD]:\//,'owned temporary files must remain on D:');
 let writes=0,reads=0;store.io.OpenMode.READ_ONLY=0;
 store.io.openSync=(path,mode)=>{if(mode!==0)writes++;return{fd:fs.openSync(path,mode===0?'r':'w')};};
 store.io.statSync=path=>typeof path==='number'?fs.fstatSync(path):fs.statSync(path);
 store.io.lstatSync=fs.lstatSync;store.io.readSync=(fd,buffer,options)=>{reads++;assert.equal(options.offset,undefined);return fs.readSync(fd,new Uint8Array(buffer),0,Math.min(options.length,17),null);};
 const platform={'@kit.CoreFileKit':{fileIo:store.io},'@kit.ArkTS':{util:{TextEncoder:class{encodeInto(text){return new TextEncoder().encode(text);}},
  TextDecoder:class{constructor(encoding,options){this.decoder=new TextDecoder(encoding,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}}},
  './LifelogSession':{LifelogDayText:class{markdown='';total=0;transcribed=0;}}};
 const journal=loadApp('JournalExport',platform),core=loadApp('SavedJournalSummary',platform),day='2026-10-15',dayStart=core.savedSummaryDayStart(day);
 store.source.started=dayStart+1000;store.source.ended=dayStart+61000;
 const original=store.store.ensure(store.source);store.input.text='原文😀运费沿用上次';store.input.utterances[0].text=store.input.text;
 store.input.transcriptionState='complete';store.input.coveredMs=60000;store.input.sourceMs=60000;
 const row=store.store.appendTranscript(original.material_id,original.revision,store.input);
 const sources=new journal.JournalSources();sources.recordingItems=[{name:store.source.name,created:store.source.started,bytes:store.source.audioBytes,textFile:'legacy.md'}];
 sources.material=()=>store.store.read(row.material_id);
 const current=day=>journal.buildJournalDay(day,sources,''),base=current(dayStart),full=journal.bindJournalSummary(base,current(dayStart),'完整总结😀\n\n## 模型小节\n保留模型后续标题');
 const savedPath=journal.writeJournalSnapshot(store.root,dayStart,full.markdown),before=fs.readFileSync(savedPath),instance=new core.SavedJournalSummary({root:()=>store.root,current});
 const f=fixture(false,instance);f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});writes=0;
 const page=f.value.ports.summaryList({day,limit:10,cursor:''});assert.equal(page.items.length,1);assert.equal(page.items[0].can_open,true);
 assert.equal(page.items[0].producer,'unknown');assert.equal(page.items[0].generated_at,'');assert.equal(Object.hasOwn(page.items[0],'markdown'),false);
 const ref=page.items[0].reference;assert.equal(ref.content_sha256,createHash('sha256').update(before).digest('hex'));
 let offset=0,text='';for(let index=0;index<1000;index++){
  const chunk=f.value.ports.summaryRead(ref,offset,11);assert.deepEqual(JSON.parse(JSON.stringify(chunk.reference)),JSON.parse(JSON.stringify(ref)));
  assert.equal(chunk.offset,offset);assert.equal(chunk.next_offset,offset+chunk.markdown.length);text+=chunk.markdown;offset=chunk.next_offset;
  if(!chunk.has_more)break;
 }
 assert.equal(text,full.markdown);assert.equal(offset,full.markdown.length);assert.equal(writes,0);assert.ok(reads>10,'real short reads exercised');assert.deepEqual(fs.readFileSync(savedPath),before);
 store.store.correctText(row.material_id,row.revision,row.utterances[0].utterance_id,'已修订的新条件');
 assert.throws(()=>f.value.ports.summaryRead(ref,0,4000),/SAVED_SUMMARY_STALE/);assert.deepEqual(fs.readFileSync(savedPath),before);
 assert.deepEqual(f.value.summaryCalls,[],'no fake summary export is used');assert.deepEqual(f.calls,[]);assert.equal(f.value.recoveryInspections,0);f.module.disposeDebugCards();
});

const noteOp='noteop-2026-10-15-'+'d'.repeat(32),noteBody=(text='完整用户附注😀')=>({operation_id:noteOp,parent:{day:'2026-10-15',summary_id:'saved-2026-10-15-cache',content_sha256:'a'.repeat(64)},source_sha256:'b'.repeat(64),text});
function noteIoFixture(t){
 const value=setupMaterialStore(t);assert.match(value.root,/^[dD]:\//);const io=value.io;io.OpenMode.READ_ONLY=0;
 io.openSync=(path,mode)=>({fd:fs.openSync(path,mode===0?'r':(mode&1)?'w':'r+')});
 io.statSync=path=>typeof path==='number'?fs.fstatSync(path):fs.statSync(path);io.lstatSync=fs.lstatSync;io.unlinkSync=fs.unlinkSync;
 io.readSync=(fd,buffer,options)=>fs.readSync(fd,new Uint8Array(buffer),0,Math.min(options.length,19),null);
 return value;
}
test('note service ports use only the existing notes singleton APIs, including explicit sensitive pending read',()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const p=f.value.ports,input=noteBody(),filter={day:'2026-10-15',limit:10,cursor:''},ref={day:'2026-10-15',note_id:'note-2026-10-15-'+'d'.repeat(32),content_sha256:'c'.repeat(64)};
 p.noteSave(input,false);p.noteSave(input,true);p.noteStatus(noteOp);p.noteList(filter);p.noteRead(ref,'json',8,4000);p.notePending(noteOp,'f'.repeat(64));
 assert.deepEqual(f.value.noteCalls,[['save',input],['resume',input],['inspect',noteOp],['list',filter],['chunk',ref,'json',8,4000],['pending',noteOp,'f'.repeat(64)]]);
 assert.deepEqual(f.calls,[]);assert.equal(f.value.recoveryInspections,0);assert.equal(f.capture.active,true);f.module.disposeDebugCards();
});
test('raw note attachment uses SHA/short-read/UTF8 bounds, and cleanup requires an independently read durable terminal receipt',t=>{
 const disk=noteIoFixture(t),f=fixture(false,undefined,undefined,disk.io);f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:disk.root});
 const p=f.value.ports,id='dbg-'+'a'.repeat(32),path=disk.root+'/io-debug/'+id+'-annotation.json',body=noteBody('\u001f'.repeat(8192)),raw=JSON.stringify(body),sha=createHash('sha256').update(raw).digest('hex');
 fs.writeFileSync(path,raw);assert.ok(Buffer.byteLength(raw)<65536);const input=p.noteInput(id,sha,noteOp);assert.equal(input.text.length,8192);assert.equal(input.text,body.text);
 assert.throws(()=>p.noteInput(id,'0'.repeat(64),noteOp),/NOTE_INVALID/);assert.throws(()=>p.noteInput(id,sha,'noteop-2026-10-15-'+'e'.repeat(32)),/NOTE_INVALID/);
 p.noteCleanup(id,sha);assert.equal(fs.existsSync(path),true,'missing receipt must retain attachment');
 const request={schema:7,id,action:'save-summary-note',annotation:{operation_id:noteOp,body_sha256:sha}},result={schema:1,id,request_json:JSON.stringify(request),state:'running'};
 p.save(id,JSON.stringify(result));p.noteCleanup(id,sha);assert.equal(fs.existsSync(path),true,'running claim cannot authorize deletion');
 result.state='complete';p.save(id,JSON.stringify(result));const receipt=fs.readFileSync(disk.root+'/io-debug/'+id+'.json');
 p.noteCleanup(id,'0'.repeat(64));assert.equal(fs.existsSync(path),true,'wrong SHA cannot delete');
 const unlink=disk.io.unlinkSync;disk.io.unlinkSync=()=>{throw Error('synthetic cleanup failure');};p.noteCleanup(id,sha);
 assert.deepEqual(fs.readFileSync(disk.root+'/io-debug/'+id+'.json'),receipt);assert.equal(fs.existsSync(path),true);disk.io.unlinkSync=unlink;
 p.noteCleanup(id,sha);assert.equal(fs.existsSync(path),false);assert.deepEqual(fs.readFileSync(disk.root+'/io-debug/'+id+'.json'),receipt);
 const invalid=Uint8Array.from([0xff,0x7b,0x7d]);fs.writeFileSync(path,invalid);const invalidSha=createHash('sha256').update(invalid).digest('hex');
 assert.throws(()=>p.noteInput(id,invalidSha,noteOp),/NOTE_INVALID/);assert.equal(fs.existsSync(path),true);
 const lstat=disk.io.lstatSync;disk.io.lstatSync=name=>name===path?{isSymbolicLink:()=>true,isFile:()=>true,size:3}:lstat(name);
 assert.throws(()=>p.noteInput(id,invalidSha,noteOp),/NOTE_BLOCKED/);disk.io.lstatSync=lstat;
 assert.deepEqual(f.value.noteCalls,[]);assert.deepEqual(f.calls,[]);f.module.disposeDebugCards();
});
test('note staging budget refuses unknown names and too many retained attachments without sweeping any files',t=>{
 const disk=noteIoFixture(t),f=fixture(false,undefined,undefined,disk.io);f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:disk.root});const root=disk.root+'/io-debug',id='dbg-'+'a'.repeat(32),raw=JSON.stringify(noteBody()),sha=createHash('sha256').update(raw).digest('hex');
 fs.writeFileSync(root+'/'+id+'-annotation.json',raw);fs.writeFileSync(root+'/foreign-annotation.json','keep');
 assert.throws(()=>f.value.ports.noteInput(id,sha,noteOp),/NOTE_BLOCKED/);assert.equal(fs.readFileSync(root+'/foreign-annotation.json','utf8'),'keep');fs.unlinkSync(root+'/foreign-annotation.json');
 for(let index=0;index<128;index++)fs.writeFileSync(root+'/dbg-'+index.toString(16).padStart(32,'0')+'-annotation.json','{}');
 assert.throws(()=>f.value.ports.noteInput(id,sha,noteOp),/NOTE_BLOCKED/);assert.equal(fs.readdirSync(root).filter(name=>name.endsWith('-annotation.json')).length,129);
 assert.deepEqual(f.value.noteCalls,[]);f.module.disposeDebugCards();
});
test('actual notes core saves the full worst-escape attachment and the separate JSON-note reader never masquerades as schema6 MD',t=>{
 const disk=noteIoFixture(t),platform={'@kit.CoreFileKit':{fileIo:disk.io},'@kit.ArkTS':{util:{TextEncoder:class{encodeInto(text){return new TextEncoder().encode(text);}},TextDecoder:class{constructor(encoding,options){this.decoder=new TextDecoder(encoding,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}}},'./LifelogSession':{LifelogDayText:class{markdown='';total=0;transcribed=0;}}};
 const journal=loadApp('JournalExport',platform),summariesCore=loadApp('SavedJournalSummary',platform),notesCore=loadApp('JournalSummaryNotes',platform),day='2026-10-15',start=summariesCore.savedSummaryDayStart(day);
 disk.source.started=start+1000;disk.source.ended=start+61000;const original=disk.store.ensure(disk.source);disk.input.text='当天有效原文';disk.input.utterances[0].text=disk.input.text;
 disk.input.transcriptionState='complete';disk.input.coveredMs=60000;disk.input.sourceMs=60000;const row=disk.store.appendTranscript(original.material_id,original.revision,disk.input);
 const sources=new journal.JournalSources();sources.recordingItems=[{name:disk.source.name,created:disk.source.started,bytes:disk.source.audioBytes,textFile:'legacy.md'}];sources.material=()=>disk.store.read(row.material_id);
 const current=day=>journal.buildJournalDay(day,sources,''),base=current(start),full=journal.bindJournalSummary(base,current(start),'原始AI总结，不被人工附注覆盖');journal.writeJournalFile(disk.root,start,full.markdown);
 const summaries=new summariesCore.SavedJournalSummary({root:()=>disk.root,current}),notes=new notesCore.JournalSummaryNotes({root:()=>disk.root,summaries,freeze:(day,text)=>journal.writeJournalSnapshot(disk.root,day,text),now:()=>Date.UTC(2026,9,15,12)});
 const ref=summaries.list({day,limit:10,cursor:''}).items[0].reference,source=summaries.open(ref).source_sha256,input={operation_id:noteOp,parent:ref,source_sha256:source,text:'\u001f'.repeat(8192)};
 const f=fixture(false,summaries,notes,disk.io);f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:disk.root});const id='dbg-'+'b'.repeat(32),raw=JSON.stringify(input),sha=createHash('sha256').update(raw).digest('hex');fs.writeFileSync(disk.root+'/io-debug/'+id+'-annotation.json',raw);
 const loaded=f.value.ports.noteInput(id,sha,noteOp),receipt=f.value.ports.noteSave(loaded,false);assert.equal(receipt.state,'saved');assert.equal(receipt.can_open,true);assert.equal(receipt.created_at,'2026-10-15T12:00:00.000Z');
 const again=f.value.ports.noteSave(loaded,false);assert.equal(again.replayed,true);assert.deepEqual(JSON.parse(JSON.stringify(again.reference)),JSON.parse(JSON.stringify(receipt.reference)));
 const recordPath=disk.root+'/summary-notes-v1/'+day+'/'+noteOp+'/note.json',record=fs.readFileSync(recordPath);assert.ok(record.length<65536);assert.equal(JSON.parse(record).text,input.text);assert.equal(fs.readFileSync(disk.root+'/day-'+day+'.md','utf8'),full.markdown);
 const chunk=f.value.ports.noteRead(receipt.reference,'json',0,4000);assert.equal(chunk.format,'json');assert.equal(chunk.text.length,4000);assert.equal(chunk.has_more,true);assert.equal(chunk.reference.content_sha256,createHash('sha256').update(record).digest('hex'));
 assert.equal(f.value.ports.noteStatus(noteOp).state,'saved');assert.equal(f.value.ports.noteList({day,limit:10,cursor:''}).items.length,1);
 const pendingOp='noteop-'+day+'-'+'e'.repeat(32),pendingInput={...input,operation_id:pendingOp},rename=disk.io.renameSync;
 disk.io.renameSync=(from,to)=>{if(to.endsWith('/'+pendingOp+'/note.json'))throw Error('synthetic pending promotion failure');return rename(from,to);};
 assert.throws(()=>f.value.ports.noteSave(pendingInput,false),/NOTE_IO/);disk.io.renameSync=rename;
 const pending=f.value.ports.noteStatus(pendingOp);assert.equal(pending.state,'pending');const recovered=f.value.ports.notePending(pendingOp,pending.input_sha256);
 assert.equal(recovered.text,input.text);assert.equal(recovered.operation_id,pendingOp);assert.equal(f.value.ports.noteStatus(pendingOp).state,'pending','reading full pending input cannot commit');
 const pendingResult={schema:1,id:'dbg-'+'c'.repeat(32),request_json:JSON.stringify({schema:7,annotation:{operation_id:pendingOp,input_sha256:pending.input_sha256}}),summary_note_pending:recovered};
 assert.ok(Buffer.byteLength(JSON.stringify(pendingResult))<65536);assert.equal(f.value.ports.noteSave(recovered,true).state,'saved');
 disk.store.correctText(row.material_id,row.revision,row.utterances[0].utterance_id,'来源已修改');assert.throws(()=>f.value.ports.noteRead(receipt.reference,'md',0,4000),/NOTE_STALE/);
 assert.deepEqual(fs.readFileSync(recordPath),record);assert.deepEqual(f.value.noteCalls,[]);assert.deepEqual(f.calls,[]);f.module.disposeDebugCards();
});

test('actual recording summary core and actual debug controller share durable jobs, explicit cancellation/resume, bound chunks and fresh citations',async t=>{
 const disk=noteIoFixture(t),io=disk.io;io.listFileSync=fs.readdirSync;let requests=0,cancels=0;const finishes=[];
 const platform={'@kit.CoreFileKit':{fileIo:io},'@kit.ArkTS':{util:{TextEncoder:class{encodeInto(text){return new TextEncoder().encode(text);}},
  TextDecoder:class{constructor(label,options){this.value=new TextDecoder(label,options);}decodeToString(bytes){return this.value.decode(bytes);}}}}};
 const initial=disk.store.ensure(disk.source);disk.input.text='原文完整😀，不要发送旧方案。';disk.input.utterances[0].text=disk.input.text;disk.input.transcriptionState='partial';disk.input.coveredMs=20000;disk.input.sourceMs=60000;
 const row=disk.store.appendTranscript(initial.material_id,initial.revision,disk.input),plan=loadApp('RecordingSummaryPlan',platform),{RecordingSummaryService}=loadApp('RecordingSummary',platform);
 const config={model:'synthetic-configured-model',modelURL:'https://synthetic.invalid/v1/chat/completions',modelKey:'synthetic-no-real-credential'};
 const create=()=>new RecordingSummaryService({root:()=>disk.root,read:id=>disk.store.read(id),foreground:()=>true,config:async()=>config,cancel:()=>cancels++,now:()=>Date.now(),
  request:async(_config,_system,input)=>{requests++;const sent=JSON.parse(input);return new Promise(resolve=>finishes.push(()=>resolve(JSON.stringify({entries:[{category:'fact',text:'总结保留否定条件😀',evidence_ids:[sent.required_ids[0]]}],covered_ids:sent.required_ids}))));}});
 const core=create(),f=fixture(false,undefined,undefined,io,undefined,core);f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:disk.root});
 const {DebugCardControl}=loadApp('DebugCardControl'),control=new DebugCardControl(f.value.ports);control.enable(true);let sequence=0;
 const id='rsum-'+'9'.repeat(32),ref=plan.recordingSummaryReference(row);
 const issue=async(action,selection)=>{const now=Date.now(),request={schema:9,id:'dbg-'+(++sequence).toString(16).padStart(32,'0'),action:'recording-summary-'+action,created_at:new Date(now).toISOString(),expires_at:new Date(now+60000).toISOString(),expected_uid:'',recording_summary:selection};
  fs.writeFileSync(disk.root+'/io-debug/command.json',JSON.stringify(request));await control.poll();return JSON.parse(fs.readFileSync(disk.root+'/io-debug/'+request.id+'.json','utf8'));};
 const tickUntil=async(condition)=>{for(let n=0;n<100&&!condition();n++)await new Promise(setImmediate);assert(condition(),'synthetic asynchronous boundary should become observable');};
 try{
  assert.equal((await issue('preview',{reference:ref})).recording_summary_preview.transcription_state,'partial');assert.equal(requests,0);
  const started=await issue('start',{job_id:id,reference:ref,confirm_send:true});assert.equal(started.state,'complete');assert.notEqual(started.recording_summary_view.phase,'ready');await tickUntil(()=>finishes.length===1);
  const running=core.status(id);assert.equal(running.calls_used,1);const paused=await issue('cancel',{job_id:id,state_sha256:running.state_sha256});assert.equal(paused.recording_summary_view.phase,'paused');assert.equal(cancels,1);
  const cold=create().status(id);assert.equal(cold.phase,'paused');assert.equal(requests,1,'cold status never resumes or calls model');
  const resumed=await issue('resume',{job_id:id,state_sha256:paused.recording_summary_view.state_sha256,confirm_send:true});assert.equal(resumed.state,'complete');await tickUntil(()=>finishes.length===2);
  finishes[0]();await new Promise(setImmediate);assert.notEqual(core.status(id).phase,'ready','late result from cancelled generation cannot publish');
  finishes[1]();await tickUntil(()=>core.status(id).phase==='ready');const ready=(await issue('status',{job_id:id})).recording_summary_view;assert.equal(ready.calls_used,2);assert.equal(ready.transcription_state,'partial');assert.equal(ready.entries[0].category,'fact');
  const citation=await issue('citation',{job_id:id,state_sha256:ready.state_sha256,piece_id:'piece-0001'});assert.equal(citation.recording_summary_piece.text,disk.input.text);assert.equal(citation.recording_summary_piece.reference.content_sha256,ref.content_sha256);
  const chunk=await issue('read',{job_id:id,state_sha256:ready.state_sha256,format:'json',offset:0,max_chars:4000});assert.equal(chunk.state,'complete');assert.equal(chunk.recording_summary_chunk.state_sha256,ready.state_sha256);assert.equal(JSON.parse(chunk.recording_summary_chunk.text).entries[0].text,'总结保留否定条件😀');
  const listed=await issue('list',{material_id:ref.material_id,limit:1,cursor:''});assert.equal(listed.recording_summary_list.items.length,1);assert.deepEqual(listed.recording_summary_list.items[0].entries,[],'list is metadata only');
  const writes=fs.readdirSync(disk.root+'/recording-summaries-v1/'+id).filter(name=>name.endsWith('.json')&&name.startsWith('state-')).map(name=>fs.readFileSync(disk.root+'/recording-summaries-v1/'+id+'/'+name,'utf8')).join('');
  assert.equal(writes.includes(config.modelKey),false);assert.equal(writes.includes(config.modelURL),false);
  disk.store.correctText(row.material_id,row.revision,row.utterances[0].utterance_id,'已修订，旧引文不能复活');
  const changed=await issue('citation',{job_id:id,state_sha256:ready.state_sha256,piece_id:'piece-0001'});assert.equal(changed.error,'RECORDING_SUMMARY_STALE');assert.equal(changed.recording_summary_piece,undefined);
  const stale=(await issue('status',{job_id:id})).recording_summary_view;assert.equal(stale.phase,'stale');assert.equal(stale.generated_at,'');assert.deepEqual(stale.entries,[]);assert.equal(requests,2);assert.deepEqual(f.calls,[]);
 }finally{for(const finish of finishes)finish();core.suspend();control.dispose();f.module.disposeDebugCards();await new Promise(setImmediate);}
});

test('recording summary ports delegate all eight operations to the shared singleton with exact job/source/CAS and no device effects',async()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const p=f.value.ports,id='rsum-'+'a'.repeat(32),sha='b'.repeat(64),ref={material_id:'mat-recording-'+'c'.repeat(32),revision:2,text_revision:1,utterance_id:'part-1',content_sha256:'d'.repeat(64)};
 assert.equal(p.recordingSummaryPreview(ref).text_units,20);assert.equal((await p.recordingSummaryStart(id,ref)).phase,'queued');p.recordingSummaryStatus(id);p.recordingSummaryCancel(id,sha);await p.recordingSummaryResume(id,sha);
 p.recordingSummaryList(ref.material_id,3,sha+':0');p.recordingSummaryRead(id,sha,'json',2,4000);p.recordingSummaryCitation(id,'piece-0001',sha);
 assert.deepEqual(f.value.recordingSummaryCalls,[['preview',ref],['start',id,ref],['status',id],['cancel',id,sha],['resume',id,sha],['list',ref.material_id,3,sha+':0'],['chunk',id,sha,'json',2,4000],['citation',id,'piece-0001',sha]]);
 assert.deepEqual(f.calls,[]);assert.deepEqual(f.value.playbackCalls,[]);assert.deepEqual(f.value.noteCalls,[]);
});

test('playback ports use only the shared production singleton and pass exact source/session controls without starting capture',async()=>{
 const f=fixture();f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const p=f.value.ports,selection={kind:'lifelog',name:'seg-'+'a'.repeat(32),revision:2,utterance_id:'part-1'},id='playback-observed';
 assert.equal(p.playbackStatus().phase,'idle');assert.equal((await p.playbackPlay(selection)).audio_output_verified,false);
 await p.playbackPause(id);await p.playbackResume(id);await p.playbackSeek(id,2345);await p.playbackStop(id);
 assert.deepEqual(f.value.playbackCalls,[['status'],['play',selection],['pause',id],['resume',id],['seek',id,2345],['stop',id]]);
 assert.equal(f.value.recoveryInspections,0);assert.deepEqual(f.calls,[]);assert.deepEqual(f.value.queryCalls,[]);assert.deepEqual(f.value.noteCalls,[]);
 assert.equal(f.capture.active,true);assert.equal(f.record.stage,'voice_authorized');f.module.disposeDebugCards();
});

test('service uses the actual PlaybackController export for observed positions and rejects stale session controls without a controller substitute',async()=>{
 let next=0,callback,position=0,closed=0,created=0,nativeState='idle';const operations=[],checks=[];
 const {PlaybackController,PlaybackDriverEvent}=loadApp('PlaybackController',{'@kit.ArkTS':{util:{generateRandomUUID:()=>String(++next).padStart(32,'0')}}},
  {setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout});
 const event=(kind,native_state)=>{nativeState=native_state;callback(Object.assign(new PlaybackDriverEvent(),{kind,native_state,position_ms:position,duration_ms:10000}));};
 const controller=new PlaybackController({foreground:()=>true,resolve:selection=>({reference:{...selection,audio_sha256:'c'.repeat(64),format:'wav'},fd:77,length:100,start_ms:selection.revision?1000:0,
  check(strong){checks.push(strong);},close(){closed++;}}),create:()=>{created++;return{
   async prepare(lease,listener){callback=listener;operations.push(['prepare',lease.fd]);position=0;event('state','prepared');},
   async play(){operations.push(['play']);event('state','playing');},async pause(){operations.push(['pause']);event('state','paused');},
   async seek(target){operations.push(['seek',target]);position=target-7;event('seek_done',nativeState);},async release(){operations.push(['release']);event('release_done','released');}
  };}});
 const f=fixture(false,undefined,undefined,undefined,controller);f.module.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/private'});const p=f.value.ports;
 try{
  assert.equal(p.playbackStatus().phase,'idle');assert.equal(created,0,'read-only status creates no player');
  const selection={kind:'recording',name:'take-'+'a'.repeat(32),revision:2,utterance_id:'canonical-part'},playing=await p.playbackPlay(selection),id=playing.session_id;
  assert.match(id,/^playback-[a-f0-9]{32}$/);assert.equal(playing.phase,'playing');assert.equal(playing.position_ms,993,'anchor is resolved by the source lease, actual callback supplies position');
  assert.equal(playing.duration_ms,10000);assert.ok(playing.callback_seq>=3);assert.equal(playing.audio_output_verified,false);
  await p.playbackPause(id);const sought=await p.playbackSeek(id,5000);assert.equal(sought.phase,'paused');assert.equal(sought.position_ms,4993);
  await p.playbackResume(id);assert.equal(p.playbackStatus().phase,'playing');const before=JSON.stringify(operations);
  await assert.rejects(p.playbackStop('playback-stale'),/PLAYBACK_STALE_SESSION/);assert.equal(JSON.stringify(operations),before);assert.equal(closed,0);
  const stopped=await p.playbackStop(id);assert.equal(stopped.phase,'idle');assert.equal(closed,1);assert.equal(created,1);assert.ok(checks.includes(true));assert.ok(checks.includes(false));
  const visible=JSON.stringify(stopped);assert.equal(visible.includes('"fd"'),false);assert.equal(visible.includes('private'),false);
  assert.deepEqual(f.value.playbackCalls,[],'the actual controller, not the fixture playback module, handled every call');
  assert.equal(f.value.recoveryInspections,0);assert.deepEqual(f.calls,[]);assert.deepEqual(f.value.noteCalls,[]);assert.equal(f.capture.active,true);
 }finally{await controller.suspend('test_finished');f.module.disposeDebugCards();}
});
