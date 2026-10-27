import {createHmac} from 'node:crypto';
import {canonical,sha,reject} from './json.mjs';
const WINDOW=600000,TTL=86400000;
export const SESSION_SCOPES=['tasks:write','tasks:read','tasks:update','requests:write','messages:receive','messages:write','receipts:agent'];
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(v);
const secret=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const text=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n&&v.trim()===v&&!/[\u0000-\u001f\u007f-\u009f]/.test(v);
const keys=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join()===k.split(',').sort().join();
export class SessionPairings {
 constructor(store){this.store=store;store.db.exec(`CREATE TABLE IF NOT EXISTS session_pairings(
 id TEXT PRIMARY KEY,claim_digest TEXT NOT NULL,approval_digest TEXT NOT NULL,metadata TEXT NOT NULL,
 created INTEGER NOT NULL,expires INTEGER NOT NULL,owner TEXT,approved_by TEXT,device_id TEXT,token_id TEXT) STRICT;
 CREATE TABLE IF NOT EXISTS session_bindings(owner TEXT NOT NULL,producer TEXT NOT NULL,route TEXT NOT NULL,pairing_id TEXT UNIQUE NOT NULL,
 PRIMARY KEY(owner,producer)) STRICT;`);}
 get db(){return this.store.db;}
 start(input){
  if(!keys(input,'id,claim_secret,metadata')||!uuid(input.id)||!secret(input.claim_secret))reject(400,'PAIRING_INVALID');
  const m=input.metadata;
  if(!(keys(m,'runtime,route,topic,workspace')||keys(m,'runtime,route,topic,workspace,mode')&&m.mode==='computer')||!text(m.topic,40)||!text(m.workspace,512)||! /^[a-z][a-z0-9-]{1,31}$/.test(m.runtime??'')||!keys(m.route,'computer_id,agent_id,project_id,session_id')||!Object.values(m.route).every(id)||m.route.agent_id!==(m.runtime==='codex'?'io-current-codex':'io-'+m.runtime))reject(400,'PAIRING_INVALID');
  return this.store.tx(()=>{
   const now=this.store.clock(),code=sha('session-approval/1:'+input.claim_secret),digest=sha(input.claim_secret),metadata=canonical(m);
   let row=this.db.prepare('SELECT * FROM session_pairings WHERE id=?').get(input.id);
   if(row){if(row.claim_digest!==digest||row.metadata!==metadata)reject(409,'PAIRING_CONFLICT');if(row.expires<=now&&!row.device_id)reject(410,'PAIRING_EXPIRED');}
   else{
    this.db.prepare('DELETE FROM session_pairings WHERE expires<? AND owner IS NULL').run(now);
    if(this.db.prepare('SELECT count(*) AS n FROM session_pairings WHERE created>?').get(now-WINDOW).n>=100)reject(429,'PAIRING_RATE_LIMITED');
    this.db.prepare('INSERT INTO session_pairings VALUES (?,?,?,?,?,?,NULL,NULL,NULL,NULL)').run(input.id,digest,sha(code),metadata,now,now+WINDOW);
    row=this.db.prepare('SELECT * FROM session_pairings WHERE id=?').get(input.id);
   }
   return {id:row.id,expires_at:new Date(row.expires).toISOString(),pairing_string:'io-agent-pair/1:'+row.id+':'+code,qr_url:'https://cznbnb.cn/io-api/v1/connect#id='+row.id+'&code='+code};
  });
 }
 approval(token,input){
  const principal=this.store.auth(token,'answers:write'),device=this.store.devices.device(principal);if(device.role!=='phone')reject(403,'PHONE_REQUIRED');
  if(!keys(input,'id,code')||!uuid(input.id)||! /^[a-f0-9]{64}$/.test(input.code??''))reject(400,'PAIRING_INVALID');
  const row=this.db.prepare('SELECT * FROM session_pairings WHERE id=? AND approval_digest=?').get(input.id,sha(input.code));
  if(!row||row.expires<=this.store.clock())reject(410,'PAIRING_EXPIRED');
  if(row.owner!==null&&row.owner!==principal.owner)reject(409,'PAIRING_ALREADY_BOUND');
  return {row,principal,device};
 }
 preview(token,input){const {row,principal}=this.approval(token,input);return {id:row.id,metadata:JSON.parse(row.metadata),owner_id:principal.owner,expires_at:new Date(row.expires).toISOString(),approved:row.owner!==null};}
 approve(token,input){return this.store.tx(()=>{const {row,principal,device}=this.approval(token,input);if(row.owner===null)this.db.prepare('UPDATE session_pairings SET owner=?,approved_by=? WHERE id=?').run(principal.owner,device.device_id,row.id);return {id:row.id,approved:true};});}
 claim(input){
  if(!keys(input,'id,claim_secret')||!uuid(input.id)||!secret(input.claim_secret))reject(401,'PAIRING_SECRET_REQUIRED');
  return this.store.tx(()=>{
   const row=this.db.prepare('SELECT * FROM session_pairings WHERE id=? AND claim_digest=?').get(input.id,sha(input.claim_secret)),now=this.store.clock();
   if(!row)reject(401,'PAIRING_SECRET_REQUIRED');if(!row.device_id&&row.expires<=now)reject(410,'PAIRING_EXPIRED');
   if(!row.owner)return {pending:true,id:row.id,expires_at:new Date(row.expires).toISOString()};
   const m=JSON.parse(row.metadata);let device,issued;
   if(!row.device_id){
    issued=this.store.devices.enroll({owner:row.owner,role:'agent',label:(m.runtime+' · '+m.topic).slice(0,64).trim()});row.device_id=issued.device_id;
    if(m.mode!=='computer')this.db.prepare('INSERT INTO session_bindings VALUES (?,?,?,?)').run(row.owner,issued.producer_id,canonical(m.route),row.id);
    this.db.prepare('UPDATE session_pairings SET device_id=? WHERE id=?').run(row.device_id,row.id);
   }
   device=this.db.prepare('SELECT * FROM devices WHERE device_id=?').get(row.device_id);
   if(!device||device.revoked_at!==null)reject(403,'PAIRING_REVOKED');
   let credential=row.token_id?this.db.prepare('SELECT * FROM credentials WHERE token_id=?').get(row.token_id):null;
   if(!credential||credential.revoked||credential.expires<=now+TTL/2){
    issued??=this.store.devices.issue(row.device_id);const token=createHmac('sha256',input.claim_secret).update('session-access/1:'+issued.token_id).digest('base64url');
    this.db.prepare('UPDATE credentials SET digest=?,scopes=? WHERE token_id=?').run(sha(token),JSON.stringify(m.mode==='computer'?issued.scopes:SESSION_SCOPES),issued.token_id);
    this.db.prepare('UPDATE session_pairings SET token_id=? WHERE id=?').run(issued.token_id,row.id);credential=this.db.prepare('SELECT * FROM credentials WHERE token_id=?').get(issued.token_id);
   }
   return {pending:false,id:row.id,metadata:m,device_id:device.device_id,role:'agent',label:device.label,owner_id:row.owner,producer_id:device.producer,
    server_id:this.store.devices.serverId(),token_id:credential.token_id,token:createHmac('sha256',input.claim_secret).update('session-access/1:'+credential.token_id).digest('base64url'),
    expires_at:new Date(credential.expires).toISOString(),refresh_after:new Date(credential.expires-TTL/2).toISOString(),scopes:JSON.parse(credential.scopes)};
  });
 }
}
