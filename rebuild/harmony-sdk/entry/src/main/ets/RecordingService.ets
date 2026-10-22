import { RecordingSession, RecordingItem,RecordingCaptureHandle } from './RecordingSession';
import { LifelogSession, LifelogItem } from './LifelogSession';
import { LifelogASR, LifelogTranscript, lifelogMarkdown } from './LifelogASR';
import { probeSession } from './ProbeSession';
import { LifelogWindowPipeline } from './LifelogWindowPipeline';
import { readTranscriptionSignals } from './TranscriptionSignals';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { RecordingTaskSourceStore,RecordingTaskInput } from './RecordingTaskSource';
import { TaskRecordingOrigin,TaskRecordingResult,taskSameRecordingOrigin } from './TaskRecordingTypes';
import { JournalSources, buildJournalDay, writeJournalFile, dayStamp, assertJournalSnapshotCurrent, bindJournalSummary, writeJournalSnapshot } from './JournalExport';
import { SavedJournalSummary, SavedSummaryBase } from './SavedJournalSummary';
import { JournalSummaryNotes } from './JournalSummaryNotes';
import { RecordingSummaryService } from './RecordingSummary';
import { LocalAudioSource,PlaybackSelection } from './LocalAudioSource';
import { PlaybackController } from './PlaybackController';
import { createNativePlaybackDriver } from './NativePlaybackDriver';
import { SecureServiceConfig, RemoteServices, ServiceConfig } from './RemoteServices';
import { VoiceRegistry } from './VoiceRegistry';
import { MaterialStore, MaterialSource, MaterialRevision, MaterialTextInput, MaterialSpeakerCorrection,MaterialUtterance } from './MaterialStore';
import { MaterialTranscriptExport } from './MaterialTranscriptExport';
import { MaterialCoverageInput, materialTextInput } from './MaterialTranscript';
import { MaterialEventIdentity, WireMaterialEvent, materialRevisionEvent } from './MaterialWire';
import { markMaterialDeleted } from './MaterialDeletion';
import { LocalAsrQueue, LocalAsrJob } from './LocalAsrQueue';
import { RecordingASR } from './RecordingASR';
import { RecordingCloudPublication, readRecordingCloudSnapshot, readLifelogManualSnapshot, LifelogManualResult, lifelogManualTextInput, prepareLifelogManualResult } from './RecordingCloudPublication';

export const recordings:RecordingSession=new RecordingSession(
  (business:number,payload:Uint8Array)=>probeSession.auth.sendBusiness(business,payload),
  ()=>probeSession.features.state.connected?probeSession.peerDeviceId:'',
  ()=>!probeSession.firmwareOccupied&&!probeSession.features.launcherBusy&&!probeSession.notificationOccupied()&&!probeSession.agentSuggestionOccupied&&!probeSession.agentCaptureOccupied&&!probeSession.voice.active&&!probeSession.voice.pendingWrites&&!probeSession.features.displayActive&&!probeSession.prompterOccupied()&&!lifelog.occupied
);
export const lifelog:LifelogSession=new LifelogSession(
  (business:number,payload:Uint8Array)=>probeSession.auth.sendBusiness(business,payload),
  ()=>probeSession.features.state.connected?probeSession.peerDeviceId:'',
  ()=>!probeSession.firmwareOccupied&&!probeSession.features.launcherBusy&&!probeSession.notificationOccupied()&&!probeSession.agentSuggestionOccupied&&!probeSession.agentCaptureOccupied&&!probeSession.voice.active&&!probeSession.voice.pendingWrites&&!probeSession.features.displayActive&&!probeSession.prompterOccupied()&&!recordings.occupied
);
recordings.beforeStart=():Promise<void>=>{if(probeSession.notificationOccupied())throw new Error('请先确认通知已收起');if(probeSession.voice.active||probeSession.voice.pendingWrites)throw new Error('请先结束助手并等待退出指令发送完毕');if(probeSession.features.launcherBusy)throw new Error('请先完成设备设置');prepareInteractiveAudio();return lifelog.suspendForRecording();};
recordings.onSessionEnded=():void=>{
  if(!serviceActive||recordings.occupied)return;
  lifelog.resumeAfterRecording().catch((error:Error):void=>{lifelog.note='录音已结束，智记恢复失败：'+error.message;lifelog.changed();});
  resumePendingTranscriptions();
};
export const lifelogASR:LifelogASR=new LifelogASR();
export const voices:VoiceRegistry=new VoiceRegistry();
export const materials:MaterialStore=new MaterialStore();
// Shared read-only boundary for the normal journal and debug CLI. Construction
// does not scan files, rebuild a day, start capture or call the model.
export const savedJournalSummaries:SavedJournalSummary=new SavedJournalSummary({
  root:():string=>lifelog.rootPath(),
  current:(day:number):SavedSummaryBase=>buildJournalDay(day,journalSources(),'')
});
// Human notes are independent of the automatic day cache. No files are read
// or written until an explicit normal-page or CLI operation.
export const journalSummaryNotes:JournalSummaryNotes=new JournalSummaryNotes({
  root:():string=>lifelog.rootPath(),summaries:savedJournalSummaries,
  freeze:(day:number,markdown:string):string=>writeJournalSnapshot(lifelog.rootPath(),day,markdown),
  now:():number=>Date.now()
});
recordings.beforeRemove=(item:RecordingItem):void=>{localPlayback.assertSourceReleased('recording',item.name);markMaterialDeleted(materials,sourceForRecording(item));stopDeletedTranscription(recordings.directoryOf(item),'recording');};
lifelog.beforeRemove=(item:LifelogItem):void=>{localPlayback.assertSourceReleased('lifelog',item.name);markMaterialDeleted(materials,sourceForLifelog(item));stopDeletedTranscription(lifelog.rootPath()+'/'+item.name,'lifelog');};

// Explicit export boundary for the durable sender. No automatic upload occurs.
export function localMaterialEvent(id:string,revision:number,identity:MaterialEventIdentity):WireMaterialEvent{
  return materialRevisionEvent(materials,id,revision,identity);
}

// ---- 本地转写协调 ----
// 录音沿用既有封口转写；智记按短窗、真实设备条件与耐久预算处理。
const durableQueue:LocalAsrQueue=new LocalAsrQueue();
const recordingTaskSources:RecordingTaskSourceStore=new RecordingTaskSourceStore();
const cloudPublication:RecordingCloudPublication=new RecordingCloudPublication();
const transcriptExport:MaterialTranscriptExport=new MaterialTranscriptExport();
const cloudRecordingASR:RecordingASR=new RecordingASR();let cloudGeneration:number=0;let cloudBusy:boolean=false;
let manualGeneration:number=0;let manualBusy:boolean=false;
let jobs:LocalAsrJob[]=[];
let running:boolean=false;
let currentDirectory:string='';
let currentJob:LocalAsrJob|undefined=undefined;
let serviceActive:boolean=false;
let serviceGeneration:number=0;
let serviceTimer:number=-1;
let retryTimer:number=-1;let retryTimerAt:number=0;
let migrationCursor:number=0;
let ensureWorker:()=>void=():void=>{};
let serviceFilesDir:string='';
const windowPipeline:LifelogWindowPipeline=new LifelogWindowPipeline();
let windowPipelineReady:boolean=false;
let yieldWindowWorker:()=>void=():void=>{};let windowInterrupted:boolean=false;
const failed:Map<string,string>=new Map<string,string>();
// A failed stop stays excluded for this service lifetime. Refreshing the
// ledger must not make two deleted jobs repeatedly restore each other.
const deletedStopPending:Set<string>=new Set<string>();
const manualStopPending:Set<string>=new Set<string>();
let summaryBusy:boolean=false;
let automaticSummary:boolean=true;
let summaryRemote:RemoteServices|undefined=undefined;
const recordingSummaryRemote:RemoteServices=new RemoteServices();
// Separate request owner and files: neither cancelling this job nor reopening
// its versions affects the assistant, daily summary, ASR or original recording.
export const recordingSummaries:RecordingSummaryService=new RecordingSummaryService({
  root:():string=>serviceFilesDir,read:(id:string):MaterialRevision|undefined=>materials.read(id),
  foreground:():boolean=>serviceActive&&probeSession.foreground,
  config:():Promise<ServiceConfig>=>new SecureServiceConfig().load(),
  request:(config:ServiceConfig,system:string,input:string):Promise<string>=>recordingSummaryRemote.structuredSummary(config,system,input),
  cancel:():void=>recordingSummaryRemote.cancel(),now:():number=>Date.now()
});

// The player owns independent read descriptors. Capture, ASR decoders and the
// original files are never reset or copied to provide historical playback.
const localAudioSources:LocalAudioSource=new LocalAudioSource({
  root:(kind:string):string=>{
    if(kind==='lifelog')return lifelog.rootPath();
    const item=new RecordingItem();item.name='take-'+'0'.repeat(32);const directory=recordings.directoryOf(item);
    return directory.slice(0,-item.name.length-1);
  },
  recordingWav:(name:string):string=>{const item=new RecordingItem();item.name=name;return recordings.file(item,true);},
  materialRoot:():string=>serviceFilesDir?serviceFilesDir+'/materials':'',materials:materials
});
export const localPlayback:PlaybackController=new PlaybackController({
  resolve:(selection:PlaybackSelection)=>localAudioSources.resolve(selection),create:createNativePlaybackDriver,
  foreground:():boolean=>serviceActive&&probeSession.foreground
});

export function localQueueSize():number{return jobs.length;}
export function localCurrentDirectory():string{return currentDirectory;}
export function localQueuedDirectories():string[]{return jobs.map((job:LocalAsrJob):string=>job.directory);}
export function localAsrBusy():boolean{return running||jobs.length>0;}
export function interactiveTranscriptionBusy():boolean{return running||manualBusy||cloudBusy||lifelogASR.busy;}
export function resumePendingTranscriptions():void{pump();}
// 只由Ability装配启动；导入模块或切换页面不会启动循环。
export function startRecordingServices(filesDir:string,recoverWorker:()=>void=():void=>{},yieldWorker:()=>void=():void=>{},allowAutomaticSummary:boolean=true):void{
  if(serviceActive)return;
  deletedStopPending.clear();
  manualStopPending.clear();
  ensureWorker=recoverWorker;
  automaticSummary=allowAutomaticSummary;
  yieldWindowWorker=yieldWorker;windowInterrupted=false;
  materials.initialize(filesDir);durableQueue.initialize(filesDir);recordingTaskSources.initialize(filesDir);refreshQueue();migrationCursor=0;serviceFilesDir=filesDir;
  cloudPublication.initialize(filesDir,materials);transcriptExport.initialize(filesDir);probeSession.onFileTranscriptionSuspend=():void=>{localPlayback.setForeground(false);cancelRecordingCloudTranscription();cancelLifelogManualPublication();recordingSummaries.suspend();};
  windowPipelineReady=false;try{windowPipeline.initialize(filesDir);windowPipelineReady=true;}catch(_){lifelog.note='短窗恢复或预算账本待核对，原音保留';}
  serviceActive=true;localPlayback.setForeground(probeSession.foreground);const generation=++serviceGeneration;
  serviceTimer=setInterval(():void=>{
    if(!serviceActive||generation!==serviceGeneration)return;
    migrateLocalMaterials();recoverLocalTranscriptions();pump();
  },60000);
  migrateLocalMaterials();recoverLocalTranscriptions();pump();
}
export function stopRecordingServices():void{
  localPlayback.setForeground(false);
  recordingSummaries.suspend();
  if(!serviceActive)return;
  serviceActive=false;serviceGeneration++;
  cancelRecordingCloudTranscription();
  cancelLifelogManualPublication();
  clearQueueWake();
  if(serviceTimer!==-1)clearInterval(serviceTimer);serviceTimer=-1;
  if(currentJob){try{durableQueue.interrupted(currentJob.jobId);}catch(_){lifelog.note='转写中断状态未写入，下次启动核对原件恢复';}}
  refreshQueue();
  currentJob=undefined;running=false;currentDirectory='';
  summaryRemote?.cancel();summaryRemote=undefined;summaryBusy=false;
}
export function cancelRecordingCloudTranscription():void{cloudGeneration++;cloudRecordingASR.cancel();}
function manualPublicationError(error:Error):Error{
  const code=error.message;try{lifelogASR.log('manual-publication-failed',code);}catch(_){};
  if(code.includes('MATERIAL_DELETED'))return new Error('资料已删除，本次结果不会写回');
  if(code.includes('USER_REVISION_PROTECTED'))return new Error('人工更正受保护，本次结果不会覆盖');
  if(code.includes('REVISION_CONFLICT')||code.includes('SOURCE_CHANGED'))return new Error('资料或原音已变化，请核对后再转写；本次未自动覆盖');
  if(code.includes('RESULT_NOT_SAVED'))return new Error('上次结果未保存，当前没有可恢复的文字；确认开始后可重新识别');
  if(code.includes('RESULT_WRITE_FAILED'))return new Error('识别结果未写入磁盘，本进程内可重试保存；重开应用后需重新确认识别');
  if(code.includes('LIFETIME')||code.includes('CANCEL'))return new Error('本次文字发布已停止，请回到前台再重试');
  if(code.includes('BUSY'))return new Error('已有任务正在处理，请稍后重试');
  if(code.includes('SOURCE_UNAVAILABLE')||code.includes('ENOENT'))return new Error('原音暂不可读或尚在采集，请核对完成状态后重试');
  if(code.includes('STATE_INVALID'))return new Error('已保存的转写状态待核对，本次未覆盖文字');
  return new Error('本次转写未完成，请核对原音和服务状态后重试');
}
export async function transcribeRecordingCloud(item:RecordingItem,config:ServiceConfig,allowRecognitionRetry:boolean=false):Promise<string>{
  if(!serviceActive||!probeSession.foreground)throw new Error('请保持应用前台再转写');
  if(probeSession.agentCaptureOccupied||cloudBusy||manualBusy||probeSession.prompterOccupied())throw new Error('已有音频任务正在处理，请完成后再转写');
  const directory=recordings.directoryOf(item);cloudBusy=true;const generation=serviceGeneration,request=++cloudGeneration;
  const current=():boolean=>serviceActive&&generation===serviceGeneration&&request===cloudGeneration&&probeSession.foreground;
  const readSource=async()=>{
    if(!current())throw new Error('RECORDING_CLOUD_LIFETIME_CHANGED');
    const fresh=recordings.findByDirectory(directory);if(!fresh||recordings.occupied)throw new Error('RECORDING_CLOUD_SOURCE_UNAVAILABLE');
    const snapshot=await readRecordingCloudSnapshot(sourceForRecording(fresh),recordings.file(fresh,false),recordings.file(fresh,true),current);
    const after=recordings.findByDirectory(directory);if(!after||recordings.occupied)throw new Error('RECORDING_CLOUD_SOURCE_UNAVAILABLE');
    const beforeSource=JSON.parse(JSON.stringify(snapshot.source)) as MaterialSource,afterSource=sourceForRecording(after);beforeSource.legacyTextRef='';afterSource.legacyTextRef='';
    if(JSON.stringify(beforeSource)!==JSON.stringify(afterSource))throw new Error('RECORDING_CLOUD_SOURCE_CHANGED');return snapshot;
  };
  try{
    const note=await cloudPublication.publish(readSource,(path:string):Promise<string>=>cloudRecordingASR.transcribe(path,config),
      (source:MaterialSource,fileName:string,text:string):void=>{
        if(!current())throw new Error('RECORDING_CLOUD_LIFETIME_CHANGED');
        const fresh=recordings.findByDirectory(directory);if(!fresh||fresh.name!==source.name)throw new Error('RECORDING_CLOUD_SOURCE_UNAVAILABLE');
        recordings.saveTranscriptFixed(fresh,fileName,text);
      },current,undefined,allowRecognitionRetry);
    if(!current())throw new Error('RECORDING_CLOUD_LIFETIME_CHANGED');recordings.note=note;recordings.changed();lifelog.changed();return note;
  }catch(error){throw manualPublicationError(error as Error);}finally{cloudBusy=false;}
}
// Invalidate this manual publication without closing the shared offline worker.
export function cancelLifelogManualPublication():void{manualGeneration++;}
export async function transcribeLifelogManual(item:LifelogItem,allowRecognitionRetry:boolean=false):Promise<string>{
  if(!serviceActive||!probeSession.foreground)throw new Error('请保持应用前台再转写');
  if(probeSession.agentCaptureOccupied||manualBusy||cloudBusy||running||lifelogASR.busy||recordings.occupied||lifelog.occupied||probeSession.voice.active||probeSession.prompterOccupied())throw new Error('已有音频任务正在处理，请完成后再做单条完整转写');
  const directory=lifelog.rootPath()+'/'+item.name;
  if(!/^seg-[0-9a-f]{32}$/.test(item.name))throw new Error('智记分段标识无效');
  manualBusy=true;const generation=serviceGeneration,request=++manualGeneration;
  const current=():boolean=>serviceActive&&generation===serviceGeneration&&request===manualGeneration&&probeSession.foreground;
  const readSource=async()=>{
    if(!current())throw new Error('RECORDING_CLOUD_LIFETIME_CHANGED');
    const fresh=lifelog.items.find((row:LifelogItem):boolean=>row.name===item.name);
    if(!fresh||!fresh.ogg||!fresh.complete||fresh.interrupted||lifelog.busy||recordings.occupied)throw new Error('RECORDING_CLOUD_SOURCE_UNAVAILABLE');
    const snapshot=await readLifelogManualSnapshot(sourceForLifelog(fresh),lifelog.file(fresh,'ogg'),current);
    const after=lifelog.items.find((row:LifelogItem):boolean=>row.name===item.name);
    if(!after||!after.complete||after.interrupted||lifelog.busy||recordings.occupied)throw new Error('RECORDING_CLOUD_SOURCE_UNAVAILABLE');
    const beforeSource=JSON.parse(JSON.stringify(snapshot.source)) as MaterialSource,afterSource=sourceForLifelog(after);beforeSource.legacyTextRef='';afterSource.legacyTextRef='';
    if(afterSource.audioFrames<0){afterSource.audioFrames=snapshot.source.audioFrames;afterSource.ended=Math.max(afterSource.ended,afterSource.started+snapshot.source.audioFrames*snapshot.source.frameMs);}
    if(JSON.stringify(beforeSource)!==JSON.stringify(afterSource))throw new Error('RECORDING_CLOUD_SOURCE_CHANGED');return snapshot;
  };
  try{
    let sealedSource:MaterialSource|undefined=undefined;
    const manualSource=async()=>{const snapshot=await readSource();sealedSource=snapshot.source;return snapshot;};
    const note=await cloudPublication.publish(manualSource,async(path:string):Promise<string>=>{
        ensureWorker();const result=await lifelogASR.transcribe(path,300000);if(!sealedSource)throw new Error('RECORDING_CLOUD_SOURCE_UNAVAILABLE');
        return JSON.stringify(prepareLifelogManualResult(result,sealedSource,'智记 '+new Date(item.created).toLocaleString()));
      },
      (source:MaterialSource,_fileName:string,markdown:string,result:string):void=>{
        if(!current())throw new Error('RECORDING_CLOUD_LIFETIME_CHANGED');
        const parsed=(JSON.parse(result) as LifelogManualResult).transcript,input=lifelogManualTextInput(result,source);
        if(!parsed)throw new Error('RECORDING_CLOUD_STATE_INVALID');
        lifelog.saveSegmentResult(directory,markdown,JSON.stringify({started:source.started,seconds:parsed.seconds,speechSeconds:parsed.speechSeconds,
          utterances:parsed.utterances,speakers:parsed.speakers,speaker_processing:parsed.speakerProcessing||'unknown',boundary_processing:parsed.boundaryProcessing||'unknown',
          transcription_complete:input.transcriptionState==='complete',transcription_state:input.transcriptionState,covered_ms:input.coveredMs,transcription_source_ms:input.sourceMs}));
      },current,lifelogManualTextInput,allowRecognitionRetry);
    if(!current())throw new Error('RECORDING_CLOUD_LIFETIME_CHANGED');lifelog.note=note;lifelog.changed();return note;
  }catch(error){throw manualPublicationError(error as Error);}finally{
    manualBusy=false;try{if(serviceActive&&hasManualLifelogPublication(directory))stopManualWindow(directory);}catch(_){lifelog.note='完整转写的短窗停止状态待核对';}pump();
  }
}
export function prepareInteractiveAudio():void{
  if(serviceActive&&running&&currentJob?.kind==='lifelog'&&!windowInterrupted){
    windowInterrupted=true;yieldWindowWorker();
  }
}
export function localQueueNeedsCharge():boolean{return false;}
export function localTranscriptionState(directory:string):string{
  const stopped=failed.get(directory);if(stopped?.startsWith('资料已删除'))return stopped;
  if(currentDirectory===directory)return `本机转写 ${lifelogASR.progress}%`;
  const pending=jobs.find((job:LocalAsrJob):boolean=>job.directory===directory);
  if(pending?.lastError&&pending.kind==='lifelog')return windowWaitLabel(pending.lastError);
  if(pending)return pending.status==='result_ready'?'识别结果已保存，等待写回':probeSession.prompterOccupied()?'提词进行中，转写排队保留':pending.nextRun>Date.now()?'转写中断，稍后自动重试':'等待本机转写';
  return failed.get(directory)||'';
}

function clearQueueWake():void{
  if(retryTimer!==-1)clearTimeout(retryTimer);retryTimer=-1;retryTimerAt=0;
}
function scheduleQueueWake():void{
  if(!serviceActive||running||lifelogASR.busy||!lifelogASR.engine){clearQueueWake();return;}
  const now=Date.now();let at=Number.MAX_SAFE_INTEGER;
  for(const job of jobs)at=Math.min(at,job.nextRun);
  if(at<=now||at===Number.MAX_SAFE_INTEGER){clearQueueWake();return;}
  if(retryTimer!==-1&&retryTimerAt===at)return;
  clearQueueWake();const generation=serviceGeneration;retryTimerAt=at;
  const delay=Math.min(60000,Math.max(1,at-now));
  lifelogASR.log('queue-wake-scheduled',JSON.stringify({at:now,dueAt:at,delayMs:delay}));
  const timer=setTimeout(():void=>{
    if(!serviceActive||generation!==serviceGeneration||retryTimer!==timer)return;
    const fired=Date.now();lifelogASR.log('queue-wake-fired',JSON.stringify({at:fired,dueAt:at,lateMs:Math.max(0,fired-at),remainingMs:Math.max(0,at-fired)}));
    retryTimer=-1;retryTimerAt=0;pump();
  },delay);
  retryTimer=timer;
}
function refreshQueue():void{
  const rows=durableQueue.all();jobs=rows.filter((job:LocalAsrJob):boolean=>!deletedStopPending.has(job.directory)&&!manualStopPending.has(job.directory)&&(job.status==='queued'||job.status==='result_ready'));
  failed.clear();for(const row of rows){
    if(deletedStopPending.has(row.directory)){failed.set(row.directory,'资料已删除，转写停止状态待保存');continue;}
    if(manualStopPending.has(row.directory)){failed.set(row.directory,'完整转写已保存，短窗停止状态待保存');continue;}
    if(row.status!=='failed'&&row.status!=='cancelled')continue;
    let deleted=row.lastError==='material_deleted';if(!deleted){try{deleted=isDeletedMaterial(row.directory,row.kind);}catch(_){}}
    failed.set(row.directory,deleted?'资料已删除，转写已停止':row.status==='cancelled'?'已取消转写，原件保留':'转写未完成，可重试');
  }
  scheduleQueueWake();
}
function hasManualLifelogPublication(directory:string):boolean{
  const item=lifelog.items.find((row:LifelogItem):boolean=>lifelog.rootPath()+'/'+row.name===directory);
  if(item){const head=materials.read(materials.idFor('lifelog',item.name));
    if(head?.operation==='upsert'&&head.user_edited&&head.source.complete&&!head.source.interrupted&&head.transcription_state==='complete')return true;}
  return !!item&&/^seg-[0-9a-f]{32}$/.test(item.name)&&cloudPublication.hasCommittedLifelog(sourceForLifelog(item));
}
function stopManualWindow(directory:string,reason:string='manual_full_published'):void{
  if(manualStopPending.has(directory))return;
  const saved=durableQueue.all().find((row:LocalAsrJob):boolean=>row.directory===directory);
  if(saved&&saved.status!=='succeeded'){
    try{durableQueue.transition(saved.jobId,'succeeded',reason);manualStopPending.delete(directory);}
    catch(_){manualStopPending.add(directory);try{lifelogASR.log('manual-window-stop-persist-failed','');}catch(_){} }
  }
  refreshQueue();jobs=jobs.filter((row:LocalAsrJob):boolean=>row.directory!==directory);scheduleQueueWake();
}
function isDeletedMaterial(directory:string,kind:string):boolean{
  const name=directory.slice(directory.lastIndexOf('/')+1);
  return materials.read(materials.idFor(kind,name))?.operation==='delete';
}
function stopDeletedTranscription(directory:string,kind:string):void{
  const saved=durableQueue.all().find((row:LocalAsrJob):boolean=>row.directory===directory);
  let stopped=true;
  if(saved&&!['cancelled','succeeded'].includes(saved.status)){
    try{durableQueue.transition(saved.jobId,'cancelled','material_deleted');}catch(_){stopped=false;deletedStopPending.add(directory);try{lifelogASR.log('deleted-stop-persist-failed',`kind=${kind}`);}catch(_){} }
  }
  if(stopped)deletedStopPending.delete(directory);
  refreshQueue();jobs=jobs.filter((row:LocalAsrJob):boolean=>row.directory!==directory);scheduleQueueWake();
  const note=stopped?'资料已删除，转写已停止':'资料已删除，转写停止状态待保存';
  failed.set(directory,note);if(kind==='recording')recordings.note=note;else lifelog.note=note;
}
function handleDeletedTranscription(job:LocalAsrJob,error:Error):boolean{
  let deleted=error.message==='MATERIAL_DELETED';
  if(!deleted){try{deleted=isDeletedMaterial(job.directory,job.kind);}catch(_){}}
  if(!deleted)return false;
  stopDeletedTranscription(job.directory,job.kind);return true;
}
export function enqueueLocalTranscribe(directory:string,sourcePath:string,started:number,kind:string,forced:boolean,retry:boolean=true):void{
  if(!serviceActive)return;
  if(currentDirectory===directory)return;
  try{
    if(isDeletedMaterial(directory,kind)){stopDeletedTranscription(directory,kind);recordings.changed();lifelog.changed();return;}
    if(kind==='lifelog'&&hasManualLifelogPublication(directory)){stopManualWindow(directory);lifelog.changed();return;}
    const saved=durableQueue.enqueue(directory,sourcePath,started,kind,forced,retry);durableQueue.wakeAudio(saved.jobId);refreshQueue();pump();
  }
  catch(_){failed.set(directory,'转写队列未能保存，原件保留，可重试');}
  recordings.changed();lifelog.changed();
}

// Explicit UI action only. Automatic discovery never revives terminal jobs,
// and a cancelled job is not treated as a failed job awaiting another attempt.
export function retryFailedLocalTranscribe(directory:string):boolean{
  if(!serviceActive||currentDirectory===directory)return false;
  const job=durableQueue.all().find((row:LocalAsrJob):boolean=>row.directory===directory&&row.status==='failed');
  if(!job)return false;
  try{
    if(isDeletedMaterial(directory,job.kind)){stopDeletedTranscription(directory,job.kind);recordings.changed();lifelog.changed();return false;}
    if(job.kind==='lifelog'&&hasManualLifelogPublication(directory)){stopManualWindow(directory);lifelog.changed();return false;}
    durableQueue.enqueue(job.directory,job.sourcePath,job.started,job.kind,job.forced,true);
    refreshQueue();pump();recordings.changed();lifelog.changed();return true;
  }catch(_){return false;}
}

// Reconcile sealed legacy sources in addition to restoring the durable ledger.
// Automatic discovery never reactivates a cancelled/terminal failed job.
export function recoverLocalTranscriptions():void{
  if(!lifelogASR.engine)return;
  for(const item of recordings.items){
    if(item.complete&&!item.textFile&&item.rawAvailable!==false){
      try{const dir=recordings.directoryOf(item);if(!failed.has(dir))enqueueLocalTranscribe(dir,recordings.file(item,false),item.created,'recording',true,false);}catch(_){recordings.note='部分原音暂不可读，其他转写继续';}
    }
  }
  if(lifelog.autoTranscribe)for(const item of lifelog.items){
    if(item.ogg&&!item.interrupted&&(item.complete||item.committedFrames>=300)&&(!item.hasText||!item.textComplete)){try{const dir=lifelog.rootPath()+'/'+item.name;if(!failed.has(dir))enqueueLocalTranscribe(dir,lifelog.file(item,'ogg'),item.created,'lifelog',false,false);}catch(_){lifelog.note='部分原音暂不可读，其他转写继续';}}
  }
}

function sourceForRecording(item:RecordingItem):MaterialSource{
  const source=new MaterialSource();source.kind='recording';source.name=item.name;
  source.started=item.created;source.ended=item.created+Math.floor(item.bytes/240)*20;
  source.complete=item.complete;source.audioAvailable=item.rawAvailable;source.audioBytes=item.bytes;
  source.frameMs=20;source.audioFrames=Number.isSafeInteger(item.bytes)&&item.bytes%240===0?item.bytes/240:-1;
  source.decodedChannels=item.complete?2:0;source.legacyTextRef=item.textFile;
  return preserveSealedMissingAudio(source);
}
function sourceForLifelog(item:LifelogItem):MaterialSource{
  const source=new MaterialSource();source.kind='lifelog';source.name=item.name;
  source.started=item.created;source.ended=Math.max(item.created,item.ended,item.created+Math.round(item.seconds*1000));
  source.complete=item.complete;source.audioAvailable=item.ogg||item.raw||item.wav;source.audioBytes=item.bytes;
  source.frameMs=60;source.audioFrames=Number.isSafeInteger(item.committedFrames)&&item.committedFrames>0?item.committedFrames:-1;
  source.interrupted=item.interrupted===true;
  // Version-1 metadata can omit frames/duration. A later verified sealed OGG
  // measurement is retained while the same complete source remains present.
  if(source.audioFrames<0&&source.complete&&!source.interrupted){
    try{
      const old=materials.read(materials.idFor(source.kind,source.name)),saved=old?.source;
      if(old?.operation==='upsert'&&saved&&saved.kind===source.kind&&saved.name===source.name&&saved.started===source.started&&
        saved.audioBytes===source.audioBytes&&saved.complete===source.complete&&saved.audioAvailable===source.audioAvailable&&
        saved.interrupted===source.interrupted&&saved.frameMs===source.frameMs&&saved.audioFrames>0&&source.ended<=saved.ended){
        source.audioFrames=saved.audioFrames;source.ended=saved.ended;
      }
    }catch(_){/* Missing/corrupt sidecars are handled by the normal CAS boundary. */}
  }
  // 尚未核实原厂智记编码的实际声道，不能凭解码器配置写成单声道。
  source.decodedChannels=0;source.legacyTextRef=item.hasText?'text.md':'';return preserveSealedMissingAudio(source);
}
function preserveSealedMissingAudio(source:MaterialSource):MaterialSource{
  // A missing file is an availability change, not evidence that the historical
  // capture was unfinished. Only reuse a previously verified complete extent.
  if(source.audioAvailable||source.audioBytes!==0||source.interrupted)return source;
  const old=materials.read(materials.idFor(source.kind,source.name)),saved=old?.source;
  if(!old||old.operation==='delete'||old.transcription_state!=='complete'||!saved||!saved.complete||saved.interrupted||
    saved.kind!==source.kind||saved.name!==source.name||saved.started!==source.started||source.ended>saved.ended||
    saved.audioFrames<0||saved.frameMs!==source.frameMs||
    (source.audioFrames>0&&source.audioFrames!==saved.audioFrames))return source;
  let directory=lifelog.rootPath()+'/'+source.name;
  if(source.kind==='recording'){
    const item=recordings.items.find((row:RecordingItem):boolean=>row.name===source.name);if(!item)return source;
    directory=recordings.directoryOf(item);
  }
  const audioNames=source.kind==='lifelog'?['audio.ogg','source.opus','audio.wav']:['source.rawopus'];
  if(audioNames.some((name:string):boolean=>fs.accessSync(directory+'/'+name)))return source;
  source.complete=true;source.ended=saved.ended;source.audioBytes=saved.audioBytes;source.audioFrames=saved.audioFrames;
  source.decodedChannels=saved.decodedChannels;source.deviceId=saved.deviceId;return source;
}
function localSource(kind:string,name:string):MaterialSource{
  materials.idFor(kind,name);
  if(kind==='recording'){
    recordings.refresh();const item=recordings.items.find((row:RecordingItem):boolean=>row.name===name);
    if(!item)throw new Error('MATERIAL_SOURCE_UNAVAILABLE');return sourceForRecording(item);
  }
  lifelog.refresh();const item=lifelog.items.find((row:LifelogItem):boolean=>row.name===name);
  if(!item)throw new Error('MATERIAL_SOURCE_UNAVAILABLE');return sourceForLifelog(item);
}
export function localMaterialRevision(kind:string,name:string):MaterialRevision{
  const row=ensureMaterial(localSource(kind,name));if(row.operation==='delete')throw new Error('MATERIAL_DELETED');return row;
}
export function localMaterialText(kind:string,name:string):string{return localMaterialRevision(kind,name).text;}
export function localMaterialExportPath(kind:string,name:string,format:string='md'):string{
  return transcriptExport.save(localMaterialRevision(kind,name),format);
}
function correctionSourceEqual(first:MaterialSource,second:MaterialSource):boolean{
  return first.kind===second.kind&&first.name===second.name&&first.started===second.started&&first.ended===second.ended&&
    first.complete===second.complete&&first.interrupted===second.interrupted&&first.audioAvailable===second.audioAvailable&&
    first.audioBytes===second.audioBytes&&first.audioFrames===second.audioFrames&&first.frameMs===second.frameMs&&first.decodedChannels===second.decodedChannels&&first.deviceId===second.deviceId;
}
// A correction writes only the canonical revision. The original ASR result,
// embeddings and source audio stay intact; normal readers/exports use this head.
export function correctLocalMaterial(kind:string,name:string,expected:number,operation:MaterialSpeakerCorrection):MaterialRevision{
  if(!serviceActive||!probeSession.foreground)throw new Error('MATERIAL_CORRECTION_LIFETIME');
  const id=materials.idFor(kind,name),base=materials.read(id,expected);if(!base)throw new Error('MATERIAL_NOT_FOUND');
  const source=localSource(kind,name),directory=kind==='lifelog'?lifelog.rootPath()+'/'+name:recordings.directoryOf(recordings.items.find((row:RecordingItem):boolean=>row.name===name) as RecordingItem);
  if(currentDirectory===directory||manualBusy||cloudBusy)throw new Error('MATERIAL_CORRECTION_BUSY');
  if(!correctionSourceEqual(base.source,source))throw new Error('MATERIAL_CORRECTION_SOURCE_CHANGED');
  const row=materials.correctSpeakers(id,expected,operation);
  try{stopManualWindow(directory,'user_correction_published');}catch(_){/* Canonical user edit still fences late ASR; queue cleanup can retry. */}
  try{recordings.changed();lifelog.changed();}catch(_){}return row;
}
function ensureMaterial(source:MaterialSource):MaterialRevision{
  // 已迁移的资料不反复读取旧文字/大JSON，且不能回滚用户修订。
  if(materials.read(materials.idFor(source.kind,source.name)))return materials.ensure(source);
  const directory=source.kind==='recording'?recordings.directoryOf(recordings.items.find((item:RecordingItem):boolean=>item.name===source.name) as RecordingItem):lifelog.rootPath()+'/'+source.name;
  let text='';let input:MaterialTextInput|undefined=undefined;
  if(source.legacyTextRef){
    const textPath=directory+'/'+source.legacyTextRef;
    if(fs.accessSync(textPath)&&fs.statSync(textPath).size<=1000000)text=fs.readTextSync(textPath);
  }
  const json=directory+'/transcript.json';
  if(fs.accessSync(json)&&fs.statSync(json).size<=4000000){
    try{
      const raw=JSON.parse(fs.readTextSync(json)) as Record<string,Object>;
      const parsed=JSON.parse(JSON.stringify(raw)) as LifelogTranscript;
      if(Array.isArray(parsed.utterances)){
        if(Number.isFinite(parsed.seconds)&&parsed.seconds>=0)source.ended=Math.max(source.ended,source.started+Math.round(parsed.seconds*1000));
        input=materialTextInput(parsed,text,source.kind==='recording'?'legacy_mix':'unknown');
        // Missing fields never mean complete, even when the source is sealed.
        if(typeof raw['transcription_complete']==='boolean'){
          const coverage=new MaterialCoverageInput();coverage.complete=raw['transcription_complete'] as boolean;
          coverage.coveredFrames=raw['covered_frames'] as number;coverage.sourceFrames=raw['source_frames'] as number;coverage.frameMs=source.frameMs;
          try{input=materialTextInput(parsed,text,input.channel,coverage);}catch(_){/* Preserve text with unknown coverage. */}
        }
        const speakerState=raw['speaker_processing'] as string;
        if(['unknown','pending','processed','unavailable'].includes(speakerState))input.speakerProcessing=speakerState;
        const boundaryState=raw['boundary_processing'] as string;
        if(['unknown','unverified','token_starts','no_speech'].includes(boundaryState))input.boundaryProcessing=boundaryState;
      }
    }catch(_){/* 旧JSON损坏时保留旧文字，原文件不修写。 */}
  }
  try{return materials.ensure(source,text,input);}catch(error){
    // 旧结构化时间轴不合法时，仍迁移可读的文字，不修写原JSON。
    if((error as Error).message==='MATERIAL_UTTERANCE_INVALID')return materials.ensure(source,text);
    throw new Error((error as Error).message);
  }
}
export function migrateLocalMaterials(limit:number=20):void{
  const sources:MaterialSource[]=[];
  for(const item of recordings.items)sources.push(sourceForRecording(item));
  for(const item of lifelog.items)sources.push(sourceForLifelog(item));
  for(let i=0;i<Math.min(limit,sources.length);i++){
    const source=sources[(migrationCursor++)%sources.length];
    try{ensureMaterial(source);}catch(_){lifelog.note='部分资料版本暂不可读，旧原件保留；可重试';}
  }
}
function materialForJob(job:LocalAsrJob,seconds:number=0):MaterialRevision{
  if(job.kind==='recording'){
    const item=recordings.findByDirectory(job.directory);if(!item)throw new Error('MATERIAL_SOURCE_MISSING');
    return ensureMaterial(sourceForRecording(item));
  }
  const item=lifelog.items.find((row:LifelogItem):boolean=>lifelog.rootPath()+'/'+row.name===job.directory);
  if(!item)throw new Error('MATERIAL_SOURCE_MISSING');const source=sourceForLifelog(item);
  source.ended=Math.max(source.ended,source.started+Math.round(seconds*1000));return ensureMaterial(source);
}

function dayStartOf(ms:number):number{
  const day=new Date(ms);day.setHours(0,0,0,0);
  return day.getTime();
}

function journalSources():JournalSources{
  const src=new JournalSources();
  src.lifelogRoot=lifelog.rootPath();
  src.lifelogItems=lifelog.items;
  src.recordingItems=recordings.items;
  src.transcriptJson=(item:LifelogItem):string=>lifelog.readTranscriptJson(item);
  src.recordingText=(item:RecordingItem):string=>{try{return fs.readTextSync(recordings.textPath(item)) as string;}catch(_){return '';}};
  src.material=(kind:string,name:string):MaterialRevision|undefined=>materials.read(materials.idFor(kind,name));
  return src;
}

async function ensureDaySummary(dayStart:number):Promise<void>{
  if(!serviceActive||!automaticSummary||summaryBusy)return;
  const generation=serviceGeneration;
  const base=buildJournalDay(dayStart,journalSources(),'');
  if(base.total===0||base.transcribed<base.total)return;
  summaryBusy=true;
  try{
    const config:ServiceConfig=await new SecureServiceConfig().load();
    if(!serviceActive||generation!==serviceGeneration||!config.modelKey)return;
    assertJournalSnapshotCurrent(base,buildJournalDay(dayStart,journalSources(),''));
    const remote=new RemoteServices();summaryRemote=remote;
    const summary=await remote.summarize(config,`${dayStamp(dayStart)} 的 ${base.total} 条记录`,base.markdown,voices.cards());
    if(!serviceActive||generation!==serviceGeneration)return;
    const full=bindJournalSummary(base,buildJournalDay(dayStart,journalSources(),''),summary);
    // The mutable day cache is also used by legacy callers. Preserve the
    // complete source-bound AI result before attempting that cache update.
    writeJournalSnapshot(lifelog.rootPath(),dayStart,full.markdown);
    try{writeJournalFile(lifelog.rootPath(),dayStart,full.markdown);}
    catch(_){
      lifelog.note=`已独立保存 ${dayStamp(dayStart)} 的总结；每日缓存更新失败，请在已保存总结中核对`;
      lifelog.changed();return;
    }
    lifelog.note=`已自动生成 ${dayStamp(dayStart)} 的覆盖性总结`;
  }catch(error){
    if(serviceActive&&generation===serviceGeneration){lifelog.note=(error as Error).message;lifelog.changed();}
  }
  finally{if(generation===serviceGeneration){summaryBusy=false;summaryRemote=undefined;}}
}

function windowWaitLabel(reason:string):string{
  if(reason==='waiting_audio')return '已保存原音，等待后续完整音频页';
  if(reason==='window_budget_exhausted')return '已保存原音，转写预算用完，稍后继续';
  if(reason==='interactive_audio')return '已保存原音，优先处理当前语音或录音';
  if(reason==='thermal_limited_or_unknown')return '已保存原音，等待温度允许转写';
  if(reason==='battery_low_or_unknown')return '已保存原音，等待电量允许转写';
  if(reason==='storage_low_or_unknown')return '已保存原音，等待可用存储空间';
  if(reason==='background_unavailable')return '已保存原音，等待系统允许后台处理';
  return '原音与已完成窗口保留，等待继续转写';
}

async function runLifelogWindow(job:LocalAsrJob,generation:number,initial:MaterialRevision):Promise<void>{
  const current=():boolean=>serviceActive&&generation===serviceGeneration;
  try{
    if(!windowPipelineReady)throw new Error('ASR_WINDOW_RECOVERY_UNAVAILABLE');
    const signals=await readTranscriptionSignals(serviceFilesDir);
    if(!current())return;
    if(isDeletedMaterial(job.directory,job.kind)){stopDeletedTranscription(job.directory,job.kind);return;}
    ensureWorker();
    signals.conditions.foreground=probeSession.foreground;
    signals.conditions.bluetoothLease=probeSession.background.active;
    signals.conditions.workerReady=lifelogASR.engine?.isReady()===true;
    // Active lifelog prefixes intentionally share the window worker. A closed
    // local receiver with unresolved device cleanup must not start fresh work.
    signals.conditions.interactiveAudio=probeSession.agentCaptureOccupied||probeSession.voice.active||recordings.occupied||lifelog.occupied&&!lifelog.active||lifelog.pendingWrites||probeSession.features.displayActive||probeSession.prompterOccupied();
    const item=lifelog.items.find((row:LifelogItem):boolean=>lifelog.rootPath()+'/'+row.name===job.directory);
    if(!item||item.interrupted)throw new Error('ASR_CAPTURE_PREFIX_NEEDS_RECONCILIATION');
    let publishedKey='';
    try{
      const published=JSON.parse(lifelog.readTranscriptJson(item)) as Record<string,Object>;
      if(initial.applied_job===job.jobId+'-window-'+String(published['covered_frames']))publishedKey=initial.applied_job;
    }catch(_){}
    const step=await windowPipeline.next(job.jobId,job.sourcePath,item.complete,lifelogASR,publishedKey,signals.conditions,current);
    if(!current()||durableQueue.get(job.jobId)?.status==='cancelled')return;
    if(isDeletedMaterial(job.directory,job.kind)){stopDeletedTranscription(job.directory,job.kind);return;}
    if(!step.result){
      const now=Date.now();const retryAt=Number.isSafeInteger(step.retryAt)&&step.retryAt>0?Math.max(now+1000,step.retryAt):now+60000;
      lifelogASR.log('window-deferred',JSON.stringify({at:now,retryAt,reason:step.reason}));
      durableQueue.deferWindow(job.jobId,step.reason,retryAt);lifelog.note=windowWaitLabel(step.reason);return;
    }
    const result=step.result;
    const coverage=`\n- 转写覆盖：0–${(step.cursor*0.06).toFixed(2)}秒 / 当前原音${result.seconds.toFixed(2)}秒；${step.state==='complete'?'本段处理完成':'仍在分窗处理'}\n`;
    const markdown=lifelogMarkdown('智记 '+new Date(job.started).toLocaleString(),result)+coverage;
    // Metadata may have grown during inference. Re-read current source extent,
    // while appendTranscript still refuses user edits/deletion and races.
    const material=materialForJob(job,result.seconds);
    const coverageInput=new MaterialCoverageInput();coverageInput.complete=step.state==='complete';coverageInput.coveredFrames=step.cursor;
    coverageInput.sourceFrames=result.frames;coverageInput.frameMs=60;
    const savedMaterial=materials.appendTranscript(material.material_id,material.revision,materialTextInput(result,markdown,'unknown',coverageInput),step.commitKey);
    lifelog.saveSegmentResult(job.directory,markdown,JSON.stringify({started:job.started,seconds:result.seconds,speechSeconds:result.speechSeconds,
      utterances:result.utterances,speakers:result.speakers,speaker_processing:result.speakerProcessing||'unknown',
      boundary_processing:result.boundaryProcessing||'unknown',
      transcription_complete:savedMaterial.transcription_state==='complete',covered_frames:step.cursor,source_frames:result.frames}));
    if(step.state==='complete'){durableQueue.transition(job.jobId,'succeeded');void ensureDaySummary(dayStartOf(job.started));}
    else durableQueue.deferWindow(job.jobId,'window_saved',0);
    lifelog.note=step.state==='complete'?'本段文字已保存，原音保留':'窗口文字已保存，按预算继续';
  }catch(error){
    if(!current())return;
    if(handleDeletedTranscription(job,error as Error))return;
    const saved=durableQueue.get(job.jobId);
    if(saved&&saved.status!=='cancelled'){
      try{
        if(windowInterrupted)durableQueue.deferWindow(job.jobId,'interactive_audio',Date.now()+1000);
        else{const retry=saved.attempts<3;durableQueue.transition(job.jobId,retry?'queued':'failed',(error as Error).message,retry?Date.now()+30000*Math.pow(2,saved.attempts-1):0);}
      }
      catch(_){lifelog.note='转写队列写入失败，原音和已提交窗口保留';}
    }
    lifelog.note=windowInterrupted?'原音与已完成窗口保留，优先处理当前语音或录音':'窗口转写待重试：'+(error as Error).message;
  }finally{
    if(current()){
      running=false;currentDirectory='';currentJob=undefined;windowInterrupted=false;refreshQueue();recordings.changed();lifelog.changed();pump();
    }
  }
}

function taskHandle(input:RecordingTaskInput):RecordingCaptureHandle{
  const h=new RecordingCaptureHandle();h.ownerId=input.owner_id;h.cleanupId=input.cleanup_id;h.uuid=input.uuid;
  h.directory=serviceFilesDir+'/recordings/'+input.name;h.peer=input.peer;return h;
}
// A read-only claim of one explicitly owned recording. The queue and material
// head must agree with the sealed result; no scan or "latest transcript" is
// used to infer which words belong to an Agent request.
export function readTaskRecording(handle:RecordingCaptureHandle):TaskRecordingResult{
  const out=new TaskRecordingResult();
  try{
    const root=serviceFilesDir||(recordings.rootDirectory?.endsWith('/recordings')?recordings.rootDirectory.slice(0,-11):'');
    const name=handle.directory.slice(handle.directory.lastIndexOf('/')+1);
    if(!root||!/^take-[a-f0-9]{32}$/.test(name)||handle.directory!==root+'/recordings/'+name)throw new Error('TASK_RECORDING_SOURCE_PATH');
    // Cold recovery may terminate through the normal recording UI, without a
    // live owned handle or a complete audio file. That exact durable exit can
    // release the task copy; it cannot manufacture a complete transcript.
    const cleanup=root+'/recording-cleanup.json';
    if(!fs.accessSync(cleanup+'.partial')&&fs.accessSync(cleanup)&&fs.statSync(cleanup).size<=1024){
      const ended=JSON.parse(fs.readTextSync(cleanup)) as Record<string,Object>;
      if(Object.keys(ended).length===5&&ended['schema']===1&&ended['id']===handle.cleanupId&&ended['uuid']===handle.uuid&&ended['peer']===handle.peer&&
        ['device_event','user_confirmation'].includes(ended['evidence'] as string))out.exitEvidence=ended['evidence'] as string;
    }
    if(!serviceActive){out.state='failed';return out;}
    const path=handle.directory+'/manifest.json';if(fs.statSync(path).size>100000)throw new Error('TASK_RECORDING_SOURCE_MANIFEST');
    const manifest=JSON.parse(fs.readTextSync(path)) as Record<string,Object>;
    if(manifest['uuid']!==handle.uuid||manifest['peer']!==handle.peer||manifest['voice_owner']!==handle.ownerId||manifest['voice_cleanup_id']!==handle.cleanupId)throw new Error('TASK_RECORDING_SOURCE_BINDING');
    if(recordings.activeDirectory===handle.directory){out.state='capturing';return out;}
    if(recordings.cleanupSessionId===handle.cleanupId&&recordings.cleanupRequired){out.state=recordings.active&&!recordings.stopping?'capturing':'cleanup_pending';return out;}
    if(['device_event','user_confirmation'].includes(manifest['voice_exit_evidence'] as string))out.exitEvidence=manifest['voice_exit_evidence'] as string;
    const item=recordings.findByDirectory(handle.directory);if(!item){out.state='failed';return out;}
    recordings.file(item,true);
    const jobId='asr-recording-'+item.name.slice(5),job=durableQueue.get(jobId);
    if(!job){out.state=failed.has(handle.directory)?'failed':'waiting';return out;}
    if(job.kind!=='recording'||job.directory!==handle.directory||job.sourcePath!==handle.directory+'/source.rawopus'||job.started!==item.created)throw new Error('TASK_RECORDING_JOB_CHANGED');
    if(['failed','cancelled'].includes(job.status)){out.state='failed';return out;}
    if(job.status!=='succeeded')return out;
    const resultJson=durableQueue.readResult(jobId),result=JSON.parse(resultJson) as LifelogTranscript;
    const id=materials.idFor('recording',item.name),head=materials.read(id);
    if(!head||head.operation!=='upsert'||head.user_edited||head.text_origin!=='asr'||head.applied_job!==jobId||head.transcription_state!=='complete'||head.recognition_channel!=='mix'||
      head.source.kind!=='recording'||head.source.name!==item.name||!head.source.complete||!head.source.audioAvailable||head.source.audioBytes!==item.bytes||
      !Number.isSafeInteger(result.frames)||result.frames<=0||result.frames!==item.bytes/240||result.windowed===true||
      head.covered_ms!==result.frames*20||head.transcription_source_ms!==result.frames*20||!Array.isArray(result.utterances)||!result.utterances.length||head.utterances.length!==result.utterances.length)throw new Error('TASK_RECORDING_RESULT_INCOMPLETE');
    for(let i=0;i<result.utterances.length;i++){
      const a=result.utterances[i],b=head.utterances[i];
      if(typeof a.text!=='string'||!a.text.trim()||b.text!==a.text||!Number.isFinite(a.start)||!Number.isFinite(a.end)||a.start<0||a.end<a.start||
        b.start_ms!==Math.round(a.start*1000)||b.end_ms!==Math.round(a.end*1000))throw new Error('TASK_RECORDING_RESULT_CHANGED');
    }
    const origin=recordingTaskSources.origin(handle,id,head.revision,resultJson),text=head.utterances.map((part:MaterialUtterance):string=>part.text).join('\n');
    if(!text.trim()||text.length>65536||origin.raw_bytes!==item.bytes)throw new Error('TASK_RECORDING_RESULT_TEXT');
    out.state='complete';out.exitEvidence=origin.exit_evidence;out.text=text;out.origin=origin;return out;
  }catch{out.state='failed';return out;}
}
export function assertTaskRecordingOrigin(origin:TaskRecordingOrigin,textSha256:string):void{
  const h=new RecordingCaptureHandle();h.ownerId=origin.owner_id;h.cleanupId=origin.cleanup_id;h.uuid=origin.uuid;h.peer=origin.peer;h.directory=serviceFilesDir+'/recordings/'+origin.name;
  const result=readTaskRecording(h);if(result.state!=='complete'||!result.origin||!taskSameRecordingOrigin(result.origin,origin))throw new Error('TASK_RECORDING_SOURCE_CHANGED');
  const bytes=new util.TextEncoder().encodeInto(result.text),md=cryptoFramework.createMd('SHA256');
  try{md.updateSync({data:bytes});const hash=md.digestSync().data;try{
    if(Array.from(hash).map((n:number):string=>n.toString(16).padStart(2,'0')).join('')!==textSha256)throw new Error('TASK_RECORDING_TEXT_CHANGED');
  }finally{hash.fill(0);}}finally{bytes.fill(0);}
}

function pump():void{
  if(!serviceActive||!lifelogASR.engine||running||lifelogASR.busy||manualBusy)return;
  if(probeSession.agentCaptureOccupied||probeSession.prompterOccupied()||recordings.occupied||lifelog.occupied&&!lifelog.active||lifelog.pendingWrites){scheduleQueueWake();return;}
  let index=-1;
  index=jobs.findIndex((job:LocalAsrJob):boolean=>job.kind==='recording'&&job.nextRun<=Date.now());
  for(let i=0;i<jobs.length;i++){
    if(index>=0)break;
    const job=jobs[i];
    if(job.nextRun<=Date.now()){index=i;break;}
  }
  if(index<0){scheduleQueueWake();return;}
  clearQueueWake();
  const job=jobs.splice(index,1)[0];
  let material:MaterialRevision;
  try{
    if(isDeletedMaterial(job.directory,job.kind))throw new Error('MATERIAL_DELETED');
    material=materialForJob(job);
    if(job.kind==='lifelog'&&hasManualLifelogPublication(job.directory)){stopManualWindow(job.directory);void Promise.resolve().then(():void=>pump());return;}
    if(material.operation==='delete')throw new Error('MATERIAL_DELETED');
    if(material.user_edited)throw new Error('USER_REVISION_PROTECTED');
  }catch(error){
    if(handleDeletedTranscription(job,error as Error)){
      recordings.changed();lifelog.changed();void Promise.resolve().then(():void=>pump());return;
    }
    try{durableQueue.transition(job.jobId,'failed','material_revision_unavailable');refreshQueue();}catch(_){}
    failed.set(job.directory,'资料版本待核对：'+(error as Error).message);recordings.changed();lifelog.changed();
    void Promise.resolve().then(():void=>pump());return;
  }
  try{if(job.status==='queued')durableQueue.transition(job.jobId,'running');}
  catch(_){failed.set(job.directory,'转写状态未能保存，原件保留');return;}
  const generation=serviceGeneration;
  running=true;currentDirectory=job.directory;currentJob=job;
  if(job.kind==='lifelog'&&job.status!=='result_ready'){void runLifelogWindow(job,generation,material);return;}
  const stamp=new Date(job.started).toLocaleString();
  let taskInput:RecordingTaskInput|null=null;
  const work=Promise.resolve().then(():Promise<LifelogTranscript>=>{
    if(!serviceActive||generation!==serviceGeneration)throw new Error('ASR_LIFETIME_ENDED');
    if(job.kind==='recording'&&fs.accessSync(job.directory+'/manifest.json'))taskInput=recordingTaskSources.input(job.directory);
    if(job.status==='result_ready'){
      const raw=durableQueue.readResult(job.jobId);
      if(taskInput)recordingTaskSources.origin(taskHandle(taskInput),material.material_id,material.revision,raw);
      return Promise.resolve(JSON.parse(raw) as LifelogTranscript);
    }
    ensureWorker();
    return job.kind==='recording'?lifelogASR.transcribeRecording(job.sourcePath,'mix',300000):lifelogASR.transcribe(job.sourcePath,300000);
  });
  work.then((result:LifelogTranscript):void=>{
    if(!serviceActive||generation!==serviceGeneration)return;
    if(durableQueue.get(job.jobId)?.status==='cancelled')return;
    if(job.status!=='result_ready'){
      const raw=JSON.stringify(result);if(taskInput)recordingTaskSources.seal(job.directory,taskInput,raw);
      durableQueue.sealResult(job.jobId,raw);
    }
    const markdown=lifelogMarkdown(`${job.kind==='recording'?'录音':'智记'} ${stamp}`,result);
    const coverageInput=new MaterialCoverageInput();coverageInput.complete=true;coverageInput.coveredFrames=result.frames;
    coverageInput.sourceFrames=result.frames;coverageInput.frameMs=job.kind==='recording'?20:60;
    const savedMaterial=materials.appendTranscript(material.material_id,material.revision,materialTextInput(result,markdown,job.kind==='recording'?'mix':'unknown',coverageInput),job.jobId);
    const structured=JSON.parse(JSON.stringify(result)) as Record<string,Object>;
    structured['transcription_complete']=savedMaterial.transcription_state==='complete';structured['covered_frames']=result.frames;structured['source_frames']=result.frames;
    structured['speaker_processing']=result.speakerProcessing||'unknown';structured['boundary_processing']=result.boundaryProcessing||'unknown';
    if(job.kind==='recording'){
      const item=recordings.findByDirectory(job.directory);
      if(!item)throw new Error('录音原件暂不可读，请重试');
      recordings.saveTranscript(item,markdown,JSON.stringify(structured));
      recordings.note=result.utterances.length?'本机转写已保存，可查看或导出文字':'本机转写完成：未检测到有效语音，录音原件保留';
    }else{
      lifelog.saveSegmentResult(job.directory,markdown,
        JSON.stringify({started:job.started,seconds:result.seconds,speechSeconds:result.speechSeconds,utterances:result.utterances,speakers:result.speakers}));
    }
    durableQueue.transition(job.jobId,'succeeded');refreshQueue();
    try{lifelog.refresh();recordings.refresh();}catch(_){}
    void ensureDaySummary(dayStartOf(job.started)).then(():void=>{});
  }).catch((error:Error):void=>{
    if(!serviceActive||generation!==serviceGeneration)return;
    if(handleDeletedTranscription(job,error))return;
    // 不再静默：转写没落盘时要说清楚，否则界面看起来"点了没反应"。
    lifelog.note=`转写未完成：${error.message}`;
    try{
      const saved=durableQueue.get(job.jobId);
      if(saved&&saved.status!=='cancelled'){
        // Retry transient inference failures with a bounded backoff. Sealed
        // results with publication errors wait for an explicit storage retry.
        const retry=saved.status==='running'&&saved.attempts<3&&!error.message.startsWith('RECORDING_TASK_SOURCE_');
        durableQueue.transition(job.jobId,retry?'queued':'failed','transcription_or_publication_failed',retry?Date.now()+30000*Math.pow(2,saved.attempts-1):0);
        refreshQueue();
      }
    }catch(_){failed.set(job.directory,'转写状态保存失败，重启后核对恢复');}
    if(job.kind==='recording')recordings.note='本机转写未完成：'+error.message+'；原件保留，可重试';
    try{lifelogASR.log('job-fail',`kind=${job.kind} ${error.message}`);}catch(_){}
  }).then(():void=>{
    if(!serviceActive||generation!==serviceGeneration)return;
    running=false;currentDirectory='';currentJob=undefined;
    refreshQueue();
    recordings.changed();lifelog.changed();pump();
  });
}

lifelog.onSegmentClosed=(directory:string,oggPath:string,started:number):void=>{
  if(!lifelog.autoTranscribe)return;
  enqueueLocalTranscribe(directory,oggPath,started,'lifelog',false,false);
};
lifelog.onSegmentProgress=(directory:string,oggPath:string,started:number,_frames:number):void=>{
  if(lifelog.autoTranscribe)enqueueLocalTranscribe(directory,oggPath,started,'lifelog',false,false);
};
recordings.onRecordingClosed=(directory:string,rawPath:string,started:number):void=>{
  enqueueLocalTranscribe(directory,rawPath,started,'recording',true,false);
};
