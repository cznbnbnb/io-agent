import { fileIo as fs } from '@kit.CoreFileKit';
import { HarmonySha256 } from 'turbo_core';

function sourceHash(path:string):string{
  const size=fs.statSync(path).size;if(!Number.isSafeInteger(size)||size<=0||size>16000000)throw new Error('DAILY_LAB_AUDIO_SIZE');
  const bytes=new Uint8Array(size),file=fs.openSync(path,fs.OpenMode.READ_ONLY);
  try{
    let at=0;while(at<size){const part=new ArrayBuffer(size-at),n=fs.readSync(file.fd,part);if(n<=0)throw new Error('DAILY_LAB_AUDIO_READ');bytes.set(new Uint8Array(part,0,n),at);at+=n;}
    return Array.from(new HarmonySha256().digest(bytes)).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');
  }finally{fs.closeSync(file);bytes.fill(0);}
}
// Fresh processing root; never copies old transcripts, queue or checkpoints.
// A failed copy is retained for diagnosis and is never admitted to processing.
export function cloneDailyLabSource(base:string,from:string,to:string,name:string):string{
  const valid=(root:string):boolean=>root.startsWith(base+'/run-')&&/^run-[0-9]{13}$/.test(root.slice(base.length+1));
  if(!valid(from)||!valid(to)||from===to||!/^seg-[a-f0-9]{32}$/.test(name)||fs.accessSync(to))throw new Error('DAILY_LAB_CLONE_PATH');
  const source=from+'/lifelog/'+name,metaPath=source+'/meta.json';
  if(fs.statSync(metaPath).size>65536)throw new Error('DAILY_LAB_META_SIZE');
  const meta=JSON.parse(fs.readTextSync(metaPath)) as Record<string,Object>;
  const frames=meta['frames'] as number,started=meta['started'] as number,ended=meta['ended'] as number,seconds=meta['seconds'] as number;
  if(meta['version']!==2||meta['sealed']!==true||!Number.isSafeInteger(frames)||frames<=0||frames>60000||
    !Number.isSafeInteger(started)||!Number.isSafeInteger(ended)||started<0||ended<started||
    !Number.isFinite(seconds)||Math.abs(seconds-frames*0.06)>0.000001)throw new Error('DAILY_LAB_META_INVALID');
  const hash=sourceHash(source+'/audio.ogg');fs.mkdirSync(to);fs.mkdirSync(to+'/lifelog');fs.mkdirSync(to+'/lifelog/'+name);
  const target=to+'/lifelog/'+name;
  fs.copyFileSync(source+'/audio.ogg',target+'/audio.ogg');fs.copyFileSync(metaPath,target+'/meta.json');
  for(const path of [target+'/audio.ogg',target+'/meta.json']){const file=fs.openSync(path,fs.OpenMode.READ_WRITE);try{fs.fsyncSync(file.fd);}finally{fs.closeSync(file);}}
  if(sourceHash(target+'/audio.ogg')!==hash||sourceHash(source+'/audio.ogg')!==hash||fs.readTextSync(metaPath)!==fs.readTextSync(target+'/meta.json'))throw new Error('DAILY_LAB_CLONE_CHANGED');
  return hash;
}
