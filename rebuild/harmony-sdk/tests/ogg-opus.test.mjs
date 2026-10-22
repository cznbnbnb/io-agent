import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const {OggOpusWriter}=loadApp('OggOpus');

// AlwaysOnOgg.m 的校验逻辑移植：CRC / 分包 / granule 语义。
function crc32(bytes){let c=0;for(let i=0;i<bytes.length;i++){c^=bytes[i]<<24;for(let b=0;b<8;b++)c=(c<<1)^((c&0x80000000)?0x04c11db7:0);}return c>>>0;}
const le32=(p,at)=>p[at]|(p[at+1]<<8)|(p[at+2]<<16)|(p[at+3]<<24);
const le64=(p,at)=>le32(p,at)+le32(p,at+4)*4294967296;
function samples(packet){if(!packet.length)return 0;const t=packet[0];const spf=(t&128)?(48000<<((t>>3)&3))/400:((t&96)===96?((t&8)?960:480):(((t>>3)&3)===3?2880:(48000<<((t>>3)&3))/100));const frames=(t&3)===0?1:(t&3)===3?(packet.length>1?packet[1]&63:0):2;return frames>0&&spf*frames<=5760?spf*frames:0;}
function scan(bytes){
 let pos=0,packets=0,count=0,total=0,skip=0,serial=0,seq=0,legacy=true,correct=true,eos=false,ok=false,audio=[],packet=new Uint8Array(0);
 for(let pageIndex=0;pageIndex<100000;pageIndex++){
  if(pos>=bytes.length){ok=eos&&packets>2&&packet.length===0&&(legacy||correct);break;}
  if(eos||bytes.length-pos<27)break;
  const h=bytes.slice(pos,pos+27);
  if(!(h[0]===79&&h[1]===103&&h[2]===103&&h[3]===83)||h[4]!==0||(h[5]&~7)!==0||((h[5]&1)!==0)!==(packet.length>0))break;
  if(pageIndex===0){if(!(h[5]&2)||le32(h,18)!==0)break;serial=le32(h,14);}else if(h[5]&2)break;
  if(le32(h,14)!==serial||le32(h,18)!==seq++)break;
  const n=h[26],laces=bytes.slice(pos+27,pos+27+n);let size=0;for(let i=0;i<n;i++)size+=laces[i];
  const body=bytes.slice(pos+27+n,pos+27+n+size);
  const page=bytes.slice(pos,pos+27+n+size),blank=page.slice();blank[22]=blank[23]=blank[24]=blank[25]=0;
  if(crc32(blank)!==(le32(h,22)>>>0))break;
  pos+=27+n+size;
  let at=0,completed=0,valid=true;
  for(let i=0;i<n;i++){
   const merged=new Uint8Array(packet.length+laces[i]);merged.set(packet);merged.set(body.slice(at,at+laces[i]),packet.length);packet=merged;at+=laces[i];
   if(packet.length>65536){valid=false;break;}
   if(laces[i]===255)continue;
   const p=packet,len=p.length;
   if(packets===0){if(len!==19||String.fromCharCode(...p.slice(0,8))!=='OpusHead'||p[8]!==1||p[18]!==0||!(p[9]===1||p[9]===2)){valid=false;break;}skip=p[10]|(p[11]<<8);}
   else if(packets===1){if(len<8||String.fromCharCode(...p.slice(0,8))!=='OpusTags'){valid=false;break;}}
   else{const s=samples(p);if(!s){valid=false;break;}total+=s;count++;completed++;audio.push(p);}
   packets++;packet=new Uint8Array(0);
  }
  if(!valid)break;
  const gp=le64(h,6);eos=!!(h[5]&4);
  if(eos&&(!count||packet.length))break;
  if(completed){legacy=legacy&&gp===count*960+skip;correct=correct&&gp===total;}
  else if(gp!==(packet.length?Infinity:0))break;
 }
 return {ok,packets,count,total,skip,legacy,correct,eos,audio};
}

function build(frames,frameSize=240,perPage=100){
 const chunks=[];const writer=new OggOpusWriter(bytes=>chunks.push(bytes),0x12345678,perPage);
 writer.begin();
 for(const frame of frames)writer.push(frame);
 writer.finish();
 const total=chunks.reduce((n,c)=>n+c.length,0),out=new Uint8Array(total);let at=0;
 for(const c of chunks){out.set(c,at);at+=c.length;}
 return out;
}
const mkFrames=n=>Array.from({length:n},(_,i)=>{const f=new Uint8Array(240).fill(i&255);f[0]=0x5b;f[1]=0x01;return f;});

test('OGG/Opus 文件通过官方扫描器校验（CRC · 分包 · granule）',()=>{
 const frames=mkFrames(250);
 const ogg=build(frames);
 const r=scan(ogg);
 assert(r.ok,'扫描器判定有效');
 assert.equal(r.packets,252,'OpusHead + OpusTags + 250 帧');
 assert.equal(r.count,250);
 assert.equal(r.total,2880*250,'60ms 帧 = 2880 个 48kHz granule 单位');
 assert.equal(r.correct,true,'granule 累加正确（非 legacy 960 口径）');
 assert.equal(r.audio.length,250);
 for(let i=0;i<250;i++)assert.deepEqual(r.audio[i],frames[i],`第 ${i} 帧原样保留`);
});

test('刚好整页帧数时最后一页仍带 EOS 且含帧',()=>{
 const r=scan(build(mkFrames(200),240,100));
 assert(r.ok,'整页边界仍然有效');
 assert(r.eos&&r.correct);
 assert.equal(r.count,200);
});

test('单帧与少帧文件有效',()=>{
 const r=scan(build(mkFrames(1)));
 assert(r.ok);assert.equal(r.count,1);assert.equal(r.total,2880);
});

test('帧长度异常被拒绝',()=>{
 const writer=new OggOpusWriter(()=>{},1,100,240);
 writer.begin();
 assert.throws(()=>writer.push(new Uint8Array(239)));
 assert.throws(()=>writer.push(new Uint8Array(241)));
});

test('不足一页的帧在 finish 后全部写出',()=>{
 const frames=mkFrames(37);
 const r=scan(build(frames,240,100));
 assert.equal(r.count,37);
 assert.deepEqual(r.audio, frames);
});
