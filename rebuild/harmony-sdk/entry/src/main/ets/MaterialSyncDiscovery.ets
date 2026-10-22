import { MaterialStore } from './MaterialStore';
import { MaterialOutbox, MaterialOutboxRow } from './MaterialOutbox';

export class MaterialDiscoveryIssue { materialId:string='';revision:number=0;code:string=''; }
export class MaterialDiscoveryResult {
  inspected:number=0;enqueued:number=0;alreadyQueued:number=0;sweepComplete:boolean=false;issues:MaterialDiscoveryIssue[]=[];
}

// One instance per shared outbox coordinator. Explicit, synchronous, bounded
// steps only: no timer/network/credentials or discovery on module import.
// Cursor is expendable; the durable outbox is the authority after a restart.
export class MaterialSyncDiscovery {
  private afterId:string='';private currentId:string='';private nextRevision:number=1;
  private queue:MaterialOutbox;
  constructor(queue:MaterialOutbox){this.queue=queue;}
  private advance():void{this.afterId=this.currentId;this.currentId='';this.nextRevision=1;}
  scan(store:MaterialStore,now:number,maxChecks:number=32,maxNew:number=8):MaterialDiscoveryResult{
    if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(maxChecks)||maxChecks<1||maxChecks>128||
      !Number.isSafeInteger(maxNew)||maxNew<1||maxNew>32)throw new Error('DISCOVERY_BUDGET_INVALID');
    const result=new MaterialDiscoveryResult(),ids=store.ids(),known=this.queue.all();
    while(result.inspected<maxChecks&&result.enqueued<maxNew){
      if(!this.currentId){this.currentId=ids.find((id:string):boolean=>id>this.afterId)||'';
        if(!this.currentId){result.sweepComplete=true;this.afterId='';return result;}}
      const id=this.currentId,before=result.inspected;let head=0;
      try{
        const latest=store.read(id);if(!latest)throw new Error('MATERIAL_NOT_FOUND');head=latest.revision;
        while(this.nextRevision<=head&&result.inspected<maxChecks&&result.enqueued<maxNew){
          const revision=this.nextRevision;result.inspected++;
          if(known.some((row:MaterialOutboxRow):boolean=>row.material_id===id&&row.revision===revision))result.alreadyQueued++;
          else{const row=this.queue.enqueueRevision(store,id,revision,now);known.push(row);result.enqueued++;}
          this.nextRevision++;
        }
        if(this.nextRevision>head)this.advance();
      }catch(error){
        const message=(error as Error).message,issue=new MaterialDiscoveryIssue();issue.materialId=id;issue.revision=this.nextRevision;
        const codes=['MATERIAL_NOT_FOUND','MATERIAL_TOO_LARGE','MATERIAL_EVENT_TOO_LARGE','MATERIAL_REVISION_MISMATCH',
          'OUTBOX_FULL','OUTBOX_TOO_LARGE','OUTBOX_WRITER_STALE','OUTBOX_PAYLOAD_CORRUPT','OUTBOX_REVISION_CONFLICT','OUTBOX_EVENT_CONFLICT'];
        issue.code=codes.includes(message)?message:'MATERIAL_DISCOVERY_FAILED';result.issues.push(issue);if(result.inspected===before)result.inspected++;
        // A malformed/missing revision blocks this object's later revisions.
        // Other objects still get a turn; a future sweep revisits the problem.
        this.advance();
        if(['OUTBOX_FULL','OUTBOX_TOO_LARGE','OUTBOX_WRITER_STALE'].includes(issue.code))return result;
      }
    }
    return result;
  }
}
