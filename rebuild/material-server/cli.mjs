import fs from 'node:fs';
import path from 'node:path';
import {MaterialStore} from './store.mjs';
import {listen} from './http.mjs';
import {TrafficLedger} from './traffic.mjs';

// Local administrator only. No HTTP registration or token mint endpoint.
const [action,...args]=process.argv.slice(2),options={};
try{
  for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1]||Object.hasOwn(options,args[i]))throw new Error('INVALID_ARGUMENTS');options[args[i]]=args[i+1];}
  const allowed={serve:['--db','--port'],mint:['--db','--owner','--producer','--scopes','--ttl-ms','--out'],revoke:['--db','--token-id'],backup:['--db','--out']};
  if(!allowed[action]||Object.keys(options).some(k=>!allowed[action].includes(k))||!options['--db']||!path.isAbsolute(options['--db']))throw new Error('EXPLICIT_ABSOLUTE_DB_REQUIRED');
  if(['mint','backup'].includes(action)&&(!options['--out']||!path.isAbsolute(options['--out'])))throw new Error('EXPLICIT_PRIVATE_OUTPUT_REQUIRED');
  fs.mkdirSync(path.dirname(options['--db']),{recursive:true,mode:0o700});
  const store=new MaterialStore(options['--db']);
  let traffic=null;
  try{
    if(action==='serve'){
      const port=Number(options['--port']??3401);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('INVALID_PORT');
      const serverId=store.db.prepare("SELECT value FROM meta WHERE key='server_id'").get().value;
      let trafficUnavailable=false;
      try{traffic=new TrafficLedger(options['--db']+'.traffic.sqlite',serverId);}
      catch{trafficUnavailable=true;process.stderr.write(JSON.stringify({warning:'TRAFFIC_UNAVAILABLE'})+'\n');}
      const server=await listen(store,port,{traffic,trafficUnavailable});process.stdout.write(JSON.stringify({service:'turboio-materials',listen:'127.0.0.1',port})+'\n');
      let closing=false;const stop=()=>{if(closing)return;closing=true;server.close(()=>{traffic?.close();store.close();process.exit(0);});};
      process.on('SIGINT',stop);process.on('SIGTERM',stop);
    }else if(action==='mint'){
      // O_EXCL prevents overwriting a previous credential. On Windows restrict
      // the output directory ACL separately; POSIX mode alone is not an ACL.
      const fd=fs.openSync(options['--out'],'wx',0o600);let value;
      try{
        value=store.mint({owner:options['--owner'],producer:options['--producer'],scopes:(options['--scopes']??'').split(','),ttlMs:Number(options['--ttl-ms']??3600000)});
        fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);
      }catch(error){if(value)store.revoke(value.token_id);throw error;}finally{fs.closeSync(fd);}
      process.stdout.write(JSON.stringify({token_id:value.token_id,expires_at:value.expires_at})+'\n');store.close();
    }else if(action==='backup'){process.stdout.write(JSON.stringify(await store.backupTo(options['--out']))+'\n');store.close();}
    else{const revoked=store.revoke(options['--token-id']??'');process.stdout.write(JSON.stringify({revoked})+'\n');store.close();}
  }catch(error){traffic?.close();store.close();throw error;}
}catch(error){process.stderr.write(JSON.stringify({error:error?.code??'STARTUP_FAILED'})+'\n');process.exitCode=1;}
