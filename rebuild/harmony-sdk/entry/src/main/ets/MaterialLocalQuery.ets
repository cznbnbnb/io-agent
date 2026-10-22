import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { MaterialRevision, MaterialUtterance, MaterialSourceRange, MaterialSpeaker, MaterialQueryCatalog, deriveMaterialSpeakers } from './MaterialStore';

export class LocalMaterialFilter {
  from:number=0;to:number=0;keyword:string='';speaker:string='';limit:number=10;cursor:string='';
}
export class LocalMaterialReference {
  material_id:string='';revision:number=0;text_revision:number=0;utterance_id:string='';content_sha256:string='';
  source_range:MaterialSourceRange|undefined=undefined;
}
export class LocalMaterialHit {
  reference:LocalMaterialReference=new LocalMaterialReference();kind:string='';name:string='';
  source_started:number=0;source_ended:number=0;start_ms:number|null=null;end_ms:number|null=null;
  excerpt:string='';speaker_id:string='';speaker_label:string='';speaker_basis:string='unknown';label_basis:string='anonymous';
  is_self:boolean=false;overlap:boolean=false;transcription_state:string='unknown';audio_available:boolean=false;
}
export class LocalMaterialPage {
  schema:number=1;scope:string='local_canonical_only';hits:LocalMaterialHit[]=[];next_cursor:string='';has_more:boolean=false;
  snapshot_sha256:string='';scanned:number=0;unreadable:number=0;incomplete:boolean=false;incomplete_reason:string='';legacy_not_indexed:boolean=true;
}
export class LocalMaterialScanFilter {
  from:number=0;to:number=0;keyword:string='';speaker:string='';limit:number=10;scan_cursor:string='';hit_cursor:string='';
}
export class LocalMaterialScanPage {
  schema:number=1;scope:string='local_canonical_window';hits:LocalMaterialHit[]=[];next_cursor:string='';has_more:boolean=false;
  snapshot_sha256:string='';scanned:number=0;unreadable:number=0;incomplete:boolean=false;incomplete_reason:string='';legacy_not_indexed:boolean=true;
  catalog_sha256:string='';catalog_total:number=0;window_start:number=0;window_end:number=0;content_units:number=0;oversized:number=0;
  scan_cursor:string='';next_scan_cursor:string='';scan_has_more:boolean=false;stop_reason:string='end';
}
export interface LocalMaterialQueryPorts {
  ids:()=>string[];
  read:(id:string)=>MaterialRevision|undefined;
  catalog?:()=>MaterialQueryCatalog;
}
class IndexedHit { hit:LocalMaterialHit=new LocalMaterialHit();order:number=0; }
class QueryWindow {
  page:LocalMaterialPage=new LocalMaterialPage();hits:LocalMaterialHit[]=[];
  progress:number=0;contentUnits:number=0;oversized:number=0;stopReason:string='end';
}
const scanLimit:number=512;
// The complete serialized records (including dictionaries/metadata) share this
// UTF-16 budget; metadata cannot bypass a text-only scan bound.
const contentLimit:number=2*1024*1024;
function hash(value:string):string{
  const bytes=new util.TextEncoder().encodeInto(value);const md=cryptoFramework.createMd('SHA256');
  try{md.updateSync({data:bytes});const digest=md.digestSync().data;
    try{return Array.from(digest).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}finally{digest.fill(0);}
  }finally{bytes.fill(0);}
}
function unicodeValid(value:string):boolean{
  for(let at=0;at<value.length;at++){
    const code=value.charCodeAt(at);
    if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++at);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(code>=0xdc00&&code<=0xdfff)return false;
  }return true;
}
function inputText(value:string,limit:number):boolean{
  return typeof value==='string'&&value.length<=limit&&!/[\u0000-\u001f\u007f-\u009f]/.test(value)&&unicodeValid(value);
}
function timeValid(value:number):boolean{return Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;}
function idValid(value:string):boolean{return typeof value==='string'&&/^mat-(recording|lifelog)-[a-f0-9]{32}$/.test(value);}
function rangeValid(range:MaterialSourceRange):boolean{
  return !!range&&Object.keys(range).length===6&&Object.keys(range).every((key:string):boolean=>
    ['parent_utterance_id','parent_revision','start_ms','end_ms','text_start','text_end'].includes(key))&&
    typeof range.parent_utterance_id==='string'&&range.parent_utterance_id.length>0&&range.parent_utterance_id.length<=256&&
    Number.isSafeInteger(range.parent_revision)&&range.parent_revision>0&&Number.isSafeInteger(range.start_ms)&&range.start_ms>=0&&
    Number.isSafeInteger(range.end_ms)&&range.end_ms>=range.start_ms&&Number.isSafeInteger(range.text_start)&&range.text_start>=0&&
    Number.isSafeInteger(range.text_end)&&range.text_end>range.text_start;
}
function copyRange(range:MaterialSourceRange|undefined):MaterialSourceRange|undefined{
  if(range===undefined)return undefined;
  const out=new MaterialSourceRange();out.parent_utterance_id=range.parent_utterance_id;out.parent_revision=range.parent_revision;
  out.start_ms=range.start_ms;out.end_ms=range.end_ms;out.text_start=range.text_start;out.text_end=range.text_end;return out;
}
function sameRange(a:MaterialSourceRange|undefined,b:MaterialSourceRange|undefined):boolean{
  if(a===undefined||b===undefined)return a===b;
  return rangeValid(a)&&rangeValid(b)&&a.parent_utterance_id===b.parent_utterance_id&&a.parent_revision===b.parent_revision&&
    a.start_ms===b.start_ms&&a.end_ms===b.end_ms&&a.text_start===b.text_start&&a.text_end===b.text_end;
}
function canonicalValid(row:MaterialRevision,id:string):boolean{
  if(!row||row.schema_version!==1||row.material_id!==id||!Number.isSafeInteger(row.revision)||row.revision<1||
    !Number.isSafeInteger(row.text_revision)||row.text_revision<0||row.text_revision>row.revision||!['upsert','delete'].includes(row.operation)||
    !row.source||!['recording','lifelog'].includes(row.source.kind)||typeof row.source.name!=='string'||!row.source.name||row.source.name.length>256||
    !timeValid(row.source.started)||!timeValid(row.source.ended)||row.source.ended<row.source.started||typeof row.source.audioAvailable!=='boolean'||
    typeof row.text!=='string'||row.text.length>1000000||!unicodeValid(row.text)||!Array.isArray(row.utterances)||row.utterances.length>10000||
    (row.transcription_state!==undefined&&!['unknown','pending','partial','complete'].includes(row.transcription_state)))return false;
  if(row.speakers!==undefined){
    if(!Array.isArray(row.speakers)||row.speakers.length>10000)return false;
    const speakerIds:string[]=[];let selfCount=0;
    for(const speaker of row.speakers){
      if(!speaker||typeof speaker.speaker_id!=='string'||!speaker.speaker_id||speaker.speaker_id.length>128||speakerIds.includes(speaker.speaker_id)||
        !inputText(speaker.label,80)||!speaker.label.trim()||!['anonymous','user_confirmed','role_match'].includes(speaker.label_basis)||
        typeof speaker.is_self!=='boolean'||(speaker.is_self&&speaker.label_basis!=='user_confirmed'))return false;
      speakerIds.push(speaker.speaker_id);if(speaker.is_self)selfCount++;
    }if(selfCount>1)return false;
  }
  const utteranceIds:string[]=[];
  for(const part of row.utterances){
    if(!part||typeof part.utterance_id!=='string'||!part.utterance_id||part.utterance_id.length>256||utteranceIds.includes(part.utterance_id)||
      typeof part.text!=='string'||part.text.length>65536||!unicodeValid(part.text)||typeof part.speaker_id!=='string'||part.speaker_id.length>128||
      !['unknown','segment_cluster','user'].includes(part.speaker_basis)||typeof part.overlap!=='boolean')return false;
    if(part.start_ms===null&&part.end_ms===null){
      if(!part.source_range||!rangeValid(part.source_range)||part.source_range.parent_revision>=row.revision||part.source_range.end_ms>row.source.ended-row.source.started)return false;
    }else if(part.start_ms===null||part.end_ms===null||!Number.isSafeInteger(part.start_ms)||!Number.isSafeInteger(part.end_ms)||
      part.start_ms<0||part.end_ms<part.start_ms||part.end_ms>row.source.ended-row.source.started||part.source_range!==undefined)return false;
    if(row.speakers!==undefined&&((part.speaker_id&&!row.speakers.some((speaker:MaterialSpeaker):boolean=>speaker.speaker_id===part.speaker_id))||
      (!part.speaker_id&&part.speaker_basis!=='unknown')||(part.speaker_id&&part.speaker_basis==='unknown')))return false;
    utteranceIds.push(part.utterance_id);
  }return true;
}
function canonicalFilter(input:LocalMaterialFilter):LocalMaterialFilter{
  if(!input||Object.keys(input).length!==6||Object.keys(input).some((key:string):boolean=>!['from','to','keyword','speaker','limit','cursor'].includes(key))||
    !timeValid(input.from)||!timeValid(input.to)||((input.from!==0||input.to!==0)&&(input.to<=input.from||input.to-input.from>366*86400000))||
    !inputText(input.keyword,200)||!inputText(input.speaker,80)||(!input.keyword.trim()&&!input.speaker.trim())||
    !Number.isSafeInteger(input.limit)||input.limit<1||input.limit>10||typeof input.cursor!=='string'||
    (input.cursor!==''&&(!/^[a-f0-9]{64}:(0|[1-9][0-9]*)$/.test(input.cursor)||input.cursor.length>81||
      !Number.isSafeInteger(Number(input.cursor.slice(65))))))throw new Error('LOCAL_QUERY_INVALID');
  const out=new LocalMaterialFilter();out.from=input.from;out.to=input.to;out.keyword=input.keyword.trim();out.speaker=input.speaker.trim();
  out.limit=input.limit;out.cursor=input.cursor;return out;
}
// Case folding can expand a code point (for example U+0130). Convert folded
// match offsets back to original UTF-16 before cutting an unmodified excerpt.
function originalOffset(text:string,foldedOffset:number):number{
  let folded=0,at=0;
  while(at<text.length&&folded<foldedOffset){const code=text.charCodeAt(at),width=code>=0xd800&&code<=0xdbff?2:1;
    folded+=text.slice(at,at+width).toLowerCase().length;at+=width;
  }return at;
}
function excerpt(text:string,keyword:string):string{
  if(text.length<=160)return text;
  const folded=keyword.toLowerCase(),match=folded?text.toLowerCase().indexOf(folded):-1;
  const begin=match<0?0:originalOffset(text,match),end=match<0?0:originalOffset(text,match+folded.length);
  // A >160-unit search term is valid; this bounded preview includes its start,
  // while resolve() supplies the complete original text.
  let start=begin-Math.min(48,Math.max(0,160-(end-begin)));start=Math.max(0,start);
  if(start>0&&text.charCodeAt(start)>=0xdc00&&text.charCodeAt(start)<=0xdfff)start--;
  let stop=Math.min(text.length,start+160);
  if(stop<text.length&&text.charCodeAt(stop-1)>=0xd800&&text.charCodeAt(stop-1)<=0xdbff)stop--;
  return text.slice(start,stop);
}
function compareText(a:string,b:string):number{return a<b?-1:a>b?1:0;}

export class LocalMaterialQuery {
  private ports:LocalMaterialQueryPorts;
  constructor(ports:LocalMaterialQueryPorts){this.ports=ports;}
  query(input:LocalMaterialFilter):LocalMaterialPage{
    return this.runWindow(input).page;
  }
  // Scan and hit pagination are separate. Continuing a scan replaces the
  // current window; its time-sorted hits never claim a global latest ranking.
  scan(input:LocalMaterialScanFilter):LocalMaterialScanPage{
    if(!input||Object.keys(input).length!==7||Object.keys(input).some((key:string):boolean=>
      !['from','to','keyword','speaker','limit','scan_cursor','hit_cursor'].includes(key))||
      typeof input.scan_cursor!=='string'||input.scan_cursor.length>160||
      (input.scan_cursor!==''&&!/^lscan1:[a-f0-9]{64}:[a-f0-9]{64}:(0|[1-9][0-9]*)$/.test(input.scan_cursor))||
      typeof input.hit_cursor!=='string'||input.hit_cursor.length>81||(input.hit_cursor!==''&&input.scan_cursor==='')||
      (input.hit_cursor!==''&&!/^[a-f0-9]{64}:(0|[1-9][0-9]*)$/.test(input.hit_cursor)))throw new Error('LOCAL_QUERY_INVALID');
    if((input.scan_cursor!==''&&!Number.isSafeInteger(Number(input.scan_cursor.split(':')[3])))||
      (input.hit_cursor!==''&&!Number.isSafeInteger(Number(input.hit_cursor.slice(65)))))throw new Error('LOCAL_QUERY_INVALID');
    const requested=new LocalMaterialFilter();requested.from=input.from;requested.to=input.to;requested.keyword=input.keyword;
    requested.speaker=input.speaker;requested.limit=input.limit;const filter=canonicalFilter(requested);
    const filterHash=hash(JSON.stringify([filter.from,filter.to,filter.keyword.toLowerCase(),filter.speaker]));
    const catalog=this.catalog();let start=0;
    if(input.scan_cursor){const parts=input.scan_cursor.split(':');start=Number(parts[3]);
      if(parts[1]!==catalog.snapshot_sha256||parts[2]!==filterHash||start>catalog.ids.length)throw new Error('LOCAL_QUERY_STALE');}
    const window=this.runWindow(filter,catalog.ids.slice(start),true),after=this.catalog();
    if(after.snapshot_sha256!==catalog.snapshot_sha256||after.ids.length!==catalog.ids.length||
      after.ids.some((id:string,index:number):boolean=>id!==catalog.ids[index]))throw new Error('LOCAL_QUERY_STALE');
    const page=new LocalMaterialScanPage();page.catalog_sha256=catalog.snapshot_sha256;page.catalog_total=catalog.ids.length;
    page.window_start=start;page.window_end=start+window.progress;page.content_units=window.contentUnits;page.oversized=window.oversized;
    page.scanned=window.page.scanned;page.unreadable=window.page.unreadable;page.stop_reason=window.stopReason;
    page.scan_cursor='lscan1:'+catalog.snapshot_sha256+':'+filterHash+':'+start.toString();
    page.scan_has_more=page.window_end<page.catalog_total;
    if(page.scan_has_more){
      if(page.window_end<=start)throw new Error('LOCAL_SCAN_UNAVAILABLE');
      page.next_scan_cursor='lscan1:'+catalog.snapshot_sha256+':'+filterHash+':'+page.window_end.toString();
    }
    page.snapshot_sha256=hash(JSON.stringify([catalog.snapshot_sha256,filterHash,start,window.page.snapshot_sha256]));let offset=0;
    if(input.hit_cursor){offset=Number(input.hit_cursor.slice(65));
      if(input.hit_cursor.slice(0,64)!==page.snapshot_sha256||offset>window.hits.length)throw new Error('LOCAL_QUERY_STALE');}
    page.hits=window.hits.slice(offset,offset+filter.limit);page.has_more=offset+page.hits.length<window.hits.length;
    if(page.has_more)page.next_cursor=page.snapshot_sha256+':'+(offset+page.hits.length).toString();
    page.incomplete=start>0||page.scan_has_more||page.unreadable>0||page.oversized>0;
    page.incomplete_reason=page.oversized>0?'oversized':page.unreadable>0?'unreadable':page.incomplete?'window_only':'';
    return page;
  }
  private catalog():MaterialQueryCatalog{
    try{
      if(!this.ports.catalog)throw new Error('missing');const saved=this.ports.catalog();
      if(!saved||Object.keys(saved).length!==2||!Array.isArray(saved.ids)||typeof saved.snapshot_sha256!=='string'||
        !/^[a-f0-9]{64}$/.test(saved.snapshot_sha256)||saved.ids.some((id:string,index:number):boolean=>
          !idValid(id)||(index>0&&saved.ids[index-1]>=id)))throw new Error('invalid');
      const out=new MaterialQueryCatalog();out.ids=saved.ids.slice();out.snapshot_sha256=saved.snapshot_sha256;return out;
    }catch(error){throw new Error('LOCAL_SCAN_UNAVAILABLE');}
  }
  private runWindow(input:LocalMaterialFilter,selectedIds:string[]|undefined=undefined,scanMode:boolean=false):QueryWindow{
    const filter=canonicalFilter(input),page=new LocalMaterialPage();const found:IndexedHit[]=[];
    const window=new QueryWindow();window.page=page;
    const snapshot:string[]=[JSON.stringify([filter.from,filter.to,filter.keyword.toLowerCase(),filter.speaker])];
    let ids:string[]=[];
    try{ids=selectedIds===undefined?this.ports.ids():selectedIds;if(!Array.isArray(ids)||ids.some((id:string):boolean=>typeof id!=='string'))throw new Error('LOCAL_IDS_INVALID');ids=ids.slice().sort();}
    catch(error){ids=[];page.incomplete=true;page.incomplete_reason='unreadable';page.unreadable=1;snapshot.push('ids_unreadable');}
    if(ids.length>scanLimit){page.incomplete=true;page.incomplete_reason='scan_limit';window.stopReason='scan_limit';}
    snapshot.push('ids:'+ids.length.toString());let consumed=0;const seen:string[]=[];
    for(const id of ids.slice(0,scanLimit)){
      page.scanned++;
      if(!idValid(id)||seen.includes(id)){this.unreadable(page);snapshot.push(JSON.stringify([id,'invalid_id']));window.progress++;continue;}seen.push(id);
      let row:MaterialRevision|undefined=undefined;let raw='';
      try{row=this.ports.read(id);if(!row||!canonicalValid(row,id))throw new Error('LOCAL_CANONICAL_INVALID');raw=JSON.stringify(row);
        if(typeof raw!=='string')throw new Error('LOCAL_CANONICAL_INVALID');}
      catch(error){this.unreadable(page);snapshot.push(JSON.stringify([id,'unreadable']));window.progress++;continue;}
      if(consumed+raw.length>contentLimit){page.incomplete=true;page.incomplete_reason='text_limit';snapshot.push(JSON.stringify([id,'text_limit',raw.length]));
        window.stopReason='text_limit';
        // A single over-budget record is explicitly unsearched. Advancing past
        // it lets a later window reach the remaining materials without looping.
        if(scanMode&&raw.length>contentLimit){window.oversized=1;window.progress++;window.stopReason='oversized';}break;}
      consumed+=raw.length;window.progress++;const digest=hash(raw);snapshot.push(JSON.stringify([id,'canonical',digest]));
      if(row.operation==='delete'||!this.inRange(row,filter))continue;
      const speakers=deriveMaterialSpeakers(row);
      if(row.utterances.length===0){if(!filter.speaker&&(!filter.keyword||row.text.toLowerCase().includes(filter.keyword.toLowerCase()))){
        const indexed=new IndexedHit();indexed.hit=this.hit(row,digest,undefined,undefined,filter.keyword);found.push(indexed);}
      }else for(let index=0;index<row.utterances.length;index++){
        const part=row.utterances[index];const speaker=speakers.find((saved:MaterialSpeaker):boolean=>saved.speaker_id===part.speaker_id);
        if(!this.partInRange(row,part,filter))continue;
        if(filter.keyword&&!part.text.toLowerCase().includes(filter.keyword.toLowerCase()))continue;
        if(filter.speaker&&part.speaker_id!==filter.speaker&&(!speaker||!speaker.label.toLowerCase().includes(filter.speaker.toLowerCase())))continue;
        const indexed=new IndexedHit();indexed.order=index;indexed.hit=this.hit(row,digest,part,speaker,filter.keyword);found.push(indexed);
      }
    }
    found.sort((a:IndexedHit,b:IndexedHit):number=>b.hit.source_started-a.hit.source_started||compareText(a.hit.reference.material_id,b.hit.reference.material_id)||a.order-b.order);
    page.snapshot_sha256=hash(JSON.stringify(snapshot));let offset=0;
    if(filter.cursor){offset=Number(filter.cursor.slice(65));if(filter.cursor.slice(0,64)!==page.snapshot_sha256||offset>found.length)throw new Error('LOCAL_QUERY_STALE');}
    page.hits=found.slice(offset,offset+filter.limit).map((saved:IndexedHit):LocalMaterialHit=>saved.hit);
    page.has_more=offset+page.hits.length<found.length;if(page.has_more)page.next_cursor=page.snapshot_sha256+':'+(offset+page.hits.length).toString();
    window.hits=found.map((saved:IndexedHit):LocalMaterialHit=>saved.hit);window.contentUnits=consumed;return window;
  }
  resolve(reference:LocalMaterialReference):MaterialRevision{
    if(!reference||Object.keys(reference).some((key:string):boolean=>!['material_id','revision','text_revision','utterance_id','content_sha256','source_range'].includes(key))||
      !idValid(reference.material_id)||!Number.isSafeInteger(reference.revision)||reference.revision<1||!Number.isSafeInteger(reference.text_revision)||
      reference.text_revision<0||reference.text_revision>reference.revision||typeof reference.utterance_id!=='string'||reference.utterance_id.length>256||
      typeof reference.content_sha256!=='string'||!/^[a-f0-9]{64}$/.test(reference.content_sha256)||
      (reference.source_range!==undefined&&!rangeValid(reference.source_range)))throw new Error('LOCAL_REFERENCE_INVALID');
    let row:MaterialRevision|undefined=undefined;
    try{row=this.ports.read(reference.material_id);if(!row||!canonicalValid(row,reference.material_id)||row.operation==='delete'||row.revision!==reference.revision||row.text_revision!==reference.text_revision)throw new Error('stale');
      const raw=JSON.stringify(row);if(raw.length>contentLimit||hash(raw)!==reference.content_sha256)throw new Error('stale');
      const part=row.utterances.find((saved:MaterialUtterance):boolean=>saved.utterance_id===reference.utterance_id);
      if(reference.utterance_id?(!part||!sameRange(part.source_range,reference.source_range)):(row.utterances.length!==0||reference.source_range!==undefined))throw new Error('stale');
      return JSON.parse(raw) as MaterialRevision;
    }catch(error){throw new Error('LOCAL_REFERENCE_STALE');}
  }
  private unreadable(page:LocalMaterialPage):void{
    page.unreadable++;page.incomplete=true;if(!page.incomplete_reason)page.incomplete_reason='unreadable';
  }
  private inRange(row:MaterialRevision,filter:LocalMaterialFilter):boolean{
    if(filter.from===0&&filter.to===0)return true;
    // A legal zero-duration utterance may sit exactly at source.ended.
    // Keep that source candidate; partInRange still excludes nonzero segments
    // and split parent ranges whose end merely touches the requested start.
    return row.source.started===row.source.ended?row.source.started>=filter.from&&row.source.started<filter.to:
      row.source.started<filter.to&&(row.utterances.length>0?row.source.ended>=filter.from:row.source.ended>filter.from);
  }
  private partInRange(row:MaterialRevision,part:MaterialUtterance,filter:LocalMaterialFilter):boolean{
    if(filter.from===0&&filter.to===0)return true;
    const start=part.start_ms===null?part.source_range?.start_ms:part.start_ms;
    const end=part.end_ms===null?part.source_range?.end_ms:part.end_ms;
    if(start===undefined||end===undefined)return false;
    const absoluteStart=row.source.started+start,absoluteEnd=row.source.started+end;
    return absoluteStart===absoluteEnd?absoluteStart>=filter.from&&absoluteStart<filter.to:absoluteStart<filter.to&&absoluteEnd>filter.from;
  }
  private hit(row:MaterialRevision,digest:string,part:MaterialUtterance|undefined,speaker:MaterialSpeaker|undefined,keyword:string):LocalMaterialHit{
    const out=new LocalMaterialHit();out.reference.material_id=row.material_id;out.reference.revision=row.revision;out.reference.text_revision=row.text_revision;
    out.reference.content_sha256=digest;out.reference.utterance_id=part?.utterance_id||'';out.reference.source_range=copyRange(part?.source_range);
    out.kind=row.source.kind;out.name=row.source.name;out.source_started=row.source.started;out.source_ended=row.source.ended;
    out.start_ms=part===undefined?null:part.start_ms;out.end_ms=part===undefined?null:part.end_ms;out.excerpt=excerpt(part===undefined?row.text:part.text,keyword);
    out.speaker_id=part?.speaker_id||'';out.speaker_label=speaker?.label||'';out.speaker_basis=part?.speaker_basis||'unknown';out.label_basis=speaker?.label_basis||'anonymous';
    out.is_self=speaker?.is_self===true&&speaker.label_basis==='user_confirmed';out.overlap=part?.overlap===true;
    out.transcription_state=row.transcription_state||'unknown';out.audio_available=row.source.audioAvailable;return out;
  }
}
