import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { TaskDecisionDraft,TaskDecisionRecord,TaskReplyBinding,taskSameReplyBinding } from './TaskReplyDraft';

// This local transaction never sends an answer or a device command. In
// particular, a recovered seal and a recovered microphone consent are lost.
export class TaskDraftRecoverySourceState {
  present:boolean=false;bytes:number=0;sha256:string='';valid:boolean=false;stage:string='';text_length:number=0;eligible:boolean=false;reason:string='';
}
export class TaskDraftRecoveryState {
  phase:string='idle';inspection_sha256:string='';transaction_id:string='';can_resume:boolean=false;
  main:TaskDraftRecoverySourceState=new TaskDraftRecoverySourceState();partial:TaskDraftRecoverySourceState=new TaskDraftRecoverySourceState();reason:string='';
}
export interface TaskDraftRecoveryPorts {
  context:()=>string;idle:()=>boolean;operationExists:(operation:string)=>boolean;validate:(binding:TaskReplyBinding)=>void;
  suspend:()=>void;nonce:()=>string;changed:()=>void;
}
class RecoveryFile {
  present:boolean=false;bytes:number=0;sha256:string='';
}
class RecoverySource {
  info:TaskDraftRecoverySourceState=new TaskDraftRecoverySourceState();record:TaskDecisionRecord|undefined=undefined;
}
class RecoveryIntent {
  schema:number=1;transaction_id:string='';source:string='';context_sha256:string='';binding_sha256:string='';
  main:RecoveryFile=new RecoveryFile();partial:RecoveryFile=new RecoveryFile();normalized_bytes:number=0;normalized_sha256:string='';policy:string='paused-v2';
}
class RecoveryDone {
  schema:number=1;transaction_id:string='';intent_sha256:string='';main_bytes:number=0;main_sha256:string='';paused:boolean=true;
}
class RecoveryTree {
  count:number=0;bytes:number=0;fingerprint:string[]=[];case_ids:string[]=[];
}
class RecoveryTransaction {
  intent:RecoveryIntent=new RecoveryIntent();intent_hash:string='';normalized:string='';
  main_archived:boolean=false;partial_archived:boolean=false;published:boolean=false;
}
class RecoveryInspection {
  state:TaskDraftRecoveryState=new TaskDraftRecoveryState();main:RecoverySource=new RecoverySource();partial:RecoverySource=new RecoverySource();
  tree:RecoveryTree=new RecoveryTree();transaction:RecoveryTransaction|undefined=undefined;safe:boolean=false;
}
const RECOVERY_SOURCE_LIMIT:number=262144;
const RECOVERY_CASE_LIMIT:number=1048576;
const RECOVERY_TOTAL_LIMIT:number=4194304;
const RECOVERY_META_LIMIT:number=16384;

export class TaskDraftRecovery {
  private draft:TaskDecisionDraft;private ports:TaskDraftRecoveryPorts;private root:string='';private main:string='';private partial:string='';private active:string='';private cases:string='';private busy:boolean=false;
  constructor(draft:TaskDecisionDraft,ports:TaskDraftRecoveryPorts){this.draft=draft;this.ports=ports;}
  initialize(filesDir:string):void{
    if(typeof filesDir!=='string'||!filesDir||filesDir.endsWith('/')||filesDir.endsWith('\\'))throw new Error('TASK_RECOVERY_DIRECTORY');
    this.root=filesDir;this.main=filesDir+'/task-decision-draft.json';this.partial=this.main+'.partial';
    this.active=filesDir+'/task-decision-recovery.active';this.cases=filesDir+'/task-decision-recovery-cases';
  }
  private hash(bytes:Uint8Array):string{
    const md=cryptoFramework.createMd('SHA256');md.updateSync({data:bytes});const out=md.digestSync().data;
    try{return Array.from(out).map((v:number):string=>v.toString(16).padStart(2,'0')).join('');}finally{out.fill(0);}
  }
  private textHash(text:string):string{const bytes=new util.TextEncoder().encodeInto(text);try{return this.hash(bytes);}finally{bytes.fill(0);}}
  private exists(path:string):boolean{return fs.accessSync(path);}
  private directory(path:string):void{const stat=fs.lstatSync(path);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('TASK_RECOVERY_PATH');}
  private length(path:string,limit:number):number{
    const stat=fs.lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<0||stat.size>limit)throw new Error('TASK_RECOVERY_SIZE');return stat.size;
  }
  // Read the actual bytes rather than a UTF8 replacement string. Each short
  // read advances the fd; SDK offset is relative to its current file position.
  private raw(path:string,limit:number):Uint8Array{
    const size=this.length(path,limit),bytes=new Uint8Array(size),file=fs.openSync(path,0);let complete:boolean=false;
    try{
      let at=0;while(at<size){const chunk=new Uint8Array(Math.min(16384,size-at));try{
        const n=fs.readSync(file.fd,chunk.buffer,{length:chunk.length});if(!Number.isSafeInteger(n)||n<1||n>chunk.length)throw new Error('TASK_RECOVERY_READ');bytes.set(chunk.subarray(0,n),at);at+=n;
      }finally{chunk.fill(0);}}
      const extra=new Uint8Array(1);try{if(fs.readSync(file.fd,extra.buffer,{length:1})!==0)throw new Error('TASK_RECOVERY_CHANGED');}finally{extra.fill(0);}
      if(this.length(path,limit)!==size)throw new Error('TASK_RECOVERY_CHANGED');complete=true;return bytes;
    }finally{fs.closeSync(file);if(!complete)bytes.fill(0);}
  }
  private file(path:string,limit:number):RecoveryFile{
    const result=new RecoveryFile();if(!this.exists(path))return result;result.present=true;result.bytes=this.length(path,limit);
    const bytes=this.raw(path,limit);try{result.sha256=this.hash(bytes);}finally{bytes.fill(0);}return result;
  }
  private source(path:string):RecoverySource{
    const result=new RecoverySource();if(!this.exists(path))return result;result.info.present=true;
    try{
      result.info.bytes=this.length(path,Number.MAX_SAFE_INTEGER);if(result.info.bytes>RECOVERY_SOURCE_LIMIT)throw new Error('TASK_RECOVERY_SIZE');const bytes=this.raw(path,RECOVERY_SOURCE_LIMIT);
      try{result.info.sha256=this.hash(bytes);const raw=new util.TextDecoder('utf-8',{fatal:true}).decodeToString(bytes);result.record=this.draft.parseRecoveryRecord(raw);
        result.info.valid=true;result.info.stage=result.record.stage;result.info.text_length=result.record.text.length;
      }finally{bytes.fill(0);}
    }catch(_){result.info.reason='invalid_source';}
    return result;
  }
  private same(a:RecoveryFile,b:RecoveryFile):boolean{return a.present===b.present&&a.bytes===b.bytes&&a.sha256===b.sha256;}
  private descriptor(s:TaskDraftRecoverySourceState):RecoveryFile{const f=new RecoveryFile();f.present=s.present;f.bytes=s.bytes;f.sha256=s.sha256;return f;}
  private hashValid(value:string):boolean{return typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);}
  private idValid(value:string):boolean{return typeof value==='string'&&/^recover-[0-9a-f]{32}$/.test(value);}
  private descriptorValid(f:RecoveryFile):boolean{return !!f&&Object.keys(f).length===3&&typeof f.present==='boolean'&&Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<=RECOVERY_SOURCE_LIMIT&&
    (f.present?this.hashValid(f.sha256):f.bytes===0&&f.sha256==='');}
  private intent(raw:string):RecoveryIntent{
    const i=JSON.parse(raw) as RecoveryIntent;
    if(!i||Object.keys(i).length!==10||i.schema!==1||!this.idValid(i.transaction_id)||!['main','partial'].includes(i.source)||!['paused-v1','paused-v2'].includes(i.policy)||
      !this.hashValid(i.context_sha256)||!this.hashValid(i.binding_sha256)||!this.descriptorValid(i.main)||!this.descriptorValid(i.partial)||
      !Number.isSafeInteger(i.normalized_bytes)||i.normalized_bytes<1||i.normalized_bytes>RECOVERY_SOURCE_LIMIT||!this.hashValid(i.normalized_sha256)||
      !(i.source==='main'?i.main.present:i.partial.present))throw new Error('TASK_RECOVERY_INTENT');return i;
  }
  private readText(path:string,limit:number):string{const bytes=this.raw(path,limit);try{return new util.TextDecoder('utf-8',{fatal:true}).decodeToString(bytes);}finally{bytes.fill(0);}}
  private getIntent(directory:string):RecoveryIntent{
    this.directory(directory);const names=fs.listFileSync(directory).sort();
    if(names.length!==1||!['intent.json','intent.json.partial'].includes(names[0]))throw new Error('TASK_RECOVERY_INTENT');
    return this.intent(this.readText(directory+'/'+names[0],RECOVERY_META_LIMIT));
  }
  private doneText(i:RecoveryIntent,intentHash:string):string{const done=new RecoveryDone();done.transaction_id=i.transaction_id;done.intent_sha256=intentHash;done.main_bytes=i.normalized_bytes;done.main_sha256=i.normalized_sha256;return JSON.stringify(done);}
  private verifyDone(path:string,i:RecoveryIntent,intentHash:string):void{
    if(this.readText(path,RECOVERY_META_LIMIT)!==this.doneText(i,intentHash))throw new Error('TASK_RECOVERY_DONE');
  }
  private knownFiles(directory:string,names:string[],tree:RecoveryTree,prefix:string):number{
    this.directory(directory);const found=fs.listFileSync(directory).sort();if(found.length>names.length)throw new Error('TASK_RECOVERY_UNKNOWN');let bytes=0;
    for(const name of found){if(!names.includes(name))throw new Error('TASK_RECOVERY_UNKNOWN');const value=this.file(directory+'/'+name,name.endsWith('.original')||name.startsWith('normalized.ready')?RECOVERY_SOURCE_LIMIT:RECOVERY_META_LIMIT);
      bytes+=value.bytes;tree.fingerprint.push(prefix+'/'+name+':'+value.bytes+':'+value.sha256);}
    return bytes;
  }
  private tree(activeId:string):RecoveryTree{
    const result=new RecoveryTree();
    if(this.exists(this.active)){result.bytes+=this.knownFiles(this.active,['intent.json','intent.json.partial'],result,'active');}
    if(!this.exists(this.cases))return result;this.directory(this.cases);const ids=fs.listFileSync(this.cases).sort();
    if(ids.length>4)throw new Error('TASK_RECOVERY_CAPACITY');result.count=ids.length;result.case_ids=ids;
    for(const id of ids){
      if(!this.idValid(id))throw new Error('TASK_RECOVERY_UNKNOWN');const directory=this.cases+'/'+id;this.directory(directory);
      const names=fs.listFileSync(directory).sort();if(names.length>7||names.some((name:string):boolean=>!['main.original','partial.original','normalized.ready','normalized.ready.partial','done.json','done.json.partial','active-intent'].includes(name)))throw new Error('TASK_RECOVERY_UNKNOWN');
      let total=0;for(const name of names){if(name==='active-intent'){total+=this.knownFiles(directory+'/'+name,['intent.json'],result,id+'/active-intent');}
        else{const f=this.file(directory+'/'+name,name.endsWith('.original')||name.startsWith('normalized.ready')?RECOVERY_SOURCE_LIMIT:RECOVERY_META_LIMIT);total+=f.bytes;result.fingerprint.push(id+'/'+name+':'+f.bytes+':'+f.sha256);}}
      if(total>RECOVERY_CASE_LIMIT)throw new Error('TASK_RECOVERY_CAPACITY');result.bytes+=total;
      if(id!==activeId){
        const i=this.getIntent(directory+'/active-intent');if(i.transaction_id!==id||names.some((n:string):boolean=>n.startsWith('normalized.ready')||n==='done.json.partial'))throw new Error('TASK_RECOVERY_ARCHIVE');
        const ih=this.file(directory+'/active-intent/intent.json',RECOVERY_META_LIMIT).sha256;this.verifyDone(directory+'/done.json',i,ih);
        if(!this.same(this.file(directory+'/main.original',RECOVERY_SOURCE_LIMIT),i.main)||!this.same(this.file(directory+'/partial.original',RECOVERY_SOURCE_LIMIT),i.partial))throw new Error('TASK_RECOVERY_ARCHIVE');
      }
    }
    if(result.bytes>RECOVERY_TOTAL_LIMIT)throw new Error('TASK_RECOVERY_CAPACITY');return result;
  }
  private normalize(selected:TaskDecisionRecord,main:TaskDecisionRecord|undefined,partial:TaskDecisionRecord|undefined,policy:string='paused-v2'):TaskDecisionRecord{
    // A durable v1 transaction promised a particular canonical legacy result.
    // Finish those bytes exactly; newer records cannot be laundered through it.
    if(policy==='paused-v1'&&[selected,main,partial].some((value:TaskDecisionRecord|undefined):boolean=>!!value&&value.schema!==1))throw new Error('TASK_RECOVERY_POLICY');
    if(main&&partial&&!taskSameReplyBinding(main.binding,partial.binding))throw new Error('TASK_RECOVERY_BINDING_CONFLICT');
    const next=JSON.parse(JSON.stringify(selected)) as TaskDecisionRecord;const used:string[]=[];let owner:TaskDecisionRecord|undefined=undefined;
    for(const value of [main,partial]){if(!value)continue;for(const uid of value.used_uids)if(!used.includes(uid))used.push(uid);
      if(value.cleanup_uid){if(owner&&(owner.cleanup_uid!==value.cleanup_uid||owner.cleanup_peer!==value.cleanup_peer||owner.card_stage!==value.card_stage))throw new Error('TASK_RECOVERY_UID_CONFLICT');owner=value;}}
    if(used.length>8)throw new Error('TASK_RECOVERY_UID_LIMIT');next.used_uids=used;
    if(owner){next.cleanup_uid=owner.cleanup_uid;next.cleanup_peer=owner.cleanup_peer;next.card_stage=owner.card_stage;}
    else{next.cleanup_uid='';next.cleanup_peer='';next.card_stage='';}
    if(['review','sealed'].includes(next.stage))next.stage='review';
    else if(next.stage==='voice_authorized')next.stage='supplement_offer';
    else if(next.stage==='deferred')next.stage=next.text.trim()?'review':'proposal';
    if(['queued','abandoned'].includes(next.stage))throw new Error('TASK_RECOVERY_TERMINAL');
    next.option_id=null;if(policy==='paused-v1')next.input_source='phone';if(['proposal','supplement_offer'].includes(next.stage))next.text='';
    // Keeping a cleanup lease cannot make the resulting schema inconsistent.
    // Such a pair requires read-only manual export rather than dropping a UID.
    const normalized=this.draft.parseRecoveryRecord(JSON.stringify(next));
    // The two individually bounded originals can grow when their UID history
    // is merged. Reject that candidate before allocating an active intent.
    const bytes=new util.TextEncoder().encodeInto(JSON.stringify(normalized));
    try{if(bytes.length>RECOVERY_SOURCE_LIMIT)throw new Error('TASK_RECOVERY_NORMALIZED_SIZE');}finally{bytes.fill(0);}
    return normalized;
  }
  private freshReason(source:RecoverySource,other:RecoverySource):string{
    if(!source.record)return 'invalid_source';if(source.record.binding.context_key!==this.ports.context())return 'wrong_context';
    if(!this.ports.idle()||this.busy)return 'runtime_busy';
    if(Date.parse(source.record.binding.expires_at)<=Date.now())return 'expired';
    try{this.normalize(source.record,source===other?undefined:source.record,other.record);
      if(this.ports.operationExists(source.record.binding.operation_id))return 'operation_exists';this.ports.validate(source.record.binding);
    }catch(_){return 'not_eligible';}return '';
  }
  private original(live:string,backup:string,expected:RecoveryFile,allowPublished:boolean,i:RecoveryIntent):RecoverySource{
    const stored=this.file(backup,RECOVERY_SOURCE_LIMIT),current=this.file(live,RECOVERY_SOURCE_LIMIT);
    if(!expected.present){if(stored.present||current.present&&!(allowPublished&&current.bytes===i.normalized_bytes&&current.sha256===i.normalized_sha256))throw new Error('TASK_RECOVERY_CHANGED');return new RecoverySource();}
    if(stored.present){if(!this.same(stored,expected)||current.present&&!(allowPublished&&current.bytes===i.normalized_bytes&&current.sha256===i.normalized_sha256))throw new Error('TASK_RECOVERY_CHANGED');return this.source(backup);}
    if(!this.same(current,expected))throw new Error('TASK_RECOVERY_CHANGED');return this.source(live);
  }
  private transaction(i:RecoveryIntent,expectedIntentHash:string=''):RecoveryTransaction{
    if(i.context_sha256!==this.textHash(this.ports.context()))throw new Error('TASK_RECOVERY_CONTEXT');
    if(JSON.stringify(this.getIntent(this.active))!==JSON.stringify(i))throw new Error('TASK_RECOVERY_INTENT_CHANGED');
    const result=new RecoveryTransaction();result.intent=i;
    const intentPath=this.exists(this.active+'/intent.json')?this.active+'/intent.json':this.active+'/intent.json.partial';result.intent_hash=this.file(intentPath,RECOVERY_META_LIMIT).sha256;
    if(expectedIntentHash&&result.intent_hash!==expectedIntentHash)throw new Error('TASK_RECOVERY_INTENT_CHANGED');
    const directory=this.cases+'/'+i.transaction_id;if(this.exists(directory))this.directory(directory);
    const main=this.original(this.main,directory+'/main.original',i.main,true,i),partial=this.original(this.partial,directory+'/partial.original',i.partial,false,i);
    const chosen=i.source==='main'?main.record:partial.record;if(!chosen||this.textHash(JSON.stringify(chosen.binding))!==i.binding_sha256)throw new Error('TASK_RECOVERY_BINDING');
    const normalized=this.normalize(chosen,main.record,partial.record,i.policy);result.normalized=JSON.stringify(normalized);
    const normalizedBytes=new util.TextEncoder().encodeInto(result.normalized);try{if(normalizedBytes.length!==i.normalized_bytes||this.hash(normalizedBytes)!==i.normalized_sha256)throw new Error('TASK_RECOVERY_NORMALIZED');}finally{normalizedBytes.fill(0);}
    result.main_archived=!i.main.present||this.exists(directory+'/main.original');result.partial_archived=!i.partial.present||this.exists(directory+'/partial.original');
    const current=this.file(this.main,RECOVERY_SOURCE_LIMIT);result.published=result.main_archived&&result.partial_archived&&current.present&&current.bytes===i.normalized_bytes&&current.sha256===i.normalized_sha256;
    const ready=this.file(directory+'/normalized.ready',RECOVERY_SOURCE_LIMIT),readyPartial=this.file(directory+'/normalized.ready.partial',RECOVERY_SOURCE_LIMIT);
    for(const file of [ready,readyPartial])if(file.present&&(file.bytes!==i.normalized_bytes||file.sha256!==i.normalized_sha256))throw new Error('TASK_RECOVERY_READY');
    if(ready.present&&readyPartial.present||result.published&&(ready.present||readyPartial.present))throw new Error('TASK_RECOVERY_READY');
    for(const name of ['done.json','done.json.partial'])if(this.exists(directory+'/'+name)){if(!result.published)throw new Error('TASK_RECOVERY_DONE');this.verifyDone(directory+'/'+name,i,result.intent_hash);}
    if(this.exists(directory+'/done.json')&&this.exists(directory+'/done.json.partial')||this.exists(directory+'/active-intent'))throw new Error('TASK_RECOVERY_DONE');return result;
  }
  private scan():RecoveryInspection{
    const result=new RecoveryInspection();if(!this.root){result.state.reason='uninitialized';return result;}
    try{this.directory(this.root);result.main=this.source(this.main);result.partial=this.source(this.partial);result.state.main=result.main.info;result.state.partial=result.partial.info;
      let activeIntent:RecoveryIntent|undefined=undefined;
      if(this.exists(this.active)){result.state.phase='blocked';activeIntent=this.getIntent(this.active);result.state.transaction_id=activeIntent.transaction_id;}
      result.tree=this.tree(activeIntent?activeIntent.transaction_id:'');
      // An unreadable/oversized raw source is never moved on behalf of a
      // different valid file: the bounded archive could not preserve it.
      if([result.main.info,result.partial.info].some((s:TaskDraftRecoverySourceState):boolean=>s.present&&!s.sha256))throw new Error('TASK_RECOVERY_SOURCE');
      if(activeIntent){result.transaction=this.transaction(activeIntent);result.state.phase='pending';result.state.can_resume=this.ports.idle()&&!this.busy;result.safe=true;}
      else{
        if(result.tree.count>=4||result.tree.bytes+result.main.info.bytes+result.partial.info.bytes+RECOVERY_SOURCE_LIMIT+2*RECOVERY_META_LIMIT>RECOVERY_TOTAL_LIMIT)throw new Error('TASK_RECOVERY_CAPACITY');
        result.state.main.reason=this.freshReason(result.main,result.partial);result.state.partial.reason=this.freshReason(result.partial,result.main);
        result.state.main.eligible=result.state.main.reason==='';result.state.partial.eligible=result.state.partial.reason==='';result.state.phase=result.main.info.present||result.partial.info.present?'available':'idle';result.safe=true;
      }
    }catch(_){result.state.phase='blocked';result.state.reason='recovery_evidence_conflict';result.state.can_resume=false;result.state.main.eligible=false;result.state.partial.eligible=false;}
    // Only hashes and bounded metadata cross the CLI boundary. Include context
    // even when the same files are inspected after switching account/profile.
    result.state.inspection_sha256=this.textHash(JSON.stringify(result.state)+':'+this.textHash(this.ports.context())+':'+result.tree.fingerprint.join('|'));
    return result;
  }
  inspect():TaskDraftRecoveryState{return this.scan().state;}
  private checked(source:string,expectedHash:string):RecoveryInspection{
    if(!['main','partial','resume'].includes(source)||!this.hashValid(expectedHash))throw new Error('TASK_RECOVERY_SELECTION');
    const scan=this.scan();if(scan.state.inspection_sha256!==expectedHash)throw new Error('TASK_RECOVERY_STALE');return scan;
  }
  preview(source:string,expectedHash:string):string{
    if(!['main','partial'].includes(source))throw new Error('TASK_RECOVERY_SELECTION');const scan=this.checked(source,expectedHash),selected=source==='main'?scan.main:scan.partial;
    if(!selected.record||selected.record.binding.context_key!==this.ports.context())throw new Error('TASK_RECOVERY_PREVIEW');
    return '原问题：'+selected.record.binding.question+'\n\n原始保存内容（仅预览，未恢复或提交）：\n'+selected.record.text;
  }
  private writeNew(path:string,text:string,limit:number):void{
    if(this.exists(path)||this.exists(path+'.partial'))throw new Error('TASK_RECOVERY_DESTINATION');const bytes=new util.TextEncoder().encodeInto(text);
    try{if(bytes.length>limit)throw new Error('TASK_RECOVERY_SIZE');const file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY);
      try{let at=0;while(at<bytes.length){const part=bytes.slice(at);try{const n=fs.writeSync(file.fd,part.buffer);if(!Number.isSafeInteger(n)||n<1||n>part.length)throw new Error('TASK_RECOVERY_WRITE');at+=n;}finally{part.fill(0);}}fs.fsyncSync(file.fd);}finally{fs.closeSync(file);}
      if(this.exists(path))throw new Error('TASK_RECOVERY_DESTINATION');fs.renameSync(path+'.partial',path);
    }finally{bytes.fill(0);}
  }
  private promote(path:string,expected:string,limit:number):void{
    if(this.exists(path))return;if(!this.exists(path+'.partial')){this.writeNew(path,expected,limit);return;}
    if(this.readText(path+'.partial',limit)!==expected)throw new Error('TASK_RECOVERY_INCOMPLETE');
    // FlushFileBuffers on Windows requires a write-capable handle. Opening the
    // already verified file without CREATE/TRUNC changes none of its bytes.
    const file=fs.openSync(path+'.partial',fs.OpenMode.WRITE_ONLY);try{fs.fsyncSync(file.fd);}finally{fs.closeSync(file);}
    if(this.readText(path+'.partial',limit)!==expected)throw new Error('TASK_RECOVERY_CHANGED');
    if(this.exists(path))throw new Error('TASK_RECOVERY_DESTINATION');fs.renameSync(path+'.partial',path);
  }
  private moveOriginal(path:string,destination:string,expected:RecoveryFile):void{
    if(!expected.present)return;if(this.exists(destination)){if(!this.same(this.file(destination,RECOVERY_SOURCE_LIMIT),expected))throw new Error('TASK_RECOVERY_CHANGED');return;}
    if(!this.same(this.file(path,RECOVERY_SOURCE_LIMIT),expected))throw new Error('TASK_RECOVERY_CHANGED');fs.renameSync(path,destination);
    if(!this.same(this.file(destination,RECOVERY_SOURCE_LIMIT),expected))throw new Error('TASK_RECOVERY_CHANGED');
  }
  private finish(i:RecoveryIntent,expectedIntentHash:string):void{
    const activeText=this.readText(this.exists(this.active+'/intent.json')?this.active+'/intent.json':this.active+'/intent.json.partial',RECOVERY_META_LIMIT);
    if(this.textHash(activeText)!==expectedIntentHash)throw new Error('TASK_RECOVERY_INTENT_CHANGED');
    this.promote(this.active+'/intent.json',activeText,RECOVERY_META_LIMIT);
    if(!this.exists(this.cases))fs.mkdirSync(this.cases);this.directory(this.cases);const directory=this.cases+'/'+i.transaction_id;
    if(!this.exists(directory))fs.mkdirSync(directory);this.directory(directory);
    let state=this.transaction(i,expectedIntentHash);
    if(!state.published){this.promote(directory+'/normalized.ready',state.normalized,RECOVERY_SOURCE_LIMIT);
      this.moveOriginal(this.main,directory+'/main.original',i.main);this.moveOriginal(this.partial,directory+'/partial.original',i.partial);
      state=this.transaction(i,expectedIntentHash);if(!state.main_archived||!state.partial_archived||this.exists(this.main)||this.exists(this.partial))throw new Error('TASK_RECOVERY_CHANGED');
      if(!this.same(this.file(directory+'/normalized.ready',RECOVERY_SOURCE_LIMIT),this.target(i)))throw new Error('TASK_RECOVERY_READY');fs.renameSync(directory+'/normalized.ready',this.main);
    }
    state=this.transaction(i,expectedIntentHash);if(!state.published||this.exists(this.partial))throw new Error('TASK_RECOVERY_CHANGED');
    this.promote(directory+'/done.json',this.doneText(i,state.intent_hash),RECOVERY_META_LIMIT);this.transaction(i,expectedIntentHash);this.tree(i.transaction_id);
    if(this.exists(directory+'/active-intent'))throw new Error('TASK_RECOVERY_DESTINATION');fs.renameSync(this.active,directory+'/active-intent');
    this.draft.initialize(this.root);const recovered=this.draft.snapshot();
    if(this.draft.blocked||!this.draft.paused||!recovered||JSON.stringify(recovered)!==state.normalized)throw new Error('TASK_RECOVERY_FINAL');
  }
  private target(i:RecoveryIntent):RecoveryFile{const f=new RecoveryFile();f.present=true;f.bytes=i.normalized_bytes;f.sha256=i.normalized_sha256;return f;}
  restore(source:string,expectedHash:string):void{
    if(this.busy)throw new Error('TASK_RECOVERY_BUSY');let scan=this.checked(source,expectedHash);
    if(!scan.safe||(source==='resume'?!scan.state.can_resume:!(source==='main'?scan.main.info.eligible:scan.partial.info.eligible)))throw new Error('TASK_RECOVERY_UNAVAILABLE');
    // Suspending is synchronous and only invalidates host generations. Recheck
    // the same byte CAS after it, before creating any transaction/evidence.
    this.ports.suspend();scan=this.checked(source,expectedHash);
    if(!this.ports.idle()||!scan.safe)throw new Error('TASK_RECOVERY_BUSY');
    this.busy=true;let started:boolean=false;
    try{
      if(source==='resume'){
        if(!scan.transaction||!scan.state.can_resume)throw new Error('TASK_RECOVERY_UNAVAILABLE');started=true;this.draft.blocked=true;this.draft.pause();this.finish(scan.transaction.intent,scan.transaction.intent_hash);
      }else{
        const selected=source==='main'?scan.main:scan.partial;if(!selected.record||!selected.info.eligible||this.exists(this.active))throw new Error('TASK_RECOVERY_UNAVAILABLE');
        const normalized=JSON.stringify(this.normalize(selected.record,scan.main.record,scan.partial.record)),intent=new RecoveryIntent();intent.transaction_id=this.ports.nonce();
        if(!this.idValid(intent.transaction_id)||this.exists(this.cases+'/'+intent.transaction_id))throw new Error('TASK_RECOVERY_NONCE');
        intent.source=source;intent.context_sha256=this.textHash(this.ports.context());intent.binding_sha256=this.textHash(JSON.stringify(selected.record.binding));
        intent.main=this.descriptor(scan.main.info);intent.partial=this.descriptor(scan.partial.info);
        const bytes=new util.TextEncoder().encodeInto(normalized);try{intent.normalized_bytes=bytes.length;intent.normalized_sha256=this.hash(bytes);}finally{bytes.fill(0);}
        if(intent.main.bytes+intent.partial.bytes+intent.normalized_bytes+2*RECOVERY_META_LIMIT>RECOVERY_CASE_LIMIT)throw new Error('TASK_RECOVERY_CAPACITY');
        const intentText=JSON.stringify(intent);fs.mkdirSync(this.active);started=true;this.draft.blocked=true;this.draft.pause();this.writeNew(this.active+'/intent.json',intentText,RECOVERY_META_LIMIT);this.finish(intent,this.textHash(intentText));
      }
    }catch(error){if(started){this.draft.blocked=true;this.draft.pause();}throw error as Error;}
    finally{this.busy=false;if(started){try{this.ports.changed();}catch{ /* UI notification is not transaction evidence. */ }}}
  }
}
