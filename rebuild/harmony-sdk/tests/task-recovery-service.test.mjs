import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

test('real service republishes the retained card lease after cold recovery reveals its original cleanup UID',()=>{
 let record,recoveryPorts;const effects={device:0,network:0,enqueue:0,microphone:0,ui:0};
 const draft={blocked:true,paused:true,snapshot:()=>record,pause(){this.paused=true;}};
 class RecoveryPortProbe{constructor(value,ports){assert.equal(value,draft);recoveryPorts=ports;}initialize(){}}
 const probe={foreground:true,peerDeviceId:'synthetic-peer',features:{state:{connected:true},displayActive:false},
  voice:{active:false},agentCaptureOccupied:false,agentSuggestionOccupied:false,
  recordingOccupied:()=>false,lifelogOccupied:()=>false,prompterOccupied:()=>false,
  auth:{sendBusiness(){effects.device++;throw Error('unexpected BLE');}}};
 const diagnostic={active:false},capture={active:false,state:{phase:'idle',binding:'',text:'',savedDraftValid:false,exitEvidence:'none'},
  start(){effects.microphone++;throw Error('unexpected microphone');}};
 const taskService={decisionDraft:draft,summary:()=>({contextKey:'synthetic-context'}),
  validateReply(){throw Error('recovery notification cannot validate or send a request');},
  revalidateReply(){effects.network++;throw Error('unexpected request');},
  answerBound(){effects.enqueue++;throw Error('unexpected enqueue');}};
 const mod=loadApp('TaskSuggestionService',{
  './TaskDraftRecovery':{TaskDraftRecovery:RecoveryPortProbe},'./ProbeSession':{probeSession:probe},'./TaskService':{taskService},
  './AgentCaptureService':{agentCapture:capture,agentCaptureView:{}},
  './NotificationService':{notifications:{busy:false,waiting:false},suggestionTests:diagnostic}
 });
 mod.taskSuggestionView.changed=()=>{effects.ui++;};mod.initializeTaskSuggestions('synthetic-files');
 try{
  assert.equal(probe.agentSuggestionOccupied,false,'a cold blocked draft exposes no snapshot or lease yet');
  recoveryPorts.suspend();assert.equal(probe.agentSuggestionOccupied,false);
  // The transaction reloads its preserved UID after archiving both originals.
  // The real singleton receives that result through its constructor port.
  record={cleanup_uid:'synthetic-operation-original-card',cleanup_peer:'synthetic-peer',card_stage:'review'};
  draft.blocked=false;draft.paused=true;assert.equal(mod.taskSuggestions.active,true);
  recoveryPorts.changed();
  assert.equal(probe.agentSuggestionOccupied,true,'the retained UID must claim shared occupancy before another capture or notification can start');
  assert.equal(effects.ui,2);assert.deepEqual({...effects,ui:0},{device:0,network:0,enqueue:0,microphone:0,ui:0});
 }finally{
  // Disposal must not ask the native transport to clear the synthetic UID.
  record=undefined;mod.disposeTaskSuggestions();
  assert.deepEqual({...effects,ui:0},{device:0,network:0,enqueue:0,microphone:0,ui:0});
 }
});
