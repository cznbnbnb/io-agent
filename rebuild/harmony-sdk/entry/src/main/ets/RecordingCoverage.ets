export class ByteRange { start:number=0; end:number=0; }
// Pure extent accounting; caller MUST compare overlapping bytes before accept.
export class RecordingCoverage {
  ranges:ByteRange[]=[]; invalid:boolean=false;
  static readonly limit:number=32*1024*1024;
  validate(offset:number,length:number):void{
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>16384||offset+length>RecordingCoverage.limit)throw new Error('录音数据范围异常');
  }
  overlap(offset:number,length:number):ByteRange[]{this.validate(offset,length);const out:ByteRange[]=[];for(const r of this.ranges){const start=Math.max(r.start,offset),end=Math.min(r.end,offset+length);if(end>start){const item=new ByteRange();item.start=start;item.end=end;out.push(item);}}return out;}
  accept(offset:number,length:number):void{
    this.validate(offset,length);const item=new ByteRange();item.start=offset;item.end=offset+length;
    const sorted=[...this.ranges,item].sort((a,b)=>a.start-b.start),merged:ByteRange[]=[];
    for(const range of sorted){const last=merged[merged.length-1];if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);else{const copy=new ByteRange();copy.start=range.start;copy.end=range.end;merged.push(copy);}}
    if(merged.length>2048){this.invalid=true;throw new Error('录音缺口过多');}this.ranges=merged;
  }
  length():number{return this.ranges.reduce((n,r)=>n+r.end-r.start,0);}
  complete():boolean{return !this.invalid&&this.ranges.length===1&&this.ranges[0].start===0&&this.ranges[0].end>0&&this.ranges[0].end%240===0;}
}
export function stereoWavHeader(pcmBytes:number):Uint8Array{
  if(!Number.isInteger(pcmBytes)||pcmBytes<0||pcmBytes%4!==0||pcmBytes>200000000)throw new Error('WAV 长度无效');
  const bytes=new Uint8Array(44),view=new DataView(bytes.buffer);
  const text=(at:number,value:string):void=>{for(let i=0;i<value.length;i++)bytes[at+i]=value.charCodeAt(i);};
  text(0,'RIFF');view.setUint32(4,pcmBytes+36,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,16000,true);view.setUint32(28,64000,true);view.setUint16(32,4,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,pcmBytes,true);return bytes;
}
// 全天智记解码输出：16 kHz 单声道 16-bit（60ms/960样本/帧）。
export function monoWavHeader(pcmBytes:number):Uint8Array{
  if(!Number.isInteger(pcmBytes)||pcmBytes<0||pcmBytes%2!==0||pcmBytes>200000000)throw new Error('WAV 长度无效');
  const bytes=new Uint8Array(44),view=new DataView(bytes.buffer);
  const text=(at:number,value:string):void=>{for(let i=0;i<value.length;i++)bytes[at+i]=value.charCodeAt(i);};
  text(0,'RIFF');view.setUint32(4,pcmBytes+36,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,pcmBytes,true);return bytes;
}
