import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {canonical,sha,reject} from './json.mjs';

export const AUDIO_PART_BYTES=131072,AUDIO_MAX_BYTES=536870912,AUDIO_RETENTION_MS=72*3600000;
const UPLOAD_MS=24*3600000,APP_ID=0x694f4175,HASH=/^[a-f0-9]{64}$/;
const iso=n=>new Date(n).toISOString();
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join()===keys.toSorted().join();
const time=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));

/** Separate payload database: ordinary text backups never contain original audio.
 * A storage receipt proves bytes/ownership, not recording completeness or codec. */
export class AudioArchive {
  constructor(store,file){
    this.store=store;
    if(file!==':memory:'){
      file=path.join(fs.realpathSync(path.dirname(file)),path.basename(file));
      for(const name of [file,file+'-journal',file+'-wal',file+'-shm'])if(fs.existsSync(name)&&fs.lstatSync(name).isSymbolicLink())throw Error('AUDIO_DATABASE_PATH');
      if(!fs.existsSync(file)){const fd=fs.openSync(file,'wx',0o600);fs.closeSync(fd);}
    }
    this.db=new DatabaseSync(file);
    try{
      const app=this.db.prepare('PRAGMA application_id').get().application_id,version=this.db.prepare('PRAGMA user_version').get().user_version;
      const server=store.db.prepare("SELECT value FROM meta WHERE key='server_id'").get().value;
      if(app===0&&version===0&&!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table'").get()){
        this.db.exec(`BEGIN IMMEDIATE; PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;
          CREATE TABLE binding(server_id TEXT NOT NULL) STRICT;
          CREATE TABLE audio_objects(object_id TEXT PRIMARY KEY,owner TEXT NOT NULL,producer TEXT NOT NULL,
            material_id TEXT NOT NULL,material_revision INTEGER NOT NULL,source_body_sha TEXT NOT NULL,
            manifest TEXT NOT NULL,bytes INTEGER NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL,
            upload_expires INTEGER NOT NULL,stored_at INTEGER,expires INTEGER) STRICT;
          CREATE INDEX audio_expiry ON audio_objects(state,expires);
          CREATE INDEX audio_owner ON audio_objects(owner,material_id);
          CREATE TABLE audio_parts(object_id TEXT NOT NULL,part INTEGER NOT NULL,hash TEXT NOT NULL,data BLOB NOT NULL,
            PRIMARY KEY(object_id,part),FOREIGN KEY(object_id) REFERENCES audio_objects(object_id) ON DELETE CASCADE) STRICT;`);
        this.db.prepare('INSERT INTO binding VALUES (?)').run(server);this.db.exec('COMMIT');
      }else if(app!==APP_ID||version!==1)throw Error('AUDIO_DATABASE_UNRECOGNIZED');
      if(this.db.prepare('SELECT server_id FROM binding').get()?.server_id!==server)throw Error('AUDIO_SERVER_MISMATCH');
      // DELETE avoids a long-lived WAL copy. Secure-delete clears freed payload
      // cells; no promise about filesystem snapshots or forensic disk erasure.
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
    }catch(e){this.db.close();throw e;}
  }
  close(){this.db.close();}
  // Always lock the text database first. Deletion cannot race a read or commit;
  // only the audio database mutates, so no cross-database commit is required.
  tx(fn){return this.store.tx(()=>{this.db.exec('BEGIN IMMEDIATE');try{const v=fn();this.db.exec('COMMIT');return v;}catch(e){this.db.exec('ROLLBACK');throw e;}});}
  head(owner,id){const row=this.store.db.prepare('SELECT * FROM materials WHERE owner=? AND id=?').get(owner,id);if(!row)reject(404,'MATERIAL_NOT_FOUND');if(row.deleted)reject(410,'MATERIAL_DELETED');return row;}
  principal(token,scope){return this.store.auth(token,scope);}
  row(p,id,write=false){
    if(typeof id!=='string'||!HASH.test(id))reject(400,'INVALID_AUDIO_OBJECT');
    const row=this.db.prepare('SELECT * FROM audio_objects WHERE owner=? AND object_id=?').get(p.owner,id);
    if(!row||write&&row.producer!==p.producer)reject(404,'AUDIO_NOT_FOUND');
    this.head(p.owner,row.material_id);
    if(row.state==='expired'||row.expires!==null&&row.expires<=this.store.clock())reject(410,'AUDIO_EXPIRED');
    if(row.state==='withdrawn')reject(410,'MATERIAL_DELETED');
    return row;
  }
  view(row){return {schema_version:'1.0',object_id:row.object_id,owner_id:row.owner,producer_id:row.producer,
    material_id:row.material_id,material_revision:row.material_revision,source_body_sha256:row.source_body_sha,
    ...JSON.parse(row.manifest),state:row.state,part_bytes:AUDIO_PART_BYTES,parts:Math.ceil(row.bytes/AUDIO_PART_BYTES),
    stored_at:row.stored_at===null?null:iso(row.stored_at),expires_at:row.expires===null?null:iso(row.expires),retention_seconds:259200,
    storage_verified:row.state==='stored',recording_completeness_verified:false};}
  statusRow(row){return {...this.view(row),upload_expires_at:iso(row.upload_expires),received:this.db.prepare('SELECT part FROM audio_parts WHERE object_id=? ORDER BY part').all(row.object_id).map(r=>r.part)};}
  begin(token,value){
    const p=this.principal(token,'audio:write');
    if(!exact(value,['material_id','material_revision','kind','media_type','bytes','sha256','capture'])||
      typeof value.material_id!=='string'||!value.material_id||value.material_id.length>512||
      !Number.isSafeInteger(value.material_revision)||value.material_revision<1||!HASH.test(value.sha256??'')||typeof value.sha256!=='string'||
      !Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>AUDIO_MAX_BYTES||
      !['raw','playable'].includes(value.kind)||value.media_type!==({raw:'application/vnd.turboio.lifelog-archive',playable:'audio/ogg'})[value.kind]||
      !exact(value.capture,['first_received_at','last_received_at','recording_complete'])||!time(value.capture.first_received_at)||!time(value.capture.last_received_at)||
      Date.parse(value.capture.first_received_at)>Date.parse(value.capture.last_received_at)||typeof value.capture.recording_complete!=='boolean')reject(400,'INVALID_AUDIO_MANIFEST');
    return this.tx(()=>{
      this.head(p.owner,value.material_id);
      const source=this.store.db.prepare('SELECT body_hash FROM revisions WHERE owner=? AND id=? AND revision=?').get(p.owner,value.material_id,value.material_revision);
      if(!source)reject(404,'MATERIAL_NOT_FOUND');
      const id=sha(canonical({owner:p.owner,material_id:value.material_id,kind:value.kind,sha256:value.sha256}));
      let prior=this.db.prepare('SELECT * FROM audio_objects WHERE object_id=?').get(id);
      if(prior){
        if(prior.producer!==p.producer)reject(409,'AUDIO_PRODUCER_CONFLICT');
        if(prior.manifest!==canonical(value))reject(409,'AUDIO_MANIFEST_CONFLICT');
        if(prior.stored_at!==null){this.row(p,id,true);return this.statusRow(prior);}
      }
      this.pruneLocked();
      prior=this.db.prepare('SELECT * FROM audio_objects WHERE object_id=?').get(id);
      if(prior&&prior.state==='uploading')return this.statusRow(prior);
      const owner=this.db.prepare("SELECT COUNT(*) n,COALESCE(SUM(bytes),0) bytes FROM audio_objects WHERE owner=? AND state IN ('uploading','stored')").get(p.owner);
      const global=this.db.prepare("SELECT COUNT(*) n,COALESCE(SUM(bytes),0) bytes FROM audio_objects WHERE state IN ('uploading','stored')").get();
      if(owner.n>=128||owner.bytes+value.bytes>2147483648||global.n>=8192||global.bytes+value.bytes>10737418240)reject(429,'AUDIO_BUDGET');
      if(prior)this.db.prepare("UPDATE audio_objects SET state='uploading',upload_expires=? WHERE object_id=?").run(this.store.clock()+UPLOAD_MS,id);
      else this.db.prepare('INSERT INTO audio_objects VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(id,p.owner,p.producer,value.material_id,value.material_revision,source.body_hash,canonical(value),value.bytes,value.sha256,'uploading',this.store.clock()+UPLOAD_MS);
      return this.statusRow(this.row(p,id,true));
    });
  }
  status(token,id){return this.tx(()=>{const row=this.row(this.principal(token,'audio:write'),id,true);if(row.state==='abandoned'||row.state==='uploading'&&row.upload_expires<=this.store.clock())reject(410,'AUDIO_UPLOAD_EXPIRED');return this.statusRow(row);});}
  put(token,id,index,value){return this.tx(()=>{
    const row=this.row(this.principal(token,'audio:write'),id,true);
    if(row.state==='abandoned'||row.state==='uploading'&&row.upload_expires<=this.store.clock())reject(410,'AUDIO_UPLOAD_EXPIRED');
    if(!Number.isSafeInteger(index)||index<0||index>=Math.ceil(row.bytes/AUDIO_PART_BYTES)||!exact(value,['data','sha256'])||
      typeof value.sha256!=='string'||!HASH.test(value.sha256)||typeof value.data!=='string'||value.data.length>Math.ceil(AUDIO_PART_BYTES/3)*4)reject(400,'INVALID_AUDIO_PART');
    const bytes=Buffer.from(value.data,'base64');
    if(bytes.toString('base64')!==value.data||bytes.length!==Math.min(AUDIO_PART_BYTES,row.bytes-index*AUDIO_PART_BYTES)||sha(bytes)!==value.sha256)reject(400,'INVALID_AUDIO_PART');
    const prior=this.db.prepare('SELECT hash FROM audio_parts WHERE object_id=? AND part=?').get(id,index);
    if(prior&&prior.hash!==value.sha256)reject(409,'AUDIO_PART_CONFLICT');
    if(!prior&&row.state==='uploading')this.db.prepare('INSERT INTO audio_parts VALUES (?,?,?,?)').run(id,index,value.sha256,bytes);
    return this.statusRow(row);
  });}
  finalize(token,id){return this.tx(()=>{
    const row=this.row(this.principal(token,'audio:write'),id,true);
    if(row.state==='stored')return this.view(row);
    if(row.state!=='uploading'||row.upload_expires<=this.store.clock())reject(410,'AUDIO_UPLOAD_EXPIRED');
    const digest=createHash('sha256');let index=0,total=0;
    for(const part of this.db.prepare('SELECT part,hash,data FROM audio_parts WHERE object_id=? ORDER BY part').iterate(id)){
      if(part.part!==index++)reject(409,'AUDIO_INCOMPLETE');const bytes=Buffer.from(part.data);
      if(bytes.length!==Math.min(AUDIO_PART_BYTES,row.bytes-part.part*AUDIO_PART_BYTES)||sha(bytes)!==part.hash)reject(409,'AUDIO_PART_CORRUPT');
      digest.update(bytes);total+=bytes.length;
    }
    if(index!==Math.ceil(row.bytes/AUDIO_PART_BYTES)||total!==row.bytes)reject(409,'AUDIO_INCOMPLETE');
    if(digest.digest('hex')!==row.hash)reject(409,'AUDIO_HASH_MISMATCH');
    const now=this.store.clock();this.db.prepare("UPDATE audio_objects SET state='stored',stored_at=?,expires=? WHERE object_id=?").run(now,now+AUDIO_RETENTION_MS,id);
    return this.view(this.row({owner:row.owner,producer:row.producer},id,true));
  });}
  get(token,id){return this.tx(()=>{
    const row=this.row(this.principal(token,'audio:read'),id);if(row.state!=='stored')reject(409,'AUDIO_NOT_STORED');return this.view(row);
  });}
  list(token,material,{after=null,limit=50}={}){return this.tx(()=>{
    const p=this.principal(token,'audio:read');this.head(p.owner,material);
    if(after!==null&&(typeof after!=='string'||!HASH.test(after))||!Number.isSafeInteger(limit)||limit<1||limit>100)reject(400,'INVALID_QUERY');
    const rows=this.db.prepare("SELECT * FROM audio_objects WHERE owner=? AND material_id=? AND stored_at IS NOT NULL AND object_id>? ORDER BY object_id LIMIT ?").all(p.owner,material,after??'',limit+1);
    return {material_id:material,objects:rows.slice(0,limit).map(r=>this.view({...r,state:r.expires<=this.store.clock()?'expired':r.state})),next_after:rows.length>limit?rows[limit-1].object_id:null};
  });}
  content(token,id,index){return this.tx(()=>{
    const row=this.row(this.principal(token,'audio:read'),id);if(row.state!=='stored')reject(409,'AUDIO_NOT_STORED');
    if(!Number.isSafeInteger(index)||index<0||index>=Math.ceil(row.bytes/AUDIO_PART_BYTES))reject(400,'INVALID_QUERY');
    const block=this.db.prepare('SELECT hash,data FROM audio_parts WHERE object_id=? AND part=?').get(id,index);
    if(!block||sha(Buffer.from(block.data))!==block.hash)reject(409,'AUDIO_PART_CORRUPT');
    return {object_id:id,index,bytes:row.bytes,sha256:row.hash,part_sha256:block.hash,expires_at:iso(row.expires),data:Buffer.from(block.data).toString('base64')};
  });}
  pruneLocked(){
    const now=this.store.clock();let objects=0,parts=0;
    const expire=(row,state)=>{parts+=this.db.prepare('DELETE FROM audio_parts WHERE object_id=?').run(row.object_id).changes;this.db.prepare('UPDATE audio_objects SET state=? WHERE object_id=?').run(state,row.object_id);objects++;};
    for(const row of this.db.prepare("SELECT object_id,state FROM audio_objects WHERE (state='stored' AND expires<=?) OR (state='uploading' AND upload_expires<=?)").all(now,now))expire(row,row.state==='stored'?'expired':'abandoned');
    for(const row of this.db.prepare("SELECT object_id,owner,material_id FROM audio_objects WHERE state IN ('uploading','stored')").all()){
      const head=this.store.db.prepare('SELECT deleted FROM materials WHERE owner=? AND id=?').get(row.owner,row.material_id);if(head?.deleted)expire(row,'withdrawn'); // Absence is not an authoritative deletion.
    }
    return {objects,parts,at:iso(now)};
  }
  prune(){return this.tx(()=>this.pruneLocked());}
}
