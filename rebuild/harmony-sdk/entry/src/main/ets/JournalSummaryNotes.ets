import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { SavedJournalSummary,SavedSummaryRef,SavedSummaryDocument,savedSummaryDayStart } from './SavedJournalSummary';

export class JournalNoteRef {day:string='';note_id:string='';content_sha256:string='';}
export class JournalNoteInput {
  operation_id:string='';parent:SavedSummaryRef=new SavedSummaryRef();source_sha256:string='';text:string='';previous:JournalNoteRef|undefined=undefined;
}
export class JournalNoteRecord {
  schema:number=1;day:string='';operation_id:string='';parent:SavedSummaryRef=new SavedSummaryRef();origin:SavedSummaryRef=new SavedSummaryRef();
  source_sha256:string='';input_sha256:string='';text:string='';created_at:string='';producer:string='user_note';previous:JournalNoteRef|undefined=undefined;
}
export class JournalNoteReceipt {
  schema:number=1;operation_id:string='';state:string='';input_sha256:string='';reference:JournalNoteRef|undefined=undefined;
  source_sha256:string='';can_open:boolean=false;replayed:boolean=false;note:string='';created_at:string='';
}
export class JournalNoteFilter {day:string='';limit:number=10;cursor:string='';}
export class JournalNotePage {
  schema:number=1;scope:string='local_summary_notes';day:string='';items:JournalNoteReceipt[]=[];next_cursor:string='';has_more:boolean=false;
  snapshot_sha256:string='';scanned:number=0;incomplete:boolean=false;incomplete_reason:string='';
}
export class JournalNoteDocument {
  schema:number=1;reference:JournalNoteRef=new JournalNoteRef();record:JournalNoteRecord=new JournalNoteRecord();summary:SavedSummaryDocument=new SavedSummaryDocument();
  markdown:string='';structured_json:string='';
}
export class JournalNoteChunk {
  schema:number=1;reference:JournalNoteRef=new JournalNoteRef();format:string='';text:string='';offset:number=0;next_offset:number=0;
  total_utf16:number=0;has_more:boolean=false;source_sha256:string='';
}
export class JournalNoteExport {reference:JournalNoteRef=new JournalNoteRef();format:string='';path:string='';content_sha256:string='';}
export interface JournalSummaryNotesPorts {
  root:()=>string;summaries:SavedJournalSummary;freeze:(dayStart:number,markdown:string)=>string;now:()=>number;
}
class NoteFile {bytes:number=0;sha256:string='';text:string='';limited:boolean=false;}
class NoteInspection {
  receipt:JournalNoteReceipt=new JournalNoteReceipt();record:JournalNoteRecord|undefined=undefined;raw:NoteFile=new NoteFile();
  directory:string='';names:string[]=[];unreadable:boolean=false;limited:boolean=false;
}
const RECORD_BYTES:number=65536;
const LIST_UNITS:number=4*1024*1024;
const EXPORT_UNITS:number=8*1024*1024;
// Shared across instances in this process; no claim of a cross-process DB lock.
const operationLocks:Set<string>=new Set<string>();
function validHash(value:string):boolean{return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function validUnicode(value:string):boolean{
  for(let at=0;at<value.length;at++){const code=value.charCodeAt(at);
    if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++at);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(code>=0xdc00&&code<=0xdfff)return false;
  }return true;
}
function digest(bytes:Uint8Array):string{
  const md=cryptoFramework.createMd('SHA256');md.updateSync({data:bytes});const result=md.digestSync().data;
  try{return Array.from(result).map((value:number):string=>value.toString(16).padStart(2,'0')).join('');}finally{result.fill(0);}
}
function textDigest(text:string):string{const bytes=new util.TextEncoder().encodeInto(text);try{return digest(bytes);}finally{bytes.fill(0);}}
function byteLength(text:string):number{const bytes=new util.TextEncoder().encodeInto(text);try{return bytes.length;}finally{bytes.fill(0);}}
function validDay(day:string):void{try{savedSummaryDayStart(day);}catch(error){throw new Error('NOTE_INVALID');}}
function operationDay(operation:string):string{
  if(typeof operation!=='string'||!/^noteop-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-f0-9]{32}$/.test(operation))throw new Error('NOTE_INVALID');
  const day=operation.slice(7,17);validDay(day);return day;
}
function parentValid(ref:SavedSummaryRef):void{
  if(!ref||Object.keys(ref).length!==3||Object.keys(ref).some((key:string):boolean=>!['day','summary_id','content_sha256'].includes(key))||
    typeof ref.summary_id!=='string'||!validHash(ref.content_sha256))throw new Error('NOTE_INVALID');validDay(ref.day);
  const prefix='saved-'+ref.day+'-';if(!ref.summary_id.startsWith(prefix)||(ref.summary_id.slice(prefix.length)!=='cache'&&!validHash(ref.summary_id.slice(prefix.length))))throw new Error('NOTE_INVALID');
}
function referenceValid(ref:JournalNoteRef):void{
  if(!ref||Object.keys(ref).length!==3||Object.keys(ref).some((key:string):boolean=>!['day','note_id','content_sha256'].includes(key))||
    typeof ref.note_id!=='string'||!validHash(ref.content_sha256))throw new Error('NOTE_INVALID');validDay(ref.day);
  const prefix='note-'+ref.day+'-';if(!ref.note_id.startsWith(prefix)||!/^[a-f0-9]{32}$/.test(ref.note_id.slice(prefix.length)))throw new Error('NOTE_INVALID');
}
function copyParent(ref:SavedSummaryRef):SavedSummaryRef{const out=new SavedSummaryRef();out.day=ref.day;out.summary_id=ref.summary_id;out.content_sha256=ref.content_sha256;return out;}
function copyRef(ref:JournalNoteRef):JournalNoteRef{const out=new JournalNoteRef();out.day=ref.day;out.note_id=ref.note_id;out.content_sha256=ref.content_sha256;return out;}
function noteId(operation:string):string{return 'note-'+operation.slice(7);}
function refOperation(ref:JournalNoteRef):string{return 'noteop-'+ref.note_id.slice(5);}
function sameParent(a:SavedSummaryRef,b:SavedSummaryRef):boolean{return a.day===b.day&&a.summary_id===b.summary_id&&a.content_sha256===b.content_sha256;}
function inputCanonical(value:JournalNoteInput):JournalNoteInput{
  if(!value||Object.keys(value).length<4||Object.keys(value).length>5||Object.keys(value).some((key:string):boolean=>!['operation_id','parent','source_sha256','text','previous'].includes(key))||
    !['operation_id','parent','source_sha256','text'].every((key:string):boolean=>Object.keys(value).includes(key))||
    !validHash(value.source_sha256)||typeof value.text!=='string'||!value.text.trim()||value.text.length>8192||!validUnicode(value.text))throw new Error('NOTE_INVALID');
  const day=operationDay(value.operation_id);parentValid(value.parent);if(value.parent.day!==day)throw new Error('NOTE_INVALID');
  const out=new JournalNoteInput();out.operation_id=value.operation_id;out.parent=copyParent(value.parent);out.source_sha256=value.source_sha256;out.text=value.text;
  if(value.previous!==undefined){referenceValid(value.previous);if(value.previous.day!==day||value.previous.note_id===noteId(value.operation_id))throw new Error('NOTE_INVALID');out.previous=copyRef(value.previous);}
  if(byteLength(JSON.stringify(out))>RECORD_BYTES)throw new Error('NOTE_INVALID');return out;
}
function inputHash(value:JournalNoteInput):string{return textDigest(JSON.stringify(value));}
function parseRecord(text:string,operation:string):JournalNoteRecord{
  const row=JSON.parse(text) as JournalNoteRecord;if(!row)throw new Error('NOTE_BLOCKED');
  const keys=Object.keys(row),required=['schema','day','operation_id','parent','origin','source_sha256','input_sha256','text','created_at','producer'];
  if((keys.length!==10&&keys.length!==11)||!required.every((key:string):boolean=>keys.includes(key))||
    keys.some((key:string):boolean=>!required.includes(key)&&key!=='previous')||row.schema!==1||row.operation_id!==operation||row.day!==operationDay(operation)||
    row.producer!=='user_note'||!validHash(row.input_sha256)||typeof row.created_at!=='string')throw new Error('NOTE_BLOCKED');
  const created=Date.parse(row.created_at);if(!Number.isFinite(created)||created<0||new Date(created).toISOString()!==row.created_at)throw new Error('NOTE_BLOCKED');
  parentValid(row.origin);if(row.origin.day!==row.day||row.origin.summary_id!=='saved-'+row.day+'-'+row.origin.content_sha256||row.origin.content_sha256!==row.parent?.content_sha256)throw new Error('NOTE_BLOCKED');
  const input=new JournalNoteInput();input.operation_id=row.operation_id;input.parent=row.parent;input.source_sha256=row.source_sha256;input.text=row.text;input.previous=row.previous;
  if(inputHash(inputCanonical(input))!==row.input_sha256)throw new Error('NOTE_BLOCKED');return row;
}
function formatValid(format:string):void{if(!['md','json'].includes(format))throw new Error('NOTE_INVALID');}
function filterValid(filter:JournalNoteFilter):void{
  if(!filter||Object.keys(filter).length!==3||Object.keys(filter).some((key:string):boolean=>!['day','limit','cursor'].includes(key))||
    !Number.isSafeInteger(filter.limit)||filter.limit<1||filter.limit>10||typeof filter.cursor!=='string'||
    (filter.cursor!==''&&(!/^[a-f0-9]{64}:(0|[1-9][0-9]*)$/.test(filter.cursor)||filter.cursor.length>81||!Number.isSafeInteger(Number(filter.cursor.slice(65))))))throw new Error('NOTE_INVALID');validDay(filter.day);
}
function utf8Units(bytes:Uint8Array):number{
  let units=0;for(let at=0;at<bytes.length;){const first=bytes[at];let width=0;
    if(first<=0x7f)width=1;else if(first>=0xc2&&first<=0xdf)width=2;else if(first>=0xe0&&first<=0xef)width=3;else if(first>=0xf0&&first<=0xf4)width=4;else return -1;
    if(at+width>bytes.length)return -1;for(let index=1;index<width;index++)if(bytes[at+index]<0x80||bytes[at+index]>0xbf)return -1;
    if((first===0xe0&&bytes[at+1]<0xa0)||(first===0xed&&bytes[at+1]>=0xa0)||(first===0xf0&&bytes[at+1]<0x90)||(first===0xf4&&bytes[at+1]>=0x90))return -1;
    units+=width===4?2:1;at+=width;
  }return units;
}
function publicError(error:Error):Error{return new Error(['NOTE_INVALID','NOTE_STALE','NOTE_CONFLICT','NOTE_BLOCKED','NOTE_IO'].includes(error.message)?error.message:'NOTE_IO');}

export class JournalSummaryNotes {
  private ports:JournalSummaryNotesPorts;
  constructor(ports:JournalSummaryNotesPorts){this.ports=ports;}
  save(value:JournalNoteInput):JournalNoteReceipt{return this.store(value,false);}
  resume(value:JournalNoteInput):JournalNoteReceipt{return this.store(value,true);}
  pendingInput(operation:string,expectedInputHash:string):JournalNoteInput{
    operationDay(operation);if(!validHash(expectedInputHash))throw new Error('NOTE_INVALID');
    try{const root=this.root();if(operationLocks.has(this.lockKey(root,operation)))throw new Error('NOTE_BLOCKED');
      const detail=this.details(root,operation,RECORD_BYTES);
      if(detail.receipt.state==='stale')throw new Error('NOTE_STALE');
      if(detail.receipt.state!=='pending'||!detail.record)throw new Error('NOTE_BLOCKED');
      if(detail.record.input_sha256!==expectedInputHash)throw new Error('NOTE_STALE');
      const input=new JournalNoteInput();input.operation_id=operation;input.parent=copyParent(detail.record.parent);input.source_sha256=detail.record.source_sha256;
      input.text=detail.record.text;if(detail.record.previous)input.previous=copyRef(detail.record.previous);
      this.validateBinding(input,detail.record.origin);const raw=this.read(detail.directory+'/pending.json',RECORD_BYTES,RECORD_BYTES);
      if(raw.sha256!==detail.raw.sha256||raw.text!==detail.raw.text)throw new Error('NOTE_STALE');return inputCanonical(input);
    }catch(error){throw publicError(error as Error);}
  }
  inspect(operation:string):JournalNoteReceipt{
    operationDay(operation);try{const root=this.root();if(operationLocks.has(this.lockKey(root,operation)))return this.busyReceipt(operation);return this.details(root,operation,RECORD_BYTES).receipt;}
    catch(error){throw publicError(error as Error);}
  }
  list(filter:JournalNoteFilter):JournalNotePage{
    filterValid(filter);const page=new JournalNotePage();page.day=filter.day;const entries:JournalNoteReceipt[]=[],facts:string[]=[filter.day];let root='',operations:string[]=[];
    try{root=this.root();const dayPath=this.dayDirectory(root,filter.day,false);
      if(dayPath){operations=fs.listFileSync(dayPath).filter((name:string):boolean=>name.startsWith('noteop-'+filter.day+'-')&&/^noteop-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-f0-9]{32}$/.test(name)).sort();}
    }catch(error){root='';page.incomplete=true;page.incomplete_reason='unreadable';facts.push('directory_unreadable');}
    facts.push('count:'+operations.length.toString(),this.membership(operations));const originCache:Map<string,boolean>=new Map<string,boolean>();
    if(operations.length>128){page.incomplete=true;page.incomplete_reason='scan_limit';}let consumed=0;
    for(const operation of operations.slice(0,128)){
      page.scanned++;let detail:NoteInspection;
      if(operationLocks.has(this.lockKey(root,operation))){detail=new NoteInspection();detail.receipt=this.busyReceipt(operation);detail.unreadable=true;}
      else detail=this.details(root,operation,Math.max(0,LIST_UNITS-consumed),originCache);
      entries.push(detail.receipt);facts.push(JSON.stringify([operation,detail.raw.sha256,detail.raw.bytes,detail.receipt,detail.limited]));
      consumed+=detail.raw.text.length;
      if(detail.unreadable||['corrupt','blocked','reserved'].includes(detail.receipt.state)){page.incomplete=true;if(!page.incomplete_reason)page.incomplete_reason='unreadable';}
      if(detail.limited){page.incomplete=true;page.incomplete_reason='text_limit';break;}
    }
    page.snapshot_sha256=textDigest(JSON.stringify(facts));let offset=0;
    if(filter.cursor){offset=Number(filter.cursor.slice(65));if(filter.cursor.slice(0,64)!==page.snapshot_sha256||offset>entries.length)throw new Error('NOTE_STALE');}
    page.items=entries.slice(offset,offset+filter.limit);page.has_more=offset+page.items.length<entries.length;if(page.has_more)page.next_cursor=page.snapshot_sha256+':'+(offset+page.items.length).toString();return page;
  }
  open(reference:JournalNoteRef):JournalNoteDocument{
    referenceValid(reference);try{const root=this.root(),operation=refOperation(reference);if(operationLocks.has(this.lockKey(root,operation)))throw new Error('NOTE_BLOCKED');return this.document(root,reference);}
    catch(error){throw publicError(error as Error);}
  }
  chunk(reference:JournalNoteRef,format:string,offset:number,maxChars:number):JournalNoteChunk{
    referenceValid(reference);formatValid(format);
    if(!Number.isSafeInteger(offset)||offset<0||offset>EXPORT_UNITS||!Number.isSafeInteger(maxChars)||maxChars<2||maxChars>4000)throw new Error('NOTE_INVALID');
    const document=this.open(reference),text=format==='md'?document.markdown:document.structured_json;
    if(offset>text.length||(offset>0&&offset<text.length&&text.charCodeAt(offset)>=0xdc00&&text.charCodeAt(offset)<=0xdfff&&text.charCodeAt(offset-1)>=0xd800&&text.charCodeAt(offset-1)<=0xdbff))throw new Error('NOTE_INVALID');
    let end=Math.min(text.length,offset+maxChars);if(end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--;
    const out=new JournalNoteChunk();out.reference=copyRef(reference);out.format=format;out.text=text.slice(offset,end);out.offset=offset;out.next_offset=end;
    out.total_utf16=text.length;out.has_more=end<text.length;out.source_sha256=document.record.source_sha256;return out;
  }
  exportSnapshot(reference:JournalNoteRef,format:string):JournalNoteExport{
    referenceValid(reference);formatValid(format);let key='';
    try{const root=this.root(),operation=refOperation(reference);key=this.acquire(root,operation);const document=this.document(root,reference),text=format==='md'?document.markdown:document.structured_json;
      const hash=textDigest(text),detail=this.details(root,operation,RECORD_BYTES);if(detail.receipt.state!=='saved'||!detail.directory)throw new Error('NOTE_BLOCKED');
      const name='summary-note-'+reference.day+'-'+operation+'-'+format+'-'+hash+'.'+format,path=detail.directory+'/'+name;
      const names=fs.listFileSync(detail.directory);if(names.includes(name+'.partial'))throw new Error('NOTE_BLOCKED');
      if(names.includes(name)){const old=this.read(path,EXPORT_UNITS*4,EXPORT_UNITS);if(old.sha256!==hash||old.text!==text)throw new Error('NOTE_BLOCKED');}
      else{this.write(path+'.partial',text);const frozen=this.read(path+'.partial',EXPORT_UNITS*4,EXPORT_UNITS);if(frozen.sha256!==hash||frozen.text!==text)throw new Error('NOTE_IO');
        this.document(root,reference);if(fs.listFileSync(detail.directory).includes(name))throw new Error('NOTE_BLOCKED');fs.renameSync(path+'.partial',path);
        const saved=this.read(path,EXPORT_UNITS*4,EXPORT_UNITS);if(saved.sha256!==hash||saved.text!==text)throw new Error('NOTE_IO');}
      const out=new JournalNoteExport();out.reference=copyRef(reference);out.format=format;out.path=path;out.content_sha256=hash;return out;
    }catch(error){throw publicError(error as Error);}finally{if(key)operationLocks.delete(key);}
  }
  private store(value:JournalNoteInput,resume:boolean):JournalNoteReceipt{
    const input=inputCanonical(value),expected=inputHash(input);let key='';
    try{const root=this.root(),operation=input.operation_id,day=input.parent.day;key=this.acquire(root,operation);
      const existing=this.details(root,operation,RECORD_BYTES);
      if(existing.record&&existing.record.input_sha256!==expected)throw new Error('NOTE_CONFLICT');
      if(existing.receipt.state==='saved'){existing.receipt.replayed=true;return existing.receipt;}
      if(existing.receipt.state!=='missing'){
        if(!resume)return existing.receipt;
        if(!existing.record||!['pending','stale'].includes(existing.receipt.state)||existing.names.length!==1||existing.names[0]!=='pending.json')throw new Error('NOTE_BLOCKED');
        this.validateBinding(input,existing.record.origin);const before=this.read(existing.directory+'/pending.json',RECORD_BYTES,RECORD_BYTES);
        if(before.sha256!==existing.raw.sha256||before.text!==existing.raw.text)throw new Error('NOTE_CONFLICT');
        this.syncPending(existing.directory+'/pending.json',existing.raw);
        this.validateBinding(input,existing.record.origin);this.promote(existing.directory,existing.raw.text,existing.raw.sha256);
        const result=this.details(root,operation,RECORD_BYTES).receipt;if(result.state!=='saved')throw new Error('NOTE_IO');return result;
      }
      if(resume)throw new Error('NOTE_BLOCKED');const parent=this.dayDirectory(root,day,true),directory=parent+'/'+operation;
      try{fs.mkdirSync(directory);}catch(error){throw new Error('NOTE_BLOCKED');}this.directory(directory);
      const summary=this.parent(input),origin=this.freeze(root,input,summary.markdown);this.previous(input,origin);
      const record=new JournalNoteRecord();record.day=day;record.operation_id=operation;record.parent=copyParent(input.parent);record.origin=copyParent(origin);
      record.source_sha256=input.source_sha256;record.input_sha256=expected;record.text=input.text;if(input.previous)record.previous=copyRef(input.previous);
      const now=this.ports.now();if(!Number.isSafeInteger(now)||now<0||!Number.isFinite(new Date(now).getTime()))throw new Error('NOTE_IO');record.created_at=new Date(now).toISOString();
      const raw=JSON.stringify(record);if(byteLength(raw)>RECORD_BYTES)throw new Error('NOTE_INVALID');if(fs.listFileSync(directory).length!==0)throw new Error('NOTE_BLOCKED');
      this.write(directory+'/pending.json',raw);const pending=this.read(directory+'/pending.json',RECORD_BYTES,RECORD_BYTES);
      if(pending.text!==raw||pending.sha256!==textDigest(raw))throw new Error('NOTE_IO');parseRecord(pending.text,operation);
      this.validateBinding(input,origin);this.promote(directory,raw,pending.sha256);
      const result=this.details(root,operation,RECORD_BYTES).receipt;if(result.state!=='saved')throw new Error('NOTE_IO');return result;
    }catch(error){throw publicError(error as Error);}finally{if(key)operationLocks.delete(key);}
  }
  private acquire(root:string,operation:string):string{const key=this.lockKey(root,operation);if(operationLocks.has(key))throw new Error('NOTE_BLOCKED');operationLocks.add(key);return key;}
  private lockKey(root:string,operation:string):string{return (/^[A-Za-z]:/.test(root)?root.toLowerCase():root)+'/'+operation;}
  private busyReceipt(operation:string):JournalNoteReceipt{const out=new JournalNoteReceipt();out.operation_id=operation;out.state='blocked';out.note='operation_busy';return out;}
  private root():string{
    const raw=this.ports.root();if(typeof raw!=='string'||!raw.trim()||raw!==raw.trim()||/[\u0000-\u001f\u007f]/.test(raw))throw new Error('NOTE_IO');
    const path=raw.replace(/\\/g,'/').replace(/\/+$/,'');if(!path||path.startsWith('//')||/^[A-Za-z]:$/.test(path)||(!path.startsWith('/')&&!/^[A-Za-z]:\//.test(path))||
      path.split('/').some((part:string):boolean=>part==='.'||part==='..'))throw new Error('NOTE_IO');
    const windows=/^[A-Za-z]:\//.test(path);let current=windows?path.slice(0,3):'/';const parts=(windows?path.slice(3):path.slice(1)).split('/').filter((part:string):boolean=>!!part);
    this.directory(current);for(const part of parts){current+=(current.endsWith('/')?'':'/')+part;this.directory(current);}return path;
  }
  private directory(path:string):void{const stat=fs.lstatSync(path);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('NOTE_BLOCKED');}
  private dayDirectory(root:string,day:string,create:boolean):string{
    const notes=root+'/summary-notes-v1';if(!fs.listFileSync(root).includes('summary-notes-v1')){if(!create)return '';try{fs.mkdirSync(notes);}catch(error){this.directory(notes);}}
    this.directory(notes);const directory=notes+'/'+day;
    if(!fs.listFileSync(notes).includes(day)){if(!create)return '';try{fs.mkdirSync(directory);}catch(error){this.directory(directory);}}
    this.directory(directory);return directory;
  }
  private exportName(name:string,day:string,operation:string):boolean{
    const prefix='summary-note-'+day+'-'+operation+'-';if(!name.startsWith(prefix))return false;
    const tail=name.slice(prefix.length),match=/^(md|json)-[a-f0-9]{64}\.(md|json)(\.partial)?$/.exec(tail);return !!match&&match[1]===match[2];
  }
  private details(root:string,operation:string,limit:number,originCache:Map<string,boolean>|undefined=undefined):NoteInspection{
    const out=new NoteInspection();out.receipt.operation_id=operation;out.receipt.state='missing';
    try{const day=operationDay(operation),parent=this.dayDirectory(root,day,false);if(!parent||!fs.listFileSync(parent).includes(operation))return out;
      out.directory=parent+'/'+operation;this.directory(out.directory);out.names=fs.listFileSync(out.directory).sort();
      if(out.names.some((name:string):boolean=>!['note.json','pending.json'].includes(name)&&!this.exportName(name,day,operation))||
        (out.names.includes('note.json')&&out.names.includes('pending.json'))){out.receipt.state='blocked';out.receipt.note='unknown_evidence';return out;}
      if(out.names.length===0){out.receipt.state='reserved';out.receipt.note='empty_reservation';return out;}
      const committed=out.names.includes('note.json');if(!committed&&(out.names.length!==1||out.names[0]!=='pending.json')){out.receipt.state='blocked';out.receipt.note='unknown_evidence';return out;}
      const path=out.directory+(committed?'/note.json':'/pending.json');out.raw=this.read(path,RECORD_BYTES,limit);out.limited=out.raw.limited;
      if(out.raw.limited){out.receipt.state='blocked';out.receipt.note='read_limit';return out;}
      try{out.record=parseRecord(out.raw.text,operation);}catch(error){out.receipt.state='corrupt';out.receipt.note='invalid_record';return out;}
      out.receipt.input_sha256=out.record.input_sha256;out.receipt.source_sha256=out.record.source_sha256;out.receipt.created_at=out.record.created_at;
      if(committed){out.receipt.state='saved';const reference=new JournalNoteRef();reference.day=day;reference.note_id=noteId(operation);reference.content_sha256=out.raw.sha256;out.receipt.reference=reference;
        const cacheKey=JSON.stringify([out.record.origin,out.record.source_sha256]);
        if(originCache?.has(cacheKey))out.receipt.can_open=originCache.get(cacheKey)===true;
        else{try{const summary=this.ports.summaries.open(out.record.origin);out.receipt.can_open=summary.source_sha256===out.record.source_sha256&&sameParent(summary.reference,out.record.origin);}catch(error){}
          originCache?.set(cacheKey,out.receipt.can_open);}
        if(!out.receipt.can_open)out.receipt.note='source_unavailable';
      }else{out.receipt.state='pending';out.receipt.note='explicit_resume_required';
        try{const input=new JournalNoteInput();input.operation_id=operation;input.parent=out.record.parent;input.source_sha256=out.record.source_sha256;input.text=out.record.text;input.previous=out.record.previous;
          this.validateBinding(input,out.record.origin);}catch(error){out.receipt.state='stale';out.receipt.note='source_unavailable';}}
      return out;
    }catch(error){out.unreadable=true;out.receipt.state='blocked';out.receipt.note='unreadable';return out;}
  }
  private parent(input:JournalNoteInput):SavedSummaryDocument{
    try{const summary=this.ports.summaries.open(input.parent);if(summary.source_sha256!==input.source_sha256||!sameParent(summary.reference,input.parent))throw new Error('stale');return summary;}
    catch(error){throw new Error('NOTE_STALE');}
  }
  private previous(input:JournalNoteInput,origin:SavedSummaryRef):void{
    if(!input.previous)return;try{const previous=this.open(input.previous);if(previous.record.source_sha256!==input.source_sha256||!sameParent(previous.record.origin,origin))throw new Error('stale');}
    catch(error){throw new Error('NOTE_STALE');}
  }
  private validateBinding(input:JournalNoteInput,origin:SavedSummaryRef):void{
    const parent=this.parent(input);if(parent.reference.content_sha256!==origin.content_sha256)throw new Error('NOTE_STALE');
    try{const frozen=this.ports.summaries.open(origin);if(frozen.source_sha256!==input.source_sha256||frozen.markdown!==parent.markdown)throw new Error('stale');}catch(error){throw new Error('NOTE_STALE');}
    this.previous(input,origin);
  }
  private freeze(root:string,input:JournalNoteInput,markdown:string):SavedSummaryRef{
    const hash=textDigest(markdown);if(hash!==input.parent.content_sha256)throw new Error('NOTE_STALE');
    const name='day-'+input.parent.day+'-'+hash+'.md',path=root+'/'+name,names=fs.listFileSync(root);
    if(names.includes(name+'.partial'))throw new Error('NOTE_BLOCKED');
    if(names.includes(name)){const old=this.read(path,8*1024*1024,2*1024*1024);if(old.limited||old.sha256!==hash||old.text!==markdown)throw new Error('NOTE_BLOCKED');}
    else{const returned=this.ports.freeze(savedSummaryDayStart(input.parent.day),markdown);if(typeof returned!=='string'||returned.replace(/\\/g,'/')!==path)throw new Error('NOTE_BLOCKED');
      if(fs.listFileSync(root).includes(name+'.partial'))throw new Error('NOTE_BLOCKED');const frozen=this.read(path,8*1024*1024,2*1024*1024);if(frozen.limited||frozen.sha256!==hash||frozen.text!==markdown)throw new Error('NOTE_IO');}
    const out=new SavedSummaryRef();out.day=input.parent.day;out.summary_id='saved-'+out.day+'-'+hash;out.content_sha256=hash;return out;
  }
  private promote(directory:string,text:string,hash:string):void{
    if(fs.listFileSync(directory).join('|')!=='pending.json')throw new Error('NOTE_BLOCKED');
    fs.renameSync(directory+'/pending.json',directory+'/note.json');const committed=this.read(directory+'/note.json',RECORD_BYTES,RECORD_BYTES);
    if(committed.text!==text||committed.sha256!==hash)throw new Error('NOTE_IO');
  }
  private syncPending(path:string,expected:NoteFile):void{
    const before=fs.lstatSync(path);if(before.isSymbolicLink()||!before.isFile()||before.size!==expected.bytes)throw new Error('NOTE_BLOCKED');
    // Windows and Harmony require a writable fd for fsync. No CREATE/TRUNC and
    // no byte writes: a readable pending file is not a durability receipt.
    const file=fs.openSync(path,fs.OpenMode.WRITE_ONLY);
    try{const opened=fs.statSync(file.fd);if(opened.size!==before.size||opened.ino!==before.ino)throw new Error('NOTE_IO');fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);}
    const after=this.read(path,RECORD_BYTES,RECORD_BYTES);if(after.sha256!==expected.sha256||after.text!==expected.text)throw new Error('NOTE_CONFLICT');
  }
  private document(root:string,reference:JournalNoteRef):JournalNoteDocument{
    const detail=this.details(root,refOperation(reference),RECORD_BYTES);
    if(detail.receipt.state!=='saved'||!detail.record||detail.raw.sha256!==reference.content_sha256)throw new Error('NOTE_STALE');
    let summary:SavedSummaryDocument;
    try{summary=this.ports.summaries.open(detail.record.origin);if(summary.source_sha256!==detail.record.source_sha256||!sameParent(summary.reference,detail.record.origin))throw new Error('stale');}
    catch(error){throw new Error('NOTE_STALE');}
    const out=new JournalNoteDocument();out.reference=copyRef(reference);out.record=JSON.parse(detail.raw.text) as JournalNoteRecord;out.summary=summary;
    out.markdown=summary.markdown+'\n---\n\n## 用户附注\n\n- 附注操作：'+out.record.operation_id+'\n- 原保存总结：'+out.record.parent.summary_id+
      '\n- 原总结全文指纹：sha256:'+out.record.origin.content_sha256+'\n- 原文来源指纹：sha256:'+out.record.source_sha256+'\n- 本次人工附注保存时间：'+out.record.created_at+'\n\n'+out.record.text+'\n';
    out.structured_json=JSON.stringify({schema:1,kind:'summary_user_note',reference:out.reference,record:out.record,summary:out.summary});
    if(out.markdown.length>EXPORT_UNITS||out.structured_json.length>EXPORT_UNITS)throw new Error('NOTE_BLOCKED');return out;
  }
  private read(path:string,limit:number,textLimit:number):NoteFile{
    const out=new NoteFile(),before=fs.lstatSync(path);if(before.isSymbolicLink()||!before.isFile()||!Number.isSafeInteger(before.size)||before.size<0)throw new Error('NOTE_BLOCKED');out.bytes=before.size;
    if(before.size>limit){out.limited=true;return out;}const bytes=new Uint8Array(before.size),file=fs.openSync(path,fs.OpenMode.READ_ONLY);
    try{const opened=fs.statSync(file.fd);if(opened.size!==before.size||opened.ino!==before.ino)throw new Error('NOTE_IO');let at=0;
      while(at<bytes.length){const part=new Uint8Array(Math.min(16384,bytes.length-at));try{const count=fs.readSync(file.fd,part.buffer,{length:part.length});
        if(!Number.isSafeInteger(count)||count<1||count>part.length)throw new Error('NOTE_IO');bytes.set(part.subarray(0,count),at);at+=count;}finally{part.fill(0);}}
      const extra=new Uint8Array(1);try{if(fs.readSync(file.fd,extra.buffer,{length:1})!==0)throw new Error('NOTE_IO');}finally{extra.fill(0);}
      const after=fs.lstatSync(path);if(after.isSymbolicLink()||!after.isFile()||after.size!==before.size||after.ino!==before.ino||fs.statSync(file.fd).size!==before.size)throw new Error('NOTE_IO');
      out.sha256=digest(bytes);const units=utf8Units(bytes);if(units<0)throw new Error('NOTE_BLOCKED');if(units>textLimit){out.limited=true;return out;}
      out.text=new util.TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decodeToString(bytes);const encoded=new util.TextEncoder().encodeInto(out.text);
      try{if(out.text.length!==units||!validUnicode(out.text)||encoded.length!==bytes.length)throw new Error('NOTE_BLOCKED');for(let index=0;index<bytes.length;index++)if(encoded[index]!==bytes[index])throw new Error('NOTE_BLOCKED');}finally{encoded.fill(0);}return out;
    }finally{fs.closeSync(file);bytes.fill(0);}
  }
  private write(path:string,text:string):void{
    const directory=path.slice(0,path.lastIndexOf('/')),name=path.slice(path.lastIndexOf('/')+1);this.directory(directory);
    if(fs.listFileSync(directory).includes(name))throw new Error('NOTE_BLOCKED');const bytes=new util.TextEncoder().encodeInto(text);const file=fs.openSync(path,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY);
    try{let at=0;while(at<bytes.length){const part=bytes.slice(at,Math.min(bytes.length,at+16384));try{const count=fs.writeSync(file.fd,part.buffer);
      if(!Number.isSafeInteger(count)||count<1||count>part.length)throw new Error('NOTE_IO');at+=count;}finally{part.fill(0);}}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}
  }
  private membership(names:string[]):string{
    const md=cryptoFramework.createMd('SHA256');const domain=new util.TextEncoder().encodeInto('journal-note-membership-v1\n');try{md.updateSync({data:domain});}finally{domain.fill(0);}
    for(const name of names){const bytes=new util.TextEncoder().encodeInto(name+'\n');try{md.updateSync({data:bytes});}finally{bytes.fill(0);}}
    const out=md.digestSync().data;try{return Array.from(out).map((value:number):string=>value.toString(16).padStart(2,'0')).join('');}finally{out.fill(0);}
  }
}
