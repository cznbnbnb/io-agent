import {reject} from './json.mjs';

// A primary phone owns short, non-overlapping glasses leases. Switching leaves
// the old phone authorized for history; the new one waits out its last lease.
export const PHONE_LEASE_MS=20000;
export class PhonePresence {
 constructor(store){this.store=store;store.db.exec(`
  CREATE TABLE IF NOT EXISTS phone_accounts(device_id TEXT PRIMARY KEY,owner TEXT NOT NULL,account TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS primary_phones(owner TEXT PRIMARY KEY,device_id TEXT NOT NULL,revision INTEGER NOT NULL,
   active_after INTEGER NOT NULL,lease_until INTEGER NOT NULL,notice_after_seq INTEGER NOT NULL) STRICT;`);}
 get db(){return this.store.db;}
 account(device,account){
  if(typeof account!=='string'||!/^[a-f0-9]{64}$/.test(account))reject(400,'PHONE_ACCOUNT_INVALID');
  const known=this.db.prepare('SELECT account FROM phone_accounts WHERE owner=? UNION SELECT account FROM material_pairings WHERE owner=? AND revoked_at IS NULL').all(device.owner,device.owner);
  if(known.length&&!known.some(row=>row.account===account))reject(409,'PHONE_ACCOUNT_MISMATCH');
  const old=this.db.prepare('SELECT account FROM phone_accounts WHERE device_id=?').get(device.device_id);
  if(old&&old.account!==account)reject(409,'PHONE_ACCOUNT_MISMATCH');
  this.db.prepare('INSERT OR IGNORE INTO phone_accounts VALUES (?,?,?)').run(device.device_id,device.owner,account);
 }
 // All inputs are checked here; internal rows below come from our schema.
 update(token,input,switching=false){
  const p=this.store.auth(token,'receipts:phone'),d=this.store.devices.device(p);
  if(d.role!=='phone'||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['account_binding',...(switching?['expected_revision']:[])].includes(k)))reject(400,'PHONE_REQUEST_INVALID');
  if(switching&&(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<0))reject(400,'PHONE_REQUEST_INVALID');
  return this.store.tx(()=>{
   this.account(d,input.account_binding);const now=this.store.clock();
   let row=this.db.prepare('SELECT * FROM primary_phones WHERE owner=?').get(p.owner);
   if(!row){
    const oldest=this.db.prepare("SELECT device_id FROM devices WHERE owner=? AND role='phone' AND revoked_at IS NULL ORDER BY created_at, rowid LIMIT 1").get(p.owner);
    this.db.prepare('INSERT INTO primary_phones VALUES (?,?,1,?,?,0)').run(p.owner,oldest.device_id,now,now);
    row=this.db.prepare('SELECT * FROM primary_phones WHERE owner=?').get(p.owner);
   }
   if(switching){
    if(input.expected_revision!==row.revision)reject(409,'PRIMARY_PHONE_CHANGED');
    if(row.device_id!==d.device_id){this.db.prepare('UPDATE primary_phones SET device_id=?,revision=revision+1,active_after=MAX(lease_until,?),lease_until=MAX(lease_until,?),notice_after_seq=? WHERE owner=?').run(d.device_id,now,now,this.store.queueCeiling(p.owner),p.owner);row=this.db.prepare('SELECT * FROM primary_phones WHERE owner=?').get(p.owner);}
   }
   const active=row.device_id===d.device_id&&now>=row.active_after;
   if(active){this.db.prepare('UPDATE primary_phones SET lease_until=? WHERE owner=?').run(now+PHONE_LEASE_MS,p.owner);row.lease_until=now+PHONE_LEASE_MS;}
   const phones=this.db.prepare("SELECT device_id,label,revoked_at FROM devices WHERE owner=? AND role='phone' ORDER BY created_at,rowid").all(p.owner).map(r=>({device_id:r.device_id,label:r.label,revoked:r.revoked_at!==null}));
   return {schema_version:'1.0',server_id:this.store.devices.serverId(),owner_id:p.owner,device_id:d.device_id,account_binding:input.account_binding,
    primary_device_id:row.device_id,revision:row.revision,notice_after_seq:row.notice_after_seq,lease_ms:active?PHONE_LEASE_MS:0,wait_ms:row.device_id===d.device_id?Math.max(0,row.active_after-now):0,phones};
  });
 }
 // Legacy phones cannot receive fresh request/message bodies after a switch.
 // Updated phones also check their elapsed-time lease before every UI emission.
 permits(principal){
  if(!JSON.parse(principal.scopes).includes('receipts:phone'))return true;
  const row=this.db.prepare('SELECT * FROM primary_phones WHERE owner=?').get(principal.owner);if(!row)return true;
  const d=this.db.prepare('SELECT d.device_id FROM device_tokens t JOIN devices d ON d.device_id=t.device_id WHERE t.token_id=?').get(principal.token_id);
  if(!d)return false;
  return row.device_id===d.device_id&&this.store.clock()>=row.active_after;
 }
}
