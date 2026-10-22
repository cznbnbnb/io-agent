import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { TaskCoordinator, TaskSummary, TaskSendView } from './TaskCoordinator';
import { TaskSettings, SecureTaskSettings, validateTaskSettings } from './TaskSettings';
import { TaskCached } from './TaskMailbox';
import { TaskRoute } from './TaskWire';
import { TaskReplyBinding,TaskDecisionDraft,TaskReplySubmission,taskRecordSubmission,taskSameSubmission } from './TaskReplyDraft';
import { TaskVoiceSourceRef } from './TaskVoiceSourceRef';
import { TaskVoiceSources,TaskVoiceSourceView } from './TaskVoiceSources';
import { TaskEnvelope } from './TaskWire';

export class TaskService {
  changed:()=>void=():void=>{};settingsNote:string='';
  onReplyPause:()=>void=():void=>{};onReplyState:()=>void=():void=>{};
  decisionDraft:TaskDecisionDraft=new TaskDecisionDraft();
  voiceSources:TaskVoiceSources=new TaskVoiceSources();
  private coordinator:TaskCoordinator|undefined=undefined;private vault:SecureTaskSettings=new SecureTaskSettings();
  private generation:number=0;private saving:boolean=false;private loading:boolean=false;private closing:Promise<void>=Promise.resolve();
  private foreground:boolean=false;private retryTimer:number=-1;private retryAttempt:number=0;
  private cancelSettingsRetry():void{if(this.retryTimer>=0)clearTimeout(this.retryTimer);this.retryTimer=-1;}
  private scheduleSettingsRetry(coordinator:TaskCoordinator,generation:number):void{
    const delays:number[]=[1000,3000,10000,30000,30000];
    if(!this.foreground||this.saving||coordinator!==this.coordinator||generation!==this.generation||this.retryTimer>=0||this.retryAttempt>=delays.length)return;
    const timer=setTimeout(():void=>{
      // A cancelled callback may already be queued. It cannot consume a new
      // timer, reopen an old profile or resume a retained decision draft.
      if(this.retryTimer!==timer||!this.foreground||this.saving||coordinator!==this.coordinator||generation!==this.generation)return;
      this.retryTimer=-1;this.reloadAttempt().catch(():void=>{});
    },delays[this.retryAttempt++]);
    this.retryTimer=timer;
  }
  private notify():void{try{this.onReplyState();}catch{}try{this.changed();}catch{}}
  private pauseReplies():void{this.decisionDraft.pause();try{this.onReplyPause();}catch{}}
  initialize(filesDir:string):void{
    if(this.coordinator)return;this.decisionDraft.initialize(filesDir);this.voiceSources.initialize(filesDir);
    this.voiceSources.changed=():void=>{
      const record=this.decisionDraft.snapshot();
      if(record?.input_source==='voice'){
        try{if(this.voiceSources.status(taskRecordSubmission(record)).state!=='watching')this.pauseReplies();}
        catch{this.pauseReplies();}
      }
      this.notify();
    };
    this.coordinator=new TaskCoordinator(filesDir);this.coordinator.changed=():void=>this.notify();
    this.coordinator.beforeAnswerSend=(operation:string,event:TaskEnvelope):void=>this.voiceSources.beforeSend(operation,event,this.summary().contextKey);
  }
  assertAnswer(answer:TaskReplySubmission):void{this.voiceSources.assertAnswer(answer);}
  sourceStatus():TaskVoiceSourceView{const record=this.decisionDraft.snapshot();return record?this.voiceSources.status(taskRecordSubmission(record)):new TaskVoiceSourceView();}
  setForeground(value:boolean):void{
    this.foreground=value;this.cancelSettingsRetry();this.retryAttempt=0;
    if(!value){this.pauseReplies();if(!this.saving){++this.generation;this.loading=false;}}
    this.coordinator?.setForeground(value);if(value)this.reload().catch(():void=>{});
  }
  settings():Promise<TaskSettings>{return this.vault.load();}
  async reload():Promise<void>{
    if(this.saving)return;this.cancelSettingsRetry();this.retryAttempt=0;await this.reloadAttempt();
  }
  private async reloadAttempt():Promise<void>{
    if(this.saving)return;this.pauseReplies();const c=this.coordinator,generation=++this.generation;if(!c)return;this.loading=true;this.notify();
    try{await this.closing;if(generation!==this.generation||c!==this.coordinator)return;
      await c.configure(undefined);if(generation!==this.generation||c!==this.coordinator)return;
      const value=await this.vault.load();if(generation!==this.generation||c!==this.coordinator)return;
      await c.configure(value);if(generation===this.generation){this.cancelSettingsRetry();this.retryAttempt=0;this.settingsNote='';this.notify();}
    }catch(error){if(generation===this.generation&&c===this.coordinator){
      const unavailable=(error as Error)?.message==='TASK_SETTINGS_UNAVAILABLE';
      this.settingsNote=unavailable?'任务配置暂不可读，请解锁后重试；已有配置未覆盖':'任务配置加载失败，请重读并核对配置；已有配置未覆盖';
      if(unavailable)this.scheduleSettingsRetry(c,generation);
    }}
    finally{if(generation===this.generation){this.loading=false;this.notify();}}
  }
  async save(value:TaskSettings):Promise<void>{
    if(this.saving||!this.coordinator)throw new Error('TASK_SETTINGS_BUSY');
    this.pauseReplies();
    const snapshot=JSON.parse(JSON.stringify(value)) as TaskSettings;validateTaskSettings(snapshot);
    this.cancelSettingsRetry();this.retryAttempt=0;
    const c=this.coordinator,generation=++this.generation;this.saving=true;this.loading=false;this.notify();
    try{await this.closing;if(generation!==this.generation||c!==this.coordinator)return;
      await c.configure(undefined);await this.vault.save(snapshot);if(generation!==this.generation||c!==this.coordinator)return;
      await c.configure(snapshot);this.settingsNote='';
    }catch{this.settingsNote='任务配置未启用，请检查后重试';throw new Error('TASK_SETTINGS_SAVE_FAILED');}
    finally{this.saving=false;this.notify();}
  }
  private coordinatorForAction():TaskCoordinator{if(this.saving||this.loading||!this.coordinator)throw new Error('TASK_SETTINGS_BUSY');return this.coordinator;}
  private operation():string{const bytes=cryptoFramework.createRandom().generateRandomSync(16).data;
    try{return 'tap-'+Array.from(bytes).map((b:number):string=>b.toString(16).padStart(2,'0')).join('');}finally{bytes.fill(0);}}
  delegate(key:string,text:string,ttlMs:number):void{this.coordinatorForAction().delegate(key,this.operation(),text,ttlMs);}
  answer(key:string,id:string,revision:number,option:string|null,text:string):void{this.coordinatorForAction().answer(key,this.operation(),id,revision,option,text);}
  bindReply(key:string,id:string,revision:number):TaskReplyBinding{return this.coordinatorForAction().bindReply(key,this.operation(),id,revision);}
  validateReply(binding:TaskReplyBinding):void{this.coordinatorForAction().validateReply(binding);}
  operationExists(operation:string):boolean{return this.coordinatorForAction().operationExists(operation);}
  revalidateReply(binding:TaskReplyBinding):Promise<void>{return this.coordinatorForAction().revalidateReply(binding);}
  answerBound(binding:TaskReplyBinding,option:string|null,text:string,source:string='phone',recordSchema:number=2,voiceSource:TaskVoiceSourceRef|null=null):string{
    const answer=new TaskReplySubmission();answer.binding=JSON.parse(JSON.stringify(binding)) as TaskReplyBinding;answer.option_id=option;answer.text=text;answer.input_source=source;
    answer.record_schema=recordSchema;answer.voice_source=voiceSource?JSON.parse(JSON.stringify(voiceSource)) as TaskVoiceSourceRef:null;this.voiceSources.assertAnswer(answer);
    const draft=this.decisionDraft.snapshot();
    if(draft?.stage==='sealed'&&draft.binding.operation_id===answer.binding.operation_id&&
      !taskSameSubmission(taskRecordSubmission(draft),answer))throw new Error('TASK_OPERATION_CONFLICT');
    this.voiceSources.pin(answer);this.voiceSources.assertAnswer(answer);
    const state=this.coordinatorForAction().answerBound(answer.binding,answer.option_id,answer.text,answer.input_source);
    if(draft?.stage==='sealed'&&draft.binding.operation_id===answer.binding.operation_id&&['awaiting_refresh','queued','sending','reconcile','retry_wait','server_stored'].includes(state))this.decisionDraft.queued(answer.binding.operation_id);
    return state;
  }
  withdraw(key:string,operation:string):void{this.coordinatorForAction().withdraw(key,operation);}
  recheck(key:string,operation:string):void{this.coordinatorForAction().recheck(key,operation);}
  refresh(key:string,kind:string,id:string):Promise<void>{return this.coordinatorForAction().refresh(key,kind,id);}
  cancelTask(key:string,id:string,revision:number):Promise<void>{return this.coordinatorForAction().cancelTask(key,this.operation(),id,revision);}
  syncNow():Promise<void>{return this.coordinatorForAction().tick();}
  summary():TaskSummary{const s=this.coordinator?.summary()||new TaskSummary();s.configuring=s.configuring||this.loading||this.saving;return s;}
  defaultRoute():TaskRoute{return this.coordinator?.defaultRoute()||new TaskRoute();}
  sends():TaskSendView[]{return this.coordinator?.sends()||[];}
  objects():TaskCached[]{return this.coordinator?.objects()||[];}
  async dispose():Promise<void>{this.foreground=false;this.cancelSettingsRetry();this.retryAttempt=0;++this.generation;this.loading=false;this.pauseReplies();const c=this.coordinator;this.coordinator=undefined;
    if(c){c.changed=():void=>{};this.closing=c.stop();await this.closing;}}
}
export const taskService:TaskService=new TaskService();
