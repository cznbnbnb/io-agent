import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './load-app.mjs';

test('Ability runtime initializes once, routes devices without a page, and disposes its worker', async () => {
  let workers = 0, closed = 0, starts = 0, stops = 0, recordingInitializations = 0, received = 0, coordinators=0, coordinatorStops=0, lifelogDisposes=0;
  let taskInitializations=0,taskDisposals=0,cardReceives=0,cardPauses=0,cardInitializations=0,cardDisposals=0;
  const sourceDisconnects=[];
  const recordingObservers=[];let recordingCaptureInits=0,recordingCaptureDisposals=0;
  let todoPort,todoChanges=0;const todoReceives=[],todoWrites=[];
  const connectionListener=()=>{};
  const probe = { voice: {connected(){}},peerDeviceId:'aabbccddeeff',foreground:true,todoEpoch:9,todoConnected:()=>true,onConnection:connectionListener,auth:{sendBusiness:async(b,p)=>todoWrites.push([b,[...p]])} };
  let resumed=0;
  const recordings = { initialize() { recordingInitializations++; }, receive() { received++; }, disconnected() {}, active: false, busy: false,occupied:false };
  const lifelog = { initialize() {}, dispose(){lifelogDisposes++;}, receive() {}, receiveLauncher() {}, disconnected() {}, connected: async () => {}, active: false, busy: false,occupied:false,resumeAfterVoice:async()=>{resumed++;} };
  const asr = { initialize() {}, changed() {} };
  class Engine { constructor() { workers++; } close() { closed++; } }
  const { AppRuntime } = loadApp('AppRuntime', {
    './DebugCardService':{initializeDebugCards(){},disposeDebugCards(){}},'@kit.AbilityKit': {}, './ProbeSession': { probeSession: probe },
    './ConnectedServices': { connectedServices: { start() { starts++; }, stop() { stops++; } } },
    './LocalWorkspace': { localWorkspace: { setTodoTransport(port){todoPort=port;},todoConnectionChanged(){todoChanges++;},load: async () => {}, conversation: async () => {}, receiveTodo(p,b){todoReceives.push([p,[...b]]);}, changed() {} } },
    './RecordingService': { recordings, lifelog, lifelogASR: asr, voices: { initialize() {} }, startRecordingServices(){coordinators++;},stopRecordingServices(){coordinatorStops++;} },
    './MaterialSyncService': { materialSyncService: { initialize(){},dispose:async()=>{} } },
    './TaskService': { taskService: { initialize(){taskInitializations++;},dispose:async()=>{taskDisposals++;},voiceSources:{observe(_p,_e,b){recordingObservers.push(b);},disconnected(){sourceDisconnects.push('source');}} } },
    './TaskRecordingService':{taskRecordingCapture:{disconnected(){recordingObservers.push('disconnect');}},initializeTaskRecordingCapture(){recordingCaptureInits++;},disposeTaskRecordingCapture(){recordingCaptureDisposals++;},observeTaskRecordingAudio(){recordingObservers.push('capture');}},
    './NotificationService': { initializeNotifications(){}, notifications: { receive() {}, disconnected() {} }, suggestionTests: { initialize() {}, receive() {}, disconnected() {} } },
    './TeleprompterService': { initializeTeleprompter(){},disposeTeleprompter(){},teleprompter: { receive() {}, disconnected() {}, stop: async () => {}, active: false } },
    './TaskSuggestionService':{taskSuggestions:{receive(){cardReceives++;},pause(){cardPauses++;},stopAndWait:async()=>true},initializeTaskSuggestions(){cardInitializations++;},disposeTaskSuggestions(){cardDisposals++;}},'./AgentCaptureService':{agentCapture:{receive:()=>false,disconnected(){sourceDisconnects.push('capture');},stopAndWait:async()=>true},initializeAgentCapture(){},disposeAgentCapture(){}},
    './AsrEngine': { AsrEngineClient: Engine }
  });
  const runtime = new AppRuntime();
  runtime.initialize({ filesDir: '/synthetic' }); runtime.initialize({ filesDir: '/synthetic' });
  assert.equal(workers, 1); assert.equal(recordingInitializations, 1); assert.equal(starts, 1);
  assert.equal(taskInitializations,1);
  assert.equal(recordingCaptureInits,1);
  recordings.occupied=true;lifelog.occupied=true;assert.equal(probe.recordingOccupied(),true);assert.equal(probe.lifelogOccupied(),true);
  recordings.occupied=false;lifelog.occupied=false;assert.equal(probe.recordingOccupied(),false);assert.equal(probe.lifelogOccupied(),false);
  probe.voice.cleanupRequired=true;probe.voice.onRoundEnded();assert.equal(resumed,0,'cleanup debt cannot resume day capture');
  probe.voice.cleanupRequired=false;probe.voice.pendingWrites=true;probe.voice.onRoundEnded();assert.equal(resumed,0,'native exit in flight cannot resume day capture');
  probe.voice.pendingWrites=false;probe.voice.onRoundEnded();assert.equal(resumed,1);
  assert(todoPort);assert.equal(todoPort.peer(),'aabbccddeeff');assert.equal(todoPort.ready(),true);assert.equal(todoPort.foreground(),true);assert.equal(todoPort.lease(),9);assert.equal(probe.onConnection,connectionListener);
  await todoPort.send(22,new Uint8Array([7]));assert.deepEqual(todoWrites,[[22,[7]]]);
  probe.onTodo('aabbccddeeff',new Uint8Array([16]));assert.deepEqual(todoReceives,[['aabbccddeeff',[16]]]);
  const beforeTodo=todoChanges;probe.onTodoLifecycle();assert.equal(todoChanges,beforeTodo+1);
  assert.equal(cardInitializations,1);probe.onNotification('synthetic',new Uint8Array());assert.equal(cardReceives,1);
  probe.onNotificationDisconnected();assert.equal(cardPauses,1);
  probe.onAgentCaptureDisconnected();assert.deepEqual(sourceDisconnects,['source','capture'],'normal disconnect invalidates persistent sources before clearing capture state');
  probe.onRecording('synthetic', new Uint8Array()); assert.equal(received, 1);
  assert.deepEqual(recordingObservers,['disconnect',14,'capture']);
  runtime.dispose(); assert.equal(closed, 1); assert.equal(stops, 1); assert.equal(asr.engine, undefined);
  assert.equal(todoPort,undefined);probe.onTodo('aabbccddeeff',new Uint8Array([16]));assert.equal(todoReceives.length,1);
  runtime.dispose();assert.equal(coordinators,1);assert.equal(coordinatorStops,1);assert.equal(lifelogDisposes,1);
  assert.equal(taskDisposals,1);
  assert.equal(recordingCaptureDisposals,1);
  assert.equal(cardDisposals,1);probe.onNotification('synthetic',new Uint8Array());assert.equal(cardReceives,1);
  probe.onRecording('synthetic',new Uint8Array());assert.equal(received,1,'destroyed runtime no longer receives device messages');
  probe.onAgentCaptureDisconnected();assert.deepEqual(sourceDisconnects,['source','capture'],'destroyed routing cannot invalidate sources owned by a later runtime');
  runtime.initialize({ filesDir: '/synthetic' }); assert.equal(workers, 2);
  runtime.dispose();
});

test('task routing initializes independently when audio transcription initialization fails',()=>{
  let initialized=0,sourceDisconnects=0;const probe={voice:{}},idle={initialize(){},dispose(){},receive(){},disconnected(){},active:false,busy:false};
  const {AppRuntime}=loadApp('AppRuntime',{
    './DebugCardService':{initializeDebugCards(){},disposeDebugCards(){}},'@kit.AbilityKit':{},'./ProbeSession':{probeSession:probe},
    './ConnectedServices':{connectedServices:{start(){}}},'./LocalWorkspace':{localWorkspace:{setTodoTransport(){},todoConnectionChanged(){},load:async()=>{}}},
    './RecordingService':{recordings:{...idle},lifelog:{...idle},lifelogASR:{initialize(){throw Error('synthetic audio unavailable');}},voices:{},startRecordingServices(){}},
    './MaterialSyncService':{materialSyncService:{initialize(){}}},'./TaskService':{taskService:{initialize(){initialized++;},voiceSources:{disconnected(){sourceDisconnects++;}}}},
    './TaskRecordingService':{taskRecordingCapture:{disconnected(){}},initializeTaskRecordingCapture(){},disposeTaskRecordingCapture(){},observeTaskRecordingAudio(){}},
    './NotificationService':{initializeNotifications(){},notifications:{},suggestionTests:{initialize(){}}},'./TeleprompterService':{initializeTeleprompter(){},disposeTeleprompter(){},teleprompter:{}},'./TaskSuggestionService':{taskSuggestions:{receive(){},pause(){},stopAndWait:async()=>true},initializeTaskSuggestions(){},disposeTaskSuggestions(){}},'./AgentCaptureService':{agentCapture:{receive:()=>false,disconnected(){},stopAndWait:async()=>true},initializeAgentCapture(){},disposeAgentCapture(){}},
    './AsrEngine':{AsrEngineClient:class{}}
  });
  const runtime=new AppRuntime();runtime.initialize({filesDir:'/synthetic'});runtime.initialize({filesDir:'/synthetic'});assert.equal(initialized,1);
  probe.onAgentCaptureDisconnected();assert.equal(sourceDisconnects,1,'source invalidation remains routed when unrelated audio initialization fails');
});
