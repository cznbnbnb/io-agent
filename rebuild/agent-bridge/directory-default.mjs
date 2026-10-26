import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {BridgeError,readPrivateJson} from './client.mjs';
import {BridgeRunLock} from './run-lock.mjs';
import {runtimeDigest} from './runtime-events.mjs';
import {directoryRoute,validateDirectory,validateDefaultReply} from './session-directory.mjs';

const need=(value,code)=>{if(!value)throw new BridgeError(code,{permanent:true});};
const same=(a,b)=>runtimeDigest(a)===runtimeDigest(b);
/** Explicit shared default selection, independent of a phone's producer-bound
 * mailbox key. Persist the exact CAS operation before sending; a retry after a
 * lost response never silently replaces another device's newer choice. */
export async function setDirectoryDefault({client,stateFile,route}){
  need(path.isAbsolute(stateFile)&&(route===null||directoryRoute(route)),'INVALID_DEFAULT_TARGET');
  const realm={server_id:client.config.server_id,owner_id:client.config.owner_id,producer_id:client.config.producer_id};
  const lease=BridgeRunLock.acquire({stateFile,identity:{...realm,computer_id:'default-selection',agent_id:'default-selection'}});
  stateFile=lease.stateFile;
  try{
    let pending;
    if(fs.existsSync(stateFile)){
      pending=readPrivateJson(stateFile,8192);
      need(pending.schema_version===1&&same(pending.realm,realm)&&same(pending.input?.route,route),'DEFAULT_UPDATE_PENDING');
      need(typeof pending.input.request_id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(pending.input.request_id)&&Number.isSafeInteger(pending.input.expected_revision)&&pending.input.expected_revision>=0,'DEFAULT_UPDATE_INVALID');
    }else{
      const directory=validateDirectory(await client.agentSessions(),client.config);
      if(route!==null)need(directory.sessions.some(s=>same(s.route,route)&&s.online&&s.capabilities.can_execute&&Date.parse(s.lease_expires_at)>Date.parse(directory.server_time)),'DEFAULT_TARGET_UNAVAILABLE');
      pending={schema_version:1,realm,input:{request_id:randomUUID(),expected_revision:directory.default.revision,route}};
      fs.mkdirSync(path.dirname(stateFile),{recursive:true,mode:0o700});
      const temporary=stateFile+'.'+randomUUID()+'.partial';
      try{
        const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(pending)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
        fs.renameSync(temporary,stateFile);
      }finally{try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
      if(process.platform!=='win32'){const dir=fs.openSync(path.dirname(stateFile),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
    }
    let reply;
    try{reply=validateDefaultReply(await client.setAgentDefault(pending.input),client.config);
      need(reply.default.revision===pending.input.expected_revision+1&&same(reply.default.route,route),'SESSION_DIRECTORY_INVALID');
    }catch(error){
      // These explicit rejections resolve this retry without applying a new
      // write. After the server's ACK retention expires they do not prove that
      // an earlier attempt never applied. Auth/network/malformed replies retain
      // the immutable pending intent; a fresh GET remains authoritative.
      if(['DEFAULT_REVISION_CONFLICT','DEFAULT_SESSION_UNAVAILABLE','INVALID_AGENT_DEFAULT','IDEMPOTENCY_CONFLICT'].includes(error?.code))fs.unlinkSync(stateFile);
      throw error;
    }
    fs.unlinkSync(stateFile);
    // The ack is a historical fact: show the latest shared default separately.
    let current=null;try{current=validateDirectory(await client.agentSessions(),client.config).default;}catch{}
    return{applied:reply.default,current,changed_since_apply:current!==null&&!same(current,reply.default)};
  }finally{lease.release();}
}
