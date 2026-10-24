import {canonical,sha,parseStrict,reject} from './json.mjs';

export const PART_BYTES=131072,MAX_MATERIAL_BYTES=8388608;
const HASH=/^[a-f0-9]{64}$/;
const isHash=value=>typeof value==='string'&&HASH.test(value);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
const encode=item=>Buffer.from(canonical(item));
/** Reserve an uncommitted envelope in the existing immutable event ledger.
 * The non-hash digest also makes older service versions reject late delivery.
 * This is not a material tombstone and never withdraws accepted source data. */
export function cancelMaterial(store,token,value){
  if(!exact(value,['event_id','idempotency_key','material_id','revision','payload_sha256','expires_at'])||
    ['event_id','idempotency_key','material_id'].some(k=>typeof value[k]!=='string'||!value[k]||value[k].length>512)||
    !Number.isSafeInteger(value.revision)||value.revision<1||!isHash(value.payload_sha256)||
    typeof value.expires_at!=='string'||!Number.isFinite(Date.parse(value.expires_at)))reject(400,'INVALID_MATERIAL_CANCELLATION');
  return store.tx(()=>{
    const p=store.auth(token,'materials:write'),digest='cancelled:'+sha(canonical(value));
    const prior=store.db.prepare('SELECT * FROM events WHERE owner=? AND producer=? AND idem=?').get(p.owner,p.producer,value.idempotency_key);
    if(prior){
      if(prior.event_id!==value.event_id)reject(409,'IDEMPOTENCY_CONFLICT');
      if((prior.digest.startsWith('cancelled:')?prior.digest!==digest:prior.digest!==value.payload_sha256))reject(409,'MATERIAL_CANCELLATION_CONFLICT');
      const result=JSON.parse(prior.response);
      if(result.material_id!==value.material_id||result.revision!==value.revision)reject(409,'MATERIAL_CANCELLATION_CONFLICT');
      return result;
    }
    if(store.db.prepare('SELECT 1 FROM events WHERE owner=? AND event_id=?').get(p.owner,value.event_id))reject(409,'EVENT_ID_CONFLICT');
    const result={schema_version:'1.0',state:'cancelled',...value,owner_id:p.owner,producer_id:p.producer,
      server_id:store.db.prepare("SELECT value FROM meta WHERE key='server_id'").get().value,cancelled_at:new Date(store.clock()).toISOString()};
    store.db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?)').run(p.owner,p.producer,value.idempotency_key,value.event_id,digest,canonical(result),Date.parse(value.expires_at));
    store.db.prepare('DELETE FROM material_uploads WHERE owner=? AND producer=? AND hash=? AND event_id=?').run(p.owner,p.producer,value.payload_sha256,value.event_id);
    return result;
  });
}
export function materialWire(item,mode){
  const bytes=encode(item);
  if(mode==='reference'&&bytes.length>262144)return {content_ref:{material_id:item.body.material_id,revision:item.body.revision,
    bytes:bytes.length,sha256:sha(bytes),part_bytes:PART_BYTES,parts:Math.ceil(bytes.length/PART_BYTES)}};
  if(bytes.length>1040384)reject(413,'MATERIAL_CONTENT_REQUIRED');
  return item;
}

/** Transfer fragments are private, bounded staging, never material revisions.
 * Only the existing revision transaction may issue a server_stored receipt. */
export class MaterialTransfer {
  constructor(store){this.store=store;this.db=store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS material_uploads(
      owner TEXT NOT NULL,producer TEXT NOT NULL,hash TEXT NOT NULL,event_id TEXT NOT NULL,
      bytes INTEGER NOT NULL,expires INTEGER NOT NULL,receipt TEXT,
      PRIMARY KEY(owner,producer,hash)) STRICT;
      CREATE TABLE IF NOT EXISTS material_parts(
      owner TEXT NOT NULL,producer TEXT NOT NULL,hash TEXT NOT NULL,part INTEGER NOT NULL,data BLOB NOT NULL,
      PRIMARY KEY(owner,producer,hash,part),
      FOREIGN KEY(owner,producer,hash) REFERENCES material_uploads(owner,producer,hash) ON DELETE CASCADE) STRICT;`);
  }
  principal(token){return this.store.auth(token,'materials:write');}
  row(p,hash){
    if(!isHash(hash))reject(400,'INVALID_UPLOAD');
    const row=this.db.prepare('SELECT * FROM material_uploads WHERE owner=? AND producer=? AND hash=?').get(p.owner,p.producer,hash);
    if(!row)reject(404,'UPLOAD_NOT_FOUND');
    if(row.expires<=this.store.clock())reject(410,'UPLOAD_EXPIRED');
    return row;
  }
  statusRow(row){return {upload_id:row.hash,bytes:row.bytes,part_bytes:PART_BYTES,parts:Math.ceil(row.bytes/PART_BYTES),
    expires_at:new Date(row.expires).toISOString(),received:this.db.prepare('SELECT part FROM material_parts WHERE owner=? AND producer=? AND hash=? ORDER BY part').all(row.owner,row.producer,row.hash).map(r=>r.part),
    receipt:row.receipt?JSON.parse(row.receipt):null};}
  begin(token,value){
    const p=this.principal(token);
    if(!exact(value,['event_id','bytes','sha256'])||typeof value.event_id!=='string'||!value.event_id||value.event_id.length>512||
      !isHash(value.sha256)||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>MAX_MATERIAL_BYTES)reject(400,'INVALID_UPLOAD');
    return this.store.tx(()=>{
      const cancelled=this.db.prepare('SELECT digest FROM events WHERE owner=? AND producer=? AND event_id=?').get(p.owner,p.producer,value.event_id);
      if(cancelled?.digest.startsWith('cancelled:'))reject(409,'MATERIAL_EVENT_CANCELLED');
      this.db.prepare('DELETE FROM material_uploads WHERE expires<=?').run(this.store.clock());
      const prior=this.db.prepare('SELECT * FROM material_uploads WHERE owner=? AND producer=? AND hash=?').get(p.owner,p.producer,value.sha256);
      if(prior){if(prior.event_id!==value.event_id||prior.bytes!==value.bytes)reject(409,'UPLOAD_CONFLICT');return this.statusRow(prior);}
      const used=this.db.prepare('SELECT COUNT(*) count,COALESCE(SUM(bytes),0) bytes FROM material_uploads WHERE owner=? AND receipt IS NULL').get(p.owner);
      if(used.count>=16||used.bytes+value.bytes>67108864)reject(429,'UPLOAD_BUDGET');
      this.db.prepare('INSERT INTO material_uploads VALUES (?,?,?,?,?,?,NULL)').run(p.owner,p.producer,value.sha256,value.event_id,value.bytes,this.store.clock()+86400000);
      return this.statusRow(this.row(p,value.sha256));
    });
  }
  status(token,hash){return this.statusRow(this.row(this.principal(token),hash));}
  put(token,hash,index,value){
    const p=this.principal(token);
    return this.store.tx(()=>{
      const row=this.row(p,hash),parts=Math.ceil(row.bytes/PART_BYTES);
      if(!Number.isSafeInteger(index)||index<0||index>=parts||!exact(value,['data','sha256'])||!isHash(value.sha256)||
        typeof value.data!=='string'||value.data.length>Math.ceil(PART_BYTES/3)*4)reject(400,'INVALID_UPLOAD_PART');
      const bytes=Buffer.from(value.data,'base64');
      if(bytes.toString('base64')!==value.data||bytes.length!==Math.min(PART_BYTES,row.bytes-index*PART_BYTES)||sha(bytes)!==value.sha256)reject(400,'INVALID_UPLOAD_PART');
      if(row.receipt)return this.statusRow(row);
      const prior=this.db.prepare('SELECT data FROM material_parts WHERE owner=? AND producer=? AND hash=? AND part=?').get(p.owner,p.producer,hash,index);
      if(prior&&!Buffer.from(prior.data).equals(bytes))reject(409,'UPLOAD_PART_CONFLICT');
      if(!prior)this.db.prepare('INSERT INTO material_parts VALUES (?,?,?,?,?)').run(p.owner,p.producer,hash,index,bytes);
      return this.statusRow(row);
    });
  }
  finalize(token,hash){
    const p=this.principal(token),row=this.row(p,hash);
    if(row.receipt)return {status:200,body:JSON.parse(row.receipt)};
    const parts=this.db.prepare('SELECT part,data FROM material_parts WHERE owner=? AND producer=? AND hash=? ORDER BY part').all(p.owner,p.producer,hash);
    if(parts.length!==Math.ceil(row.bytes/PART_BYTES)||parts.some((r,i)=>r.part!==i))reject(409,'UPLOAD_INCOMPLETE');
    const bytes=Buffer.concat(parts.map(r=>Buffer.from(r.data)));
    if(bytes.length!==row.bytes||sha(bytes)!==hash)reject(409,'UPLOAD_HASH_MISMATCH');
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{reject(400,'INVALID_UNICODE');}
    const event=parseStrict(text);
    if(!event||typeof event!=='object'||Array.isArray(event)||event.event_id!==row.event_id)reject(409,'UPLOAD_EVENT_MISMATCH');
    // Same CAS, deadline, producer, schema and idempotency validation as a small event.
    // A crash after submit but before staging cleanup retries that immutable event.
    const result=this.store.submitAssembled(token,event);
    this.store.tx(()=>{
      this.db.prepare('UPDATE material_uploads SET receipt=? WHERE owner=? AND producer=? AND hash=?').run(canonical(result.body),p.owner,p.producer,hash);
      this.db.prepare('DELETE FROM material_parts WHERE owner=? AND producer=? AND hash=?').run(p.owner,p.producer,hash);
    });
    return result;
  }
  content(token,id,revision,index){
    const p=this.store.auth(token),scopes=JSON.parse(p.scopes);
    if(!scopes.includes('materials:read')&&!scopes.includes('changes:read'))reject(403,'FORBIDDEN');
    if(!Number.isSafeInteger(revision)||revision<1||!Number.isSafeInteger(index)||index<0)reject(400,'INVALID_QUERY');
    const head=this.db.prepare('SELECT deleted FROM materials WHERE owner=? AND id=?').get(p.owner,id);
    if(!head)reject(404,'MATERIAL_NOT_FOUND');if(head.deleted)reject(410,'MATERIAL_DELETED');
    const row=this.db.prepare('SELECT * FROM revisions WHERE owner=? AND id=? AND revision=?').get(p.owner,id,revision);
    if(!row)reject(404,'MATERIAL_NOT_FOUND');
    const bytes=encode(this.store.item(row)),parts=Math.ceil(bytes.length/PART_BYTES);
    if(index>=parts)reject(400,'INVALID_QUERY');
    const block=bytes.subarray(index*PART_BYTES,(index+1)*PART_BYTES);
    return {material_id:id,revision,index,parts,bytes:bytes.length,sha256:sha(bytes),part_sha256:sha(block),data:block.toString('base64')};
  }
}
