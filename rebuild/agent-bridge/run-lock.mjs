import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {BridgeError} from './client.mjs';

const require=createRequire(import.meta.url),APP_ID=0x694f4272;
const fail=code=>{throw new BridgeError(code,{permanent:true});};
const unsafe=file=>{
  try{const stat=fs.lstatSync(file);return stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
};
// Resolve aliases before selecting the lock and before later atomic state saves.
// The read-only status path never calls this helper or creates lock files.
export function canonicalStatePath(filename){
  const absolute=path.resolve(filename);fs.mkdirSync(path.dirname(absolute),{recursive:true,mode:0o700});
  let resolved;
  try{resolved=fs.realpathSync.native(absolute);}catch(error){
    if(error.code!=='ENOENT')throw error;
    resolved=path.join(fs.realpathSync.native(path.dirname(absolute)),path.basename(absolute));
  }
  if(unsafe(resolved))fail('STATE_PATH_UNSAFE');
  return process.platform==='win32'?resolved.toLowerCase():resolved;
}

// Only these private sidecar databases are opened, never the user's state JSON.
// Rollback-journal BEGIN EXCLUSIVE is a process-owned OS file lock, released by
// SQLite on close and by the OS on hard process death. No PID/age lease guessing.
export class BridgeRunLock{
  #locks=[];#active=false;
  static acquire({stateFile,identity}){
    const lease=new BridgeRunLock();
    try{
      lease.stateFile=canonicalStatePath(stateFile);
      const files=[`${lease.stateFile}.run-lock.sqlite`];
      if(identity.computer_id&&identity.agent_id){
        const key=createHash('sha256').update(JSON.stringify([identity.server_id,identity.owner_id,identity.computer_id,identity.agent_id])).digest('hex');
        // OS account home, not cwd/state directory/TMP environment overrides:
        // two configs for the same runtime must contend on the same file.
        const directory=path.join(os.userInfo().homedir,'.turboio','bridge-runtime-locks-v1');
        fs.mkdirSync(directory,{recursive:true,mode:0o700});
        const stat=fs.lstatSync(directory);
        if(!stat.isDirectory()||stat.isSymbolicLink()||typeof process.getuid==='function'&&stat.uid!==process.getuid())fail('LOCK_PATH_UNSAFE');
        files.push(path.join(directory,`${key}.sqlite`));
      }
      for(const file of files)lease.#take(file);
      lease.#active=true;return lease;
    }catch(error){lease.release();if(error instanceof BridgeError)throw error;
      if(error.errcode===5||error.errcode===6||/database (?:is )?locked/i.test(error.message??''))fail('BRIDGE_IN_USE');
      fail('LOCK_UNAVAILABLE');
    }
  }
  #take(file){
    if(unsafe(file))fail('LOCK_PATH_UNSAFE');
    try{const fd=fs.openSync(file,'wx',0o600);fs.closeSync(fd);}catch(error){if(error.code!=='EEXIST')throw error;}
    // Keep SQLite loading out of CLI status (including its experimental warning).
    const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(file);this.#locks.push({db,file,stat:fs.statSync(file)});
    db.exec('PRAGMA busy_timeout=0;');
    const app=db.prepare('PRAGMA application_id').get().application_id;
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    if(app!==APP_ID&&(app!==0||tables.length))fail('LOCK_FILE_INVALID');
    const mode=db.prepare('PRAGMA journal_mode').get().journal_mode;
    if(mode!=='delete')fail('LOCK_FILE_INVALID');
    db.exec(`BEGIN EXCLUSIVE; PRAGMA application_id=${APP_ID}; CREATE TABLE IF NOT EXISTS bridge_run_lock (singleton INTEGER PRIMARY KEY CHECK(singleton=1)); COMMIT; BEGIN EXCLUSIVE;`);
  }
  assertHeld(){
    if(!this.#active)fail('LOCK_LOST');
    for(const {file,stat} of this.#locks){
      let current;try{current=fs.lstatSync(file);}catch{fail('LOCK_LOST');}
      if(!current.isFile()||current.isSymbolicLink()||current.dev!==stat.dev||current.ino!==stat.ino||current.nlink!==1)fail('LOCK_LOST');
    }
  }
  release(){
    this.#active=false;
    for(const {db} of this.#locks.reverse())try{db.close();}catch{}
    this.#locks=[];
    // Never unlink an active or abandoned sidecar: that could bypass another
    // process's OS lock. Empty private lock DBs may safely remain between runs.
  }
}
