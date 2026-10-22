import { http } from '@kit.NetworkKit';
import { TaskMailbox, TaskPrincipal, TaskClaim, TaskPending } from './TaskMailbox';
import { TaskObject, TaskRequestBody, TaskInboxPage, TaskEnvelope, TaskCommandBody, TaskAnswerBody, taskObjectValid } from './TaskWire';
import { MaterialSyncTarget, MaterialServerIdentity, validateMaterialSyncTarget, materialSyncRetryAfter } from './MaterialSyncTransport';

// Task credentials are passed explicitly by the future task settings owner.
// This component never adopts the daily-material token or enables either flow.
export class TaskTarget { baseUrl:string='';token:string='';principal:TaskPrincipal=new TaskPrincipal(); }
export function validateTaskTarget(target:TaskTarget):string {
  const shared=new MaterialSyncTarget();shared.baseUrl=target.baseUrl;shared.token=target.token;
  shared.principal.ownerId=target.principal.ownerId;shared.principal.producerId=target.principal.producerId;shared.principal.serverId=target.principal.serverId;
  const base=validateMaterialSyncTarget(shared);
  if(base.split('/').some((part:string):boolean=>part==='.'||part==='..'))throw new Error('TASK_TARGET_INVALID');return base;
}
class TaskResponse { status:number=0;body:string='';retryAfterMs:number=0; }
class TaskApiError { code:string=''; }
class TaskApiErrorResponse { error:TaskApiError=new TaskApiError(); }
const readScopes:string[]=['tasks:read','requests:read','messages:receive'];
export class TaskTransport {
  note:string='paused';nextCheckAt:number=0;hasMore:boolean=false;
  beforeSend:(operation:string,event:TaskEnvelope)=>void=(_operation:string,event:TaskEnvelope):void=>{
    if(event.kind==='answer'&&(event.body as TaskAnswerBody).input_source==='voice')throw new Error('TASK_VOICE_SOURCE_UNVERIFIED');
  };
  lastIdentityStatus:number=0;
  private foreground:boolean=false;private busy:boolean=false;private generation:number=0;
  private request:http.HttpRequest|undefined=undefined;
  private queue:TaskMailbox|undefined=undefined;private claim:TaskClaim|undefined=undefined;
  setForeground(value:boolean):void {this.foreground=value;if(!value)this.cancel();}
  private base(target:TaskTarget,mailbox:TaskMailbox):string {
    const base=validateTaskTarget(target);
    if(!mailbox.matches(target.principal))throw new Error('TASK_IDENTITY_CHANGED');return base;
  }
  private async exchange(base:string,path:string,token:string,payload:string|undefined,generation:number):Promise<TaskResponse>{
    if(generation!==this.generation||!this.foreground)throw new Error('TASK_PAUSED');
    const request=http.createHttp();this.request=request;
    try{
      const options:http.HttpRequestOptions={method:payload===undefined?http.RequestMethod.GET:http.RequestMethod.POST,
        header:{'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json'},maxRedirects:0,usingCache:false,
        connectTimeout:5000,readTimeout:10000,expectDataType:http.HttpDataType.STRING,maxLimit:1048576};
      if(payload!==undefined)options.extraData=payload;
      const r=await request.request(base+path,options);
      if(generation!==this.generation||!this.foreground)throw new Error('TASK_PAUSED');
      const out=new TaskResponse();out.status=r.responseCode;
      const headers=r.header as Record<string,string>;
      const typeKey=Object.keys(headers).find((key:string):boolean=>key.toLowerCase()==='content-type');
      if(!typeKey||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers[typeKey])||typeof r.result!=='string'||r.result.length>1048576)throw new Error('TASK_RESPONSE_INVALID');
      out.body=r.result;out.retryAfterMs=materialSyncRetryAfter(headers,out.body,Date.now());return out;
    }finally{if(this.request===request)this.request=undefined;request.destroy();}
  }
  private code(response:TaskResponse):string {
    try{const e=JSON.parse(response.body) as TaskApiErrorResponse;
      if(/^[A-Z][A-Z0-9_]{0,63}$/.test(e.error?.code))return e.error.code;}catch{}
    return response.status===401?'AUTH_REQUIRED':response.status===403?'FORBIDDEN':'TASK_UNAVAILABLE';
  }
  private async identity(base:string,target:TaskTarget,generation:number):Promise<MaterialServerIdentity>{
    const response=await this.exchange(base,'/identity',target.token,undefined,generation);
    this.lastIdentityStatus=response.status;
    if(response.status!==200){this.note=this.code(response);this.nextCheckAt=Date.now()+Math.max(5000,response.retryAfterMs);throw new Error('TASK_IDENTITY_UNAVAILABLE');}
    const i=JSON.parse(response.body) as MaterialServerIdentity,p=target.principal;
    if(i.schema_version!=='1.0'||i.owner_id!==p.ownerId||i.producer_id!==p.producerId||i.server_id!==p.serverId||
      !Array.isArray(i.scopes)||!Number.isFinite(Date.parse(i.expires_at))||Date.parse(i.expires_at)<=Date.now()||readScopes.some((s:string):boolean=>!i.scopes.includes(s)))throw new Error('TASK_IDENTITY_MISMATCH');
    return i;
  }
  // Dedicated settings preview: only GET identity, never opens a mailbox or
  // sends a command. The caller still explicitly saves/enables the connection.
  async preflight(target:TaskTarget,expectedExpiresAt?:number):Promise<MaterialServerIdentity>{
    if(this.busy)throw new Error('TASK_PREFLIGHT_BUSY');
    if(!this.foreground)throw new Error('TASK_PREFLIGHT_CANCELLED');
    let snapshot:TaskTarget,base:string;
    try{snapshot=JSON.parse(JSON.stringify(target)) as TaskTarget;base=validateTaskTarget(snapshot);}
    catch{throw new Error('TASK_TARGET_INVALID');}
    if(expectedExpiresAt!==undefined&&(!Number.isSafeInteger(expectedExpiresAt)||expectedExpiresAt<=Date.now()))throw new Error('TASK_IMPORT_EXPIRED');
    this.busy=true;this.lastIdentityStatus=0;this.note='checking';const generation=this.generation;
    try{
      const identity=await this.identity(base,snapshot,generation);
      if(generation!==this.generation||!this.foreground)throw new Error('TASK_PREFLIGHT_CANCELLED');
      if(['tasks:write','tasks:update','answers:write'].some((scope:string):boolean=>!identity.scopes.includes(scope)))throw new Error('TASK_PHONE_SCOPE_REQUIRED');
      if(expectedExpiresAt!==undefined&&Date.parse(identity.expires_at)!==expectedExpiresAt)throw new Error('TASK_EXPIRY_MISMATCH');
      this.note='verified';return identity;
    }catch(error){
      if(generation!==this.generation||!this.foreground)throw new Error('TASK_PREFLIGHT_CANCELLED');
      const code=(error as Error)?.message;
      if(['TASK_IDENTITY_UNAVAILABLE','TASK_IDENTITY_MISMATCH','TASK_PHONE_SCOPE_REQUIRED','TASK_EXPIRY_MISMATCH'].includes(code))throw new Error(code);
      throw new Error('TASK_IDENTITY_UNAVAILABLE');
    }finally{this.busy=false;}
  }
  private begin(mailbox:TaskMailbox,target:TaskTarget):TaskTarget|undefined {
    if(this.busy||!this.foreground||Date.now()<this.nextCheckAt)return undefined;
    const snapshot=JSON.parse(JSON.stringify(target)) as TaskTarget;this.base(snapshot,mailbox);this.busy=true;this.note='checking';return snapshot;
  }
  private end():void {this.busy=false;this.queue=undefined;this.claim=undefined;}
  async pump(mailbox:TaskMailbox,target:TaskTarget):Promise<boolean>{
    const snapshot=this.begin(mailbox,target);if(!snapshot)return false;const gen=this.generation;
    let claim:TaskClaim|undefined=undefined;
    try{
      const base=this.base(snapshot,mailbox),identity=await this.identity(base,snapshot,gen);
      if(!mailbox.matches(snapshot.principal))throw new Error('TASK_IDENTITY_CHANGED');
      const draft=mailbox.firstDraft();
      if(draft){
        if(!identity.scopes.includes('answers:write')){mailbox.rejectDraft(draft.operation_id,'FORBIDDEN');this.note='FORBIDDEN';return false;}
        const event=JSON.parse(draft.payload) as TaskEnvelope,answer=event.body as TaskAnswerBody;
        try{
          const request=await this.detail(base,snapshot,'request',answer.request_id,gen);
          const task=await this.detail(base,snapshot,'task',answer.task_id,gen);
          if(!mailbox.matches(snapshot.principal))throw new Error('TASK_IDENTITY_CHANGED');
          mailbox.confirmDraft(draft.operation_id,request,task,Date.now());
        }catch(error){
          if(gen===this.generation&&mailbox.matches(snapshot.principal)&&['REQUEST_NOT_FOUND','TASK_NOT_FOUND','REQUEST_CLOSED','EXPIRED'].includes(this.note))
            mailbox.rejectDraft(draft.operation_id,this.note);
          else throw error as Error;
        }
      }
      claim=mailbox.claim(Date.now());if(!claim){this.note='idle';return false;}
      this.queue=mailbox;this.claim=claim;
      const event=JSON.parse(claim.payload) as TaskEnvelope;
      const scope=event.kind==='answer'?'answers:write':(event.body as TaskCommandBody).revision===1?'tasks:write':'tasks:update';
      if(claim.action==='send'&&!identity.scopes.includes(scope)){
        mailbox.finish(claim,403,'{"schema_version":"1.0","error":{"code":"FORBIDDEN","retryable":false}}',Date.now());this.note='FORBIDDEN';return false;}
      this.note=claim.action==='lookup'?'reconciling':'sending';
      const path=claim.action==='lookup'?'/events/'+encodeURIComponent(claim.eventId):event.kind==='answer'?'/answers':'/tasks';
      if(claim.action==='send'){
        try{this.beforeSend(claim.operationId,event);}
        catch{
          // No HTTP request has started. A failed local rejection must keep its
          // interrupted write, without fabricating a lost network response.
          const unsent=claim;this.claim=undefined;claim=undefined;
          try{mailbox.blockUnsent(unsent,'TASK_VOICE_SOURCE_UNVERIFIED',Date.now());this.note='TASK_VOICE_SOURCE_UNVERIFIED';}
          catch{this.note='TASK_PERSIST_FAILED';}return false;
        }
      }
      const response=await this.exchange(base,path,snapshot.token,claim.action==='send'?claim.payload:undefined,gen);
      if(!mailbox.matches(snapshot.principal))throw new Error('TASK_IDENTITY_CHANGED');
      mailbox.finish(claim,response.status,response.body,Date.now(),response.retryAfterMs);this.note='processed';return true;
    }catch(error){if(gen===this.generation){
      if(claim&&mailbox.matches(snapshot.principal)){try{mailbox.finish(claim,0,'',Date.now());this.note='TRANSPORT_UNKNOWN';}catch{this.note='TASK_PERSIST_FAILED';}}
      else if(this.note==='checking'){const code=(error as Error).message;this.note=/^TASK_[A-Z_]+$/.test(code)?code:'TASK_UNAVAILABLE';this.nextCheckAt=Date.now()+5000;}
    }return false;}finally{this.end();}
  }
  async poll(mailbox:TaskMailbox,target:TaskTarget):Promise<boolean>{
    const snapshot=this.begin(mailbox,target);if(!snapshot)return false;const gen=this.generation,cursor=mailbox.cursor();
    try{
      const base=this.base(snapshot,mailbox);await this.identity(base,snapshot,gen);
      const response=await this.exchange(base,'/inbox?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''),snapshot.token,undefined,gen);
      if(!mailbox.matches(snapshot.principal))throw new Error('TASK_IDENTITY_CHANGED');
      if(response.status!==200){this.note=this.code(response);this.nextCheckAt=Date.now()+Math.max(5000,response.retryAfterMs);
        if(this.note==='CURSOR_RESET_REQUIRED')mailbox.resetCursor(cursor);return false;}
      const page=JSON.parse(response.body) as TaskInboxPage;
      mailbox.acceptPage(page,cursor);this.hasMore=page.has_more;this.note='received';return true;
    }catch(error){if(gen===this.generation){const code=(error as Error).message;this.note=/^TASK_[A-Z_]+$/.test(code)?code:'TASK_UNAVAILABLE';this.nextCheckAt=Date.now()+5000;}return false;}
    finally{this.end();}
  }
  private async detail(base:string,target:TaskTarget,kind:string,id:string,gen:number):Promise<TaskObject>{
    if(!['task','request','message'].includes(kind)||typeof id!=='string'||!id||id.length>512||['.','..'].includes(id))throw new Error('TASK_QUERY_INVALID');
    const path=kind==='task'?'tasks':kind==='request'?'requests':'messages';
    const response=await this.exchange(base+'/'+path,'/'+encodeURIComponent(id),target.token,undefined,gen);
    if(response.status!==200){this.note=this.code(response);this.nextCheckAt=Date.now()+Math.max(5000,response.retryAfterMs);throw new Error('TASK_DETAIL_UNAVAILABLE');}
    const item=JSON.parse(response.body) as TaskObject;
    if(!taskObjectValid(item)||item.kind!==kind||item.object_id!==id)throw new Error('TASK_RESPONSE_INVALID');return item;
  }
  async refresh(mailbox:TaskMailbox,target:TaskTarget,kind:string,id:string):Promise<boolean>{
    const snapshot=this.begin(mailbox,target);if(!snapshot)return false;const gen=this.generation;
    try{const base=this.base(snapshot,mailbox);await this.identity(base,snapshot,gen);
      const item=await this.detail(base,snapshot,kind,id,gen);if(!mailbox.matches(snapshot.principal))throw new Error('TASK_IDENTITY_CHANGED');
      mailbox.acceptDetail(item,Date.now());this.note='refreshed';return true;
    }catch(error){if(gen===this.generation){const code=(error as Error).message;if(this.note==='checking')this.note=/^TASK_[A-Z_]+$/.test(code)?code:'TASK_UNAVAILABLE';}return false;}
    finally{this.end();}
  }
  async prepareAnswer(mailbox:TaskMailbox,target:TaskTarget,operation:string,id:string,revision:number,option:string|null,text:string):Promise<TaskPending|undefined>{
    const snapshot=this.begin(mailbox,target);if(!snapshot)return undefined;const gen=this.generation;
    try{const base=this.base(snapshot,mailbox),identity=await this.identity(base,snapshot,gen);
      if(!identity.scopes.includes('answers:write'))throw new Error('TASK_ANSWER_FORBIDDEN');
      const request=await this.detail(base,snapshot,'request',id,gen),body=request.body as TaskRequestBody;
      const task=await this.detail(base,snapshot,'task',body.task_id,gen),now=Date.now();
      if(!mailbox.matches(snapshot.principal))throw new Error('TASK_IDENTITY_CHANGED');
      mailbox.acceptDetail(request,now);mailbox.acceptDetail(task,now);
      const row=mailbox.answer(operation,id,revision,option,text,now);this.note='answer_queued';return row;
    }catch(error){if(gen===this.generation){const code=(error as Error).message;if(this.note==='checking')this.note=/^TASK_[A-Z_]+$/.test(code)?code:'TASK_UNAVAILABLE';}return undefined;}
    finally{this.end();}
  }
  async prepareCancel(mailbox:TaskMailbox,target:TaskTarget,operation:string,id:string,revision:number):Promise<TaskPending|undefined>{
    const snapshot=this.begin(mailbox,target);if(!snapshot)return undefined;const gen=this.generation;
    try{const base=this.base(snapshot,mailbox),identity=await this.identity(base,snapshot,gen);
      if(!identity.scopes.includes('tasks:update'))throw new Error('TASK_CANCEL_FORBIDDEN');
      const task=await this.detail(base,snapshot,'task',id,gen),now=Date.now();
      if(!mailbox.matches(snapshot.principal))throw new Error('TASK_IDENTITY_CHANGED');
      mailbox.acceptDetail(task,now);const row=mailbox.requestCancel(operation,id,revision,now);this.note='cancel_queued';return row;
    }catch(error){if(gen===this.generation){const code=(error as Error).message;if(this.note==='checking')this.note=/^TASK_[A-Z_]+$/.test(code)?code:'TASK_UNAVAILABLE';}return undefined;}
    finally{this.end();}
  }
  cancel():void {
    this.generation++;this.note='paused';
    if(this.queue&&this.claim)try{this.queue.finish(this.claim,0,'',Date.now());}catch{this.note='TASK_PERSIST_FAILED';}
    this.request?.destroy();this.request=undefined;
  }
}
