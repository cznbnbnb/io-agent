import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { HarmonySha256 } from 'turbo_core';
import { MaterialEventIdentity, WireMaterialEvent, materialRevisionEvent } from './MaterialWire';
import { MaterialStore } from './MaterialStore';

export class MaterialSyncPrincipal { ownerId:string='';producerId:string='';serverId:string=''; }
export class MaterialRetiredEnvelope {
  queue_id:string='';event_id:string='';payload_hash:string='';payload_bytes:number=0;expires_at:number=0;absence_confirmed_at:number=0;
}
export class MaterialOutboxRow {
  queue_id:string='';event_id:string='';material_id:string='';revision:number=0;
  payload_hash:string='';payload_bytes:number=0;expires_at:number=0;
  state:string='queued';attempts:number=0;next_attempt_at:number=0;last_error:string='';
  needs_lookup:boolean=false;receipt_id:string='';server_commit_seq:number=0;server_stored_at:string='';
  absence_confirmed_at:number=0;history:MaterialRetiredEnvelope[]=[];
}
class OutboxSnapshot { schema:number=2;principal:MaterialSyncPrincipal=new MaterialSyncPrincipal();rows:MaterialOutboxRow[]=[]; }
export class MaterialOutboxClaim {
  queueId:string='';attempt:number=0;action:string='send';eventId:string='';payload:string='';partitionId:string='';
}
export class MaterialReceipt {
  receipt_id:string='';subject_kind:string='';subject_id:string='';subject_revision:number=0;
  stage:string='';actor_id:string='';related_event_id:string='';error:string|null=null;
}
export class MaterialStoredAck {
  schema_version:string='';event_id:string='';material_id:string='';revision:number=0;
  commit_seq:number=0;stored_at:string='';receipt:MaterialReceipt=new MaterialReceipt();
}
class MaterialLookupErrorBody { code:string='';retryable:boolean=true; }
class MaterialLookupError { schema_version:string='';error:MaterialLookupErrorBody=new MaterialLookupErrorBody(); }

// Durable text transport coordinator only. No credential, network, recording,
// background lease or automatic discovery is started by this component.
export class MaterialOutbox {
  private root:string='';private principal:MaterialSyncPrincipal=new MaterialSyncPrincipal();
  private rows:MaterialOutboxRow[]=[];private ledgerHash:string='';
  private initialized:boolean=false;private partitionId:string='';
  private hash(text:string):string{
    const bytes=new util.TextEncoder().encodeInto(text);
    try{return Array.from(new HarmonySha256().digest(bytes)).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}
    finally{bytes.fill(0);}
  }
  initialize(filesDir:string,principal:MaterialSyncPrincipal):void{
    this.initialized=false;this.rows=[];this.root='';this.ledgerHash='';this.partitionId='';
    if([principal.ownerId,principal.producerId,principal.serverId].some((v:string):boolean=>!/^[A-Za-z0-9_.:-]{1,128}$/.test(v)))throw new Error('OUTBOX_PRINCIPAL_INVALID');
    this.principal=JSON.parse(JSON.stringify(principal)) as MaterialSyncPrincipal;
    const parent=filesDir+'/material-outbox';if(!fs.accessSync(parent))fs.mkdirSync(parent);
    this.partitionId=this.hash(JSON.stringify([principal.ownerId,principal.producerId,principal.serverId]));this.root=parent+'/'+this.partitionId;
    if(!fs.accessSync(this.root))fs.mkdirSync(this.root);
    let rows:MaterialOutboxRow[]=[];const file=this.root+'/state.json';this.ledgerHash='';
    if(fs.accessSync(file)){
      if(fs.statSync(file).size>2000000)throw new Error('OUTBOX_TOO_LARGE');
      const text=fs.readTextSync(file),snapshot=JSON.parse(text) as OutboxSnapshot;this.ledgerHash=this.hash(text);
      if(![1,2].includes(snapshot.schema)||snapshot.principal.ownerId!==principal.ownerId||snapshot.principal.producerId!==principal.producerId||
        snapshot.principal.serverId!==principal.serverId||!Array.isArray(snapshot.rows)||snapshot.rows.length>1000)throw new Error('OUTBOX_CORRUPT');
      rows=snapshot.rows;const seen:string[]=[],versions:string[]=[];
      for(const row of rows){
        if(snapshot.schema===1){row.absence_confirmed_at=0;row.history=[];}
        this.validate(row);const version=row.material_id+':'+row.revision;
        for(const queueId of [row.queue_id,...row.history.map((h:MaterialRetiredEnvelope):string=>h.queue_id)]){
          if(seen.includes(queueId))throw new Error('OUTBOX_DUPLICATE');seen.push(queueId);}
        if(versions.includes(version))throw new Error('OUTBOX_DUPLICATE');versions.push(version);}
      if(this.accountedBytes(rows)>67108864)throw new Error('OUTBOX_CORRUPT');
    }
    this.rows=rows;const recovered=JSON.parse(JSON.stringify(rows)) as MaterialOutboxRow[];let changed=false;
    for(const row of recovered)if(row.state==='sending'){
      row.state='reconcile';row.needs_lookup=true;row.next_attempt_at=0;row.last_error='INTERRUPTED';changed=true;
    }
    if(changed)this.publish(recovered);
    this.initialized=true;
  }
  private validate(row:MaterialOutboxRow):void{
    if(!/^[a-f0-9]{64}$/.test(row.queue_id)||typeof row.event_id!=='string'||!row.event_id||row.event_id.length>512||this.hash(row.event_id)!==row.queue_id||
      !/^mat-(recording|lifelog)-[a-f0-9]{32}$/.test(row.material_id)||!Number.isSafeInteger(row.revision)||row.revision<1||
      !/^[a-f0-9]{64}$/.test(row.payload_hash)||!Number.isSafeInteger(row.payload_bytes)||row.payload_bytes<1||row.payload_bytes>262144||
      !Number.isSafeInteger(row.expires_at)||row.expires_at<0||!Number.isSafeInteger(row.attempts)||row.attempts<0||
      !Number.isSafeInteger(row.next_attempt_at)||row.next_attempt_at<0||typeof row.needs_lookup!=='boolean'||
      !['queued','sending','reconcile','retry_wait','server_stored','expired','blocked'].includes(row.state)||
      typeof row.last_error!=='string'||row.last_error.length>128||typeof row.receipt_id!=='string'||row.receipt_id.length>512||
      !Number.isSafeInteger(row.server_commit_seq)||row.server_commit_seq<0||typeof row.server_stored_at!=='string'||row.server_stored_at.length>64||
      !Number.isSafeInteger(row.absence_confirmed_at)||row.absence_confirmed_at<0||!Array.isArray(row.history)||row.history.length>16||
      (row.absence_confirmed_at>0&&(row.state!=='expired'||row.needs_lookup||row.absence_confirmed_at<row.expires_at))||
      (row.state==='server_stored'&&(!row.receipt_id||row.server_commit_seq<1||!Number.isFinite(Date.parse(row.server_stored_at)))))throw new Error('OUTBOX_CORRUPT');
    const seen:string[]=[row.queue_id];
    for(const h of row.history){
      if(typeof h.event_id!=='string'||!h.event_id||h.event_id.length>512||h.queue_id!==this.hash(h.event_id)||seen.includes(h.queue_id)||
        !/^[a-f0-9]{64}$/.test(h.payload_hash)||!Number.isSafeInteger(h.payload_bytes)||h.payload_bytes<1||h.payload_bytes>262144||
        !Number.isSafeInteger(h.expires_at)||h.expires_at<0||!Number.isSafeInteger(h.absence_confirmed_at)||h.absence_confirmed_at<h.expires_at||h.absence_confirmed_at<1)throw new Error('OUTBOX_CORRUPT');
      seen.push(h.queue_id);
    }
  }
  private write(path:string,text:string):void{
    const bytes=new util.TextEncoder().encodeInto(text),file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('OUTBOX_WRITE_FAILED');offset+=n;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}fs.renameSync(path+'.partial',path);
  }
  private publish(rows:MaterialOutboxRow[]):void{
    const path=this.root+'/state.json';
    if(fs.accessSync(path)&&fs.statSync(path).size>2000000)throw new Error('OUTBOX_TOO_LARGE');
    if((fs.accessSync(path)?this.hash(fs.readTextSync(path)):'')!==this.ledgerHash)throw new Error('OUTBOX_WRITER_STALE');
    for(const row of rows)this.validate(row);const snapshot=new OutboxSnapshot();snapshot.principal=this.principal;snapshot.rows=rows;
    const text=JSON.stringify(snapshot);if(new util.TextEncoder().encodeInto(text).length>2000000)throw new Error('OUTBOX_TOO_LARGE');
    this.write(path,text);this.rows=rows;this.ledgerHash=this.hash(text);
  }
  matches(principal:MaterialSyncPrincipal):boolean{
    return this.initialized&&principal.ownerId===this.principal.ownerId&&principal.producerId===this.principal.producerId&&principal.serverId===this.principal.serverId;
  }
  all():MaterialOutboxRow[]{return this.initialized?JSON.parse(JSON.stringify(this.rows)) as MaterialOutboxRow[]:[];}
  private accountedBytes(rows:MaterialOutboxRow[]):number{
    return rows.reduce((sum:number,r:MaterialOutboxRow):number=>sum+r.payload_bytes+
      r.history.reduce((n:number,h:MaterialRetiredEnvelope):number=>n+h.payload_bytes,0),0);
  }
  // Deterministic per-partition/revision identity permits adopting an immutable
  // payload left behind between its fsync/rename and ledger publication. Dates
  // come from that payload on recovery, never from a new discovery attempt.
  enqueueRevision(store:MaterialStore,id:string,revision:number,now:number):MaterialOutboxRow{
    if(!this.initialized)throw new Error('OUTBOX_NOT_INITIALIZED');
    if(!Number.isSafeInteger(now)||now<0||!Number.isFinite(new Date(now+604800000).getTime()))throw new Error('OUTBOX_TIME_INVALID');
    if(!/^mat-(recording|lifelog)-[a-f0-9]{32}$/.test(id)||!Number.isSafeInteger(revision)||revision<1)throw new Error('OUTBOX_EVENT_INVALID');
    const existing=this.rows.find((r:MaterialOutboxRow):boolean=>r.material_id===id&&r.revision===revision);
    if(existing)return JSON.parse(JSON.stringify(existing)) as MaterialOutboxRow;
    const stable=this.hash(JSON.stringify(['material-revision-v1',this.principal.ownerId,this.principal.producerId,this.principal.serverId,id,revision]));
    const identity=new MaterialEventIdentity();identity.eventId='evt-mat-'+stable;identity.idempotencyKey='idem-mat-'+stable;
    identity.producerId=this.principal.producerId;identity.createdAt=now;identity.expiresAt=now+604800000;
    const path=this.root+'/'+this.hash(identity.eventId)+'.payload.json';
    let orphan:string|undefined=undefined;
    if(fs.accessSync(path)){
      if(fs.statSync(path).size>262144)throw new Error('OUTBOX_PAYLOAD_CORRUPT');
      orphan=fs.readTextSync(path);const event=JSON.parse(orphan) as WireMaterialEvent;
      if(event.event_id!==identity.eventId||event.idempotency_key!==identity.idempotencyKey||event.producer_id!==identity.producerId||
        event.body.material_id!==id||event.body.revision!==revision)throw new Error('OUTBOX_PAYLOAD_CORRUPT');
      identity.createdAt=Date.parse(event.created_at);identity.expiresAt=Date.parse(event.expires_at);
    }
    const event=materialRevisionEvent(store,id,revision,identity);
    if(orphan!==undefined&&orphan!==JSON.stringify(event))throw new Error('OUTBOX_PAYLOAD_CORRUPT');
    return this.enqueue(event);
  }
  enqueue(event:WireMaterialEvent):MaterialOutboxRow{
    if(!this.initialized)throw new Error('OUTBOX_NOT_INITIALIZED');
    if(!['1.1','1.2'].includes(event.schema_version)||event.kind!=='material.revision'||event.producer_id!==this.principal.producerId||
      !event.event_id||event.event_id.length>512||!event.idempotency_key||event.idempotency_key.length<8||event.idempotency_key.length>256||
      !Number.isFinite(Date.parse(event.created_at))||!Number.isFinite(Date.parse(event.expires_at))||Date.parse(event.expires_at)<=Date.parse(event.created_at)||
      event.body.revision!==event.body.base_revision+1)throw new Error('OUTBOX_EVENT_INVALID');
    const payload=JSON.stringify(event),bytes=new util.TextEncoder().encodeInto(payload).length;
    if(bytes>262144)throw new Error('MATERIAL_EVENT_TOO_LARGE');
    const hash=this.hash(payload),rows=this.all(),existing=rows.find((r:MaterialOutboxRow):boolean=>r.material_id===event.body.material_id&&r.revision===event.body.revision);
    if(existing){if(existing.event_id!==event.event_id||existing.payload_hash!==hash)throw new Error('OUTBOX_REVISION_CONFLICT');return existing;}
    const row=new MaterialOutboxRow();row.queue_id=this.hash(event.event_id);row.event_id=event.event_id;row.material_id=event.body.material_id;
    row.revision=event.body.revision;row.payload_hash=hash;row.payload_bytes=bytes;row.expires_at=Date.parse(event.expires_at);this.validate(row);
    if(rows.some((r:MaterialOutboxRow):boolean=>r.queue_id===row.queue_id||r.history.some((h:MaterialRetiredEnvelope):boolean=>h.queue_id===row.queue_id)))throw new Error('OUTBOX_EVENT_CONFLICT');
    if(rows.length>=1000||this.accountedBytes(rows)+bytes>67108864)throw new Error('OUTBOX_FULL');
    const path=this.root+'/'+row.queue_id+'.payload.json';
    if(fs.accessSync(path)){if(fs.statSync(path).size!==bytes||this.hash(fs.readTextSync(path))!==hash)throw new Error('OUTBOX_EVENT_CONFLICT');}
    else this.write(path,payload);
    rows.push(row);this.publish(rows);return row;
  }
  // Explicit policy action: expiry alone is not permission to change IDs.
  // Ask the same authenticated service about the old event first.
  recheckExpired(queueId:string):boolean{
    if(!this.initialized)throw new Error('OUTBOX_NOT_INITIALIZED');
    const rows=this.all(),row=rows.find((r:MaterialOutboxRow):boolean=>r.queue_id===queueId);
    if(!row||row.state!=='expired')return false;
    row.state='reconcile';row.needs_lookup=true;row.absence_confirmed_at=0;row.next_attempt_at=0;row.last_error='';
    this.publish(rows);return true;
  }
  private confirmedAbsent(body:string):boolean{
    if(body.length>16384)return false;
    try{const error=JSON.parse(body) as MaterialLookupError;
      return error.schema_version==='1.0'&&error.error?.code==='EVENT_NOT_FOUND'&&error.error.retryable===false;
    }catch{return false;}
  }
  // New envelope, same immutable revision body. Retain the old file and lineage.
  // A replay of this local action returns the existing successor unchanged.
  renewExpired(queueId:string,now:number):MaterialOutboxRow{
    if(!this.initialized)throw new Error('OUTBOX_NOT_INITIALIZED');
    if(!Number.isSafeInteger(now)||now<0||!Number.isFinite(new Date(now+604800000).getTime()))throw new Error('OUTBOX_TIME_INVALID');
    const rows=this.all(),index=rows.findIndex((r:MaterialOutboxRow):boolean=>r.queue_id===queueId);
    if(index<0){const successor=rows.find((r:MaterialOutboxRow):boolean=>r.history.some((h:MaterialRetiredEnvelope):boolean=>h.queue_id===queueId));
      if(successor)return successor;throw new Error('OUTBOX_RENEWAL_NOT_FOUND');}
    const old=rows[index];
    if(old.state!=='expired'||old.needs_lookup||old.expires_at>now||old.absence_confirmed_at<1||old.absence_confirmed_at>now||
      old.absence_confirmed_at<old.expires_at)throw new Error('OUTBOX_RENEWAL_REQUIRES_ABSENCE');
    if(old.history.length>=16)throw new Error('OUTBOX_RENEWAL_LIMIT');
    const event=JSON.parse(this.payload(old)) as WireMaterialEvent;
    if(!['1.1','1.2'].includes(event.schema_version)||event.kind!=='material.revision'||event.event_id!==old.event_id||event.producer_id!==this.principal.producerId||
      event.body.material_id!==old.material_id||event.body.revision!==old.revision||Date.parse(event.expires_at)!==old.expires_at)throw new Error('OUTBOX_PAYLOAD_CORRUPT');
    const stable=this.hash(JSON.stringify(['material-reissue-v1',this.principal.ownerId,this.principal.producerId,this.principal.serverId,old.event_id]));
    event.event_id='evt-renew-'+stable;event.idempotency_key='idem-renew-'+stable;
    event.created_at=new Date(now).toISOString();event.expires_at=new Date(now+604800000).toISOString();
    const next=new MaterialOutboxRow();next.event_id=event.event_id;next.queue_id=this.hash(event.event_id);next.material_id=old.material_id;next.revision=old.revision;
    const path=this.root+'/'+next.queue_id+'.payload.json';let orphan:string|undefined=undefined;
    if(fs.accessSync(path)){
      if(fs.statSync(path).size>262144)throw new Error('OUTBOX_PAYLOAD_CORRUPT');
      orphan=fs.readTextSync(path);const saved=JSON.parse(orphan) as WireMaterialEvent;
      if(!Number.isFinite(Date.parse(saved.created_at))||Date.parse(saved.created_at)<old.absence_confirmed_at||Date.parse(saved.created_at)>now||
        !Number.isFinite(Date.parse(saved.expires_at))||Date.parse(saved.expires_at)<=Date.parse(saved.created_at))throw new Error('OUTBOX_PAYLOAD_CORRUPT');
      event.created_at=saved.created_at;event.expires_at=saved.expires_at;
    }
    const payload=JSON.stringify(event);if(orphan!==undefined&&orphan!==payload)throw new Error('OUTBOX_PAYLOAD_CORRUPT');
    next.payload_bytes=new util.TextEncoder().encodeInto(payload).length;next.payload_hash=this.hash(payload);next.expires_at=Date.parse(event.expires_at);
    const retired=new MaterialRetiredEnvelope();retired.queue_id=old.queue_id;retired.event_id=old.event_id;retired.payload_hash=old.payload_hash;
    retired.payload_bytes=old.payload_bytes;retired.expires_at=old.expires_at;retired.absence_confirmed_at=old.absence_confirmed_at;
    next.history=[...old.history,retired];this.validate(next);
    if(rows.some((r:MaterialOutboxRow):boolean=>r.queue_id===next.queue_id||r.history.some((h:MaterialRetiredEnvelope):boolean=>h.queue_id===next.queue_id)))throw new Error('OUTBOX_EVENT_CONFLICT');
    if(this.accountedBytes(rows)+next.payload_bytes>67108864)throw new Error('OUTBOX_FULL');
    if(orphan===undefined)this.write(path,payload);rows[index]=next;this.publish(rows);return next;
  }
  private payload(row:MaterialOutboxRow):string{
    const path=this.root+'/'+row.queue_id+'.payload.json';
    if(!fs.accessSync(path)||fs.statSync(path).size!==row.payload_bytes)throw new Error('OUTBOX_PAYLOAD_CORRUPT');
    const text=fs.readTextSync(path);if(this.hash(text)!==row.payload_hash)throw new Error('OUTBOX_PAYLOAD_CORRUPT');return text;
  }
  claim(now:number,supportedVersions:string[]|undefined=undefined):MaterialOutboxClaim|undefined{
    if(!this.initialized)throw new Error('OUTBOX_NOT_INITIALIZED');
    if(!Number.isSafeInteger(now)||now<0)throw new Error('OUTBOX_TIME_INVALID');
    if(supportedVersions!==undefined&&(!Array.isArray(supportedVersions)||supportedVersions.length>16||supportedVersions.some((v:string):boolean=>typeof v!=='string'||v.length>16||!/^\d+\.\d+$/.test(v))))throw new Error('OUTBOX_SCHEMA_INVALID');
    const rows=this.all();if(rows.some((r:MaterialOutboxRow):boolean=>r.state==='sending'))return undefined;
    let changed=false;
    for(const row of rows.sort((a:MaterialOutboxRow,b:MaterialOutboxRow):number=>a.revision-b.revision)){
      if(!['queued','reconcile','retry_wait'].includes(row.state)||row.next_attempt_at>now)continue;
      if(row.revision>1&&!rows.some((r:MaterialOutboxRow):boolean=>r.material_id===row.material_id&&r.revision===row.revision-1&&r.state==='server_stored'))continue;
      if(!row.needs_lookup&&row.expires_at<=now){row.state='expired';row.last_error='EXPIRED';changed=true;continue;}
      let payload='',version='';
      try{
        if(!row.needs_lookup){
          payload=this.payload(row);const event=JSON.parse(payload) as WireMaterialEvent;
          if(!['1.1','1.2'].includes(event.schema_version))throw new Error('OUTBOX_PAYLOAD_CORRUPT');
          version=event.schema_version;
        }
      }catch{row.state='blocked';row.last_error='PAYLOAD_CORRUPT';changed=true;continue;}
      // No request was dispatched. Keep the exact envelope and its current
      // certainty; this is neither a lost ACK nor a server rejection.
      if(!row.needs_lookup&&supportedVersions!==undefined&&!supportedVersions.includes(version)){
        if(!Number.isSafeInteger(now+30000))throw new Error('OUTBOX_TIME_INVALID');
        row.last_error='SCHEMA_UNSUPPORTED';row.next_attempt_at=now+30000;changed=true;continue;
      }
      if(row.last_error==='SCHEMA_UNSUPPORTED')row.last_error='';
      row.state='sending';row.attempts++;const claim=new MaterialOutboxClaim();claim.queueId=row.queue_id;claim.attempt=row.attempts;
      claim.action=row.needs_lookup?'lookup':'send';claim.eventId=row.event_id;claim.payload=payload;claim.partitionId=this.partitionId;
      this.publish(rows);return claim;
    }
    if(changed)this.publish(rows);return undefined;
  }
  private validAck(row:MaterialOutboxRow,text:string):MaterialStoredAck|undefined{
    try{
      const ack=JSON.parse(text) as MaterialStoredAck,r=ack.receipt;
      const version=(JSON.parse(this.payload(row)) as WireMaterialEvent).schema_version;
      if(!['1.1','1.2'].includes(ack.schema_version)||ack.schema_version!==version||ack.event_id!==row.event_id||ack.material_id!==row.material_id||ack.revision!==row.revision||
        !Number.isSafeInteger(ack.commit_seq)||ack.commit_seq<1||typeof ack.stored_at!=='string'||ack.stored_at.length>64||!Number.isFinite(Date.parse(ack.stored_at))||
        !r||typeof r.receipt_id!=='string'||!r.receipt_id||r.receipt_id.length>512||r.subject_kind!=='material'||r.subject_id!==row.material_id||
        r.subject_revision!==row.revision||r.stage!=='server_stored'||r.actor_id!=='server-storage'||r.related_event_id!==row.event_id||r.error!==null)return undefined;
      return ack;
    }catch{return undefined;}
  }
  // status=0 means transport outcome unknown. Error text from platform/server is
  // never persisted; only controlled codes. A claim is consumed exactly once.
  finish(claim:MaterialOutboxClaim,status:number,body:string,now:number,jitter:number=0,retryAfterMs:number=0):boolean{
    if(!this.initialized||claim.partitionId!==this.partitionId)return false;
    if(!Number.isSafeInteger(now)||now<0||!Number.isInteger(status)||(status!==0&&(status<100||status>599))||
      !Number.isFinite(jitter)||jitter<0||jitter>1||!Number.isSafeInteger(retryAfterMs)||retryAfterMs<0)throw new Error('OUTBOX_RESULT_INVALID');
    const rows=this.all(),row=rows.find((r:MaterialOutboxRow):boolean=>r.queue_id===claim.queueId);
    if(!row||row.state!=='sending'||row.attempts!==claim.attempt||claim.action!==(row.needs_lookup?'lookup':'send'))return false;
    row.absence_confirmed_at=0;
    if(status===200||status===201){
      const ack=body.length<=16384?this.validAck(row,body):undefined;
      if(ack){row.state='server_stored';row.receipt_id=ack.receipt.receipt_id;row.server_commit_seq=ack.commit_seq;row.server_stored_at=ack.stored_at;row.last_error='';row.needs_lookup=false;}
      else{row.state='blocked';row.last_error='ACK_INVALID';row.needs_lookup=true;}
    }else if(status===404&&claim.action==='lookup'){
      row.needs_lookup=false;row.state=row.expires_at<=now?'expired':'queued';row.last_error=row.state==='expired'?'EXPIRED':'';row.next_attempt_at=0;
      if(row.state==='expired'&&this.confirmedAbsent(body)){row.absence_confirmed_at=now;row.last_error='EXPIRED_ABSENT';}
    }else if(status===0||status===429||status>=500&&status<=599){
      row.state='retry_wait';row.needs_lookup=true;row.last_error=status===0?'TRANSPORT_UNKNOWN':status===429?'RATE_LIMITED':'UNAVAILABLE';
      const delay=Math.max(Math.ceil(Math.min(30000,1000*Math.pow(2,Math.min(5,row.attempts-1)))*(1+0.2*jitter)),retryAfterMs);
      if(!Number.isSafeInteger(now+delay))throw new Error('OUTBOX_RESULT_INVALID');
      row.next_attempt_at=now+delay;
    }else{row.state=status===410?'expired':'blocked';row.last_error=status===401?'AUTH_REQUIRED':status===403?'FORBIDDEN':status===409?'CONFLICT':status===410?'EXPIRED':'REJECTED';}
    this.publish(rows);return true;
  }
  // Invoke only after explicit credential/config correction. Reconcile first,
  // including an invalid earlier ACK; never assume a blocked upload was absent.
  resumeBlocked(queueId:string=''):number{
    if(!this.initialized)throw new Error('OUTBOX_NOT_INITIALIZED');
    const rows=this.all();let changed=0;
    for(const row of rows)if((!queueId||row.queue_id===queueId)&&row.state==='blocked'&&row.last_error!=='PAYLOAD_CORRUPT'){
      row.state='reconcile';row.needs_lookup=true;row.next_attempt_at=0;row.last_error='';changed++;
    }
    if(changed)this.publish(rows);return changed;
  }
}
