// A serial decoder and bounded overlap cache. Native state never goes to disk.
export class LifelogPcmWindow {
  static readonly capacity:number=512;
  decodedFrames:number=0;reusedFrames:number=0;replayedFrames:number=0;resetForWindow:boolean=false;
  private path:string='';private sha:string='';private active:boolean=false;
  private first:number=0;private next:number=0;private end:number=0;private pcm:Float32Array[]=[];
  private resetNative:()=>void;private closeNative:()=>void;
  constructor(resetNative:()=>void,closeNative:()=>void){this.resetNative=resetNative;this.closeNative=closeNative;}
  get nextDecodedFrame():number{return this.next;}
  get retainedFrames():number{return this.pcm.length;}
  begin(path:string,verifiedPreviousSha:string,start:number,end:number):void{
    if(!path||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start)throw new Error('PCM_WINDOW_INVALID');
    this.decodedFrames=0;this.reusedFrames=0;this.resetForWindow=false;
    if(!this.active||this.path!==path||!this.sha||this.sha!==verifiedPreviousSha||start<this.first){
      this.invalidate();this.resetNative();this.active=true;this.path=path;this.resetForWindow=true;
    }
    this.end=end;this.replayedFrames=Math.max(0,start-this.next);
  }
  read(index:number,decode:(index:number)=>Float32Array):Float32Array{
    if(!this.active||!Number.isSafeInteger(index)||index<this.first||index>this.next||index>=this.end)throw new Error('PCM_WINDOW_ORDER_INVALID');
    if(index<this.next){this.reusedFrames++;return this.pcm[index-this.first];}
    try{
      const samples=decode(index);if(samples.length!==960)throw new Error('PCM_FRAME_SIZE_INVALID');
      this.pcm.push(samples);this.next++;this.decodedFrames++;
      if(this.pcm.length>LifelogPcmWindow.capacity){this.pcm.shift();this.first++;}
      return samples;
    }catch(error){this.invalidate();throw new Error((error as Error).message);}
  }
  commit(sha:string):void{
    if(!this.active||this.next<this.end||!/^[a-f0-9]{64}$/.test(sha))throw new Error('PCM_WINDOW_COMMIT_INVALID');this.sha=sha;
  }
  invalidate():void{
    const close=this.active;this.active=false;this.path='';this.sha='';this.first=0;this.next=0;this.end=0;
    for(const samples of this.pcm)samples.fill(0);this.pcm=[];
    if(close)this.closeNative();
  }
}
export class CodecWindowResult {
  start:number=0;end:number=0;equal:boolean=false;referenceSha256:string='';cachedSha256:string='';
  decodedFrames:number=0;reusedFrames:number=0;replayedFrames:number=0;retainedFrames:number=0;
}
export class CodecCheckResult {
  schema:number=1;frames:number=0;capacityFrames:number=LifelogPcmWindow.capacity;
  equivalent:boolean=false;windows:CodecWindowResult[]=[];
}
