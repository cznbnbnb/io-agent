import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';

export class LocalAsrJob {
  jobId:string='';directory:string='';sourcePath:string='';started:number=0;
  kind:string='lifelog';forced:boolean=false;status:string='queued';
  attempts:number=0;nextRun:number=0;lastError:string='';updatedAt:number=0;
}
class QueueSnapshot { schema_version:number=1;jobs:LocalAsrJob[]=[]; }

// Private durable coordinator, separate from the audio and the P14 wire schema.
// A result is sealed before material/legacy publication, so a write retry does
// not repeat expensive inference or generate another material revision.
export class LocalAsrQueue {
  private root:string='';private filesDir:string='';private jobs:LocalAsrJob[]=[];
  initialize(filesDir:string):void{
    this.filesDir=filesDir;this.root=filesDir+'/asr-queue';
    if(!fs.accessSync(this.root))fs.mkdirSync(this.root);
    const path=this.root+'/state.json';let loaded:LocalAsrJob[]=[];
    if(fs.accessSync(path)){
      if(fs.statSync(path).size>16000000)throw new Error('ASR_QUEUE_TOO_LARGE');
      const snapshot=JSON.parse(fs.readTextSync(path)) as QueueSnapshot;
      if(snapshot.schema_version!==1||!Array.isArray(snapshot.jobs)||snapshot.jobs.length>10000)throw new Error('ASR_QUEUE_CORRUPT');
      const seen:string[]=[];
      for(const job of snapshot.jobs){this.validate(job);if(seen.includes(job.jobId))throw new Error('ASR_QUEUE_DUPLICATE');seen.push(job.jobId);}
      loaded=snapshot.jobs;
    }
    this.jobs=loaded;
    const recovered=this.copy();let changed=false;
    for(const job of recovered)if(job.status==='running'){
      job.status=this.hasResult(job.jobId)?'result_ready':job.attempts>=3?'failed':'queued';
      job.lastError=job.status==='failed'?'interrupted_retry_exhausted':'interrupted';job.nextRun=Date.now();changed=true;
    }
    if(changed)this.publish(recovered);
  }
  private validate(job:LocalAsrJob):void{
    const prefix=job.kind==='recording'?'take-':job.kind==='lifelog'?'seg-':'';
    const leaf=job.directory.slice(job.directory.lastIndexOf('/')+1);
    const hex=leaf.slice(prefix.length);
    if(!prefix||leaf!==prefix+hex||!/^[0-9a-f]{32}$/.test(hex)||job.jobId!=='asr-'+job.kind+'-'+hex||
      job.directory!==this.filesDir+'/'+(job.kind==='recording'?'recordings':'lifelog')+'/'+leaf||
      job.sourcePath!==job.directory+'/'+(job.kind==='recording'?'source.rawopus':'audio.ogg')||
      !Number.isSafeInteger(job.started)||job.started<0||typeof job.forced!=='boolean'||
      !['queued','running','result_ready','succeeded','failed','cancelled'].includes(job.status)||
      !Number.isSafeInteger(job.attempts)||job.attempts<0||!Number.isSafeInteger(job.nextRun)||job.nextRun<0||
      !Number.isSafeInteger(job.updatedAt)||job.updatedAt<0||typeof job.lastError!=='string'||job.lastError.length>256)throw new Error('ASR_QUEUE_CORRUPT');
  }
  private copy():LocalAsrJob[]{return JSON.parse(JSON.stringify(this.jobs)) as LocalAsrJob[];}
  private write(path:string,text:string):void{
    const bytes=new util.TextEncoder().encodeInto(text);
    const file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('ASR_QUEUE_WRITE_FAILED');offset+=n;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}
    fs.renameSync(path+'.partial',path);
  }
  private publish(jobs:LocalAsrJob[]):void{
    for(const job of jobs)this.validate(job);
    const snapshot=new QueueSnapshot();snapshot.jobs=jobs;
    const text=JSON.stringify(snapshot);if(text.length>16000000)throw new Error('ASR_QUEUE_TOO_LARGE');
    this.write(this.root+'/state.json',text);this.jobs=jobs;
  }
  all():LocalAsrJob[]{return this.copy();}
  get(id:string):LocalAsrJob|undefined{return this.copy().find((job:LocalAsrJob):boolean=>job.jobId===id);}
  enqueue(directory:string,sourcePath:string,started:number,kind:string,forced:boolean,retry:boolean=false):LocalAsrJob{
    const leaf=directory.slice(directory.lastIndexOf('/')+1);
    const id='asr-'+kind+'-'+leaf.slice(kind==='recording'?5:4);
    const jobs=this.copy();let job=jobs.find((row:LocalAsrJob):boolean=>row.jobId===id);
    if(job){
      if(job.directory!==directory||job.sourcePath!==sourcePath||job.started!==started)throw new Error('ASR_SOURCE_CHANGED');
      if(retry&&['failed','cancelled'].includes(job.status)){job.status=this.hasResult(id)?'result_ready':'queued';job.attempts=0;job.nextRun=0;job.lastError='';}
      else if(['succeeded','failed','cancelled'].includes(job.status))return job;
      if(forced&&!job.forced)job.forced=true;else if(!retry)return job;
    }else{
      if(jobs.length>=10000)throw new Error('ASR_QUEUE_FULL');
      job=new LocalAsrJob();job.jobId=id;job.directory=directory;job.sourcePath=sourcePath;job.started=started;job.kind=kind;job.forced=forced;jobs.push(job);
    }
    job.updatedAt=Date.now();this.publish(jobs);return job;
  }
  transition(id:string,status:string,error:string='',nextRun:number=0):LocalAsrJob{
    const jobs=this.copy();const job=jobs.find((row:LocalAsrJob):boolean=>row.jobId===id);if(!job)throw new Error('ASR_JOB_MISSING');
    if(['cancelled','succeeded'].includes(job.status))throw new Error('ASR_JOB_TERMINAL');
    if(status==='running'&&job.status!=='queued')throw new Error('ASR_JOB_STATE');
    if(status==='running')job.attempts++;
    job.status=status;job.lastError=error.slice(0,256);job.nextRun=nextRun;job.updatedAt=Date.now();this.publish(jobs);return job;
  }
  private resultPath(id:string):string{
    if(!/^asr-(recording|lifelog)-[0-9a-f]{32}$/.test(id))throw new Error('ASR_JOB_ID_INVALID');
    return this.root+'/'+id+'.result.json';
  }
  hasResult(id:string):boolean{return fs.accessSync(this.resultPath(id));}
  sealResult(id:string,result:string):void{
    const job=this.get(id);if(!job||job.status!=='running')throw new Error('ASR_JOB_STATE');
    if(result.length>4000000)throw new Error('ASR_RESULT_TOO_LARGE');JSON.parse(result);
    this.write(this.resultPath(id),result);this.transition(id,'result_ready');
  }
  readResult(id:string):string{
    const path=this.resultPath(id);if(fs.statSync(path).size>4000000)throw new Error('ASR_RESULT_TOO_LARGE');return fs.readTextSync(path);
  }
  deferWindow(id:string,reason:string,nextRun:number):void{
    const jobs=this.copy(),job=jobs.find((row:LocalAsrJob):boolean=>row.jobId===id);
    if(!job||job.kind!=='lifelog'||job.status!=='running')throw new Error('ASR_JOB_STATE');
    job.status='queued';job.attempts=0;job.nextRun=nextRun;job.lastError=reason;job.updatedAt=Date.now();this.publish(jobs);
  }
  wakeAudio(id:string):void{
    const job=this.get(id);if(job?.status==='queued'&&job.lastError==='waiting_audio')this.transition(id,'queued');
  }
  interrupted(id:string):void{
    const job=this.get(id);if(job?.status==='running'){
      const status=this.hasResult(id)?'result_ready':job.attempts>=3?'failed':'queued';
      this.transition(id,status,status==='failed'?'interrupted_retry_exhausted':'interrupted');
    }
  }
  cancel(id:string):void{
    const job=this.get(id);if(!job||['succeeded','cancelled'].includes(job.status))return;this.transition(id,'cancelled','cancelled_by_user');
  }
}
