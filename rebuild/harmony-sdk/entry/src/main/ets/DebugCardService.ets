import { common } from '@kit.AbilityKit';
import { FirmwareOtaService } from './FirmwareOtaService';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { DebugCardControl,DebugCardState } from './DebugCardControl';
import { AgentCaptureLabControl } from './AgentCaptureLabControl';
import { LongReadingProbeService } from './LongReadingProbeService';
import { PrompterProbeControl } from './PrompterProbeControl';
import { makePrompterProbeControl } from './PrompterProbeService';
import { DeviceSettingsControl } from './DeviceSettingsControl';
import { deviceSettingsPorts } from './DeviceSettingsService';
import { makeChannelProbeControl } from './ChannelProbeService';
import { suggestionTests } from './NotificationService';
import { probeSession } from './ProbeSession';
import { DebugTaskSnapshot,DebugVoiceState,DebugTaskState,DebugTaskReviewState } from './DebugTaskSnapshot';
import { agentCapture } from './AgentCaptureService';
import { taskRecordingCapture } from './TaskRecordingService';
import { taskService } from './TaskService';
import { taskVoiceReplies,taskSuggestions,taskDraftRecovery } from './TaskSuggestionService';
import { TaskDecisionRecord } from './TaskReplyDraft';
import { TaskDraftRecoveryState } from './TaskDraftRecovery';
import { TaskVoiceSourceView } from './TaskVoiceSources';
import { LocalMaterialQuery,LocalMaterialFilter,LocalMaterialPage,LocalMaterialReference,LocalMaterialScanFilter,LocalMaterialScanPage } from './MaterialLocalQuery';
import { SavedSummaryFilter,SavedSummaryRef,SavedSummaryPage,SavedSummaryChunk } from './SavedJournalSummary';
import { JournalNoteInput,JournalNoteRef,JournalNoteReceipt,JournalNoteFilter,JournalNotePage,JournalNoteChunk } from './JournalSummaryNotes';
import { PlaybackSelection } from './LocalAudioSource';
import { PlaybackSnapshot } from './PlaybackController';
import { RecordingSummaryPreview,RecordingSummaryView,RecordingSummaryList,RecordingSummaryChunk } from './RecordingSummary';
import { RecordingSummaryPiece } from './RecordingSummaryPlan';
import { localWorkspace,WorkspaceTodoReference,WorkspaceTodoPage,WorkspaceTodoDeletionView,WorkspaceTodoQueryView } from './LocalWorkspace';
import { materials,savedJournalSummaries,journalSummaryNotes,localPlayback,recordingSummaries } from './RecordingService';

let control:DebugCardControl|undefined=undefined;let timer:number=-1;let epoch:number=0;
let firmwareControl:FirmwareOtaService|undefined=undefined;let firmwareTimer:number=-1;let firmwareEpoch:number=0;
let labControl:AgentCaptureLabControl|undefined=undefined;let labTimer:number=-1;let labEpoch:number=0;
let readingControl:LongReadingProbeService|undefined=undefined;let readingTimer:number=-1;let readingEpoch:number=0;
let prompterControl:PrompterProbeControl|undefined=undefined;let prompterTimer:number=-1;let prompterEpoch:number=0;
function boundedRead(path:string,limit:number):string|undefined{
  if(!fs.accessSync(path))return undefined;
  const size=fs.statSync(path).size;if(size<1||size>limit)throw new Error('DEBUG_FILE_INVALID');
  const text=fs.readTextSync(path) as string;if(text.length>limit)throw new Error('DEBUG_FILE_INVALID');return text;
}
function atomicWrite(path:string,json:string):void{
  const bytes=new util.TextEncoder().encodeInto(json);if(bytes.length>65536){bytes.fill(0);throw new Error('DEBUG_RESULT_TOO_LARGE');}
  const file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
  try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('DEBUG_WRITE_FAILED');offset+=n;}fs.fsyncSync(file.fd);}
  finally{fs.closeSync(file);bytes.fill(0);}fs.renameSync(path+'.partial',path);
}
function annotationDigest(bytes:Uint8Array):string{
  const md=cryptoFramework.createMd('SHA256');md.updateSync({data:bytes});const digest=md.digestSync().data;
  try{return Array.from(digest).map((value:number):string=>value.toString(16).padStart(2,'0')).join('');}finally{digest.fill(0);}
}
function annotationCapacity(root:string):void{
  const directory=fs.lstatSync(root);if(directory.isSymbolicLink()||!directory.isDirectory())throw new Error('NOTE_BLOCKED');
  let count=0,bytes=0;const names=fs.listFileSync(root);
  for(const name of names){
    if(!name.endsWith('-annotation.json'))continue;
    if(!/^dbg-[a-f0-9]{32}-annotation\.json$/.test(name))throw new Error('NOTE_BLOCKED');
    if(++count>128)throw new Error('NOTE_BLOCKED');
    const item=fs.lstatSync(root+'/'+name);if(item.isSymbolicLink()||!item.isFile()||!Number.isSafeInteger(item.size)||item.size<1||item.size>65536)throw new Error('NOTE_BLOCKED');
    bytes+=item.size;if(bytes>8388608)throw new Error('NOTE_BLOCKED');
  }
}
function annotationBytes(root:string,id:string,expected:string):Uint8Array{
  if(!/^dbg-[a-f0-9]{32}$/.test(id)||!/^[a-f0-9]{64}$/.test(expected))throw new Error('NOTE_INVALID');
  const directory=fs.lstatSync(root);if(directory.isSymbolicLink()||!directory.isDirectory())throw new Error('NOTE_BLOCKED');
  const path=root+'/'+id+'-annotation.json',stat=fs.lstatSync(path);
  if(stat.isSymbolicLink()||!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<1||stat.size>65536)throw new Error('NOTE_INVALID');
  const bytes=new Uint8Array(stat.size);let valid=false;
  try{
    const file=fs.openSync(path,fs.OpenMode.READ_ONLY);
    try{
      if(fs.statSync(file.fd).size!==stat.size)throw new Error('NOTE_INVALID');let at=0;
      while(at<bytes.length){const part=new Uint8Array(Math.min(16384,bytes.length-at));try{
        const n=fs.readSync(file.fd,part.buffer,{length:part.length});if(!Number.isSafeInteger(n)||n<1||n>part.length)throw new Error('NOTE_INVALID');bytes.set(part.subarray(0,n),at);at+=n;
      }finally{part.fill(0);}}
      const extra=new Uint8Array(1);try{if(fs.readSync(file.fd,extra.buffer,{length:1})!==0)throw new Error('NOTE_INVALID');}finally{extra.fill(0);}
      const latest=fs.lstatSync(path);if(latest.isSymbolicLink()||!latest.isFile()||latest.size!==stat.size||fs.statSync(file.fd).size!==stat.size)throw new Error('NOTE_INVALID');
    }finally{fs.closeSync(file);}
    if(annotationDigest(bytes)!==expected)throw new Error('NOTE_INVALID');valid=true;return bytes;
  }finally{if(!valid)bytes.fill(0);}
}
function loadAnnotation(root:string,id:string,expected:string,operation:string):JournalNoteInput{
  try{
    annotationCapacity(root);const bytes=annotationBytes(root,id,expected);
    try{
      const text=new util.TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decodeToString(bytes),roundtrip=new util.TextEncoder().encodeInto(text);
      try{if(roundtrip.length!==bytes.length||roundtrip.some((value:number,index:number):boolean=>value!==bytes[index]))throw new Error('NOTE_INVALID');}finally{roundtrip.fill(0);}
      const input=JSON.parse(text) as JournalNoteInput;
      if(!input||input.operation_id!==operation||![4,5].includes(Object.keys(input).length)||!['operation_id','parent','source_sha256','text'].every((key:string):boolean=>Object.keys(input).includes(key))||
        Object.keys(input).some((key:string):boolean=>!['operation_id','parent','source_sha256','text','previous'].includes(key)))throw new Error('NOTE_INVALID');
      return input;
    }finally{bytes.fill(0);}
  }catch(error){if((error as Error).message==='NOTE_BLOCKED')throw new Error('NOTE_BLOCKED');throw new Error('NOTE_INVALID');}
}
function cleanupAnnotation(root:string,id:string,expected:string):void{
  // Never remove attachment evidence before the exact terminal receipt exists.
  // Cleanup is best effort and cannot change a committed note or its receipt.
  try{
    if(!/^dbg-[a-f0-9]{32}$/.test(id)||!/^[a-f0-9]{64}$/.test(expected))return;
    const receiptPath=root+'/'+id+'.json',stat=fs.lstatSync(receiptPath);if(stat.isSymbolicLink()||!stat.isFile())return;
    const raw=boundedRead(receiptPath,65536);if(!raw)return;const result=JSON.parse(raw) as Record<string,Object>;
    if(result['schema']!==1||result['id']!==id||!['complete','error'].includes(result['state'] as string)||typeof result['request_json']!=='string')return;
    const request=JSON.parse(result['request_json'] as string) as Record<string,Object>,selection=request['annotation'] as Record<string,Object>;
    if(request['schema']!==7||request['id']!==id||!['save-summary-note','resume-summary-note'].includes(request['action'] as string)||selection?.['body_sha256']!==expected)return;
    const bytes=annotationBytes(root,id,expected);bytes.fill(0);fs.unlinkSync(root+'/'+id+'-annotation.json');
  }catch{}
}
export function initializeDebugCards(context:common.UIAbilityContext):void{
  if(control||context.applicationInfo?.debug!==true)return;
  const root=context.filesDir+'/io-debug';if(!fs.accessSync(root))fs.mkdirSync(root);
  try{
    firmwareControl=new FirmwareOtaService(context,(name:string):string|undefined=>{if(!/^(firmware-(command|journal|status)|fw-[a-f0-9]{32})\.json$/.test(name))throw new Error('OTA_LOCAL_PATH');if(fs.accessSync(root+'/'+name+'.partial'))throw new Error('OTA_PARTIAL');return boundedRead(root+'/'+name,16384);},
      (name:string,text:string):void=>{if(!/^(firmware-(journal|status)|fw-[a-f0-9]{32})\.json$/.test(name))throw new Error('OTA_LOCAL_PATH');atomicWrite(root+'/'+name,text);});
    const generation=++firmwareEpoch;
    const pollFirmware=():void=>{if(generation!==firmwareEpoch||!firmwareControl)return;firmwareControl.poll().finally(()=>{if(generation===firmwareEpoch&&firmwareControl)firmwareTimer=setTimeout(pollFirmware,250);});};
    firmwareTimer=setTimeout(pollFirmware,250);
  }catch(_){probeSession.firmwareOccupied=true;probeSession.auth.firmwareExclusive=true;}
  try{
    prompterControl=makePrompterProbeControl(
      (name:string):string|undefined=>{if(fs.accessSync(root+'/'+name+'.partial'))throw new Error('PROMPTER_PARTIAL');return boundedRead(root+'/'+name,16384);},
      (name:string,json:string):void=>atomicWrite(root+'/'+name,json),
      ():void=>{if(fs.listFileSync(root).filter((name:string):boolean=>/^prm-[a-f0-9]{32}\.json(?:\.partial)?$/.test(name)).length>=128)throw new Error('PROMPTER_RECEIPT_CAPACITY');});
    const prompterGeneration=++prompterEpoch;
    const pollPrompter=():void=>{if(prompterGeneration!==prompterEpoch||!prompterControl)return;
      prompterControl.poll().catch(()=>{}).finally(()=>{if(prompterGeneration===prompterEpoch&&prompterControl)prompterTimer=setTimeout(pollPrompter,250);});};
    prompterTimer=setTimeout(pollPrompter,250);
  }catch(_){prompterControl=undefined;}
  // Dedicated synthetic experiment; failure leaves the existing app and durable
  // prompter cleanup usable. Never replay starts or route choices to real tasks.
  try{
    readingControl=new LongReadingProbeService(
      (name:string):string|undefined=>{if(fs.accessSync(root+'/'+name+'.partial'))throw new Error('READING_PARTIAL');return boundedRead(root+'/'+name,16384);},
      (name:string,json:string):void=>atomicWrite(root+'/'+name,json));
    const readingGeneration=++readingEpoch;
    const pollReading=():void=>{if(readingGeneration!==readingEpoch||!readingControl)return;
      readingControl.poll().catch(()=>{}).finally(()=>{if(readingGeneration===readingEpoch&&readingControl)readingTimer=setTimeout(pollReading,250);});};
    readingTimer=setTimeout(pollReading,250);
  }catch(_){readingControl=undefined;}
  labControl=new AgentCaptureLabControl({
    state:()=>agentCapture.state,active:()=>agentCapture.active,originalPeer:()=>agentCapture.observationPeer,generation:()=>agentCapture.observationGeneration,
    peer:()=>probeSession.features.state.connected?probeSession.peerDeviceId:'',connection:()=>probeSession.auth.connectionGeneration,
    connected:()=>probeSession.features.state.connected,foreground:()=>probeSession.foreground,
    stop:()=>agentCapture.stop(false),cleanup:()=>agentCapture.cleanup(),
    command:(priority:boolean):string|undefined=>boundedRead(root+(priority?'/lab-stop.json':'/lab-command.json'),2048),
    receipt:(id:string):string|undefined=>{const path=root+'/'+id+'.json';if(fs.accessSync(path+'.partial'))throw new Error('LAB_RECEIPT_INVALID');return boundedRead(path,16384);},
    save:(id:string,json:string):void=>{const path=root+'/'+id+'.json';if(fs.accessSync(path+'.partial'))throw new Error('LAB_RECEIPT_INVALID');atomicWrite(path,json);}
  });
  // This timer never awaits the task/settings/display queue or ASR completion.
  const labGeneration=++labEpoch;
  const pollLab=():void=>{if(labGeneration!==labEpoch||!labControl)return;try{labControl.poll();}finally{if(labGeneration===labEpoch&&labControl)labTimer=setTimeout(pollLab,500);}};
  labTimer=setTimeout(pollLab,500);
  const settingsControl=new DeviceSettingsControl(deviceSettingsPorts(
    ():string|undefined=>boundedRead(root+'/device-command.json',4096),
    (id:string):string|undefined=>boundedRead(root+'/'+id+'.json',65536),
    (id:string,json:string):void=>atomicWrite(root+'/'+id+'.json',json)));
  const channelControl=makeChannelProbeControl(
    ():string|undefined=>{
      const stop=boundedRead(root+'/channel-stop.json',4096);
      if(stop){try{const request=JSON.parse(stop) as Record<string,Object>;
        if(request['action']==='display-stop'&&/^chn-[a-f0-9]{32}$/.test(request['id'] as string)&&!boundedRead(root+'/'+request['id']+'.json',65536))return stop;
      }catch(_){}}
      return boundedRead(root+'/channel-command.json',4096);
    },
    (id:string):string|undefined=>boundedRead(root+'/'+id+'.json',65536),
    (id:string,json:string):void=>atomicWrite(root+'/'+id+'.json',json));
  const local=new LocalMaterialQuery({ids:():string[]=>materials.ids(),read:(id:string)=>materials.read(id),catalog:()=>materials.queryCatalog()});
  const task=new DebugTaskSnapshot({
    capture:():DebugVoiceState=>{const r=taskRecordingCapture.state,v=new DebugVoiceState();
      if(r.binding||r.active){v.active=r.active;v.phase=r.phase;v.binding=r.binding;v.text=r.text;v.exitEvidence=r.exitEvidence;v.transcriptStatus=r.transcriptStatus;
        v.metricsAvailable=false;return v;}
      const s=agentCapture.state;v.active=agentCapture.active;v.phase=s.phase;
      v.binding=s.binding;v.text=s.text;v.exitEvidence=s.exitEvidence;v.packets=s.packets;v.pcmBytes=s.pcmBytes;v.nonzeroPackets=s.nonzeroPackets;
      v.tailPackets=s.tailPackets;v.tailPcmBytes=s.tailPcmBytes;v.lateAudioPackets=s.lateAudioPackets;v.inputSealed=s.inputSealed;v.tailTimedOut=s.tailTimedOut;
      v.stopSubmitted=s.stopSubmitted;v.workerExited=s.workerExited;v.recorderStop=s.recorderStop;v.exitWrite=s.exitWrite;v.exitReason=s.exitReason;
      v.compressedPackets=s.compressedPackets;v.compressedBytes=s.compressedBytes;v.repeatedCompressedPackets=s.repeatedCompressedPackets;v.lastCompressedSha256=s.lastCompressedSha256;
      v.firstAudioAt=s.firstAudioAt;v.lastAudioAt=s.lastAudioAt;v.stopRequestedAt=s.stopRequestedAt;v.inputSealedAt=s.inputSealedAt;v.pcmRms=s.pcmRms;v.pcmPeak=s.pcmPeak;
      v.type1Packets=s.type1Packets;v.firstType1At=s.firstType1At;v.micWriteStartedAt=s.micWriteStartedAt;v.micWriteCompletedAt=s.micWriteCompletedAt;
      v.firstDecodedCompressedBytes=s.firstDecodedCompressedBytes;v.firstDecodedSamples=s.firstDecodedSamples;
      v.transcriptStatus=s.transcriptStatus;v.boundaryEvidence=s.boundaryEvidence;v.observationRestored=s.observationRestored;return v;},
    draft:():TaskDecisionRecord|undefined=>taskService.decisionDraft.snapshot(),paused:():boolean=>taskService.decisionDraft.paused,
    foreground:():boolean=>probeSession.foreground,device:():string=>probeSession.features.state.connected?probeSession.peerDeviceId:'',
    context:():string=>taskService.summary().contextKey,canRecover:():boolean=>taskVoiceReplies.canRecover,
    finish:():Promise<void>=>taskVoiceReplies.stop(),cancel:():void=>taskVoiceReplies.cancel(),recover:():Promise<void>=>taskVoiceReplies.recover(),
    reviewStatus:():DebugTaskReviewState=>taskSuggestions.reviewStatus(),reviewCard:(expected:string):Promise<void>=>taskSuggestions.showReview(expected),
    sourceStatus:():TaskVoiceSourceView=>taskService.sourceStatus()
  });
  control=new DebugCardControl({
    command:():string|undefined=>boundedRead(root+'/command.json',2048),
    result:(id:string):string|undefined=>boundedRead(root+'/'+id+'.json',65536),save:(id:string,json:string):void=>atomicWrite(root+'/'+id+'.json',json),
    foreground:():boolean=>probeSession.foreground,
    status:():DebugCardState=>{const s=new DebugCardState();s.phase=suggestionTests.phase;s.active=suggestionTests.active;s.busy=suggestionTests.busy;
      s.uid=suggestionTests.pendingUid;s.command=suggestionTests.command;s.remainingMs=suggestionTests.remainingMs;s.note=suggestionTests.note;
      s.connected=probeSession.features.state.connected;s.foreground=probeSession.foreground;
      s.cardOccupied=probeSession.agentSuggestionOccupied;s.captureActive=probeSession.agentCaptureOccupied;return s;},
    show:async():Promise<void>=>{if(!probeSession.foreground)throw new Error('DEBUG_NOT_FOREGROUND');
      await suggestionTests.start('时长观察','请先不操作。只观察显示多久，不创建待办，不提交Agent答案。',120);},
    remove:async(uid:string):Promise<void>=>{if(!probeSession.foreground||!suggestionTests.active||suggestionTests.pendingUid!==uid)throw new Error('DEBUG_UID_CHANGED');await suggestionTests.remove();},
    taskStatus:():DebugTaskState=>task.status(),voice:(action:string,expected:string):Promise<void>=>task.perform(action,expected),
    reviewCard:(expected:string):Promise<void>=>task.performReview(expected),
    recoveryStatus:():TaskDraftRecoveryState=>taskDraftRecovery.inspect(),
    restoreDraft:(source:string,expected:string):void=>taskDraftRecovery.restore(source,expected),
    localQuery:(filter:LocalMaterialFilter):LocalMaterialPage=>local.query(filter),
    localScan:(filter:LocalMaterialScanFilter):LocalMaterialScanPage=>local.scan(filter),
    summaryList:(filter:SavedSummaryFilter):SavedSummaryPage=>savedJournalSummaries.list(filter),
    summaryRead:(reference:SavedSummaryRef,offset:number,maxChars:number):SavedSummaryChunk=>savedJournalSummaries.chunk(reference,offset,maxChars),
    noteInput:(id:string,bodySha:string,operation:string):JournalNoteInput=>loadAnnotation(root,id,bodySha,operation),
    noteSave:(input:JournalNoteInput,resume:boolean):JournalNoteReceipt=>resume?journalSummaryNotes.resume(input):journalSummaryNotes.save(input),
    noteStatus:(operation:string):JournalNoteReceipt=>journalSummaryNotes.inspect(operation),noteList:(filter:JournalNoteFilter):JournalNotePage=>journalSummaryNotes.list(filter),
    noteRead:(reference:JournalNoteRef,format:string,offset:number,maxChars:number):JournalNoteChunk=>journalSummaryNotes.chunk(reference,format,offset,maxChars),
    notePending:(operation:string,inputSha:string):JournalNoteInput=>journalSummaryNotes.pendingInput(operation,inputSha),
    noteCleanup:(id:string,bodySha:string):void=>cleanupAnnotation(root,id,bodySha),
    playbackPlay:(selection:PlaybackSelection):Promise<PlaybackSnapshot>=>localPlayback.play(selection),
    playbackStatus:():PlaybackSnapshot=>localPlayback.snapshot(),playbackPause:(id:string):Promise<PlaybackSnapshot>=>localPlayback.pause(id),
    playbackResume:(id:string):Promise<PlaybackSnapshot>=>localPlayback.resume(id),
    playbackSeek:(id:string,position:number):Promise<PlaybackSnapshot>=>localPlayback.seek(id,position),playbackStop:(id:string):Promise<PlaybackSnapshot>=>localPlayback.stop(id),
    recordingSummaryPreview:(reference:LocalMaterialReference):RecordingSummaryPreview=>recordingSummaries.preview(reference),
    recordingSummaryStart:(id:string,reference:LocalMaterialReference):Promise<RecordingSummaryView>=>recordingSummaries.start(id,reference),
    recordingSummaryStatus:(id:string):RecordingSummaryView=>recordingSummaries.status(id),
    recordingSummaryCancel:(id:string,sha:string):RecordingSummaryView=>recordingSummaries.cancel(id,sha),
    recordingSummaryResume:(id:string,sha:string):Promise<RecordingSummaryView>=>recordingSummaries.resume(id,sha),
    recordingSummaryList:(id:string,limit:number,cursor:string):RecordingSummaryList=>recordingSummaries.list(id,limit,cursor),
    recordingSummaryRead:(id:string,sha:string,format:string,offset:number,maxChars:number):RecordingSummaryChunk=>recordingSummaries.chunk(id,sha,format,offset,maxChars),
    recordingSummaryCitation:(id:string,piece:string,sha:string):RecordingSummaryPiece=>recordingSummaries.citation(id,piece,sha),
    todoPage:(scope:string,limit:number,cursor:string):WorkspaceTodoPage=>localWorkspace.todoPage(scope,limit,cursor),
    todoDelete:(operation:string,reference:WorkspaceTodoReference):Promise<WorkspaceTodoDeletionView>=>localWorkspace.deleteTodo(operation,reference),
    todoDeleteStatus:(operation:string):WorkspaceTodoDeletionView=>localWorkspace.todoDeleteStatus(operation),
    todoDeleteCancel:(operation:string,sha:string):Promise<WorkspaceTodoDeletionView>=>localWorkspace.cancelTodoDelete(operation,sha),
    todoDeleteSend:(operation:string,sha:string):Promise<WorkspaceTodoDeletionView>=>localWorkspace.sendTodoDelete(operation,sha),
    todoQuery:():Promise<WorkspaceTodoQueryView>=>localWorkspace.queryCurrentTodos(),todoQueryStatus:():WorkspaceTodoQueryView=>localWorkspace.todoQueryStatus()
  });
  control.enable(true);const generation=++epoch;
  const poll=():void=>{if(generation!==epoch||!control)return;channelControl.poll().then(()=>settingsControl.poll()).then(()=>control?.poll()).finally(()=>{if(generation===epoch&&control)timer=setTimeout(poll,1000);});};
  timer=setTimeout(poll,1000);
}
export function disposeDebugCards():void{++epoch;if(timer!==-1)clearTimeout(timer);timer=-1;control?.dispose();control=undefined;
  ++firmwareEpoch;if(firmwareTimer!==-1)clearTimeout(firmwareTimer);firmwareTimer=-1;firmwareControl?.dispose();firmwareControl=undefined;
  ++prompterEpoch;if(prompterTimer!==-1)clearTimeout(prompterTimer);prompterTimer=-1;prompterControl?.dispose();prompterControl=undefined;
  ++readingEpoch;if(readingTimer!==-1)clearTimeout(readingTimer);readingTimer=-1;readingControl?.dispose();readingControl=undefined;
  ++labEpoch;if(labTimer!==-1)clearTimeout(labTimer);labTimer=-1;labControl?.dispose();labControl=undefined;}
