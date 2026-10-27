import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CodexAppServerChannel} from './codex-app-server.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export class CodexEndpointError extends Error {
  constructor(code){super(code);this.code=code;}
}
const need=(value,code)=>{if(!value)throw new CodexEndpointError(code);};
const privateDirectory=(value,uid)=>value.isDirectory()&&!value.isSymbolicLink()&&value.uid===uid&&!(value.mode&0o077);
const socketKey=value=>[value.dev,value.ino,value.uid].join(':');
const rpcPathValid=value=>typeof value==='string'&&/^\/(?:[A-Za-z0-9._~-]+\/?)*$/.test(value)&&
  !value.split('/').some(part=>part==='.'||part==='..');

export async function probeCodexOwner({endpoint,rpcPath,conversationId}){
  const channel=await new CodexAppServerChannel(endpoint,{rpcPath,timeoutMs:3000}).connect();
  try{
    let cursor=null,loaded=false;
    for(let n=0;n<10;n++){
      const page=await channel.request('thread/loaded/list',{...(cursor?{cursor}:{}),limit:100});
      if(!Array.isArray(page?.data))throw Error('invalid loaded list');
      if(page.data.includes(conversationId)){loaded=true;break;}
      cursor=page.nextCursor;if(!cursor)break;
    }
    if(!loaded)return{loaded:false};
    const reply=await channel.request('thread/read',{threadId:conversationId,includeTurns:false});
    return{loaded:true,thread:reply.thread};
  }finally{channel.close();}
}

/** Verify both sides of an official stable socket symlink. The stable parent
 * and canonical socket parent must be private to the current UID. This helper
 * is read-only; uid is injectable solely for ownership-check tests. */
export function trustedCodexUnixEndpoint(candidate,{uid=process.getuid?.()}={}){
  need(Number.isSafeInteger(uid)&&uid>=0&&typeof candidate==='string'&&path.isAbsolute(candidate),'CODEX_SESSION_ENDPOINT_UNTRUSTED');
  try{
    const parent=fs.lstatSync(path.dirname(candidate)),entry=fs.lstatSync(candidate);
    need(privateDirectory(parent,uid)&&entry.uid===uid&&(entry.isSocket()||entry.isSymbolicLink()),'CODEX_SESSION_ENDPOINT_UNTRUSTED');
    const canonical=fs.realpathSync(candidate),actualParent=fs.lstatSync(path.dirname(canonical)),socket=fs.lstatSync(canonical);
    need(privateDirectory(actualParent,uid)&&socket.isSocket()&&socket.uid===uid,'CODEX_SESSION_ENDPOINT_UNTRUSTED');
    return{endpoint:'unix://'+canonical,key:[candidate,socketKey(parent),socketKey(entry),canonical,socketKey(actualParent),socketKey(socket)].join('|')};
  }catch(error){
    if(error instanceof CodexEndpointError)throw error;
    if(['ENOENT','ENOTDIR','ECONNREFUSED'].includes(error?.code))throw new CodexEndpointError('CODEX_SESSION_ENDPOINT_UNAVAILABLE');
    throw new CodexEndpointError('CODEX_SESSION_ENDPOINT_UNTRUSTED');
  }
}

function unixCandidate(endpoint,codexHome){
  if(endpoint===undefined||endpoint==='unix://')return path.join(codexHome,'app-server-control','app-server-control.sock');
  let url;try{url=new URL(endpoint);}catch{throw new CodexEndpointError('CODEX_SESSION_ENDPOINT_INVALID');}
  need(url.protocol==='unix:'&&!url.hostname&&!url.username&&!url.password&&!url.search&&!url.hash,'CODEX_SESSION_ENDPOINT_INVALID');
  let candidate;try{candidate=decodeURIComponent(url.pathname);}catch{throw new CodexEndpointError('CODEX_SESSION_ENDPOINT_INVALID');}
  need(path.isAbsolute(candidate)&&candidate!=='/'&&!candidate.includes('\0'),'CODEX_SESSION_ENDPOINT_INVALID');return candidate;
}

/** Discover only an already-running native owner. probe must make read-only
 * loaded/list + metadata calls and return {loaded,thread:{id,cwd,
 * canAcceptDirectInput,parentThreadId?}}. No thread/resume, process launch,
 * history scan, queue mutation, or optimistic online declaration occurs here. */
export async function discoverCodexEndpoint({conversationId,workspace,endpoint,rpcPath,
  codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),probe=probeCodexOwner}={}){
  need(uuid(conversationId)&&(workspace===undefined?endpoint!==undefined:typeof workspace==='string'&&path.isAbsolute(workspace))&&
    typeof codexHome==='string'&&path.isAbsolute(codexHome)&&typeof probe==='function'&&
    (endpoint===undefined||typeof endpoint==='string')&&(rpcPath===undefined||rpcPathValid(rpcPath)),'CODEX_SESSION_DISCOVERY_INVALID');
  let canonicalWorkspace;try{if(workspace!==undefined){canonicalWorkspace=fs.realpathSync(workspace);need(fs.statSync(canonicalWorkspace).isDirectory(),'CODEX_SESSION_DISCOVERY_INVALID');}}
  catch{throw new CodexEndpointError('CODEX_SESSION_DISCOVERY_INVALID');}
  const shared=endpoint===undefined||endpoint==='unix://';let result,candidate,verified;
  if(shared||endpoint.startsWith('unix:')){
    candidate=unixCandidate(endpoint,codexHome);verified=trustedCodexUnixEndpoint(candidate);
    result={endpoint:verified.endpoint,rpcPath:rpcPath??(shared?'/rpc':'/'),mode:shared?'shared-daemon':'explicit'};
  }else{
    let url;try{url=new URL(endpoint);}catch{throw new CodexEndpointError('CODEX_SESSION_ENDPOINT_INVALID');}
    need(url.protocol==='ws:'&&['127.0.0.1','[::1]'].includes(url.hostname)&&url.port&&
      Number(url.port)>0&&Number(url.port)<=65535&&!url.username&&!url.password&&!url.search&&!url.hash&&
      rpcPathValid(url.pathname||'/'),'CODEX_SESSION_ENDPOINT_UNTRUSTED');
    need(rpcPath===undefined||rpcPath===(url.pathname||'/'),'CODEX_SESSION_ENDPOINT_INVALID');
    result={endpoint:url.href,rpcPath:url.pathname||'/',mode:'explicit'};
  }
  let observation;
  try{observation=await probe({...result,conversationId,workspace:canonicalWorkspace});}
  catch(error){
    if(error instanceof CodexEndpointError)throw error;
    throw new CodexEndpointError('CODEX_SESSION_ENDPOINT_UNAVAILABLE');
  }
  // Discovery must stay read-only. In particular a thread visible in durable
  // history but absent from this owner's loaded set cannot be silently resumed.
  need(object(observation)&&observation.loaded===true&&object(observation.thread)&&
    observation.thread.id===conversationId,'CODEX_SESSION_NOT_LOADED');
  const thread=observation.thread;let observedWorkspace;
  try{need(typeof thread.cwd==='string'&&path.isAbsolute(thread.cwd),'CODEX_SESSION_WORKSPACE_MISMATCH');observedWorkspace=fs.realpathSync(thread.cwd);}
  catch{throw new CodexEndpointError('CODEX_SESSION_WORKSPACE_MISMATCH');}
  need(canonicalWorkspace===undefined||observedWorkspace===canonicalWorkspace,'CODEX_SESSION_WORKSPACE_MISMATCH');
  need(fs.statSync(observedWorkspace).isDirectory(),'CODEX_SESSION_WORKSPACE_MISMATCH');
  need(thread.canAcceptDirectInput===true&&thread.parentThreadId==null&&thread.ephemeral!==true,'CODEX_SESSION_INPUT_UNAVAILABLE');
  if(candidate)need(trustedCodexUnixEndpoint(candidate).key===verified.key,'CODEX_SESSION_ENDPOINT_CHANGED');
  return Object.freeze({...result,...(workspace===undefined?{workspace:observedWorkspace}:{})});
}

/** Installation advice only. Nothing reads or changes global configuration.
 * The Desktop opt-in is version-pinned implementation evidence, not a claim
 * that an already-running stdio owner can be hot-migrated into a new daemon. */
export const DESKTOP_SHARED_DAEMON_ADVICE=Object.freeze({
  inspectedBundledCli:'0.164.0-alpha.11.1',
  inspectedSource:'.vite/build/application-network-startup-B4Wezh-6.js',
  inspectedSourceSha256:'9775ead462eb9ab9c31b4a8aedf92b18a5a657f186be21f207a9b7adb143895f',
  optInEnvironmentName:'CODEX_APP_SERVER_USE_LOCAL_DAEMON',optInEnvironmentValue:'1',
  desktopSupported:false,
  prerequisite:'Desktop launch integration is disabled after a real policy-read protocol failure. Keep the bundled native CLI and do not set global Desktop overrides. Ordinary --remote unix:// CLI sessions are a separately tested path.',
  blockers:'Built-in overrides skip the daemon gate; the replacement relay subsequently prevented real Desktop startup. Component protocol tests did not validate the startup policy handshake. Do not remove native tools or bypass policy checks.',
  readOnlyVersionCheck:'codex app-server daemon version',
  explicitDaemonStart:'codex app-server daemon start',
  terminalAlternative:'codex --remote unix://',
  documentation:'https://learn.chatgpt.com/docs/app-server'
});
