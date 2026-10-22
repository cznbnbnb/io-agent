import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { localWorkspace, WorkspaceEntry, WorkspaceTodo, WorkspaceTodoReference, WorkspaceTodoDeletionView, newWorkspaceTodoDeleteId } from '../LocalWorkspace';
import { probeSession } from '../ProbeSession';
import { manuscriptEditor } from '../ManuscriptEditor';

@Extend(Button)
function chipBtn() {
  .backgroundColor($r('app.color.input_bg'))
  .fontColor($r('app.color.text_primary'))
}


@Component
export struct LibraryPanel {
  onManuscriptEditorRequest:()=>void=():void=>{};

  @Prop @Watch('categoryChanged') category: string = '待办';
  @State todos: WorkspaceTodo[] = [];
  @State entries: WorkspaceEntry[] = [];
  @State note: string = '';
  @State titleText: string = '';
  @State manuscriptTitle: string = '';
  @State manuscriptText: string = '';
  @State manuscriptId:string='';@State manuscriptRevision:number=0;
  @State manuscriptBusy:boolean=false;@State manuscriptNote:string='';
  @State tab: string = 'conversation';
  @State busy: boolean = false;
  @State selected: string = '';
  @State editing: number = 0;
  @State todoBusy:boolean=false;
  @State deletions:WorkspaceTodoDeletionView[]=[];
  @State deletionHasMore:boolean=false;
  @State deletionIncomplete:boolean=false;
  @State todoQueryNote:string='';
  private deletionCursor:string='';private deletionNextCursor:string='';
  private epoch:number=0;
  private visible: boolean = false;
  aboutToAppear():void{
    this.visible=true;++this.epoch;this.todoBusy=false;const epoch=this.epoch;localWorkspace.changed=():void=>{if(this.visible&&this.epoch===epoch)this.refresh();};manuscriptEditor.changed=():void=>this.refresh();this.refresh();
    if(this.category==='待办'&&!localWorkspace.autoQueried&&probeSession.features.state.connected&&probeSession.foreground){
      localWorkspace.autoQueried=true;
      this.queryTodos();
    }
  }
  aboutToDisappear():void{this.visible=false;++this.epoch;this.todoBusy=false;localWorkspace.changed=():void=>{};manuscriptEditor.changed=():void=>{};}
  private categoryChanged():void{
    ++this.epoch;this.todoBusy=false;this.deletionCursor='';
    if(this.visible){const epoch=this.epoch;localWorkspace.changed=():void=>{if(this.visible&&this.epoch===epoch)this.refresh();};this.refresh();}
  }
  private refresh():void{if(!this.visible)return;this.todos=[...localWorkspace.todos];this.entries=[...localWorkspace.entries];this.note=localWorkspace.note;
    this.manuscriptTitle=manuscriptEditor.title;this.manuscriptText=manuscriptEditor.text;this.manuscriptId=manuscriptEditor.id;this.manuscriptRevision=manuscriptEditor.revision;this.manuscriptBusy=manuscriptEditor.busy;this.manuscriptNote=manuscriptEditor.note;
    if(this.category==='待办'){this.loadTodoDeletions(this.deletionCursor);this.refreshTodoQuery();}
  }
  private todoCurrent(epoch:number):boolean{return this.visible&&this.epoch===epoch&&this.category==='待办'&&probeSession.foreground;}
  private sameTodoReference(a:WorkspaceTodoReference,b:WorkspaceTodoReference):boolean{
    return a.id===b.id&&a.revision===b.revision&&a.peer===b.peer&&a.content_sha256===b.content_sha256;
  }
  private todoError(code:string):string{
    if(code.includes('STALE')||code.includes('CONFLICT')||code.includes('NOT_FOUND'))return '待办或删除状态已变化，请重新核对后操作';
    if(code.includes('FOREGROUND')||code.includes('PEER')||code.includes('CONNECT'))return '当前页面或原眼镜连接条件已变化，未继续操作';
    if(code.includes('LIMIT')||code.includes('ATTEMPT'))return '已达到本次删除的发送上限，请先核对眼镜实际状态';
    return '本次删除操作尚未确认完成，请查看删除记录；不会把未知结果当作成功';
  }
  private async confirmTodoDelete(row:WorkspaceTodo):Promise<void>{
    if(!this.todoCurrent(this.epoch)||this.busy||this.todoBusy)return;
    const epoch=this.epoch;this.todoBusy=true;
    try{
      const item=localWorkspace.todoSnapshot(row.id),reference=JSON.parse(JSON.stringify(item.reference)) as WorkspaceTodoReference;
      const answer=await this.getUIContext().getPromptAction().showDialog({title:'删除这条待办？',message:'删除「'+item.title+'」？本机保留删除记录；属于眼镜的待办会向原眼镜提交删除。未发送前可撤销，已提交或结果未知时不能假装撤回。',buttons:[{text:'取消',color:'#666666'},{text:'删除',color:'#B34335'}]});
      if(answer.index!==1||!this.todoCurrent(epoch))return;
      if(!this.sameTodoReference(reference,localWorkspace.todoSnapshot(reference.id).reference))throw new Error('TODO_STALE');
      const result=await localWorkspace.deleteTodo(newWorkspaceTodoDeleteId(),reference);
      if(!this.todoCurrent(epoch))return;
      if(this.editing===reference.id){this.editing=0;this.titleText='';}
      this.deletionCursor='';this.refresh();this.note=this.todoDeletionText(result);
    }catch(error){if(this.todoCurrent(epoch))this.note=this.todoError((error as Error).message);}
    finally{if(this.visible&&this.epoch===epoch)this.todoBusy=false;}
  }
  private todoDeletionText(row:WorkspaceTodoDeletionView):string{
    if(row.phase==='local_deleted')return '已从本机移除；这条待办从未发往眼镜';
    if(row.phase==='pending')return '本机已移除，等待原眼镜连接后发送删除';
    if(row.phase==='sending')return '正在提交删除，结果尚未确定';
    if(row.phase==='submitted')return '删除已提交；眼镜是否已删除仍待核对';
    if(row.phase==='uncertain')return '删除提交结果不确定，不会自动重试';
    if(row.phase==='cancelled')return '已撤销未发送的删除，本机待办已恢复';
    if(row.phase==='missing')return '未找到这次删除记录';
    return '删除记录暂不可操作，请复核保存状态';
  }
  private loadTodoDeletions(cursor:string=''):void{
    try{const page=localWorkspace.todoPage('deleted',10,cursor);this.deletions=page.deletions;this.deletionCursor=cursor;this.deletionNextCursor=page.next_cursor;this.deletionHasMore=page.has_more;this.deletionIncomplete=page.incomplete;}
    catch(_){this.deletions=[];this.deletionNextCursor='';this.deletionHasMore=false;this.deletionIncomplete=true;}
  }
  private nextTodoDeletions():void{
    if(!this.todoCurrent(this.epoch)||this.busy||this.todoBusy||!this.deletionHasMore||!this.deletionNextCursor)return;
    this.loadTodoDeletions(this.deletionNextCursor);
  }
  private async cancelTodoDeletion(row:WorkspaceTodoDeletionView):Promise<void>{
    if(!this.todoCurrent(this.epoch)||this.busy||this.todoBusy)return;
    const epoch=this.epoch;this.todoBusy=true;
    try{
      const current=localWorkspace.todoDeleteStatus(row.operation_id);
      if(current.state_sha256!==row.state_sha256||!current.can_cancel||current.attempts!==0)throw new Error('TODO_CONFLICT');
      const result=await localWorkspace.cancelTodoDelete(row.operation_id,row.state_sha256);
      if(this.todoCurrent(epoch)){this.refresh();this.note=this.todoDeletionText(result);}
    }catch(error){if(this.todoCurrent(epoch))this.note=this.todoError((error as Error).message);}
    finally{if(this.visible&&this.epoch===epoch)this.todoBusy=false;}
  }
  private async confirmTodoResend(row:WorkspaceTodoDeletionView):Promise<void>{
    if(!this.todoCurrent(this.epoch)||this.busy||this.todoBusy)return;
    const epoch=this.epoch;this.todoBusy=true;
    try{
      const current=localWorkspace.todoDeleteStatus(row.operation_id);
      if(current.state_sha256!==row.state_sha256||!current.can_send)throw new Error('TODO_CONFLICT');
      const operationId=current.operation_id,stateSha=current.state_sha256;
      const answer=await this.getUIContext().getPromptAction().showDialog({title:current.attempts?'再次发送删除？':'发送删除？',message:'向原眼镜提交「'+current.todo.title+'」的删除。提交或收据计数不能证明这条待办已删除；结果未知时重试可能重复发送。累计最多'+current.max_attempts+'次。',buttons:[{text:'取消',color:'#666666'},{text:'明确发送',color:'#B34335'}]});
      if(answer.index!==1||!this.todoCurrent(epoch))return;
      const latest=localWorkspace.todoDeleteStatus(operationId);
      if(latest.state_sha256!==stateSha||!latest.can_send)throw new Error('TODO_CONFLICT');
      const result=await localWorkspace.sendTodoDelete(operationId,stateSha);
      if(this.todoCurrent(epoch)){this.refresh();this.note=this.todoDeletionText(result);}
    }catch(error){if(this.todoCurrent(epoch))this.note=this.todoError((error as Error).message);}
    finally{if(this.visible&&this.epoch===epoch)this.todoBusy=false;}
  }
  private refreshTodoQuery():void{
    try{const query=localWorkspace.todoQueryStatus();this.todoQueryNote=this.todoQueryPhaseText(query.phase)+'；收到'+query.batches+'批、'+query.received+'条回报。未查到不代表删除已确认。';}
    catch(_){this.todoQueryNote='查询状态暂不可读；未查到不代表删除已确认。';}
  }
  private todoQueryPhaseText(phase:string):string{
    if(phase==='idle')return '尚未发起本轮查询';if(phase==='waiting')return '等待眼镜分批回报';
    if(phase==='complete')return '本轮查询收集结束';if(phase==='incomplete')return '本轮回报范围尚不完整';
    if(phase==='disconnected')return '查询期间连接已断开';if(phase==='error')return '本轮查询未完成';return '查询状态待核对';
  }
  private async queryTodos():Promise<void>{
    if(!this.todoCurrent(this.epoch)||this.busy||this.todoBusy)return;
    const epoch=this.epoch;this.todoBusy=true;
    try{await localWorkspace.queryCurrentTodos();if(this.todoCurrent(epoch)){this.refresh();this.note='已请求眼镜回报当前待办；查询缺席不能单独确认删除';}}
    catch(error){if(this.todoCurrent(epoch))this.note=this.todoError((error as Error).message);}
    finally{if(this.visible&&this.epoch===epoch)this.todoBusy=false;}
  }
  private async confirmManuscript(message:string):Promise<boolean>{
    const result=await this.getUIContext().getPromptAction().showDialog({title:'稿件',message:message,buttons:[{text:'取消',color:'#666666'},{text:'确认',color:'#167C57'}]});return result.index===1;
  }
  private manuscriptAction(action:()=>Promise<void>):void{
    if(!this.visible||this.busy||manuscriptEditor.busy)return;
    action().catch((error:Error):void=>{manuscriptEditor.note=error.message;manuscriptEditor.changed();});
  }
  private chooseManuscript(entry:WorkspaceEntry):void{this.manuscriptAction(async():Promise<void>=>{await manuscriptEditor.choose(entry.id,()=>this.confirmManuscript('替换当前未保存草稿？'));if(this.visible&&manuscriptEditor.id===entry.id)this.onManuscriptEditorRequest();});}
  private removeManuscript(entry:WorkspaceEntry):void{this.manuscriptAction(()=>manuscriptEditor.remove(entry.id,(row:WorkspaceEntry):Promise<boolean>=>this.confirmManuscript(`删除「${row.title}」的本机稿件？未保存草稿仍保留。`)));}
  private saveManuscript(asNew:boolean=false):void{this.manuscriptAction(()=>manuscriptEditor.save(asNew));}
  private run(action:()=>Promise<void>):void {
    if(this.busy)return;this.busy=true;this.note='正在处理…';action().then(()=>{if(this.visible){this.note=localWorkspace.note;this.getUIContext().getPromptAction().showToast({message:this.note,duration:3000});}}).catch((error:Error)=>{if(this.visible){this.note=error.message;this.getUIContext().getPromptAction().showToast({message:this.note,duration:3000});}}).finally(()=>{if(this.visible)this.busy=false;});
  }
  private delivery(row:WorkspaceTodo):string {
    if(row.delivery==='conflict')return '状态冲突';if(row.delivery==='submitted')return '已提交 · 未确认';
    if(row.delivery==='confirmed')return '眼镜已回报';if(row.delivery==='pending')return '待发送';return '仅本机';
  }
  private async saveMarkdown(entry:WorkspaceEntry):Promise<void>{
    const context=this.getUIContext().getHostContext() as common.UIAbilityContext;
    const uris=await new picker.DocumentViewPicker(context).save({newFileNames:[`TurboIO-${entry.kind}-${entry.created}.md`]});
    if(!uris.length)return;
    const content=new util.TextEncoder().encodeInto(localWorkspace.markdown(entry));
    const file=fs.openSync(uris[0],fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<content.length){const written=fs.writeSync(file.fd,content.slice(offset).buffer);if(written<=0)throw new Error('文件未完整写入');offset+=written;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);content.fill(0);}
    if(this.visible)this.note='Markdown 已保存到你选择的文件位置';
  }
  private async readManuscriptText():Promise<string|undefined>{
    const context=this.getUIContext().getHostContext() as common.UIAbilityContext;
    const uris=await new picker.DocumentViewPicker(context).select({maxSelectNumber:1,fileSuffixFilters:['纯文本|.txt,.md']});if(!uris.length)return undefined;
    const file=fs.openSync(uris[0],fs.OpenMode.READ_ONLY);
    let bytes:Uint8Array=new Uint8Array();
    try{
      const size=fs.statSync(file.fd).size;if(size<=0||size>400000)throw new Error('文本文件须小于 400 KB');
      bytes=new Uint8Array(size);let offset=0;
      while(offset<size){const part=new ArrayBuffer(size-offset);try{const count=fs.readSync(file.fd,part,{length:size-offset});if(!Number.isInteger(count)||count<=0||count>size-offset)throw new Error('文本读取不完整');bytes.set(new Uint8Array(part,0,count),offset);offset+=count;}finally{new Uint8Array(part).fill(0);}}
      if(fs.statSync(file.fd).size!==size)throw new Error('文件读取期间已变化，请重新选择');
      const text=new util.TextDecoder('utf-8',{fatal:true}).decodeToString(bytes);
      if(text.includes('\u0000')||text.length>100000)throw new Error('需要 UTF-8 文本，正文不超过 10 万字');
      return text;
    }finally{bytes.fill(0);fs.closeSync(file);}
  }
  @Builder
  private todoDeletionCard(row:WorkspaceTodoDeletionView){
    Column({space:8}){
      Text(row.todo.title).fontSize(15).fontColor($r('app.color.text_primary')).width('100%')
      Text(this.todoDeletionText(row)).fontSize(12).fontColor($r('app.color.text_secondary')).width('100%')
      Text('已尝试 '+row.attempts+'/'+row.max_attempts+' 次；已提交和未知结果均不能撤回。').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
      if(row.receipt_observed){Text(row.receipt_correlation==='failure_id'?'收到带本条标识的失败回报，请核对后再决定。':'收到同连接操作回报；缺少本条成功标识，不能据此确认删除。').fontSize(11).fontColor($r('app.color.warm')).width('100%')}
      if(row.query_at){Text('已有查询观察；未出现在回报中不代表删除已确认。').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')}
      Row({space:8}){
        if(row.can_cancel&&row.attempts===0){Button('撤销未发删除').chipBtn().fontSize(11).height(30).enabled(!this.busy&&!this.todoBusy).onClick(()=>this.cancelTodoDeletion(row))}
        if(row.can_send){Button(row.attempts?'明确重试':'发送删除').chipBtn().fontSize(11).height(30).enabled(!this.busy&&!this.todoBusy).onClick(()=>this.confirmTodoResend(row))}
      }.width('100%')
    }.padding(12).borderRadius(14).backgroundColor($r('app.color.card_bg')).width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder
  private todoCard(row:WorkspaceTodo) {
    Column({space:12}) {
      Row({space:10}) {
        Button(row.completed?'✓':'○').width(38).height(38).fontColor(row.completed?$r('app.color.on_brand'):$r('app.color.text_secondary')).backgroundColor(row.completed?$r('app.color.brand'):$r('app.color.border')).enabled(!this.busy&&!this.todoBusy)
          .onClick(()=>this.run(()=>localWorkspace.editTodo(row.id,row.title,!row.completed)))
        Text(row.title).fontColor($r('app.color.text_primary')).fontSize(17).layoutWeight(1)
      }.width('100%')
      Row({space:8}) {
        Text(this.delivery(row)).fontColor(row.delivery==='conflict'?$r('app.color.warm'):$r('app.color.text_muted')).fontSize(11).layoutWeight(1)
        Button('修改').fontSize(11).height(30).backgroundColor($r('app.color.border')).enabled(!this.busy&&!this.todoBusy).onClick(()=>{this.editing=row.id;this.titleText=row.title;})
        Button('删除').fontSize(11).height(30).backgroundColor($r('app.color.border')).enabled(!this.busy&&!this.todoBusy).onClick(()=>this.confirmTodoDelete(row))
        Button(this.busy?'处理中…':'发送眼镜').fontSize(11).height(30).backgroundColor($r('app.color.brand_deep')).enabled(!this.busy&&!this.todoBusy&&row.delivery!=='conflict')
          .onClick(()=>this.run(()=>localWorkspace.sendTodo(row.id,probeSession.peerDeviceId,(business:number,payload:Uint8Array)=>probeSession.auth.sendBusiness(business,payload))))
      }.width('100%')
      if(row.delivery==='conflict') {
        Text(`眼镜回报：${row.observed===1?'完成':'未完成'}；手机修改未被覆盖`).fontSize(12).fontColor($r('app.color.warm'))
        Row({space:8}) {
          Button('采用眼镜').chipBtn().fontSize(12).enabled(!this.busy&&!this.todoBusy).onClick(()=>this.run(()=>localWorkspace.resolveTodo(row.id,true)))
          Button('保留本机待发送').chipBtn().fontSize(12).enabled(!this.busy&&!this.todoBusy).onClick(()=>this.run(()=>localWorkspace.resolveTodo(row.id,false)))
        }
      }
    }.padding(16).borderRadius(18).backgroundColor($r('app.color.card_bg')).width('100%').alignItems(HorizontalAlign.Start)
  }
  build() {
    Column({space:16}) {
      Text(this.category==='待办'?'今天，从一件事开始':'我的资料').fontSize(25).fontWeight(FontWeight.Bold).fontColor($r('app.color.text_primary'))
      Text(this.note).fontColor($r('app.color.text_muted')).fontSize(12).width('100%')
      if(this.category==='待办') {
        Row({space:8}) {
          TextInput({text:this.titleText,placeholder:this.editing?'修改待办标题':'添加新的待办事项…'}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).maxLength(60).height(48).layoutWeight(1).backgroundColor($r('app.color.row_bg')).fontColor($r('app.color.text_primary')).onChange((v:string)=>{this.titleText=v;})
          Button(this.editing?'保存':'添加').height(48).backgroundColor($r('app.color.brand')).fontColor($r('app.color.on_brand')).enabled(!this.busy&&!this.todoBusy&&localWorkspace.ready&&this.titleText.trim().length>0).onClick(()=>this.run(async()=>{
            const row=this.todos.find(t=>t.id===this.editing);
            if(this.editing&&row)await localWorkspace.editTodo(row.id,this.titleText,row.completed);else await localWorkspace.addTodo(this.titleText);
            this.titleText='';this.editing=0;
          }))
        }.width('100%')
        Button('从眼镜读取全部待办').chipBtn().width('100%').height(40).enabled(!this.busy&&!this.todoBusy&&probeSession.features.state.connected)
          .onClick(()=>this.queryTodos())
        Text(this.todoQueryNote).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
        if(this.todos.length===0){Text('暂无待办\n新增后可逐条发送到眼镜，不改动眼镜上其他内容。').fontSize(15).fontColor($r('app.color.text_muted')).padding(20)}
        if(this.todos.some(t=>!t.completed)) {
          Text(`待完成 · ${this.todos.filter(t=>!t.completed).length}`).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).width('100%')
          ForEach(this.todos.filter(t=>!t.completed),(row:WorkspaceTodo)=>{this.todoCard(row)},(row:WorkspaceTodo)=>String(row.id))
        }
        if(this.todos.some(t=>t.completed)) {
          Text(`已完成 · ${this.todos.filter(t=>t.completed).length}`).fontSize(15).fontColor($r('app.color.text_muted')).width('100%')
          ForEach(this.todos.filter(t=>t.completed),(row:WorkspaceTodo)=>{this.todoCard(row)},(row:WorkspaceTodo)=>String(row.id))
        }
        Text('删除记录').fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).width('100%')
        Text('记录保留本机删除与发送状态；收据和查询均不替代逐条删除确认。').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
        if(this.deletionIncomplete){Text('删除记录范围不完整或目录已变化，请返回首批重新核对。').fontSize(11).fontColor($r('app.color.warm')).width('100%')}
        if(!this.deletions.length&&!this.deletionIncomplete){Text('当前没有删除记录。').fontSize(12).fontColor($r('app.color.text_muted')).width('100%')}
        ForEach(this.deletions,(row:WorkspaceTodoDeletionView)=>{this.todoDeletionCard(row)},(row:WorkspaceTodoDeletionView)=>row.operation_id+':'+row.state_sha256)
        Row({space:8}){
          Button('删除记录首批').chipBtn().fontSize(11).height(30).enabled(!this.busy&&!this.todoBusy).onClick(()=>this.loadTodoDeletions(''))
          Button('更多删除记录').chipBtn().fontSize(11).height(30).enabled(!this.busy&&!this.todoBusy&&this.deletionHasMore).onClick(()=>this.nextTodoDeletions())
        }.width('100%')
      }else {
        Row({space:8}) {
          Button('对话时间轴').layoutWeight(1).backgroundColor(this.tab==='conversation'?$r('app.color.brand_deep'):$r('app.color.card_raise')).onClick(()=>{this.tab='conversation';})
          Button('稿件').layoutWeight(1).backgroundColor(this.tab==='manuscript'?$r('app.color.brand_deep'):$r('app.color.card_raise')).onClick(()=>{this.tab='manuscript';})
        }.width('100%')
        if(this.tab==='manuscript') {
          if(this.manuscriptId){Text(`修改稿件 · 第${this.manuscriptRevision}版`).fontSize(12).fontColor($r('app.color.text_muted'))}
          Text(this.manuscriptNote).fontSize(12).fontColor($r('app.color.text_secondary')).width('100%')
          TextInput({text:this.manuscriptTitle,placeholder:'稿件标题'}).fontColor($r('app.color.text_primary')).caretColor($r('app.color.brand')).backgroundColor($r('app.color.input_bg')).height(46).maxLength(100).backgroundColor($r('app.color.row_bg')).fontColor($r('app.color.text_primary')).enabled(!this.busy&&!this.manuscriptBusy).onChange((v:string)=>manuscriptEditor.setTitle(v))
          TextArea({text:this.manuscriptText,placeholder:'粘贴稿件正文，或从文件导入 UTF-8 TXT / MD'}).height(170).maxLength(100000).backgroundColor($r('app.color.row_bg')).fontColor($r('app.color.text_primary')).enabled(!this.busy&&!this.manuscriptBusy).onChange((v:string)=>manuscriptEditor.setText(v))
          Row({space:8}) {
            Button('导入 TXT / MD').chipBtn().layoutWeight(1).enabled(!this.busy&&!this.manuscriptBusy).onClick(()=>this.manuscriptAction(()=>manuscriptEditor.importText(()=>this.readManuscriptText(),()=>this.confirmManuscript('替换当前未保存草稿并选择新文件？'))))
            Button(this.manuscriptId?'保存修改':'保存稿件').chipBtn().layoutWeight(1).enabled(!this.busy&&!this.manuscriptBusy&&localWorkspace.ready&&this.manuscriptText.trim().length>0).onClick(()=>this.saveManuscript())
          }
          Row({space:8}){
            Button('新建草稿').chipBtn().layoutWeight(1).enabled(!this.busy&&!this.manuscriptBusy).onClick(()=>this.manuscriptAction(()=>manuscriptEditor.fresh(()=>this.confirmManuscript('放弃当前未保存修改并新建草稿？'))))
            if(this.manuscriptId){Button('另存为新稿').chipBtn().layoutWeight(1).enabled(!this.busy&&!this.manuscriptBusy&&localWorkspace.ready&&this.manuscriptText.trim().length>0).onClick(()=>this.saveManuscript(true))}
          }
          Text('保存后可在「提词器」选择并完整传稿。首次支持 UTF-8 TXT / MD；EPUB 尚未迁移。').fontColor($r('app.color.warm')).fontSize(12)
        }
        if(!this.entries.some(e=>e.kind===this.tab)){Text(this.tab==='conversation'?'真实语音回答会自动保存在这里。旧版未保存的会话无法追溯恢复。':'暂无稿件').fontColor($r('app.color.text_muted')).fontSize(14).padding(16)}
        ForEach(this.entries.filter(e=>e.kind===this.tab),(entry:WorkspaceEntry)=>{
          Column({space:12}) {
            Text(new Date(entry.created).toLocaleString()).fontSize(11).fontColor($r('app.color.text_muted'))
            if(entry.kind==='manuscript'){Text(`第${entry.revision||1}版`).fontSize(11).fontColor($r('app.color.text_muted'))}
            Text(entry.title).fontSize(17).fontColor($r('app.color.text_primary')).fontWeight(FontWeight.Medium)
            Text(this.selected===entry.id?localWorkspace.markdown(entry):(entry.answer||entry.text).slice(0,120)).fontSize(14).fontColor($r('app.color.text_secondary')).copyOption(CopyOptions.LocalDevice)
            Row({space:8}) {
              Button(this.selected===entry.id?'收起':'展开').chipBtn().fontSize(12).height(34).onClick(()=>{this.selected=this.selected===entry.id?'':entry.id;})
              Button('导出 Markdown').chipBtn().fontSize(12).height(34).enabled(!this.busy).onClick(()=>this.run(()=>this.saveMarkdown(entry)))
              if(entry.kind==='manuscript'){
                Button('修改稿件').chipBtn().fontSize(12).height(34).enabled(!this.busy&&!this.manuscriptBusy).onClick(()=>this.chooseManuscript(entry))
                Button('删除稿件').chipBtn().fontSize(12).height(34).enabled(!this.busy&&!this.manuscriptBusy).onClick(()=>this.removeManuscript(entry))
              }
            }
          }.padding(18).width('100%').backgroundColor($r('app.color.card_bg')).borderRadius(18).alignItems(HorizontalAlign.Start)
        },(entry:WorkspaceEntry)=>entry.kind==='manuscript'?`${entry.id}:${entry.revision||1}`:entry.id)
      }
    }.padding(16).width('100%').backgroundColor($r('app.color.input_bg')).borderRadius(22).alignItems(HorizontalAlign.Start)
  }
}
