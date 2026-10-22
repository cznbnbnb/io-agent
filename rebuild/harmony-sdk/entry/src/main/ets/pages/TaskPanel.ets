import { taskService } from '../TaskService';
import { LengthMetrics } from '@kit.ArkUI';
import { TaskSettings } from '../TaskSettings';
import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { TaskTarget, TaskTransport } from '../TaskTransport';
import { TaskConnectionCandidate, readTaskConnectionFile } from '../TaskConnectionImport';
import { TaskSummary, TaskSendView } from '../TaskCoordinator';
import { TaskObject, TaskCommandBody, TaskRequestBody, TaskAnswerBody, TaskMessageBody, TaskOption, TaskReceiptBody, taskRequestCanAnswer } from '../TaskWire';
import { taskStageText, taskSendStateText, taskObjectStateText, taskErrorText } from '../TaskLabels';
import { AgentCapturePanel } from './AgentCapturePanel';
import { TaskReplyBinding,TaskDecisionPlan } from '../TaskReplyDraft';
import { taskSuggestions } from '../TaskSuggestionService';
import { TaskSuggestionPanel } from './TaskSuggestionPanel';

@Component
export struct TaskPanel {
  private answerBinding:TaskReplyBinding=new TaskReplyBinding();
  @State summary:TaskSummary=new TaskSummary();@State sends:TaskSendView[]=[];@State objects:TaskObject[]=[];
  @State command:string='';@State ttlMinutes:string='60';@State routeText:string='尚未配置目标会话';@State note:string='';
  @State commandNeedsConfirmation:boolean=false;private commandKey:string='';
  @State expanded:boolean=false;@State loaded:boolean=false;@State settingsBusy:boolean=false;@State taskEnabled:boolean=false;
  @State baseUrl:string='';@State token:string='';@State owner:string='';@State producer:string='';@State server:string='';
  @State computer:string='';@State agent:string='';@State project:string='';@State session:string='';
  @State question:TaskRequestBody=new TaskRequestBody();@State questionDeadline:string='';@State answerText:string='';@State option:string='';
  @State detailText:string='';private visible:boolean=false;private epoch:number=0;private profileKey:string='';private lastServiceNote:string='';
  @State hasSavedToken:boolean=false;@State credentialExpiry:number=0;
  private boundTarget:TaskTarget|undefined=undefined;private boundExpiry:number=0;
  private identityClient:TaskTransport=new TaskTransport();private pendingCandidate:TaskConnectionCandidate|undefined=undefined;
  aboutToAppear():void{this.visible=true;this.refresh();taskService.changed=():void=>{if(this.visible)this.refresh();};
    try{const path=this.pendingDirectory();if(!fs.accessSync(path))fs.mkdirSync(path);}catch{}}
  aboutToDisappear():void{this.visible=false;this.clearConnectionDraft();taskService.changed=():void=>{};}
  private pendingDirectory():string{return (this.getUIContext().getHostContext() as common.UIAbilityContext).filesDir+'/connection-import';}
  private pendingFile():string{return this.pendingDirectory()+'/task-connection.json';}
  private current(epoch:number):boolean{return this.visible&&this.expanded&&epoch===this.epoch;}
  private cancelCheck():void{this.identityClient.cancel();this.identityClient=new TaskTransport();}
  private clearConnectionDraft():void{
    ++this.epoch;this.cancelCheck();this.token='';this.boundTarget=undefined;this.boundExpiry=0;this.hasSavedToken=false;
    this.credentialExpiry=0;this.pendingCandidate=undefined;this.loaded=false;this.settingsBusy=false;
  }
  private edited():void{if(this.settingsBusy)return;++this.epoch;this.cancelCheck();this.credentialExpiry=0;}
  private matchesBinding():boolean{
    const target=this.boundTarget;return target!==undefined&&target.baseUrl.replace(/\/+$/,'')===this.baseUrl.trim().replace(/\/+$/,'')&&
      target.principal.ownerId===this.owner.trim()&&target.principal.producerId===this.producer.trim()&&target.principal.serverId===this.server.trim();
  }
  private proposedSettings():TaskSettings{
    const v=new TaskSettings();v.enabled=this.taskEnabled;v.target.baseUrl=this.baseUrl.trim();
    v.target.token=this.token.trim()||(this.matchesBinding()?this.boundTarget?.token||'':'');
    v.target.principal.ownerId=this.owner.trim();v.target.principal.producerId=this.producer.trim();v.target.principal.serverId=this.server.trim();
    v.route.computer_id=this.computer.trim();v.route.agent_id=this.agent.trim();v.route.project_id=this.project.trim();v.route.session_id=this.session.trim();return v;
  }
  private expectedExpiry():number|undefined{return !this.token.trim()&&this.matchesBinding()&&this.boundExpiry>0?this.boundExpiry:undefined;}
  private connectionError(error:Error):string{
    const code=error?.message;
    if(['TASK_IMPORT_EXPIRED','TASK_EXPIRY_MISMATCH'].includes(code))return '任务连接已过期或期限不匹配，请重新登记后导入';
    if(code==='TASK_IMPORT_INVALID')return '任务连接文件格式不正确，已有配置未改变';
    if(code==='TASK_IMPORT_READ_FAILED')return '任务连接文件暂不可读，已有配置未改变';
    if(code==='TASK_TARGET_INVALID')return '请核对HTTPS地址与专用身份；地址或身份改变后需重新导入或输入对应令牌';
    if(code==='TASK_PHONE_SCOPE_REQUIRED')return '此凭据缺少手机委托、回答或取消权限，未保存';
    if(code==='TASK_IDENTITY_MISMATCH')return '服务器或手机身份不匹配，未保存';
    if(code==='TASK_SETTINGS_SAVE_FAILED')return '任务配置尚未启用，请重读并核对保存结果；任务记录保留';
    if(this.identityClient.lastIdentityStatus===401)return '任务凭据已失效，请重新登记后导入';
    if(this.identityClient.lastIdentityStatus===403)return '此凭据缺少任务权限，未保存';
    return '任务身份暂未核对成功，已有配置未改变；可稍后重试';
  }
  private async importConnection(fromComputer:boolean):Promise<void>{
    if(!this.loaded||this.settingsBusy||!this.visible||!this.expanded)return;
    this.cancelCheck();const epoch=++this.epoch;this.settingsBusy=true;
    try{
      let uri=this.pendingFile();
      if(!fromComputer){
        const context=this.getUIContext().getHostContext() as common.UIAbilityContext;
        const uris=await new picker.DocumentViewPicker(context).select({maxSelectNumber:1,fileSuffixFilters:['任务连接|.json']});
        if(!this.current(epoch))return;if(!uris.length){this.note='已取消导入，已有配置未改变';return;}uri=uris[0];
      }
      const candidate=readTaskConnectionFile(uri);this.identityClient.setForeground(true);
      const identity=await this.identityClient.preflight(candidate.target,candidate.expiresAt);
      if(!this.current(epoch))return;
      this.boundTarget=candidate.target;this.boundExpiry=candidate.expiresAt;this.token='';this.hasSavedToken=true;
      this.baseUrl=candidate.target.baseUrl;this.owner=candidate.target.principal.ownerId;this.producer=candidate.target.principal.producerId;this.server=candidate.target.principal.serverId;
      this.computer=candidate.route.computer_id;this.agent=candidate.route.agent_id;this.project=candidate.route.project_id;this.session=candidate.route.session_id;
      this.credentialExpiry=Date.parse(identity.expires_at);this.taskEnabled=false;this.pendingCandidate=fromComputer?candidate:undefined;
      this.note='手机身份、权限与期限已核对，尚未保存；开启后保存才会使用该目标。电脑会话可执行性仍需实际投递验证';
    }catch(error){if(this.current(epoch))this.note=this.connectionError(error as Error);}
    finally{if(this.current(epoch))this.settingsBusy=false;}
  }
  private cleanupPending(saved:TaskSettings):boolean{
    const candidate=this.pendingCandidate;if(!candidate)return true;
    try{
      const current=readTaskConnectionFile(this.pendingFile());
      if(current.tokenId!==candidate.tokenId||current.expiresAt!==candidate.expiresAt||
        JSON.stringify(current.target)!==JSON.stringify(candidate.target)||JSON.stringify(current.route)!==JSON.stringify(candidate.route)||
        JSON.stringify(saved.target)!==JSON.stringify(candidate.target)||JSON.stringify(saved.route)!==JSON.stringify(candidate.route))return false;
      fs.unlinkSync(this.pendingFile());this.pendingCandidate=undefined;return true;
    }catch{return false;}
  }
  private refresh():void {
    const summary=taskService.summary();
    this.summary=summary;if(summary.configuring)return;
    if(this.profileKey&&summary.contextKey!==this.profileKey){
      this.question=new TaskRequestBody();this.answerText='';this.option='';this.detailText='';
      if(this.command.trim())this.commandNeedsConfirmation=true;
    }
    this.profileKey=summary.contextKey;this.sends=taskService.sends();this.objects=taskService.objects().map((e):TaskObject=>e.item).slice(-20).reverse();
    const r=taskService.defaultRoute();this.routeText=r.session_id?`${r.computer_id} / ${r.agent_id} / ${r.project_id}\n会话 ${r.session_id}`:'尚未配置目标会话';
    const next=taskService.settingsNote,previous=this.lastServiceNote;
    if(next!==previous){this.lastServiceNote=next;if(next)this.note=next;else if(this.note===previous)this.note='';}
  }
  private status():string {
    if(!this.summary.enabled)return '任务连接未开启';if(!this.summary.foreground)return '等待回到前台';
    if(['ready','checking','received','refreshed','idle','processed','sending','reconciling','answer_queued','cancel_queued'].includes(this.summary.note))return this.summary.busy?'正在同步任务':'前台收发任务';
    return taskErrorText(this.summary.note);
  }
  private report(error:Error):void{this.note=taskErrorText(error.message);}
  private delegate():void {
    try{if(this.commandNeedsConfirmation||this.commandKey!==this.summary.contextKey)throw new Error('TASK_PROFILE_CHANGED');
      if(!/^[0-9]{1,4}$/.test(this.ttlMinutes))throw new Error('TASK_DEADLINE_INVALID');
      taskService.delegate(this.summary.contextKey,this.command,Number(this.ttlMinutes)*60000);this.command='';this.note='委托已保存到本机，服务器和电脑接收状态会分别显示';this.refresh();
    }catch(error){this.report(error as Error);}
  }
  private openQuestion(item:TaskObject):void {
    if(!this.canAnswer(item)){this.note='问题或所属任务已关闭，请刷新状态';return;}
    try{this.answerBinding=taskService.bindReply(this.summary.contextKey,item.object_id,item.revision);}
    catch(error){this.report(error as Error);return;}
    this.question=JSON.parse(JSON.stringify(item.body)) as TaskRequestBody;this.questionDeadline=item.expires_at;this.answerText='';this.option='';
    this.note='回答绑定此问题版本；问题若已变化，会保留草稿并要求重新确认';
  }
  private answer():void {
    try{if(this.answerBinding.request_id!==this.question.request_id||this.answerBinding.request_revision!==this.question.revision)throw new Error('TASK_REPLY_BINDING_STALE');
      const state=taskService.answerBound(this.answerBinding,this.option||null,this.answerText,'phone');
      this.question=new TaskRequestBody();this.answerText='';this.option='';this.note=state==='awaiting_refresh'?'答案草稿已保存，联网核对原问题后发送；以服务器接受结果为准':taskSendStateText(state)+'；请查看本机发送记录';this.refresh();
    }catch(error){this.report(error as Error);}
  }
  private startGlasses():void{
    try{
      const binding=taskService.bindReply(this.summary.contextKey,this.question.request_id,this.question.revision),plan=new TaskDecisionPlan();
      if(binding.mode==='choice'){
        if(binding.options.length!==2||!this.option)throw new Error('TASK_DECISION_MAPPING_REQUIRED');
        const adopt=binding.options.find((o:TaskOption):boolean=>o.option_id===this.option);
        if(!adopt)throw new Error('TASK_DECISION_MAPPING_REQUIRED');
        // Rejecting this proposal does not implicitly choose the other option.
        plan.adopt_option_id=adopt.option_id;plan.adopt_text=adopt.label;
      }
      taskSuggestions.start(binding,plan).catch((error:Error):void=>{if(this.visible)this.report(error);});
      this.note='眼镜选择只保存草稿，完整答案需手机确认；原厂按钮仍为添加/删除';
    }catch(error){this.report(error as Error);}
  }
  private canAnswer(item:TaskObject):boolean {
    if(item.kind!=='request')return false;
    const request=item.body as TaskRequestBody;
    // Search the full cache: the parent need not be in the visible last20 rows.
    const parent=taskService.objects().find((entry):boolean=>entry.item.kind==='task'&&entry.item.object_id===request.task_id);
    return taskRequestCanAnswer(item,parent?.item,Date.now());
  }
  private objectText(item:TaskObject):string {
    if(item.kind==='task')return (item.body as TaskCommandBody).command;
    if(item.kind==='request')return (item.body as TaskRequestBody).question;
    return (item.body as TaskMessageBody).text;
  }
  private routeFor(item:TaskObject):string{return (item.body as TaskCommandBody).route.session_id;}
  private canCancel(item:TaskObject):boolean{return item.kind==='task'&&['queued','agent_received','running','waiting_answer'].includes(item.state);}
  private async refreshObject(item:TaskObject):Promise<void>{
    const epoch=this.epoch;
    try{await taskService.refresh(this.summary.contextKey,item.kind,item.object_id);if(this.visible&&epoch===this.epoch){this.refresh();this.note=this.status();}}
    catch(error){if(this.visible&&epoch===this.epoch)this.report(error as Error);}
  }
  private async cancelTask(item:TaskObject):Promise<void>{
    const epoch=this.epoch;
    try{await taskService.cancelTask(this.summary.contextKey,item.object_id,item.revision);if(this.visible&&epoch===this.epoch){this.note='取消请求已保存，等待服务器及电脑确认；任务尚未确认停止';this.refresh();}}
    catch(error){if(this.visible&&epoch===this.epoch)this.report(error as Error);}
  }
  private withdraw(row:TaskSendView):void{try{taskService.withdraw(this.summary.contextKey,row.operationId);this.note='已撤回本机记录，未尝试向服务器发送';this.refresh();}catch(error){this.report(error as Error);}}
  private recheck(row:TaskSendView):void{try{taskService.recheck(this.summary.contextKey,row.operationId);this.note='已安排查账，原始内容和期限不变';this.refresh();}catch(error){this.report(error as Error);}}
  private async load():Promise<void>{
    this.clearConnectionDraft();this.settingsBusy=true;const epoch=this.epoch;
    try{const v=await taskService.settings();if(!this.visible||!this.expanded||epoch!==this.epoch)return;
      this.taskEnabled=v.enabled;this.baseUrl=v.target.baseUrl;this.boundTarget=JSON.parse(JSON.stringify(v.target)) as TaskTarget;
      this.token='';this.hasSavedToken=!!v.target.token;this.owner=v.target.principal.ownerId;this.producer=v.target.principal.producerId;this.server=v.target.principal.serverId;
      this.computer=v.route.computer_id;this.agent=v.route.agent_id;this.project=v.route.project_id;this.session=v.route.session_id;this.loaded=true;this.note='';
    }catch{if(this.visible&&epoch===this.epoch){this.loaded=false;this.note='配置暂不可读，请解锁后重试；已有配置未覆盖';}}
    finally{if(epoch===this.epoch)this.settingsBusy=false;}
  }
  private async save():Promise<void>{
    if(!this.loaded||this.settingsBusy)return;this.settingsBusy=true;const epoch=this.epoch;
    try{const v=this.proposedSettings();
      if(v.enabled){this.identityClient.setForeground(true);await this.identityClient.preflight(v.target,this.expectedExpiry());if(!this.current(epoch))return;}
      await taskService.save(v);if(this.current(epoch)){
        const cleaned=this.cleanupPending(v);this.boundTarget=JSON.parse(JSON.stringify(v.target)) as TaskTarget;this.token='';this.hasSavedToken=!!v.target.token;
        this.note=(v.enabled?'任务连接已开启，默认投向指定的现有会话':'任务连接已暂停，记录保留')+(cleaned?'':'；电脑登记文件未移除，请检查');this.refresh();}
    }catch(error){if(this.current(epoch))this.note=this.connectionError(error as Error);}
    finally{if(epoch===this.epoch)this.settingsBusy=false;}
  }
  @Builder
  settingsCard(){
    Column({space:8}){
      Text('使用手机专用任务令牌和已登记的电脑会话。保存并开启后才会发送委托及答案；后台暂停，回到前台继续。资料同步配置独立。').fontSize(12).fontColor($r('app.color.text_muted'))
      Row({space:8}){
        Button('导入任务连接').fontSize(11).enabled(this.loaded&&!this.settingsBusy).onClick(()=>this.importConnection(false))
        Button('读取电脑任务登记').fontSize(11).enabled(this.loaded&&!this.settingsBusy).onClick(()=>this.importConnection(true))
      }.width('100%')
      if(this.credentialExpiry>0)Text('凭据有效至 '+new Date(this.credentialExpiry).toLocaleString()+'；尚未证明电脑会话在线').fontSize(11).fontColor($r('app.color.text_muted'))
      TextInput({text:this.baseUrl,placeholder:'HTTPS API 地址（以 /v1 结尾）'}).enabled(this.loaded&&!this.settingsBusy).onChange((v:string):void=>{this.baseUrl=v;this.edited();})
      TextInput({text:this.owner,placeholder:'所有者 owner_id'}).enabled(this.loaded&&!this.settingsBusy).onChange((v:string):void=>{this.owner=v;this.edited();})
      TextInput({text:this.producer,placeholder:'本手机 producer_id'}).enabled(this.loaded&&!this.settingsBusy).onChange((v:string):void=>{this.producer=v;this.edited();})
      TextInput({text:this.server,placeholder:'服务器 server_id'}).enabled(this.loaded&&!this.settingsBusy).onChange((v:string):void=>{this.server=v;this.edited();})
      TextInput({text:this.token,placeholder:this.hasSavedToken?'已有绑定令牌；输入可替换':'手机专用任务令牌'}).type(InputType.Password).enabled(this.loaded&&!this.settingsBusy).onChange((v:string):void=>{this.token=v;this.edited();})
      TextInput({text:this.computer,placeholder:'目标电脑 computer_id'}).enabled(this.loaded&&!this.settingsBusy).onChange((v:string):void=>{this.computer=v;this.edited();})
      TextInput({text:this.agent,placeholder:'目标 Agent agent_id'}).enabled(this.loaded&&!this.settingsBusy).onChange((v:string):void=>{this.agent=v;this.edited();})
      TextInput({text:this.project,placeholder:'目标项目 project_id'}).enabled(this.loaded&&!this.settingsBusy).onChange((v:string):void=>{this.project=v;this.edited();})
      TextInput({text:this.session,placeholder:'已存在会话 session_id'}).enabled(this.loaded&&!this.settingsBusy).onChange((v:string):void=>{this.session=v;this.edited();})
      Row({space:8}){
        Toggle({type:ToggleType.Switch,isOn:this.taskEnabled}).enabled(this.loaded&&!this.settingsBusy).onChange((v:boolean):void=>{this.taskEnabled=v;this.edited();})
        Text('开启任务连接').layoutWeight(1).fontSize(13)
        Button('保存').fontSize(12).enabled(this.loaded&&!this.settingsBusy).onClick(()=>this.save())
        Button('重读').fontSize(12).enabled(!this.settingsBusy).onClick(()=>this.load())
      }.width('100%')
    }.width('100%')
  }
  build(){
    Column({space:12}){
      Row({space:8}){
        Text('电脑任务 · 接入验证中').fontSize(18).layoutWeight(1)
        Button(this.expanded?'收起设置':'任务设置').fontSize(12).onClick(()=>{this.expanded=!this.expanded;if(this.expanded)this.load();else this.clearConnectionDraft();})
      }.width('100%')
      Text(this.status()).fontSize(13).fontColor($r('app.color.text_secondary')).width('100%')
      Text(`待发送 ${this.summary.queued} · 答案待核对 ${this.summary.drafts} · 需处理 ${this.summary.blocked+this.summary.expired}`).fontSize(12).width('100%')
      Text('当前显示最近同步到的状态，服务器收到与电脑完成分别显示。').fontSize(12).fontColor($r('app.color.text_muted')).width('100%')
      if(this.expanded){this.settingsCard();AgentCapturePanel()}
      Text(this.routeText).fontSize(12).fontColor($r('app.color.text_secondary')).width('100%')
      TextArea({text:this.command,placeholder:'委托电脑 Agent 的任务'}).height(100).maxLength(65536).enabled(this.summary.enabled&&!this.summary.configuring&&!this.settingsBusy).onChange((v:string):void=>{this.command=v;if(!this.commandNeedsConfirmation)this.commandKey=this.summary.contextKey;})
      if(this.commandNeedsConfirmation){
        Text('目标会话已改变，请核对上方目标后重新确认。已输入的内容保留。').fontSize(12).width('100%')
        Button('使用当前目标').fontSize(12).enabled(this.summary.enabled&&!this.summary.configuring&&!this.settingsBusy).onClick(()=>{this.commandKey=this.summary.contextKey;this.commandNeedsConfirmation=false;})
      }
      Row({space:8}){
        Text('允许开始的期限（分钟）').fontSize(12).layoutWeight(1)
        TextInput({text:this.ttlMinutes}).width(72).type(InputType.Number).maxLength(4).onChange((v:string):void=>{this.ttlMinutes=v;})
        Button('保存委托').fontSize(12).enabled(this.summary.enabled&&!this.summary.configuring&&!this.settingsBusy&&!this.commandNeedsConfirmation&&!!this.command.trim()).onClick(()=>this.delegate())
      }.width('100%')
      Button('刷新任务').fontSize(12).enabled(this.summary.enabled&&!this.summary.busy&&!this.settingsBusy).onClick(()=>{taskService.syncNow().catch((e:Error):void=>{if(this.visible)this.report(e);});})
      TaskSuggestionPanel()
      if(this.question.request_id){
        Column({space:8}){
          Text(`回答问题 · 版本 ${this.question.revision}`).fontSize(15)
          Text(this.question.question).fontSize(14).width('100%')
          Text('问题期限：'+new Date(this.questionDeadline).toLocaleString()).fontSize(12)
          Text('眼镜选择草稿：点头保存采用答案；摇头进入补充询问。两选项时先点选要采用的选项。仍须手机提交完整答案。').fontSize(12).width('100%')
          Button('用眼镜选择草稿 · 验证').fontSize(12).enabled(this.summary.enabled&&!this.summary.configuring&&!this.summary.busy&&!this.settingsBusy).onClick(()=>this.startGlasses())
          ForEach(this.question.options,(o:TaskOption)=>{
            Button((this.option===o.option_id?'✓ ':'')+o.label).fontSize(13).width('100%').onClick(()=>{this.option=this.option===o.option_id?'':o.option_id;})
          },(o:TaskOption)=>o.option_id)
          TextArea({text:this.answerText,placeholder:'文字回答或附加条件'}).height(90).maxLength(65536).onChange((v:string):void=>{this.answerText=v;})
          Row({space:8}){
            Button('保存回答').fontSize(12).enabled(this.summary.enabled&&!this.summary.configuring&&!this.settingsBusy&&(!!this.option||!!this.answerText.trim())).onClick(()=>this.answer())
            Button('暂不回答').fontSize(12).onClick(()=>{this.question=new TaskRequestBody();this.answerText='';this.option='';})
          }
        }.padding(12).width('100%').backgroundColor($r('app.color.card_bg_soft')).borderRadius(14).alignItems(HorizontalAlign.Start)
      }
      if(this.note)Text(this.note).fontSize(12).fontColor($r('app.color.text_secondary')).width('100%')
      if(this.detailText){Text(this.detailText).fontSize(13).copyOption(CopyOptions.InApp).width('100%');Button('收起内容').fontSize(12).onClick(()=>{this.detailText='';})}
      Text('任务、问题与结果（最近20项）').fontSize(15).width('100%')
      if(!this.objects.length)Text('暂无已同步的任务或问题').fontSize(13).fontColor($r('app.color.text_muted'))
      ForEach(this.objects,(item:TaskObject)=>{
        Column({space:6}){
          Text(taskObjectStateText(item,Date.now())).fontSize(13).width('100%')
          Text(this.objectText(item)).fontSize(13).maxLines(3).width('100%')
          Text('原会话 '+this.routeFor(item)).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
          ForEach((item.receipts||[]).slice(-5),(r:TaskReceiptBody)=>{Text(taskStageText(r.stage)+` · 版本 ${r.subject_revision}`).fontSize(11)},(r:TaskReceiptBody)=>r.receipt_id)
          if(item.answer){Text('已接受答案：'+(item.answer.body as TaskAnswerBody).text).fontSize(13).width('100%')}
          Flex({wrap:FlexWrap.Wrap,space:{main:LengthMetrics.vp(8),cross:LengthMetrics.vp(8)}}){
            Button('查看内容').fontSize(11).onClick(()=>{this.detailText=this.objectText(item);})
            Button('核对状态').fontSize(11).enabled(this.summary.enabled&&!this.summary.busy&&!this.settingsBusy).onClick(()=>this.refreshObject(item))
            if(this.canAnswer(item)){Button('回答').fontSize(11).enabled(this.summary.enabled&&!this.summary.configuring).onClick(()=>this.openQuestion(item))}
            if(this.canCancel(item)){Button('请求取消').fontSize(11).enabled(this.summary.enabled&&!this.summary.busy&&!this.settingsBusy).onClick(()=>this.cancelTask(item))}
          }.width('100%')
        }.padding(12).width('100%').backgroundColor($r('app.color.card_bg_soft')).borderRadius(14).alignItems(HorizontalAlign.Start)
      // A server head/answer/receipt may change without a new object revision.
      // Include those facts so ArkUI rebuilds a plain (non-observed) row.
      },(item:TaskObject)=>JSON.stringify([item.kind,item.object_id,item.revision,item.state,item.answer?.object_id||'',(item.receipts||[]).map((r:TaskReceiptBody):string=>r.receipt_id)]))
      Text('本机发送记录（最近20项）').fontSize(15).width('100%')
      ForEach(this.sends,(row:TaskSendView)=>{
        Column({space:6}){
          Text(taskSendStateText(row.state)).fontSize(13).width('100%')
          Text(row.text).fontSize(13).maxLines(3).width('100%')
          if(row.error)Text(taskErrorText(row.error)).fontSize(12).fontColor($r('app.color.text_secondary')).width('100%')
          Row({space:8}){
            Button('查看内容').fontSize(11).onClick(()=>{this.detailText=row.text;})
            if(row.canWithdraw){Button('撤回未发送内容').fontSize(11).enabled(this.summary.enabled&&!this.summary.configuring&&!this.settingsBusy).onClick(()=>this.withdraw(row))}
            if(row.canRecheck){Button('查账').fontSize(11).enabled(this.summary.enabled&&!this.summary.configuring&&!this.settingsBusy).onClick(()=>this.recheck(row))}
          }.width('100%')
        }.padding(12).width('100%').backgroundColor($r('app.color.card_bg_soft')).borderRadius(14).alignItems(HorizontalAlign.Start)
      },(row:TaskSendView)=>JSON.stringify([row.operationId,row.state,row.error,row.canWithdraw,row.canRecheck]))
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
