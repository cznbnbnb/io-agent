import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { businessEnvelope,readLauncherEnvelope } from 'turbo_core';
import { TaskDecisionDraft,TaskDecisionPlan,TaskDecisionRecord,TaskReplyBinding,TaskReplySubmission,taskSameReplyBinding,taskSameSubmission,taskRecordSubmission } from './TaskReplyDraft';
import { taskErrorText } from './TaskLabels';
import { TaskOption } from './TaskWire';

export interface TaskSuggestionPorts {
  send:(business:number,bytes:Uint8Array)=>Promise<void>;
  device:()=>string;available:()=>boolean;foreground:()=>boolean;context:()=>string;
  validate:(binding:TaskReplyBinding)=>void;revalidate:(binding:TaskReplyBinding)=>Promise<void>;
  enqueue:(answer:TaskReplySubmission)=>string;
  wait:(milliseconds:number)=>Promise<void>;
  assertAnswer?:(answer:TaskReplySubmission)=>void;
  operationExists?:(operation:string)=>boolean;
}
export class TaskReplyReviewState {ready:boolean=false;reason:string='no_draft';binding_sha256:string='';}
// Real business21 adapter. All asynchronous actions share one chain: a late
// send/remove can never overtake a newer card. Only a fresh second-card consent
// can hand off to capture, after the card queue and lease drain. No task cancel.
export class TaskSuggestionSession {
  note:string='眼镜选择先保存草稿；完整答案核对后才提交原任务';
  changed:()=>void=():void=>{};
  onVoiceAuthorized:(binding:TaskReplyBinding)=>void=(_binding:TaskReplyBinding):void=>{};
  onPause:()=>void=():void=>{};
  private tail:Promise<void>=Promise.resolve();private pending:number=0;private generation:number=0;
  private suspended:boolean=true;private timer:number=-1;private deadline:number=0;
  private voiceHandoff:TaskReplyBinding|undefined=undefined;private voiceGeneration:number=0;private voicePeer:string='';
  draft:TaskDecisionDraft;private ports:TaskSuggestionPorts;
  constructor(draft:TaskDecisionDraft,ports:TaskSuggestionPorts){this.draft=draft;this.ports=ports;}
  get busy():boolean{return this.pending>0;}
  get active():boolean{return this.busy||!!this.draft.snapshot()?.cleanup_uid;}
  private notify():void{try{this.changed();}catch{}}
  private clearTimer():void{if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;}
  private queue(action:()=>Promise<void>):Promise<void>{
    ++this.pending;this.notify();const work=this.tail.then(action);this.tail=work.catch(()=>{});
    return work.then(()=>{--this.pending;this.notify();this.releaseVoice();},(error:Error)=>{--this.pending;this.note=taskErrorText(error.message);this.notify();this.releaseVoice();throw error;});
  }
  private releaseVoice():void{
    if(this.pending||!this.voiceHandoff)return;
    const binding=this.voiceHandoff,generation=this.voiceGeneration,peer=this.voicePeer;this.voiceHandoff=undefined;this.voicePeer='';
    try{
      this.check(generation,binding);const record=this.draft.snapshot();
      if(!record||this.draft.paused||record.cleanup_uid||record.stage!=='voice_authorized'||
        !taskSameReplyBinding(record.binding,binding)||peer!==this.ports.device()||Date.parse(binding.expires_at)<=Date.now())return;
      this.ports.validate(binding);this.onVoiceAuthorized(this.copy(binding));
    }catch{this.pause('口述交接条件已变化；原问题和草稿保留，未自动开麦');}
  }
  private check(generation:number,binding:TaskReplyBinding):void{
    if(generation!==this.generation||this.suspended||!this.ports.foreground()||this.ports.context()!==binding.context_key)throw new Error('TASK_PROFILE_CHANGED');
  }
  private copy(binding:TaskReplyBinding):TaskReplyBinding{return JSON.parse(JSON.stringify(binding)) as TaskReplyBinding;}
  private answer(record:TaskDecisionRecord):TaskReplySubmission{
    return taskRecordSubmission(record);
  }
  private assertAnswer(answer:TaskReplySubmission):void{
    if(this.ports.assertAnswer){this.ports.assertAnswer(answer);return;}
    // Pure tests and nonvoice adapters may omit the port. Missing evidence
    // never authorizes a voice answer or a legacy saved body.
    if(answer.record_schema!==2||answer.input_source==='voice'||answer.voice_source)throw new Error('TASK_VOICE_SOURCE_UNVERIFIED');
  }
  private reviewHash(record:TaskDecisionRecord,peer:string):string{
    const b=record.binding,r=b.route;
    // Fixed-order full values, not a preview, current default route or trimmed text.
    const value=JSON.stringify(['turboio-task-reply/1',b.schema,b.context_key,b.operation_id,b.request_id,b.request_revision,b.task_id,
      r.computer_id,r.agent_id,r.project_id,r.session_id,b.expires_at,b.question,b.mode,
      b.options.map((o:TaskOption):string[]=>[o.option_id,o.label]),record.stage,record.option_id,record.text,record.input_source,record.schema,
      record.voice_source?[record.voice_source.schema,record.voice_source.attempt_id,record.voice_source.peer,record.voice_source.connection_epoch,
        record.voice_source.binding_sha256,record.voice_source.text_sha256]:null,peer]);
    const bytes=new util.TextEncoder().encodeInto(value),md=cryptoFramework.createMd('SHA256');
    try{md.updateSync({data:bytes});const hash=md.digestSync().data;
      try{return Array.from(hash).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}finally{hash.fill(0);}
    }finally{bytes.fill(0);}
  }
  private reviewState(ignoreBusy:boolean=false):TaskReplyReviewState{
    const view=new TaskReplyReviewState(),record=this.draft.snapshot(),peer=this.ports.device();
    if(this.draft.blocked){view.reason='protected';return view;}
    if(!record)return view;
    if(record.stage==='review'&&record.binding.context_key===this.ports.context()&&peer)view.binding_sha256=this.reviewHash(record,peer);
    if(record.stage!=='review')view.reason='not_reviewing';
    else if(this.draft.paused)view.reason='paused';
    else if(record.cleanup_uid)view.reason='cleanup_pending';
    else if(!ignoreBusy&&this.busy)view.reason='busy';
    else if(!this.ports.foreground())view.reason='not_foreground';
    else if(record.binding.context_key!==this.ports.context())view.reason='identity_changed';
    else if(Date.parse(record.binding.expires_at)<=Date.now())view.reason='expired';
    else if(!peer)view.reason='peer_unavailable';
    else if(!this.ports.available())view.reason='unavailable';
    else if(record.used_uids.length>=8)view.reason='uid_limit';
    else{
      try{this.assertAnswer(this.answer(record));}catch{view.reason='source_unverified';return view;}
      try{this.ports.validate(record.binding);}catch{view.reason='invalid_request';return view;}
      const copy=this.reviewCopy(record);
      if(copy[0].length>16)view.reason='title_too_long';
      else if(copy[1].length>48)view.reason='content_too_long';
      else if(!copy[0].trim()||/[\u0000-\u001f\u007f]/.test(copy[0]+copy[1]))view.reason='invalid_copy';
      else{view.reason='ready';view.ready=true;}
    }
    return view;
  }
  reviewStatus():TaskReplyReviewState{return this.reviewState();}
  private reviewCopy(record:TaskDecisionRecord):string[]{
    return [record.binding.route.computer_id+'·'+record.binding.route.agent_id,
      record.binding.question+' 答：'+record.text+' 点头发送；摇头保留。'];
  }
  private async write(peer:string,type:number,json:string):Promise<void>{
    if(!peer||peer!==this.ports.device())throw new Error('TASK_GLASS_PEER_CHANGED');
    const bytes=businessEnvelope(type,new util.TextEncoder().encodeInto(json));
    try{await this.ports.send(21,bytes);}finally{bytes.fill(0);}
  }
  private cardCopy(binding:TaskReplyBinding,plan:TaskDecisionPlan,stage:string):string[]{
    const title=binding.route.computer_id+'·'+binding.route.agent_id;
    const content=stage==='proposal'?binding.question+' 点头保存“'+plan.adopt_text+'”；摇头修改或拒绝。':
      '要口述补充条件吗？点头准备；摇头保存“'+plan.decline_text+'”。';
    // These are the conservative P10-tested bounds. Never truncate a question
    // or its consequences to manufacture an apparently confirmable card.
    if(!title.trim()||title.length>16||content.length>48||/[\u0000-\u001f\u007f]/.test(title+content))throw new Error('TASK_GLASS_COPY_TOO_LONG');
    return [title,content];
  }
  private async remove():Promise<void>{
    const record=this.draft.snapshot();if(!record?.cleanup_uid)return;
    await this.write(record.cleanup_peer,33,JSON.stringify({suggestUID:record.cleanup_uid,suggestType:2,type:2,title:'',source:'',content:''}));
    // Transport submission is the only fact recorded, not lens disappearance.
    this.draft.removalSubmitted(record.cleanup_peer,record.cleanup_uid);this.clearTimer();
  }
  private async show(generation:number):Promise<void>{
    const record=this.draft.snapshot();if(!record)throw new Error('TASK_DECISION_UNAVAILABLE');
    this.check(generation,record.binding);
    if(record.cleanup_uid||!this.ports.available()||!this.ports.device())throw new Error('TASK_GLASS_BUSY');
    const peer=this.ports.device(),copy=this.cardCopy(record.binding,record.plan,record.stage);
    await this.ports.revalidate(record.binding);this.check(generation,record.binding);
    if(peer!==this.ports.device()||!this.ports.available())throw new Error('TASK_GLASS_BUSY');
    const bytes=cryptoFramework.createRandom().generateRandomSync(8).data;let suffix='';
    try{for(const value of bytes)suffix+=value.toString(16).padStart(2,'0');}finally{bytes.fill(0);}
    const uid=record.binding.operation_id+'-'+suffix;
    this.draft.armCard(record.binding.context_key,peer,uid,Date.now());
    this.deadline=Math.min(Date.parse(record.binding.expires_at),Date.now()+120000);this.clearTimer();
    this.timer=setTimeout(()=>{this.timer=-1;if(generation!==this.generation)return;this.pause('卡片已超时；未形成答案，原任务继续等待');},Math.max(1,this.deadline-Date.now()));
    await this.write(peer,33,JSON.stringify({suggestUID:uid,suggestType:2,type:1,title:copy[0],source:'原任务·草稿',content:copy[1]}));
    this.check(generation,record.binding);this.note='卡片下发写入完成，镜片显示待观察；选择只保存草稿，手机确认后提交';
  }
  showReview(expectedHash:string):Promise<void>{
    const status=this.reviewState();
    if(!status.ready||!/^[a-f0-9]{64}$/.test(expectedHash)||status.binding_sha256!==expectedHash)throw new Error('TASK_REVIEW_CHANGED');
    const record=this.draft.snapshot();if(!record)throw new Error('TASK_DECISION_UNAVAILABLE');
    const frozen=this.answer(record),peer=this.ports.device(),copy=this.reviewCopy(record),generation=++this.generation;this.suspended=false;
    return this.queue(async()=>{
      this.check(generation,frozen.binding);
      const before=this.reviewState(true);if(!before.ready||before.binding_sha256!==expectedHash)throw new Error('TASK_REVIEW_CHANGED');
      await this.ports.revalidate(frozen.binding);this.check(generation,frozen.binding);
      const after=this.reviewState(true);
      if(!after.ready||after.binding_sha256!==expectedHash||peer!==this.ports.device())throw new Error('TASK_REVIEW_CHANGED');
      const bytes=cryptoFramework.createRandom().generateRandomSync(8).data;let suffix='';
      try{for(const value of bytes)suffix+=value.toString(16).padStart(2,'0');}finally{bytes.fill(0);}
      const uid=frozen.binding.operation_id+'-'+suffix;
      this.draft.armReviewCard(frozen,peer,uid,Date.now());
      this.deadline=Math.min(Date.parse(frozen.binding.expires_at),Date.now()+120000);this.clearTimer();
      this.timer=setTimeout(()=>{this.timer=-1;if(generation===this.generation)this.pause('确认卡已超时；完整草稿保留，尚未提交答案');},Math.max(1,this.deadline-Date.now()));
      await this.write(peer,33,JSON.stringify({suggestUID:uid,suggestType:2,type:1,title:copy[0],source:'完整答案·待确认',content:copy[1]}));
      this.check(generation,frozen.binding);this.note='完整答案确认卡写入完成，镜片显示待观察；点头发送，摇头保留草稿';
    });
  }
  start(binding:TaskReplyBinding,plan:TaskDecisionPlan):Promise<void>{
    if(this.busy||this.draft.blocked)throw new Error('TASK_DECISION_UNAVAILABLE');
    if(!this.ports.foreground()||!this.ports.available()||!this.ports.device())throw new Error('TASK_GLASS_BUSY');
    const frozen=this.copy(binding),mapping=JSON.parse(JSON.stringify(plan)) as TaskDecisionPlan;
    this.cardCopy(frozen,mapping,'proposal');this.cardCopy(frozen,mapping,'supplement_offer');
    const generation=++this.generation;this.suspended=false;
    return this.queue(async()=>{
      this.check(generation,frozen);await this.ports.revalidate(frozen);this.check(generation,frozen);
      if(!this.ports.available())throw new Error('TASK_GLASS_BUSY');
      this.draft.begin(frozen,mapping,Date.now());await this.show(generation);
    });
  }
  receive(peer:string,payload:Uint8Array):void{
    try{
      const packet=readLauncherEnvelope(payload);
      try{
        if(packet.type!==34||packet.binary.length||!packet.json.length||packet.json.length>2048)return;
        const value=JSON.parse(new util.TextDecoder().decodeToString(packet.json)) as Record<string,Object>;
        const uid=value['suggestUID'],cmd=value['cmd'],record=this.draft.snapshot();
        if(this.suspended||!record||record.cleanup_peer!==peer||peer!==this.ports.device()||record.cleanup_uid!==uid||value['suggestType']!==2||(cmd!==1&&cmd!==2))return;
        const generation=this.generation,cardStage=record.card_stage,frozen=this.answer(record);
        this.queue(async()=>{
          const current=this.draft.snapshot();if(!current||current.cleanup_uid!==uid||current.card_stage!==current.stage)return;
          this.check(generation,current.binding);if(Date.now()>=this.deadline)throw new Error('EXPIRED');
          await this.ports.revalidate(current.binding);this.check(generation,current.binding);
          if(Date.now()>=this.deadline||peer!==this.ports.device())throw new Error('EXPIRED');
          this.ports.validate(current.binding);this.check(generation,current.binding);
          if(cardStage==='review'){
            if(cmd===1)this.assertAnswer(frozen);
            if(!this.draft.confirmReview(frozen,peer,34,uid as string,cmd as number,Date.now()))return;
          }else if(!this.draft.suggestion(current.binding.context_key,peer,34,uid as string,cmd as number,Date.now()))return;
          this.clearTimer();
          // The draft is durable before acknowledging this native operation.
          // code0 confirms only the locally saved step described by the card;
          // it is never a server/Agent receipt. Without type35 the firmware
          // reports failure, and immediately replacing its view races dismissal.
          await this.write(peer,35,JSON.stringify({suggestUID:uid,suggestType:2,code:0}));
          this.check(generation,current.binding);
          await this.ports.wait(2500);this.check(generation,current.binding);
          await this.remove();this.check(generation,current.binding);
          await this.ports.wait(300);this.check(generation,current.binding);
          const next=this.draft.snapshot();
          if(cardStage==='review'){
            if(cmd===1){
              if(!next||next.stage!=='sealed'||next.cleanup_uid||!taskSameSubmission(this.answer(next),frozen))throw new Error('TASK_REVIEW_CHANGED');
              // Exact sealed bytes use the established same-operation outbox.
              // If enqueue loses its reply, explicit retry reconciles that row.
              this.deliver(frozen);
            }else{this.suspended=true;this.note='完整答案已保留为草稿；未发送拒绝，也未取消电脑任务';}
            return;
          }
          if(next?.stage==='supplement_offer')await this.show(generation);
          else this.note=next?.stage==='voice_authorized'?'已同意口述，正在准备收音；完整条件保存后仍需核对提交':
            '眼镜选择已保存为本地草稿；尚未提交Agent，请在手机核对完整答案';
          if(cardStage==='supplement_offer'&&cmd===1&&next?.stage==='voice_authorized'&&!next.cleanup_uid){
            // Only the action that durably advanced this card can authorize.
            // Drain duplicate events too, and publish occupancy=false first.
            this.voiceHandoff=this.copy(next.binding);this.voiceGeneration=generation;this.voicePeer=peer;
          }
        }).catch(()=>{});
      }finally{packet.json.fill(0);packet.binary.fill(0);}
    }catch{ /* Unrelated/malformed packets never advance the task. */ }
  }
  suspendForRecovery():void{
    if(this.busy)throw new Error('TASK_GLASS_BUSY');
    // Invalidate all old callbacks without transmitting remove/stop commands.
    // The recovery transaction retains every known UID cleanup obligation.
    ++this.generation;this.voiceHandoff=undefined;this.voicePeer='';this.suspended=true;this.clearTimer();this.draft.pause();
    this.note='正在核对保存中断记录；原任务未提交，卡片和收音未重新开启';this.notify();
  }
  pause(note:string='显示已暂停；草稿保留，恢复须重新核对原问题'):void{
    ++this.generation;this.voiceHandoff=undefined;this.voicePeer='';this.suspended=true;this.clearTimer();this.draft.pause();this.note=note;this.notify();
    try{this.onPause();}catch{}
    if(this.draft.snapshot()?.cleanup_uid)this.queue(async()=>{await this.remove();}).catch(()=>{});
  }
  stateChanged():void{
    const record=this.draft.snapshot();if(this.suspended||!record||['queued','abandoned','sealed'].includes(record.stage))return;
    try{this.ports.validate(record.binding);}catch{this.pause('原问题、任务或身份已变化；草稿未发送，请核对状态');}
  }
  async stopAndWait():Promise<boolean>{this.pause();await this.tail;return !this.draft.snapshot()?.cleanup_uid;}
  cleanup():Promise<void>{++this.generation;this.voiceHandoff=undefined;this.voicePeer='';this.suspended=true;this.clearTimer();this.draft.pause();try{this.onPause();}catch{}return this.queue(async()=>{await this.remove();this.note='移除写入完成；镜片消失待确认，草稿未提交';});}
  resume():Promise<void>{
    if(this.busy)throw new Error('TASK_GLASS_BUSY');const record=this.draft.snapshot();if(!record)throw new Error('TASK_DECISION_UNAVAILABLE');
    const generation=++this.generation;this.suspended=false;
    return this.queue(async()=>{
      this.check(generation,record.binding);if(record.cleanup_uid)throw new Error('TASK_DECISION_CARD_BUSY');
      await this.ports.revalidate(record.binding);this.check(generation,record.binding);
      this.draft.resume(record.binding,Date.now());
      if(['proposal','supplement_offer'].includes(this.draft.snapshot()?.stage||''))await this.show(generation);
      else this.note='原问题已重新核对；完整草稿保留，请确认后提交';
    });
  }
  submit():Promise<void>{
    if(this.busy)throw new Error('TASK_GLASS_BUSY');if(this.draft.blocked)throw new Error('TASK_DECISION_UNAVAILABLE');
    const record=this.draft.snapshot();if(!record)throw new Error('TASK_DECISION_UNAVAILABLE');
    // Freeze what was actually confirmed at the call boundary. A later edit
    // during network revalidation is a new answer and needs its own submit.
    const frozen=this.answer(record),stage=record.stage,generation=this.generation;
    return this.queue(async()=>{
      if(!this.ports.foreground()||this.ports.context()!==record.binding.context_key||record.cleanup_uid)throw new Error('TASK_PROFILE_CHANGED');
      const before=this.draft.snapshot();
      if(this.draft.blocked||!before||before.stage!==stage||before.cleanup_uid||!taskSameSubmission(this.answer(before),frozen))throw new Error('TASK_REVIEW_CHANGED');
      if(stage==='sealed'){
        // The first enqueue may have succeeded before its local reply was lost.
        // Existing mailbox logic either returns exactly those bytes or rejects.
        // Keep this explicit same-operation retry independent of fresh consent.
      }else{
        this.check(generation,frozen.binding);await this.ports.revalidate(frozen.binding);this.check(generation,frozen.binding);
        const after=this.draft.snapshot();
        if(this.draft.blocked||!after||after.stage!==stage||after.cleanup_uid||!taskSameSubmission(this.answer(after),frozen))throw new Error('TASK_REVIEW_CHANGED');
        this.assertAnswer(frozen);const sealed=this.draft.seal(frozen.binding.context_key,Date.now());
        if(!taskSameSubmission(sealed,frozen))throw new Error('TASK_REVIEW_CHANGED');
      }
      this.deliver(frozen);
    });
  }
  private deliver(answer:TaskReplySubmission):void{
    this.assertAnswer(answer);
    this.draft.assertCurrent();const current=this.draft.snapshot();
    if(!current||current.stage!=='sealed'||current.cleanup_uid||!taskSameSubmission(this.answer(current),answer))throw new Error('TASK_REVIEW_CHANGED');
    const state=this.ports.enqueue(answer);this.note='原答案发送记录：'+state+'；服务器、Agent接收和任务完成分别核对';
  }
  adoptPhone(expectedHash:string):Promise<void>{
    if(this.busy||this.draft.blocked)throw new Error('TASK_DECISION_UNAVAILABLE');
    const record=this.draft.snapshot(),peer=this.ports.device();
    if(!record||!['review','sealed','deferred'].includes(record.stage)||record.cleanup_uid||!record.text.trim()||
      !this.ports.foreground()||record.binding.context_key!==this.ports.context()||this.reviewHash(record,peer)!==expectedHash||
      !this.ports.operationExists||this.ports.operationExists(record.binding.operation_id))throw new Error('TASK_REVIEW_CHANGED');
    const frozen=this.answer(record),generation=++this.generation;this.suspended=true;this.clearTimer();this.voiceHandoff=undefined;this.voicePeer='';
    return this.queue(async()=>{
      await this.ports.revalidate(frozen.binding);
      const current=this.draft.snapshot();
      if(generation!==this.generation||!this.ports.foreground()||this.ports.context()!==frozen.binding.context_key||
        !current||current.stage!==record.stage||current.cleanup_uid||!taskSameSubmission(this.answer(current),frozen)||this.reviewHash(current,this.ports.device())!==expectedHash||
        !this.ports.operationExists||this.ports.operationExists(frozen.binding.operation_id))throw new Error('TASK_REVIEW_CHANGED');
      this.draft.adoptPhone(frozen,Date.now());this.draft.resume(frozen.binding,Date.now());this.suspended=false;
      this.note='已按你核对的完整文字保留为手机草稿；尚未提交答案';
    });
  }
  adoptionHash():string{
    const record=this.draft.snapshot();if(!record||this.draft.blocked||record.cleanup_uid||!['review','sealed','deferred'].includes(record.stage)||!record.text.trim())return '';
    try{if(!this.ports.foreground()||record.binding.context_key!==this.ports.context()||!this.ports.operationExists||this.ports.operationExists(record.binding.operation_id))return '';}catch{return '';}
    return this.reviewHash(record,this.ports.device());
  }
  abandon():Promise<void>{
    if(this.busy)throw new Error('TASK_GLASS_BUSY');
    this.pause('仅撤回本地未提交草稿，不取消电脑任务');
    return this.queue(async()=>{await this.remove();this.draft.abandon();this.note='本地草稿已撤回；电脑任务未取消';});
  }
}
