import fs from 'node:fs';
import {renewSession,atomic} from './session-pairing.mjs';
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
    const credential=readPrivateJson(this.config.credential_file,8192);
    if(!credential||typeof credential.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(credential.token)||
      !Number.isFinite(Date.parse(credential.expires_at))||Date.parse(credential.expires_at)<=this.clock())fail('CREDENTIAL_EXPIRED_OR_INVALID',{permanent:true});
    return credential.token;
  }
  // Paired device credentials (devices.mjs, 2026-10-24) renew in the background once past
  // refresh_after: the file is replaced atomically, and a 409 means another process sharing the
  // same file renewed first, so the file is read again. Renewal failure keeps a still-valid token.
  async #renewed(){
    const file=this.config.credential_file,credential=readPrivateJson(file,8192);
    if(credential.session_pairing){
      if(Date.parse(credential.refresh_after)>this.clock()&&Date.parse(credential.expires_at)>this.clock())return this.token();
      try{const renewed=await renewSession(credential,this.fetch);atomic(file,renewed);return renewed.token;}
      catch(e){if(Date.parse(credential.expires_at)>this.clock())return this.token();fail(e.code??'PAIRING_RENEW_FAILED',{retryable:true});}
    }
    const token=this.token();
    if(typeof credential.device_id!=='string'||!stamp(credential.refresh_after)||Date.parse(credential.refresh_after)>this.clock())return token;
    try{
      const {body}=await this.#send('POST','credentials/refresh','{}',token);
      if(body?.device_id!==credential.device_id||body.producer_id!==this.config.producer_id||!/^[A-Za-z0-9_-]{43}$/.test(body.token??''))fail('INVALID_RESPONSE',{permanent:true});
      const temporary=file+'.'+process.pid+'.renew';
      fs.writeFileSync(temporary,JSON.stringify({...credential,...body})+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temporary,file);
      return body.token;
    }catch(e){if(e?.status===409)return this.token();if(Date.parse(credential.expires_at)>this.clock())return token;throw e;}
  }
  async #send(method,path,payload,tokenSnapshot=null,signal=null){
    const token=tokenSnapshot??await this.#renewed(),url=new URL(path,this.base);
    if(url.origin!==this.base.origin||!url.pathname.startsWith(this.base.pathname)||url.href.length>8192)fail('INVALID_QUERY',{permanent:true});
    if(path!=='identity'&&path!=='credentials/refresh'&&token!==this.#boundToken){
      const {body:identity}=await this.#send('GET','identity',undefined,token);
      if(identity?.schema_version!=='1.0'||['owner_id','producer_id','server_id'].some(k=>identity[k]!==this.config[k]))
        fail('IDENTITY_MISMATCH',{permanent:true});
      this.#boundToken=token;
    }
    let response;
    try{
      const timeout=AbortSignal.timeout(this.config.timeout_ms);
      response=await this.fetch(url,{method,redirect:'manual',signal:signal?AbortSignal.any([timeout,signal]):timeout,
        headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(payload===undefined?{}:{'Content-Type':'application/json'})},
        ...(payload===undefined?{}:{body:payload})});
    }catch{fail('NETWORK_UNAVAILABLE',{retryable:true});}
    if(response.status>=300&&response.status<400)fail('REDIRECT_REFUSED',{status:response.status,permanent:true});
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')){
      await response.body?.cancel();
      if(response.status>=500||response.status===429)fail(response.status===429?'RATE_LIMITED':'UNAVAILABLE',{status:response.status,retryable:true});
      fail('INVALID_RESPONSE',{status:response.status,permanent:true});
    }
    let text;
    try{
      const reader=response.body?.getReader();if(!reader)fail('INVALID_RESPONSE',{permanent:true});
      const chunks=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
        if(size>(path==='lifelog-text/history'?32*MAX_RESPONSE:path.startsWith('lifelog-text')?8*MAX_RESPONSE:MAX_RESPONSE)){await reader.cancel();fail('RESPONSE_TOO_LARGE',{permanent:true});}chunks.push(value);}}
      finally{reader.releaseLock();}
      text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
    }catch(e){if(e instanceof BridgeError)throw e;fail('NETWORK_UNAVAILABLE',{retryable:true});}
    let value;try{value=JSON.parse(text);}catch{
      if(response.status>=500||response.status===429)fail(response.status===429?'RATE_LIMITED':'UNAVAILABLE',{status:response.status,retryable:true});
      fail('INVALID_RESPONSE',{status:response.status,permanent:true});
    }
    if(response.status>=200&&response.status<300)return {status:response.status,body:value,headers:response.headers};
    const error=value?.error,code=safeCode(error?.code),retryAfter=Number(error?.retry_after_ms);
    if(response.status===401)fail('AUTH_REQUIRED',{status:401,permanent:true});
    if(response.status===403)fail(code??'FORBIDDEN',{status:403,permanent:true});
    if(response.status===429)fail('RATE_LIMITED',{status:429,retryable:true,detail:Number.isSafeInteger(retryAfter)?retryAfter:null});
    if(response.status>=500)fail(code??'UNAVAILABLE',{status:response.status,retryable:true,detail:Number.isSafeInteger(retryAfter)?retryAfter:null});
    fail(code??'HTTP_ERROR',{status:response.status,permanent:true});
  }
  async identity(){return (await this.#send('GET','identity')).body;}
  async watchInbox(version=null,{signal,waitSeconds=10}={}){
    if(version!==null&&!/^[a-f0-9]{64}$/.test(version)||!Number.isInteger(waitSeconds)||waitSeconds<1||waitSeconds>25)fail('INVALID_QUERY',{permanent:true});
    const query=new URLSearchParams({wait_seconds:String(waitSeconds)});if(version)query.set('version',version);
    const {body}=await this.#send('GET','inbox/watch?'+query,undefined,null,signal);
    if(body?.schema_version!=='1.0'||['owner_id','producer_id','server_id'].some(k=>body[k]!==this.config[k])||!stamp(body.server_time)||!/^[a-f0-9]{64}$/.test(body.version??'')||typeof body.changed!=='boolean')fail('INVALID_RESPONSE',{permanent:true});
    return body;
  }
  /** Read the account's synced daily AI summaries. This boundary owns CLI query validation;
   * it cannot select another owner, fetch transcripts/audio, or write materials. */
  async dailySummaries(input={}){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['date','from','to','keyword','limit','cursor'].includes(k))||input.date!==undefined&&(input.from!==undefined||input.to!==undefined))fail('INVALID_QUERY',{permanent:true});
    const filters={...input};if(filters.date!==undefined){filters.from=filters.to=filters.date;delete filters.date;}
    for(const day of [filters.from,filters.to].filter(v=>v!==undefined))if(typeof day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)fail('INVALID_QUERY',{permanent:true});
    if(filters.from&&filters.to&&filters.to<filters.from||filters.limit!==undefined&&(!Number.isInteger(filters.limit)||filters.limit<1||filters.limit>50)||filters.keyword!==undefined&&(typeof filters.keyword!=='string'||!filters.keyword||filters.keyword.length>512)||filters.cursor!==undefined&&(typeof filters.cursor!=='string'||!filters.cursor||filters.cursor.length>4096))fail('INVALID_QUERY',{permanent:true});
    const query=new URLSearchParams(Object.entries(filters).map(([k,v])=>[k,String(v)])),page=(await this.#send('GET','daily-summaries?'+query)).body;
    if(!page||!Array.isArray(page.items)||page.items.length>(filters.limit??20)||typeof page.has_more!=='boolean'||typeof page.next_cursor!=='string'||!page.next_cursor||page.next_cursor.length>4096||!stamp(page.server_time)||!stamp(page.fresh_until)||page.coverage?.scope!=='server_stored_daily_ai_summaries'||page.coverage.phone_sync_status!=='unknown'||page.has_more&&page.items.length===0)fail('INVALID_RESPONSE',{permanent:true});
    for(const item of page.items)if(!item||typeof item.material_id!=='string'||!item.material_id.startsWith('daily-')||!integer(item.revision)||typeof item.date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(item.date)||typeof item.text!=='string'||!item.text.startsWith('# '+item.date+' 每日 AI 总结')||!stamp(item.started_at)||!stamp(item.ended_at)||!stamp(item.stored_at)||item.source_ref?.server_id!==this.config.server_id||item.source_ref.material_id!==item.material_id||item.source_ref.revision!==item.revision||item.content_role!=='source_data')fail('INVALID_RESPONSE',{permanent:true});
    return {operation:'daily',service:{server_id:this.config.server_id,owner_id:this.config.owner_id},retrieved_at:new Date(this.clock()).toISOString(),filters,...page};
  }
  /** CLI daily returns complete selected days; pagination is transport-only unless explicitly requested. */
  async daily(input={}){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['date','from','to','keyword','kind','limit','cursor'].includes(k))||input.date!==undefined&&(input.from!==undefined||input.to!==undefined))fail('INVALID_QUERY');
    const filters={...input};if(filters.date!==undefined){filters.from=filters.to=filters.date;delete filters.date;}
    for(const day of [filters.from,filters.to].filter(v=>v!==undefined))if(typeof day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)fail('INVALID_QUERY');
    if(filters.from&&filters.to&&filters.to<filters.from||filters.limit!==undefined&&(!Number.isInteger(filters.limit)||filters.limit<1||filters.limit>100)||filters.keyword!==undefined&&(typeof filters.keyword!=='string'||!filters.keyword||filters.keyword.length>512)||filters.kind!==undefined&&!['summary','segment','transcript'].includes(filters.kind)||filters.cursor!==undefined&&(typeof filters.cursor!=='string'||!filters.cursor||filters.cursor.length>4096))fail('INVALID_QUERY');
    const completeDays=(!!filters.from||!!filters.to)&&filters.limit===undefined&&filters.cursor===undefined,items=[];let cursor=filters.cursor,page,bytes=0;
    do{
      const query=new URLSearchParams(Object.entries({...filters,...(cursor?{cursor}:{})}).map(([k,v])=>[k,String(v)]));
      page=(await this.#send('GET','lifelog-text?'+query)).body;
      if(!page||!Array.isArray(page.items)||typeof page.has_more!=='boolean'||page.has_more&&(!page.items.length||typeof page.next_cursor!=='string'||page.next_cursor===cursor)||page.coverage?.scope!=='server_stored_lifelog_text')fail('INVALID_RESPONSE');
      for(const item of page.items)if(typeof item.material_id!=='string'||!integer(item.revision)||!Number.isSafeInteger(item.correction_revision)||typeof item.text!=='string'||!Array.isArray(item.blocks)||!Array.isArray(item.notes)||item.content_role!=='source_data'||item.source_ref?.server_id!==this.config.server_id)fail('INVALID_RESPONSE');
      bytes+=Buffer.byteLength(JSON.stringify(page.items));if(bytes>32*1048576)fail('DAILY_RESULT_TOO_LARGE',{detail:'Use a smaller date range or explicit limit/cursor; no partial result was returned.'});
      items.push(...page.items);cursor=page.next_cursor;
    }while(completeDays&&page.has_more);
    return {operation:'daily',service:{server_id:this.config.server_id,owner_id:this.config.owner_id},retrieved_at:new Date(this.clock()).toISOString(),filters,...page,items,complete:!page.has_more};
  }
  async dailyContext(input={}){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['date','from','to','include_points','limit','cursor'].includes(k)))fail('INVALID_QUERY');
    const query=new URLSearchParams(Object.entries(input).map(([k,v])=>[k,String(v)]));return (await this.#send('GET','daily-context?'+query)).body;
  }
  async dailyEdit(action,input){
    if(!['daily-correct','daily-note','daily-revert','daily-history'].includes(action)||!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_QUERY');
    if(action==='daily-history')return (await this.#send('POST','lifelog-text/history',JSON.stringify(input))).body;
    if(action==='daily-correct'&&!Array.isArray(input.edits)||action==='daily-note'&&typeof input.note!=='string'||action==='daily-revert'&&!integer(input.revert_revision))fail('INVALID_CORRECTION');
    const payload=JSON.stringify(input);if(Buffer.byteLength(payload)>1048576)fail('CORRECTION_TOO_LARGE');
    return (await this.#send('POST','lifelog-text/correct',payload)).body;
  }
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
  /** Paired devices (computer credentials only): one-time phone code, list, unpair. */
  async createPairing(label){return (await this.#send('POST','pairings',JSON.stringify({role:'phone',label}))).body;}
  async devices(){return (await this.#send('GET','devices')).body;}
  /** Native session metadata only; these endpoints never send model input. */
  async agentSessions(){return (await this.#send('GET','agent-sessions')).body;}
  async todoSuggestion(action,input){
    if(!['todo-add','todo-status'].includes(action))fail('INVALID_QUERY',{permanent:true});
    const status=action==='todo-status';
    if(status&&(!input||Object.keys(input).join()!=='proposal_id'||typeof input.proposal_id!=='string'||!/^todo-[a-f0-9]{64}$/.test(input.proposal_id)))fail('INVALID_QUERY',{permanent:true});
    const result=(await this.#send(status?'GET':'POST','todo-suggestions'+(status?'/'+input.proposal_id:''),status?undefined:JSON.stringify(input))).body;
    if(result?.schema_version!=='1.0'||!/^todo-[a-f0-9]{64}$/.test(result.proposal_id??'')||
      !['pending_confirmation','shown','accepted','creating','created','declined','expired','failed','unknown'].includes(result.state)||
      typeof result.native_created!=='boolean'||result.glasses_display_confirmed!==false)fail('INVALID_RESPONSE',{permanent:true});
    return result;
  }
  async publishAgentSession(input){return (await this.#send('POST','agent-sessions',JSON.stringify(input))).body;}
  async setAgentDefault(input){return (await this.#send('PUT','agent-default',JSON.stringify(input))).body;}
  async unpair(deviceId){
    if(typeof deviceId!=='string'||!/^[0-9a-f-]{36}$/.test(deviceId))fail('INVALID_QUERY',{permanent:true});
    return (await this.#send('DELETE',`devices/${deviceId}`)).body;
  }
  /** Check-in watch of one task: GET reads it, PUT {enabled,next_checkin_at,note} replaces it (server watchdog). */
  async watch(taskId,input){
    if(typeof taskId!=='string'||!taskId||['.','..'].includes(taskId))fail('INVALID_QUERY',{permanent:true});
    const value=(await this.#send(input===undefined?'GET':'PUT',`watches/${encodeURIComponent(taskId)}`,input===undefined?undefined:JSON.stringify(input))).body;
    if(value?.task_id!==taskId||typeof value.enabled!=='boolean')fail('INVALID_RESPONSE',{permanent:true});return value;
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
