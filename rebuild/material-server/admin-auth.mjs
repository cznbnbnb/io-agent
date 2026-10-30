import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {reject,sha} from './json.mjs';

// OWASP's 32 MiB scrypt option; asynchronous derivation leaves the phone API responsive.
const derive=promisify(scrypt),SCRYPT={N:32768,r:8,p:3,maxmem:64*1024*1024};
const SESSION_MS=7*86400000,WINDOW_MS=15*60000;
function username(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/.test(value))reject(400,'ADMIN_USERNAME_INVALID');
  return value.toLowerCase();
}
function password(value){
  if(typeof value!=='string'||[...value].length<12||value.length>128)reject(400,'ADMIN_PASSWORD_INVALID');
  return value;
}
function fields(input,names){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join()!==names.slice().sort().join())reject(400,'INVALID_ADMIN_INPUT');
}

/** Only browser management identities. These sessions are never API bearer grants. */
export class AdminAuth {
  constructor(store){
    this.store=store;this.db=store.db;this.clock=store.clock;this.pending=0;this.requests=[];
    this.db.exec(`CREATE TABLE IF NOT EXISTS admin_users(
      username TEXT PRIMARY KEY,owner TEXT NOT NULL,salt TEXT NOT NULL,digest TEXT NOT NULL,
      must_change INTEGER NOT NULL,updated INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS admin_sessions(
      digest TEXT PRIMARY KEY,username TEXT NOT NULL REFERENCES admin_users(username),expires INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS admin_login_attempts(
      username TEXT PRIMARY KEY,count INTEGER NOT NULL,started INTEGER NOT NULL) STRICT;`);
  }
  async enroll(input,reset=false){
    fields(input,reset?['username','password']:['username','owner','password']);
    const name=username(input.username),secret=password(input.password);
    const old=this.db.prepare('SELECT * FROM admin_users WHERE username=?').get(name);
    if(reset?!old:old)reject(409,reset?'ADMIN_ACCOUNT_MISSING':'ADMIN_ACCOUNT_EXISTS');
    if(!reset&&(typeof input.owner!=='string'||!this.db.prepare('SELECT 1 FROM credentials WHERE owner=? LIMIT 1').get(input.owner)))reject(400,'ADMIN_OWNER_REQUIRED');
    const salt=randomBytes(16).toString('hex'),digest=(await derive(secret,salt,32,SCRYPT)).toString('hex');
    this.store.tx(()=>{
      if(reset){this.db.prepare('UPDATE admin_users SET salt=?,digest=?,must_change=1,updated=? WHERE username=?').run(salt,digest,this.clock(),name);this.db.prepare('DELETE FROM admin_sessions WHERE username=?').run(name);}
      else this.db.prepare('INSERT INTO admin_users VALUES (?,?,?,?,1,?)').run(name,input.owner,salt,digest,this.clock());
      this.db.prepare('DELETE FROM admin_login_attempts WHERE username=?').run(name);
    });
    return {username:name,must_change_password:true};
  }
  async verify(name,secret){
    const now=this.clock();this.requests=this.requests.filter(at=>now-at<60000);
    if(this.requests.length>=30||this.pending>=2)reject(429,'ADMIN_LOGIN_LIMITED');
    this.requests.push(now);
    this.db.prepare('DELETE FROM admin_login_attempts WHERE started<=?').run(now-WINDOW_MS);
    const attempts=this.db.prepare('SELECT count FROM admin_login_attempts WHERE username=?').get(name);
    if(attempts?.count>=10)reject(429,'ADMIN_LOGIN_LIMITED');
    this.db.prepare('INSERT INTO admin_login_attempts VALUES (?,1,?) ON CONFLICT(username) DO UPDATE SET count=count+1').run(name,now);
    const row=this.db.prepare('SELECT * FROM admin_users WHERE username=?').get(name);this.pending++;
    let digest;
    try{digest=await derive(secret,row?.salt??'00000000000000000000000000000000',32,SCRYPT);}
    finally{this.pending--;}
    if(!timingSafeEqual(digest,Buffer.from(row?.digest??'0'.repeat(64),'hex'))||!row)reject(401,'ADMIN_LOGIN_FAILED');
    this.db.prepare('DELETE FROM admin_login_attempts WHERE username=?').run(name);return row;
  }
  session(token){
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))reject(401,'ADMIN_LOGIN_REQUIRED');
    const row=this.db.prepare('SELECT u.*,s.expires FROM admin_sessions s JOIN admin_users u ON u.username=s.username WHERE s.digest=? AND s.expires>?').get(sha(token),this.clock());
    if(!row)reject(401,'ADMIN_LOGIN_REQUIRED');return row;
  }
  issue(row){
    const token=randomBytes(32).toString('base64url'),expires=this.clock()+SESSION_MS;
    this.db.prepare('DELETE FROM admin_sessions WHERE expires<=?').run(this.clock());
    this.db.prepare('INSERT INTO admin_sessions VALUES (?,?,?)').run(sha(token),row.username,expires);
    return {token,profile:{username:row.username,must_change_password:!!row.must_change,expires_at:new Date(expires).toISOString()}};
  }
  async login(input,previous){
    fields(input,['username','password']);const name=username(input.username);
    // Wrong passwords, including short ones, get the same error as unknown accounts.
    if(typeof input.password!=='string'||input.password.length>128)reject(400,'INVALID_ADMIN_INPUT');
    const row=await this.verify(name,input.password);
    return this.store.tx(()=>{
      if(this.db.prepare('SELECT digest FROM admin_users WHERE username=?').get(name)?.digest!==row.digest)reject(401,'ADMIN_LOGIN_FAILED');
      if(previous)this.logout(previous);
      return this.issue(row);
    });
  }
  logout(token){if(typeof token==='string')this.db.prepare('DELETE FROM admin_sessions WHERE digest=?').run(sha(token));}
  async change(token,input){
    const session=this.session(token);fields(input,['current_password','new_password']);
    if(typeof input.current_password!=='string'||input.current_password.length>128)reject(400,'INVALID_ADMIN_INPUT');
    const next=password(input.new_password);
    if(next===input.current_password)reject(400,'ADMIN_PASSWORD_UNCHANGED');
    const row=await this.verify(session.username,input.current_password),salt=randomBytes(16).toString('hex');
    const digest=(await derive(next,salt,32,SCRYPT)).toString('hex');
    return this.store.tx(()=>{
      this.session(token);
      if(this.db.prepare('UPDATE admin_users SET salt=?,digest=?,must_change=0,updated=? WHERE username=? AND digest=?').run(salt,digest,this.clock(),row.username,row.digest).changes!==1)reject(401,'ADMIN_LOGIN_REQUIRED');
      this.db.prepare('DELETE FROM admin_sessions WHERE username=?').run(row.username);
      return this.issue({...row,must_change:0});
    });
  }
}
