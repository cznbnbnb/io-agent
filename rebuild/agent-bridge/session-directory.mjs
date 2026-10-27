import {randomUUID} from 'node:crypto';
import {BridgeError} from './client.mjs';
import {runtimeDigest} from './runtime-events.mjs';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const need=(v,code='SESSION_DIRECTORY_INVALID')=>{if(!v)throw new BridgeError(code,{permanent:true});};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const stamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*Z$/.test(v)&&Number.isFinite(Date.parse(v));
const routeKeys=['computer_id','agent_id','project_id','session_id'];
export const directoryRoute=v=>object(v)&&Object.keys(v).length===4&&routeKeys.every(k=>typeof v[k]==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(v[k]))&&uuid(v.session_id);
export const directoryLabel=v=>typeof v==='string'&&v.length>=1&&v.length<=64&&Buffer.byteLength(v)<=256&&v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v);
const capabilities=['can_execute','exact_turn_interrupt','descendants_proof','atomic_queue_append','native_queue_expiry'];
const equal=(a,b)=>runtimeDigest(a)===runtimeDigest(b);
const code=e=>typeof e?.code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(e.code)?e.code:'SESSION_DIRECTORY_UNAVAILABLE';
const safeReason=v=>v===null||typeof v==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(v);

function realm(value,config){
  need(object(value)&&value.schema_version==='1.0'&&value.server_id===config.server_id&&value.owner_id===config.owner_id&&stamp(value.server_time));
}
export function validateAgentDefault(value){
  need(object(value)&&Object.keys(value).length===3&&Number.isSafeInteger(value.revision)&&value.revision>=0&&
    (value.route===null||directoryRoute(value.route))&&(value.revision===0?value.updated_at===null&&value.route===null:stamp(value.updated_at)));
  return value;
}
export function validateDirectoryEntry(value){
  need(object(value)&&directoryRoute(value.route)&&typeof value.producer_id==='string'&&/^agent-[a-f0-9]{8}$/.test(value.producer_id)&&
    uuid(value.device_id)&&['codex','claude','acp'].includes(value.host_kind)&&typeof value.workspace==='string'&&value.workspace&&Buffer.byteLength(value.workspace)<=2048&&
    directoryLabel(value.label)&&Number.isSafeInteger(value.generation)&&value.generation>0&&
    uuid(value.instance_id)&&uuid(value.lease_id)&&stamp(value.lease_expires_at)&&typeof value.online==='boolean'&&
    (value.busy===null||typeof value.busy==='boolean')&&object(value.capabilities)&&Object.keys(value.capabilities).length===capabilities.length&&
    capabilities.every(k=>typeof value.capabilities[k]==='boolean')&&value.capabilities.descendants_proof===false&&value.capabilities.native_queue_expiry===false&&safeReason(value.reason)&&
    (value.online||value.busy===null&&capabilities.every(k=>value.capabilities[k]===false)&&value.reason!==null));
  return value;
}
export function validateDirectory(value,config){
  realm(value,config);need(Array.isArray(value.sessions)&&value.sessions.length<=128);validateAgentDefault(value.default);
  const routes=new Set();for(const entry of value.sessions){validateDirectoryEntry(entry);const key=runtimeDigest(entry.route);need(!routes.has(key));routes.add(key);
    need(!entry.online||Date.parse(entry.lease_expires_at)>Date.parse(value.server_time));}
  return value;
}
export function validateDefaultReply(value,config){realm(value,config);validateAgentDefault(value.default);return value;}
function validateLeaseReply(value,config,input){
  realm(value,config);const e=validateDirectoryEntry(value.session);
  need(equal(e.route,input.route)&&e.producer_id===config.producer_id&&e.instance_id===input.instance_id&&
    e.generation===(input.action==='acquire'?input.expected_generation+1:input.generation)&&
    (input.action==='acquire'||e.lease_id===input.lease_id));
  if(input.action==='acquire')need(e.host_kind===input.host_kind&&e.workspace===input.workspace);
  return e;
}
const offline=reason=>({ready:false,busy:null,can_execute:false,exact_turn_interrupt:false,descendants_proof:false,atomic_queue_append:false,native_queue_expiry:false,reason});
function observation(s){
  if(s?.availability!=='online')return offline('host_unavailable');
  need((s.busy===null||typeof s.busy==='boolean')&&typeof s.can_execute==='boolean'&&typeof s.exact_turn_interrupt==='boolean'&&typeof s.atomic_queue_append==='boolean'&&s.descendants_proof===false&&s.native_queue_expiry===false);
  const reason=typeof s.reason==='string'?s.reason.toLowerCase():s.reason;
  return{ready:true,busy:s.busy,can_execute:s.can_execute,exact_turn_interrupt:s.exact_turn_interrupt,
    descendants_proof:false,atomic_queue_append:s.atomic_queue_append,native_queue_expiry:false,
    reason:safeReason(reason)&&reason!==undefined?reason:s.can_execute?null:'host_unavailable'};
}
async function parallel(items,operation){let index=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(index<items.length)await operation(items[index++]);}));}

/** Separate metadata publisher. It never calls runtime tick, sends input, starts
 * queued work, or interrupts a turn. Lease failures do not block answers/results.
 * Every retry keeps the exact request id/body. A new process cannot steal a live
 * lease; the old process must release it or its 60-second lease must expire. */
export class SessionDirectoryPublisher{
  #client;#adapter;#clock;#instance;#leases=new Map();#pending=new Map();#running=false;#timer;#operation=null;#error=null;#last=null;#epoch=0;#stopped=false;
  constructor({client,adapter,clock=Date.now,instanceId=randomUUID()}={}){
    need(client&&typeof adapter?.readinessSnapshot==='function'&&uuid(instanceId),'SESSION_DIRECTORY_CONFIG_INVALID');
    this.#client=client;this.#adapter=adapter;this.#clock=clock;this.#instance=instanceId;
  }
  status(){return{supported:true,publishing:this.#running,leased_sessions:this.#leases.size,last_checked_at:this.#last,error:this.#error};}
  start(){need(!this.#running,'SESSION_DIRECTORY_ALREADY_STARTED');this.#stopped=false;this.#running=true;this.#schedule(0);}
  #schedule(ms){if(this.#running){this.#timer=setTimeout(()=>{if(this.#running)this.tick().finally(()=>this.#schedule(15000));},ms);this.#timer.unref?.();}}
  tick(){
    if(this.#stopped)return Promise.resolve();
    if(this.#operation)return this.#operation;
    this.#operation=this.#tick(this.#epoch).catch(e=>{this.#error=code(e);}).finally(()=>{this.#operation=null;});return this.#operation;
  }
  async #tick(epoch){
    const started=this.#clock();
    const snapshot=await this.#adapter.readinessSnapshot({timeoutMs:5000});
    if(epoch!==this.#epoch)return;
    need(snapshot?.schema_version===1&&Array.isArray(snapshot.sessions)&&snapshot.sessions.length<=32&&stamp(snapshot.observed_at));
    const sampledAt=Math.min(started,Date.parse(snapshot.observed_at));
    const sessions=new Map(),seen=new Set();let invalid=null;
    for(const s of snapshot.sessions){
      let key;try{
        need(object(s)&&directoryRoute(s.route));key=runtimeDigest(s.route);
        need(!seen.has(key));seen.add(key);
        need(['codex','claude','acp'].includes(s.host_kind)&&typeof s.workspace==='string'&&s.workspace&&
          (s.label===undefined||directoryLabel(s.label)));
        sessions.set(key,s);
      }catch(e){
        // Quarantine every occurrence of an ambiguous route, not just the
        // later duplicate. Unrelated healthy routes must still renew.
        if(key!==undefined){seen.add(key);sessions.delete(key);}invalid=code(e);
      }
    }
    const directory=validateDirectory(await this.#client.agentSessions(),this.#client.config);if(epoch!==this.#epoch)return;this.#error=invalid;
    await parallel([...sessions.values()],async s=>{
      if(epoch!==this.#epoch)return;
      const key=runtimeDigest(s.route);try{
        let pending=this.#pending.get(key),lease=this.#leases.get(key);const now=this.#clock();
        if(now-sampledAt>=15000){this.#error='SESSION_DIRECTORY_OBSERVATION_STALE';return;}
        const obs=observation(s);
        // Never retry stale readiness into a fresh 60-second server lease. A
        // previous uncertain write may be visible in GET: release that exact
        // instance with a higher sequence. Otherwise simply let it expire.
        if(pending&&(now-pending.created>=15000||!equal(pending.input.observation,obs))){
          const current=directory.sessions.find(e=>equal(e.route,s.route));
          if(current?.instance_id===this.#instance){
            await this.#client.publishAgentSession({action:'release',request_id:randomUUID(),instance_id:this.#instance,route:s.route,
              generation:current.generation,lease_id:current.lease_id,sequence:Math.max(lease?.sequence??0,pending.input.sequence??0)+1});
          }
          this.#pending.delete(key);this.#leases.delete(key);return;
        }
        if(!pending){
          if(lease&&now>=lease.until){this.#leases.delete(key);lease=null;}
          if(lease){pending={created:sampledAt,input:{action:'heartbeat',request_id:randomUUID(),instance_id:this.#instance,route:s.route,generation:lease.generation,lease_id:lease.id,sequence:lease.sequence+1,observation:obs}};}
          else{
            if(!obs.ready)return;
            const current=directory.sessions.find(e=>equal(e.route,s.route));
            if(current&&(current.producer_id!==this.#client.config.producer_id||current.workspace!==s.workspace||current.host_kind!==s.host_kind))throw new BridgeError('SESSION_DIRECTORY_BINDING_CONFLICT',{permanent:true});
            // Even a host-unavailable observation may have an active lease.
            if(current&&Date.parse(current.lease_expires_at)>Date.parse(directory.server_time)){this.#error='SESSION_DIRECTORY_LEASE_HELD';return;}
            pending={created:sampledAt,input:{action:'acquire',request_id:randomUUID(),instance_id:this.#instance,route:s.route,expected_generation:current?.generation??0,
              host_kind:s.host_kind,workspace:s.workspace,label:s.label??s.route.project_id.slice(0,64),observation:obs}};
          }
          this.#pending.set(key,pending);
        }
        const response=await this.#client.publishAgentSession(pending.input),entry=validateLeaseReply(response,this.#client.config,pending.input);
        // An old idempotent acknowledgement must never extend local freshness.
        const until=Math.min(pending.created+60000,this.#clock()+Math.max(0,Date.parse(entry.lease_expires_at)-Date.parse(response.server_time)));
        this.#leases.set(key,{route:s.route,id:entry.lease_id,generation:entry.generation,sequence:pending.input.sequence??0,until});this.#pending.delete(key);
      }catch(e){
        this.#error=code(e);
        if(e?.permanent&&e.code!=='INVALID_RESPONSE'&&e.code!=='SESSION_DIRECTORY_INVALID'){
          this.#pending.delete(key);this.#leases.delete(key);
        }
      }
    });
    this.#last=new Date(this.#clock()).toISOString();
  }
  async stop(){
    this.#running=false;this.#stopped=true;this.#epoch++;clearTimeout(this.#timer);await this.#operation;
    // Read back ambiguous metadata writes; never acquire/renew on shutdown.
    if(this.#pending.size)try{
      const directory=validateDirectory(await this.#client.agentSessions(),this.#client.config);
      for(const [key,p]of this.#pending){const e=directory.sessions.find(s=>equal(s.route,p.input.route)&&s.instance_id===this.#instance);
        if(e)this.#leases.set(key,{route:e.route,id:e.lease_id,generation:e.generation,sequence:Math.max(this.#leases.get(key)?.sequence??0,p.input.sequence??0),until:this.#clock()+Math.max(0,Date.parse(e.lease_expires_at)-Date.parse(directory.server_time))});}
    }catch(e){this.#error=code(e);}
    await parallel([...this.#leases.values()],async lease=>{
      if(lease.until<=this.#clock())return;
      try{await this.#client.publishAgentSession({action:'release',request_id:randomUUID(),instance_id:this.#instance,route:lease.route,generation:lease.generation,lease_id:lease.id,sequence:lease.sequence+1});}
      catch(e){this.#error=code(e);}
    });
    this.#leases.clear();this.#pending.clear();
  }
}
