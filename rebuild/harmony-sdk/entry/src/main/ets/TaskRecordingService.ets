import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { TaskRecordingCapture } from './TaskRecordingCapture';
import { RecordingCaptureHandle,RecordingOwnedStart } from './RecordingSession';
import { recordings,readTaskRecording,assertTaskRecordingOrigin } from './RecordingService';
import { TaskRecordingOrigin,TaskRecordingResult } from './TaskRecordingTypes';
import { probeSession } from './ProbeSession';
import { agentCapture,agentCaptureView } from './AgentCaptureService';
import { notifications,suggestionTests } from './NotificationService';
import { taskService } from './TaskService';
import { readLauncherEnvelope } from 'turbo_core';

let journalPath:string='';let timer:number=-1;
function loadJournal():string{
  if(!journalPath||fs.accessSync(journalPath+'.partial'))throw new Error('TASK_RECORDING_JOURNAL_PARTIAL');
  if(!fs.accessSync(journalPath))return '';
  const size=fs.statSync(journalPath).size;if(!Number.isSafeInteger(size)||size<1||size>262144)throw new Error('TASK_RECORDING_JOURNAL_SIZE');
  const raw=fs.readTextSync(journalPath);return raw==='null'?'':raw;
}
function saveJournal(raw:string):void{
  if(!journalPath||fs.accessSync(journalPath+'.partial'))throw new Error('TASK_RECORDING_JOURNAL_PARTIAL');
  const bytes=new util.TextEncoder().encodeInto(raw||'null');
  try{
    if(bytes.length>262144)throw new Error('TASK_RECORDING_JOURNAL_SIZE');
    const file=fs.openSync(journalPath+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const part=bytes.slice(offset);try{
      const count=fs.writeSync(file.fd,part.buffer);if(!Number.isSafeInteger(count)||count<1||count>part.length)throw new Error('TASK_RECORDING_JOURNAL_WRITE');offset+=count;
    }finally{part.fill(0);}}fs.fsyncSync(file.fd);}finally{fs.closeSync(file);}
    fs.renameSync(journalPath+'.partial',journalPath);
  }finally{bytes.fill(0);}
}
export const taskRecordingCapture:TaskRecordingCapture=new TaskRecordingCapture({
  start:(options:RecordingOwnedStart):Promise<RecordingCaptureHandle>=>recordings.startOwned(options),
  stop:(handle:RecordingCaptureHandle):Promise<void>=>recordings.stopOwned(handle),
  read:(handle:RecordingCaptureHandle):TaskRecordingResult=>readTaskRecording(handle),
  peer:():string=>probeSession.features.state.connected?probeSession.peerDeviceId:'',
  epoch:():number=>probeSession.auth.connectionGeneration,
  // RecordingSession owns its own start reservation and the lifelog handoff.
  // This predicate excludes other channels, not that reservation or its ASR.
  available:():boolean=>probeSession.foreground&&!probeSession.features.launcherBusy&&!probeSession.agentSuggestionOccupied&&
    !agentCapture.active&&!agentCapture.state.text&&!probeSession.voice.active&&!probeSession.voice.pendingWrites&&
    !probeSession.features.displayActive&&!probeSession.prompterOccupied()&&!notifications.occupied&&!suggestionTests.active,
  load:():string=>loadJournal(),save:(raw:string):void=>saveJournal(raw)
});
export function observeTaskRecordingAudio(peer:string,epoch:number,payload:Uint8Array):void{
  if(!taskRecordingCapture.state.binding)return;
  try{const packet=readLauncherEnvelope(payload);if(packet.type!==3)return;
    const value=JSON.parse(new util.TextDecoder('utf-8',{fatal:true}).decodeToString(packet.json)) as Record<string,Object>;
    if(typeof value['uuid']==='string')taskRecordingCapture.lateAudio(peer,epoch,value['uuid'] as string);
  }catch{ /* RecordingSession retains its own protocol/coverage failure path. */ }
}
export function initializeTaskRecordingCapture(context:common.UIAbilityContext):void{
  const path=context.filesDir+'/task-recording-capture.json';
  if(journalPath&&journalPath!==path)throw new Error('TASK_RECORDING_DIRECTORY_CHANGED');journalPath=path;
  taskService.voiceSources.assertRecordingOrigin=(origin:TaskRecordingOrigin,textHash:string):void=>assertTaskRecordingOrigin(origin,textHash);
  taskRecordingCapture.changed=():void=>{try{agentCaptureView.replyChanged();}catch{}};
  agentCaptureView.replyOccupied=():boolean=>!!taskRecordingCapture.state.binding||taskRecordingCapture.state.active;
  taskRecordingCapture.initialize();
  if(timer===-1)timer=setInterval(()=>taskRecordingCapture.tick(),500);
}
export function disposeTaskRecordingCapture():void{
  if(timer!==-1)clearInterval(timer);timer=-1;
  try{taskRecordingCapture.disconnected();}catch{}
  taskRecordingCapture.changed=():void=>{};agentCaptureView.replyOccupied=():boolean=>false;
  taskService.voiceSources.assertRecordingOrigin=():void=>{throw new Error('TASK_RECORDING_SOURCE_UNAVAILABLE');};
}
