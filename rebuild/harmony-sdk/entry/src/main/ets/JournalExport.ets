// 当日汇总的构造与落盘：把全天智记分段与本机录音合并成一份带绝对时间轴的 Markdown。
// 「智记」页的导出按钮和每日自动上传共用这里的逻辑，保证两边内容一致。
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { LifelogItem, LifelogSession, LifelogUtteranceRow, LifelogDayText } from './LifelogSession';
import { RecordingItem } from './RecordingSession';
import { MaterialRevision, renderMaterialTranscript } from './MaterialStore';

export class JournalSources {
  lifelogRoot:string='';
  lifelogItems:LifelogItem[]=[];
  recordingItems:RecordingItem[]=[];
  transcriptJson:(item:LifelogItem)=>string=():string=>'';
  recordingText:(item:RecordingItem)=>string=():string=>'';
  material:(kind:string,name:string)=>MaterialRevision|undefined=():MaterialRevision|undefined=>undefined;
}

export class JournalEntryRef {
  kind:string='lifelog';           // lifelog | recording
  key:string='';
  created:number=0;
  ended:number=0;
  bytes:number=0;
  hasText:boolean=false;
  lifelogItem:LifelogItem|undefined=undefined;
  recordingItem:RecordingItem|undefined=undefined;
}

export function journalEntries(dayStart:number,sources:JournalSources):JournalEntryRef[]{
  const end=dayStart+86400000;
  const rows:JournalEntryRef[]=[];
  for(const item of sources.lifelogItems){
    if(item.created<dayStart||item.created>=end)continue;
    const row=new JournalEntryRef();row.kind='lifelog';row.key='lifelog-'+item.name;row.created=item.created;row.ended=item.ended;
    row.bytes=item.bytes;row.hasText=item.hasText;row.lifelogItem=item;rows.push(row);
  }
  for(const item of sources.recordingItems){
    if(item.created<dayStart||item.created>=end)continue;
    const row=new JournalEntryRef();row.kind='recording';row.key='recording-'+item.name;row.created=item.created;
    row.bytes=item.bytes;row.hasText=!!item.textFile;row.recordingItem=item;rows.push(row);
  }
  return rows.sort((a:JournalEntryRef,b:JournalEntryRef):number=>a.created-b.created);
}

function clock(ms:number):string{const d=new Date(ms);const p=(n:number):string=>n<10?'0'+n:''+n;return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}
function stamp(ms:number):string{const d=new Date(ms);const p=(n:number):string=>n<10?'0'+n:''+n;return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;}

export function buildJournalDay(dayStart:number,sources:JournalSources,summary:string):LifelogDayText{
  const list=journalEntries(dayStart,sources);
  let transcribed=0,seconds=0,speech=0,unknownDuration=0;
  const lines:string[]=[];
  for(const row of list){
    const material=sources.material(row.kind,row.lifelogItem?.name||row.recordingItem?.name||'');
    const started=material?material.source.started:row.created,ended=material?material.source.ended:row.ended;
    const knownDuration=Number.isSafeInteger(started)&&Number.isSafeInteger(ended)&&ended>=started&&
      (ended>started||(material?.source.complete===true&&material.source.audioFrames===0));
    const duration=knownDuration?(ended-started)/1000:0;
    if(knownDuration)seconds+=duration;else unknownDuration++;
    const kind=row.kind==='lifelog'?'全天智记':'本机录音';
    lines.push('');
    lines.push(`## ${clock(started)}${knownDuration&&ended>started?'–'+clock(ended):''}　${kind}${knownDuration?`（${Math.round(duration)}秒）`:'（时长未知）'}`);
    lines.push('');
    let body='';let completeText=true;let unknownCoverage=false,pendingSpeaker=false,unverifiedBoundary=false;
    if(material){
      lines.push(`- 来源资料：${material.material_id}；资料修订：${material.revision}；文字修订：${material.text_revision}`);
      if(material.source.audioAvailable===false)lines.push('- 原音当前不可用；文字仍可查看和导出');
    }else lines.push(`- 来源记录：${row.key}；旧资料尚无资料修订`);
    if(material?.operation==='delete'){lines.push('-（资料已删除）');continue;}
    if(material&&material.text.trim()){
      body=renderMaterialTranscript(material);completeText=material.transcription_state==='complete';
      unknownCoverage=material.transcription_state===undefined||material.transcription_state==='unknown';
      pendingSpeaker=material.speaker_processing==='pending';unverifiedBoundary=material.boundary_processing==='unverified';
      if(material.utterances.some((part):boolean=>part.source_range!==undefined))body+='\n-（人工拆句仅引用父句原音范围，句内时间未确定）';
      if(material.speakers?.some((speaker):boolean=>speaker.label_basis==='role_match'))body+='\n-（角色匹配是候选，姓名和“我”的身份未经确认）';
    }else if(!material&&row.kind==='lifelog'&&row.lifelogItem){
      try{
        const parsed=JSON.parse(sources.transcriptJson(row.lifelogItem)) as Record<string,Object>;
        completeText=parsed['transcription_complete']!==false;
        unknownCoverage=parsed['transcription_state']==='unknown';if(unknownCoverage)completeText=false;
        pendingSpeaker=parsed['speaker_processing']==='pending'||parsed['speakerProcessing']==='pending';
        const boundary=(parsed['boundary_processing']||parsed['boundaryProcessing']) as string;
        const windowed=parsed['windowed']===true||typeof parsed['covered_frames']==='number';
        unverifiedBoundary=boundary==='unverified'||(windowed&&!['token_starts','no_speech'].includes(boundary));
        const rows=parsed['utterances'] as LifelogUtteranceRow[];
        if(rows&&rows.length){
          let segmentSpeech=0;
          for(const part of rows){
            const at=row.created+Math.round(part.start*1000);
            segmentSpeech+=Math.max(0,part.end-part.start);
            const who=part.speaker>=0?`说话人${part.speaker+1}　`:'';
            body+=`- **[${clock(at)}]** ${who}${part.text}\n`;
          }
          speech+=segmentSpeech;
        }
      }catch(_){body='';}
    }else if(!material&&row.recordingItem){
      try{body=sources.recordingText(row.recordingItem).trim()+'\n';}catch(_){body='';}
    }
    if(body){
      if(completeText)transcribed++;lines.push(body.trimEnd());
      if(unknownCoverage)lines.push('-（文字已保存，覆盖范围尚未核实）');else if(!completeText)lines.push('-（已有部分文字，剩余音频仍在处理）');
      if(pendingSpeaker)lines.push('-（说话人分析待处理，当前文字归属未确认）');
      if(unverifiedBoundary)lines.push('-（窗口边界未核实，跨窗语句可能重复或缺失）');
    }
    else lines.push(material?'-（当前资料修订暂无文字）':row.kind==='lifelog'?'-（本段尚未转写：在「智记」页点「转写」）':'-（这条录音尚未转写：在「录音」页点「转写」）');
  }
  const lifelogCount=list.filter((r:JournalEntryRef):boolean=>r.kind==='lifelog').length;
  const durationLabel=unknownDuration===list.length&&list.length>0?'未知':journalDuration(seconds)+(unknownDuration?`（另${unknownDuration}条时长未知）`:'');
  const head:string[]=[`# ${stamp(dayStart)} 记录`,'',
    `- 共 ${list.length} 条（全天智记 ${lifelogCount} · 录音 ${list.length-lifelogCount}）· 录音总时长 ${durationLabel} · 有内容 ${transcribed}/${list.length} 条`,
    `- 眼镜收音 → 本机 OGG 存储 → 本机离线转写（VAD 剔除静音）；文本可能含识别错误`];
  if(summary)head.push('','## AI 总结','',summary);
  const out=new LifelogDayText();
  out.markdown=head.concat(lines).join('\n')+'\n';out.transcribed=transcribed;out.total=list.length;
  return out;
}

export function dayStamp(dayStart:number):string{return stamp(dayStart);}

export function writeJournalFile(root:string,dayStart:number,markdown:string):string{
  const path=`${root}/day-${stamp(dayStart)}.md`;
  const body=new util.TextEncoder().encodeInto(markdown);
  const file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
  try{
    let off=0;while(off<body.length){const n=fs.writeSync(file.fd,body.slice(off).buffer);if(n<=0)throw new Error('汇总写入不完整');off+=n;}
    fs.fsyncSync(file.fd);
  }finally{fs.closeSync(file);body.fill(0);}
  fs.renameSync(path+'.partial',path);return path;
}

function journalDigest(text:string):string{
  const bytes=new util.TextEncoder().encodeInto(text);const md=cryptoFramework.createMd('SHA256');
  try{md.updateSync({data:bytes});const digest=md.digestSync().data;
    const result=Array.from(digest).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');digest.fill(0);return result;
  }finally{bytes.fill(0);}
}
export function assertJournalSnapshotCurrent(base:LifelogDayText,current:LifelogDayText):void{
  if(base.markdown!==current.markdown||base.total!==current.total||base.transcribed!==current.transcribed)
    throw new Error('当日资料已变化，请重新生成总结；旧结果未保存');
}
// This provenance is a local Markdown artifact, not a new server wire format.
export function bindJournalSummary(base:LifelogDayText,current:LifelogDayText,summary:string):LifelogDayText{
  assertJournalSnapshotCurrent(base,current);
  if(!summary.trim())throw new Error('模型未返回总结内容');
  const out=new LifelogDayText();out.total=base.total;out.transcribed=base.transcribed;
  const block='\n## AI 总结\n\n- 总结来源指纹：sha256:'+journalDigest(base.markdown)+'\n\n'+summary.trim()+'\n';
  const at=base.markdown.indexOf('\n## ');
  out.markdown=at>=0?base.markdown.slice(0,at)+block+base.markdown.slice(at):base.markdown+block;
  return out;
}
// The picker awaits before opening its source. Never hand it the mutable day
// cache: independent snapshots are content-addressed and never overwritten.
export function writeJournalSnapshot(root:string,dayStart:number,markdown:string):string{
  const path=`${root}/day-${stamp(dayStart)}-${journalDigest(markdown)}.md`;
  if(fs.accessSync(path)){
    if(fs.readTextSync(path)!==markdown)throw new Error('汇总快照内容冲突，原文件保留');
    return path;
  }
  const bytes=new util.TextEncoder().encodeInto(markdown);
  const file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
  try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('汇总快照写入不完整');offset+=n;}fs.fsyncSync(file.fd);}
  finally{fs.closeSync(file);bytes.fill(0);}
  fs.renameSync(path+'.partial',path);return path;
}

export function journalDuration(seconds:number):string{
  if(!Number.isFinite(seconds)||seconds<0)return '未知';
  const value=Math.round(seconds),hours=Math.floor(value/3600),minutes=Math.floor(value%3600/60),rest=value%60;
  const p=(n:number):string=>n.toString().padStart(2,'0');return p(hours)+':'+p(minutes)+':'+p(rest);
}
