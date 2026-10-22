import { fileIo as fs } from '@kit.CoreFileKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { OggPrefix, appendLifelogPage } from './OggOpus';

export class OggFileIndex { path:string='';prefix:OggPrefix=new OggPrefix();sha256:string=''; }
// One immutable index per ASR instance, rebuilt after Worker/process exit.
// Cached offsets are never trusted from disk. Hash the durable prefix before
// reuse and after inference; only newly complete pages need CRC validation.
export class OggFileSource {
  index:OggFileIndex=new OggFileIndex();scannedPages:number=0;reusedFrames:number=0;
  private file:fs.File;private size:number=0;private closed:boolean=false;
  private closeFailure:(()=>void)|undefined=undefined;
  private block:Uint8Array=new Uint8Array(0);private blockAt:number=-1;
  constructor(path:string,sealed:boolean,cached:OggFileIndex|undefined,expectedBytes:number,expectedSha:string,onCloseFailure:(()=>void)|undefined=undefined){
    this.closeFailure=onCloseFailure;
    this.file=fs.openSync(path,fs.OpenMode.READ_ONLY);
    try{
      this.size=fs.statSync(this.file.fd).size;
      if(!Number.isSafeInteger(this.size)||this.size<0||this.size>16000000)throw new Error('ASR_WINDOW_SOURCE_TOO_LARGE');
      if(!Number.isSafeInteger(expectedBytes)||expectedBytes<0||expectedBytes>this.size||(expectedBytes>0&&!/^[a-f0-9]{64}$/.test(expectedSha)))throw new Error('ASR_SOURCE_CHECKPOINT_INVALID');
      const verifiedMd=cryptoFramework.createMd('SHA256');
      this.index.path=path;
      if(cached&&cached.path===path){
        if(cached.prefix.committedBytes>this.size||this.hash(cached.prefix.committedBytes,verifiedMd)!==cached.sha256)throw new Error('ASR_SOURCE_PREFIX_CHANGED');
        const prefix=this.index.prefix;
        prefix.offsets=cached.prefix.offsets.slice();prefix.committedBytes=cached.prefix.committedBytes;
        prefix.eos=cached.prefix.eos;prefix.serial=cached.prefix.serial;prefix.pages=cached.prefix.pages;prefix.packets=cached.prefix.packets;
        this.index.sha256=cached.sha256;this.reusedFrames=prefix.offsets.length;
      }
      const prefix=this.index.prefix;let at=prefix.committedBytes;
      while(!prefix.eos&&at+27<=this.size){
        const header=this.read(at,27);
        if(header[0]!==79||header[1]!==103||header[2]!==103||header[3]!==83||header[4]!==0)throw new Error('OGG_HEADER_INVALID');
        const count=header[26];if(at+27+count>this.size)break;
        const laces=this.read(at+27,count);let length=27+count;
        for(let i=0;i<count;i++)length+=laces[i];if(at+length>this.size)break;
        const page=this.read(at,length);appendLifelogPage(page,prefix,at);verifiedMd.updateSync({data:page});this.scannedPages++;at=prefix.committedBytes;
        if(prefix.offsets.length>60000)throw new Error('ASR_WINDOW_INVALID');
      }
      if((prefix.eos&&prefix.committedBytes!==this.size)||(sealed&&(!prefix.eos||prefix.committedBytes!==this.size)))throw new Error('OGG_ARCHIVE_INCOMPLETE');
      if(expectedBytes>prefix.committedBytes)throw new Error('ASR_SOURCE_CHECKPOINT_INVALID');
      this.index.sha256=this.digest(verifiedMd);
      if(expectedBytes>0){
        const actual=expectedBytes===prefix.committedBytes?this.index.sha256:
          cached&&cached.path===path&&expectedBytes===cached.prefix.committedBytes?cached.sha256:this.hash(expectedBytes);
        if(actual!==expectedSha)throw new Error('ASR_SOURCE_PREFIX_CHANGED');
      }
    }catch(error){this.close();throw new Error((error as Error).message);}
  }
  private exact(at:number,length:number):Uint8Array{
    if(this.closed||at<0||length<0||at+length>this.size)throw new Error('ASR_SOURCE_READ_INVALID');
    fs.lseek(this.file.fd,at,fs.WhenceType.SEEK_SET);const bytes=new Uint8Array(length);let done=0;
    while(done<length){const part=new ArrayBuffer(length-done),n=fs.readSync(this.file.fd,part);if(n<=0)throw new Error('ASR_SOURCE_READ_SHORT');bytes.set(new Uint8Array(part,0,n),done);done+=n;}return bytes;
  }
  private read(at:number,length:number):Uint8Array{
    if(length>65536)throw new Error('ASR_SOURCE_READ_INVALID');
    if(at>=this.blockAt&&at+length<=this.blockAt+this.block.length)return this.block.slice(at-this.blockAt,at-this.blockAt+length);
    const aligned=Math.floor(at/65536)*65536;this.block.fill(0);this.block=this.exact(aligned,Math.min(65536,this.size-aligned));this.blockAt=aligned;
    return at+length<=aligned+this.block.length?this.block.slice(at-aligned,at-aligned+length):this.exact(at,length);
  }
  private digest(md:cryptoFramework.Md):string{return Array.from(md.digestSync().data).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}
  private hash(length:number,also:cryptoFramework.Md|undefined=undefined):string{
    const md=cryptoFramework.createMd('SHA256');
    for(let at=0;at<length;at+=65536){const data=this.exact(at,Math.min(65536,length-at));md.updateSync({data});also?.updateSync({data});data.fill(0);}
    return this.digest(md);
  }
  frame(index:number):Uint8Array{
    if(!Number.isSafeInteger(index)||index<0||index>=this.index.prefix.offsets.length)throw new Error('ASR_FRAME_INVALID');
    return this.read(this.index.prefix.offsets[index],240);
  }
  verifyUnchanged():void{
    if(fs.statSync(this.file.fd).size<this.index.prefix.committedBytes||this.hash(this.index.prefix.committedBytes)!==this.index.sha256)throw new Error('ASR_SOURCE_PREFIX_CHANGED');
  }
  close():void{if(this.closed)return;this.closed=true;this.block.fill(0);this.block=new Uint8Array(0);try{fs.closeSync(this.file);}catch(error){try{this.closeFailure?.();}catch(_){}throw error as Error;}}
}
