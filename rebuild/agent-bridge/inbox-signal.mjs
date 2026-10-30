import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {BridgeClient,BridgeError,readPrivateJson} from './client.mjs';
import {BridgeRunLock} from './run-lock.mjs';
import {atomic} from './session-pairing.mjs';

/** One outbound watch per credential boundary, shared across local processes.
 * Only change markers are shared. Every bridge retains its own durable inbox
 * cursor, route filter and execution journal. The existing OS lock elects the
 * watcher and releases automatically if its process exits. */
export class SharedInboxSignal {
  constructor(config,{directory=path.join(os.userInfo().homedir,'.turboio','inbox-signals-v1'),waitSeconds=10}={}){
    this.client=new BridgeClient({...config,timeout_ms:30000});this.waitSeconds=waitSeconds;
    const key=createHash('sha256').update(JSON.stringify([config.base_url,config.server_id,config.owner_id,config.producer_id,fs.realpathSync(config.credential_file)])).digest('hex');
    fs.mkdirSync(directory,{recursive:true,mode:0o700});const stat=fs.lstatSync(directory);
    if(!stat.isDirectory()||stat.isSymbolicLink()||process.getuid&&stat.uid!==process.getuid())throw new BridgeError('SIGNAL_PATH_UNSAFE',{permanent:true});
    this.file=path.join(directory,key+'.json');this.lock=null;this.running=false;this.timer=null;this.operation=null;this.controller=null;
  }
  start(){this.running=true;this.schedule(0);}
  schedule(ms){if(this.running){this.timer=setTimeout(()=>{this.operation=this.tick().finally(()=>{this.operation=null;});},ms);this.timer.unref?.();}}
  snapshot(){
    if(!fs.existsSync(this.file))return null;
    const value=readPrivateJson(this.file,4096);
    if(value.schema!==1||typeof value.generation!=='string'||!/^[a-f0-9]{64}$/.test(value.version??'')||!Number.isSafeInteger(value.checked_at)||value.error!==null&&typeof value.error!=='string')throw new BridgeError('SIGNAL_STATE_INVALID',{permanent:true});
    return {...value,healthy:value.error===null&&Date.now()-value.checked_at<35000,key:value.generation+':'+value.version};
  }
  async tick(){
    let delay=1000;
    try{
      if(!this.lock){
        try{this.lock=BridgeRunLock.acquire({stateFile:this.file,identity:{}});}
        catch(error){if(error.code==='BRIDGE_IN_USE'){this.schedule(delay);return;}throw error;}
        this.generation=randomUUID();this.version=null;
      }
      this.lock.assertHeld();this.controller=new AbortController();
      const reply=await this.client.watchInbox(this.version,{signal:this.controller.signal,waitSeconds:this.waitSeconds});
      if(!this.running)return;
      this.version=reply.version;this.failures=0;
      atomic(this.file,{schema:1,generation:this.generation,version:this.version,checked_at:Date.now(),error:null});delay=0;
    }catch(error){
      if(!this.running)return;
      const code=/^[A-Z][A-Z0-9_]{0,100}$/.test(error.code??'')?error.code:'SIGNAL_UNAVAILABLE';
      if(this.lock)atomic(this.file,{schema:1,generation:this.generation,version:this.version??'0'.repeat(64),checked_at:Date.now(),error:code});
      delay=Math.min(15000,1000*2**Math.min(this.failures??0,4));this.failures=(this.failures??0)+1;
    }finally{this.controller=null;}
    this.schedule(delay);
  }
  async stop(){this.running=false;clearTimeout(this.timer);this.controller?.abort();await this.operation;this.lock?.release();this.lock=null;}
}
