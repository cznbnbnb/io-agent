import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';

export class SavedSummaryBase {markdown:string='';total:number=0;transcribed:number=0;}
export class SavedSummaryFilter {day:string='';limit:number=10;cursor:string='';}
export class SavedSummaryRef {day:string='';summary_id:string='';content_sha256:string='';}
export class SavedSummaryEntry {
  reference:SavedSummaryRef=new SavedSummaryRef();file_kind:string='';bytes:number=0;state:string='';source_sha256:string='';
  can_open:boolean=false;producer:string='unknown';generated_at:string='';
}
export class SavedSummaryPage {
  schema:number=1;scope:string='local_saved_journals';day:string='';items:SavedSummaryEntry[]=[];next_cursor:string='';has_more:boolean=false;
  snapshot_sha256:string='';scanned:number=0;unreadable:number=0;incomplete:boolean=false;incomplete_reason:string='';
}
export class SavedSummaryDocument {
  schema:number=1;reference:SavedSummaryRef=new SavedSummaryRef();source_sha256:string='';markdown:string='';summary_text:string='';
  total:number=0;transcribed:number=0;producer:string='unknown';generated_at:string='';
}
export class SavedSummaryChunk {
  schema:number=1;reference:SavedSummaryRef=new SavedSummaryRef();source_sha256:string='';markdown:string='';offset:number=0;next_offset:number=0;
  total_utf16:number=0;has_more:boolean=false;
}
export interface SavedJournalSummaryPorts {root:()=>string;current:(dayStart:number)=>SavedSummaryBase;}
class SavedFile {
  bytes:number=0;sha256:string='';markdown:string='';state:string='unreadable';limited:boolean=false;
}
class CurrentBase {
  base:SavedSummaryBase=new SavedSummaryBase();sha256:string='';available:boolean=false;limited:boolean=false;
}
class SummaryCheck {state:string='';source_sha256:string='';summary:string='';}
const FILE_BYTES:number=8*1024*1024;
const TEXT_UNITS:number=2*1024*1024;
const LIST_UNITS:number=4*1024*1024;
const SCAN_COUNT:number=128;

export function savedSummaryDayStart(day:string):number{
  if(typeof day!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day))throw new Error('SAVED_SUMMARY_INVALID');
  const year=Number(day.slice(0,4)),month=Number(day.slice(5,7)),date=Number(day.slice(8,10));
  if(year<1970||year>9999||month<1||month>12||date<1||date>31)throw new Error('SAVED_SUMMARY_INVALID');
  const value=new Date(year,month-1,date);
  if(!Number.isSafeInteger(value.getTime())||value.getFullYear()!==year||value.getMonth()!==month-1||value.getDate()!==date||
    value.getHours()!==0||value.getMinutes()!==0||value.getSeconds()!==0||value.getMilliseconds()!==0)throw new Error('SAVED_SUMMARY_INVALID');
  return value.getTime();
}
function hash(bytes:Uint8Array):string{
  const md=cryptoFramework.createMd('SHA256');md.updateSync({data:bytes});const digest=md.digestSync().data;
  try{return Array.from(digest).map((value:number):string=>value.toString(16).padStart(2,'0')).join('');}finally{digest.fill(0);}
}
function textHash(text:string):string{const bytes=new util.TextEncoder().encodeInto(text);try{return hash(bytes);}finally{bytes.fill(0);}}
function unicodeValid(text:string):boolean{
  for(let at=0;at<text.length;at++){const code=text.charCodeAt(at);
    if(code>=0xd800&&code<=0xdbff){const next=text.charCodeAt(++at);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(code>=0xdc00&&code<=0xdfff)return false;
  }return true;
}
// Count before decoding so the aggregate list budget cannot be bypassed by
// first decoding an extra large artifact. Reject overlong/surrogate UTF-8.
function utf8Units(bytes:Uint8Array):number{
  let units=0;
  for(let at=0;at<bytes.length;){const first=bytes[at];let width=0;
    if(first<=0x7f)width=1;else if(first>=0xc2&&first<=0xdf)width=2;
    else if(first>=0xe0&&first<=0xef)width=3;else if(first>=0xf0&&first<=0xf4)width=4;else return -1;
    if(at+width>bytes.length)return -1;
    for(let index=1;index<width;index++)if(bytes[at+index]<0x80||bytes[at+index]>0xbf)return -1;
    if((first===0xe0&&bytes[at+1]<0xa0)||(first===0xed&&bytes[at+1]>=0xa0)||
      (first===0xf0&&bytes[at+1]<0x90)||(first===0xf4&&bytes[at+1]>=0x90))return -1;
    units+=width===4?2:1;at+=width;
  }return units;
}
function filterValid(filter:SavedSummaryFilter):void{
  if(!filter||Object.keys(filter).length!==3||Object.keys(filter).some((key:string):boolean=>!['day','limit','cursor'].includes(key))||
    !Number.isSafeInteger(filter.limit)||filter.limit<1||filter.limit>10||typeof filter.cursor!=='string'||
    (filter.cursor!==''&&(!/^[a-f0-9]{64}:(0|[1-9][0-9]*)$/.test(filter.cursor)||filter.cursor.length>81||!Number.isSafeInteger(Number(filter.cursor.slice(65))))))throw new Error('SAVED_SUMMARY_INVALID');
  savedSummaryDayStart(filter.day);
}
function referenceValid(reference:SavedSummaryRef):void{
  if(!reference||Object.keys(reference).length!==3||Object.keys(reference).some((key:string):boolean=>!['day','summary_id','content_sha256'].includes(key))||
    typeof reference.summary_id!=='string'||typeof reference.content_sha256!=='string'||!/^[a-f0-9]{64}$/.test(reference.content_sha256))throw new Error('SAVED_SUMMARY_INVALID');
  savedSummaryDayStart(reference.day);const prefix='saved-'+reference.day+'-';
  if(!reference.summary_id.startsWith(prefix)||(reference.summary_id.slice(prefix.length)!=='cache'&&!/^[a-f0-9]{64}$/.test(reference.summary_id.slice(prefix.length))))throw new Error('SAVED_SUMMARY_INVALID');
}
function cloneRef(reference:SavedSummaryRef):SavedSummaryRef{
  const out=new SavedSummaryRef();out.day=reference.day;out.summary_id=reference.summary_id;out.content_sha256=reference.content_sha256;return out;
}
function fileName(reference:SavedSummaryRef):string{
  const suffix=reference.summary_id.slice(('saved-'+reference.day+'-').length);return 'day-'+reference.day+(suffix==='cache'?'':'-'+suffix)+'.md';
}
function membershipHash(names:string[]):string{
  const md=cryptoFramework.createMd('SHA256');
  const domain=new util.TextEncoder().encodeInto('saved-journal-membership-v1\n');try{md.updateSync({data:domain});}finally{domain.fill(0);}
  for(const name of names){const bytes=new util.TextEncoder().encodeInto(name+'\n');try{md.updateSync({data:bytes});}finally{bytes.fill(0);}}
  const digest=md.digestSync().data;try{return Array.from(digest).map((value:number):string=>value.toString(16).padStart(2,'0')).join('');}finally{digest.fill(0);}
}

export class SavedJournalSummary {
  private ports:SavedJournalSummaryPorts;
  constructor(ports:SavedJournalSummaryPorts){this.ports=ports;}
  list(filter:SavedSummaryFilter):SavedSummaryPage{
    filterValid(filter);const page=new SavedSummaryPage();page.day=filter.day;const entries:SavedSummaryEntry[]=[];
    let root='',names:string[]=[];const facts:string[]=[filter.day];
    try{root=this.root();const listed=fs.listFileSync(root);if(!Array.isArray(listed)||listed.some((name:string):boolean=>typeof name!=='string'))throw new Error('list');
      const cache='day-'+filter.day+'.md',snapshotPrefix='day-'+filter.day+'-';
      names=listed.filter((name:string):boolean=>name===cache||(name.startsWith(snapshotPrefix)&&/^[a-f0-9]{64}\.md$/.test(name.slice(snapshotPrefix.length))));
      names.sort((a:string,b:string):number=>a===cache?-1:b===cache?1:a<b?-1:a>b?1:0);
    }catch(error){root='';names=[];page.incomplete=true;page.incomplete_reason='unreadable';page.unreadable=1;facts.push('list_unavailable');}
    const current=root?this.current(filter.day):new CurrentBase();
    if(!current.available){page.incomplete=true;if(!page.incomplete_reason)page.incomplete_reason=current.limited?'text_limit':'source_unavailable';}
    if(current.limited)page.incomplete_reason='text_limit';
    facts.push(current.available?'current:'+current.sha256+':'+current.base.total.toString()+':'+current.base.transcribed.toString():current.limited?'current_text_limit':'source_unavailable');
    facts.push('membership:'+names.length.toString()+':'+membershipHash(names));
    if(names.length>SCAN_COUNT){page.incomplete=true;if(page.incomplete_reason!=='text_limit')page.incomplete_reason='scan_limit';}
    let consumed=0;
    for(const name of names.slice(0,SCAN_COUNT)){
      page.scanned++;const file=this.read(root+'/'+name,Math.min(TEXT_UNITS,LIST_UNITS-consumed));
      const entry=this.entry(filter.day,name,file,current);entries.push(entry);
      facts.push(JSON.stringify([entry.reference.summary_id,file.sha256,file.bytes,entry.state,file.limited]));
      if(file.state==='unreadable'){page.unreadable++;page.incomplete=true;if(!page.incomplete_reason)page.incomplete_reason='unreadable';}
      if(file.limited){page.incomplete=true;page.incomplete_reason='text_limit';break;}
      if(file.state==='decoded')consumed+=file.markdown.length;
    }
    page.snapshot_sha256=textHash(JSON.stringify(facts));let offset=0;
    if(filter.cursor){offset=Number(filter.cursor.slice(65));if(filter.cursor.slice(0,64)!==page.snapshot_sha256||offset>entries.length)throw new Error('SAVED_SUMMARY_STALE');}
    page.items=entries.slice(offset,offset+filter.limit);page.has_more=offset+page.items.length<entries.length;
    if(page.has_more)page.next_cursor=page.snapshot_sha256+':'+(offset+page.items.length).toString();return page;
  }
  open(reference:SavedSummaryRef):SavedSummaryDocument{
    referenceValid(reference);
    try{
      const root=this.root(),name=fileName(reference),file=this.read(root+'/'+name,TEXT_UNITS);
      if(file.state!=='decoded'||file.sha256!==reference.content_sha256)throw new Error('stale');
      const current=this.current(reference.day),entry=this.entry(reference.day,name,file,current);
      if(!entry.can_open)throw new Error('stale');const checked=this.check(reference.day,name,file,current);
      const out=new SavedSummaryDocument();out.reference=cloneRef(reference);out.source_sha256=checked.source_sha256;out.markdown=file.markdown;
      out.summary_text=checked.summary;out.total=current.base.total;out.transcribed=current.base.transcribed;return out;
    }catch(error){throw new Error('SAVED_SUMMARY_STALE');}
  }
  chunk(reference:SavedSummaryRef,offset:number,maxChars:number):SavedSummaryChunk{
    referenceValid(reference);
    if(!Number.isSafeInteger(offset)||offset<0||offset>TEXT_UNITS||!Number.isSafeInteger(maxChars)||maxChars<2||maxChars>4000)throw new Error('SAVED_SUMMARY_INVALID');
    const document=this.open(reference),text=document.markdown;
    if(offset>text.length||(offset>0&&offset<text.length&&text.charCodeAt(offset)>=0xdc00&&text.charCodeAt(offset)<=0xdfff&&
      text.charCodeAt(offset-1)>=0xd800&&text.charCodeAt(offset-1)<=0xdbff))throw new Error('SAVED_SUMMARY_INVALID');
    let end=Math.min(text.length,offset+maxChars);
    if(end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--;
    const out=new SavedSummaryChunk();out.reference=cloneRef(document.reference);out.source_sha256=document.source_sha256;out.markdown=text.slice(offset,end);
    out.offset=offset;out.next_offset=end;out.total_utf16=text.length;out.has_more=end<text.length;return out;
  }
  private root():string{
    const root=this.ports.root();
    if(typeof root!=='string'||!root.trim()||root!==root.trim()||/^[\\/]+$/.test(root)||/^[A-Za-z]:[\\/]*$/.test(root)||
      (!root.startsWith('/')&&!/^[A-Za-z]:[\\/]/.test(root))||root.split(/[\\/]/).some((part:string):boolean=>part==='.'||part==='..')||/[\u0000-\u001f\u007f]/.test(root))throw new Error('root');
    const stat=fs.lstatSync(root);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('root');return root;
  }
  private current(day:string):CurrentBase{
    const out=new CurrentBase();
    try{const base=this.ports.current(savedSummaryDayStart(day));
      if(!base||typeof base.markdown!=='string'||!Number.isSafeInteger(base.total)||base.total<0||!Number.isSafeInteger(base.transcribed)||base.transcribed<0||base.transcribed>base.total)throw new Error('source');
      if(base.markdown.length>TEXT_UNITS){out.limited=true;return out;}
      if(!unicodeValid(base.markdown)||!base.markdown.startsWith('# '+day+' 记录\n'))throw new Error('source');
      out.base.markdown=base.markdown;out.base.total=base.total;out.base.transcribed=base.transcribed;out.sha256=textHash(base.markdown);out.available=true;
    }catch(error){}return out;
  }
  private read(path:string,textLimit:number):SavedFile{
    const out=new SavedFile();let bytes:Uint8Array|undefined=undefined;
    try{
      const stat=fs.lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<0)throw new Error('file');out.bytes=stat.size;
      if(stat.size>FILE_BYTES){out.limited=true;return out;}
      bytes=new Uint8Array(stat.size);const file=fs.openSync(path,fs.OpenMode.READ_ONLY);
      try{
        if(fs.statSync(file.fd).size!==stat.size)throw new Error('changed');let at=0;
        while(at<bytes.length){const buffer=new Uint8Array(Math.min(16384,bytes.length-at));try{
          const count=fs.readSync(file.fd,buffer.buffer,{length:buffer.length});if(!Number.isSafeInteger(count)||count<1||count>buffer.length)throw new Error('read');bytes.set(buffer.subarray(0,count),at);at+=count;
        }finally{buffer.fill(0);}}
        const extra=new Uint8Array(1);try{if(fs.readSync(file.fd,extra.buffer,{length:1})!==0)throw new Error('changed');}finally{extra.fill(0);}
        const final=fs.lstatSync(path);if(final.isSymbolicLink()||!final.isFile()||final.size!==stat.size||fs.statSync(file.fd).size!==stat.size)throw new Error('changed');
      }finally{fs.closeSync(file);}
      out.sha256=hash(bytes);const units=utf8Units(bytes);if(units<0){out.state='corrupt';return out;}
      if(units>textLimit){out.limited=true;return out;}
      const text=new util.TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decodeToString(bytes);const encoded=new util.TextEncoder().encodeInto(text);
      try{if(text.length!==units||!unicodeValid(text)||encoded.length!==bytes.length||encoded.some((value:number,index:number):boolean=>value!==bytes?.[index])){out.state='corrupt';return out;}}
      finally{encoded.fill(0);}
      out.markdown=text;out.state='decoded';return out;
    }catch(error){return out;}finally{bytes?.fill(0);}
  }
  private entry(day:string,name:string,file:SavedFile,current:CurrentBase):SavedSummaryEntry{
    const out=new SavedSummaryEntry();out.reference.day=day;out.reference.summary_id='saved-'+day+'-'+(name==='day-'+day+'.md'?'cache':name.slice(('day-'+day+'-').length,-3));
    out.reference.content_sha256=file.sha256;out.file_kind=name==='day-'+day+'.md'?'day_cache':'snapshot';out.bytes=file.bytes;
    const checked=this.check(day,name,file,current);out.state=checked.state;out.source_sha256=checked.source_sha256;out.can_open=checked.state==='current';return out;
  }
  private check(day:string,name:string,file:SavedFile,current:CurrentBase):SummaryCheck{
    const out=new SummaryCheck();out.state=file.state==='corrupt'?'corrupt':'unreadable';if(file.state!=='decoded')return out;
    if(name!=='day-'+day+'.md'&&name!==('day-'+day+'-'+file.sha256+'.md')){out.state='corrupt';return out;}
    const top=/^# ([0-9]{4}-[0-9]{2}-[0-9]{2})(?:[ \t]+[^\r\n]*)?(?:\r?\n|$)/.exec(file.markdown);
    if(!top||top[1]!==day){out.state='corrupt';return out;}
    if(current.available&&file.markdown===current.base.markdown){out.state='not_summary';return out;}
    const at=file.markdown.indexOf('\n## '),block=at<0?'':file.markdown.slice(at);
    const marker=/^\n## AI 总结\n\n- 总结来源指纹：sha256:([a-f0-9]{64})\n\n/.exec(block);
    if(marker)out.source_sha256=marker[1];
    if(!current.available){out.state='source_unavailable';return out;}
    if(!block.startsWith('\n## AI 总结\n')){out.state='not_summary';return out;}
    if(!marker){out.state='unverifiable';return out;}
    if(marker[1]!==current.sha256){out.state='stale';return out;}
    const baseAt=current.base.markdown.indexOf('\n## '),prefix=baseAt<0?current.base.markdown:current.base.markdown.slice(0,baseAt),suffix=baseAt<0?'':current.base.markdown.slice(baseAt);
    const beginning=prefix+'\n## AI 总结\n\n- 总结来源指纹：sha256:'+current.sha256+'\n\n';
    if(!file.markdown.startsWith(beginning)||!file.markdown.endsWith(suffix)||file.markdown.length<=beginning.length+suffix.length){out.state='corrupt';return out;}
    const middle=file.markdown.slice(beginning.length,file.markdown.length-suffix.length);
    if(!middle.endsWith('\n')){out.state='corrupt';return out;}const summary=middle.slice(0,-1);
    if(!summary.trim()||summary!==summary.trim()){out.state='corrupt';return out;}
    out.state='current';out.summary=summary;return out;
  }
}
