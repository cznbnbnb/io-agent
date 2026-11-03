import {randomInt,randomUUID} from 'node:crypto';
import {sha,reject} from './json.mjs';

// One-time device pairing (2026-10-24, user: the phone pairs once, computers register once, and
// credentials renew in the background instead of importing a new connection file per session).
// A device keeps a stable producer id across renewals; revoking the device revokes all its tokens.
const iso=n=>new Date(n).toISOString();
export const DEVICE_TTL_MS=86400000;
const PAIR_CODE_MS=600000,REFRESH_GRACE_MS=300000,FAILURE_WINDOW_MS=600000,FAILURE_LIMIT=30;
const ROLE_SCOPES={
  phone:['materials:write','materials:read','tasks:write','tasks:read','tasks:update','requests:read','answers:write','messages:receive','receipts:phone'],
  agent:['lifelog:read','lifelog:correct','tasks:write','tasks:read','tasks:update','requests:write','messages:receive','messages:write','receipts:agent','devices:pair','daily-summaries:read']};
// Crockford-style alphabet without 0/O/1/I/L/U: 10 characters ≈ 50 bits, shown as XXXXX-XXXXX.
const ALPHABET='23456789ABCDEFGHJKMNPQRSTVWXYZ';
const label=s=>typeof s==='string'&&s.length>=1&&s.length<=64&&!/[\u0000-\u001f\u007f]/.test(s)&&s.trim()===s;
const normalizeCode=s=>typeof s==='string'?s.toUpperCase().replace(/[\s-]/g,''):'';

export class DeviceRegistry {
  constructor(store){
    this.store=store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS devices(device_id TEXT PRIMARY KEY,owner TEXT NOT NULL,role TEXT NOT NULL,
        producer TEXT UNIQUE NOT NULL,label TEXT NOT NULL,created_at INTEGER NOT NULL,refreshed_at INTEGER,revoked_at INTEGER) STRICT;
      CREATE TABLE IF NOT EXISTS device_tokens(token_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,replaced_by TEXT) STRICT;
      CREATE TABLE IF NOT EXISTS pairings(code_digest TEXT PRIMARY KEY,owner TEXT NOT NULL,role TEXT NOT NULL,label TEXT NOT NULL,
        created_by TEXT,expires INTEGER NOT NULL,used_at INTEGER) STRICT;
      CREATE TABLE IF NOT EXISTS pair_failures(window_start INTEGER PRIMARY KEY,count INTEGER NOT NULL) STRICT;`);
  }
  get db(){return this.store.db;}
  now(){return this.store.clock();}
  serverId(){return this.db.prepare("SELECT value FROM meta WHERE key='server_id'").get().value;}
  // Administrator bootstrap (local CLI only) and pairing both end here.
  enroll({owner,role,label:name}){
    if(typeof owner!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(owner)||!ROLE_SCOPES[role]||!label(name))reject(400,'INVALID_DEVICE');
    const deviceId=randomUUID(),producer=role+'-'+deviceId.slice(0,8);
    this.db.prepare('INSERT INTO devices(device_id,owner,role,producer,label,created_at) VALUES (?,?,?,?,?,?)').run(deviceId,owner,role,producer,name,this.now());
    return this.issue(deviceId);
  }
  issue(deviceId){
    const d=this.db.prepare('SELECT * FROM devices WHERE device_id=?').get(deviceId);
    const minted=this.store.mint({owner:d.owner,producer:d.producer,scopes:ROLE_SCOPES[d.role],ttlMs:DEVICE_TTL_MS});
    this.db.prepare('INSERT INTO device_tokens(token_id,device_id) VALUES (?,?)').run(minted.token_id,deviceId);
    return {...minted,device_id:deviceId,role:d.role,label:d.label,owner_id:d.owner,producer_id:d.producer,server_id:this.serverId(),
      scopes:ROLE_SCOPES[d.role],refresh_after:iso(Date.parse(minted.expires_at)-DEVICE_TTL_MS/2)};
  }
  device(principal){
    const row=this.db.prepare('SELECT d.* FROM device_tokens t JOIN devices d ON d.device_id=t.device_id WHERE t.token_id=?').get(principal.token_id);
    if(!row||row.revoked_at!==null)reject(403,'DEVICE_REQUIRED');return row;
  }
  createPairing(token,input){
    const p=this.store.auth(token,'devices:pair'),creator=this.device(p);
    if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['role','label'].includes(k))||input.role!=='phone'||!label(input.label))reject(400,'INVALID_PAIRING');
    let code='';for(let i=0;i<10;i++)code+=ALPHABET[randomInt(ALPHABET.length)];
    const expires=this.now()+PAIR_CODE_MS;
    this.db.prepare('INSERT INTO pairings VALUES (?,?,?,?,?,?,NULL)').run(sha(code),p.owner,input.role,input.label,creator.device_id,expires);
    return {code:code.slice(0,5)+'-'+code.slice(5),role:input.role,label:input.label,expires_at:iso(expires),server_id:this.serverId()};
  }
  // Unauthenticated: the one-time code is the only secret. Wrong codes count against one global
  // window so the 50-bit code cannot be guessed online.
  pair(input){
    return this.store.tx(()=>{
      const now=this.now(),window=now-now%FAILURE_WINDOW_MS;
      const failures=this.db.prepare('SELECT count FROM pair_failures WHERE window_start=?').get(window)?.count??0;
      if(failures>=FAILURE_LIMIT)reject(429,'PAIRING_RATE_LIMITED');
      const code=normalizeCode(input?.code);
      const valid=input&&typeof input==='object'&&Object.keys(input).every(k=>['code','account_binding'].includes(k))&&new RegExp('^['+ALPHABET+']{10}$').test(code);
      const row=valid?this.db.prepare('SELECT * FROM pairings WHERE code_digest=?').get(sha(code)):null;
      if(!row||row.used_at!==null||row.expires<=now){
        this.db.prepare('INSERT INTO pair_failures VALUES (?,1) ON CONFLICT(window_start) DO UPDATE SET count=count+1').run(window);
        this.db.prepare('DELETE FROM pair_failures WHERE window_start<?').run(window);
        return null; // committed before rejecting, so the failure counts
      }
      this.db.prepare('UPDATE pairings SET used_at=? WHERE code_digest=?').run(now,row.code_digest);
      const issued=this.enroll({owner:row.owner,role:row.role,label:row.label});
      if(input.account_binding!==undefined)this.store.phones.account({owner:row.owner,device_id:issued.device_id},input.account_binding);
      return issued;
    })??reject(400,'PAIRING_CODE_INVALID');
  }
  // The old token stays valid for a short grace so in-flight requests finish; it renews only once,
  // so two processes sharing one credential file cannot fork the device into two token chains.
  refresh(token){
    return this.store.tx(()=>{
      const p=this.store.auth(token),d=this.device(p);
      const link=this.db.prepare('SELECT replaced_by FROM device_tokens WHERE token_id=?').get(p.token_id);
      if(link.replaced_by)reject(409,'CREDENTIAL_ALREADY_REFRESHED');
      const next=this.issue(d.device_id),now=this.now();
      this.db.prepare('UPDATE device_tokens SET replaced_by=? WHERE token_id=?').run(next.token_id,p.token_id);
      this.db.prepare('UPDATE credentials SET expires=MIN(expires,?) WHERE token_id=?').run(now+REFRESH_GRACE_MS,p.token_id);
      this.db.prepare('UPDATE devices SET refreshed_at=? WHERE device_id=?').run(now,d.device_id);
      return next;
    });
  }
  view(d){return {device_id:d.device_id,role:d.role,label:d.label,producer_id:d.producer,created_at:iso(d.created_at),
    refreshed_at:d.refreshed_at===null?null:iso(d.refreshed_at),revoked:d.revoked_at!==null};}
  list(token){const p=this.store.auth(token,'devices:pair');this.device(p);return {devices:this.listOwner(p.owner)};}
  listOwner(owner){return this.db.prepare('SELECT * FROM devices WHERE owner=? ORDER BY created_at').all(owner).map(d=>this.view(d));}
  // A device may unpair itself; a computer (devices:pair) may unpair any device of the same owner.
  revokeBy(token,deviceId){
    const p=this.store.auth(token),self=this.device(p);
    if(deviceId!==self.device_id&&!JSON.parse(p.scopes).includes('devices:pair'))reject(403,'FORBIDDEN');
    const d=this.db.prepare('SELECT * FROM devices WHERE device_id=? AND owner=?').get(deviceId,p.owner);if(!d)reject(404,'DEVICE_NOT_FOUND');
    return this.revoke(deviceId);
  }
  revoke(deviceId){return this.store.tx(()=>this.revokeInTransaction(deviceId));}
  revokeInTransaction(deviceId){
      const d=this.db.prepare('SELECT * FROM devices WHERE device_id=?').get(deviceId);if(!d)reject(404,'DEVICE_NOT_FOUND');
      if(d.revoked_at===null)this.db.prepare('UPDATE devices SET revoked_at=? WHERE device_id=?').run(this.now(),deviceId);
      this.db.prepare('UPDATE credentials SET revoked=1 WHERE token_id IN (SELECT token_id FROM device_tokens WHERE device_id=?)').run(deviceId);
      if(d.role==='phone'){this.db.prepare('UPDATE credentials SET revoked=1 WHERE token_id IN (SELECT t.token_id FROM material_pairing_tokens t JOIN material_pairings p ON p.pairing_id=t.pairing_id WHERE p.owner=? AND p.producer=?)').run(d.owner,d.producer);this.db.prepare('UPDATE material_pairings SET revoked_at=COALESCE(revoked_at,?) WHERE owner=? AND producer=?').run(this.now(),d.owner,d.producer);}
      this.store.pendingInboxOwners.add(d.owner);
      return this.view(this.db.prepare('SELECT * FROM devices WHERE device_id=?').get(deviceId));
  }
}
