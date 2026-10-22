import { DebugTaskState } from './DebugTaskSnapshot';
import { TaskDraftRecoveryState } from './TaskDraftRecovery';
import { LocalMaterialFilter,LocalMaterialPage,LocalMaterialReference,LocalMaterialScanFilter,LocalMaterialScanPage } from './MaterialLocalQuery';
import { SavedSummaryFilter,SavedSummaryRef,SavedSummaryPage,SavedSummaryChunk } from './SavedJournalSummary';
import { JournalNoteInput,JournalNoteRef,JournalNoteReceipt,JournalNoteFilter,JournalNotePage,JournalNoteChunk } from './JournalSummaryNotes';
import { PlaybackSelection,validPlaybackSelection } from './LocalAudioSource';
import { PlaybackSnapshot } from './PlaybackController';
import { RecordingSummaryPreview,RecordingSummaryView,RecordingSummaryList,RecordingSummaryChunk } from './RecordingSummary';
import { RecordingSummaryPiece } from './RecordingSummaryPlan';
import { WorkspaceTodoReference,WorkspaceTodoPage,WorkspaceTodoDeletionView,WorkspaceTodoQueryView } from './LocalWorkspace';

// Local debug-build inbox, transported by HDC app-file access. No task answer,
// microphone start, todo creation or arbitrary business writes are reachable.
export class DebugCardState {
  phase:string='';active:boolean=false;busy:boolean=false;uid:string='';command:number=0;
  connected:boolean=false;foreground:boolean=false;cardOccupied:boolean=false;captureActive:boolean=false;
  remainingMs:number=0;note:string='';
}
class DebugCardRequest {
  schema:number=1;id:string='';action:string='';created_at:string='';expires_at:string='';expected_uid:string='';
  expected_voice_binding:string='';expected_reply_binding:string='';
  expected_recovery_binding:string='';recovery_source:string='';
  local_query:LocalMaterialFilter|undefined=undefined;
  local_scan:LocalMaterialScanFilter|undefined=undefined;
  saved_summary:SavedSummaryFilter|DebugSummaryRead|undefined=undefined;
  annotation:DebugAnnotation|undefined=undefined;
  playback:PlaybackSelection|DebugPlaybackCommand|undefined=undefined;
  recording_summary:DebugRecordingSummary|undefined=undefined;
  todo:DebugTodo|undefined=undefined;
}
class DebugTodo {scope:string='';limit:number=10;cursor:string='';operation_id:string='';reference:WorkspaceTodoReference|undefined=undefined;confirm:boolean=false;state_sha256:string='';}
class DebugRecordingSummary {reference:LocalMaterialReference|undefined=undefined;job_id:string='';state_sha256:string='';confirm_send:boolean=false;material_id:string='';piece_id:string='';format:string='';offset:number=0;max_chars:number=4000;limit:number=10;cursor:string='';}
class DebugPlaybackCommand {session_id:string='';position_ms:number=0;}
class DebugSummaryRead {day:string='';summary_id:string='';content_sha256:string='';offset:number=0;max_chars:number=4000;}
class DebugAnnotation {operation_id:string='';body_sha256:string='';input_sha256:string='';day:string='';limit:number=10;cursor:string='';note_id:string='';content_sha256:string='';format:string='';offset:number=0;max_chars:number=4000;}
class DebugCardResult {
  schema:number=1;id:string='';request_json:string='';state:string='running';started_at:string='';finished_at:string='';
  error:string='';snapshot:DebugCardState=new DebugCardState();
  task_snapshot:DebugTaskState|undefined=undefined;control_call_completed:boolean=false;
  recovery_snapshot:TaskDraftRecoveryState|undefined=undefined;
  local_query:LocalMaterialPage|undefined=undefined;
  local_scan:LocalMaterialScanPage|undefined=undefined;
  saved_summaries:SavedSummaryPage|undefined=undefined;saved_summary:SavedSummaryChunk|undefined=undefined;
  summary_note_receipt:JournalNoteReceipt|undefined=undefined;summary_notes:JournalNotePage|undefined=undefined;summary_note_chunk:JournalNoteChunk|undefined=undefined;
  summary_note_pending:JournalNoteInput|undefined=undefined;
  playback_snapshot:PlaybackSnapshot|undefined=undefined;
  recording_summary_preview:RecordingSummaryPreview|undefined=undefined;recording_summary_view:RecordingSummaryView|undefined=undefined;
  recording_summary_list:RecordingSummaryList|undefined=undefined;recording_summary_chunk:RecordingSummaryChunk|undefined=undefined;
  recording_summary_piece:RecordingSummaryPiece|undefined=undefined;
  todo_page:WorkspaceTodoPage|undefined=undefined;todo_deletion:WorkspaceTodoDeletionView|undefined=undefined;todo_query:WorkspaceTodoQueryView|undefined=undefined;
}
export interface DebugCardPorts {
  command:()=>string|undefined;result:(id:string)=>string|undefined;save:(id:string,json:string)=>void;
  foreground:()=>boolean;status:()=>DebugCardState;show:()=>Promise<void>;remove:(uid:string)=>Promise<void>;
  taskStatus:()=>DebugTaskState;voice:(action:string,expected:string)=>Promise<void>;reviewCard:(expected:string)=>Promise<void>;
  recoveryStatus:()=>TaskDraftRecoveryState;restoreDraft:(source:string,expected:string)=>void;
  localQuery?:(filter:LocalMaterialFilter)=>LocalMaterialPage;
  localScan?:(filter:LocalMaterialScanFilter)=>LocalMaterialScanPage;
  summaryList?:(filter:SavedSummaryFilter)=>SavedSummaryPage;
  summaryRead?:(reference:SavedSummaryRef,offset:number,maxChars:number)=>SavedSummaryChunk;
  noteInput?:(id:string,bodySha:string,operation:string)=>JournalNoteInput;noteSave?:(input:JournalNoteInput,resume:boolean)=>JournalNoteReceipt;
  noteStatus?:(operation:string)=>JournalNoteReceipt;noteList?:(filter:JournalNoteFilter)=>JournalNotePage;
  noteRead?:(reference:JournalNoteRef,format:string,offset:number,maxChars:number)=>JournalNoteChunk;noteCleanup?:(id:string,bodySha:string)=>void;
  notePending?:(operation:string,inputSha:string)=>JournalNoteInput;
  playbackPlay?:(selection:PlaybackSelection)=>Promise<PlaybackSnapshot>;playbackStatus?:()=>PlaybackSnapshot;
  playbackPause?:(id:string)=>Promise<PlaybackSnapshot>;playbackResume?:(id:string)=>Promise<PlaybackSnapshot>;
  playbackSeek?:(id:string,position:number)=>Promise<PlaybackSnapshot>;playbackStop?:(id:string)=>Promise<PlaybackSnapshot>;
  recordingSummaryPreview?:(reference:LocalMaterialReference)=>RecordingSummaryPreview;
  recordingSummaryStart?:(id:string,reference:LocalMaterialReference)=>Promise<RecordingSummaryView>;
  recordingSummaryStatus?:(id:string)=>RecordingSummaryView;recordingSummaryCancel?:(id:string,sha:string)=>RecordingSummaryView;
  recordingSummaryResume?:(id:string,sha:string)=>Promise<RecordingSummaryView>;recordingSummaryList?:(id:string,limit:number,cursor:string)=>RecordingSummaryList;
  recordingSummaryRead?:(id:string,sha:string,format:string,offset:number,maxChars:number)=>RecordingSummaryChunk;
  recordingSummaryCitation?:(id:string,piece:string,sha:string)=>RecordingSummaryPiece;
  todoPage?:(scope:string,limit:number,cursor:string)=>WorkspaceTodoPage;
  todoDelete?:(operation:string,reference:WorkspaceTodoReference)=>Promise<WorkspaceTodoDeletionView>;
  todoDeleteStatus?:(operation:string)=>WorkspaceTodoDeletionView;
  todoDeleteCancel?:(operation:string,sha:string)=>Promise<WorkspaceTodoDeletionView>;
  todoDeleteSend?:(operation:string,sha:string)=>Promise<WorkspaceTodoDeletionView>;
  todoQuery?:()=>Promise<WorkspaceTodoQueryView>;todoQueryStatus?:()=>WorkspaceTodoQueryView;
}
export class DebugCardControl {
  private enabled:boolean=false;private busy:boolean=false;private generation:number=0;
  private ports:DebugCardPorts;note:string='';
  constructor(ports:DebugCardPorts){this.ports=ports;}
  enable(debug:boolean):void{++this.generation;this.enabled=debug===true;}
  dispose():void{++this.generation;this.enabled=false;}
  private localText(text:string,limit:number):boolean{
    if(typeof text!=='string'||text.length>limit||/[\u0000-\u001f\u007f-\u009f]/.test(text))return false;
    for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){const next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
      else if(code>=0xdc00&&code<=0xdfff)return false;}
    return true;
  }
  private localFilter(value:LocalMaterialFilter|undefined):boolean{
    if(!value||Object.keys(value).length!==6||!['from','to','keyword','speaker','limit','cursor'].every((key:string):boolean=>Object.keys(value).includes(key))||
      !Number.isSafeInteger(value.from)||!Number.isSafeInteger(value.to)||value.from<0||value.to<0||value.from>8640000000000000||value.to>8640000000000000||
      (value.from!==0||value.to!==0)&&(value.to<=value.from||value.to-value.from>366*86400000)||
      !Number.isSafeInteger(value.limit)||value.limit<1||value.limit>10||typeof value.cursor!=='string')return false;
    if(!this.localText(value.keyword,200)||!this.localText(value.speaker,80))return false;
    if(!value.keyword.trim()&&!value.speaker.trim())return false;
    if(value.cursor){if(!/^[a-f0-9]{64}:(0|[1-9][0-9]*)$/.test(value.cursor)||!Number.isSafeInteger(Number(value.cursor.split(':')[1])))return false;}
    return true;
  }
  private localScanFilter(value:LocalMaterialScanFilter|undefined):boolean{
    if(!value||Object.keys(value).length!==7||!['from','to','keyword','speaker','limit','scan_cursor','hit_cursor'].every((key:string):boolean=>Object.keys(value).includes(key)))return false;
    const filter=new LocalMaterialFilter();filter.from=value.from;filter.to=value.to;filter.keyword=value.keyword;filter.speaker=value.speaker;filter.limit=value.limit;filter.cursor=value.hit_cursor;
    if(!this.localFilter(filter)||typeof value.scan_cursor!=='string'||value.scan_cursor.length>160||typeof value.hit_cursor!=='string'||value.hit_cursor.length>81)return false;
    if(value.scan_cursor&&(!/^lscan1:[a-f0-9]{64}:[a-f0-9]{64}:(0|[1-9][0-9]*)$/.test(value.scan_cursor)||!Number.isSafeInteger(Number(value.scan_cursor.slice(137)))))return false;
    return !value.hit_cursor||!!value.scan_cursor;
  }
  private summarySelection(action:string,value:SavedSummaryFilter|DebugSummaryRead|undefined):boolean{
    if(!value||typeof value.day!=='string'||!/^(19[7-9][0-9]|[2-9][0-9]{3})-[0-9]{2}-[0-9]{2}$/.test(value.day))return false;
    const parts=value.day.split('-'),year=Number(parts[0]),month=Number(parts[1]),day=Number(parts[2]),date=new Date(year,month-1,day);
    if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day||date.getHours()!==0||date.getMinutes()!==0||date.getSeconds()!==0||date.getMilliseconds()!==0)return false;
    const keys=Object.keys(value);
    if(action==='list-summaries'){
      const filter=value as SavedSummaryFilter;
      return keys.length===3&&['day','limit','cursor'].every((key:string):boolean=>keys.includes(key))&&Number.isSafeInteger(filter.limit)&&filter.limit>=1&&filter.limit<=10&&
        typeof filter.cursor==='string'&&(!filter.cursor||filter.cursor.length<=81&&/^[a-f0-9]{64}:(0|[1-9][0-9]*)$/.test(filter.cursor)&&Number.isSafeInteger(Number(filter.cursor.split(':')[1])));
    }
    if(action!=='read-summary')return false;
    const read=value as DebugSummaryRead;
    return keys.length===5&&['day','summary_id','content_sha256','offset','max_chars'].every((key:string):boolean=>keys.includes(key))&&
      typeof read.summary_id==='string'&&(read.summary_id==='saved-'+read.day+'-cache'||new RegExp('^saved-'+read.day+'-[a-f0-9]{64}$').test(read.summary_id))&&
      typeof read.content_sha256==='string'&&/^[a-f0-9]{64}$/.test(read.content_sha256)&&Number.isSafeInteger(read.offset)&&read.offset>=0&&read.offset<=2097152&&
      Number.isSafeInteger(read.max_chars)&&read.max_chars>=2&&read.max_chars<=4000;
  }
  private noteSelection(action:string,value:DebugAnnotation|undefined):boolean{
    if(!value)return false;const keys=Object.keys(value),operation=value.operation_id;
    if(['save-summary-note','resume-summary-note','summary-note-status','read-summary-note-pending'].includes(action)){
      if(typeof operation!=='string'||!/^noteop-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-f0-9]{32}$/.test(operation)||
        !this.summarySelection('list-summaries',{day:operation.slice(7,17),limit:1,cursor:''}))return false;
      if(action==='summary-note-status')return keys.length===1&&keys[0]==='operation_id';
      if(action==='read-summary-note-pending')return keys.length===2&&keys.includes('operation_id')&&keys.includes('input_sha256')&&typeof value.input_sha256==='string'&&/^[a-f0-9]{64}$/.test(value.input_sha256);
      return keys.length===2&&keys.includes('operation_id')&&keys.includes('body_sha256')&&typeof value.body_sha256==='string'&&/^[a-f0-9]{64}$/.test(value.body_sha256);
    }
    if(action==='list-summary-notes'){
      if(keys.length!==3||!['day','limit','cursor'].every((key:string):boolean=>keys.includes(key)))return false;
      const filter=new SavedSummaryFilter();filter.day=value.day;filter.limit=value.limit;filter.cursor=value.cursor;
      return this.summarySelection('list-summaries',filter);
    }
    if(action!=='read-summary-note'||keys.length!==6||!['day','note_id','content_sha256','format','offset','max_chars'].every((key:string):boolean=>keys.includes(key))||
      !this.summarySelection('list-summaries',{day:value.day,limit:1,cursor:''}))return false;
    return typeof value.note_id==='string'&&new RegExp('^note-'+value.day+'-[a-f0-9]{32}$').test(value.note_id)&&typeof value.content_sha256==='string'&&/^[a-f0-9]{64}$/.test(value.content_sha256)&&
      ['md','json'].includes(value.format)&&Number.isSafeInteger(value.offset)&&value.offset>=0&&value.offset<=8388608&&Number.isSafeInteger(value.max_chars)&&value.max_chars>=2&&value.max_chars<=4000;
  }
  private cleanupNote(request:DebugCardRequest):void{
    if(request.schema!==7||!['save-summary-note','resume-summary-note'].includes(request.action)||!request.annotation||!this.ports.noteCleanup)return;
    // Only after a durable terminal receipt. Service independently rechecks it.
    try{this.ports.noteCleanup(request.id,request.annotation.body_sha256);}catch{}
  }
  private playbackSelection(action:string,value:PlaybackSelection|DebugPlaybackCommand|undefined):boolean{
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const keys=Object.keys(value);
    if(action==='playback-play'){try{validPlaybackSelection(value as PlaybackSelection);return true;}catch{return false;}}
    if(action==='playback-status')return keys.length===0;
    const control=value as DebugPlaybackCommand;
    if(!['playback-pause','playback-resume','playback-seek','playback-stop'].includes(action)||typeof control.session_id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(control.session_id))return false;
    if(action==='playback-seek')return keys.length===2&&keys.includes('session_id')&&keys.includes('position_ms')&&Number.isSafeInteger(control.position_ms)&&control.position_ms>=0&&control.position_ms<=86400000;
    return keys.length===1&&keys[0]==='session_id';
  }
  private recordingReference(value:LocalMaterialReference|undefined):boolean{
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const keys=Object.keys(value),base=['material_id','revision','text_revision','utterance_id','content_sha256'];
    if(keys.length!==5&&keys.length!==6||!base.every((key:string):boolean=>keys.includes(key))||keys.some((key:string):boolean=>!base.includes(key)&&key!=='source_range')||
      typeof value.material_id!=='string'||!/^mat-recording-[a-f0-9]{32}$/.test(value.material_id)||!Number.isSafeInteger(value.revision)||value.revision<1||
      !Number.isSafeInteger(value.text_revision)||value.text_revision<0||value.text_revision>value.revision||!this.localText(value.utterance_id,256)||
      typeof value.content_sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.content_sha256))return false;
    if(!keys.includes('source_range'))return true;
    const range=value.source_range;if(!range||!value.utterance_id)return false;
    return Object.keys(range).length===6&&['parent_utterance_id','parent_revision','start_ms','end_ms','text_start','text_end'].every((key:string):boolean=>Object.keys(range).includes(key))&&
      this.localText(range.parent_utterance_id,256)&&!!range.parent_utterance_id&&Number.isSafeInteger(range.parent_revision)&&range.parent_revision>0&&range.parent_revision<value.revision&&
      Number.isSafeInteger(range.start_ms)&&range.start_ms>=0&&Number.isSafeInteger(range.end_ms)&&range.end_ms>=range.start_ms&&
      Number.isSafeInteger(range.text_start)&&range.text_start>=0&&Number.isSafeInteger(range.text_end)&&range.text_end>range.text_start;
  }
  private recordingSelection(action:string,value:DebugRecordingSummary|undefined):boolean{
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const keys=Object.keys(value),prefix='recording-summary-';if(!action.startsWith(prefix))return false;const operation=action.slice(prefix.length);
    const expected=operation==='preview'?['reference']:operation==='start'?['job_id','reference','confirm_send']:operation==='status'?['job_id']:
      operation==='cancel'?['job_id','state_sha256']:operation==='resume'?['job_id','state_sha256','confirm_send']:operation==='list'?['material_id','limit','cursor']:
        operation==='read'?['job_id','state_sha256','format','offset','max_chars']:operation==='citation'?['job_id','state_sha256','piece_id']:[];
    if(!expected.length||keys.length!==expected.length||!expected.every((key:string):boolean=>keys.includes(key)))return false;
    if(operation==='preview'||operation==='start'){if(!this.recordingReference(value.reference))return false;}
    if(operation==='start'||operation==='resume'){if(value.confirm_send!==true)return false;}
    if(operation==='list')return typeof value.material_id==='string'&&/^mat-recording-[a-f0-9]{32}$/.test(value.material_id)&&Number.isSafeInteger(value.limit)&&value.limit>=1&&value.limit<=10&&
      typeof value.cursor==='string'&&(!value.cursor||value.cursor.length<=81&&/^[a-f0-9]{64}:(0|[1-9][0-9]*)$/.test(value.cursor)&&Number.isSafeInteger(Number(value.cursor.split(':')[1])));
    if(operation==='preview')return true;
    if(typeof value.job_id!=='string'||!/^rsum-[a-f0-9]{32}$/.test(value.job_id))return false;
    if(['cancel','resume','read','citation'].includes(operation)&&(typeof value.state_sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.state_sha256)))return false;
    if(operation==='read')return ['md','json'].includes(value.format)&&Number.isSafeInteger(value.offset)&&value.offset>=0&&value.offset<=8388608&&Number.isSafeInteger(value.max_chars)&&value.max_chars>=2&&value.max_chars<=4000;
    if(operation==='citation')return typeof value.piece_id==='string'&&/^piece-[0-9]{4}$/.test(value.piece_id)&&Number(value.piece_id.slice(6))>=1&&Number(value.piece_id.slice(6))<=128;
    return true;
  }
  private todoSelection(action:string,value:DebugTodo|undefined):boolean{
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const keys=Object.keys(value),expected=action==='todo-list'?['scope','limit','cursor']:action==='todo-delete'?['operation_id','reference','confirm']:
      action==='todo-delete-status'?['operation_id']:action==='todo-delete-cancel'?['operation_id','state_sha256']:
        action==='todo-delete-send'?['operation_id','state_sha256','confirm']:action==='todo-query'||action==='todo-query-status'?[]:undefined;
    if(expected===undefined||keys.length!==expected.length||!expected.every((key:string):boolean=>keys.includes(key)))return false;
    if(action==='todo-query'||action==='todo-query-status')return true;
    if(action==='todo-list')return ['active','deleted'].includes(value.scope)&&Number.isSafeInteger(value.limit)&&value.limit>=1&&value.limit<=10&&typeof value.cursor==='string'&&
      (value.cursor===''||/^tcur-[a-f0-9]{64}-(0|[1-9][0-9]{0,2})$/.test(value.cursor)&&Number(value.cursor.slice(70))<=200);
    if(typeof value.operation_id!=='string'||!/^tdel-[a-f0-9]{32}$/.test(value.operation_id))return false;
    if(action==='todo-delete'||action==='todo-delete-send'){if(value.confirm!==true)return false;}
    if(action==='todo-delete'){
      const ref=value.reference;if(!ref||Array.isArray(ref)||Object.keys(ref).length!==4||!['id','revision','peer','content_sha256'].every((key:string):boolean=>Object.keys(ref).includes(key)))return false;
      return Number.isSafeInteger(ref.id)&&ref.id>0&&Number.isSafeInteger(ref.revision)&&ref.revision>0&&typeof ref.peer==='string'&&(ref.peer===''||/^[a-f0-9]{12}$/.test(ref.peer))&&
        typeof ref.content_sha256==='string'&&/^[a-f0-9]{64}$/.test(ref.content_sha256);
    }
    if(action==='todo-delete-cancel'||action==='todo-delete-send')return typeof value.state_sha256==='string'&&/^[a-f0-9]{64}$/.test(value.state_sha256);
    return true;
  }
  private parse(raw:string):DebugCardRequest {
    if(raw.length>2048)throw new Error('DEBUG_COMMAND_INVALID');
    const r=JSON.parse(raw) as DebugCardRequest;
    const keys=['schema','id','action','created_at','expires_at','expected_uid'];
    if(r?.schema===2)keys.push('expected_voice_binding');
    if(r?.schema===3)keys.push('expected_reply_binding');
    if(r?.schema===4)keys.push('expected_recovery_binding','recovery_source');
    if(r?.schema===5)keys.push('local_query');
    if(r?.schema===6)keys.push('saved_summary');
    if(r?.schema===7)keys.push('annotation');
    if(r?.schema===8)keys.push('playback');
    if(r?.schema===9)keys.push('recording_summary');
    if(r?.schema===10)keys.push('todo');
    if(r?.schema===11)keys.push('local_scan');
    if(!r||Object.keys(r).length!==keys.length||!keys.every((k:string):boolean=>Object.keys(r).includes(k))||
      ![1,2,3,4,5,6,7,8,9,10,11].includes(r.schema)||typeof r.id!=='string'||!/^dbg-[a-f0-9]{32}$/.test(r.id)||
      typeof r.expected_uid!=='string'||r.expected_uid.length>128||
      typeof r.created_at!=='string'||typeof r.expires_at!=='string')throw new Error('DEBUG_COMMAND_INVALID');
    const from=Date.parse(r.created_at),until=Date.parse(r.expires_at),now=Date.now();
    if(!Number.isFinite(from)||!Number.isFinite(until)||until<=from||until-from>60000||from>now+5000)throw new Error('DEBUG_COMMAND_INVALID');
    if(r.schema===1){
      if(!['status','show-card','remove-card'].includes(r.action)||
        (r.action==='remove-card'?!/^p10-[a-z0-9-]{1,100}$/.test(r.expected_uid):!!r.expected_uid))throw new Error('DEBUG_COMMAND_INVALID');
    }else if(r.schema===2){
      if(!['task-status','voice-finish','voice-cancel','voice-recover'].includes(r.action)||!!r.expected_uid||
        typeof r.expected_voice_binding!=='string'||(r.action==='task-status'?!!r.expected_voice_binding:!/^[a-f0-9]{64}$/.test(r.expected_voice_binding)))throw new Error('DEBUG_COMMAND_INVALID');
    }else if(r.schema===3){
      if(r.action!=='review-card'||!!r.expected_uid||typeof r.expected_reply_binding!=='string'||
        !/^[a-f0-9]{64}$/.test(r.expected_reply_binding))throw new Error('DEBUG_COMMAND_INVALID');
    }else if(r.schema===5){
      if(r.action!=='search-local'||!!r.expected_uid||!this.localFilter(r.local_query))throw new Error('DEBUG_COMMAND_INVALID');
    }else if(r.schema===6){
      if(!!r.expected_uid||!this.summarySelection(r.action,r.saved_summary))throw new Error('DEBUG_COMMAND_INVALID');
    }else if(r.schema===7){
      if(!!r.expected_uid||!this.noteSelection(r.action,r.annotation))throw new Error('DEBUG_COMMAND_INVALID');
    }else if(r.schema===8){
      if(!!r.expected_uid||!this.playbackSelection(r.action,r.playback))throw new Error('DEBUG_COMMAND_INVALID');
    }else if(r.schema===9){
      if(!!r.expected_uid||!this.recordingSelection(r.action,r.recording_summary))throw new Error('DEBUG_COMMAND_INVALID');
    }else if(r.schema===11){
      if(r.action!=='scan-local'||!!r.expected_uid||!this.localScanFilter(r.local_scan))throw new Error('DEBUG_COMMAND_INVALID');
    }else if(r.schema===10){
      if(!!r.expected_uid||!this.todoSelection(r.action,r.todo))throw new Error('DEBUG_COMMAND_INVALID');
    }else if(!['recovery-status','recovery-restore'].includes(r.action)||!!r.expected_uid||typeof r.expected_recovery_binding!=='string'||
      typeof r.recovery_source!=='string'||(r.action==='recovery-status'?!!r.expected_recovery_binding||!!r.recovery_source:
        !/^[a-f0-9]{64}$/.test(r.expected_recovery_binding)||!['main','partial','resume'].includes(r.recovery_source)))throw new Error('DEBUG_COMMAND_INVALID');
    return r;
  }
  async poll():Promise<void>{
    if(!this.enabled||this.busy||!this.ports.foreground())return;
    this.busy=true;const generation=this.generation;
    try{
      const raw=this.ports.command();if(!raw)return;
      const request=this.parse(raw),prior=this.ports.result(request.id);
      if(prior){
        const saved=JSON.parse(prior) as DebugCardResult;
        if(saved.schema!==1||saved.id!==request.id||saved.request_json!==JSON.stringify(request)||!['running','complete','error'].includes(saved.state))throw new Error('DEBUG_JOURNAL_INVALID');
        // Also after a cold restart: running means an ambiguous effect, never replay.
        if(saved.state!=='running')this.cleanupNote(request);this.note=saved.state;return;
      }
      const result=new DebugCardResult();result.id=request.id;result.request_json=JSON.stringify(request);result.started_at=new Date().toISOString();
      if(Date.now()>=Date.parse(request.expires_at)){result.state='error';result.error='DEBUG_COMMAND_EXPIRED';result.finished_at=result.started_at;this.ports.save(request.id,JSON.stringify(result));this.cleanupNote(request);return;}
      // Persist the claim before any device mutation. Failure must not send.
      this.ports.save(request.id,JSON.stringify(result));
      try{
        if(!this.enabled||generation!==this.generation||!this.ports.foreground())throw new Error('DEBUG_NOT_FOREGROUND');
        if(request.action==='show-card')await this.ports.show();
        else if(request.action==='remove-card')await this.ports.remove(request.expected_uid);
        else if(request.schema===2&&request.action!=='task-status')await this.ports.voice(request.action,request.expected_voice_binding);
        else if(request.schema===3)await this.ports.reviewCard(request.expected_reply_binding);
        else if(request.schema===4&&request.action==='recovery-restore')this.ports.restoreDraft(request.recovery_source,request.expected_recovery_binding);
        else if(request.schema===5){if(!this.ports.localQuery||!request.local_query)throw new Error('DEBUG_LOCAL_QUERY_UNAVAILABLE');result.local_query=this.ports.localQuery(request.local_query);}
        else if(request.schema===11){if(!this.ports.localScan||!request.local_scan)throw new Error('LOCAL_SCAN_UNAVAILABLE');result.local_scan=this.ports.localScan(request.local_scan);}
        else if(request.schema===6){
          if(request.action==='list-summaries'){
            if(!this.ports.summaryList||!request.saved_summary)throw new Error('DEBUG_SUMMARY_UNAVAILABLE');
            result.saved_summaries=this.ports.summaryList(request.saved_summary as SavedSummaryFilter);
          }else{
            if(!this.ports.summaryRead||!request.saved_summary)throw new Error('DEBUG_SUMMARY_UNAVAILABLE');
            const selection=request.saved_summary as DebugSummaryRead;
            const reference:SavedSummaryRef={day:selection.day,summary_id:selection.summary_id,content_sha256:selection.content_sha256};
            result.saved_summary=this.ports.summaryRead(reference,selection.offset,selection.max_chars);
          }
        }
        else if(request.schema===7){
          const selection=request.annotation;if(!selection)throw new Error('NOTE_INVALID');
          if(['save-summary-note','resume-summary-note'].includes(request.action)){
            if(!this.ports.noteInput||!this.ports.noteSave)throw new Error('NOTE_BLOCKED');
            const input=this.ports.noteInput(request.id,selection.body_sha256,selection.operation_id);
            result.summary_note_receipt=this.ports.noteSave(input,request.action==='resume-summary-note');
          }else if(request.action==='summary-note-status'){
            if(!this.ports.noteStatus)throw new Error('NOTE_BLOCKED');result.summary_note_receipt=this.ports.noteStatus(selection.operation_id);
          }else if(request.action==='read-summary-note-pending'){
            if(!this.ports.notePending)throw new Error('NOTE_BLOCKED');result.summary_note_pending=this.ports.notePending(selection.operation_id,selection.input_sha256);
          }else if(request.action==='list-summary-notes'){
            if(!this.ports.noteList)throw new Error('NOTE_BLOCKED');result.summary_notes=this.ports.noteList(selection as JournalNoteFilter);
          }else{
            if(!this.ports.noteRead)throw new Error('NOTE_BLOCKED');const reference:JournalNoteRef={day:selection.day,note_id:selection.note_id,content_sha256:selection.content_sha256};
            result.summary_note_chunk=this.ports.noteRead(reference,selection.format,selection.offset,selection.max_chars);
          }
        }
        else if(request.schema===8){
          const selection=request.playback;if(!selection)throw new Error('PLAYBACK_INVALID');
          if(request.action==='playback-status'){
            if(!this.ports.playbackStatus)throw new Error('PLAYBACK_UNAVAILABLE');result.playback_snapshot=this.ports.playbackStatus();
          }else if(request.action==='playback-play'){
            if(!this.ports.playbackPlay)throw new Error('PLAYBACK_UNAVAILABLE');result.playback_snapshot=await this.ports.playbackPlay(validPlaybackSelection(selection as PlaybackSelection));
          }else{
            const operation=selection as DebugPlaybackCommand;
            if(request.action==='playback-pause'){if(!this.ports.playbackPause)throw new Error('PLAYBACK_UNAVAILABLE');result.playback_snapshot=await this.ports.playbackPause(operation.session_id);}
            else if(request.action==='playback-resume'){if(!this.ports.playbackResume)throw new Error('PLAYBACK_UNAVAILABLE');result.playback_snapshot=await this.ports.playbackResume(operation.session_id);}
            else if(request.action==='playback-seek'){if(!this.ports.playbackSeek)throw new Error('PLAYBACK_UNAVAILABLE');result.playback_snapshot=await this.ports.playbackSeek(operation.session_id,operation.position_ms);}
            else{if(!this.ports.playbackStop)throw new Error('PLAYBACK_UNAVAILABLE');result.playback_snapshot=await this.ports.playbackStop(operation.session_id);}
          }
        }
        else if(request.schema===9){
          const selection=request.recording_summary;if(!selection)throw new Error('RECORDING_SUMMARY_INVALID');
          if(request.action==='recording-summary-preview'){if(!this.ports.recordingSummaryPreview||!selection.reference)throw new Error('RECORDING_SUMMARY_BLOCKED');result.recording_summary_preview=this.ports.recordingSummaryPreview(selection.reference);}
          else if(request.action==='recording-summary-start'){if(!this.ports.recordingSummaryStart||!selection.reference)throw new Error('RECORDING_SUMMARY_BLOCKED');result.recording_summary_view=await this.ports.recordingSummaryStart(selection.job_id,selection.reference);}
          else if(request.action==='recording-summary-status'){if(!this.ports.recordingSummaryStatus)throw new Error('RECORDING_SUMMARY_BLOCKED');result.recording_summary_view=this.ports.recordingSummaryStatus(selection.job_id);}
          else if(request.action==='recording-summary-cancel'){if(!this.ports.recordingSummaryCancel)throw new Error('RECORDING_SUMMARY_BLOCKED');result.recording_summary_view=this.ports.recordingSummaryCancel(selection.job_id,selection.state_sha256);}
          else if(request.action==='recording-summary-resume'){if(!this.ports.recordingSummaryResume)throw new Error('RECORDING_SUMMARY_BLOCKED');result.recording_summary_view=await this.ports.recordingSummaryResume(selection.job_id,selection.state_sha256);}
          else if(request.action==='recording-summary-list'){if(!this.ports.recordingSummaryList)throw new Error('RECORDING_SUMMARY_BLOCKED');result.recording_summary_list=this.ports.recordingSummaryList(selection.material_id,selection.limit,selection.cursor);}
          else if(request.action==='recording-summary-read'){if(!this.ports.recordingSummaryRead)throw new Error('RECORDING_SUMMARY_BLOCKED');result.recording_summary_chunk=this.ports.recordingSummaryRead(selection.job_id,selection.state_sha256,selection.format,selection.offset,selection.max_chars);}
          else{if(!this.ports.recordingSummaryCitation)throw new Error('RECORDING_SUMMARY_BLOCKED');result.recording_summary_piece=this.ports.recordingSummaryCitation(selection.job_id,selection.piece_id,selection.state_sha256);}
        }
        else if(request.schema===10){
          const selection=request.todo;if(!selection)throw new Error('TODO_INVALID');
          if(request.action==='todo-list'){if(!this.ports.todoPage)throw new Error('TODO_BLOCKED');result.todo_page=this.ports.todoPage(selection.scope,selection.limit,selection.cursor);}
          else if(request.action==='todo-delete'){if(!this.ports.todoDelete||!selection.reference)throw new Error('TODO_BLOCKED');result.todo_deletion=await this.ports.todoDelete(selection.operation_id,selection.reference);}
          else if(request.action==='todo-delete-status'){if(!this.ports.todoDeleteStatus)throw new Error('TODO_BLOCKED');result.todo_deletion=this.ports.todoDeleteStatus(selection.operation_id);}
          else if(request.action==='todo-delete-cancel'){if(!this.ports.todoDeleteCancel)throw new Error('TODO_BLOCKED');result.todo_deletion=await this.ports.todoDeleteCancel(selection.operation_id,selection.state_sha256);}
          else if(request.action==='todo-delete-send'){if(!this.ports.todoDeleteSend)throw new Error('TODO_BLOCKED');result.todo_deletion=await this.ports.todoDeleteSend(selection.operation_id,selection.state_sha256);}
          else if(request.action==='todo-query'){if(!this.ports.todoQuery)throw new Error('TODO_BLOCKED');result.todo_query=await this.ports.todoQuery();}
          else{if(!this.ports.todoQueryStatus)throw new Error('TODO_BLOCKED');result.todo_query=this.ports.todoQueryStatus();}
        }
        result.snapshot=this.ports.status();if(request.schema>=2&&request.schema<=4)result.task_snapshot=this.ports.taskStatus();
        if(request.schema===4)result.recovery_snapshot=this.ports.recoveryStatus();
        result.control_call_completed=true;result.state='complete';
      }catch(error){result.state='error';const code=(error as Error).message;
        result.error=request.schema===8&&['PLAYBACK_INVALID','PLAYBACK_UNAVAILABLE','PLAYBACK_SOURCE_CHANGED','PLAYBACK_STALE_SESSION','PLAYBACK_BUSY','PLAYBACK_NOT_FOREGROUND','PLAYBACK_PLAYER_FAILED','PLAYBACK_CLEANUP_PENDING','PLAYBACK_IN_USE','PLAYBACK_SOURCE_UNAVAILABLE','PLAYBACK_INCOMPLETE','PLAYBACK_DELETED','PLAYBACK_ANCHOR_STALE','PLAYBACK_TIME_UNKNOWN'].includes(code)?code:request.schema===7&&['NOTE_INVALID','NOTE_STALE','NOTE_CONFLICT','NOTE_BLOCKED','NOTE_IO'].includes(code)?code:request.schema===6&&['SAVED_SUMMARY_STALE','SAVED_SUMMARY_INVALID'].includes(code)?code:request.schema===5&&code==='LOCAL_QUERY_STALE'?'LOCAL_QUERY_STALE':'DEBUG_OPERATION_FAILED';result.snapshot=this.ports.status();if(request.schema>=2&&request.schema<=4)result.task_snapshot=this.ports.taskStatus();
        if(request.schema===9&&['RECORDING_SUMMARY_INVALID','RECORDING_SUMMARY_LIMIT','RECORDING_SUMMARY_STALE','RECORDING_SUMMARY_BLOCKED','RECORDING_SUMMARY_BUSY','RECORDING_SUMMARY_NOT_FOREGROUND','RECORDING_SUMMARY_CONFIG_CHANGED','RECORDING_SUMMARY_WRITE_FAILED','RECORDING_SUMMARY_NOT_READY','RECORDING_SUMMARY_RESPONSE_INVALID'].includes(code))result.error=code;
        if(request.schema===10)result.error=['TODO_INVALID','TODO_STALE','TODO_BLOCKED','TODO_BUSY','TODO_WRONG_PEER','TODO_NOT_FOREGROUND','TODO_ALREADY_SENT','TODO_LIMIT','TODO_NOT_FOUND'].includes(code)?code:'TODO_FAILED';
        if(request.schema===11)result.error=['LOCAL_QUERY_STALE','LOCAL_QUERY_INVALID','LOCAL_SCAN_UNAVAILABLE'].includes(code)?code:'DEBUG_OPERATION_FAILED';
        if(request.schema===8&&this.ports.playbackStatus){try{result.playback_snapshot=this.ports.playbackStatus();}catch{}}
        if(request.schema===4){try{result.recovery_snapshot=this.ports.recoveryStatus();}catch{result.recovery_snapshot=new TaskDraftRecoveryState();}}}
      if(!this.enabled||generation!==this.generation)return;
      result.finished_at=new Date().toISOString();this.ports.save(request.id,JSON.stringify(result));this.cleanupNote(request);this.note=result.state;
    }catch(error){this.note=(error as Error).message==='DEBUG_JOURNAL_INVALID'?'DEBUG_JOURNAL_INVALID':'DEBUG_COMMAND_OR_STORAGE_FAILED';}
    finally{this.busy=false;}
  }
}
