// Original bounded implementation of the inspected TransferMessage protobuf.
// Small-core business=17 and launcher business=18 share this protobuf format.
// This is not a JSON business envelope. No arbitrary paths.
export class FileMessage {
  type:number=0; uuid:string=''; fileName:string=''; md5:string=''; fileSize:number=0; busId:number=18;
  chunkID:number=0; start:number=0; size:number=0; data:Uint8Array=new Uint8Array(); state:number=0; reason:string='';
}
function integer(n:number,max:number=Number.MAX_SAFE_INTEGER):void{if(!Number.isSafeInteger(n)||n<0||n>max)throw new Error('file-integer');}
function vint(n:number):number[]{integer(n);const out:number[]=[];do{const b=n%128;n=Math.floor(n/128);out.push(b+(n?128:0));}while(n);return out;}
function ascii(s:string,max:number):Uint8Array{if(s.length>max||/[^\x20-\x7e]/.test(s))throw new Error('file-ascii');return Uint8Array.from(s.split('').map(c=>c.charCodeAt(0)));}
function blob(field:number,data:Uint8Array):number[]{return [field*8+2,...vint(data.length),...data];}
function scalar(field:number,n:number):number[]{return [field*8,...vint(n)];}
export function fileMessage(m:FileMessage):Uint8Array{
  if(!/^[A-Za-z0-9-]{1,64}$/.test(m.uuid))throw new Error('file-uuid');
  const body:number[]=blob(1,ascii(m.uuid,64));
  if(m.type===1){
    if(![m.uuid,m.uuid+'.txt'].includes(m.fileName)||!/^[a-f0-9]{32}$/.test(m.md5)||![17,18].includes(m.busId)||m.fileSize<1||m.fileSize>48000)throw new Error('file-info');
    body.push(...blob(2,ascii(m.fileName,68)),...scalar(3,m.fileSize),...blob(4,ascii(m.md5,32)),...scalar(5,m.busId));
  }else if(m.type===3||m.type===4){
    integer(m.chunkID,0xffffffff);integer(m.start,48000);integer(m.size,20480);if(!m.size)throw new Error('file-chunk-size');
    body.push(...scalar(2,m.chunkID),...scalar(3,m.start),...scalar(4,m.size));
    if(m.type===4){if(m.data.length!==m.size)throw new Error('file-chunk-size');body.push(...blob(5,m.data));}
  }else if(m.type===5){integer(m.state,1);body.push(...scalar(2,m.state));if(m.reason)body.push(...blob(3,ascii(m.reason,120)));}
  else if(m.type===6){if(m.reason)body.push(...blob(2,ascii(m.reason,120)));}
  else if(m.type!==2)throw new Error('file-message-type');
  return Uint8Array.from(blob(m.type,Uint8Array.from(body)));
}
class Field { key:number=0; wire:number=0; value:number=0; data:Uint8Array=new Uint8Array(); }
function fields(bytes:Uint8Array):Field[]{
  if(bytes.length>22000)throw new Error('file-message-size');let offset=0;const out:Field[]=[];
  const read=():number=>{let n=0;for(let i=0;i<8;i++){if(offset>=bytes.length)throw new Error('file-truncated');const b=bytes[offset++];n+=(b&127)*Math.pow(128,i);integer(n);if(!(b&128))return n;}throw new Error('file-varint');};
  while(offset<bytes.length){if(out.length>=16)throw new Error('file-field-count');const tag=read(),f=new Field();f.key=Math.floor(tag/8);f.wire=tag%8;
    if(!f.key||out.some(old=>old.key===f.key))throw new Error('file-duplicate-field');
    if(f.wire===0)f.value=read();else if(f.wire===2){const n=read();if(n>bytes.length-offset)throw new Error('file-truncated');f.data=bytes.slice(offset,offset+n);offset+=n;}
    else throw new Error('file-wire');out.push(f);
  }return out;
}
export function readFileMessage(bytes:Uint8Array):FileMessage{
  const outer=fields(bytes);if(outer.length!==1||outer[0].wire!==2||outer[0].key<1||outer[0].key>6)throw new Error('file-oneof');
  const m=new FileMessage();m.type=outer[0].key;const list=fields(outer[0].data);
  const text=(key:number,max:number):string=>{const f=list.find(v=>v.key===key);if(!f)return '';if(f.wire!==2||f.data.length>max)throw new Error('file-field');let s='';for(const b of f.data){if(b<32||b>126)throw new Error('file-ascii');s+=String.fromCharCode(b);}return s;};
  const num=(key:number):number=>{const f=list.find(v=>v.key===key);if(!f)return 0;if(f.wire!==0)throw new Error('file-field');return f.value;};
  m.uuid=text(1,64);if(!/^[A-Za-z0-9-]{1,64}$/.test(m.uuid))throw new Error('file-uuid');
  if(m.type===1){m.fileName=text(2,68);m.fileSize=num(3);m.md5=text(4,32);m.busId=num(5);}
  if(m.type===3||m.type===4){m.chunkID=num(2);m.start=num(3);m.size=num(4);const data=list.find(f=>f.key===5);if(data){if(data.wire!==2)throw new Error('file-field');m.data=data.data;}integer(m.chunkID,0xffffffff);integer(m.start,48000);integer(m.size,20480);if(!m.size||(m.type===4&&m.data.length!==m.size))throw new Error('file-chunk-size');}
  // Proto3 omits the SUCCESS enum (zero); absence here is valid, not missing ACK.
  if(m.type===5){m.state=num(2);integer(m.state,1);m.reason=text(3,120);}
  if(m.type===6)m.reason=text(2,120);
  return m;
}

class SentRange { start:number=0;end:number=0; }
// Owner serializes requests and invokes committed only after every ATT segment.
export class OutboundFile {
  private bytes:Uint8Array;readonly uuid:string;readonly busId:number;private md5:string;
  acknowledged:boolean=false;complete:boolean=false;cancelled:boolean=false;sentBytes:number=0;
  private ranges:SentRange[]=[];private requests:number=0;private descriptors:Map<number,string>=new Map();
  constructor(uuid:string,bytes:Uint8Array,md5:string,busId:number=18){
    const m=new FileMessage();m.type=1;m.uuid=uuid;m.fileName=uuid;m.fileSize=bytes.length;m.md5=md5;m.busId=busId;
    fileMessage(m);this.uuid=uuid;this.bytes=bytes.slice();this.md5=md5;this.busId=busId;
  }
  info():Uint8Array{const m=new FileMessage();m.type=1;m.uuid=this.uuid;m.fileName=this.uuid;m.fileSize=this.bytes.length;m.md5=this.md5;m.busId=this.busId;return fileMessage(m);}
  receive(input:Uint8Array):FileMessage|undefined{
    const m=readFileMessage(input);if(m.uuid!==this.uuid||this.cancelled||this.complete)return undefined;
    if(m.type===2){this.acknowledged=true;return undefined;}
    if(m.type===6){this.cancelled=true;throw new Error('file-peer-cancelled');}
    if(m.type===5){if(m.state!==0)throw new Error('file-peer-failed');if(this.sentBytes!==this.bytes.length)throw new Error('file-premature-success');this.complete=true;return undefined;}
    if(m.type!==3)return undefined;
    if(!this.acknowledged)throw new Error('file-request-before-ack');
    if(++this.requests>256||m.start>=this.bytes.length)throw new Error('file-request-limit');
    const descriptor=m.start+':'+m.size,old=this.descriptors.get(m.chunkID);if(old&&old!==descriptor)throw new Error('file-chunk-id-conflict');this.descriptors.set(m.chunkID,descriptor);
    const out=new FileMessage();out.type=4;out.uuid=this.uuid;out.chunkID=m.chunkID;out.start=m.start;out.size=Math.min(m.size,this.bytes.length-m.start);out.data=this.bytes.slice(out.start,out.start+out.size);return out;
  }
  committed(m:FileMessage):void{
    if(this.cancelled||m.uuid!==this.uuid||m.type!==4||m.data.length!==m.size||m.start+m.size>this.bytes.length)throw new Error('file-commit');
    const range:SentRange={start:m.start,end:m.start+m.size};this.ranges.push(range);this.ranges.sort((a,b)=>a.start-b.start);
    const merged:SentRange[]=[];for(const r of this.ranges){const last=merged[merged.length-1];if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else merged.push({start:r.start,end:r.end});}
    this.ranges=merged;this.sentBytes=merged.reduce((n,r)=>n+r.end-r.start,0);
  }
  close():void{this.cancelled=true;this.bytes.fill(0);this.ranges=[];this.descriptors.clear();}
}
