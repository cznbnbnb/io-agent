import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const {DebugTaskSnapshot}=loadApp('DebugTaskSnapshot'),{TaskDecisionRecord,TaskReplyBinding}=loadApp('TaskReplyDraft');
 const binding=Object.assign(new TaskReplyBinding(),{context_key:'private-full-context',operation_id:'reply-original',request_id:'request-original',request_revision:3,
  task_id:'task-original',route:{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'original-session'},expires_at:new Date(Date.now()+60000).toISOString(),question:'private original question',mode:'free_text'});
 const record=Object.assign(new TaskDecisionRecord(),{binding,stage:'voice_authorized'});
 const voice={format:'turboio-task-voice/1',attempt_id:'voice-'+'a'.repeat(32),peer:'original-peer',reply:clone(binding)};
 const capture={active:true,phase:'listening',binding:JSON.stringify(voice),text:'private complete voice condition',exitEvidence:'none',observationRestored:false};
 const state={record,capture,paused:false,context:binding.context_key,device:'original-peer',foreground:true,canRecover:false,calls:[],
  review:{ready:false,reason:'not_reviewing',binding_sha256:''},source:undefined,sourceError:'',sourceReads:0};
 const controller=new DebugTaskSnapshot({capture:()=>clone(state.capture),draft:()=>clone(state.record),paused:()=>state.paused,
  context:()=>state.context,device:()=>state.device,foreground:()=>state.foreground,canRecover:()=>state.canRecover,
  async finish(){state.calls.push('finish');state.capture.phase='stopping';},cancel(){state.calls.push('cancel');state.paused=true;},
  async recover(){state.calls.push('recover');state.record.stage='review';state.record.input_source='voice';state.record.text=state.capture.text;},
  reviewStatus:()=>clone(state.review),async reviewCard(expected){if(expected!==state.review.binding_sha256)throw Error('TASK_REVIEW_BINDING_CHANGED');state.calls.push(['review-card',expected]);},
  sourceStatus(){state.sourceReads++;if(state.sourceError)throw Error(state.sourceError);return state.source;}});
 return{controller,state,voice};
}
test('task status binds full original identity and exposes only opaque text/token fingerprints',()=>{
 const f=fixture(),s=f.controller.status(),raw=JSON.stringify(s);
 assert.equal(s.request_id,'request-original');assert.equal(s.request_revision,3);assert.equal(s.task_id,'task-original');assert.equal(s.operation_id,'reply-original');
 assert.equal(s.binding_sha256,sha(f.state.capture.binding));assert.equal(s.attempt_id,f.voice.attempt_id);assert.equal(s.binding_applicable,true);assert.equal(s.capture_text_length,f.state.capture.text.length);
 assert.equal(s.capture_text_sha256,sha(f.state.capture.text));assert.equal(s.draft_saved,false);
 for(const secret of [f.state.capture.binding,f.state.record.binding.question,f.state.record.binding.context_key,f.state.capture.text])assert(!raw.includes(secret));
 assert.deepEqual(f.state.calls,[]);
});

test('current exact-bound startup measurements remain passive metadata and redact on restoration or binding mismatch',()=>{
 const f=fixture(),values={type1Packets:2,firstType1At:1001,micWriteStartedAt:1007,micWriteCompletedAt:1020,firstDecodedCompressedBytes:80,firstDecodedSamples:960};
 const mapping={type1_packets:'type1Packets',first_type1_at:'firstType1At',mic_write_started_at:'micWriteStartedAt',mic_write_completed_at:'micWriteCompletedAt',first_decoded_compressed_bytes:'firstDecodedCompressedBytes',first_decoded_samples:'firstDecodedSamples'};
 Object.assign(f.state.capture,values);let view=f.controller.status();assert.equal(view.capture_metrics_available,true);
 for(const [out,input] of Object.entries(mapping))assert.equal(view[out],values[input]);assert.equal(view.capture_active,true);assert.equal(view.exit_evidence,'none');assert.deepEqual(f.state.calls,[]);
 f.state.capture.micWriteCompletedAt=0;assert.equal(f.controller.status().mic_write_completed_at,0,'pending native write is not completion or microphone confirmation');
 Object.assign(f.state.capture,values,{observationRestored:true});view=f.controller.status();assert.equal(view.capture_metrics_available,false);for(const out of Object.keys(mapping))assert.equal(view[out],0);
 f.state.capture.observationRestored=false;f.voice.reply.request_revision++;f.state.capture.binding=JSON.stringify(f.voice);view=f.controller.status();assert.equal(view.binding_applicable,false);assert.equal(view.capture_metrics_available,false);
 for(const out of Object.keys(mapping))assert.equal(view[out],0);assert.deepEqual(f.state.calls,[]);
});

test('malformed startup measurements cannot disclose strings or invalid numeric observations',()=>{
 const f=fixture(),keys=['type1Packets','firstType1At','micWriteStartedAt','micWriteCompletedAt','firstDecodedCompressedBytes','firstDecodedSamples'];
 const outputs=['type1_packets','first_type1_at','mic_write_started_at','mic_write_completed_at','first_decoded_compressed_bytes','first_decoded_samples'];
 for(const value of [-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,'private startup payload',null,undefined]){
  for(const key of keys)f.state.capture[key]=value;const view=f.controller.status();for(const out of outputs)assert.equal(view[out],0);assert(!JSON.stringify(view).includes('private startup payload'));
 }
 assert.deepEqual(f.state.calls,[]);
});

test('actual DebugCardService maps startup fields through the existing passive task-status command',async()=>{
 const f=fixture(),values={type1Packets:2,firstType1At:1001,micWriteStartedAt:1007,micWriteCompletedAt:1020,firstDecodedCompressedBytes:80,firstDecodedSamples:960};
 Object.assign(f.state.capture,values);let ports;const calls=[],capture={active:true,state:f.state.capture};
 const service=loadApp('DebugCardService',{
  './DebugCardControl':{DebugCardControl:class{constructor(value){ports=value;}enable(){}dispose(){}},DebugCardState:class{}},
  './DeviceSettingsControl':{DeviceSettingsControl:class{}},'./DeviceSettingsService':{deviceSettingsPorts:()=>({})},
  './ChannelProbeService':{makeChannelProbeControl:()=>({})},'./NotificationService':{suggestionTests:{}},
   './DebugTaskSnapshot':loadApp('DebugTaskSnapshot'),'./AgentCaptureService':{agentCapture:capture},
   './TaskRecordingService':{taskRecordingCapture:{state:{active:false,phase:'idle',binding:'',text:'',exitEvidence:'none',transcriptStatus:'none'}}},
  './TaskService':{taskService:{decisionDraft:{snapshot:()=>f.state.record,paused:false},summary:()=>({contextKey:f.state.context}),sourceStatus:()=>undefined}},
  './TaskSuggestionService':{taskVoiceReplies:{canRecover:false,stop(){calls.push('stop');},cancel(){calls.push('cancel');},recover(){calls.push('recover');}},taskSuggestions:{reviewStatus:()=>f.state.review},taskDraftRecovery:{}},
  './ProbeSession':{probeSession:{foreground:true,features:{state:{connected:true}},peerDeviceId:'original-peer'}},
  './MaterialLocalQuery':{LocalMaterialQuery:class{}},'./LocalWorkspace':{localWorkspace:{}},'./RecordingService':{materials:{}}
 },{setTimeout:()=>1,clearTimeout(){}});
 service.initializeDebugCards({applicationInfo:{debug:true},filesDir:'/synthetic-debug'});
 const {DebugCardControl}=loadApp('DebugCardControl'),disk=new Map(),now=Date.now(),id='dbg-'+'c'.repeat(32);
 const command=JSON.stringify({schema:2,id,action:'task-status',created_at:new Date(now).toISOString(),expires_at:new Date(now+60000).toISOString(),expected_uid:'',expected_voice_binding:''});
 ports.command=()=>command;ports.result=key=>disk.get(key);ports.save=(key,raw)=>disk.set(key,raw);const control=new DebugCardControl(ports);control.enable(true);
 try{await control.poll();const result=JSON.parse(disk.get(id));assert.equal(result.state,'complete');
  const view=result.task_snapshot;assert(view,'the existing task-status result must contain the snapshot');
  assert.equal(view.capture_metrics_available,true);assert.equal(view.type1_packets,2);assert.equal(view.first_type1_at,1001);assert.equal(view.mic_write_started_at,1007);assert.equal(view.mic_write_completed_at,1020);assert.equal(view.first_decoded_compressed_bytes,80);assert.equal(view.first_decoded_samples,960);
  assert.deepEqual(calls,[]);assert.deepEqual(f.state.calls,[]);
 }finally{control.dispose();service.disposeDebugCards();}
});
test('old attempt hash and changed full token bytes never stop or recover a newer attempt',async()=>{
 const f=fixture(),old=f.controller.status().binding_sha256;f.voice.attempt_id='voice-'+'b'.repeat(32);f.state.capture.binding=JSON.stringify(f.voice);
 await assert.rejects(f.controller.perform('voice-finish',old),/BINDING_CHANGED/);const current=f.controller.status().binding_sha256;
 f.state.capture.binding=' '+f.state.capture.binding;await assert.rejects(f.controller.perform('voice-cancel',current),/BINDING_CHANGED/);assert.deepEqual(f.state.calls,[]);
});
test('recording transcribing state preserves exact task control identity while all unavailable audio measurements stay redacted',async()=>{
 const f=fixture(),{DebugVoiceState}=loadApp('DebugTaskSnapshot');assert.equal(new DebugVoiceState().metricsAvailable,true,'legacy assistant observations retain their default');
 Object.assign(f.state.capture,{active:true,phase:'transcribing',metricsAvailable:false,observationRestored:false,exitEvidence:'device_event',transcriptStatus:'pending',
  packets:245,pcmBytes:59520,nonzeroPackets:4,tailPackets:8,tailPcmBytes:100,lateAudioPackets:2,inputSealed:true,tailTimedOut:true,stopSubmitted:true,workerExited:true,
  recorderStop:'submitted',exitWrite:'submitted',exitReason:7,compressedPackets:245,compressedBytes:59520,repeatedCompressedPackets:241,lastCompressedSha256:'a'.repeat(64),
  firstAudioAt:1001,lastAudioAt:15001,stopRequestedAt:15002,inputSealedAt:15003,pcmRms:0.115,pcmPeak:22,type1Packets:2,firstType1At:999,
  micWriteStartedAt:1000,micWriteCompletedAt:1011,firstDecodedCompressedBytes:240,firstDecodedSamples:960});
 const view=f.controller.status();assert.equal(view.capture_phase,'transcribing');assert.equal(view.capture_active,true);assert.equal(view.binding_applicable,true);
 assert.equal(view.binding_sha256,sha(f.state.capture.binding));assert.equal(view.capture_metrics_available,false);assert.equal(view.observation_restored,false);assert.equal(view.exit_evidence,'device_event');assert.equal(view.transcript_status,'pending');
 for(const key of ['capture_packets','pcm_bytes','nonzero_packets','tail_packets','tail_pcm_bytes','late_audio_packets','compressed_packets','compressed_bytes','repeated_compressed_packets',
  'first_audio_at','last_audio_at','stop_requested_at','input_sealed_at','pcm_rms','pcm_peak','type1_packets','first_type1_at','mic_write_started_at','mic_write_completed_at','first_decoded_compressed_bytes','first_decoded_samples'])assert.equal(view[key],0);
 for(const key of ['input_sealed','tail_timed_out','stop_submitted','worker_exited'])assert.equal(view[key],false);assert.equal(view.last_compressed_sha256,'');assert.equal(view.recorder_stop,'not_attempted');assert.equal(view.exit_write,'not_attempted');assert.equal(view.exit_reason,-1);
 assert(!JSON.stringify(view).includes(f.state.capture.text));assert.deepEqual(f.state.calls,[]);
 f.voice.attempt_id='voice-'+'b'.repeat(32);f.state.capture.binding=JSON.stringify(f.voice);await assert.rejects(f.controller.perform('voice-finish',view.binding_sha256),/BINDING_CHANGED/);
 assert.deepEqual(f.state.calls,[]);await f.controller.perform('voice-finish',f.controller.status().binding_sha256);assert.deepEqual(f.state.calls,['finish']);assert.equal(f.state.record.stage,'voice_authorized');
});
test('full original binding, peer and context mismatches redact capture linkage and reject controls',async()=>{
 const mutations=[f=>f.voice.reply.request_revision++,f=>f.voice.reply.route.session_id='other-session',f=>f.voice.reply.operation_id='other-operation',
  f=>f.voice.reply.question='changed-question',f=>f.voice.reply.expires_at=new Date(Date.now()+120000).toISOString(),
  f=>f.state.device='other-peer',f=>f.state.context='other-profile',f=>f.voice.extra='unexpected'];
 for(const mutate of mutations){const f=fixture();mutate(f);f.state.capture.binding=JSON.stringify(f.voice);const s=f.controller.status();
  assert.equal(s.binding_applicable,false);assert.equal(s.binding_sha256,'');assert.equal(s.attempt_id,'');assert.equal(s.capture_text_length,0);assert.equal(s.can_recover,false);
  await assert.rejects(f.controller.perform('voice-cancel',sha(f.state.capture.binding)),/BINDING_CHANGED/);assert.deepEqual(f.state.calls,[]);}
});
test('finish completion is separate from durable complete original draft, and cancel never cancels the computer task',async()=>{
 const f=fixture(),hash=f.controller.status().binding_sha256;await f.controller.perform('voice-finish',hash);
 assert.equal(f.controller.status().capture_phase,'stopping');assert.equal(f.controller.status().draft_saved,false);
 await f.controller.perform('voice-cancel',hash);assert.deepEqual(f.state.calls,['finish','cancel']);assert.equal(f.state.record.stage,'voice_authorized');assert.equal(f.state.record.text,'');
});
test('recover uses existing service, preserves full text fingerprint, and still never submits an answer',async()=>{
 const f=fixture();f.state.paused=true;Object.assign(f.state.capture,{active:false,phase:'draft',exitEvidence:'device_event'});f.state.canRecover=true;
 assert.equal(f.controller.status().can_recover,true);await f.controller.perform('voice-recover',f.controller.status().binding_sha256);
 const s=f.controller.status();assert.equal(s.draft_saved,true);assert.equal(s.draft_text_length,f.state.capture.text.length);assert.equal(s.draft_text_sha256,sha(f.state.capture.text));assert.deepEqual(f.state.calls,['recover']);
});
test('copied original voice draft remains saved after capture is cleared, but unrelated capture cannot assert this result',async()=>{
 const f=fixture();Object.assign(f.state.record,{stage:'review',text:'full original text',input_source:'voice'});
 Object.assign(f.state.capture,{active:false,phase:'idle',binding:'',text:''});assert.equal(f.controller.status().draft_saved,true);
 await assert.rejects(f.controller.perform('voice-finish','a'.repeat(64)),/BINDING_CHANGED/);
 f.state.capture.binding=JSON.stringify({...f.voice,attempt_id:'voice-'+'b'.repeat(32),reply:{...f.voice.reply,request_id:'other-request'}});
 assert.equal(f.controller.status().draft_saved,false);f.state.capture.binding='';f.state.context='another-profile';assert.equal(f.controller.status().draft_saved,false);assert.deepEqual(f.state.calls,[]);
});
test('background or unknown actions never reach voice ports even with matching CAS',async()=>{
 const f=fixture(),hash=f.controller.status().binding_sha256;f.state.foreground=false;await assert.rejects(f.controller.perform('voice-finish',hash),/BINDING_CHANGED/);
 f.state.foreground=true;for(const action of ['voice-start','submit','set-stage','semantic-cmd'])await assert.rejects(f.controller.perform(action,hash),/COMMAND_INVALID/);assert.deepEqual(f.state.calls,[]);
});
test('exact-bound capture exposes sound, tail and exit observations separately without body or raw audio',()=>{
 const f=fixture();Object.assign(f.state.capture,{packets:245,pcmBytes:156800,nonzeroPackets:3,tailPackets:4,tailPcmBytes:2560,lateAudioPackets:2,
  inputSealed:true,tailTimedOut:false,stopSubmitted:true,workerExited:true,recorderStop:'submitted',exitWrite:'submitted',exitReason:7,
  exitEvidence:'device_event',raw_audio:'private audio bytes never exposed'});
 const s=f.controller.status();assert.equal(s.capture_packets,245);assert.equal(s.pcm_bytes,156800);assert.equal(s.nonzero_packets,3);
 assert.equal(s.capture_metrics_available,true);
 assert.equal(s.tail_packets,4);assert.equal(s.tail_pcm_bytes,2560);assert.equal(s.late_audio_packets,2);assert.equal(s.input_sealed,true);assert.equal(s.tail_timed_out,false);
 assert.equal(s.stop_submitted,true);assert.equal(s.worker_exited,true);assert.equal(s.recorder_stop,'submitted');assert.equal(s.exit_write,'submitted');assert.equal(s.exit_reason,7);
 assert.equal(s.exit_evidence,'device_event');assert.equal(s.draft_saved,false);assert.equal(s.capture_active,true);
 const raw=JSON.stringify(s);for(const secret of [f.state.capture.binding,f.state.capture.text,f.state.record.binding.question,f.state.record.binding.context_key,f.state.capture.raw_audio])assert(!raw.includes(secret));
 assert.deepEqual(f.state.calls,[]);
});
test('transport stop, ASR worker exit and sealed input never fabricate device exit or a saved draft',()=>{
 const f=fixture();Object.assign(f.state.capture,{phase:'cleanup_pending',packets:12,tailPackets:0,inputSealed:true,tailTimedOut:true,stopSubmitted:true,workerExited:true,
  recorderStop:'submitted',exitWrite:'submitted',exitReason:-1,exitEvidence:'none'});
 const s=f.controller.status();assert.equal(s.capture_phase,'cleanup_pending');assert.equal(s.input_sealed,true);assert.equal(s.tail_timed_out,true);assert.equal(s.stop_submitted,true);
 assert.equal(s.worker_exited,true);assert.equal(s.exit_reason,-1);assert.equal(s.exit_evidence,'none');assert.equal(s.draft_saved,false);
});
test('missing or malformed observations become safe numeric/enum defaults, never unchecked strings',()=>{
 const f=fixture();Object.assign(f.state.capture,{packets:-1,pcmBytes:'private payload',nonzeroPackets:NaN,tailPackets:1.5,tailPcmBytes:Number.MAX_SAFE_INTEGER+1,
  lateAudioPackets:Infinity,inputSealed:'true',tailTimedOut:1,stopSubmitted:'yes',workerExited:[],recorderStop:'private condition',exitWrite:null,exitReason:0,
  phase:'private condition',exitEvidence:'private condition'});
 const s=f.controller.status();for(const key of ['capture_packets','pcm_bytes','nonzero_packets','tail_packets','tail_pcm_bytes','late_audio_packets'])assert.equal(s[key],0);
 for(const key of ['input_sealed','tail_timed_out','stop_submitted','worker_exited'])assert.equal(s[key],false);
 assert.equal(s.recorder_stop,'not_attempted');assert.equal(s.exit_write,'not_attempted');assert.equal(s.exit_reason,-1);assert.equal(s.capture_phase,'unknown');assert.equal(s.exit_evidence,'none');
 assert(!JSON.stringify(s).includes('private condition'));assert(!JSON.stringify(s).includes('private payload'));
 const empty=fixture().controller.status();assert.equal(empty.capture_packets,0);assert.equal(empty.input_sealed,false);assert.equal(empty.worker_exited,false);assert.equal(empty.exit_reason,-1);
});
test('foreign capture observations are not attributed to the current original task',()=>{
 const f=fixture();Object.assign(f.state.capture,{packets:999,pcmBytes:45678,nonzeroPackets:777,tailPackets:22,tailPcmBytes:888,lateAudioPackets:9,
  inputSealed:true,tailTimedOut:true,stopSubmitted:true,workerExited:true,recorderStop:'submitted',exitWrite:'submitted',exitReason:7});
 f.voice.reply.request_id='foreign-request';f.state.capture.binding=JSON.stringify(f.voice);
 const s=f.controller.status();assert.equal(s.binding_applicable,false);assert.equal(s.binding_sha256,'');assert.equal(s.attempt_id,'');assert.equal(s.capture_text_length,0);assert.equal(s.capture_text_sha256,'');
 assert.equal(s.capture_metrics_available,false);
 for(const key of ['capture_packets','pcm_bytes','nonzero_packets','tail_packets','tail_pcm_bytes','late_audio_packets'])assert.equal(s[key],0);
 for(const key of ['input_sealed','tail_timed_out','stop_submitted','worker_exited'])assert.equal(s[key],false);assert.equal(s.exit_reason,-1);assert.equal(s.recorder_stop,'not_attempted');assert.equal(s.exit_write,'not_attempted');
});
test('a saved original draft after capture clearing does not claim terminal audio measurements',()=>{
 const f=fixture();Object.assign(f.state.record,{stage:'review',text:'complete original condition',input_source:'voice'});
 Object.assign(f.state.capture,{binding:'',phase:'idle',active:false,text:'',packets:0,pcmBytes:0,tailPackets:0,inputSealed:true,workerExited:true});
 const s=f.controller.status();assert.equal(s.draft_saved,true);assert.equal(s.capture_metrics_available,false);assert.equal(s.capture_packets,0);
 assert.equal(s.tail_packets,0);assert.equal(s.input_sealed,false);assert.equal(s.worker_exited,false);assert.equal(s.binding_sha256,'');
});

test('review status consumes the normal business full-reply fingerprint, independently of a cleared voice attempt',()=>{
 const f=fixture(),hash=sha('normal business owns full original binding and exact answer');
 Object.assign(f.state.record,{stage:'review',text:'private final answer',input_source:'voice'});
 Object.assign(f.state.capture,{binding:'',phase:'idle',active:false,text:''});
 f.state.review={ready:true,reason:'ready',binding_sha256:hash,body:'private final answer',context:'private full context'};
 const s=f.controller.status();assert.equal(s.review_ready,true);assert.equal(s.review_block_reason,'ready');assert.equal(s.reply_binding_sha256,hash);
 assert.equal(s.binding_sha256,'');assert.equal(s.draft_saved,true);assert.equal(s.capture_metrics_available,false);
 const raw=JSON.stringify(s);assert(!raw.includes('private final answer'));assert(!raw.includes('private full context'));assert.deepEqual(f.state.calls,[]);
});

test('review status exposes only fixed reasons and valid hashes, and malformed readiness never permits display',()=>{
 const f=fixture(),hash='a'.repeat(64);
 const reasons=['no_draft','protected','not_reviewing','paused','cleanup_pending','busy','not_foreground','identity_changed','expired',
  'peer_unavailable','unavailable','invalid_request','title_too_long','content_too_long','invalid_copy','uid_limit','source_unverified'];
 for(const reason of reasons){f.state.review={ready:false,reason,binding_sha256:''};const s=f.controller.status();assert.equal(s.review_ready,false);assert.equal(s.review_block_reason,reason);}
 for(const review of [{ready:true,reason:'private answer text',binding_sha256:hash},{ready:true,reason:'ready',binding_sha256:'private full token'},
  {ready:'true',reason:'ready',binding_sha256:hash},{ready:true,reason:'ready',binding_sha256:'A'.repeat(64)},null]){
  f.state.review=review;const s=f.controller.status();assert.equal(s.review_ready,false);assert.equal(s.review_block_reason,'unavailable');
  assert(!JSON.stringify(s).includes('private answer text'));assert(!JSON.stringify(s).includes('private full token'));
 }
});

test('review display passes only the opaque full reply CAS to normal business and cannot finish, recover or submit',async()=>{
 const f=fixture(),hash=sha('full original reply plus exact final answer');f.state.review={ready:true,reason:'ready',binding_sha256:hash};
 for(const invalid of ['',hash.slice(1),'A'.repeat(64),'private final answer'])await assert.rejects(f.controller.performReview(invalid),/BINDING_CHANGED/);
 f.state.foreground=false;await assert.rejects(f.controller.performReview(hash),/BINDING_CHANGED/);assert.deepEqual(f.state.calls,[]);
 f.state.foreground=true;await assert.rejects(f.controller.performReview(f.controller.status().binding_sha256),/BINDING_CHANGED/);
 await f.controller.performReview(hash);assert.deepEqual(f.state.calls,[['review-card',hash]]);assert.equal(f.state.record.stage,'voice_authorized');assert.equal(f.state.record.text,'');
});

test('current exact-bound capture exposes bounded compressed, timing and amplitude observations without frames or words',()=>{
 const f=fixture(),frameHash=sha('private compressed frame');
 Object.assign(f.state.capture,{compressedPackets:245,compressedBytes:12345,repeatedCompressedPackets:241,lastCompressedSha256:frameHash,
  firstAudioAt:1760000000001,lastAudioAt:1760000015000,stopRequestedAt:1760000015001,inputSealedAt:1760000015500,pcmRms:12.75,pcmPeak:32768,
  transcriptStatus:'partial',boundaryEvidence:'quiet_after_stop',compressedFrame:'private compressed frame',rawPcm:'private original PCM'});
 const s=f.controller.status();assert.equal(s.capture_metrics_available,true);assert.equal(s.observation_restored,false);
 assert.equal(s.compressed_packets,245);assert.equal(s.compressed_bytes,12345);assert.equal(s.repeated_compressed_packets,241);assert.equal(s.last_compressed_sha256,frameHash);
 assert.equal(s.first_audio_at,1760000000001);assert.equal(s.last_audio_at,1760000015000);assert.equal(s.stop_requested_at,1760000015001);assert.equal(s.input_sealed_at,1760000015500);
 assert.equal(s.pcm_rms,12.75);assert.equal(s.pcm_peak,32768);assert.equal(s.transcript_status,'partial');assert.equal(s.boundary_evidence,'quiet_after_stop');
 const raw=JSON.stringify(s);for(const secret of [f.state.capture.compressedFrame,f.state.capture.rawPcm,f.state.capture.text,f.state.capture.binding])assert(!raw.includes(secret));
 assert.deepEqual(f.state.calls,[]);
});

test('restored original result retains explicit transcript and boundary state while all current measurements remain unavailable',()=>{
 const f=fixture();Object.assign(f.state.capture,{active:false,phase:'draft',observationRestored:true,packets:245,pcmBytes:156800,nonzeroPackets:3,
  tailPackets:9,tailPcmBytes:5760,lateAudioPackets:2,compressedPackets:245,compressedBytes:12345,repeatedCompressedPackets:241,lastCompressedSha256:'a'.repeat(64),
  firstAudioAt:1760000000001,lastAudioAt:1760000015000,stopRequestedAt:1760000015001,inputSealedAt:1760000015500,pcmRms:12.75,pcmPeak:32768,
  transcriptStatus:'partial',boundaryEvidence:'quiet_after_stop',inputSealed:true,workerExited:true,stopSubmitted:true,exitReason:7});
 const s=f.controller.status();assert.equal(s.binding_applicable,true);assert.equal(s.observation_restored,true);assert.equal(s.capture_metrics_available,false);
 assert.equal(s.transcript_status,'partial');assert.equal(s.boundary_evidence,'quiet_after_stop');assert.equal(s.last_compressed_sha256,'');
 for(const key of ['capture_packets','pcm_bytes','nonzero_packets','tail_packets','tail_pcm_bytes','late_audio_packets','compressed_packets','compressed_bytes',
  'repeated_compressed_packets','first_audio_at','last_audio_at','stop_requested_at','input_sealed_at','pcm_rms','pcm_peak'])assert.equal(s[key],0);
 assert.equal(s.input_sealed,false);assert.equal(s.worker_exited,false);assert.equal(s.stop_submitted,false);assert.equal(s.exit_reason,-1);assert.deepEqual(f.state.calls,[]);
});

test('foreign capture cannot attribute compressed measurements, transcript status or restored evidence to the current task',()=>{
 const f=fixture();Object.assign(f.state.capture,{compressedPackets:77,compressedBytes:999,repeatedCompressedPackets:76,lastCompressedSha256:'b'.repeat(64),
  firstAudioAt:11,lastAudioAt:22,stopRequestedAt:23,inputSealedAt:24,pcmRms:12,pcmPeak:123,transcriptStatus:'complete',boundaryEvidence:'device_event',observationRestored:true});
 f.voice.reply.route.session_id='foreign-session';f.state.capture.binding=JSON.stringify(f.voice);
 const s=f.controller.status();assert.equal(s.binding_applicable,false);assert.equal(s.capture_metrics_available,false);assert.equal(s.observation_restored,false);
 assert.equal(s.transcript_status,'none');assert.equal(s.boundary_evidence,'none');assert.equal(s.last_compressed_sha256,'');
 for(const key of ['compressed_packets','compressed_bytes','repeated_compressed_packets','first_audio_at','last_audio_at','stop_requested_at','input_sealed_at','pcm_rms','pcm_peak'])assert.equal(s[key],0);
 assert.equal(s.attempt_id,'');assert.equal(s.binding_sha256,'');assert.equal(s.capture_text_length,0);assert.deepEqual(f.state.calls,[]);
});

test('compressed counts, times, hash and PCM levels reject malformed observations with safe defaults',()=>{
 const f=fixture();Object.assign(f.state.capture,{compressedPackets:-1,compressedBytes:1.5,repeatedCompressedPackets:'private packet bytes',lastCompressedSha256:'private compressed frame',
  firstAudioAt:-1,lastAudioAt:Number.MAX_SAFE_INTEGER+1,stopRequestedAt:1.25,inputSealedAt:'private timestamp',pcmRms:NaN,pcmPeak:32769,
  transcriptStatus:'private transcript',boundaryEvidence:'private raw cause'});
 const s=f.controller.status();for(const key of ['compressed_packets','compressed_bytes','repeated_compressed_packets','first_audio_at','last_audio_at','stop_requested_at','input_sealed_at','pcm_rms','pcm_peak'])assert.equal(s[key],0);
 assert.equal(s.last_compressed_sha256,'');assert.equal(s.transcript_status,'none');assert.equal(s.boundary_evidence,'none');assert(!JSON.stringify(s).includes('private packet bytes'));
 for(const invalid of [-1,Infinity,-Infinity,NaN,'123',null,true,32768.01]){
  f.state.capture.pcmRms=invalid;f.state.capture.pcmPeak=invalid;const view=f.controller.status();assert.equal(view.pcm_rms,0);assert.equal(view.pcm_peak,0);
 }
 for(const valid of [0,0.125,32767.99,32768]){
  f.state.capture.pcmRms=valid;f.state.capture.pcmPeak=valid;const view=f.controller.status();assert.equal(view.pcm_rms,valid);assert.equal(view.pcm_peak,valid);
 }
 for(const hash of ['', 'a'.repeat(63),'a'.repeat(65),'A'.repeat(64),'g'.repeat(64)]){f.state.capture.lastCompressedSha256=hash;assert.equal(f.controller.status().last_compressed_sha256,'');}
});

test('transcript and boundary enums remain independent of saved-draft, device-exit and task-completion claims',()=>{
 const f=fixture();for(const transcriptStatus of ['none','pending','complete','partial','cancelled','legacy']){
  for(const boundaryEvidence of ['none','device_event','quiet_after_stop','limit','cancelled']){
   Object.assign(f.state.capture,{transcriptStatus,boundaryEvidence});const s=f.controller.status();
   assert.equal(s.transcript_status,transcriptStatus);assert.equal(s.boundary_evidence,boundaryEvidence);assert.equal(s.exit_evidence,'none');assert.equal(s.draft_saved,false);assert.equal(s.stage,'voice_authorized');
  }
 }
 for(const observationRestored of [undefined,null,'false',0,1]){
  f.state.capture.observationRestored=observationRestored;f.state.capture.compressedPackets=999;const s=f.controller.status();assert.equal(s.capture_metrics_available,false);assert.equal(s.compressed_packets,0);
 }
 assert.deepEqual(f.state.calls,[]);
});

function sourceFixture(){
 const f=fixture(),{TaskVoiceSourceRef}=loadApp('TaskVoiceSourceRef');
 const ref=Object.assign(new TaskVoiceSourceRef(),{attempt_id:'voice-'+'c'.repeat(32),peer:'private-original-source-peer',
  connection_epoch:'boot-'+'d'.repeat(32)+':7',binding_sha256:sha('source receipt full original binding'),text_sha256:sha('private copied voice condition')});
 Object.assign(f.state.record,{stage:'review',text:'private copied voice condition',input_source:'voice',voice_source:clone(ref)});
 Object.assign(f.state.capture,{binding:'',phase:'idle',active:false,text:''});
 f.state.source={state:'tainted',reason:'source_not_current',attempt_id:ref.attempt_id,binding_sha256:ref.binding_sha256,text_sha256:ref.text_sha256,
  late_packets:2,dispatch_started:true,delivery_uncertain:true};
 return{...f,ref};
}
function assertRedactedSource(view){
 assert.equal(view.source_attempt_id,'');assert.equal(view.source_binding_sha256,'');assert.equal(view.source_text_sha256,'');
 assert.equal(view.source_late_packets,0);assert.equal(view.source_dispatch_started,false);assert.equal(view.source_delivery_uncertain,false);
}

test('source status exposes only its fixed state enum and source_unverified remains a review blocking reason',()=>{
 const f=sourceFixture();for(const state of ['missing','legacy','unknown','tainted','blocked','watching','independent_phone','independent_choice']){
  f.state.source.state=state;const view=f.controller.status();assert.equal(view.source_state,state);assert.equal(view.draft_saved,true);
 }
 f.state.review={ready:false,reason:'source_unverified',binding_sha256:''};const view=f.controller.status();
 assert.equal(view.review_block_reason,'source_unverified');assert.equal(view.review_ready,false);assert.equal(view.draft_saved,true);
 assert.deepEqual(f.state.calls,[]);
});

test('a matching current source ref exposes hash-only late and dispatch metadata independently of a cleared capture',()=>{
 const f=sourceFixture();Object.assign(f.state.source,{text:f.state.record.text,token:JSON.stringify(f.voice),peer:f.ref.peer,connection_epoch:f.ref.connection_epoch,
  context:f.state.record.binding.context_key,question:f.state.record.binding.question,raw_audio:'private raw audio'});
 const before=clone(f.state.record),source=clone(f.state.source),view=f.controller.status(),raw=JSON.stringify(view);
 assert.equal(view.source_state,'tainted');assert.equal(view.source_reason,'source_not_current');assert.equal(view.source_attempt_id,f.ref.attempt_id);
 assert.equal(view.source_binding_sha256,f.ref.binding_sha256);assert.equal(view.source_text_sha256,f.ref.text_sha256);assert.equal(view.source_late_packets,2);
 assert.equal(view.source_dispatch_started,true);assert.equal(view.source_delivery_uncertain,true);assert.equal(view.draft_saved,true);
 assert.equal(view.capture_metrics_available,false);assert.equal(view.binding_sha256,'');assert.equal(view.attempt_id,'');
 for(const secret of [f.state.record.text,JSON.stringify(f.voice),f.ref.peer,f.ref.connection_epoch,f.state.record.binding.context_key,f.state.record.binding.question,'private raw audio'])assert(!raw.includes(secret));
 assert.deepEqual(clone(f.state.record),before);assert.deepEqual(f.state.source,source);assert.deepEqual(f.state.calls,[]);
});

test('foreign source identity cannot attribute hashes or delivery observations to the current saved voice answer',()=>{
 const f=sourceFixture();for(const key of ['attempt_id','binding_sha256','text_sha256']){
  const original=f.state.source[key];f.state.source[key]=key==='attempt_id'?'voice-'+'f'.repeat(32):'f'.repeat(64);
  f.state.source.state='watching';const view=f.controller.status();assertRedactedSource(view);
  assert.notEqual(view.source_state,'watching','a foreign view cannot imply the current answer is trusted');
  assert.equal(view.draft_saved,true);f.state.source[key]=original;
 }
 f.state.context='other-private-context';const view=f.controller.status();assertRedactedSource(view);assert.equal(view.source_state,'unavailable');assert.equal(view.draft_saved,false);
 assert.deepEqual(f.state.calls,[]);
});

test('malformed current refs never make matching unchecked source strings into trusted metadata',()=>{
 const f=sourceFixture(),invalid=[ref=>ref.schema=2,ref=>ref.attempt_id='private token',ref=>ref.peer='',ref=>ref.peer='x'.repeat(257),
  ref=>ref.connection_epoch=7,ref=>ref.connection_epoch='',ref=>ref.binding_sha256='private body',ref=>ref.text_sha256='A'.repeat(64),ref=>ref.extra='private unchecked token'];
 for(const mutate of invalid){
  const ref=clone(f.ref);mutate(ref);f.state.record.voice_source=ref;
  Object.assign(f.state.source,{state:'watching',attempt_id:ref.attempt_id,binding_sha256:ref.binding_sha256,text_sha256:ref.text_sha256});
  const view=f.controller.status();assertRedactedSource(view);assert.notEqual(view.source_state,'watching');assert.equal(view.draft_saved,true);
  const raw=JSON.stringify(view);for(const secret of ['private token','private body','private unchecked token',f.ref.peer])assert(!raw.includes(secret));
 }
 assert.deepEqual(f.state.calls,[]);
});

test('source counters, flags, invalid state and observation exceptions remain safe metadata without body or control effects',()=>{
 const f=sourceFixture();for(const count of [-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,'private body',null]){
  Object.assign(f.state.source,{late_packets:count,dispatch_started:'true',delivery_uncertain:1});const view=f.controller.status();
  assert.equal(view.source_late_packets,0);assert.equal(view.source_dispatch_started,false);assert.equal(view.source_delivery_uncertain,false);assert(!JSON.stringify(view).includes('private body'));
 }
 for(const reason of ['private body and token',undefined,null,7,true,[],{},
  {private_body:'private unchecked source body',toString(){return'source_not_current';}}]){
  f.state.source.reason=reason;const view=f.controller.status();assert.equal(view.source_reason,'');assert(!JSON.stringify(view).includes('private unchecked source body'));
 }
 for(const value of [undefined,null,{},[],{state:'private raw token'},{state:'watching',reason:'private\nbody'}]){
  f.state.source=value;const view=f.controller.status();assertRedactedSource(view);assert.notEqual(view.source_state,'watching');
  assert(!JSON.stringify(view).includes('private raw token'));assert(!JSON.stringify(view).includes('private\nbody'));
 }
 f.state.sourceError='private source exception body';let view=f.controller.status();assert.equal(view.source_state,'unavailable');assertRedactedSource(view);
 assert(!JSON.stringify(view).includes(f.state.sourceError));f.state.sourceError='';
 f.state.source={get state(){throw Error('private getter token');}};view=f.controller.status();assert.equal(view.source_state,'unavailable');assertRedactedSource(view);
 assert(!JSON.stringify(view).includes('private getter token'));assert.deepEqual(f.state.calls,[]);
});

test('saved legacy or no-ref voice text remains saved while no source observation can claim current provenance',()=>{
 const f=sourceFixture();for(const schema of [1,2])for(const ref of [null,undefined]){
  f.state.record.schema=schema;if(ref===undefined)delete f.state.record.voice_source;else f.state.record.voice_source=ref;
  for(const state of ['legacy','unknown','watching']){
   f.state.source.state=state;const view=f.controller.status();assert.equal(view.draft_saved,true);assertRedactedSource(view);
   assert.notEqual(view.source_state,'watching','old complete text is preserved without inventing trusted source evidence');
  }
 }
 assert.deepEqual(f.state.calls,[]);
});
