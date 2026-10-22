import { MaterialStore } from './MaterialStore';
import { MaterialOutbox, MaterialOutboxRow } from './MaterialOutbox';
import { MaterialSyncDiscovery, MaterialDiscoveryResult } from './MaterialSyncDiscovery';
import { MaterialSyncTransport, MaterialSyncTarget } from './MaterialSyncTransport';

export class MaterialSyncView {
  materialId:string='';revision:number=0;state:string='local';storedRevision:number=0;
  receiptId:string='';commitSeq:number=0;storedAt:string='';error:string='';
  // This coordinator transports text/metadata only. A text receipt is never an
  // audio-upload receipt and never changes immutable content revisions.
  audioState:string='not_scheduled';
}
export class MaterialSyncSummary {
  enabled:boolean=false;foreground:boolean=false;busy:boolean=false;note:string='disabled';
  queued:number=0;stored:number=0;blocked:number=0;expired:number=0;issues:number=0;
}
export class MaterialSyncProblem {
  queueId:string='';materialId:string='';revision:number=0;state:string='';error:string='';
  started:number=0;kind:string='';canRecheck:boolean=false;canRenew:boolean=false;
}

// Owned by the Ability runtime, never by a mounted page. Foreground text sync
// is bounded to 32 revision checks, 8 new envelopes and 4 exchanges per turn.
// Background has no claimed network lease: pause and reconcile on return.
export class MaterialSyncCoordinator {
  changed:()=>void=():void=>{};
  private queue:MaterialOutbox|undefined=undefined;
  private discovery:MaterialSyncDiscovery|undefined=undefined;
  private transport:MaterialSyncTransport|undefined=undefined;
  private target:MaterialSyncTarget|undefined=undefined;
  private foreground:boolean=false;private configuring:boolean=false;private configGeneration:number=0;
  private flight:Promise<void>|undefined=undefined;private timer:number=-1;
  private note:string='disabled';private issues:number=0;private sweepComplete:boolean=true;
  private filesDir:string;private store:MaterialStore;
  constructor(filesDir:string,store:MaterialStore){this.filesDir=filesDir;this.store=store;}
  private notify():void{try{this.changed();}catch{}}
  private clearTimer():void{if(this.timer>=0)clearTimeout(this.timer);this.timer=-1;}
  async configure(target:MaterialSyncTarget|undefined):Promise<void>{
    const snapshot=target?JSON.parse(JSON.stringify(target)) as MaterialSyncTarget:undefined;
    const generation=++this.configGeneration;this.configuring=true;this.target=undefined;
    this.clearTimer();this.transport?.cancel();this.note='configuring';this.notify();
    // Never initialize a second writer while an old request/finalizer can
    // still touch the same principal's ledger.
    await this.flight;
    if(generation!==this.configGeneration)return;
    try{
      if(snapshot){
        this.queue=undefined;this.discovery=undefined;this.transport=undefined;
        const queue=new MaterialOutbox();queue.initialize(this.filesDir,snapshot.principal);
        const transport=new MaterialSyncTransport();transport.validateTarget(snapshot,queue);
        this.queue=queue;this.transport=transport;this.discovery=new MaterialSyncDiscovery(queue);
        this.target=snapshot;this.issues=0;this.sweepComplete=false;this.note=this.foreground?'ready':'paused';
      }else this.note='disabled';
    }catch{this.note='CONFIGURATION_FAILED';throw new Error('SYNC_CONFIGURATION_FAILED');}
    finally{this.configuring=false;this.notify();this.schedule();}
  }
  setForeground(value:boolean):void{
    this.foreground=value;this.clearTimer();
    if(!value){this.transport?.cancel();if(this.target)this.note='paused';}
    else if(this.target)this.note='ready';
    this.notify();this.schedule();
  }
  private due(row:MaterialOutboxRow,rows:MaterialOutboxRow[],now:number):boolean{
    return ['queued','reconcile','retry_wait'].includes(row.state)&&row.next_attempt_at<=now&&
      (row.revision===1||rows.some((prior:MaterialOutboxRow):boolean=>prior.material_id===row.material_id&&
        prior.revision===row.revision-1&&prior.state==='server_stored'));
  }
  private schedule():void{
    if(this.timer>=0||!this.foreground||!this.target||this.configuring||this.flight)return;
    const now=Date.now(),rows=this.queue?.all()||[];
    let delay=this.sweepComplete?30000:1000;
    for(const row of rows)if(this.due(row,rows,Number.MAX_SAFE_INTEGER))
      delay=Math.min(delay,Math.max(1000,row.next_attempt_at-now));
    delay=Math.max(delay,Math.min(30000,Math.max(0,(this.transport?.nextCheckAt||0)-now)));
    // Invalid credentials/identity do not generate a request every second.
    if(['AUTH_REQUIRED','FORBIDDEN','IDENTITY_MISMATCH'].includes(this.note))delay=Math.max(delay,30000);
    this.timer=setTimeout(():void=>{this.timer=-1;this.tick().catch(():void=>{});},delay);
  }
  tick():Promise<void>{
    if(this.flight)return this.flight;
    this.clearTimer();
    if(!this.foreground||!this.target||this.configuring)return Promise.resolve();
    const generation=this.configGeneration,queue=this.queue,discovery=this.discovery,transport=this.transport,target=this.target;
    if(!queue||!discovery||!transport)return Promise.resolve();
    // Defer work one microtask so flight is installed even on a no-network turn.
    const work=Promise.resolve().then(async():Promise<void>=>{
      if(generation!==this.configGeneration||!this.foreground)return;
      try{
        const result:MaterialDiscoveryResult=discovery.scan(this.store,Date.now(),32,8);
        this.issues=result.issues.length;this.sweepComplete=result.sweepComplete;
        this.note=this.issues?'DISCOVERY_NEEDS_ATTENTION':'ready';
        for(let n=0;n<4;n++){
          if(generation!==this.configGeneration||!this.foreground||this.target!==target)break;
          const rows=queue.all();if(!rows.some((row:MaterialOutboxRow):boolean=>this.due(row,rows,Date.now())))break;
          const processed=await transport.pump(queue,target);
          if(generation!==this.configGeneration||!this.foreground||this.target!==target)break;
          this.note=transport.note;if(!processed)break;
        }
      }catch{if(generation===this.configGeneration)this.note='SYNC_NEEDS_ATTENTION';}
    });
    this.flight=work.finally(():void=>{
      this.flight=undefined;this.notify();this.schedule();
    });
    return this.flight;
  }
  summary():MaterialSyncSummary{
    const out=new MaterialSyncSummary();out.enabled=!!this.target;out.foreground=this.foreground;
    out.busy=!!this.flight||this.configuring;out.note=this.note;out.issues=this.issues;
    for(const row of this.queue?.all()||[]){
      if(row.state==='server_stored')out.stored++;
      else if(row.state==='blocked')out.blocked++;
      else if(row.state==='expired')out.expired++;
      else out.queued++;
    }
    return out;
  }
  view(materialId:string):MaterialSyncView{
    const view=new MaterialSyncView();view.materialId=materialId;
    const head=this.store.read(materialId);if(!head)return view;view.revision=head.revision;
    const rows=(this.queue?.all()||[]).filter((row:MaterialOutboxRow):boolean=>row.material_id===materialId);
    for(const row of rows)if(row.state==='server_stored'&&row.revision>view.storedRevision)view.storedRevision=row.revision;
    const current=rows.find((row:MaterialOutboxRow):boolean=>row.revision===head.revision);
    if(current){view.state=current.state;view.error=current.last_error;
      if(current.state==='server_stored'){view.receiptId=current.receipt_id;view.commitSeq=current.server_commit_seq;view.storedAt=current.server_stored_at;}}
    return view;
  }
  problems():MaterialSyncProblem[]{
    const result:MaterialSyncProblem[]=[];
    for(const row of this.queue?.all()||[]){
      if(!['blocked','expired'].includes(row.state))continue;
      const item=new MaterialSyncProblem();item.queueId=row.queue_id;item.materialId=row.material_id;
      item.revision=row.revision;item.state=row.state;item.error=row.last_error;
      item.canRecheck=!!this.target&&row.last_error!=='PAYLOAD_CORRUPT';
      item.canRenew=!!this.target&&row.state==='expired'&&!row.needs_lookup&&row.absence_confirmed_at>0&&
        row.absence_confirmed_at>=row.expires_at&&row.absence_confirmed_at<=Date.now()&&row.expires_at<=Date.now()&&row.history.length<16;
      try{const head=this.store.read(row.material_id);if(head){item.started=head.source.started;item.kind=head.source.kind;}}catch{}
      result.push(item);if(result.length===20)break;
    }
    return result;
  }
  recover(queueId:string,action:string):void{
    // IDs are principal-bound. A stale screen cannot operate on a replacement
    // account; no bulk unlock, token refresh or automatic envelope renewal.
    if(!this.target||!this.queue||!this.foreground||this.flight||this.configuring)throw new Error('SYNC_RECOVERY_BUSY');
    const row=this.queue.all().find((r:MaterialOutboxRow):boolean=>r.queue_id===queueId);
    if(!row)throw new Error('SYNC_RECOVERY_NOT_FOUND');
    if(action==='recheck'){
      const changed=row.state==='expired'?this.queue.recheckExpired(queueId):this.queue.resumeBlocked(queueId)>0;
      if(!changed)throw new Error('SYNC_RECOVERY_NOT_ALLOWED');
    }else if(action==='renew')this.queue.renewExpired(queueId,Date.now());
    else throw new Error('SYNC_RECOVERY_NOT_ALLOWED');
    this.note='ready';this.clearTimer();this.notify();this.schedule();
  }
  async stop():Promise<void>{this.setForeground(false);await this.configure(undefined);}
}
