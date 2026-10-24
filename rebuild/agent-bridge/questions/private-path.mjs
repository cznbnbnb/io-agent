import fs from 'node:fs';
import path from 'node:path';
import {BridgeError} from '../client.mjs';

// The repository-configured private root may be the shared worktree link. Only
// that boundary is resolved: every existing component below it must be ordinary
// storage, including the caller/run, registrations, profile and private files.
export function privatePath(root, candidate, {directory=false, allowMissing=false, code='CALLER_ACTIVE_CONTEXT_INVALID'}={}) {
 const fail=()=>{throw new BridgeError(code,{permanent:true});};
 try {
  const logical=path.resolve(root),actual=fs.realpathSync(logical);
  if(!fs.statSync(actual).isDirectory()||typeof candidate!=='string'||!path.isAbsolute(candidate)||path.resolve(candidate)!==candidate)fail();
  let relative;
  for(const base of [logical,actual]){
   const value=path.relative(base,candidate);
   if(value===''||(!path.isAbsolute(value)&&value!=='..'&&!value.startsWith('..'+path.sep))){relative=value;break;}
  }
  if(relative===undefined)fail();
  const parts=relative===''?[]:relative.split(path.sep),result=path.join(actual,...parts);
  if(!parts.length){if(!directory)fail();return actual;}
  let current=actual;
  for(let index=0;index<parts.length;index++){
   current=path.join(current,parts[index]);let info;
   try{info=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT'&&allowMissing)return result;throw error;}
   if(info.isSymbolicLink())fail();
   if(index<parts.length-1||directory){if(!info.isDirectory())fail();}
   else if(!info.isFile()||info.nlink!==1)fail();
  }
  return result;
 }catch(error){if(error instanceof BridgeError)throw error;fail();}
}
