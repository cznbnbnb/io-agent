import {canonical,sha,parseStrict,reject} from './json.mjs';

export const PART_BYTES=131072,MAX_MATERIAL_BYTES=8388608;
const HASH=/^[a-f0-9]{64}$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
const encode=item=>Buffer.from(canonical(item));
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
    if(!HASH.test(hash))reject(400,'INVALID_UPLOAD');
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
      !HASH.test(value.sha256)||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>MAX_MATERIAL_BYTES)reject(400,'INVALID_UPLOAD');
    return this.store.tx(()=>{
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
      if(!Number.isSafeInteger(index)||index<0||index>=parts||!exact(value,['data','sha256'])||!HASH.test(value.sha256)||
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
