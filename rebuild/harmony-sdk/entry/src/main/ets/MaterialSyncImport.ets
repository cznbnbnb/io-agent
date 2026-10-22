import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { MaterialSyncTarget, validateMaterialSyncTarget } from './MaterialSyncTransport';

// A candidate carries credentials only in the caller's private state. Parsing
// neither persists it nor enables discovery, uploads or a background worker.
export class MaterialSyncImportCandidate {
  target:MaterialSyncTarget=new MaterialSyncTarget();expiresAt:number=0;tokenId:string='';
}

const IMPORT_LIMIT:number=8192;
const IMPORT_FIELDS:string[]=['format','base_url','owner_id','producer_id','server_id','token','token_id','expires_at'];

// This deliberately accepts only one flat object of string values. Scan before
// constructing the object so JSON.parse cannot silently discard duplicate keys,
// including an escaped spelling of a name already seen.
class MaterialImportReader {
  private text:string;private offset:number=0;
  constructor(text:string){this.text=text;}
  private invalid():void{throw new Error('SYNC_IMPORT_INVALID');}
  private whitespace():void{
    while(this.offset<this.text.length&&/[\x20\t\r\n]/.test(this.text[this.offset]))this.offset++;
  }
  private consume(expected:string):void{
    this.whitespace();if(this.text[this.offset]!==expected)this.invalid();this.offset++;
  }
  private string():string{
    this.whitespace();if(this.text[this.offset]!=='"')this.invalid();const start=this.offset++;
    while(this.offset<this.text.length){
      const c=this.text[this.offset++];
      if(c==='\\')this.offset++;
      else if(c==='"')return JSON.parse(this.text.slice(start,this.offset)) as string;
    }
    throw new Error('SYNC_IMPORT_INVALID');
  }
  read():Record<string,string>{
    this.consume('{');const values:Record<string,string>={};const names:string[]=[];
    this.whitespace();if(this.text[this.offset]==='}')this.invalid();
    while(this.offset<this.text.length){
      const name=this.string();
      if(!IMPORT_FIELDS.includes(name)||names.includes(name))this.invalid();
      names.push(name);this.consume(':');values[name]=this.string();this.whitespace();
      const delimiter=this.text[this.offset++];if(delimiter==='}')break;
      if(delimiter!==','||names.length>=IMPORT_FIELDS.length)this.invalid();
    }
    this.whitespace();
    if(this.offset!==this.text.length||names.length!==IMPORT_FIELDS.length)this.invalid();
    return values;
  }
}

export function parseMaterialSyncImport(bytes:Uint8Array,now:number=Date.now()):MaterialSyncImportCandidate{
  try{
    if(bytes.length<1||bytes.length>IMPORT_LIMIT||!Number.isSafeInteger(now)||now<0)throw new Error('SYNC_IMPORT_INVALID');
    const text=new util.TextDecoder('utf-8',{fatal:true}).decodeToString(bytes);
    const values=new MaterialImportReader(text).read();
    if(values['format']!=='turboio-material-sync/1'||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(values['token_id'])||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(values['expires_at']))throw new Error('SYNC_IMPORT_INVALID');
    const expires=Date.parse(values['expires_at']);
    // Date.parse can normalize an impossible day; compare its calendar fields.
    if(!Number.isFinite(expires)||new Date(expires).toISOString().slice(0,19)!==values['expires_at'].slice(0,19))throw new Error('SYNC_IMPORT_INVALID');
    const candidate=new MaterialSyncImportCandidate();candidate.target.baseUrl=values['base_url'];candidate.target.token=values['token'];
    candidate.target.principal.ownerId=values['owner_id'];candidate.target.principal.producerId=values['producer_id'];candidate.target.principal.serverId=values['server_id'];
    candidate.target.baseUrl=validateMaterialSyncTarget(candidate.target);candidate.expiresAt=expires;candidate.tokenId=values['token_id'];
    if(expires<=now)throw new Error('SYNC_IMPORT_EXPIRED');return candidate;
  }catch(error){
    if((error as Error)?.message==='SYNC_IMPORT_EXPIRED')throw new Error('SYNC_IMPORT_EXPIRED');
    // No decoder, parser or platform message may echo credential bytes.
    throw new Error('SYNC_IMPORT_INVALID');
  }
}

// Both a selected document URI and a fixed app-private import path use the same
// bounded reader. All buffers owned here are cleared on success and failure;
// the returned candidate necessarily retains string credentials until discarded.
export function readMaterialSyncImportFile(uri:string,now:number=Date.now()):MaterialSyncImportCandidate{
  try{
    if(typeof uri!=='string'||!uri||uri.length>2048||uri.includes('\u0000'))throw new Error('SYNC_IMPORT_READ_FAILED');
    const file=fs.openSync(uri,fs.OpenMode.READ_ONLY);let bytes=new Uint8Array(0);
    try{
      const stat=fs.statSync(file.fd),size=stat.size;
      if(!stat.isFile()||!Number.isSafeInteger(size)||size<1||size>IMPORT_LIMIT)throw new Error('SYNC_IMPORT_INVALID');
      bytes=new Uint8Array(size);let offset=0;
      while(offset<size){
        const part=new Uint8Array(Math.min(1024,size-offset));
        try{
          const count=fs.readSync(file.fd,part.buffer,{length:part.length});
          if(!Number.isSafeInteger(count)||count<1||count>part.length)throw new Error('SYNC_IMPORT_READ_FAILED');
          bytes.set(part.subarray(0,count),offset);offset+=count;
        }finally{part.fill(0);}
      }
      const tail=new Uint8Array(1);
      try{
        if(fs.readSync(file.fd,tail.buffer,{length:1})!==0||fs.statSync(file.fd).size!==size)throw new Error('SYNC_IMPORT_READ_FAILED');
      }finally{tail.fill(0);}
      return parseMaterialSyncImport(bytes,now);
    }finally{bytes.fill(0);fs.closeSync(file);}
  }catch(error){
    const code=(error as Error)?.message;
    if(code==='SYNC_IMPORT_INVALID'||code==='SYNC_IMPORT_EXPIRED')throw new Error(code);
    throw new Error('SYNC_IMPORT_READ_FAILED');
  }
}
