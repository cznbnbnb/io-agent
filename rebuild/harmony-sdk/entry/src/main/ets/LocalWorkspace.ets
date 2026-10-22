import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { businessEnvelope, readLauncherEnvelope, todoDeleteCommand } from 'turbo_core';
import { TodoQueryAccumulator, parseTodoDeleteReceipt, parseTodoQueryBatch, describeTodoQueryBatch } from './TodoProtocol';
import { WorkspaceTodoReference,WorkspaceTodoItem,WorkspaceTodoDeletionView,WorkspaceTodoPage,WorkspaceTodoQueryView,WorkspaceTodoTransport,todoHash,validWorkspaceTodoReference,sameWorkspaceTodoReference,newWorkspaceTodoDeleteId } from './TodoDeletionModel';
export { WorkspaceTodoReference,WorkspaceTodoItem,WorkspaceTodoDeletionView,WorkspaceTodoPage,WorkspaceTodoQueryView,WorkspaceTodoTransport,newWorkspaceTodoDeleteId,sameWorkspaceTodoReference } from './TodoDeletionModel';

export class WorkspaceTodo {
  id: number = 0; title: string = ''; completed: boolean = false; important: boolean = false;
  created: number = 0; modified: number = 0; revision: number = 1;
  peer: string = ''; delivery: string = 'local'; observed: number = -1;
}
export class WorkspaceEntry {
  id: string = ''; kind: string = 'conversation'; title: string = ''; text: string = '';
  answer: string = ''; model: string = ''; created: number = 0;
  revision:number=1;modified:number=0;
}
class TodoDeletion {
  operation_id:string='';reference:WorkspaceTodoReference=new WorkspaceTodoReference();todo:WorkspaceTodo=new WorkspaceTodo();
  revision:number=1;phase:string='pending';attempts:number=0;
  receipt_observed:boolean=false;receipt_success_count:number=-1;receipt_failure_code:number=-1;receipt_at:string='';receipt_correlation:string='none';
  query_observation:string='not_queried';query_at:string='';
}
class WorkspaceData {
  version: number = 1; todos: WorkspaceTodo[] = []; entries: WorkspaceEntry[] = [];
  deletions:TodoDeletion[]=[];legacy_backup_sha256:string='';
}
interface TodoBody { eventType:number;eventID:number;createTime:number;title:string;isImportant:number;status:number;lastModifiedTime:number; }
interface QueryBody { queryType:number;eventType:number;lastSyncTime:number;eventIDList:number[];needFullData:boolean; }

// Separate private store. No credentials, raw voice or GPS tracks. Flush before
// publishing any successful local edit or assigning a wire identity.
export class LocalWorkspace {
  todos: WorkspaceTodo[] = []; entries: WorkspaceEntry[] = [];
  ready: boolean = false; note: string = '正在读取本机资料';
  autoQueried: boolean = false; // 本次运行是否已自动向眼镜全量拉取过待办
  changed: ()=>void = ():void=>{};
  private context: common.Context|undefined = undefined;
  private chain: Promise<void> = Promise.resolve();
  private sending: boolean = false;
  private storageUncertain: boolean = false;
  private deletions:TodoDeletion[]=[];
  private formatVersion:number=1;
  private persistedRaw:string='';
  private legacyBackupSha:string='';
  private interruptedMigration:boolean=false;
  private todoTransport:WorkspaceTodoTransport|undefined=undefined;
  private inFlightDelete:string='';
  private query:WorkspaceTodoQueryView=new WorkspaceTodoQueryView();
  private queryAccumulator:TodoQueryAccumulator|undefined=undefined;
  private queryLease:number=-1;
  private queryTimer:number=-1;
  async load(context:common.Context):Promise<void>{
    if(this.storageUncertain)throw new Error('上一轮存储结果不确定，请重新启动应用后复核资料');
    if(this.ready)return;this.context=context;
    try{
      const prefs=await preferences.getPreferences(context,{name:'turboio_workspace_v1'});
      const raw=await prefs.get('data','');
      if(raw!==''){
        if(typeof raw!=='string'||raw.length>2000000)throw new Error('invalid-store');
        const data=JSON.parse(raw) as WorkspaceData;
        if(![1,2].includes(data.version)||!Array.isArray(data.todos)||data.todos.length>200||!Array.isArray(data.entries)||data.entries.length>500)throw new Error('invalid-store');
        const ids:number[]=[];
        for(const row of data.todos){
          if(!Number.isSafeInteger(row.id)||row.id<=0||ids.includes(row.id)||typeof row.title!=='string'||row.title.length>60||!row.title.trim()||typeof row.completed!=='boolean'||typeof row.important!=='boolean'||!Number.isSafeInteger(row.revision)||row.revision<1||!Number.isSafeInteger(row.created)||!Number.isSafeInteger(row.modified)||!['local','pending','submitted','confirmed','conflict'].includes(row.delivery)||typeof row.peer!=='string'||(row.peer!==''&&!/^[0-9a-f]{12}$/.test(row.peer))||![-1,0,1].includes(row.observed))throw new Error('invalid-store');
          ids.push(row.id);
        }
        for(const row of data.entries){if(typeof row.id!=='string'||!['conversation','manuscript'].includes(row.kind)||typeof row.text!=='string'||row.text.length>100000||typeof row.answer!=='string'||row.answer.length>8000||typeof row.title!=='string'||row.title.length>100||typeof row.model!=='string'||row.model.length>200||!Number.isSafeInteger(row.created))throw new Error('invalid-store');
          // Optional metadata keeps version-1 archives readable without an eager
          // rewrite. Normalize only a copied snapshot or the manuscript edited.
          if(row.kind==='manuscript'&&((row.revision!==undefined&&(!Number.isSafeInteger(row.revision)||row.revision<1))||(row.modified!==undefined&&(!Number.isSafeInteger(row.modified)||row.modified<0))))throw new Error('invalid-store');
        }
        if(data.version===2){
          if(!Array.isArray(data.deletions)||data.deletions.length>200||typeof data.legacy_backup_sha256!=='string'||!/^[0-9a-f]{64}$/.test(data.legacy_backup_sha256))throw new Error('invalid-store');
          const backup=await prefs.get('data_v1_backup','');
          if(typeof backup!=='string'||!backup||todoHash(backup)!==data.legacy_backup_sha256)throw new Error('invalid-backup');
          const operations:string[]=[];
          for(const deletion of data.deletions){
            if(!this.validDeletion(deletion)||operations.includes(deletion.operation_id))throw new Error('invalid-deletion');
            if(deletion.phase!=='cancelled'&&data.todos.some((row:WorkspaceTodo):boolean=>row.id===deletion.todo.id&&(!deletion.todo.peer||row.peer===deletion.todo.peer)))throw new Error('resurrected-deletion');
            operations.push(deletion.operation_id);
          }
          this.deletions=data.deletions;this.legacyBackupSha=data.legacy_backup_sha256;
        }else{
          if(data.deletions!==undefined&&(!Array.isArray(data.deletions)||data.deletions.length!==0))throw new Error('invalid-version');
          // Backup committed but main v2 did not: finish the same migration on
          // the next authorized write, before accepting any new v1 edit.
          const backup=await prefs.get('data_v1_backup','');
          if(backup!==''){if(backup!==raw)throw new Error('invalid-backup');this.interruptedMigration=true;}
        }
        this.todos=data.todos;this.entries=data.entries;this.formatVersion=data.version;this.persistedRaw=raw;
      }
      this.ready=true;this.note='资料仅保存在本机';
    }catch(_){this.ready=false;this.note='资料读取失败，保留原数据，不自动重建或覆盖';}
    this.changed();
  }
  private mutate(edit:(data:WorkspaceData)=>void):Promise<void>{
    const job=this.chain.catch(()=>{}).then(async()=>{
      if(!this.ready||!this.context)throw new Error('本机资料尚未就绪');
      const current=new WorkspaceData();current.version=this.formatVersion;current.todos=this.todos;current.entries=this.entries;current.deletions=this.deletions;current.legacy_backup_sha256=this.legacyBackupSha;
      const data=JSON.parse(JSON.stringify(current)) as WorkspaceData;edit(data);
      if(this.interruptedMigration)data.version=2;
      const prefs=await preferences.getPreferences(this.context,{name:'turboio_workspace_v1'});
      const migrating=data.version===2&&this.formatVersion===1;
      if(migrating){if(!this.persistedRaw)throw new Error('TODO_BLOCKED');data.legacy_backup_sha256=todoHash(this.persistedRaw);}
      const serialized=JSON.stringify(data);if(serialized.length>1900000)throw new Error('本机资料接近容量上限，请先导出并整理');
      try{
        if(migrating){
          const backup=await prefs.get('data_v1_backup','');
          if(backup!==''&&backup!==this.persistedRaw)throw new Error('backup-conflict');
          if(backup===''){await prefs.put('data_v1_backup',this.persistedRaw);await prefs.flush();}
        }
        await prefs.put('data',serialized);await prefs.flush();
      }
      catch(_){this.storageUncertain=true;this.ready=false;this.note='存储结果未确认，已停止后续写入；请重启应用复核，原数据不清除';this.changed();throw new Error(this.note);}
      this.todos=data.todos;this.entries=data.entries;this.deletions=data.deletions;this.formatVersion=data.version;this.legacyBackupSha=data.legacy_backup_sha256;this.interruptedMigration=false;this.persistedRaw=serialized;this.note='本机修改已保存';this.changed();
    });this.chain=job;return job;
  }
  private id():number{
    const bytes=cryptoFramework.createRandom().generateRandomSync(6).data;
    let id=0;for(const b of bytes)id=id*256+b;bytes.fill(0);return id;
  }
  addTodo(title:string):Promise<void>{
    title=title.trim();if(!title||title.length>60)return Promise.reject(new Error('待办标题限 1–60 字'));
    return this.mutate(data=>{if(data.todos.length>=200)throw new Error('待办最多 200 条');
      const row=new WorkspaceTodo();row.id=this.id();if(!row.id||data.todos.some(t=>t.id===row.id)||data.deletions.some((d:TodoDeletion):boolean=>d.todo.id===row.id))throw new Error('标识生成冲突，请重试');
      row.title=title;row.created=Math.floor(Date.now()/1000);row.modified=row.created;data.todos.unshift(row);
    });
  }
  editTodo(id:number,title:string,completed:boolean):Promise<void>{
    if(!title.trim()||title.trim().length>60)return Promise.reject(new Error('待办标题限 1–60 字'));
    return this.mutate(data=>{const row=data.todos.find(t=>t.id===id);if(!row)throw new Error('待办不存在');
      row.title=title.trim();row.completed=completed;row.modified=Math.floor(Date.now()/1000);row.revision++;
      row.delivery=row.observed>=0?'conflict':row.peer?'pending':'local';
    });
  }
  resolveTodo(id:number,acceptGlasses:boolean):Promise<void>{
    return this.mutate(data=>{const row=data.todos.find(t=>t.id===id);if(!row||row.observed<0)throw new Error('没有待处理冲突');
      if(acceptGlasses)row.completed=row.observed===1;
      row.observed=-1;row.revision++;row.modified=Math.floor(Date.now()/1000);row.delivery=acceptGlasses?'confirmed':'pending';
    });
  }
  async sendTodo(id:number,peer:string,send:(business:number,payload:Uint8Array)=>Promise<void>):Promise<void>{
    peer=this.normalizePeer(peer);
    if(this.sending)throw new Error('上一条仍在发送');if(!/^[0-9a-f]{12}$/.test(peer))throw new Error('尚未确认眼镜身份');
    this.sending=true;
    try{
      await this.mutate(data=>{const row=data.todos.find(t=>t.id===id);if(!row)throw new Error('待办不存在');
        if(row.peer&&row.peer!==peer)throw new Error('这条待办属于另一副眼镜，未发送');
        if(row.delivery==='conflict')throw new Error('请先处理完成状态冲突');
        row.peer=peer;row.delivery='pending';
      });
      const row=this.todos.find(t=>t.id===id);if(!row)throw new Error('待办不存在');const revision=row.revision;
      // isImportant 线上为 int（blutter 反编译证据）；时间字段沿用秒级（毫秒未证实，待真机比对）
      const body:TodoBody={eventType:1,eventID:row.id,createTime:row.created,title:row.title,isImportant:row.important?1:0,status:row.completed?1:0,lastModifiedTime:row.modified};
      const packet=businessEnvelope(2,new util.TextEncoder().encodeInto(JSON.stringify(body)));
      try{await send(22,packet);}finally{packet.fill(0);}
      await this.mutate(data=>{const current=data.todos.find(t=>t.id===id);if(current&&current.revision===revision&&current.delivery==='pending')current.delivery='submitted';});
      this.note='已提交单条；等待眼镜状态回传，不代表镜片已显示';this.changed();
    }finally{this.sending=false;this.kickTodoDeletes();}
  }
  // 官方 appQueryGlasses（type 0xF）：向眼镜请求全部待办/日程元数据（blutter 反编译 schema）
  async queryGlasses(peer:string,send:(business:number,payload:Uint8Array)=>Promise<void>):Promise<void>{
    peer=this.normalizePeer(peer);
    if(!this.ready)throw new Error('本机资料尚未就绪');
    if(this.sending)throw new Error('上一条仍在发送');
    if(!/^[0-9a-f]{12}$/.test(peer))throw new Error('尚未确认眼镜身份');
    this.sending=true;
    try{
      const body: QueryBody = {queryType:0,eventType:1,lastSyncTime:0,eventIDList:[],needFullData:true};
      const packet=businessEnvelope(15,new util.TextEncoder().encodeInto(JSON.stringify(body)));
      try{await send(22,packet);}finally{packet.fill(0);}
      this.note='已向眼镜请求全部待办，回报分批到达后自动合并';this.changed();
    }finally{this.sending=false;this.kickTodoDeletes();}
  }
  receiveTodo(peer:string,bytes:Uint8Array):void{
    peer=this.normalizePeer(peer);
    if(!this.ready||!/^[0-9a-f]{12}$/.test(peer))return;
    try{
      const envelope=readLauncherEnvelope(bytes);if(![4,10,14,16].includes(envelope.type))return;
      if(envelope.type===14){this.observeDeleteReceipt(peer,bytes);return;}
      if(envelope.type===16)this.observeTodoQuery(peer,bytes);
      const json=JSON.parse(new util.TextDecoder().decodeToString(envelope.json)) as Record<string,Object>;
      // appQueryResponse（type 16）：眼镜侧待办元数据分批回报，逐批 upsert；不覆盖本机未确认修改
      if(envelope.type===16){
        const list=json['dataList'];if(!Array.isArray(list)||list.length>200)return;
        const rows=(list as Record<string,Object>[]).filter(r=>r&&r['eventType']===1&&Number.isSafeInteger(r['eventID'])&&typeof r['title']==='string'&&(r['title'] as string).trim().length>0);
        if(!rows.length)return;
        this.mutate(data=>{
          for(const r of rows){
            const id=r['eventID'] as number;
            if(this.tombstoned(data,id,peer))continue;
            const title=(r['title'] as string).slice(0,60);
            const completed=r['status']===1;
            const important=r['isImportant']===1;
            const row=data.todos.find(t=>t.id===id);
            if(row){
              if(row.peer&&row.peer!==peer)continue; // 属于另一副眼镜
              if(['pending','conflict'].includes(row.delivery))continue; // 本机未确认修改优先
              row.peer=peer;row.completed=completed;row.important=important;row.delivery='confirmed';row.observed=-1;
              if(Number.isSafeInteger(r['createTime']))row.created=r['createTime'] as number;
              if(Number.isSafeInteger(r['lastModifiedTime']))row.modified=r['lastModifiedTime'] as number;
              continue;
            }
            if(data.todos.length>=200)return;
            // id 冲突防护：与本机非同眼镜条目撞 id 且标题不同则跳过
            if(data.todos.some(t=>t.id===id))continue;
            const neo=new WorkspaceTodo();neo.id=id;neo.title=title;neo.completed=completed;neo.important=important;
            neo.created=Number.isSafeInteger(r['createTime'])?r['createTime'] as number:Math.floor(Date.now()/1000);
            neo.modified=Number.isSafeInteger(r['lastModifiedTime'])?r['lastModifiedTime'] as number:neo.created;
            neo.peer=peer;neo.delivery='confirmed';neo.observed=-1;data.todos.push(neo);
          }
        }).then(()=>{this.note='已从眼镜同步待办（本机未确认的修改未被覆盖）';this.changed();}).catch(()=>{this.note='眼镜待办合并失败，本机数据未变';this.changed();});
        return;
      }
      let rows:Record<string,Object>[]=[];
      if(envelope.type===4)rows=[json];
      else if(Array.isArray(json['eventList']))rows=(json['eventList'] as Record<string,Object>[]).filter(r=>r['eventType']===1);
      if(rows.length>200)return;
      const updates=rows.filter(r=>Number.isSafeInteger(r['eventID'])&&[0,1].includes(r['status'] as number)&&this.todos.some(t=>t.id===r['eventID']&&t.peer===peer));
      if(!updates.length)return;
      this.mutate(data=>{for(const update of updates){if(this.tombstoned(data,update['eventID'] as number,peer))continue;const row=data.todos.find(t=>t.id===update['eventID']&&t.peer===peer);if(!row)continue;
        const completed=update['status']===1;
        if(['pending','conflict'].includes(row.delivery)){row.observed=completed?1:0;row.delivery='conflict';continue;}
        row.completed=completed;row.delivery='confirmed';row.observed=-1;
        if(update['isImportant']===1||update['isImportant']===true)row.important=true;
        if(update['isImportant']===0||update['isImportant']===false)row.important=false;
      }}).catch(()=>{this.note='眼镜状态尚未保存，本机数据未覆盖';this.changed();});
    }catch(_){/* Invalid/unknown IDs never import or overwrite tasks. */}
  }
  private todoItem(row:WorkspaceTodo):WorkspaceTodoItem {
    const item=new WorkspaceTodoItem();item.title=row.title;item.completed=row.completed;item.important=row.important;item.delivery=row.delivery;item.created=row.created;item.modified=row.modified;
    item.reference.id=row.id;item.reference.revision=row.revision;item.reference.peer=row.peer;
    item.reference.content_sha256=todoHash(JSON.stringify([row.id,row.revision,row.peer,row.title,row.completed,row.important,row.created,row.modified,row.delivery,row.observed]));
    return item;
  }
  private validDeletion(d:TodoDeletion):boolean {
    if(!d||typeof d!=='object'||!/^tdel-[0-9a-f]{32}$/.test(d.operation_id)||!validWorkspaceTodoReference(d.reference)||!d.todo)return false;
    const row=d.todo;
    if(!Number.isSafeInteger(row.id)||row.id<=0||typeof row.title!=='string'||!row.title.trim()||row.title.length>60||typeof row.completed!=='boolean'||typeof row.important!=='boolean'||!Number.isSafeInteger(row.revision)||row.revision<1||!Number.isSafeInteger(row.created)||!Number.isSafeInteger(row.modified)||!['local','pending','submitted','confirmed','conflict'].includes(row.delivery)||typeof row.peer!=='string'||(row.peer!==''&&!/^[0-9a-f]{12}$/.test(row.peer))||![-1,0,1].includes(row.observed))return false;
    if(!sameWorkspaceTodoReference(this.todoItem(row).reference,d.reference)||!Number.isSafeInteger(d.revision)||d.revision<1||!Number.isSafeInteger(d.attempts)||d.attempts<0||d.attempts>3||!['local_deleted','pending','sending','submitted','uncertain','cancelled'].includes(d.phase))return false;
    if((!row.peer&&d.attempts!==0)||(d.phase==='local_deleted'&&!!row.peer)||(d.phase==='pending'&&(!row.peer||d.attempts!==0))||(['sending','submitted','uncertain'].includes(d.phase)&&(!row.peer||d.attempts===0))||(d.phase==='cancelled'&&d.attempts!==0))return false;
    return typeof d.receipt_observed==='boolean'&&Number.isSafeInteger(d.receipt_success_count)&&d.receipt_success_count>=-1&&Number.isSafeInteger(d.receipt_failure_code)&&d.receipt_failure_code>=-1&&
      ['none','unattributed','failure_id'].includes(d.receipt_correlation)&&['not_queried','present','absent','incomplete'].includes(d.query_observation)&&this.validStamp(d.receipt_at)&&this.validStamp(d.query_at);
  }
  private validStamp(value:string):boolean {return typeof value==='string'&&(value===''||/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value));}
  private tombstoned(data:WorkspaceData,id:number,peer:string):boolean {
    return data.deletions.some((d:TodoDeletion):boolean=>d.phase!=='cancelled'&&d.todo.id===id&&(!d.todo.peer||d.todo.peer===peer));
  }
  todoSnapshot(id:number):WorkspaceTodoItem {
    if(!this.ready)throw new Error('TODO_BLOCKED');const row=this.todos.find((t:WorkspaceTodo):boolean=>t.id===id);
    if(!row)throw new Error('TODO_NOT_FOUND');return this.todoItem(row);
  }
  private deleteHash(d:TodoDeletion):string {
    return todoHash(JSON.stringify([d.operation_id,d.reference.id,d.reference.revision,d.reference.peer,d.reference.content_sha256,d.revision,d.phase,d.attempts,d.receipt_observed,d.receipt_success_count,d.receipt_failure_code,d.receipt_at,d.receipt_correlation,d.query_observation,d.query_at]));
  }
  private deletionView(d:TodoDeletion):WorkspaceTodoDeletionView {
    const view=new WorkspaceTodoDeletionView();view.operation_id=d.operation_id;view.state_sha256=this.deleteHash(d);view.revision=d.revision;view.todo=this.todoItem(d.todo);view.phase=d.phase;view.attempts=d.attempts;
    // A persisted sending claim after process loss is uncertain, never replayed.
    if(d.phase==='sending'&&this.inFlightDelete!==d.operation_id)view.phase='uncertain';
    view.note=view.phase==='local_deleted'?'已从本机移除，原条目保存在删除记录中':view.phase==='pending'?'已保存删除意图，等待原眼镜前台连接':view.phase==='sending'?'正在提交单条删除':view.phase==='submitted'?'删除消息已提交；不代表眼镜已删除':view.phase==='uncertain'?'发送结果未确认；保留删除记录，重试须确认':'已撤销未发送的删除，恢复本机条目';
    view.can_cancel=this.ready&&d.attempts===0&&['pending','local_deleted'].includes(d.phase);
    const port=this.todoTransport;
    view.can_send=this.ready&&!!d.todo.peer&&d.phase!=='cancelled'&&d.phase!=='local_deleted'&&d.attempts<3&&!this.sending&&!!port&&port.ready()&&port.foreground()&&this.normalizePeer(port.peer())===d.todo.peer;
    view.receipt_observed=d.receipt_observed;view.receipt_success_count=d.receipt_success_count;view.receipt_failure_code=d.receipt_failure_code;view.receipt_at=d.receipt_at;view.receipt_correlation=d.receipt_correlation;
    view.query_observation=d.query_observation;view.query_at=d.query_at;return view;
  }
  todoDeleteStatus(operationId:string):WorkspaceTodoDeletionView {
    if(!/^tdel-[0-9a-f]{32}$/.test(operationId))throw new Error('TODO_INVALID');
    if(!this.ready){const blocked=new WorkspaceTodoDeletionView();blocked.operation_id=operationId;blocked.phase='blocked';blocked.note='本机资料不可读，未执行操作';return blocked;}
    const d=this.deletions.find((row:TodoDeletion):boolean=>row.operation_id===operationId);
    if(d)return this.deletionView(d);const missing=new WorkspaceTodoDeletionView();missing.operation_id=operationId;return missing;
  }
  todoPage(scope:string='active',limit:number=10,cursor:string=''):WorkspaceTodoPage {
    if(!this.ready)throw new Error('TODO_BLOCKED');if(!['active','deleted'].includes(scope)||!Number.isSafeInteger(limit)||limit<1||limit>10||typeof cursor!=='string')throw new Error('TODO_INVALID');
    const page=new WorkspaceTodoPage();page.scope=scope;
    const items=this.todos.map((row:WorkspaceTodo):WorkspaceTodoItem=>this.todoItem(row));
    page.snapshot_sha256=todoHash(JSON.stringify([scope,scope==='active'?items.map((item:WorkspaceTodoItem):string=>item.reference.content_sha256):this.deletions.map((d:TodoDeletion):string=>this.deleteHash(d))]));
    let offset=0;
    if(cursor){const match=/^tcur-([0-9a-f]{64})-(0|[1-9]\d{0,2})$/.exec(cursor);if(!match)throw new Error('TODO_INVALID');if(match[1]!==page.snapshot_sha256)throw new Error('TODO_STALE');offset=Number(match[2]);}
    const total=scope==='active'?items.length:this.deletions.length;if(offset>total)throw new Error('TODO_INVALID');
    if(scope==='active')page.todos=items.slice(offset,offset+limit);else page.deletions=this.deletions.slice(offset,offset+limit).map((d:TodoDeletion):WorkspaceTodoDeletionView=>this.deletionView(d));
    page.scanned=Math.min(limit,total-offset);page.has_more=offset+page.scanned<total;if(page.has_more)page.next_cursor='tcur-'+page.snapshot_sha256+'-'+(offset+page.scanned).toString();return page;
  }
  async deleteTodo(operationId:string,reference:WorkspaceTodoReference):Promise<WorkspaceTodoDeletionView> {
    if(!/^tdel-[0-9a-f]{32}$/.test(operationId)||!validWorkspaceTodoReference(reference))throw new Error('TODO_INVALID');
    const frozen=JSON.parse(JSON.stringify(reference)) as WorkspaceTodoReference;
    await this.mutate((data:WorkspaceData):void=>{
      const existing=data.deletions.find((d:TodoDeletion):boolean=>d.operation_id===operationId);
      if(existing){if(!sameWorkspaceTodoReference(existing.reference,frozen))throw new Error('TODO_STALE');return;}
      if(data.deletions.length>=200)throw new Error('TODO_LIMIT');
      const row=data.todos.find((t:WorkspaceTodo):boolean=>t.id===frozen.id);if(!row)throw new Error('TODO_NOT_FOUND');
      if(!sameWorkspaceTodoReference(this.todoItem(row).reference,frozen))throw new Error('TODO_STALE');
      if(this.tombstoned(data,row.id,row.peer))throw new Error('TODO_STALE');
      const deletion=new TodoDeletion();deletion.operation_id=operationId;deletion.reference=frozen;deletion.todo=row;deletion.phase=row.peer?'pending':'local_deleted';
      data.version=2;data.deletions.unshift(deletion);data.todos=data.todos.filter((t:WorkspaceTodo):boolean=>t.id!==row.id);
    });
    this.kickTodoDeletes();return this.todoDeleteStatus(operationId);
  }
  async cancelTodoDelete(operationId:string,stateSha:string):Promise<WorkspaceTodoDeletionView> {
    this.validateDeleteCas(operationId,stateSha);
    await this.mutate((data:WorkspaceData):void=>{
      const d=data.deletions.find((row:TodoDeletion):boolean=>row.operation_id===operationId);if(!d)throw new Error('TODO_NOT_FOUND');
      if(this.deleteHash(d)!==stateSha)throw new Error('TODO_STALE');
      if(d.attempts!==0||!['pending','local_deleted'].includes(d.phase))throw new Error('TODO_ALREADY_SENT');
      if(data.todos.length>=200)throw new Error('TODO_LIMIT');if(data.todos.some((row:WorkspaceTodo):boolean=>row.id===d.todo.id))throw new Error('TODO_STALE');
      const restored=JSON.parse(JSON.stringify(d.todo)) as WorkspaceTodo;restored.revision++;if(!Number.isSafeInteger(restored.revision))throw new Error('TODO_LIMIT');restored.modified=Math.max(restored.modified,Math.floor(Date.now()/1000));
      data.todos.unshift(restored);d.phase='cancelled';d.revision++;
    });return this.todoDeleteStatus(operationId);
  }
  private validateDeleteCas(operationId:string,stateSha:string):void {
    if(!/^tdel-[0-9a-f]{32}$/.test(operationId)||typeof stateSha!=='string'||!/^[0-9a-f]{64}$/.test(stateSha))throw new Error('TODO_INVALID');
    if(!this.ready)throw new Error('TODO_BLOCKED');
  }
  async sendTodoDelete(operationId:string,stateSha:string):Promise<WorkspaceTodoDeletionView> {
    this.validateDeleteCas(operationId,stateSha);if(this.sending)throw new Error('TODO_BUSY');
    const port=this.todoTransport;if(!port||!port.ready())throw new Error('TODO_BLOCKED');if(!port.foreground())throw new Error('TODO_NOT_FOREGROUND');
    const peer=this.normalizePeer(port.peer()),lease=port.lease();this.sending=true;this.inFlightDelete=operationId;
    try{
      await this.mutate((data:WorkspaceData):void=>{
        const d=data.deletions.find((row:TodoDeletion):boolean=>row.operation_id===operationId);if(!d)throw new Error('TODO_NOT_FOUND');
        if(this.deleteHash(d)!==stateSha)throw new Error('TODO_STALE');if(!d.todo.peer||d.todo.peer!==peer)throw new Error('TODO_WRONG_PEER');
        if(d.phase==='cancelled'||d.phase==='local_deleted')throw new Error('TODO_ALREADY_SENT');if(d.attempts>=3)throw new Error('TODO_LIMIT');
        d.attempts++;d.phase='sending';d.revision++;
      });
      let submitted=false;
      try{
        if(this.todoTransport!==port||!port.ready()||!port.foreground()||port.lease()!==lease||this.normalizePeer(port.peer())!==peer)throw new Error('stale-lease');
        const d=this.deletions.find((row:TodoDeletion):boolean=>row.operation_id===operationId);if(!d)throw new Error('TODO_NOT_FOUND');
        const packet=businessEnvelope(7,new util.TextEncoder().encodeInto(todoDeleteCommand(d.todo.id)));
        try{await port.send(22,packet);}finally{packet.fill(0);}
        submitted=this.todoTransport===port&&port.ready()&&port.foreground()&&port.lease()===lease&&this.normalizePeer(port.peer())===peer;
      }catch(_){/* A thrown transport may already have written bytes. Never undo or replay it automatically. */}
      await this.mutate((data:WorkspaceData):void=>{const d=data.deletions.find((row:TodoDeletion):boolean=>row.operation_id===operationId);if(!d||d.phase!=='sending')throw new Error('TODO_STALE');d.phase=submitted?'submitted':'uncertain';d.revision++;});
      return this.todoDeleteStatus(operationId);
    }finally{this.sending=false;this.inFlightDelete='';this.changed();this.kickTodoDeletes();}
  }
  setTodoTransport(port:WorkspaceTodoTransport|undefined):void {
    this.todoTransport=port;this.todoConnectionChanged();
  }
  todoConnectionChanged():void {
    if(this.query.phase==='waiting')this.finishTodoQuery('disconnected','连接或前后台已变化，本轮查询不作为完整观察');
    this.kickTodoDeletes();this.changed();
  }
  private kickTodoDeletes():void {
    const port=this.todoTransport;if(!this.ready||this.sending||!port||!port.ready()||!port.foreground())return;
    const peer=this.normalizePeer(port.peer());const pending=this.deletions.find((d:TodoDeletion):boolean=>d.phase==='pending'&&d.attempts===0&&d.todo.peer===peer);
    if(pending)this.sendTodoDelete(pending.operation_id,this.deleteHash(pending)).catch(():void=>{});
  }
  private observeDeleteReceipt(peer:string,bytes:Uint8Array):void {
    const receipt=parseTodoDeleteReceipt(bytes);if(!receipt||receipt.sourceType!==7)return;
    const stamp=new Date().toISOString();
    this.mutate((data:WorkspaceData):void=>{for(const d of data.deletions){
      if(d.todo.peer!==peer||d.attempts===0||d.phase==='cancelled')continue;
      d.receipt_observed=true;d.receipt_success_count=receipt.successCount;d.receipt_at=stamp;d.receipt_correlation='unattributed';d.receipt_failure_code=-1;
      if(receipt.failList){const failure=receipt.failList.find((f):boolean=>f.eventID===d.todo.id);if(failure){d.receipt_correlation='failure_id';if(failure.errorCode!==null)d.receipt_failure_code=failure.errorCode;}}
      d.revision++;
    }}).catch(():void=>{});
  }
  todoQueryStatus():WorkspaceTodoQueryView {return JSON.parse(JSON.stringify(this.query)) as WorkspaceTodoQueryView;}
  async queryCurrentTodos():Promise<WorkspaceTodoQueryView> {
    const port=this.todoTransport;if(!this.ready||!port||!port.ready())throw new Error('TODO_BLOCKED');if(!port.foreground())throw new Error('TODO_NOT_FOREGROUND');
    if(this.sending||this.query.phase==='waiting')throw new Error('TODO_BUSY');
    const peer=this.normalizePeer(port.peer());if(!peer)throw new Error('TODO_WRONG_PEER');
    this.query=new WorkspaceTodoQueryView();this.query.query_id=newWorkspaceTodoDeleteId().replace('tdel-','tqry-');this.query.phase='waiting';this.query.peer=peer;
    this.query.started_at=new Date().toISOString();this.query.deadline_at=new Date(Date.now()+20000).toISOString();this.query.note='等待有序完整分批；查询未携带可回显请求ID，不作为删除确认';
    this.queryLease=port.lease();this.queryAccumulator=new TodoQueryAccumulator(true);const queryId=this.query.query_id;
    this.queryTimer=setTimeout(():void=>{if(this.query.query_id===queryId&&this.query.phase==='waiting')this.finishTodoQuery('incomplete','查询超时，不能判断缺失条目已删除');},20000);
    this.sending=true;this.changed();
    try{
      if(this.query.query_id!==queryId||this.query.phase!=='waiting'||this.todoTransport!==port||!port.ready()||!port.foreground()||port.lease()!==this.queryLease||this.normalizePeer(port.peer())!==peer){this.finishTodoQuery('disconnected','查询发送前连接条件已变化');return this.todoQueryStatus();}
      const body:QueryBody={queryType:0,eventType:1,lastSyncTime:0,eventIDList:[],needFullData:true};
      const packet=businessEnvelope(15,new util.TextEncoder().encodeInto(JSON.stringify(body)));
      try{await port.send(22,packet);}finally{packet.fill(0);}
      if(this.todoTransport!==port||!port.ready()||!port.foreground()||port.lease()!==this.queryLease)this.finishTodoQuery('disconnected','查询期间连接已变化');
    }catch(_){if(this.query.query_id===queryId&&this.query.phase==='waiting')this.finishTodoQuery('error','查询未完成，原待办和删除记录保留');}
    finally{this.sending=false;this.kickTodoDeletes();}
    return this.todoQueryStatus();
  }
  private observeTodoQuery(peer:string,bytes:Uint8Array):void {
    const port=this.todoTransport;if(this.query.phase!=='waiting'||!this.queryAccumulator||!port||!port.ready()||!port.foreground()||port.lease()!==this.queryLease||peer!==this.query.peer)return;
    if(Date.now()>=Date.parse(this.query.deadline_at)){this.finishTodoQuery('incomplete','查询回报已超时');return;}
    const batch=parseTodoQueryBatch(bytes);
    const observation=batch?this.queryAccumulator.add(batch):this.queryAccumulator.invalidate('invalid-batch');
    this.query.batches=observation.batches;this.query.received=observation.items;this.query.todo_total=observation.todo_total===null?-1:observation.todo_total;this.query.schedule_total=observation.schedule_total===null?-1:observation.schedule_total;
    if(observation.phase==='collecting'){this.changed();return;}
    this.finishTodoQuery(observation.phase,observation.phase==='complete'?'本轮分批观察完整；未见条目仍不代表删除确认':describeTodoQueryBatch(bytes));
    const stamp=this.query.completed_at,ids=observation.todo_ids.slice();
    this.mutate((data:WorkspaceData):void=>{for(const d of data.deletions){if(d.todo.peer!==peer||d.phase==='cancelled')continue;d.query_observation=observation.phase==='complete'?(ids.includes(d.todo.id)?'present':'absent'):'incomplete';d.query_at=stamp;d.revision++;}}).catch(():void=>{});
  }
  private finishTodoQuery(phase:string,note:string):void {
    if(this.queryTimer!==-1)clearTimeout(this.queryTimer);this.queryTimer=-1;
    this.query.phase=phase;this.query.note=note;this.query.completed_at=new Date().toISOString();this.changed();
  }
  private normalizePeer(peer:string):string {
    if(/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(peer))return peer.replace(/:/g,'').toLowerCase();
    return /^[0-9a-fA-F]{12}$/.test(peer)?peer.toLowerCase():'';
  }
  conversation(id:string,text:string,answer:string,model:string):Promise<void>{
    if(!id||!text||!answer)return Promise.resolve();
    return this.mutate(data=>{if(data.entries.some(e=>e.id===id))return;if(data.entries.length>=500)throw new Error('资料已达 500 条，请先导出整理');
      const row=new WorkspaceEntry();row.id=id;row.title=text.slice(0,50);row.text=text.slice(0,4000);row.answer=answer.slice(0,8000);row.model=model.slice(0,200);row.created=Date.now();data.entries.unshift(row);
    });
  }
  manuscript(title:string,text:string):Promise<void>{
    return this.saveManuscript('',0,title.trim().slice(0,100),text).then(():void=>{});
  }
  private manuscriptRow(entries:WorkspaceEntry[],id:string):WorkspaceEntry{
    const rows=entries.filter((e:WorkspaceEntry):boolean=>e.id===id);
    if(!id||rows.length!==1)throw new Error('稿件标识不存在或不唯一，请刷新后再试');
    if(rows[0].kind!=='manuscript')throw new Error('该条目不是稿件');
    return rows[0];
  }
  private copyManuscript(row:WorkspaceEntry):WorkspaceEntry{
    const copy=JSON.parse(JSON.stringify(row)) as WorkspaceEntry;
    if(copy.revision===undefined)copy.revision=1;if(copy.modified===undefined)copy.modified=copy.created;
    return copy;
  }
  manuscriptSnapshot(id:string):WorkspaceEntry{
    if(!this.ready)throw new Error('本机稿件尚未就绪');
    return this.copyManuscript(this.manuscriptRow(this.entries,id));
  }
  saveManuscript(id:string,expectedRevision:number,title:string,text:string):Promise<WorkspaceEntry>{
    title=title.trim()||'未命名稿件';
    if(title.length>100||!text.trim()||text.length>100000||text.includes('\u0000'))return Promise.reject(new Error('稿件标题限100字，正文须为非空文本且不超过10万字'));
    if(!Number.isSafeInteger(expectedRevision)||(id?expectedRevision<1:expectedRevision!==0))return Promise.reject(new Error('稿件修订不正确，请重新选择'));
    let saved:WorkspaceEntry=new WorkspaceEntry();
    return this.mutate((data:WorkspaceData):void=>{
      let row:WorkspaceEntry;
      if(id){
        row=this.manuscriptRow(data.entries,id);const revision=row.revision===undefined?1:row.revision;
        if(revision!==expectedRevision)throw new Error('稿件已变化，请重新选择；草稿仍保留');
        if(row.title===title&&row.text===text){saved=this.copyManuscript(row);return;}
        if(!Number.isSafeInteger(revision+1))throw new Error('稿件修订已达上限');
        row.revision=revision+1;row.modified=Math.max(row.modified===undefined?row.created:row.modified,Date.now());
      }else{
        if(data.entries.length>=500)throw new Error('资料已达上限');
        const value=this.id();row=new WorkspaceEntry();row.id=`manuscript-${value}`;
        if(!value||data.entries.some((e:WorkspaceEntry):boolean=>e.id===row.id))throw new Error('稿件标识生成冲突，请重试');
        row.kind='manuscript';row.created=Date.now();row.modified=row.created;data.entries.unshift(row);
      }
      row.title=title;row.text=text;saved=this.copyManuscript(row);
    }).then(():WorkspaceEntry=>saved);
  }
  deleteManuscript(id:string,expectedRevision:number):Promise<void>{
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)return Promise.reject(new Error('稿件修订不正确'));
    return this.mutate((data:WorkspaceData):void=>{
      const row=this.manuscriptRow(data.entries,id),revision=row.revision===undefined?1:row.revision;
      if(revision!==expectedRevision)throw new Error('稿件已变化，请重新选择后再删除');
      data.entries=data.entries.filter((e:WorkspaceEntry):boolean=>e.id!==id);
    });
  }
  markdown(entry:WorkspaceEntry):string{
    return `# ${entry.title}\n\n${new Date(entry.created).toISOString()}\n\n${entry.kind==='conversation'?`## 我\n\n${entry.text}\n\n## 回答 · ${entry.model}\n\n${entry.answer}`:entry.text}\n`;
  }
}
export const localWorkspace: LocalWorkspace = new LocalWorkspace();
