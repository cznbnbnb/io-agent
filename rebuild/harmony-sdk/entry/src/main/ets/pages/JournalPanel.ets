// 智记：全天智记 + 本机录音的统一时间线，按日历选日期查看。
// 两个功能各自的"开始/停止"入口分开（录音在「录音」页，全天智记在这里），
// 但历史记录合在一起：同一天的智记分段与录音按时间排在同一列表里，各自带类型标注，
// 每日汇总与 AI 总结会同时覆盖两者。
import { common } from '@kit.AbilityKit';
import { fileIo as fs,picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { LifelogItem, LifelogSession, LifelogUtteranceRow, LifelogDayText } from '../LifelogSession';
import { RecordingItem } from '../RecordingSession';
import { recordings, lifelog, lifelogASR, voices, materials, localPlayback, savedJournalSummaries, journalSummaryNotes, enqueueLocalTranscribe, transcribeLifelogManual, cancelLifelogManualPublication, transcribeRecordingCloud, cancelRecordingCloudTranscription, localQueueSize, localCurrentDirectory, localQueuedDirectories, localMaterialRevision, localMaterialExportPath } from '../RecordingService';
import { MaterialRevision,MaterialUtterance,MaterialQueryCatalog } from '../MaterialStore';
import { PlaybackSelection } from '../LocalAudioSource';
import { PlaybackSnapshot } from '../PlaybackController';
import { LocalMaterialQuery,LocalMaterialScanFilter,LocalMaterialScanPage,LocalMaterialReference,LocalMaterialHit } from '../MaterialLocalQuery';
import { SavedSummaryFilter,SavedSummaryPage,SavedSummaryRef,SavedSummaryEntry,SavedSummaryDocument } from '../SavedJournalSummary';
import { JournalNoteInput,JournalNoteRef,JournalNoteReceipt,JournalNoteFilter,JournalNotePage,JournalNoteDocument } from '../JournalSummaryNotes';
import { MaterialSpeakerEditor } from './MaterialSpeakerEditor';
import { materialSyncService } from '../MaterialSyncService';
import { SecureServiceConfig, RemoteServices, ServiceConfig } from '../RemoteServices';
import { LifelogSpeaker } from '../LifelogASR';
import { VoiceRegistry, VoiceRole } from '../VoiceRegistry';
import { UploadService, UploadTarget } from '../UploadService';
import { JournalSources, buildJournalDay, dayStamp, assertJournalSnapshotCurrent, bindJournalSummary, writeJournalSnapshot } from '../JournalExport';
import { MaterialSyncPanel } from './MaterialSyncPanel';
import { probeSession } from '../ProbeSession';

@Extend(Button)
function chipBtn() {
  .backgroundColor($r('app.color.input_bg'))
  .fontColor($r('app.color.text_primary'))
}


// 时间线里的一条：来自全天智记分段或本机录音。
class JournalEntry {
  kind:string='lifelog';           // lifelog | recording
  key:string='';
  created:number=0;
  ended:number=0;
  bytes:number=0;
  hasText:boolean=false;
  syncLabel:string='文字仅本机';
  lifelogItem:LifelogItem|undefined=undefined;
  recordingItem:RecordingItem|undefined=undefined;
}

// This one editor survives component replacement in the current process. It is
// deliberately not a promise that typing before Save survives process death.
class JournalNoteEditorProcess {
  parent:SavedSummaryRef|undefined=undefined;source:string='';previous:JournalNoteRef|undefined=undefined;
  input:JournalNoteInput|undefined=undefined;attempted:boolean=false;
}
let journalNoteEditorProcess:JournalNoteEditorProcess=new JournalNoteEditorProcess();

@Component
export struct JournalPanel {
  @Prop connected:boolean=false;
  @State note:string='';
  @State llNote:string='';@State llActive:boolean=false;@State llDay:boolean=false;@State llBytes:number=0;@State llEmpty:number=0;
  @State llPhase:string='idle';@State recActive:boolean=false;@State recStopping:boolean=false;
  @State llCleanup:boolean=false;@State llCanConfirmCleanup:boolean=false;@State llPendingWrites:boolean=false;@State recCleanup:boolean=false;
  @State entries:JournalEntry[]=[];
  @State queryKeyword:string='';@State querySpeaker:string='';@State queryNote:string='';
  @State queryPage:LocalMaterialScanPage|undefined=undefined;
  private querySignature:string='';
  private querySourcesSignature:string='';private queryOpenedKey:string='';
  private queryCheckedRaw:Map<string,string>=new Map<string,string>();
  @State savedSummaryPage:SavedSummaryPage|undefined=undefined;
  @State savedSummaryDocument:SavedSummaryDocument|undefined=undefined;
  @State savedSummaryNote:string='';
  private savedSummaryDay:string='';private savedSummaryGeneration:number=0;
  @State savedNotePage:JournalNotePage|undefined=undefined;@State savedNoteDocument:JournalNoteDocument|undefined=undefined;
  @State savedNoteReceipt:JournalNoteReceipt|undefined=undefined;@State savedNoteNote:string='';
  private savedNoteDay:string='';private savedNoteGeneration:number=0;
  @State noteEditorText:string='';@State noteEditorDay:string='';@State noteEditorOperation:string='';
  @State noteEditorReady:boolean=false;@State noteEditorLocked:boolean=false;@State noteEditorNote:string='';
  @State calBase:number=0;         // 当前显示的月份（当月 1 号零点）
  @State selected:number=0;        // 选中的日期（零点）
  @State busy:boolean=false;
  @State transcribing:boolean=false;@State progress:number=0;
  @State text:string='';
  @State textKind:string='';@State textName:string='';@State textNeedsFull:boolean=false;@State fullText:boolean=false;@State textRevision:number=0;
  @State schOn:boolean=false;@State schStart:string='09:00';@State schEnd:string='18:00';@State schAuto:boolean=true;
  @State upURL:string='';@State upToken:string='';@State upAuto:boolean=false;@State upTime:string='23:30';@State uploading:boolean=false;
  @State wide:boolean=false;
  @State queue:number=0;private lastQueueSync:number=0;@State runningDir:string='';@State queuedDirs:string[]=[];
  @State roles:VoiceRole[]=[];@State pendingVoices:LifelogSpeaker[]=[];
  @State editIndex:number=-1;@State editId:string='';@State editName:string='';@State editBio:string='';
  private visible:boolean=false;
  private actionEpoch:number=0;
  @State playback:PlaybackSnapshot=new PlaybackSnapshot();
  private playbackUnsubscribe:()=>void=():void=>{};
  private vault:SecureServiceConfig=new SecureServiceConfig();
  private remote:RemoteServices=new RemoteServices();
  private uploader:UploadService=new UploadService();

  aboutToAppear():void{
    this.visible=true;++this.actionEpoch;this.busy=false;
    this.playbackUnsubscribe();this.playback=localPlayback.snapshot();const epoch=this.actionEpoch;
    this.playbackUnsubscribe=localPlayback.subscribe((value:PlaybackSnapshot):void=>{if(this.visible&&epoch===this.actionEpoch)this.playback=value;});
    this.restoreNoteEditor();
    const today=LifelogSession.dayStart(0);
    if(!this.calBase){const d=new Date(today);this.calBase=new Date(d.getFullYear(),d.getMonth(),1).getTime();}
    if(!this.selected)this.selected=today;
    recordings.changed=():void=>this.refresh();
    lifelog.changed=():void=>this.refresh();
    lifelogASR.changed=():void=>{
      if(!this.visible)return;
      this.transcribing=lifelogASR.busy;this.progress=lifelogASR.progress;
      this.runningDir=localCurrentDirectory();
      const now=Date.now();
      if(now-this.lastQueueSync>800||!lifelogASR.busy){this.lastQueueSync=now;this.queue=localQueueSize();this.queuedDirs=localQueuedDirectories();}
    };
    recordings.refresh();lifelog.refresh();this.syncSchedule();this.refresh();
    this.vault.load().then((config:ServiceConfig):void=>{
      this.upURL=config.uploadURL;this.upToken=config.uploadToken;this.upAuto=config.uploadAuto;this.upTime=config.uploadTime;
    }).catch(():void=>{});
    try{
      const context=this.getUIContext().getHostContext() as common.UIAbilityContext;
      lifelogASR.initialize(context);
      voices.initialize(context.filesDir);
      lifelogASR.registry=voices;
      this.roles=voices.ordered();
    }catch(_){}
  }
  aboutToDisappear():void{this.visible=false;++this.actionEpoch;this.busy=false;
    this.playbackUnsubscribe();void localPlayback.suspend('page_leave').catch(():void=>{});
    this.savedNotePage=undefined;this.savedNoteDocument=undefined;this.savedNoteReceipt=undefined;this.savedNoteDay='';this.savedNoteNote='';this.savedNoteGeneration=(this.savedNoteGeneration||0)+1;
    this.savedSummaryPage=undefined;this.savedSummaryDocument=undefined;this.savedSummaryDay='';this.savedSummaryNote='';this.savedSummaryGeneration=(this.savedSummaryGeneration||0)+1;
    if(this.queryOpenedKey&&this.queryOpenedKey===this.textKind+'-'+this.textName){this.text='';this.textKind='';this.textName='';this.textRevision=0;this.textNeedsFull=false;this.fullText=false;}
    this.queryOpenedKey='';this.queryCheckedRaw=new Map<string,string>();this.queryPage=undefined;this.querySignature='';this.queryNote='';cancelRecordingCloudTranscription();cancelLifelogManualPublication();recordings.changed=():void=>{};lifelog.changed=():void=>{};lifelogASR.changed=():void=>{};}

  private syncSchedule():void{this.schOn=lifelog.scheduleEnabled;this.schStart=lifelog.scheduleStart;this.schEnd=lifelog.scheduleEnd;this.schAuto=lifelog.autoTranscribe;}
  private sizeText(bytes:number):string{return bytes>=1048576?`${(bytes/1048576).toFixed(1)}M`:`${Math.round(bytes/1024)}K`;}
  private clock(ms:number):string{const d=new Date(ms);const p=(n:number):string=>n<10?'0'+n:''+n;return `${p(d.getHours())}:${p(d.getMinutes())}`;}
  private stamp(ms:number):string{const d=new Date(ms);const p=(n:number):string=>n<10?'0'+n:''+n;return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;}
  private durText(seconds:number,bytes:number):string{
    if(!seconds)return this.sizeText(bytes);
    return seconds>=60?`${Math.floor(seconds/60)}分${Math.round(seconds%60)}秒 · ${this.sizeText(bytes)}`:`${Math.round(seconds)}秒 · ${this.sizeText(bytes)}`;
  }

  // 收集全部条目（全天智记 + 录音），按时间倒序。
  private refresh():void{
    if(!this.visible)return;
    this.queue=localQueueSize();this.runningDir=localCurrentDirectory();this.queuedDirs=localQueuedDirectories();
    this.transcribing=lifelogASR.busy;this.progress=lifelogASR.progress;
    this.llNote=lifelog.note;this.llActive=lifelog.active;this.llDay=lifelog.dayEnabled;this.llBytes=lifelog.bytes;this.llEmpty=lifelog.emptySegments;
    this.llPhase=lifelog.capturePhase;this.recActive=recordings.active;this.recStopping=recordings.stopping;
    this.llCleanup=lifelog.cleanupRequired;this.llCanConfirmCleanup=lifelog.canConfirmExited;this.llPendingWrites=lifelog.pendingWrites;this.recCleanup=recordings.cleanupRequired;
    const rows:JournalEntry[]=[];
    for(const item of lifelog.items){
      const row=new JournalEntry();row.kind='lifelog';row.key='lifelog-'+item.name;row.created=item.created;row.ended=item.ended;
      row.bytes=item.bytes;row.hasText=item.hasText;row.lifelogItem=item;rows.push(row);
    }
    for(const item of recordings.items){
      const row=new JournalEntry();row.kind='recording';row.key='recording-'+item.name;row.created=item.created;
      row.bytes=item.bytes;row.hasText=!!item.textFile;row.recordingItem=item;rows.push(row);
    }
    const sourceMarks:string[]=[],checkedRaw:Map<string,string>=new Map<string,string>();let sourceReadFailed:boolean=false,queryContentChanged:boolean=false;
    for(const row of rows){
      const name=row.lifelogItem?.name||row.recordingItem?.name||'';let id:string='';
      try{
        id=materials.idFor(row.kind,name);
        const material=materials.read(id);if(material?.operation==='upsert'&&material.text.trim())row.hasText=true;
        // Legal canonical changes publish a new revision. Capture bytes/phase
        // and upload receipts do not change this catalog signature.
        sourceMarks.push(JSON.stringify([row.key,id,material?[material.material_id,material.revision,material.text_revision,material.operation]:null]));
        const hit=this.queryPage?.hits.find((value:LocalMaterialHit):boolean=>value.reference.material_id===id);
        if(material&&hit){
          // At most this page's ten sources are serialized, using the read
          // already needed above. Reuse exact checked raw bytes between state
          // notifications; unchanged text never repeats native SHA work.
          const raw=JSON.stringify(material),expected=hit.reference.content_sha256,check=expected+':'+raw;
          if(this.queryCheckedRaw?.get(id)!==check){
            const bytes=new util.TextEncoder().encodeInto(raw),md=cryptoFramework.createMd('SHA256');
            try{md.updateSync({data:bytes});const digest=md.digestSync().data;
              try{if(Array.from(digest).map((n:number):string=>n.toString(16).padStart(2,'0')).join('')!==expected)queryContentChanged=true;}finally{digest.fill(0);}
            }finally{bytes.fill(0);}
          }
          checkedRaw.set(id,check);
        }
      }catch{sourceReadFailed=true;sourceMarks.push(JSON.stringify([row.key,id,'unreadable']));}
      // A sync-status observation failure must not masquerade as an edit to
      // the canonical source or dismiss an otherwise readable local result.
      try{
        const view=materialSyncService.view(id);
        if(view.state==='server_stored')row.syncLabel=`文字已存 v${view.revision}`;
        else if(['blocked','expired'].includes(view.state))row.syncLabel='文字同步需处理';
        else if(view.state!=='local'||view.storedRevision>0)row.syncLabel=`文字待同步 v${view.revision}`;
      }catch{}
    }
    sourceMarks.sort();const signature=JSON.stringify(sourceMarks);
    if(sourceReadFailed||queryContentChanged||!this.querySourcesSignature||signature!==this.querySourcesSignature){
      if(this.noteEditorReady)this.noteEditorNote='资料来源已变化或暂不可读取，过程输入保留；保存时须重新核对原绑定';
      if(this.savedNotePage||this.savedNoteDocument){
        this.savedNotePage=undefined;this.savedNoteDocument=undefined;this.savedNoteReceipt=undefined;this.savedNoteDay='';this.savedNoteGeneration=(this.savedNoteGeneration||0)+1;
        this.savedNoteNote='资料来源已变化或暂不可读取，请重新查看附注；未提交输入仍保留';
      }
      if(this.savedSummaryPage||this.savedSummaryDocument){
        this.savedSummaryPage=undefined;this.savedSummaryDocument=undefined;this.savedSummaryDay='';this.savedSummaryGeneration=(this.savedSummaryGeneration||0)+1;
        this.savedSummaryNote=sourceReadFailed?'资料暂不可读取，请重新查看已保存总结':'资料内容已变化，请重新查看；旧总结可能需要重新生成';
      }
      if(this.queryPage||this.queryOpenedKey){
        if(this.queryOpenedKey&&this.queryOpenedKey===this.textKind+'-'+this.textName){this.text='';this.textKind='';this.textName='';this.textRevision=0;this.textNeedsFull=false;this.fullText=false;}
        this.queryOpenedKey='';this.queryPage=undefined;this.querySignature='';
        this.queryNote=sourceReadFailed?'资料暂不可读取，请刷新核对后重新查询':'资料内容已变化，请重新查询';checkedRaw.clear();
      }
    }
    this.querySourcesSignature=sourceReadFailed?'':signature;this.queryCheckedRaw=checkedRaw;
    rows.sort((a,b)=>b.created-a.created);
    this.entries=rows;
    this.recount();
    this.collectPendingVoices(this.selected);
  }

  // ---- 日历 ----
  private atDay(ms:number):number{const d=new Date(ms);d.setHours(0,0,0,0);return d.getTime();}
  private dayKeys:Map<string,number>=new Map<string,number>();
  private recount():void{
    const map=new Map<string,number>();
    for(const row of this.entries){const key=`${this.atDay(row.created)}`;map.set(key,(map.get(key)??0)+1);}
    this.dayKeys=map;
  }
  private countOn(dayStart:number):number{return this.dayKeys.get(`${dayStart}`)??0;}
  private monthLabel():string{const d=new Date(this.calBase);return `${d.getFullYear()} 年 ${d.getMonth()+1} 月`;}
  private shiftMonth(delta:number):void{const d=new Date(this.calBase);this.calBase=new Date(d.getFullYear(),d.getMonth()+delta,1).getTime();}
  private cells():number[]{
    const first=new Date(this.calBase);
    const offset=first.getDay();
    const days=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
    const out:number[]=[];
    for(let i=0;i<42;i++){
      const day=i-offset+1;
      out.push(day<1||day>days?0:new Date(first.getFullYear(),first.getMonth(),day).getTime());
    }
    return out;
  }

  // 界面按时间倒序：越新的越靠上（导出 Markdown 仍按时间正序，读起来才是流水账）。
  private dayEntries(dayStart:number):JournalEntry[]{
    const end=dayStart+86400000;
    return this.entries.filter((row:JournalEntry):boolean=>row.created>=dayStart&&row.created<end)
      .sort((a:JournalEntry,b:JournalEntry):number=>b.created-a.created);
  }
  private dayLabel(dayStart:number):string{
    const today=LifelogSession.dayStart(0);
    const diff=Math.round((today-dayStart)/86400000);
    const d=new Date(dayStart);
    const base=`${d.getMonth()+1}月${d.getDate()}日`;
    return diff===0?`今天 · ${base}`:diff===1?`昨天 · ${base}`:base;
  }

  private localQuery():LocalMaterialQuery{return new LocalMaterialQuery({ids:():string[]=>materials.ids(),read:(id:string):MaterialRevision|undefined=>materials.read(id),catalog:():MaterialQueryCatalog=>materials.queryCatalog()});}
  private invalidateLocalSearch(note:string=''):void{
    if(this.queryOpenedKey&&this.queryOpenedKey===this.textKind+'-'+this.textName){this.text='';this.textKind='';this.textName='';this.textRevision=0;this.textNeedsFull=false;this.fullText=false;}
    this.queryOpenedKey='';this.queryCheckedRaw=new Map<string,string>();this.queryPage=undefined;this.querySignature='';this.queryNote=note;
  }
  private changeQueryKeyword(value:string):void{if(this.queryKeyword===value)return;this.queryKeyword=value;this.invalidateLocalSearch();}
  private changeQuerySpeaker(value:string):void{if(this.querySpeaker===value)return;this.querySpeaker=value;this.invalidateLocalSearch();}
  private selectDay(day:number):void{if(day<=0||day===this.selected)return;void localPlayback.suspend('day_change').catch(():void=>{});this.selected=day;this.invalidateLocalSearch();
    this.savedNotePage=undefined;this.savedNoteDocument=undefined;this.savedNoteReceipt=undefined;this.savedNoteDay='';this.savedNoteNote='';this.savedNoteGeneration=(this.savedNoteGeneration||0)+1;
    this.savedSummaryPage=undefined;this.savedSummaryDocument=undefined;this.savedSummaryDay='';this.savedSummaryNote='';this.savedSummaryGeneration=(this.savedSummaryGeneration||0)+1;}
  private clearLocalSearch():void{this.queryKeyword='';this.querySpeaker='';this.invalidateLocalSearch();}
  private refreshEntries():void{
    this.invalidateLocalSearch('已请求刷新资料，请重新查询');
    this.savedNotePage=undefined;this.savedNoteDocument=undefined;this.savedNoteReceipt=undefined;this.savedNoteDay='';this.savedNoteNote='请重新查看附注；未提交输入仍保留';this.savedNoteGeneration=(this.savedNoteGeneration||0)+1;
    this.savedSummaryPage=undefined;this.savedSummaryDocument=undefined;this.savedSummaryDay='';this.savedSummaryNote='请重新查看已保存总结';this.savedSummaryGeneration=(this.savedSummaryGeneration||0)+1;
    try{recordings.refresh();lifelog.refresh();this.refresh();}catch{this.note='目录暂不可读取';}
  }
  private searchLocal(next:boolean=false,continueScan:boolean=false):void{
    if(!this.visible||this.busy)return;
    const signature=JSON.stringify([this.selected,this.queryKeyword,this.querySpeaker]);
    if((next||continueScan)&&(signature!==this.querySignature||!this.queryPage)){this.invalidateLocalSearch('查询条件已变化，请重新查询');return;}
    if(next&&continueScan){this.invalidateLocalSearch('查询操作已变化，请重新查询');return;}
    if(next&&!this.queryPage?.has_more)return;
    if(continueScan&&!this.queryPage?.scan_has_more)return;
    const filter=new LocalMaterialScanFilter();filter.from=this.selected;filter.to=this.selected+86400000;
    filter.keyword=this.queryKeyword;filter.speaker=this.querySpeaker;
    if(!filter.keyword.trim()&&!filter.speaker.trim()){this.invalidateLocalSearch('请输入关键词或本段说话人标签，再查询选中日');return;}
    filter.scan_cursor=continueScan?(this.queryPage?.next_scan_cursor||''):next?(this.queryPage?.scan_cursor||''):'';
    filter.hit_cursor=next?(this.queryPage?.next_cursor||''):'';
    this.invalidateLocalSearch();
    try{
      this.queryPage=this.localQuery().scan(filter);this.querySignature=signature;
      this.queryNote=(continueScan?'已切换到后续扫描窗口；':'')+(this.queryPage.hits.length?`本窗口当前页 ${this.queryPage.hits.length} 条命中`:'本窗口内没有匹配的本机文字');
    }catch(error){const code=(error as Error).message;this.invalidateLocalSearch(code==='LOCAL_QUERY_STALE'?'资料或查询条件已变化，请重新查询':code==='LOCAL_SCAN_UNAVAILABLE'?'资料目录暂不可读取，未继续扫描；请刷新后重新查询':'查询未完成，请核对关键词、说话人和日期后重试');}
  }
  private queryCoverage():string{
    const page=this.queryPage;if(!page)return '';
    let text='仅查本机已建立资料修订的文字，未含旧格式资料；不代表服务器或完整录音覆盖。';
    text+=` 本窗口资料位置 ${page.window_end>page.window_start?page.window_start+1:page.window_start}–${page.window_end} / ${page.catalog_total}；按窗口内时间倒序，不代表全库最新排序。`;
    if(page.scan_has_more)text+=' 仍有后续资料未扫描；继续扫描会替换本窗口命中，不会合并成全部结果。';
    else if(page.window_start>0)text+=' 本窗口已到目录末尾；此前窗口的命中未在这里汇总。';
    if(page.stop_reason==='scan_limit')text+=' 本窗口达到资料扫描上限。';
    else if(page.stop_reason==='text_limit')text+=' 本窗口达到文字扫描上限，后续资料可继续扫描。';
    if(page.incomplete)text+=' 当前结果不完整，仅代表本窗口已接受的资料。';
    if(page.incomplete_reason==='unreadable')text+=' 部分资料暂不可读取。';
    if(page.unreadable>0)text+=` 有 ${page.unreadable} 条资料未能读取。`;
    if(page.oversized>0)text+=` 有 ${page.oversized} 条资料超过单条扫描预算，已跳过，不能视为已查询全文。`;
    return text;
  }
  private queryHitLabel(hit:LocalMaterialHit):string{
    let who=hit.speaker_label||hit.speaker_id||'说话人未确定';
    if(hit.label_basis==='role_match')who+='（角色候选，身份未确认）';
    else if(hit.is_self&&hit.label_basis==='user_confirmed')who+='（本段人工确认为本人）';
    else if(hit.speaker_basis==='segment_cluster')who+='（本段分组，身份未确认）';
    const time=hit.start_ms===null||hit.end_ms===null?(hit.reference.source_range?'句内时间未确定，仅引用父句范围':'句内时间未确定'):
      this.clock(hit.source_started+hit.start_ms)+'–'+this.clock(hit.source_started+hit.end_ms);
    return time+' · '+who+(hit.overlap?' · 重叠发言':'')+(hit.transcription_state!=='complete'?' · 文字覆盖未完整':'')+(hit.audio_available?'':' · 原音当前不可用');
  }
  private openQueryReference(reference:LocalMaterialReference):void{
    if(!this.visible||this.busy)return;
    try{
      if(this.querySignature!==JSON.stringify([this.selected,this.queryKeyword,this.querySpeaker])||
        !this.queryPage?.hits.some((hit:LocalMaterialHit):boolean=>JSON.stringify(hit.reference)===JSON.stringify(reference)))throw new Error('LOCAL_QUERY_STALE');
      const current=this.localQuery().resolve(reference);
      const row=this.entries.find((entry:JournalEntry):boolean=>entry.kind===current.source.kind&&
        (entry.lifelogItem?.name||entry.recordingItem?.name||'')===current.source.name);
      if(!row)throw new Error('LOCAL_QUERY_STALE');
      this.viewText(row,current);this.queryOpenedKey=row.key;this.queryNote='已打开当前本机资料修订 v'+current.revision.toString();
    }catch{
      this.text='';this.textKind='';this.textName='';this.textRevision=0;this.textNeedsFull=false;this.fullText=false;
      this.invalidateLocalSearch('原文已修改、删除或暂不可读，请刷新后重新查询');
    }
  }
  private playAudio(kind:string,name:string,revision:number=0,utteranceId:string=''):void{
    if(!this.visible)return;const epoch=this.actionEpoch,selection=new PlaybackSelection();
    selection.kind=kind;selection.name=name;selection.revision=revision;selection.utterance_id=utteranceId;
    localPlayback.play(selection).then(():void=>{if(this.visible&&epoch===this.actionEpoch)this.playback=localPlayback.snapshot();})
      .catch((error:Error):void=>{if(this.visible&&epoch===this.actionEpoch)this.note=this.playbackError(error.message);});
  }
  private playSentence(part:MaterialUtterance,row:MaterialRevision):void{
    if(part.start_ms===null||part.end_ms===null||!Number.isSafeInteger(part.start_ms)||!Number.isSafeInteger(part.end_ms)||part.start_ms<0||part.end_ms<part.start_ms)return;
    this.playAudio(row.source.kind,row.source.name,row.revision,part.utterance_id);
  }
  private controlPlayback(action:string,delta:number=0):void{
    if(!this.visible||!this.playback.session_id)return;const epoch=this.actionEpoch,current=this.playback;
    let pending:Promise<PlaybackSnapshot>;
    if(action==='pause')pending=localPlayback.pause(current.session_id);
    else if(action==='resume')pending=localPlayback.resume(current.session_id);
    else if(action==='stop')pending=localPlayback.stop(current.session_id);
    else{if(!current.position_known||!current.duration_known)return;pending=localPlayback.seek(current.session_id,Math.max(0,Math.min(current.duration_ms,current.position_ms+delta)));}
    pending.then(():void=>{if(this.visible&&epoch===this.actionEpoch)this.playback=localPlayback.snapshot();})
      .catch((error:Error):void=>{if(this.visible&&epoch===this.actionEpoch)this.note=this.playbackError(error.message);});
  }
  private playbackError(code:string):string{
    if(code==='PLAYBACK_SOURCE_UNAVAILABLE')return '原音或来源暂不可读取，文字和导出入口仍保留';
    if(code==='PLAYBACK_INCOMPLETE')return '原音尚未完整封口或完整性不符，暂不能回放';
    if(code==='PLAYBACK_SOURCE_CHANGED')return '所选原音或来源已变化，请刷新后重新选择';
    if(code==='PLAYBACK_DELETED')return '这份资料已删除，不能回放旧原音';
    if(code==='PLAYBACK_ANCHOR_STALE')return '文字修订或原句已变化，请重新打开当前资料';
    if(code==='PLAYBACK_TIME_UNKNOWN')return '原句时间未确定，不能定位起点';
    if(code==='PLAYBACK_CLEANUP_PENDING')return '上一次播放尚未停止，请点停止后再试';
    return '播放状态已变化或原音暂不能播放，请核对播放区后重试';
  }
  private playbackTime(value:number):string{
    const seconds=Math.floor(Math.max(0,value)/1000);return Math.floor(seconds/60).toString().padStart(2,'0')+':'+(seconds%60).toString().padStart(2,'0');
  }
  private playbackLabel():string{
    if(this.playback.phase==='playing')return '播放中';if(this.playback.phase==='paused')return '已暂停';if(this.playback.phase==='ended')return '播放结束';
    if(this.playback.phase==='loading')return '准备原音';if(this.playback.phase==='seeking')return '定位中';if(this.playback.phase==='stopping')return '正在停止';
    if(this.playback.phase==='blocked'||this.playback.phase==='error')return '播放需处理';return '已停止';
  }
  private closeText():void{
    if(this.textName)void localPlayback.stopSource(this.textKind,this.textName).catch(():void=>{});
    this.text='';this.textKind='';this.textName='';this.textRevision=0;this.fullText=false;this.textNeedsFull=false;this.queryOpenedKey='';
  }
  private selectedMaterialChanged(row:MaterialRevision):void{
    const current=localPlayback.snapshot().source;
    if(current&&current.kind===row.source.kind&&current.name===row.source.name&&
      (row.operation==='delete'||current.revision>0&&current.revision!==row.revision))void localPlayback.stopSource(current.kind,current.name).catch(():void=>{});
    this.queryOpenedKey='';this.text=row.text;this.textRevision=row.revision;this.textNeedsFull=row.transcription_state!=='complete'&&!row.user_edited;
    this.invalidateLocalSearch('资料已修改，请重新查询');
    this.savedNotePage=undefined;this.savedNoteDocument=undefined;this.savedNoteReceipt=undefined;this.savedNoteDay='';this.savedNoteNote='资料已修改，请重新查看附注；未提交输入仍保留';this.savedNoteGeneration=(this.savedNoteGeneration||0)+1;
    this.savedSummaryPage=undefined;this.savedSummaryDocument=undefined;this.savedSummaryDay='';this.savedSummaryNote='资料已修改，请重新查看；旧总结可能需要重新生成';this.savedSummaryGeneration=(this.savedSummaryGeneration||0)+1;
  }

  private closeSavedSummaries(note:string=''):void{
    this.savedSummaryPage=undefined;this.savedSummaryDocument=undefined;this.savedSummaryDay='';this.savedSummaryNote=note;++this.savedSummaryGeneration;
  }
  private listSavedSummaries(next:boolean=false):void{
    if(!this.visible||this.busy||!probeSession.foreground)return;
    const day=dayStamp(this.selected),previous=this.savedSummaryPage;
    if(next&&(!previous||this.savedSummaryDay!==day||previous.day!==day||!previous.has_more))return;
    const filter=new SavedSummaryFilter();filter.day=day;filter.cursor=next?(previous?.next_cursor||''):'';
    this.closeSavedSummaries();
    try{
      const page=savedJournalSummaries.list(filter);this.savedSummaryPage=page;this.savedSummaryDay=day;
      this.savedSummaryNote=page.items.length?'仅“来源已核对”的总结可打开；生成时间、模型信息未记录':'本次范围内没有已保存总结';
    }catch(error){this.closeSavedSummaries((error as Error).message==='SAVED_SUMMARY_STALE'?'总结目录或来源已变化，请重新查看':'已保存总结暂不可读取，请刷新后重试');}
  }
  private savedSummaryState(entry:SavedSummaryEntry):string{
    if(entry.state==='current')return '来源已核对（本次读取）';
    if(entry.state==='stale')return '来源已变化，需重新生成';
    if(entry.state==='unverifiable')return '无可验证的总结来源';
    if(entry.state==='not_summary')return '仅原文汇总，不含已验证总结';
    if(entry.state==='corrupt')return '文件校验失败，不能打开';
    if(entry.state==='source_unavailable')return '当前来源暂不可读取';
    return '文件暂不可读取';
  }
  private savedSummaryCoverage():string{
    const page=this.savedSummaryPage;if(!page)return '';
    let message=`本机选中日已保存文件，本页 ${page.items.length} 项；不会生成新总结。`;
    if(page.incomplete){
      if(page.incomplete_reason==='scan_limit')message+=' 已达到文件扫描上限，目录不完整。';
      else if(page.incomplete_reason==='text_limit')message+=' 已达到文字读取上限，目录不完整。';
      else if(page.incomplete_reason==='source_unavailable')message+=' 当前资料来源不可用，不能验证总结。';
      else message+=' 部分文件不可读取，目录不完整。';
    }
    return message;
  }
  private openSavedSummary(reference:SavedSummaryRef):void{
    if(!this.visible||this.busy||!probeSession.foreground)return;
    this.savedSummaryDocument=undefined;++this.savedSummaryGeneration;
    try{
      if(this.savedSummaryDay!==dayStamp(this.selected)||this.savedSummaryPage?.day!==this.savedSummaryDay||
        !this.savedSummaryPage?.items.some((entry:SavedSummaryEntry):boolean=>entry.state==='current'&&entry.can_open&&JSON.stringify(entry.reference)===JSON.stringify(reference)))throw new Error('SAVED_SUMMARY_STALE');
      this.savedSummaryDocument=savedJournalSummaries.open(reference);
      this.savedSummaryNote='已重新核对当前原文；以下为保存的总结，生成时间和模型未知';
    }catch{this.closeSavedSummaries('总结或来源已修改、删除或暂不可读，请重新查看；不会打开旧正文');}
  }
  private exportSavedSummary():void{
    const shown=this.savedSummaryDocument;if(!shown||this.busy||!this.visible||!probeSession.foreground)return;
    const reference=new SavedSummaryRef();reference.day=shown.reference.day;reference.summary_id=shown.reference.summary_id;reference.content_sha256=shown.reference.content_sha256;
    const day=this.selected,epoch=this.actionEpoch,generation=this.savedSummaryGeneration,catalog=this.querySourcesSignature;
    const current=():boolean=>this.visible&&epoch===this.actionEpoch&&day===this.selected&&generation===this.savedSummaryGeneration&&
      this.savedSummaryDay===reference.day&&JSON.stringify(this.savedSummaryDocument?.reference)===JSON.stringify(reference)&&this.querySourcesSignature===catalog;
    const active=():boolean=>current()&&probeSession.foreground;
    this.run(async():Promise<void>=>{
      try{
        if(!active())return;
        const document=savedJournalSummaries.open(reference);
        if(document.source_sha256!==shown.source_sha256||document.markdown!==shown.markdown)throw new Error('SAVED_SUMMARY_STALE');
        const path=writeJournalSnapshot(lifelog.rootPath(),day,document.markdown);let pickerChecked=false;
        const guard=():boolean=>{
          if(!active())return false;
          // The first invocation is after the picker and before destination
          // open/TRUNC. Later copy chunks only check the cheap page signature.
          if(!pickerChecked){const latest=savedJournalSummaries.open(reference);
            if(latest.source_sha256!==document.source_sha256||latest.markdown!==document.markdown)throw new Error('SAVED_SUMMARY_STALE');pickerChecked=true;}
          return active();
        };
        const copied=await this.copyOut(path,`TurboIO-已保存总结-${this.stamp(day)}.md`,guard);
        if(active())this.savedSummaryNote=copied?'已导出重新验证的已保存总结':'已取消导出；App 内保存文件保留';
      }catch{
        if(current())this.closeSavedSummaries('导出未完成；总结或来源需要重新核对，App 内原件保留');
      }
    },active);
  }

  private restoreNoteEditor(note:string=''):void{
    const editor=journalNoteEditorProcess;
    this.noteEditorText=editor.input?.text||'';this.noteEditorDay=editor.input?.parent.day||editor.parent?.day||'';
    this.noteEditorOperation=editor.input?.operation_id||'';this.noteEditorReady=!!editor.parent;this.noteEditorLocked=editor.attempted;
    this.noteEditorNote=note||(editor.attempted?'本次保存输入已固定；请核对状态或明确续完，不会自动重试':'未提交输入仅在当前进程保留，点保存后才建立持久版本');
  }
  private startSummaryNote(editPrevious:boolean=false):void{
    if(!this.visible||this.busy||!probeSession.foreground)return;
    if(journalNoteEditorProcess.input){this.restoreNoteEditor('已有未处理的附注输入，已保留原绑定；先保存或明确放弃，再开始另一份');return;}
    try{
      let parent:SavedSummaryRef,source:string,previous:JournalNoteRef|undefined=undefined,previousText:string='';
      if(editPrevious){
        if(!this.savedNoteDocument)throw new Error('NOTE_STALE');
        const document=journalSummaryNotes.open(this.savedNoteDocument.reference);
        parent=document.record.origin;source=document.record.source_sha256;previous=document.reference;previousText=document.record.text;
      }else{
        if(!this.savedSummaryDocument)throw new Error('NOTE_STALE');
        const document=savedJournalSummaries.open(this.savedSummaryDocument.reference);parent=document.reference;source=document.source_sha256;
      }
      const editor=new JournalNoteEditorProcess();editor.parent=JSON.parse(JSON.stringify(parent)) as SavedSummaryRef;editor.source=source;
      if(previous)editor.previous=JSON.parse(JSON.stringify(previous)) as JournalNoteRef;
      journalNoteEditorProcess=editor;this.restoreNoteEditor(editPrevious?'编辑将保存为新的人工附注版本，原版本和AI正文保留':'请写人工附注；原AI正文保留');
      if(editPrevious)this.changeNoteEditor(previousText);
    }catch{this.savedNoteNote='原总结或附注来源暂不可核对，请重新打开；已有输入保留';}
  }
  private validNoteText(value:string):boolean{
    if(value.length>8192)return false;
    for(let at=0;at<value.length;at++){const code=value.charCodeAt(at);
      if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++at);if(!(next>=0xdc00&&next<=0xdfff))return false;}
      else if(code>=0xdc00&&code<=0xdfff)return false;
    }return true;
  }
  private changeNoteEditor(value:string):void{
    const editor=journalNoteEditorProcess;if(editor.attempted){this.restoreNoteEditor();return;}
    if(!this.validNoteText(value)){this.restoreNoteEditor('输入未采用：最多约8千字，超限保留原输入；请使用完整文字');return;}
    if(!editor.parent){this.restoreNoteEditor('请先从已核对总结或已保存附注开始编辑');return;}
    if(!editor.input&&value.length){
      const input=new JournalNoteInput();input.operation_id='noteop-'+editor.parent.day+'-'+util.generateRandomUUID().replace(/-/g,'');
      input.parent=JSON.parse(JSON.stringify(editor.parent)) as SavedSummaryRef;input.source_sha256=editor.source;input.text=value;
      if(editor.previous)input.previous=JSON.parse(JSON.stringify(editor.previous)) as JournalNoteRef;editor.input=input;
    }else if(editor.input)editor.input.text=value;
    this.restoreNoteEditor();
  }
  private discardNoteEditor():void{
    if(!this.visible||this.busy)return;
    const captured=JSON.stringify(journalNoteEditorProcess),epoch=this.actionEpoch;
    this.getUIContext().showAlertDialog({title:'放弃当前过程中的附注输入？',message:'未提交的输入将从当前编辑器移除。已保存版本、完整待续保存及未知中断文件仍保留在App中，不会被删除或自动续完。',
      primaryButton:{value:'保留输入',action:():void=>{}},secondaryButton:{value:'放弃过程输入',action:():void=>{
        if(!this.visible||epoch!==this.actionEpoch||captured!==JSON.stringify(journalNoteEditorProcess))return;
        journalNoteEditorProcess=new JournalNoteEditorProcess();this.restoreNoteEditor('过程输入已明确放弃；持久保存记录保持');
      }}});
  }
  private saveSummaryNote(resume:boolean=false):void{
    if(!this.visible||this.busy||!probeSession.foreground)return;
    const editor=journalNoteEditorProcess,input=editor.input;
    if(!input||!input.text.trim()||!this.validNoteText(input.text)){this.restoreNoteEditor('请先写非空附注；不会保存空白或截断输入');return;}
    if(resume&&!editor.attempted){this.restoreNoteEditor('尚未尝试保存，不能续完；请明确点保存新版本');return;}
    const frozen=JSON.parse(JSON.stringify(input)) as JournalNoteInput,captured=JSON.stringify(input);
    editor.attempted=true;this.restoreNoteEditor();
    try{
      const receipt=resume?journalSummaryNotes.resume(frozen):journalSummaryNotes.save(frozen);this.savedNoteReceipt=receipt;
      if(receipt.state==='saved'&&receipt.reference){
        this.savedNotePage=undefined;++this.savedNoteGeneration;
        if(receipt.can_open){
          // Do not clear newer input if a synchronous observer replaced it.
          if(captured===JSON.stringify(journalNoteEditorProcess.input)){journalNoteEditorProcess=new JournalNoteEditorProcess();this.restoreNoteEditor('人工附注新版本已保存');}
          this.savedNoteNote='人工附注新版本已保存，原AI正文与旧版本保留；附注仅保存在本机';
          if(receipt.reference.day===dayStamp(this.selected))this.openSavedNote(receipt.reference);
        }else this.restoreNoteEditor('保存记录已存在，但来源目前不可核对；完整输入仍保留，请核对状态');
      }else this.restoreNoteEditor('保存尚未完成；完整输入与操作标识保留，请核对状态，完整待续保存需明确续完');
    }catch{this.closeSavedNotes('保存未完成；来源变化、版本冲突或文件异常需核对，完整输入保留');this.restoreNoteEditor('本次完整输入已保留且未冒充保存成功；请核对保存状态，勿改同次保存内容');}
  }
  private inspectSummaryNote():void{
    if(!this.visible||this.busy||!probeSession.foreground)return;
    const input=journalNoteEditorProcess.input;if(!input)return;
    try{this.savedNoteReceipt=journalSummaryNotes.inspect(input.operation_id);this.noteEditorNote='仅核对保存记录，不会提交或续完；'+this.noteReceiptLabel(this.savedNoteReceipt);}
    catch{this.noteEditorNote='保存状态暂不可读取；原输入与操作标识保留，未重试保存';}
  }
  private restorePendingNote(operation:string,inputHash:string):void{
    if(!this.visible||this.busy||!probeSession.foreground)return;
    if(journalNoteEditorProcess.input){this.restoreNoteEditor('当前已有过程输入，不能覆盖；先保存或明确放弃，再恢复另一份');return;}
    try{
      if(this.savedNotePage?.day!==dayStamp(this.selected)||!this.savedNotePage.items.some((receipt:JournalNoteReceipt):boolean=>
        receipt.operation_id===operation&&receipt.state==='pending'&&receipt.input_sha256===inputHash))throw new Error('NOTE_STALE');
      const receipt=journalSummaryNotes.inspect(operation);
      if(receipt.state!=='pending'||receipt.input_sha256!==inputHash)throw new Error('NOTE_STALE');
      const input=journalSummaryNotes.pendingInput(operation,inputHash);
      if(input.operation_id!==operation||input.parent.day!==dayStamp(this.selected))throw new Error('NOTE_STALE');
      const editor=new JournalNoteEditorProcess();editor.parent=JSON.parse(JSON.stringify(input.parent)) as SavedSummaryRef;editor.source=input.source_sha256;
      editor.input=JSON.parse(JSON.stringify(input)) as JournalNoteInput;editor.attempted=true;
      if(input.previous)editor.previous=JSON.parse(JSON.stringify(input.previous)) as JournalNoteRef;
      journalNoteEditorProcess=editor;this.savedNoteReceipt=receipt;this.restoreNoteEditor('已只读恢复完整待续输入，请核对全文后明确点“续完这次保存”；尚未提交');
    }catch{this.savedNoteNote='待续输入已变化、来源失效或记录异常，未恢复正文、未提交；原件保留';}
  }
  private noteReceiptLabel(receipt:JournalNoteReceipt):string{
    if(receipt.state==='saved')return receipt.can_open?'已保存，可重新核对并打开':'已保存，但当前来源不可核对';
    if(receipt.state==='pending')return '完整待续保存；不会自动提交';
    if(receipt.state==='reserved')return '保存已占位，完整内容尚不可续完';
    if(receipt.state==='missing')return '未找到持久保存记录';
    if(receipt.state==='stale')return '原来源已变化，不能续完旧输入';
    if(receipt.state==='corrupt')return '保存记录校验失败，原件保留';
    return '保存记录需处理，原件保留';
  }
  private noteSavedTime(value:string):string{
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return '记录时间未知';
    const date=new Date(value);if(!Number.isFinite(date.getTime())||date.toISOString()!==value)return '记录时间未知';
    const pad=(n:number):string=>n.toString().padStart(2,'0');
    return `记录时间：${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  private closeSavedNotes(note:string=''):void{
    this.savedNotePage=undefined;this.savedNoteDocument=undefined;this.savedNoteDay='';this.savedNoteNote=note;++this.savedNoteGeneration;
  }
  private listSummaryNotes(next:boolean=false):void{
    if(!this.visible||this.busy||!probeSession.foreground)return;
    const day=dayStamp(this.selected),previous=this.savedNotePage;
    if(next&&(!previous||previous.day!==day||this.savedNoteDay!==day||!previous.has_more))return;
    const filter=new JournalNoteFilter();filter.day=day;filter.cursor=next?(previous?.next_cursor||''):'';this.closeSavedNotes();
    try{this.savedNotePage=journalSummaryNotes.list(filter);this.savedNoteDay=day;this.savedNoteNote=this.savedNotePage.items.length?'已保存版本与未完成保存分别显示；不会生成AI总结':'本次范围内没有该日附注保存记录';}
    catch{this.closeSavedNotes('附注目录或来源已变化、暂不可读，请重新查看；过程输入保留');}
  }
  private noteCoverage():string{
    const page=this.savedNotePage;if(!page)return '';
    let text=`本机人工附注，本页 ${page.items.length} 项。`;
    if(page.incomplete)text+=page.incomplete_reason==='scan_limit'?' 达到扫描上限，目录不完整。':page.incomplete_reason==='text_limit'?' 达到读取上限，目录不完整。':' 部分记录或来源不可读取，目录不完整。';
    return text;
  }
  private openSavedNote(reference:JournalNoteRef):void{
    if(!this.visible||this.busy||!probeSession.foreground)return;
    this.savedNoteDocument=undefined;++this.savedNoteGeneration;
    try{
      const same=(value:JournalNoteRef|undefined):boolean=>JSON.stringify(value)===JSON.stringify(reference);
      if(reference.day!==dayStamp(this.selected)||(!this.savedNotePage?.items.some((receipt:JournalNoteReceipt):boolean=>receipt.state==='saved'&&receipt.can_open&&same(receipt.reference))&&
        !(this.savedNoteReceipt?.state==='saved'&&this.savedNoteReceipt.can_open&&same(this.savedNoteReceipt.reference))))throw new Error('NOTE_STALE');
      this.savedNoteDocument=journalSummaryNotes.open(reference);this.savedNoteDay=reference.day;this.savedNoteNote='已核对原总结来源；人工附注与AI正文分别显示';
    }catch{this.closeSavedNotes('附注或原总结来源已变化、删除或暂不可读，不打开旧正文；过程输入保留');}
  }
  private exportSummaryNote(format:string):void{
    const shown=this.savedNoteDocument;if(!shown||!['md','json'].includes(format)||this.busy||!this.visible||!probeSession.foreground)return;
    const reference=JSON.parse(JSON.stringify(shown.reference)) as JournalNoteRef;
    const day=this.selected,epoch=this.actionEpoch,generation=this.savedNoteGeneration,catalog=this.querySourcesSignature;
    const current=():boolean=>this.visible&&epoch===this.actionEpoch&&day===this.selected&&generation===this.savedNoteGeneration&&
      this.savedNoteDay===reference.day&&JSON.stringify(this.savedNoteDocument?.reference)===JSON.stringify(reference)&&this.querySourcesSignature===catalog;
    const active=():boolean=>current()&&probeSession.foreground;
    this.run(async():Promise<void>=>{
      try{
        if(!active())return;
        const document=journalSummaryNotes.open(reference);
        if(document.record.source_sha256!==shown.record.source_sha256||document.markdown!==shown.markdown||document.structured_json!==shown.structured_json)throw new Error('NOTE_STALE');
        const exported=journalSummaryNotes.exportSnapshot(reference,format);let pickerChecked=false;
        const guard=():boolean=>{
          if(!active())return false;
          if(!pickerChecked){const latest=journalSummaryNotes.open(reference);
            if(latest.record.source_sha256!==document.record.source_sha256||latest.markdown!==document.markdown||latest.structured_json!==document.structured_json)throw new Error('NOTE_STALE');pickerChecked=true;}
          return active();
        };
        const copied=await this.copyOut(exported.path,`TurboIO-人工附注-${this.stamp(day)}.${format}`,guard);
        if(active())this.savedNoteNote=copied?'已导出当前人工附注版本与原总结':'已取消导出；App内附注版本保留';
      }catch{if(current())this.closeSavedNotes('导出未完成；附注或来源需重新核对，App内原件和过程输入保留');}
    },active);
  }

  private confirmLifelogExit():void{
    const id=lifelog.cleanupSessionId,epoch=this.actionEpoch;
    this.getUIContext().showAlertDialog({title:'确认智记已退出',message:'只有实际看到原眼镜已退出智记、没有收音提示时才确认。这是人工确认，不会补造缺失音频；全天模式设置保留，恢复状态会单独显示。',primaryButton:{value:'尚未退出',action:():void=>{}},secondaryButton:{value:'已退出智记',action:():void=>{
      if(!this.visible||epoch!==this.actionEpoch)return;
      try{lifelog.confirmExited(id);}catch(error){this.note=(error as Error).message;}this.refresh();
    }}});
  }
  private run(action:()=>Promise<void>,actionCurrent:()=>boolean=():boolean=>true):void{
    if(this.busy||!this.visible)return;this.busy=true;const epoch=this.actionEpoch;
    action().then(():void=>{if(this.visible&&epoch===this.actionEpoch&&actionCurrent())this.getUIContext().getPromptAction().showToast({message:this.note||'完成',duration:3000});})
      .catch((error:Error):void=>{if(this.visible&&epoch===this.actionEpoch&&actionCurrent()){this.note=error.message;this.getUIContext().getPromptAction().showToast({message:error.message,duration:4000});}})
      .finally(():void=>{if(this.visible&&epoch===this.actionEpoch)this.busy=false;});
  }

  // 汇总正文：交给共享构造器，保证与每日自动上传的内容一致。
  private sources():JournalSources{
    const src=new JournalSources();
    src.lifelogRoot=lifelog.rootPath();
    src.lifelogItems=lifelog.items;
    src.recordingItems=recordings.items;
    src.transcriptJson=(item:LifelogItem):string=>lifelog.readTranscriptJson(item);
    src.recordingText=(item:RecordingItem):string=>{try{return fs.readTextSync(recordings.textPath(item)) as string;}catch(_){return '';}};
    src.material=(kind:string,name:string):MaterialRevision|undefined=>materials.read(materials.idFor(kind,name));
    return src;
  }
  private dayMarkdown(dayStart:number,summary:string):LifelogDayText{return buildJournalDay(dayStart,this.sources(),summary);}

  // 当天 OGG 文件（自动上传用）。
  private dayAudio(dayStart:number):string[]{
    const out:string[]=[];
    for(const row of this.dayEntries(dayStart)){
      if(row.kind!=='lifelog'||!row.lifelogItem)continue;
      const item=row.lifelogItem;
      if(item.ogg)out.push(lifelog.file(item,'ogg'));
    }
    return out;
  }

  private uploadToday(dayStart:number):void{
    if(this.uploading)return;
    const targetURL=this.upURL.trim();
    if(!/^https:\/\//.test(targetURL)){this.getUIContext().getPromptAction().showToast({message:'请先填写 HTTPS 上传地址',duration:3000});return;}
    const rendered=this.dayMarkdown(dayStart,'');
    if(rendered.total===0){this.getUIContext().getPromptAction().showToast({message:'这一天没有记录',duration:3000});return;}
    this.uploading=true;this.note='正在上传当天记录…';
    (async():Promise<void>=>{
      const path=writeJournalSnapshot(lifelog.rootPath(),dayStart,rendered.markdown);
      const target=new UploadTarget();
      target.url=targetURL;target.token=this.upToken.trim();target.auto=this.upAuto;target.time=this.upTime;
      const reply=await this.uploader.upload(target,dayStamp(dayStart),path,this.dayAudio(dayStart));
      this.note=this.uploader.note||'已上传';
      if(reply){this.text=reply;this.textName='';}
    })().catch((error:Error):void=>{this.note='上传失败：'+error.message;if(this.visible)this.getUIContext().getPromptAction().showToast({message:this.note,duration:4000});})
      .finally(():void=>{if(this.visible)this.uploading=false;});
  }

  private saveUploadConfig():void{
    this.run(async():Promise<void>=>{
      const config=await this.vault.load();
      config.uploadURL=this.upURL.trim();config.uploadToken=this.upToken.trim();
      config.uploadAuto=this.upAuto;config.uploadTime=this.upTime.trim();
      await this.vault.save(config);
      this.note=config.uploadAuto?`已保存：每天 ${config.uploadTime} 自动上传`:'已保存上传设置（未开启自动）';
    });
  }

  private exportDay(dayStart:number):void{
    const list=this.dayEntries(dayStart);
    if(!list.length){this.getUIContext().getPromptAction().showToast({message:'这一天没有记录',duration:3000});return;}
    const rendered=this.dayMarkdown(dayStart,'');
    if(rendered.transcribed===0){
      this.getUIContext().showAlertDialog({title:'这一天还没有转写内容',message:`共 ${list.length} 条记录，都还没转写。请先逐条点「转写」（本机离线、免费），转写完再来汇总。`,
        primaryButton:{value:'知道了',action:():void=>{}},secondaryButton:{value:'仅导出占位清单',action:():void=>this.runExport(dayStart,false)}});
      return;
    }
    const missing=rendered.total-rendered.transcribed;
    this.getUIContext().showAlertDialog({title:`导出汇总（${rendered.transcribed}/${rendered.total} 条有内容）？`,
      message:`把当天的全天智记与录音合并成一份带时间轴的 Markdown。${missing?`还有 ${missing} 条没转写，会标注占位。`:'全部已转写。'}是否调用 DeepSeek 生成 AI 总结？`,
      primaryButton:{value:'仅导出',action:():void=>this.runExport(dayStart,false)},
      secondaryButton:{value:'带 AI 总结',action:():void=>this.runExport(dayStart,true)}});
  }

  private runExport(dayStart:number,withSummary:boolean):void{
    const epoch=this.actionEpoch;
    const current=():boolean=>this.visible&&epoch===this.actionEpoch&&this.selected===dayStart&&probeSession.foreground;
    this.run(async():Promise<void>=>{
      if(!current())return;
      const base=this.dayMarkdown(dayStart,'');
      const exportCurrent=():boolean=>{
        if(!current())return false;
        try{assertJournalSnapshotCurrent(base,this.dayMarkdown(dayStart,''));return true;}catch(_){return false;}
      };
      const textKind=this.textKind,textName=this.textName,textRevision=this.textRevision;
      let full=base,summary='';
      if(withSummary&&base.transcribed>0){
        this.note='正在请求 AI 总结…';
        const config=await this.vault.load();if(!current())return;
        assertJournalSnapshotCurrent(base,this.dayMarkdown(dayStart,''));
        summary=await this.remote.summarize(config,`${this.stamp(dayStart)} 的 ${base.total} 条记录`,base.markdown);
        if(!current())return;
        full=bindJournalSummary(base,this.dayMarkdown(dayStart,''),summary);
      }
      if(!current())return;
      const path=writeJournalSnapshot(lifelog.rootPath(),dayStart,full.markdown);
      const copied=await this.copyOut(path,`TurboIO-记录汇总-${this.stamp(dayStart)}.md`,exportCurrent);
      if(!current())return;
      if(!exportCurrent())throw new Error('当日资料已变化，请重新生成并导出；App 内快照仍保留');
      this.note=copied?`已导出（${full.transcribed}/${full.total} 条有内容${summary?'，含 AI 总结':''}）`
        :'已取消导出；汇总快照仍保留在 App 内';
      if(this.textKind===textKind&&this.textName===textName&&this.textRevision===textRevision){
        this.text=full.markdown;this.textKind='';this.textName='';this.textRevision=0;this.textNeedsFull=false;this.fullText=false;
      }
    },current);
  }

  private async copyOut(source:string,newName:string,current:()=>boolean=():boolean=>true):Promise<boolean>{
    const context=this.getUIContext().getHostContext() as common.UIAbilityContext;
    const uris=await new picker.DocumentViewPicker(context).save({newFileNames:[newName]});if(!uris.length)return false;
    if(!current())throw new Error('导出条件已变化，请重新打开后导出');
    const input=fs.openSync(source,fs.OpenMode.READ_ONLY);let output:fs.File|undefined=undefined;
    try{
      const length=fs.statSync(input.fd).size;let offset=0;
      if(!current())throw new Error('导出条件已变化，请重新打开后导出');
      while(offset<length){
        if(!current())throw new Error('导出条件已变化，文件未完整导出');
        const part=new ArrayBuffer(Math.min(262144,length-offset));
        const n=fs.readSync(input.fd,part,{length:part.byteLength});if(n<=0)throw new Error('源文件读取不完整');
        if(!current())throw new Error('导出条件已变化，文件未完整导出');
        if(!output)output=fs.openSync(uris[0],fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
        let written=0;while(written<n){
          if(!current())throw new Error('导出条件已变化，文件未完整导出');
          const count=fs.writeSync(output.fd,part.slice(written,n));if(count<=0)throw new Error('导出写入不完整');written+=count;
        }
        offset+=n;await new Promise<void>((resolve:()=>void)=>{setTimeout(resolve,0);});
      }
      if(!current())throw new Error('导出条件已变化，文件未完整导出');
      if(!output)output=fs.openSync(uris[0],fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
      if(!current())throw new Error('导出条件已变化，文件未完整导出');
      fs.fsyncSync(output.fd);
    }finally{fs.closeSync(input);if(output)fs.closeSync(output);}
    return true;
  }

  private transcribeEntry(row:JournalEntry):void{
    const epoch=this.actionEpoch;
    if(row.kind==='lifelog'&&row.lifelogItem){
      const item=row.lifelogItem;
      this.getUIContext().showAlertDialog({title:'用本机离线模型转写这一段？',
        message:'全程不联网，使用本机离线模型完整转写这一段并分析说话人，请保持应用前台。已保存结果优先恢复；若上次识别结果未保存，继续会重新识别。文字保存后可查看、导出和同步，原音保留。无法确认的说话人保留未知，分析标签不保证识别出真实姓名或“我”。正在执行本机转写时请等待；排队任务在本次处理后继续。',
        primaryButton:{value:'取消',action:():void=>{}},
        secondaryButton:{value:'开始转写',action:():void=>{
          if(!this.visible||epoch!==this.actionEpoch)return;
          this.run(async():Promise<void>=>{
            if(lifelogASR.busy||localCurrentDirectory())throw new Error('已有本机转写正在执行，请等待完成后再转写这一段');
            this.note='正在本机完整转写并分析说话人…';
            const note=await transcribeLifelogManual(item,true);
            if(!this.visible||epoch!==this.actionEpoch)return;
            this.refresh();if(this.textKind===row.kind&&this.textName===item.name)this.viewText(row);this.note=note;
          });
        }}});
      return;
    }
    if(row.recordingItem){
      const item=row.recordingItem;
      this.getUIContext().showAlertDialog({title:'上传这条录音做云端转写？',message:'录音会发送到本机配置的阿里云 ASR（不属于本机离线链路）。已保存结果优先恢复；若上次识别结果未保存，继续会重新上传所选录音并识别。原始录音保留，双声道会合并为单声道；请保持应用前台，离开本页或退到后台即取消。',
        primaryButton:{value:'取消',action:():void=>{}},
        secondaryButton:{value:'开始转写',action:():void=>{
          if(!this.visible||epoch!==this.actionEpoch)return;
          this.run(async():Promise<void>=>{
          const config=await this.vault.load();
          if(!this.visible||epoch!==this.actionEpoch)return;
          const note=await transcribeRecordingCloud(item,config,true);
          if(!this.visible||epoch!==this.actionEpoch)return;
          this.refresh();if(this.textKind===row.kind&&this.textName===item.name)this.viewText(row);this.note=note;
          });
        }}});
    }
  }
  private viewText(row:JournalEntry,resolved:MaterialRevision|undefined=undefined):void{
    this.queryOpenedKey='';
    const name=row.lifelogItem?.name||row.recordingItem?.name||'';
    // Query references have already resolved the current canonical revision.
    // Their empty text must never reopen an unrelated legacy ASR mirror.
    try{const material=resolved||localMaterialRevision(row.kind,name);this.text=material.text;
      if(!this.text&&!resolved&&!material.user_edited)this.text=row.lifelogItem?lifelog.readText(row.lifelogItem):fs.readTextSync(recordings.textPath(row.recordingItem as RecordingItem));
      this.textKind=row.kind;this.textName=name;this.textNeedsFull=material.transcription_state!=='complete'&&!material.user_edited;this.fullText=false;this.textRevision=material.revision;
    }catch(_){this.note='文字或资料来源暂不可读，请刷新后核对；原件保留';this.text='';this.textName='';}
  }
  private exportText(format:string):void{
    if(!this.textName)return;
    this.run(async():Promise<void>=>{
      const source=localMaterialExportPath(this.textKind,this.textName,format);
      const ok=await this.copyOut(source,'TurboIO-'+this.textName+'.'+format);this.note=ok?'已导出当前资料修订':'已取消导出';
    });
  }
  private fullSelectedText():void{
    const row=this.entries.find((item:JournalEntry):boolean=>item.kind===this.textKind&&(item.lifelogItem?.name||item.recordingItem?.name)===this.textName);
    if(row)this.transcribeEntry(row);
  }

  private dirOf(row:JournalEntry):string{
    if(row.kind==='lifelog'&&row.lifelogItem)return lifelog.rootPath()+'/'+row.lifelogItem.name;
    if(row.recordingItem)return recordings.directoryOf(row.recordingItem);
    return '';
  }
  private isRunning(row:JournalEntry):boolean{return this.runningDir!==''&&this.runningDir===this.dirOf(row);}
  private isQueued(row:JournalEntry):boolean{return this.queuedDirs.indexOf(this.dirOf(row))>=0;}
  private pendingCount(dayStart:number):number{
    let count=0;
    for(const row of this.dayEntries(dayStart)){if(!row.hasText)count++;}
    return count;
  }
  private transcribeDay(dayStart:number):void{
    const epoch=this.actionEpoch;
    const list=this.dayEntries(dayStart).filter((row:JournalEntry):boolean=>!row.hasText);
    if(!list.length){this.getUIContext().getPromptAction().showToast({message:'这一天没有待转写的记录',duration:3000});return;}
    this.getUIContext().showAlertDialog({title:`一键转写 ${list.length} 条？`,
      message:'逐条加入本机转写队列，全程不联网。手动和自动转写都按电量、温度、存储与处理预算调度，未充电也可处理；智记窗口先产出文字，说话人归属仍待分析。',
      primaryButton:{value:'取消',action:():void=>{}},
      secondaryButton:{value:'开始转写',action:():void=>{
        if(!this.visible||epoch!==this.actionEpoch)return;
        this.run(async():Promise<void>=>{
          for(const row of list){
            if(row.kind==='lifelog'&&row.lifelogItem){
              const item=row.lifelogItem;
              if(!item.ogg)continue;
              enqueueLocalTranscribe(lifelog.rootPath()+'/'+item.name,lifelog.file(item,'ogg'),item.created,'lifelog',true);
            }else if(row.recordingItem){
              const item=row.recordingItem;
              enqueueLocalTranscribe(recordings.directoryOf(item),recordings.file(item,false),item.created,'recording',true);
            }
          }
          this.refresh();this.note='已提交排队请求，实际受理状态请查看队列';
        });
      }}});
  }
  // 待命名声纹：从当天（最近 10 段）的转写里收集没绑定角色的说话人，跨段按相似度合并。
  private collectPendingVoices(dayStart:number):void{
    const out:LifelogSpeaker[]=[];
    const vectors:Float32Array[]=[];
    const list=this.dayEntries(dayStart).filter((row:JournalEntry):boolean=>row.kind==='lifelog'&&row.hasText).slice(-10);
    for(const row of list){
      if(!row.lifelogItem)continue;
      try{
        const parsed=JSON.parse(lifelog.readTranscriptJson(row.lifelogItem)) as Record<string,Object>;
        const speakers=parsed['speakers'] as LifelogSpeaker[];
        if(!speakers)continue;
        for(const speaker of speakers){
          if(speaker.roleId||!speaker.embedding)continue;
          let merged=false;
          const vector=VoiceRegistry.decode(speaker.embedding);
          for(let i=0;i<vectors.length;i++){
            if(VoiceRegistry.cosine(vectors[i],vector)>=VoiceRegistry.threshold){
              out[i].samples+=speaker.samples;merged=true;break;
            }
          }
          if(!merged){
            const copy=new LifelogSpeaker();
            copy.index=out.length;copy.samples=speaker.samples;copy.embedding=speaker.embedding;
            out.push(copy);vectors.push(vector);
          }
        }
      }catch(_){}
    }
    this.pendingVoices=out;
  }
  private nameVoice(index:number):void{
    this.editId='';this.editIndex=index;this.editName='';this.editBio='';
  }
  private saveVoice():void{
    try{
      let target:LifelogSpeaker|undefined=undefined;
      for(const voice of this.pendingVoices){if(voice.index===this.editIndex)target=voice;}
      if(!target||!target.embedding)throw new Error('声纹样本已过期，请重新转写后再命名');
      voices.bind('',this.editName,this.editBio,VoiceRegistry.decode(target.embedding),Date.now());
      this.roles=voices.ordered();this.editIndex=-1;
      this.note=`已绑定声纹：${this.editName.trim()}`;
      this.getUIContext().getPromptAction().showToast({message:this.note,duration:3000});
    }catch(error){this.getUIContext().getPromptAction().showToast({message:(error as Error).message,duration:4000});}
  }
  private nameRole(role:VoiceRole):void{
    this.editIndex=-1;this.editId=role.id;this.editName=role.name;this.editBio=role.bio;
  }
  private saveRole():void{
    try{
      voices.rename(this.editId,this.editName,this.editBio,Date.now());
      this.roles=voices.ordered();this.editId='';
      this.getUIContext().getPromptAction().showToast({message:'已更新角色卡',duration:3000});
    }catch(error){this.getUIContext().getPromptAction().showToast({message:(error as Error).message,duration:4000});}
  }
  private removeRole(role:VoiceRole):void{
    voices.remove(role.id);this.roles=voices.ordered();this.note=`已删除声纹：${role.name}`;
  }

  private clearDeletedSelection(kind:string,name:string):void{
    if(this.textKind!==kind||this.textName!==name)return;
    try{
      const material=materials.read(materials.idFor(kind,name));
      if(!material||material.operation!=='delete')return;
    }catch(_){return;}
    this.text='';this.textKind='';this.textName='';this.textRevision=0;this.textNeedsFull=false;this.fullText=false;
  }

  private confirmRemove(row:JournalEntry):void{
    if(!this.visible||this.busy)return;
    const epoch=this.actionEpoch,kind=row.kind,lifelogItem=row.lifelogItem,recordingItem=row.recordingItem;
    const name=kind==='lifelog'?(lifelogItem?.name||''):(recordingItem?.name||'');
    this.getUIContext().showAlertDialog({title:'删除这条记录？',message:'从记录列表移除，并清理本机录音或智记文件；原音清理不可恢复。历史文字修订保留用于同步核对。开启同步后发送删除标记，云端删除以服务器确认结果为准。',
      primaryButton:{value:'取消',action:():void=>{}},
      secondaryButton:{value:'删除',action:():void=>{
        if(!this.visible||epoch!==this.actionEpoch)return;
        this.run(async():Promise<void>=>{
          await localPlayback.stopSource(kind,name);
          if(!this.visible||epoch!==this.actionEpoch)return;
          if((kind==='lifelog'&&(!lifelogItem||lifelogItem.name!==name||!lifelog.items.some((item:LifelogItem):boolean=>item.name===name)))||
            (kind==='recording'&&(!recordingItem||recordingItem.name!==name||!recordings.items.some((item:RecordingItem):boolean=>item.name===name))))throw new Error('记录条目已变化，请刷新后重试');
          this.queryPage=undefined;this.querySignature='';this.queryNote='资料删除操作已开始，请重新查询';
          this.savedNotePage=undefined;this.savedNoteDocument=undefined;this.savedNoteReceipt=undefined;this.savedNoteDay='';this.savedNoteNote='资料删除操作已开始，请重新查看附注；过程输入保留';this.savedNoteGeneration=(this.savedNoteGeneration||0)+1;
          this.savedSummaryPage=undefined;this.savedSummaryDocument=undefined;this.savedSummaryDay='';this.savedSummaryNote='资料删除操作已开始，请重新查看已保存总结';this.savedSummaryGeneration=(this.savedSummaryGeneration||0)+1;
          try{
            if(kind==='lifelog'&&lifelogItem)lifelog.remove(lifelogItem);
            if(kind==='recording'&&recordingItem)recordings.remove(recordingItem);
            this.refresh();
          }finally{
            if(this.visible&&epoch===this.actionEpoch)this.clearDeletedSelection(kind,name);
          }
        });
      }}});
  }


  @Builder
  playbackArea(){
    if(this.playback.session_id||this.playback.phase!=='idle'){Column({space:6}){
      Text('原音回放 · '+this.playbackLabel()).fontSize(12).fontColor($r('app.color.text_primary')).width('100%')
      Text((this.playback.position_known?this.playbackTime(this.playback.position_ms):'位置未知')+' / '+(this.playback.duration_known?this.playbackTime(this.playback.duration_ms):'时长待确认')).fontSize(11).fontColor($r('app.color.text_secondary'))
      Row({space:6}){
        Button('−15秒').chipBtn().fontSize(11).height(28).enabled(this.playback.position_known&&this.playback.duration_known&&['playing','paused'].includes(this.playback.phase)).onClick(()=>this.controlPlayback('seek',-15000))
        if(this.playback.phase==='playing'){Button('暂停').chipBtn().fontSize(11).height(28).onClick(()=>this.controlPlayback('pause'))}
        else{Button('继续').chipBtn().fontSize(11).height(28).enabled(this.playback.phase==='paused').onClick(()=>this.controlPlayback('resume'))}
        Button('+15秒').chipBtn().fontSize(11).height(28).enabled(this.playback.position_known&&this.playback.duration_known&&['playing','paused'].includes(this.playback.phase)).onClick(()=>this.controlPlayback('seek',15000))
        Button('停止').chipBtn().fontSize(11).height(28).enabled(!!this.playback.session_id).onClick(()=>this.controlPlayback('stop'))
      }.width('100%')
      if(this.playback.note){Text(this.playback.note).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')}
    }.width('100%').padding(10).backgroundColor($r('app.color.row_bg')).borderRadius(12)}
  }

  @Builder
  calendarArea(){
    Column({space:10}){
        // ---- 日历 ----
        Column({space:6}){
          Row({space:10}){
            Button('‹').fontSize(14).height(28).width(32).padding(0).backgroundColor($r('app.color.card_raise')).onClick(()=>this.shiftMonth(-1))
            Text(this.monthLabel()).fontSize(14).fontColor($r('app.color.text_primary')).layoutWeight(1).textAlign(TextAlign.Center)
            Button('›').fontSize(14).height(28).width(32).padding(0).backgroundColor($r('app.color.card_raise')).onClick(()=>this.shiftMonth(1))
          }.width('100%')
          Row(){
            ForEach(['日','一','二','三','四','五','六'],(label:string)=>{
              Text(label).fontSize(11).fontColor($r('app.color.text_muted')).layoutWeight(1).textAlign(TextAlign.Center)
            },(label:string)=>label)
          }.width('100%')
          ForEach([0,1,2,3,4,5],(week:number)=>{
            Row(){
              ForEach(this.cells().slice(week*7,week*7+7),(day:number)=>{
                Column({space:2}){
                  if(day>0){
                    Text(`${new Date(day).getDate()}`).fontSize(13).fontColor(day===this.selected?$r('app.color.on_brand'):$r('app.color.text_primary'))
                    if(this.countOn(day)>0){Text('·').fontSize(11).fontColor(day===this.selected?$r('app.color.on_brand'):$r('app.color.brand'))}
                  }
                }.layoutWeight(1).height(38).justifyContent(FlexAlign.Center)
                  .backgroundColor(day===this.selected?$r('app.color.brand'):$r('app.color.row_bg')).borderRadius(9)
                  .onClick(():void=>this.selectDay(day))
              },(day:number)=>`c${day}`)
            }.width('100%')
          },(week:number)=>`w${week}`)
        }.width('100%').padding(10).backgroundColor($r('app.color.card_bg_soft')).borderRadius(14)
  
    }.width('100%')
  }

  @Builder
  rolesArea(){
    Column({space:10}){
        // ---- 声纹角色 ----
        Column({space:6}){
          Row({space:8}){
            Text('声纹角色').fontSize(13).fontColor($r('app.color.text_primary'))
            Text(`· ${this.roles.length}/50`).fontSize(11).fontColor($r('app.color.text_muted'))
            Blank()
            Text('命名后转写直接用名字，AI 总结也带角色卡').fontSize(11).fontColor($r('app.color.text_muted'))
          }.width('100%')
          if(this.editIndex>=0){
            Row({space:6}){
              TextInput({text:this.editName}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).fontSize(12).height(32).layoutWeight(2).onChange((value:string):void=>{this.editName=value;})
              TextInput({text:this.editBio}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).fontSize(12).height(32).layoutWeight(3).onChange((value:string):void=>{this.editBio=value;})
              Button('保存').chipBtn().fontSize(11).height(28).padding({left:9,right:9}).onClick(()=>this.saveVoice())
              Button('取消').fontSize(11).height(28).padding({left:9,right:9}).backgroundColor($r('app.color.border')).onClick(()=>{this.editIndex=-1;})
            }.width('100%')
            Text('名字 + 简介（如：老板/产品负责人），保存后该声纹归到这个角色').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
          }
          if(this.editId){
            Row({space:6}){
              TextInput({text:this.editName}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).fontSize(12).height(32).layoutWeight(2).onChange((value:string):void=>{this.editName=value;})
              TextInput({text:this.editBio}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).fontSize(12).height(32).layoutWeight(3).onChange((value:string)=>this.editBio=value)
              Button('保存').chipBtn().fontSize(11).height(28).padding({left:9,right:9}).onClick(()=>this.saveRole())
              Button('取消').fontSize(11).height(28).padding({left:9,right:9}).backgroundColor($r('app.color.border')).onClick(()=>{this.editId='';})
            }.width('100%')
          }
          ForEach(this.pendingVoices,(voice:LifelogSpeaker)=>{
            Row({space:8}){
              Text(`未命名声纹 ${voice.index+1}`).fontSize(12).fontColor($r('app.color.warm')).layoutWeight(1)
              Text(`${voice.samples} 句`).fontSize(11).fontColor($r('app.color.text_muted'))
              Button('命名').chipBtn().fontSize(11).height(24).padding({left:8,right:8}).onClick(()=>this.nameVoice(voice.index))
            }.width('100%')
          },(voice:LifelogSpeaker)=>`pv${voice.index}`)
          ForEach(this.roles,(role:VoiceRole)=>{
            Row({space:8}){
              Text(role.name).fontSize(12).fontColor($r('app.color.text_primary'))
              Text(role.bio||'（无简介）').fontSize(11).fontColor($r('app.color.text_muted')).layoutWeight(1).maxLines(1).textOverflow({overflow:TextOverflow.Ellipsis})
              Text(`${role.samples} 次`).fontSize(11).fontColor($r('app.color.text_muted'))
              Button('改名').chipBtn().fontSize(11).height(24).padding({left:8,right:8}).onClick(()=>this.nameRole(role))
              Button('删').fontSize(11).height(24).padding({left:8,right:8}).backgroundColor($r('app.color.danger_bg')).onClick(()=>this.removeRole(role))
            }.width('100%')
          },(role:VoiceRole)=>role.id)
          if(!this.roles.length&&!this.pendingVoices.length){Text('还没有声纹：先转写一段，识别出说话人后可在这里命名').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')}
        }.width('100%').padding(10).backgroundColor($r('app.color.card_bg_soft')).borderRadius(14)
  
    }.width('100%')
  }

  @Builder
  savedSummaryArea(){
    Column({space:6}){
      Text('已保存的每日总结').fontSize(13).fontColor($r('app.color.text_primary')).width('100%')
      Row({space:8}){
        Button('查看已保存').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.listSavedSummaries())
        if(this.savedSummaryPage?.has_more){Button('下一页').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.listSavedSummaries(true))}
        if(this.savedSummaryPage||this.savedSummaryDocument){Button('关闭总结').chipBtn().fontSize(11).height(28).onClick(()=>this.closeSavedSummaries())}
      }.width('100%')
      if(this.savedSummaryNote){Text(this.savedSummaryNote).fontSize(11).fontColor($r('app.color.text_secondary')).width('100%')}
      if(this.savedSummaryPage){
        Text(this.savedSummaryCoverage()).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
        ForEach(this.savedSummaryPage.items,(entry:SavedSummaryEntry)=>{
          Row({space:8}){
            Column({space:2}){
              Text(entry.file_kind==='day_cache'?'每日缓存':'已保存快照').fontSize(11).fontColor($r('app.color.text_secondary')).width('100%')
              Text(this.savedSummaryState(entry)).fontSize(11).fontColor(entry.can_open?$r('app.color.brand'):$r('app.color.warm')).width('100%')
            }.layoutWeight(1)
            if(entry.state==='current'&&entry.can_open){Button('打开').chipBtn().fontSize(11).height(26).enabled(!this.busy).onClick(()=>this.openSavedSummary(entry.reference))}
          }.width('100%').padding(8).backgroundColor($r('app.color.row_bg')).borderRadius(8)
        },(entry:SavedSummaryEntry)=>(this.savedSummaryPage?.snapshot_sha256||'')+':'+entry.reference.summary_id+':'+entry.reference.content_sha256)
      }
      if(this.savedSummaryDocument){
        Text('保存的总结 · 原文来源已核对（本次读取）').fontSize(11).fontColor($r('app.color.brand')).width('100%')
        Text(this.savedSummaryDocument.summary_text).fontSize(12).fontColor($r('app.color.text_primary')).copyOption(CopyOptions.LocalDevice).width('100%')
        Row({space:8}){
          Button('导出已保存总结').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.exportSavedSummary())
          Button('写人工附注').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.startSummaryNote())
        }.width('100%')
      }
    }.width('100%').padding(10).backgroundColor($r('app.color.card_bg_soft')).borderRadius(12).alignItems(HorizontalAlign.Start)
  }

  @Builder
  summaryNotesArea(){
    Column({space:6}){
      Text('人工附注').fontSize(13).fontColor($r('app.color.text_primary')).width('100%')
      Text('附注仅保存在本机，可导出；不会改写AI正文，也未同步给电脑Agent。').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
      Row({space:8}){
        Button('查看已存附注').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.listSummaryNotes())
        if(this.savedNotePage?.has_more){Button('下一页').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.listSummaryNotes(true))}
        if(this.savedNotePage||this.savedNoteDocument){Button('关闭附注').chipBtn().fontSize(11).height(28).onClick(()=>this.closeSavedNotes())}
      }.width('100%')
      if(this.savedNoteNote){Text(this.savedNoteNote).fontSize(11).fontColor($r('app.color.text_secondary')).width('100%')}
      if(this.savedNotePage){
        Text(this.noteCoverage()).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
        ForEach(this.savedNotePage.items,(receipt:JournalNoteReceipt)=>{
          Column({space:4}){
            Text(this.noteReceiptLabel(receipt)).fontSize(11).fontColor($r('app.color.text_secondary')).width('100%')
            Text(this.noteSavedTime(receipt.created_at)).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
            if(receipt.state==='saved'&&receipt.can_open&&receipt.reference){Button('打开附注').chipBtn().fontSize(11).height(26).enabled(!this.busy).onClick(()=>this.openSavedNote(receipt.reference as JournalNoteRef))}
            if(receipt.state==='pending'&&receipt.input_sha256){Button('恢复未完成附注').chipBtn().fontSize(11).height(26).enabled(!this.busy).onClick(()=>this.restorePendingNote(receipt.operation_id,receipt.input_sha256))}
          }.width('100%').padding(8).backgroundColor($r('app.color.row_bg')).borderRadius(8)
        },(receipt:JournalNoteReceipt)=>(this.savedNotePage?.snapshot_sha256||'')+':'+receipt.operation_id+':'+(receipt.reference?.content_sha256||receipt.input_sha256)+':'+receipt.state)
      }
      if(this.savedNoteDocument){
        Text('原AI总结（来源已核对）').fontSize(11).fontColor($r('app.color.brand')).width('100%')
        Text(this.savedNoteDocument.summary.summary_text).fontSize(12).fontColor($r('app.color.text_secondary')).copyOption(CopyOptions.LocalDevice).width('100%')
        Text('人工附注 · '+this.noteSavedTime(this.savedNoteDocument.record.created_at)+' · 仅本机').fontSize(11).fontColor($r('app.color.brand')).width('100%')
        Text(this.savedNoteDocument.record.text).fontSize(12).fontColor($r('app.color.text_primary')).copyOption(CopyOptions.LocalDevice).width('100%')
        Row({space:8}){
          Button('编辑为新版本').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.startSummaryNote(true))
          Button('导出MD').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.exportSummaryNote('md'))
          Button('导出JSON').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.exportSummaryNote('json'))
        }.width('100%')
      }
      if(this.noteEditorReady){
        Text('未提交的人工附注 · 绑定日期 '+this.noteEditorDay).fontSize(11).fontColor($r('app.color.warm')).width('100%')
        if(this.noteEditorLocked){
          Text(this.noteEditorText).fontSize(12).fontColor($r('app.color.text_primary')).copyOption(CopyOptions.LocalDevice).width('100%')
        }else{
          TextArea({text:this.noteEditorText,placeholder:'最多约8千字，超限保留原输入；不会替换AI正文'}).fontSize(12).height(150)
            .backgroundColor($r('app.color.input_bg')).fontColor($r('app.color.text_primary')).enabled(!this.busy).onChange((value:string):void=>this.changeNoteEditor(value))
        }
        Text(this.noteEditorNote).fontSize(11).fontColor($r('app.color.text_secondary')).width('100%')
        Row({space:8}){
          Button(this.noteEditorLocked?'核对后重试保存':'明确保存新版本').chipBtn().fontSize(11).height(28).enabled(!this.busy&&!!this.noteEditorText.trim()).onClick(()=>this.saveSummaryNote())
          if(this.noteEditorLocked){Button('核对保存状态').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.inspectSummaryNote())}
          Button('放弃过程输入').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.discardNoteEditor())
        }.width('100%')
        if(this.savedNoteReceipt&&this.savedNoteReceipt.operation_id===this.noteEditorOperation){
          Text(this.noteReceiptLabel(this.savedNoteReceipt)).fontSize(11).fontColor($r('app.color.text_secondary')).width('100%')
          if(this.savedNoteReceipt.state==='pending'){Button('续完这次保存').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.saveSummaryNote(true))}
        }
      }
    }.width('100%').padding(10).backgroundColor($r('app.color.card_bg_soft')).borderRadius(12).alignItems(HorizontalAlign.Start)
  }

  @Builder
  localSearchArea(){
    Column({space:6}){
      Text('查询选中日的本机文字').fontSize(13).fontColor($r('app.color.text_primary')).width('100%')
      TextInput({text:this.queryKeyword,placeholder:'关键词（可只填说话人）'}).fontSize(12).height(36).maxLength(200)
        .backgroundColor($r('app.color.input_bg')).fontColor($r('app.color.text_primary')).onChange((value:string):void=>this.changeQueryKeyword(value))
      TextInput({text:this.querySpeaker,placeholder:'本段说话人标签或 ID（可选）'}).fontSize(12).height(36).maxLength(80)
        .backgroundColor($r('app.color.input_bg')).fontColor($r('app.color.text_primary')).onChange((value:string):void=>this.changeQuerySpeaker(value))
      Row({space:8}){
        Button('查询').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.searchLocal())
        Button('清除查询').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.clearLocalSearch())
        if(this.queryPage?.has_more){Button('本窗口下一页').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.searchLocal(true))}
      }.width('100%')
      if(this.queryPage?.scan_has_more){Button('继续扫描后续资料').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.searchLocal(false,true))}
      if(this.queryNote){Text(this.queryNote).fontSize(11).fontColor($r('app.color.text_secondary')).width('100%')}
      if(this.queryPage){
        Text(this.queryCoverage()).fontSize(11).fontColor($r('app.color.warm')).width('100%')
        ForEach(this.queryPage.hits,(hit:LocalMaterialHit)=>{
          Column({space:4}){
            Text((hit.kind==='lifelog'?'全天智记':'录音')+' · '+this.queryHitLabel(hit)).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
            Text(hit.excerpt).fontSize(12).fontColor($r('app.color.text_primary')).copyOption(CopyOptions.LocalDevice).width('100%')
            Button('查看原文').chipBtn().fontSize(11).height(26).enabled(!this.busy).onClick(()=>this.openQueryReference(hit.reference))
          }.width('100%').padding(8).backgroundColor($r('app.color.row_bg')).borderRadius(8).alignItems(HorizontalAlign.Start)
        },(hit:LocalMaterialHit)=>(this.queryPage?.snapshot_sha256||'')+':'+hit.reference.content_sha256+':'+hit.reference.material_id+':'+hit.reference.revision.toString()+':'+hit.reference.utterance_id)
      }
    }.width('100%').padding(10).backgroundColor($r('app.color.card_bg_soft')).borderRadius(12).alignItems(HorizontalAlign.Start)
  }

  @Builder
  timelineArea(){
    Column({space:10}){
        // ---- 选中日时间线 ----
        Row({space:8}){
          Text(this.dayLabel(this.selected)).fontSize(15).fontColor($r('app.color.text_primary'))
          Text(`· ${this.dayEntries(this.selected).length} 条`).fontSize(11).fontColor($r('app.color.text_muted'))
          Blank()
          if(this.pendingCount(this.selected)>0){
            Button(`一键转写(${this.pendingCount(this.selected)})`).chipBtn().fontSize(11).height(28).padding({left:9,right:9}).enabled(!this.busy&&!this.transcribing).onClick(()=>this.transcribeDay(this.selected))
          }
          Button('汇总').chipBtn().fontSize(11).height(28).padding({left:9,right:9}).enabled(!this.busy).onClick(()=>this.exportDay(this.selected))
          Button('刷新').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.refreshEntries())
        }.width('100%')
        this.savedSummaryArea()
        this.summaryNotesArea()
        this.localSearchArea()
        this.playbackArea()
        if(this.queue>0){Row({space:10}){
          Text(`转写队列 ${this.queue} 条`).fontSize(11).fontColor($r('app.color.brand'))
          Button('队列状态').chipBtn().fontSize(11).height(24).padding({left:8,right:8}).onClick(()=>this.refresh())
          Text('按电量、温度和处理预算继续，原音保留').fontSize(11).fontColor($r('app.color.text_muted'))
        }.width('100%')}
        if(this.llEmpty>0){Row({space:8}){Text(`${this.llEmpty} 个空分段已隐藏`).fontSize(11).fontColor($r('app.color.text_muted'));Blank()
          Button('清理空段').chipBtn().fontSize(11).height(26).padding({left:9,right:9}).enabled(!this.busy).onClick(()=>this.run(async():Promise<void>=>{lifelog.purgeEmpty();this.refresh();}))}.width('100%')}
        if(!this.dayEntries(this.selected).length){Text('这一天没有记录').fontColor($r('app.color.text_muted')).fontSize(12).padding(10)}
        ForEach(this.dayEntries(this.selected),(row:JournalEntry)=>{
          Row({space:6}){
            Text(this.clock(row.created)).fontSize(12).fontColor($r('app.color.text_primary')).width(44)
            Text(row.kind==='lifelog'?'全天':'录音').fontSize(10).fontColor(row.kind==='lifelog'?$r('app.color.brand_soft'):$r('app.color.info'))
              .backgroundColor(row.kind==='lifelog'?$r('app.color.brand_deep'):$r('app.color.info_bg')).borderRadius(6).padding({left:5,right:5,top:1,bottom:1})
            Text(`${row.ended>row.created?this.durText((row.ended-row.created)/1000,row.bytes):this.sizeText(row.bytes)}${row.hasText?' · 已转写':''} · ${row.syncLabel}`)
              .fontSize(11).fontColor(row.hasText?$r('app.color.brand'):$r('app.color.warm')).layoutWeight(1).maxLines(1).textOverflow({overflow:TextOverflow.Ellipsis})
            Button('播放').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(row.bytes>0&&!this.busy).onClick(()=>this.playAudio(row.kind,row.lifelogItem?.name||row.recordingItem?.name||''))
            if(row.kind==='lifelog'&&row.lifelogItem){
              Button('音频').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(row.bytes>0&&!this.busy)
                .onClick(()=>this.run(async():Promise<void>=>{const item=row.lifelogItem as LifelogItem;
                  const kind=item.ogg?'ogg':item.wav?'wav':'raw';
                  const ok=await this.copyOut(lifelog.file(item,kind),`TurboIO-智记-${this.stamp(item.created)}.${kind==='ogg'?'ogg':kind==='wav'?'wav':'rawopus'}`);
                  this.note=ok?'已导出音频':'已取消导出';}))
              if(!row.hasText){Button('转写').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(!this.busy&&!this.llActive&&!this.transcribing).onClick(()=>this.transcribeEntry(row))}
              else{Button('文字').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(!this.busy).onClick(()=>this.viewText(row))}
            }else if(row.recordingItem){
              Button('WAV').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(row.recordingItem.complete&&!this.busy).onClick(()=>this.run(async():Promise<void>=>{
                const item=row.recordingItem as RecordingItem;
                const ok=await this.copyOut(recordings.file(item,true),`TurboIO-录音-${this.stamp(item.created)}.wav`);
                this.note=ok?'已导出 WAV':'已取消导出';}))
              if(!row.hasText){Button('转写').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(!this.busy).onClick(()=>this.transcribeEntry(row))}
              else{Button('文字').chipBtn().fontSize(11).height(26).padding({left:8,right:8}).enabled(!this.busy).onClick(()=>this.viewText(row))}
            }
            Button('删').fontSize(11).height(26).padding({left:8,right:8}).backgroundColor($r('app.color.danger_bg')).enabled(!this.busy).onClick(()=>this.confirmRemove(row))
            if(this.runningDir&&this.runningDir.endsWith('/'+row.key.slice(row.key.indexOf('-')+1))){
              Row({space:8}){Text('转写中').fontSize(11).fontColor($r('app.color.brand'));Progress({value:this.progress,total:100,type:ProgressType.Linear}).height(4).layoutWeight(1);Text(`${this.progress}%`).fontSize(11).fontColor($r('app.color.brand'))}.width('100%')
            } else if(this.isQueued(row)){
              Text('已排队，等待本机转写…').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
            }
          }.padding({left:10,right:6,top:4,bottom:4}).backgroundColor($r('app.color.row_bg_soft')).borderRadius(10).width('100%')
        },(row:JournalEntry)=>row.key)
        if(this.text){Column({space:6}){
          Row(){Text('文本').fontSize(11).fontColor($r('app.color.text_muted'));Blank();
            Button(this.fullText?'折叠全文':'展开全文').chipBtn().fontSize(11).height(24).onClick(()=>{this.fullText=!this.fullText;})
            Button('收起').chipBtn().fontSize(11).height(24).padding({left:8,right:8}).onClick(()=>this.closeText())
          }.width('100%')
          if(this.fullText){Text(this.text).fontColor($r('app.color.text_secondary')).fontSize(12).copyOption(CopyOptions.LocalDevice).width('100%')}
          else{Text(this.text).fontColor($r('app.color.text_secondary')).fontSize(12).copyOption(CopyOptions.LocalDevice).width('100%').maxLines(20).textOverflow({overflow:TextOverflow.Ellipsis})}
          if(this.textName){
            Row({space:8}){
              Button('导出MD').chipBtn().fontSize(11).height(26).enabled(!this.busy).onClick(()=>this.exportText('md'))
              Button('导出JSON').chipBtn().fontSize(11).height(26).enabled(!this.busy).onClick(()=>this.exportText('json'))
              if(this.textNeedsFull){Button('核对完整转写').chipBtn().fontSize(11).height(26).enabled(!this.busy&&!this.transcribing&&!this.llActive).onClick(()=>this.fullSelectedText())}
            }.width('100%')
            MaterialSpeakerEditor({kind:this.textKind,name:this.textName,revision:this.textRevision,onChanged:(row:MaterialRevision):void=>this.selectedMaterialChanged(row),onPlay:(part:MaterialUtterance,row:MaterialRevision):void=>this.playSentence(part,row)})
          }
        }.width('100%').padding(10).backgroundColor($r('app.color.row_bg')).borderRadius(12)}
    }.width('100%')
  }

  build(){
    Column({space:10}){
      Row(){Text('全天智记').fontSize(17).fontColor($r('app.color.text_primary'));Blank()
        Text(this.llPhase==='recording'?'录音中 · 智记保持开启':this.llPhase==='voice'?'AI 对话中 · 智记待命':this.llPhase==='stopping'?'正在收尾':this.llPhase==='receiving'?'● 正在收音':this.llPhase==='waiting-wake'?'◌ 等待眼镜唤醒':this.llPhase==='waiting-audio'?'◌ 等待音频':this.llDay?'◌ 等待连接':'○ 未开启').fontSize(12).fontColor(this.llActive?$r('app.color.brand'):$r('app.color.text_secondary'))
        Text(`${Math.round(this.llBytes/1024)} KB`).fontSize(12).fontColor($r('app.color.text_muted')).margin({left:10})
      }.width('100%')
      Text(this.llNote).fontSize(12).fontColor($r('app.color.text_secondary')).width('100%').maxLines(2)
      Row({space:8}){
        Button(this.llDay?'关闭全天模式':'开启全天智记').fontSize(12).height(34).layoutWeight(1)
          .backgroundColor(this.llDay?$r('app.color.border'):$r('app.color.brand')).fontColor(this.llDay?$r('app.color.text_primary'):$r('app.color.on_brand'))
          .enabled(!this.busy&&this.connected&&!this.llPendingWrites&&(this.llDay||(!this.llCleanup&&!this.recCleanup&&!this.llActive&&!this.recActive)))
          .onClick(()=>this.run(async():Promise<void>=>{if(this.llDay)await lifelog.stopDay();else await lifelog.start('day');this.note=lifelog.note;}))
        Button(this.recStopping?'录音收尾中':this.recActive?'结束录音':'开始录音').fontSize(12).height(34).layoutWeight(1)
          .backgroundColor(this.recActive?$r('app.color.danger_bg'):$r('app.color.brand')).fontColor($r('app.color.on_brand'))
          .enabled(!this.busy&&!this.recStopping&&(!this.recCleanup||this.recActive)&&(!this.llCleanup||this.llActive)&&this.connected&&this.llPhase!=='stopping')
          .onClick(()=>this.run(async():Promise<void>=>{if(recordings.active)await recordings.stop();else await recordings.start();this.note=recordings.note;}))
      }.width('100%')
      if(this.llCleanup&&!this.llActive){Button('清理上次智记退出').chipBtn().width('100%').enabled(!this.busy&&this.connected&&!this.llPendingWrites).onClick(()=>this.run(()=>lifelog.cleanup()))}
      if(this.llCanConfirmCleanup){Button('我已确认智记退出').chipBtn().width('100%').enabled(!this.busy&&!this.llPendingWrites).onClick(()=>this.confirmLifelogExit())}
      Text('录音可插入智记；确认原眼镜退出并完成本机封口后才交接或恢复。退出未确认时保留记录。录音和智记原音默认保留，需主动删除；转写文字长期保留。').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
      Row({space:8}){
        Toggle({type:ToggleType.Switch,isOn:this.schOn}).selectedColor($r('app.color.brand')).width(44).height(24).enabled(!this.busy).onChange((value:boolean):void=>{this.schOn=value;})
        Text('定时').fontSize(12).fontColor($r('app.color.text_secondary'))
        TextInput({text:this.schStart}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).fontSize(12).width(62).height(32).enabled(!this.busy).onChange((value:string):void=>{this.schStart=value;})
        Text('–').fontSize(12).fontColor($r('app.color.text_secondary'))
        TextInput({text:this.schEnd}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).fontSize(12).width(62).height(32).enabled(!this.busy).onChange((value:string):void=>{this.schEnd=value;})
        Blank()
        Button('保存').chipBtn().fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.run(async():Promise<void>=>{await lifelog.applySchedule(this.schOn,this.schStart,this.schEnd);this.syncSchedule();}))
      }.width('100%')
      Row({space:8}){
        Toggle({type:ToggleType.Switch,isOn:this.schAuto}).selectedColor($r('app.color.brand')).width(44).height(24).enabled(!this.busy).onChange((value:boolean):void=>{this.schAuto=value;lifelog.setAutoTranscribe(value);})
        Text('自动转写').fontSize(12).fontColor($r('app.color.text_secondary'))
        Blank()
        Text(this.schAuto?'每段封口后自动本机转写':'关闭：需手动点「转写」').fontSize(11).fontColor($r('app.color.text_muted'))
      }.width('100%')
      if(this.transcribing){Row({space:10}){Text(`本地转写 ${this.progress}%`).fontSize(12).fontColor($r('app.color.brand'));Text('VAD 剔除静音后只识别有效语音').fontSize(11).fontColor($r('app.color.text_muted'))}.width('100%')}

      MaterialSyncPanel({onChanged:():void=>this.refresh()})

      if(this.wide){
        Row({space:12}){
          Column({space:10}){
            this.calendarArea()
            this.rolesArea()
          }.layoutWeight(1)
          Column({space:10}){
            this.timelineArea()
          }.layoutWeight(1.25)
        }.width('100%').alignItems(VerticalAlign.Top)
      } else {
        this.calendarArea()
        this.rolesArea()
        this.timelineArea()
      }
    }.padding(16).width('100%').backgroundColor($r('app.color.input_bg_soft')).borderRadius(22).alignItems(HorizontalAlign.Start)
    .onAreaChange((_old: Area, now: Area): void => { const w = Number(now.width); if (w > 0) this.wide = w >= 560; })
  }
}
