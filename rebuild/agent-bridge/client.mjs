import fs from 'node:fs';
// P41 connection program: outbound-only client for the material/queue service.
// Same transport rules as the query tool: file-only bearer, HTTPS (loopback http
// only when explicitly allowed), no redirects, bounded bodies, one request per call.
// The duplicate of readPrivateJson/URL rules is deliberate: this component is
// deployed on the user's computer and must not import server internals.
export class BridgeError extends Error{
  constructor(code,{status=null,retryable=false,permanent=false,detail=null}={}){
    super(code);this.code=code;this.status=status;this.retryable=retryable;this.permanent=permanent;this.detail=detail;
  }
  toJSON(){return {code:this.code,status:this.status,retryable:this.retryable,permanent:this.permanent,detail:this.detail};}
}
const fail=(code,details)=>{throw new BridgeError(code,details);};
export function readPrivateJson(filename,maxBytes=16384){
  let fd;
  try{
    fd=fs.openSync(filename,'r');if(!fs.fstatSync(fd).isFile())fail('INVALID_PRIVATE_FILE');
    const bytes=Buffer.alloc(maxBytes+1),length=fs.readSync(fd,bytes,0,bytes.length,0);
    if(length>maxBytes)fail('INVALID_PRIVATE_FILE');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)));
  }catch(e){if(e instanceof BridgeError)throw e;fail('INVALID_PRIVATE_FILE');}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
const WRITE_PATHS={task:'tasks',request:'requests',answer:'answers',message:'messages',receipt:'receipts'};
const READ_PATHS={task:'tasks',request:'requests',message:'messages'};
const MAX_RESPONSE=1048576;
const integer=v=>Number.isSafeInteger(v)&&v>0;
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const safeCode=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(v)?v:null;
export class BridgeClient{
  #boundToken=null;
  constructor(config,{clock=Date.now,fetchImpl=globalThis.fetch}={}){
    if(!config||typeof config!=='object'||Array.isArray(config)||config.schema_version!=='1.0')fail('INVALID_CONFIG');
    let base;try{base=new URL(config.base_url);}catch{fail('INVALID_CONFIG');}
    if(base.username||base.password||base.search||base.hash||!base.pathname.endsWith('/v1/'))fail('INVALID_CONFIG');
    const loopback=['127.0.0.1','[::1]'].includes(base.hostname);
    if(base.protocol!=='https:'&&!(base.protocol==='http:'&&loopback&&config.allow_loopback_http===true))fail('HTTPS_REQUIRED');
    for(const key of ['owner_id','producer_id','server_id'])if(typeof config[key]!=='string'||!config[key])fail('INVALID_CONFIG');
    if(typeof config.credential_file!=='string'||!config.credential_file)fail('INVALID_CONFIG');
    const timeout=config.timeout_ms??10000;
    if(!Number.isSafeInteger(timeout)||timeout<100||timeout>30000)fail('INVALID_CONFIG');
    if(typeof fetchImpl!=='function')fail('INVALID_CONFIG');
    this.config=Object.freeze({...config,timeout_ms:timeout});this.base=base;this.clock=clock;this.fetch=fetchImpl;
  }
  token(){
    const credential=readPrivateJson(this.config.credential_file,4096);
    if(!credential||typeof credential.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(credential.token)||
      !Number.isFinite(Date.parse(credential.expires_at))||Date.parse(credential.expires_at)<=this.clock())fail('CREDENTIAL_EXPIRED_OR_INVALID',{permanent:true});
    return credential.token;
  }
  async #send(method,path,payload,tokenSnapshot=null){
    const token=tokenSnapshot??this.token(),url=new URL(path,this.base);
    if(url.origin!==this.base.origin||!url.pathname.startsWith(this.base.pathname)||url.href.length>8192)fail('INVALID_QUERY',{permanent:true});
    if(path!=='identity'&&token!==this.#boundToken){
      const {body:identity}=await this.#send('GET','identity',undefined,token);
      if(identity?.schema_version!=='1.0'||['owner_id','producer_id','server_id'].some(k=>identity[k]!==this.config[k]))
        fail('IDENTITY_MISMATCH',{permanent:true});
      this.#boundToken=token;
    }
    let response;
    try{
      response=await this.fetch(url,{method,redirect:'manual',signal:AbortSignal.timeout(this.config.timeout_ms),
        headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(payload===undefined?{}:{'Content-Type':'application/json'})},
        ...(payload===undefined?{}:{body:payload})});
    }catch{fail('NETWORK_UNAVAILABLE',{retryable:true});}
    if(response.status>=300&&response.status<400)fail('REDIRECT_REFUSED',{status:response.status,permanent:true});
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')){
      await response.body?.cancel();fail('INVALID_RESPONSE',{permanent:true});
    }
    let text;
    try{
      const reader=response.body?.getReader();if(!reader)fail('INVALID_RESPONSE',{permanent:true});
      const chunks=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
        if(size>MAX_RESPONSE){await reader.cancel();fail('RESPONSE_TOO_LARGE',{permanent:true});}chunks.push(value);}}
      finally{reader.releaseLock();}
      text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
    }catch(e){if(e instanceof BridgeError)throw e;fail('NETWORK_UNAVAILABLE',{retryable:true});}
    let value;try{value=JSON.parse(text);}catch{fail('INVALID_RESPONSE',{permanent:true});}
    if(response.status>=200&&response.status<300)return {status:response.status,body:value,headers:response.headers};
    const error=value?.error,code=safeCode(error?.code),retryAfter=Number(error?.retry_after_ms);
    if(response.status===401)fail('AUTH_REQUIRED',{status:401,permanent:true});
    if(response.status===403)fail(code??'FORBIDDEN',{status:403,permanent:true});
    if(response.status===429)fail('RATE_LIMITED',{status:429,retryable:true,detail:Number.isSafeInteger(retryAfter)?retryAfter:null});
    if(response.status>=500)fail(code??'UNAVAILABLE',{status:response.status,retryable:true,detail:Number.isSafeInteger(retryAfter)?retryAfter:null});
    fail(code??'HTTP_ERROR',{status:response.status,permanent:true});
  }
  async identity(){return (await this.#send('GET','identity')).body;}
  async inbox(cursor=null,limit=20){
    const query=new URLSearchParams({limit:String(limit)});
    if(cursor)query.set('cursor',cursor);
    const page=(await this.#send('GET',`inbox?${query}`)).body;
    if(!page||!Array.isArray(page.items)||page.items.length>limit||typeof page.has_more!=='boolean'||
      typeof page.next_cursor!=='string'||!page.next_cursor||page.next_cursor.length>4096||
      !stamp(page.server_time)||!stamp(page.fresh_until)||(page.has_more&&page.items.length===0))fail('INVALID_RESPONSE',{permanent:true});
    for(const item of page.items)this.#object(item,item?.kind);
    if(page.items.some((item,i)=>i>0&&item.commit_seq<=page.items[i-1].commit_seq))fail('INVALID_RESPONSE',{permanent:true});
    return page;
  }
  #object(item,kind,id=null){
    if(!['task','request','message','answer'].includes(kind)||item?.kind!==kind||item.schema_version!=='1.0'||
      typeof item.object_id!=='string'||!item.object_id||id!==null&&item.object_id!==id||!integer(item.revision)||!integer(item.commit_seq)||
      !stamp(item.stored_at)||typeof item.event_id!=='string'||!item.event_id||!item.body||item.body[`${kind}_id`]!==item.object_id||
      (kind!=='answer'&&item.body.revision!==item.revision)||!item.body.route||
      ['computer_id','agent_id','project_id','session_id'].some(k=>typeof item.body.route[k]!=='string'||!item.body.route[k]))fail('INVALID_RESPONSE',{permanent:true});
    if(kind==='request'&&item.answer)this.#object(item.answer,'answer');
    return item;
  }
  async object(kind,id){
    if(!READ_PATHS[kind]||typeof id!=='string'||!id||['.','..'].includes(id))fail('INVALID_QUERY',{permanent:true});
    return this.#object((await this.#send('GET',`${READ_PATHS[kind]}/${encodeURIComponent(id)}`)).body,kind,id);
  }
  async reconcileRequest(id,revision){
    if(typeof id!=='string'||!id||['.','..'].includes(id)||!integer(revision))fail('INVALID_QUERY',{permanent:true});
    const value=(await this.#send('POST',`requests/${encodeURIComponent(id)}/reconcile`,JSON.stringify({schema_version:'1.0',request_revision:revision}))).body;
    if(value?.schema_version!=='1.0'||typeof value.changed!=='boolean'||!stamp(value.server_time)||
      ![null,'deadline','task_closed'].includes(value.reason))fail('INVALID_RESPONSE',{permanent:true});
    const item=this.#object(value.item,'request',id);
    if(item.revision!==revision||!stamp(item.expires_at)||!['pending','presented','answered','expired','withdrawn'].includes(item.state)||
      (item.state==='answered')!==!!item.answer||
      value.changed&&!['expired','withdrawn'].includes(item.state)||
      value.changed&&value.reason===null||!value.changed&&value.reason!==null||
      value.reason==='deadline'&&(item.state!=='expired'||Date.parse(item.expires_at)>Date.parse(value.server_time))||
      value.reason==='task_closed'&&item.state!=='withdrawn')fail('INVALID_RESPONSE',{permanent:true});
    if(value.changed&&(!Array.isArray(item.receipts)||!item.receipts.some(r=>r.subject_kind==='request'&&r.subject_id===id&&
      r.subject_revision===revision&&r.actor_id==='server-lifecycle'&&r.related_event_id===item.event_id&&r.error===null&&
      r.stage===(item.state==='expired'?'expired':'cancelled'))))fail('INVALID_RESPONSE',{permanent:true});
    return item;
  }
  #ack(value,event){
    const kind=event?.kind,id=event?event.body[`${kind}_id`]:value?.object_id;
    const revision=event?(kind==='answer'||kind==='receipt'?1:event.body.revision):value?.revision;
    const r=value?.receipt;
    if(!value||value.schema_version!=='1.0'||typeof value.event_id!=='string'||!value.event_id||event&&value.event_id!==event.event_id||
      !['task','request','answer','message','receipt'].includes(value.kind)||event&&value.kind!==kind||value.object_id!==id||
      !integer(value.revision)||value.revision!==revision||!integer(value.commit_seq)||!stamp(value.stored_at)||
      !r||typeof r.receipt_id!=='string'||!r.receipt_id||r.subject_kind!==value.kind||r.subject_id!==value.object_id||
      r.subject_revision!==value.revision||r.related_event_id!==value.event_id||r.stage!=='server_stored'||r.error!==null)fail('INVALID_RESPONSE',{permanent:true});
    return value;
  }
  async event(eventId,expected=null){
    const value=(await this.#send('GET',`events/${encodeURIComponent(eventId)}`)).body;
    if(value?.event_id!==eventId)fail('INVALID_RESPONSE',{permanent:true});return this.#ack(value,expected);
  }
  async post(kind,event){
    if(!WRITE_PATHS[kind]||event?.kind!==kind)fail('INVALID_QUERY',{permanent:true});
    return this.#ack((await this.#send('POST',WRITE_PATHS[kind],JSON.stringify(event))).body,event);
  }
}
