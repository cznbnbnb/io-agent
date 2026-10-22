import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { LifelogTranscript, LifelogUtterance } from './LifelogASR';
import { AsrWindowPlan, windowOwnsUtterance } from './AsrWindows';
import { validAsrTokens, ownsAsrToken } from './AsrTokenOwnership';

export class AsrWindowCheckpoint {
  schema_version:number=1;job_id:string='';cursor:number=0;windows:LifelogTranscript[]=[];
}
class SavedWindow { schema_version:number=1;job_id:string='';result:LifelogTranscript|undefined=undefined; }
// Immutable committed windows are the cursor. There is no separate head file
// that could advance before the recognized text has been safely published.
export class AsrWindowStore {
  private root:string='';
  initialize(filesDir:string):void{this.root=filesDir+'/asr-windows';if(!fs.accessSync(this.root))fs.mkdirSync(this.root);}
  private directory(id:string):string{
    if(!this.root||!/^asr-(recording|lifelog)-[0-9a-f]{32}$/.test(id))throw new Error('ASR_WINDOW_JOB_INVALID');return this.root+'/'+id;
  }
  private name(start:number):string{return 'window-'+start.toString().padStart(6,'0')+'.json';}
  private validate(result:LifelogTranscript,id:string):void{
    const step=id.startsWith('asr-lifelog-')?0.06:0.02;
    if(!result.windowed||!Number.isSafeInteger(result.windowStartFrame)||!Number.isSafeInteger(result.windowEndFrame)||
      result.windowStartFrame<0||result.windowEndFrame<=result.windowStartFrame||result.windowEndFrame>result.frames||
      !Number.isSafeInteger(result.frames)||result.frames>60000||Math.abs(result.seconds-result.frames*step)>0.000001||
      !Number.isSafeInteger(result.sourcePrefixBytes)||result.sourcePrefixBytes<=0||result.sourcePrefixBytes>16000000||
      !/^[a-f0-9]{64}$/.test(result.sourcePrefixSha256)||!Array.isArray(result.utterances)||result.utterances.length>1000||
        !Array.isArray(result.speakers)||result.speakers.length>1000)throw new Error('ASR_WINDOW_CORRUPT');
    const speakerIds:number[]=[];
    for(const speaker of result.speakers){
      if(!Number.isSafeInteger(speaker.index)||speaker.index<0||speaker.index>=1000||speakerIds.includes(speaker.index))throw new Error('ASR_WINDOW_SPEAKER_INVALID');
      speakerIds.push(speaker.index);
    }
    const plan=new AsrWindowPlan();plan.coreStart=result.windowStartFrame;plan.coreEnd=result.windowEndFrame;
    if(result.boundaryProcessing!==undefined&&!['unknown','unverified','token_starts','no_speech'].includes(result.boundaryProcessing))throw new Error('ASR_WINDOW_ALIGNMENT_INVALID');
    for(const part of result.utterances){
      const aligned=part.alignment==='token_starts';
      const owned=aligned?validAsrTokens(part.text,part.tokens,part.tokenStarts,part.start,part.end)&&
        part.tokenStarts.every((time:number):boolean=>ownsAsrToken(time,plan.coreStart*step,plan.coreEnd*step,result.seconds)):
        windowOwnsUtterance(part.start,part.end,plan,step);
      if(!owned||part.end>result.seconds||
        typeof part.text!=='string'||part.text.length>65536||!Number.isSafeInteger(part.speaker)||part.speaker< -1||part.speaker>=1000||
        (part.speaker>=0&&!speakerIds.includes(part.speaker)))throw new Error('ASR_WINDOW_TEXT_INVALID');
    }
    if(result.boundaryProcessing==='token_starts'&&result.utterances.some((part:LifelogUtterance):boolean=>part.alignment!=='token_starts'))throw new Error('ASR_WINDOW_ALIGNMENT_INVALID');
    if(result.boundaryProcessing==='no_speech'&&result.utterances.length)throw new Error('ASR_WINDOW_ALIGNMENT_INVALID');
  }
  resume(id:string):AsrWindowCheckpoint{
    const state=new AsrWindowCheckpoint();state.job_id=id;const directory=this.directory(id);
    if(!fs.accessSync(directory))return state;
    const names=fs.listFileSync(directory).filter((name:string):boolean=>/^window-[0-9]{6}\.json$/.test(name)).sort();
    if(names.length>1000)throw new Error('ASR_WINDOWS_TOO_MANY');
    for(const name of names){
      const path=directory+'/'+name;if(fs.statSync(path).size>4000000)throw new Error('ASR_WINDOW_TOO_LARGE');
      const row=JSON.parse(fs.readTextSync(path)) as SavedWindow;
      if(row.schema_version!==1||row.job_id!==id||!row.result)throw new Error('ASR_WINDOW_CORRUPT');
      this.validate(row.result,id);
      if(row.result.windowStartFrame!==state.cursor||name!==this.name(state.cursor))throw new Error('ASR_WINDOW_GAP');
      const previous=state.windows[state.windows.length-1];
      if(previous&&(row.result.frames<previous.frames||row.result.sourcePrefixBytes<previous.sourcePrefixBytes))throw new Error('ASR_WINDOW_SOURCE_REGRESSED');
      state.cursor=row.result.windowEndFrame;state.windows.push(row.result);
    }
    return state;
  }
  append(id:string,expectedCursor:number,result:LifelogTranscript):AsrWindowCheckpoint{
    this.validate(result,id);const state=this.resume(id);
    if(result.windowStartFrame!==expectedCursor)throw new Error('ASR_WINDOW_CURSOR_INVALID');
    if(state.cursor!==expectedCursor){
      const existing=state.windows.find((row:LifelogTranscript):boolean=>row.windowStartFrame===result.windowStartFrame);
      if(existing&&existing.windowEndFrame===result.windowEndFrame&&existing.sourcePrefixSha256===result.sourcePrefixSha256)return state;
      throw new Error('ASR_WINDOW_CONFLICT');
    }
    const directory=this.directory(id);if(!fs.accessSync(directory))fs.mkdirSync(directory);
    const path=directory+'/'+this.name(expectedCursor);if(fs.accessSync(path))throw new Error('ASR_WINDOW_CONFLICT');
    const row=new SavedWindow();row.job_id=id;row.result=result;
    const bytes=new util.TextEncoder().encodeInto(JSON.stringify(row));if(bytes.length>4000000)throw new Error('ASR_WINDOW_TOO_LARGE');
    const file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('ASR_WINDOW_WRITE_FAILED');offset+=n;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}
    fs.renameSync(path+'.partial',path);state.cursor=result.windowEndFrame;state.windows.push(result);return state;
  }
}
