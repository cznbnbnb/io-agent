import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { RecordingCaptureHandle } from './RecordingSession';
import { TaskRecordingOrigin } from './TaskRecordingTypes';

export class RecordingTaskInput {
  schema:number=1;name:string='';uuid:string='';owner_id:string='';cleanup_id:string='';peer:string='';
  created:number=0;raw_bytes:number=0;raw_sha256:string='';exit_evidence:string='none';
}
class RecordingTaskManifest {
  version:number=0;uuid:string='';peer:string='';created:number=0;completed:boolean=false;
  valid:boolean=false;wavReady:boolean=false;coverage:number[][]=[];
  voice_owner:string='';voice_cleanup_id:string='';voice_exit_evidence:string='none';
}
class RecordingTaskSeal {
  schema:number=1;input:RecordingTaskInput=new RecordingTaskInput();result_sha256:string='';
}
class RecordingTaskStat { size:number=0;mtime:number=0; }
function invalid(reason:string='INVALID'):Error{return new Error('RECORDING_TASK_SOURCE_'+reason);}
function keys(value:Object,names:string[]):boolean{return JSON.stringify(Object.keys(value).sort())===JSON.stringify(names.slice().sort());}
function digestHex(md:cryptoFramework.Md):string{
  const bytes=md.digestSync().data;
  try{if(bytes.length!==32)throw invalid('HASH');return Array.from(bytes).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}
  finally{bytes.fill(0);}
}
function validPeer(value:string):boolean{return typeof value==='string'&&value.length>0&&value.length<=128&&!/[\u0000-\u0020\u007f]/.test(value);}
function validateInput(input:RecordingTaskInput):void{
  if(!input||typeof input!=='object'||Array.isArray(input)||!keys(input,['schema','name','uuid','owner_id','cleanup_id','peer','created','raw_bytes','raw_sha256','exit_evidence'])||
    input.schema!==1||typeof input.name!=='string'||!/^take-[a-f0-9]{32}$/.test(input.name)||typeof input.uuid!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(input.uuid)||
    typeof input.owner_id!=='string'||!/^voice-[a-f0-9]{32}$/.test(input.owner_id)||typeof input.cleanup_id!=='string'||!/^[a-f0-9]{32}$/.test(input.cleanup_id)||!validPeer(input.peer)||
    !Number.isSafeInteger(input.created)||input.created<0||!Number.isSafeInteger(input.raw_bytes)||input.raw_bytes<=0||input.raw_bytes>1048576||input.raw_bytes%240!==0||
    typeof input.raw_sha256!=='string'||!/^[a-f0-9]{64}$/.test(input.raw_sha256)||typeof input.exit_evidence!=='string'||!['device_event','user_confirmation'].includes(input.exit_evidence))throw invalid();
}
function sameInput(first:RecordingTaskInput,second:RecordingTaskInput):boolean{
  return first.schema===second.schema&&first.name===second.name&&first.uuid===second.uuid&&first.owner_id===second.owner_id&&first.cleanup_id===second.cleanup_id&&first.peer===second.peer&&
    first.created===second.created&&first.raw_bytes===second.raw_bytes&&first.raw_sha256===second.raw_sha256&&first.exit_evidence===second.exit_evidence;
}
function hashResult(value:string):string{
  if(typeof value!=='string'||!value.length||value.length>4000000)throw invalid('RESULT');
  // Encode complete Unicode scalars, so distinct invalid UTF-16 strings cannot
  // collapse to the same replacement-character UTF-8 receipt.
  for(let i=0;i<value.length;i++){
    const code=value.charCodeAt(i);
    if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw invalid('RESULT');}
    else if(code>=0xdc00&&code<=0xdfff)throw invalid('RESULT');
  }
  const md=cryptoFramework.createMd('SHA256'),encoder=new util.TextEncoder();let offset=0;
  while(offset<value.length){
    let end=Math.min(value.length,offset+16384);const last=value.charCodeAt(end-1);if(end<value.length&&last>=0xd800&&last<=0xdbff)end--;
    const bytes=encoder.encodeInto(value.slice(offset,end));try{md.updateSync({data:bytes});}finally{bytes.fill(0);}offset=end;
  }
  return digestHex(md);
}

// A local raw-input/result association, not voice consent or proof that no late
// packets exist. The caller owns canonical revision and late-UUID validation.
export class RecordingTaskSourceStore {
  private root:string='';
  initialize(filesDir:string):void{
    if(typeof filesDir!=='string'||!filesDir||!(filesDir.startsWith('/')||/^[A-Za-z]:\//.test(filesDir))||filesDir.length>4096||filesDir.includes('\\')||filesDir.includes('//')||/[\u0000-\u001f\u007f]/.test(filesDir)||
      filesDir.endsWith('/')||filesDir.split('/').some((part:string):boolean=>part==='.'||part==='..'))throw invalid('PATH');
    this.root=filesDir+'/recordings';
  }
  private name(directory:string):string{
    const name=typeof directory==='string'?directory.slice(directory.lastIndexOf('/')+1):'';
    if(!this.root||!/^take-[a-f0-9]{32}$/.test(name)||directory!==this.root+'/'+name)throw invalid('PATH');return name;
  }
  private text(path:string,maximum:number):string{
    const size=fs.statSync(path).size;if(!Number.isSafeInteger(size)||size<=0||size>maximum)throw invalid();
    const text=fs.readTextSync(path);if(typeof text!=='string'||!text.length||text.length>maximum)throw invalid();return text;
  }
  private readSeal(directory:string):RecordingTaskSeal|null{
    const path=directory+'/task-asr-source.json';if(!fs.accessSync(path))return null;
    try{
      const row=JSON.parse(this.text(path,8192)) as RecordingTaskSeal;
      if(!row||typeof row!=='object'||Array.isArray(row)||!keys(row,['schema','input','result_sha256'])||row.schema!==1||
        typeof row.result_sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.result_sha256))throw invalid();
      validateInput(row.input);return row;
    }catch(_){throw invalid('RECEIPT');}
  }
  private stat(path:string|number):RecordingTaskStat{
    const value=fs.statSync(path),out=new RecordingTaskStat();
    if(!Number.isSafeInteger(value.size)||value.size<0||typeof value.mtime!=='number'||!Number.isFinite(value.mtime))throw invalid('CHANGED');
    out.size=value.size;out.mtime=value.mtime;return out;
  }
  private sameStat(first:RecordingTaskStat,second:RecordingTaskStat):boolean{return first.size===second.size&&first.mtime===second.mtime;}
  input(directory:string):RecordingTaskInput|null{return this.snapshot(directory,false);}
  private snapshot(directory:string,ownPartial:boolean):RecordingTaskInput|null{
    const name=this.name(directory),manifestPath=directory+'/manifest.json',receiptPath=directory+'/task-asr-source.json';
    if(!ownPartial&&fs.accessSync(receiptPath+'.partial'))throw invalid('PARTIAL');
    const receipt=this.readSeal(directory);
    if(!fs.accessSync(manifestPath)){if(receipt)throw invalid('CHANGED');return null;}
    let manifest:RecordingTaskManifest;const before=this.text(manifestPath,100000);
    try{manifest=JSON.parse(before) as RecordingTaskManifest;}catch(_){throw invalid('MANIFEST');}
    if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw invalid('MANIFEST');
    if(typeof manifest.voice_owner!=='string'||!/^voice-[a-f0-9]{32}$/.test(manifest.voice_owner)){
      if(receipt||manifest.voice_owner!==undefined&&manifest.voice_owner!==''||manifest.voice_cleanup_id!==undefined&&manifest.voice_cleanup_id!==''||
        manifest.voice_exit_evidence!==undefined&&manifest.voice_exit_evidence!=='none')throw invalid('MANIFEST');return null;
    }
    if(fs.accessSync(directory+'/manifest.next')||fs.accessSync(directory+'/manifest.json.partial'))throw invalid('PARTIAL');
    if(manifest.version!==1||manifest.completed!==true||manifest.valid!==true||manifest.wavReady!==true||typeof manifest.uuid!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(manifest.uuid)||
      !validPeer(manifest.peer)||!Number.isSafeInteger(manifest.created)||manifest.created<0||typeof manifest.voice_cleanup_id!=='string'||!/^[a-f0-9]{32}$/.test(manifest.voice_cleanup_id)||
      typeof manifest.voice_exit_evidence!=='string'||!['device_event','user_confirmation'].includes(manifest.voice_exit_evidence))throw invalid('MANIFEST');
    const rawPath=directory+'/source.rawopus',wavPath=directory+'/audio.wav',raw=this.stat(rawPath),wav=this.stat(wavPath);
    if(raw.size<=0||raw.size>1048576||raw.size%240!==0||wav.size!==44+raw.size/240*1280||!Array.isArray(manifest.coverage)||manifest.coverage.length!==1||
      !Array.isArray(manifest.coverage[0])||manifest.coverage[0].length!==2||manifest.coverage[0][0]!==0||manifest.coverage[0][1]!==raw.size)throw invalid('INCOMPLETE');
    const md=cryptoFramework.createMd('SHA256'),file=fs.openSync(rawPath,fs.OpenMode.READ_ONLY);let offset=0;
    try{
      if(!this.sameStat(raw,this.stat(file.fd)))throw invalid('CHANGED');
      while(offset<raw.size){
        const bytes=new Uint8Array(Math.min(65536,raw.size-offset));let part=new Uint8Array();
        try{
          const n=fs.readSync(file.fd,bytes.buffer,{length:bytes.length});
          if(!Number.isSafeInteger(n)||n<=0||n>bytes.length)throw invalid('CHANGED');
          part=n===bytes.length?bytes:bytes.slice(0,n);md.updateSync({data:part});offset+=n;
        }finally{part.fill(0);bytes.fill(0);}
      }
      const extra=new Uint8Array(1);try{if(fs.readSync(file.fd,extra.buffer,{length:1})!==0)throw invalid('CHANGED');}finally{extra.fill(0);}
      if(!this.sameStat(raw,this.stat(file.fd)))throw invalid('CHANGED');
    }finally{fs.closeSync(file);}
    if((!ownPartial&&fs.accessSync(receiptPath+'.partial'))||fs.accessSync(directory+'/manifest.next')||fs.accessSync(directory+'/manifest.json.partial'))throw invalid('PARTIAL');
    if(before!==this.text(manifestPath,100000)||!this.sameStat(raw,this.stat(rawPath))||!this.sameStat(wav,this.stat(wavPath)))throw invalid('CHANGED');
    const out=new RecordingTaskInput();out.name=name;out.uuid=manifest.uuid;out.owner_id=manifest.voice_owner;out.cleanup_id=manifest.voice_cleanup_id;out.peer=manifest.peer;
    out.created=manifest.created;out.raw_bytes=raw.size;out.raw_sha256=digestHex(md);out.exit_evidence=manifest.voice_exit_evidence;validateInput(out);
    if(receipt&&!sameInput(out,receipt.input))throw invalid('CHANGED');return out;
  }
  seal(directory:string,input:RecordingTaskInput,resultJson:string):void{
    this.name(directory);validateInput(input);const resultHash=hashResult(resultJson),fresh=this.input(directory);
    if(!fresh||!sameInput(input,fresh))throw invalid('CHANGED');
    const existing=this.readSeal(directory);
    if(existing){if(existing.result_sha256!==resultHash||!sameInput(existing.input,input))throw invalid('CONFLICT');return;}
    const row=new RecordingTaskSeal();row.input=JSON.parse(JSON.stringify(fresh)) as RecordingTaskInput;row.result_sha256=resultHash;
    const path=directory+'/task-asr-source.json',body=JSON.stringify(row),bytes=new util.TextEncoder().encodeInto(body);
    if(fs.accessSync(path)||fs.accessSync(path+'.partial')){bytes.fill(0);throw invalid('CONFLICT');}
    const file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY);
    try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(!Number.isSafeInteger(n)||n<=0||n>bytes.length-offset)throw invalid('WRITE');offset+=n;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}
    const after=this.snapshot(directory,true);
    if(!after||!sameInput(after,input)||this.text(path+'.partial',8192)!==body||fs.accessSync(path))throw invalid('CHANGED');
    fs.renameSync(path+'.partial',path);
  }
  origin(handle:RecordingCaptureHandle,materialId:string,revision:number,resultJson:string):TaskRecordingOrigin{
    if(!handle||typeof handle!=='object'||typeof handle.directory!=='string'||typeof materialId!=='string'||!materialId.length||materialId.length>128||!Number.isSafeInteger(revision)||revision<1)throw invalid();
    const input=this.input(handle.directory),receipt=this.readSeal(handle.directory);
    if(!input||!receipt||!sameInput(input,receipt.input)||receipt.result_sha256!==hashResult(resultJson)||handle.ownerId!==input.owner_id||handle.cleanupId!==input.cleanup_id||
      handle.uuid!==input.uuid||handle.peer!==input.peer)throw invalid('ORIGIN');
    const out=new TaskRecordingOrigin();out.name=input.name;out.uuid=input.uuid;out.owner_id=input.owner_id;out.cleanup_id=input.cleanup_id;out.peer=input.peer;
    out.raw_bytes=input.raw_bytes;out.raw_sha256=input.raw_sha256;out.result_sha256=receipt.result_sha256;out.material_id=materialId;out.material_revision=revision;out.exit_evidence=input.exit_evidence;return out;
  }
}
