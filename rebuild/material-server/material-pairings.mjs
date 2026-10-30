import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {sha,reject} from './json.mjs';
const DAY=86400000,iso=n=>new Date(n).toISOString();
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(s);
// A separately revocable, account-bound material pairing. Only local authenticated administration
// may enroll it. An already authorized phone can recover its owner's existing
// account space. A refresh secret never grants task, audio, or general API access.
// Stable secret + deterministic current access token makes lost replies/retries safe, even after
// weeks offline. Neither secret nor access token is stored plaintext in the database.
export class MaterialPairings {
 constructor(store){this.store=store;store.db.exec(`
 CREATE TABLE IF NOT EXISTS material_pairings(pairing_id TEXT PRIMARY KEY,owner TEXT NOT NULL,producer TEXT NOT NULL,
 account TEXT NOT NULL,digest TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL,revoked_at INTEGER) STRICT;
 CREATE TABLE IF NOT EXISTS material_pairing_tokens(token_id TEXT PRIMARY KEY,pairing_id TEXT NOT NULL) STRICT;`);}
 get db(){return this.store.db;}
 recover(token,input){
  const principal=this.store.auth(token,'receipts:phone'),phone=this.store.devices.device(principal);
  if(phone.role!=='phone'||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||
   !/^[a-f0-9]{64}$/.test(input.account_binding??'')||typeof input.refresh_secret!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.refresh_secret))reject(400,'MATERIAL_RECOVERY_INVALID');
  return this.store.tx(()=>{
   const account=this.db.prepare('SELECT account FROM phone_accounts WHERE device_id=? AND owner=?').get(phone.device_id,phone.owner);
   if(!account||account.account!==input.account_binding)reject(409,'PHONE_ACCOUNT_MISMATCH');
   if(!this.db.prepare('SELECT 1 FROM material_pairings WHERE owner=? AND account=? AND revoked_at IS NULL').get(phone.owner,account.account))reject(404,'MATERIAL_SPACE_UNAVAILABLE');
   let row=this.db.prepare('SELECT * FROM material_pairings WHERE owner=? AND producer=? AND account=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(phone.owner,phone.producer,account.account);
   if(row){if(row.revoked_at!==null)reject(403,'MATERIAL_PAIRING_REVOKED');if(row.digest!==sha(input.refresh_secret))reject(409,'MATERIAL_RECOVERY_CHANGED');}
   else{const pairing=randomUUID();this.db.prepare('INSERT INTO material_pairings VALUES (?,?,?,?,?,?,NULL)').run(pairing,phone.owner,phone.producer,account.account,sha(input.refresh_secret),this.store.clock());row=this.db.prepare('SELECT * FROM material_pairings WHERE pairing_id=?').get(pairing);}
   return this.issue(row,input.refresh_secret);
  });
 }
 enroll({owner,producer,account}){
  if(!id(owner)||!id(producer)||typeof account!=='string'||! /^[a-f0-9]{64}$/.test(account))reject(400,'INVALID_MATERIAL_PAIRING');
  const secret=randomBytes(32).toString('base64url'),pairing=randomUUID();
  return this.store.tx(()=>{
   this.db.prepare('INSERT INTO material_pairings VALUES (?,?,?,?,?,?,NULL)').run(pairing,owner,producer,account,sha(secret),this.store.clock());
   const d=this.db.prepare('SELECT * FROM material_pairings WHERE pairing_id=?').get(pairing);
   return {...this.issue(d,secret),refresh_secret:secret};
  });
 }
 principal(secret,input){
  if(typeof secret!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(secret)||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||!id(input.pairing_id)||! /^[a-f0-9]{64}$/.test(input.account_binding??''))reject(401,'MATERIAL_PAIRING_REQUIRED');
  const d=this.db.prepare('SELECT * FROM material_pairings WHERE digest=? AND pairing_id=? AND account=?').get(sha(secret),input.pairing_id,input.account_binding);
  if(!d)reject(401,'MATERIAL_PAIRING_REQUIRED');return d;
 }
 issue(d,secret){
  const now=this.store.clock();
  let row=this.db.prepare(`SELECT c.* FROM credentials c JOIN material_pairing_tokens t ON t.token_id=c.token_id
   WHERE t.pairing_id=? AND c.revoked=0 AND c.expires>? ORDER BY c.expires DESC LIMIT 1`).get(d.pairing_id,now+DAY/2);
  if(!row){
   row={token_id:randomUUID(),expires:now+DAY};
   const token=createHmac('sha256',secret).update('material-access/1:'+row.token_id).digest('base64url');
   this.db.prepare('INSERT INTO credentials(token_id,digest,owner,producer,scopes,expires) VALUES (?,?,?,?,?,?)').run(row.token_id,sha(token),d.owner,d.producer,JSON.stringify(['materials:write']),row.expires);
   this.db.prepare('INSERT INTO material_pairing_tokens VALUES (?,?)').run(row.token_id,d.pairing_id);
  }
  return {pairing_id:d.pairing_id,account_binding:d.account,owner_id:d.owner,producer_id:d.producer,
   server_id:this.db.prepare("SELECT value FROM meta WHERE key='server_id'").get().value,
   token:createHmac('sha256',secret).update('material-access/1:'+row.token_id).digest('base64url'),
   token_id:row.token_id,expires_at:iso(row.expires)};
 }
 refresh(secret,input){return this.store.tx(()=>{const d=this.principal(secret,input);if(d.revoked_at!==null)reject(403,'MATERIAL_PAIRING_REVOKED');return this.issue(d,secret);});}
 revokeBy(secret,input){return this.revoke(this.principal(secret,input).pairing_id);}
 revoke(pairing){return this.store.tx(()=>{
  const d=this.db.prepare('SELECT * FROM material_pairings WHERE pairing_id=?').get(pairing);if(!d)reject(404,'MATERIAL_PAIRING_NOT_FOUND');
  this.db.prepare('UPDATE material_pairings SET revoked_at=COALESCE(revoked_at,?) WHERE pairing_id=?').run(this.store.clock(),pairing);
  this.db.prepare('UPDATE credentials SET revoked=1 WHERE token_id IN (SELECT token_id FROM material_pairing_tokens WHERE pairing_id=?)').run(pairing);
  return {pairing_id:pairing,revoked:true};
 });}
}
