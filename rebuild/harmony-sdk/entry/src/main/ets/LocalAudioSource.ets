import { fileIo as fs } from '@kit.CoreFileKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { MaterialStore,MaterialUtterance } from './MaterialStore';
import { OggFileSource } from './OggFileSource';

export class PlaybackSelection {kind:string='';name:string='';revision:number=0;utterance_id:string='';}
export class PlaybackReference {kind:string='';name:string='';audio_sha256:string='';format:string='';revision:number=0;utterance_id:string='';}
export interface PlaybackLease {reference:PlaybackReference;fd:number;length:number;start_ms:number;check:(strong:boolean)=>void;close:()=>void;}

export function validPlaybackSelection(value:PlaybackSelection):PlaybackSelection{
  if(!value||Object.keys(value).length!==4||Object.keys(value).some((key:string):boolean=>!['kind','name','revision','utterance_id'].includes(key))||
    !['recording','lifelog'].includes(value.kind)||typeof value.name!=='string'||
    !(value.kind==='recording'?/^take-[a-f0-9]{32}$/:/^seg-[a-f0-9]{32}$/).test(value.name)||
    !Number.isSafeInteger(value.revision)||value.revision<0||value.revision>999999999||typeof value.utterance_id!=='string'||value.utterance_id.length>256||
    /[\u0000-\u001f\u007f-\u009f]/.test(value.utterance_id)||(value.revision===0)!==(value.utterance_id===''))throw new Error('PLAYBACK_INVALID');
  const out=new PlaybackSelection();out.kind=value.kind;out.name=value.name;out.revision=value.revision;out.utterance_id=value.utterance_id;return out;
}

export interface LocalAudioSourcePorts {
  root:(kind:string)=>string;recordingWav:(name:string)=>string;materialRoot:()=>string;materials:MaterialStore;
}
class AudioFileFacts {path:string='';identity:string='';bytes:number=0;sha256:string='';header:Uint8Array=new Uint8Array(0);}
class AudioSourceFacts {
  selection:PlaybackSelection=new PlaybackSelection();root:string='';directory:string='';format:string='';audio:AudioFileFacts=new AudioFileFacts();
  markers:AudioFileFacts[]=[];fingerprint:string='';started:number=0;frames:number=0;frame_ms:number=0;duration_ms:number=0;start_ms:number=0;material_token:string='';
}
class RecordingAudioMetadata {version:number=0;uuid:string='';created:number=0;completed:boolean=false;valid:boolean=false;wavReady:boolean=false;}
class LifelogAudioMetadata {version:number|undefined=undefined;started:number=0;ended:number=0;frames:number|undefined=undefined;sealed:boolean|undefined=undefined;imported:boolean|undefined=undefined;}
const AUDIO_MAX:number=256*1024*1024;
const META_MAX:number=100000;

// Independent read handles perform validation. They never seek the descriptor
// handed to AVPlayer, whose position belongs to the media engine.
export class LocalAudioSource {
  private ports:LocalAudioSourcePorts;
  private closeUncertain:boolean=false;
  constructor(ports:LocalAudioSourcePorts){this.ports=ports;}
  private safe(error:Error):Error{const code=error.message;return new Error(['PLAYBACK_INVALID','PLAYBACK_SOURCE_UNAVAILABLE','PLAYBACK_INCOMPLETE','PLAYBACK_SOURCE_CHANGED','PLAYBACK_DELETED','PLAYBACK_ANCHOR_STALE','PLAYBACK_TIME_UNKNOWN'].includes(code)?code:'PLAYBACK_SOURCE_UNAVAILABLE');}
  private closeFile(file:fs.File):void{try{fs.closeSync(file);}catch(_){this.closeUncertain=true;throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');}}
  private missing(error:Error):boolean{const code=String((error as BusinessError).code);return code==='ENOENT'||code==='13900002';}
  private directory(path:string):boolean{
    // lstat of only the final directory follows an ancestor junction/symlink.
    // Check the entire absolute directory chain before opening any media.
    const normalized=path.replace(/\\/g,'/');let cursor:string='';let rest:string='';
    if(/^[A-Za-z]:\//.test(normalized)){cursor=normalized.slice(0,2);rest=normalized.slice(3);}
    else if(normalized.startsWith('/')&&!normalized.startsWith('//')){rest=normalized.slice(1);}
    else throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');
    const parts=rest.split('/');
    if(parts.some((part:string):boolean=>!part||part==='.'||part==='..'))throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');
    for(let index=0;index<parts.length;index++){
      cursor+='/'+parts[index];
      try{const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');}
      catch(error){if(index===parts.length-1&&this.missing(error as Error))return false;throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');}
    }
    return true;
  }
  private root(kind:string):string{
    const root=this.ports.root(kind).replace(/\\/g,'/').replace(/\/$/,'');
    if(!root||!(/^(\/|[A-Za-z]:\/)/.test(root))||root.split('/').some((part:string):boolean=>part==='..'||part==='.')||!this.directory(root))throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');
    return root;
  }
  private regular(path:string,limit:number):AudioFileFacts{
    try{
      const stat=fs.lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<=0||stat.size>limit)throw new Error('PLAYBACK_INCOMPLETE');
      const out=new AudioFileFacts();out.path=path;out.bytes=stat.size;out.identity=String(stat.ino)+'|'+stat.size+'|'+Number(stat.mtime)+'|'+Number(stat.ctime);return out;
    }catch(error){const code=(error as Error).message;if(code==='PLAYBACK_INCOMPLETE')throw new Error(code);throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');}
  }
  private same(path:string,expected:AudioFileFacts,limit:number):void{if(this.regular(path,limit).identity!==expected.identity)throw new Error('PLAYBACK_SOURCE_CHANGED');}
  private hashFile(path:string,limit:number,keep:number=0):AudioFileFacts{
    const out=this.regular(path,limit),file=fs.openSync(path,fs.OpenMode.READ_ONLY);
    try{
      const opened=fs.statSync(file.fd);if(String(opened.ino)+'|'+opened.size+'|'+Number(opened.mtime)+'|'+Number(opened.ctime)!==out.identity)throw new Error('PLAYBACK_SOURCE_CHANGED');
      out.header=new Uint8Array(Math.min(keep,out.bytes));const md=cryptoFramework.createMd('SHA256');let at=0;
      while(at<out.bytes){
        const buffer=new ArrayBuffer(Math.min(65536,out.bytes-at));const n=fs.readSync(file.fd,buffer,{length:buffer.byteLength});
        if(!Number.isSafeInteger(n)||n<=0||n>buffer.byteLength)throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');
        const bytes=new Uint8Array(buffer,0,n);md.updateSync({data:bytes});if(at<out.header.length)out.header.set(bytes.slice(0,Math.min(n,out.header.length-at)),at);at+=n;bytes.fill(0);
      }
      const extra=new ArrayBuffer(1);if(fs.readSync(file.fd,extra,{length:1})!==0||fs.statSync(file.fd).size!==out.bytes)throw new Error('PLAYBACK_SOURCE_CHANGED');
      this.same(path,out,limit);const bytes=md.digestSync().data;try{out.sha256=Array.from(bytes).map((part:number):string=>part.toString(16).padStart(2,'0')).join('');}finally{bytes.fill(0);}return out;
    }finally{this.closeFile(file);}
  }
  private metadata(path:string):AudioFileFacts{return this.hashFile(path,META_MAX,META_MAX);}
  private text(file:AudioFileFacts):string{
    const value=new util.TextDecoder().decodeToString(file.header),roundtrip=new util.TextEncoder().encodeInto(value);
    try{if(roundtrip.length!==file.header.length||roundtrip.some((byte:number,index:number):boolean=>byte!==file.header[index]))throw new Error('PLAYBACK_INCOMPLETE');return value;}finally{roundtrip.fill(0);file.header.fill(0);}
  }
  private wav(file:AudioFileFacts,channels:number):number{
    const b=file.header;if(b.length!==44)throw new Error('PLAYBACK_INCOMPLETE');
    const ascii=(at:number,value:string):boolean=>Array.from(value).every((letter:string,index:number):boolean=>b[at+index]===letter.charCodeAt(0));
    const view=new DataView(b.buffer,b.byteOffset,b.byteLength);
    if(!ascii(0,'RIFF')||!ascii(8,'WAVE')||!ascii(12,'fmt ')||!ascii(36,'data')||view.getUint32(4,true)!==file.bytes-8||view.getUint32(16,true)!==16||
      view.getUint16(20,true)!==1||view.getUint16(22,true)!==channels||view.getUint32(24,true)!==16000||view.getUint32(28,true)!==16000*channels*2||
      view.getUint16(32,true)!==channels*2||view.getUint16(34,true)!==16||view.getUint32(40,true)!==file.bytes-44||(file.bytes-44)%(channels*2)!==0||file.bytes<=44)throw new Error('PLAYBACK_INCOMPLETE');
    return (file.bytes-44)/(channels*32);
  }
  private materialToken(selection:PlaybackSelection):string{
    const root=this.ports.materialRoot().replace(/\\/g,'/').replace(/\/$/,'');if(!root||!this.directory(root))throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');
    const directory=root+'/'+this.ports.materials.idFor(selection.kind,selection.name);if(!this.directory(directory))return '';
    const names=fs.listFileSync(directory);if(names.length>4096)throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');
    const versions=names.filter((name:string):boolean=>/^revision-[0-9]{9}\.json$/.test(name)).sort();const name=versions.pop();if(!name)return '';
    const file=this.regular(directory+'/'+name,4000000);return name+'|'+file.identity;
  }
  private material(facts:AudioSourceFacts):void{
    const selection=facts.selection,token=this.materialToken(selection),row=this.ports.materials.read(this.ports.materials.idFor(selection.kind,selection.name));
    if(this.materialToken(selection)!==token)throw new Error('PLAYBACK_ANCHOR_STALE');facts.material_token=token;
    if(row?.operation==='delete')throw new Error('PLAYBACK_DELETED');
    if(row&&(row.source.kind!==selection.kind||row.source.name!==selection.name))throw new Error('PLAYBACK_SOURCE_CHANGED');
    if(selection.revision===0)return;
    if(!row||row.revision!==selection.revision||row.source.started!==facts.started)throw new Error('PLAYBACK_ANCHOR_STALE');
    const part=row.utterances.find((entry:MaterialUtterance):boolean=>entry.utterance_id===selection.utterance_id);if(!part)throw new Error('PLAYBACK_ANCHOR_STALE');
    if(part.start_ms===null||part.end_ms===null||!Number.isSafeInteger(part.start_ms)||!Number.isSafeInteger(part.end_ms)||part.start_ms<0||part.end_ms<part.start_ms||part.end_ms>facts.duration_ms||part.start_ms>=facts.duration_ms)throw new Error('PLAYBACK_TIME_UNKNOWN');
    facts.start_ms=part.start_ms;
  }
  private inspect(selection:PlaybackSelection):AudioSourceFacts{
    const out=new AudioSourceFacts();out.selection=selection;out.root=this.root(selection.kind);out.directory=out.root+'/'+selection.name;
    if(!this.directory(out.directory))throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');
    if(selection.kind==='recording'){
      const meta=this.metadata(out.directory+'/manifest.json'),row=JSON.parse(this.text(meta)) as RecordingAudioMetadata;
      if(!row||row.version!==1||row.wavReady!==true||row.completed!==true||row.valid!==true||!Number.isSafeInteger(row.created)||row.created<0)throw new Error('PLAYBACK_INCOMPLETE');
      const raw=this.hashFile(out.directory+'/source.rawopus',33554432);if(raw.bytes%240!==0)throw new Error('PLAYBACK_INCOMPLETE');
      const expected=out.directory+'/audio.wav';this.regular(expected,AUDIO_MAX);let verified:string='';try{verified=this.ports.recordingWav(selection.name).replace(/\\/g,'/');}catch(_){throw new Error('PLAYBACK_INCOMPLETE');}
      if(verified!==expected)throw new Error('PLAYBACK_SOURCE_CHANGED');
      out.audio=this.hashFile(expected,AUDIO_MAX,44);out.duration_ms=this.wav(out.audio,2);out.frames=raw.bytes/240;out.frame_ms=20;
      if(out.audio.bytes!==44+out.frames*1280||out.duration_ms!==out.frames*20)throw new Error('PLAYBACK_INCOMPLETE');
      out.started=row.created;out.format='wav';out.markers=[meta,raw];
    }else{
      const meta=this.metadata(out.directory+'/meta.json'),row=JSON.parse(this.text(meta)) as LifelogAudioMetadata;
      if(!row||!Number.isSafeInteger(row.started)||row.started<0||!Number.isSafeInteger(row.ended)||row.ended<=row.started||
        (row.version!==undefined&&row.version!==1&&row.version!==2)||row.sealed===false||(row.version===2&&row.sealed!==true))throw new Error('PLAYBACK_INCOMPLETE');
      out.started=row.started;out.frame_ms=60;out.markers=[meta];
      const ogg=out.directory+'/audio.ogg';let hasOgg=true;try{fs.lstatSync(ogg);}catch(error){if(this.missing(error as Error))hasOgg=false;else throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');}
      if(hasOgg){
        out.audio=this.hashFile(ogg,16000000);let source:OggFileSource|undefined=undefined;
        try{source=new OggFileSource(ogg,true,undefined,0,'',():void=>{this.closeUncertain=true;});source.verifyUnchanged();out.frames=source.index.prefix.offsets.length;if(source.index.sha256!==out.audio.sha256||out.frames<=0)throw new Error('PLAYBACK_SOURCE_CHANGED');}
        catch(error){if((error as Error).message==='PLAYBACK_SOURCE_CHANGED')throw error as Error;throw new Error('PLAYBACK_INCOMPLETE');}
        finally{source?.close();}
        out.format='ogg';out.duration_ms=out.frames*60;
      }else{
        out.audio=this.hashFile(out.directory+'/audio.wav',AUDIO_MAX,44);out.duration_ms=this.wav(out.audio,1);out.frames=out.duration_ms/60;
        if(!Number.isSafeInteger(out.frames)||out.frames<=0)throw new Error('PLAYBACK_INCOMPLETE');out.format='wav';
        const raw=out.directory+'/source.opus';let hasRaw=true;try{fs.lstatSync(raw);}catch(error){if(this.missing(error as Error))hasRaw=false;else throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');}
        if(hasRaw){const file=this.hashFile(raw,16000000);if(file.bytes!==out.frames*240)throw new Error('PLAYBACK_INCOMPLETE');out.markers.push(file);}
      }
      if(row.frames!==undefined&&(!Number.isSafeInteger(row.frames)||row.frames!==out.frames))throw new Error('PLAYBACK_INCOMPLETE');
      if(row.version===2&&row.frames===undefined)throw new Error('PLAYBACK_INCOMPLETE');
    }
    if(out.duration_ms<=0||out.duration_ms>86400000)throw new Error('PLAYBACK_INCOMPLETE');
    this.same(out.audio.path,out.audio,AUDIO_MAX);for(const marker of out.markers)this.same(marker.path,marker,marker.path.endsWith('.json')?META_MAX:33554432);
    out.fingerprint=out.audio.sha256+'|'+out.markers.map((marker:AudioFileFacts):string=>marker.path+'|'+marker.sha256).join('|');this.material(out);return out;
  }
  resolve(value:PlaybackSelection):PlaybackLease{
    try{
      if(this.closeUncertain)throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');
      const selection=validPlaybackSelection(value),facts=this.inspect(selection),file=fs.openSync(facts.audio.path,fs.OpenMode.READ_ONLY);let closed=false;
      const check=(strong:boolean):void=>{
        try{
        if(this.closeUncertain)throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');if(closed)throw new Error('PLAYBACK_SOURCE_CHANGED');
        if(this.root(selection.kind)!==facts.root||!this.directory(facts.directory))throw new Error('PLAYBACK_SOURCE_CHANGED');
        const stat=fs.statSync(file.fd);if(String(stat.ino)+'|'+stat.size+'|'+Number(stat.mtime)+'|'+Number(stat.ctime)!==facts.audio.identity)throw new Error('PLAYBACK_SOURCE_CHANGED');
        this.same(facts.audio.path,facts.audio,AUDIO_MAX);for(const marker of facts.markers)this.same(marker.path,marker,marker.path.endsWith('.json')?META_MAX:33554432);
        if(strong){const fresh=this.inspect(selection);if(fresh.fingerprint!==facts.fingerprint||fresh.start_ms!==facts.start_ms)throw new Error('PLAYBACK_SOURCE_CHANGED');facts.material_token=fresh.material_token;}
        else if(this.materialToken(selection)!==facts.material_token)this.material(facts);
        }catch(error){throw this.safe(error as Error);}
      };
      try{check(false);}catch(error){closed=true;this.closeFile(file);throw error as Error;}
      const reference=new PlaybackReference();reference.kind=selection.kind;reference.name=selection.name;reference.audio_sha256=facts.audio.sha256;reference.format=facts.format;reference.revision=selection.revision;reference.utterance_id=selection.utterance_id;
      let closeFailed:boolean=false;
      const lease:PlaybackLease={reference:reference,fd:file.fd,length:facts.audio.bytes,start_ms:facts.start_ms,check:check,close:():void=>{if(closeFailed)throw new Error('PLAYBACK_SOURCE_UNAVAILABLE');if(closed)return;closed=true;try{this.closeFile(file);}catch(error){closeFailed=true;throw error as Error;}}};
      return lease;
    }catch(error){throw this.safe(error as Error);}
  }
}
