import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { MaterialOutbox, MaterialOutboxClaim, MaterialSyncPrincipal } from './MaterialOutbox';

export class MaterialSyncTarget {
  baseUrl:string='';token:string='';principal:MaterialSyncPrincipal=new MaterialSyncPrincipal();
}
export class MaterialServerIdentity {
  schema_version:string='';server_id:string='';owner_id:string='';producer_id:string='';scopes:string[]=[];expires_at:string='';
  material_schema_versions:string[]|undefined=undefined;
}
export function validateMaterialSyncTarget(target:MaterialSyncTarget):string{
  const base=target.baseUrl.replace(/\/+$/,'');
  if(base.length>2048||!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:\/[A-Za-z0-9_.-]+)*\/v1$/.test(base)||
    base.split('/').slice(3).some((segment:string):boolean=>segment==='.'||segment==='..')||
    !/^[A-Za-z0-9_-]{43}$/.test(target.token)||
    [target.principal.ownerId,target.principal.producerId,target.principal.serverId].some((v:string):boolean=>typeof v!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(v)))
    throw new Error('SYNC_TARGET_INVALID');
  return base;
}
class SyncResponse { status:number=0;body:string='';retryAfterMs:number=0; }
class SyncErrorBody { retry_after_ms:number=0; }
class SyncErrorEnvelope { error:SyncErrorBody=new SyncErrorBody(); }
interface SyncPlatformError { code?:number; }

export function materialSyncRetryAfter(headers:Record<string,string>,body:string,now:number):number{
  let delay=0;
  for(const key of Object.keys(headers))if(key.toLowerCase()==='retry-after'){
    const value=headers[key];if(typeof value!=='string'||value.length>128)continue;
    const ms=/^[0-9]+$/.test(value)?Number(value)*1000:Date.parse(value)-now;
    if(Number.isSafeInteger(ms)&&ms>delay)delay=ms;
  }
  try{const envelope=JSON.parse(body) as SyncErrorEnvelope;const value=envelope.error?.retry_after_ms;
    if(Number.isSafeInteger(value)&&value>delay)delay=value;}catch{}
  return delay;
}

// Explicit one-step pump; no automatic upload, credential persistence or
// background lease. The lifecycle coordinator decides when to call it.
export class MaterialSyncTransport {
  note:string='idle';nextCheckAt:number=0;
  // Diagnostics without private detail: only a status code and a bounded error
  // code. The URL, token and response body never enter these fields.
  lastIdentityStatus:number=0;lastErrorCode:string='';
  private busy:boolean=false;private generation:number=0;private request:http.HttpRequest|undefined=undefined;
  private activeQueue:MaterialOutbox|undefined=undefined;private activeClaim:MaterialOutboxClaim|undefined=undefined;
  private validate(target:MaterialSyncTarget,queue:MaterialOutbox):string{
    const base=validateMaterialSyncTarget(target);
    if(!queue.matches(target.principal))throw new Error('SYNC_TARGET_INVALID');
    return base;
  }
  // Settings/diagnostics can validate a proposed target without starting HTTP.
  validateTarget(target:MaterialSyncTarget,queue:MaterialOutbox):void{this.validate(target,queue);}
  private async exchange(url:string,token:string,payload:string|undefined):Promise<SyncResponse>{
    const request=http.createHttp();this.request=request;
    try{
      const options:http.HttpRequestOptions={method:payload===undefined?http.RequestMethod.GET:http.RequestMethod.POST,
        header:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},maxRedirects:0,usingCache:false,
        connectTimeout:5000,readTimeout:10000,expectDataType:http.HttpDataType.STRING,maxLimit:16384};
      if(payload!==undefined)options.extraData=payload;
      const response=await request.request(url,options),out=new SyncResponse();out.status=response.responseCode;
      out.body=typeof response.result==='string'?response.result:'';
      // Enforce the same limit even if the HTTP implementation/mock does not
      // honor maxLimit; bound characters before allocating encoded bytes.
      if(out.body.length>16384||new util.TextEncoder().encodeInto(out.body).length>16384)throw new Error('SYNC_RESPONSE_TOO_LARGE');
      out.retryAfterMs=materialSyncRetryAfter(response.header as Record<string,string>,out.body,Date.now());return out;
    }catch(caught){
      // Never inspect a platform message: it can embed a URL, response body or
      // bearer (including digits that resemble an error code).
      const code=(caught as SyncPlatformError)?.code;
      this.lastErrorCode=typeof code==='number'&&Number.isSafeInteger(code)&&code>=100&&code<=99999999?('E'+code):'TRANSPORT_FAILED';
      throw new Error('SYNC_TRANSPORT_UNKNOWN');
    }
    finally{if(this.request===request)this.request=undefined;try{request.destroy();}catch{}}
  }
  private authenticatedIdentity(body:string,target:MaterialSyncTarget):MaterialServerIdentity|undefined{
    try{const identity=JSON.parse(body) as MaterialServerIdentity,p=target.principal;
      if(identity.schema_version!=='1.0'||identity.server_id!==p.serverId||identity.owner_id!==p.ownerId||identity.producer_id!==p.producerId||
        !Array.isArray(identity.scopes)||identity.scopes.length>32||identity.scopes.some((scope:string):boolean=>typeof scope!=='string'||!/^[a-z][a-z0-9_.:-]{0,63}$/.test(scope))||
        !identity.scopes.includes('materials:write')||typeof identity.expires_at!=='string'||identity.expires_at.length>64||
        !Number.isFinite(Date.parse(identity.expires_at))||Date.parse(identity.expires_at)<=Date.now())return undefined;
      const versions=identity.material_schema_versions;
      if(versions!==undefined&&(!Array.isArray(versions)||versions.length>16||versions.some((v:string):boolean=>typeof v!=='string'||v.length>16||!/^\d+\.\d+$/.test(v))))return undefined;
      const checked=new MaterialServerIdentity();checked.schema_version=identity.schema_version;
      checked.server_id=identity.server_id;checked.owner_id=identity.owner_id;checked.producer_id=identity.producer_id;
      checked.scopes=identity.scopes.slice();checked.expires_at=identity.expires_at;
      checked.material_schema_versions=versions===undefined?undefined:versions.slice();return checked;
    }catch{return undefined;}
  }
  // A settings preview must never discover, claim or write an outbox. Use a
  // dedicated instance for the preview; the shared operation fence also makes
  // accidental concurrent pump/preflight calls safe on the same instance.
  async preflight(target:MaterialSyncTarget,expectedExpiresAt?:string,requiredSchema?:string):Promise<MaterialServerIdentity>{
    let snapshot:MaterialSyncTarget,base:string;
    try{snapshot=JSON.parse(JSON.stringify(target)) as MaterialSyncTarget;base=validateMaterialSyncTarget(snapshot);}
    catch{throw new Error('SYNC_TARGET_INVALID');}
    let expected:number|undefined=undefined;
    if(expectedExpiresAt!==undefined){
      if(typeof expectedExpiresAt!=='string'||expectedExpiresAt.length>64)throw new Error('SYNC_EXPIRY_INVALID');
      const parsed=Date.parse(expectedExpiresAt);if(!Number.isFinite(parsed)||parsed<=Date.now())throw new Error('SYNC_EXPIRY_INVALID');
      expected=parsed;
    }
    if(requiredSchema!==undefined&&(typeof requiredSchema!=='string'||requiredSchema.length>16||!/^\d+\.\d+$/.test(requiredSchema)))
      throw new Error('SYNC_SCHEMA_INVALID');
    if(this.busy)throw new Error('SYNC_PREFLIGHT_BUSY');
    this.busy=true;this.note='checking';this.lastIdentityStatus=0;this.lastErrorCode='';const generation=this.generation;
    try{
      const response=await this.exchange(base+'/identity',snapshot.token,undefined);
      if(generation!==this.generation)throw new Error('SYNC_PREFLIGHT_CANCELLED');
      this.lastIdentityStatus=response.status;
      if(response.status!==200){this.note=response.status===401?'AUTH_REQUIRED':response.status===403?'FORBIDDEN':'IDENTITY_UNAVAILABLE';
        throw new Error('SYNC_IDENTITY_UNAVAILABLE');}
      const identity=this.authenticatedIdentity(response.body,snapshot);
      if(!identity){this.note='IDENTITY_MISMATCH';throw new Error('SYNC_IDENTITY_MISMATCH');}
      if(expected!==undefined&&Date.parse(identity.expires_at)!==expected){this.note='EXPIRY_MISMATCH';throw new Error('SYNC_EXPIRY_MISMATCH');}
      if(requiredSchema!==undefined&&(!identity.material_schema_versions||!identity.material_schema_versions.includes(requiredSchema))){
        this.note='SCHEMA_UNSUPPORTED';throw new Error('SYNC_SCHEMA_UNSUPPORTED');}
      this.note='verified';return identity;
    }catch(caught){
      if(generation!==this.generation)throw new Error('SYNC_PREFLIGHT_CANCELLED');
      const message=(caught as Error).message;
      if(['SYNC_IDENTITY_UNAVAILABLE','SYNC_IDENTITY_MISMATCH','SYNC_EXPIRY_MISMATCH','SYNC_SCHEMA_UNSUPPORTED'].includes(message))throw new Error(message);
      this.note='IDENTITY_UNAVAILABLE';throw new Error('SYNC_IDENTITY_UNAVAILABLE');
    }finally{this.busy=false;}
  }
  async pump(queue:MaterialOutbox,target:MaterialSyncTarget):Promise<boolean>{
    const snapshot=JSON.parse(JSON.stringify(target)) as MaterialSyncTarget;
    const base=this.validate(snapshot,queue);if(this.busy||Date.now()<this.nextCheckAt)return false;
    this.busy=true;const generation=this.generation;let claim:MaterialOutboxClaim|undefined=undefined,identityChecked:boolean=false;
    try{
      // Bind to the actual authenticated owner before any private text leaves
      // the phone. A mislabeled token must not upload into another owner's DB.
      const identity=await this.exchange(base+'/identity',snapshot.token,undefined);
      this.lastIdentityStatus=identity.status;
      if(generation!==this.generation)return false;
      if(!queue.matches(snapshot.principal)){this.note='IDENTITY_CHANGED';return false;}
      if(identity.status!==200){this.note=identity.status===401?'AUTH_REQUIRED':identity.status===403?'FORBIDDEN':'IDENTITY_UNAVAILABLE';
        this.nextCheckAt=Date.now()+Math.max(5000,identity.retryAfterMs);return false;}
      const authenticated=this.authenticatedIdentity(identity.body,snapshot);
      if(!authenticated){this.note='IDENTITY_MISMATCH';this.nextCheckAt=Date.now()+5000;return false;}
      identityChecked=true;const now=Date.now();
      claim=queue.claim(now,authenticated.material_schema_versions===undefined?['1.0','1.1']:authenticated.material_schema_versions);
      if(!claim){
        const rows=queue.all();this.note=rows.some((row):boolean=>row.last_error==='SCHEMA_UNSUPPORTED'&&!row.needs_lookup&&['queued','reconcile','retry_wait'].includes(row.state))?'SCHEMA_UNSUPPORTED':'idle';
        if(this.note==='SCHEMA_UNSUPPORTED'){
          this.nextCheckAt=now+30000;
          // An earlier lookup/backoff must remain reachable while another
          // material waits for a schema upgrade.
          for(const row of rows)if(['queued','reconcile','retry_wait'].includes(row.state)&&row.next_attempt_at>now)this.nextCheckAt=Math.min(this.nextCheckAt,row.next_attempt_at);
        }
        return false;
      }
      this.activeQueue=queue;this.activeClaim=claim;this.note=claim.action==='lookup'?'reconciling':'sending';
      const response=await this.exchange(base+(claim.action==='lookup'?'/events/'+encodeURIComponent(claim.eventId):'/material-events'),
        snapshot.token,claim.action==='send'?claim.payload:undefined);
      if(generation!==this.generation)return false;
      if(!queue.matches(snapshot.principal)){this.note='IDENTITY_CHANGED';return false;}
      queue.finish(claim,response.status,response.body,Date.now(),Math.random(),response.retryAfterMs);this.note='processed';return true;
    }catch{
      if(generation===this.generation){
        if(!queue.matches(snapshot.principal))this.note='IDENTITY_CHANGED';
        else if(claim){try{queue.finish(claim,0,'',Date.now(),Math.random());this.note='TRANSPORT_UNKNOWN';}catch{this.note='OUTBOX_PERSIST_FAILED';}}
        else{this.note=identityChecked?'OUTBOX_PERSIST_FAILED':'IDENTITY_UNAVAILABLE';this.nextCheckAt=Date.now()+5000;}
      }
      return false;
    }finally{this.busy=false;this.activeQueue=undefined;this.activeClaim=undefined;}
  }
  cancel():void{
    this.generation++;this.note='paused';
    if(this.activeQueue&&this.activeClaim){try{this.activeQueue.finish(this.activeClaim,0,'',Date.now());}catch{this.note='OUTBOX_PERSIST_FAILED';}}
    const request=this.request;this.request=undefined;try{request?.destroy();}catch{}
  }
}
