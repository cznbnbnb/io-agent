// Test driver only. Credentials are issued explicitly for an exclusive,
// synthetic owner; this is not production enrollment or phone UI automation.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BridgeClient,readPrivateJson} from '../../rebuild/agent-bridge/client.mjs';

const privateRoot=fileURLToPath(new URL('../../rebuild/agent-bridge/private/',import.meta.url));
const base='https://cznbnb.cn/io-api/v1/';
const fail=()=>{throw new Error('SYNTHETIC_CLOUD_CONFIG_REQUIRED');};
export async function cloudQueue(filename){
  const bundle=readPrivateJson(filename),roles=['phone','agent','operations'];
  if(bundle?.schema_version!=='1.0'||bundle.purpose!=='synthetic-cloud-verification'||
    !/^[a-z0-9][a-z0-9-]{0,47}$/.test(bundle.run_id??''))fail();
  const directory=path.resolve(privateRoot,'cloud-'+bundle.run_id);
  if(path.resolve(filename)!==path.join(directory,'bundle.json'))fail();
  const owner='synthetic-cloud-'+bundle.run_id,clients={};
  for(const role of roles){
    const config=bundle[role];
    if(config?.base_url!==base||config.owner_id!==owner||config.producer_id!=='cloud-'+role||
      path.resolve(config.credential_file??'')!==path.join(directory,role+'.json')||
      config.server_id!==bundle.agent?.server_id)fail();
    clients[role]=new BridgeClient(config);
    const identity=await clients[role].identity();
    if(['server_id','owner_id','producer_id'].some(key=>identity[key]!==config[key]))fail();
    if(!identity.capabilities?.includes('request_lifecycle_v1'))throw new Error('CLOUD_LIFECYCLE_NOT_DEPLOYED');
  }
  // Used for operations-only and explicit HTTP status assertions. Keep the
  // same redirect/size/deadline boundaries as the bridge transport.
  async function call(role,route,{method='GET',body}={}){
    if(!roles.includes(role)||!(/^(identity|operations\/summary|requests\/[A-Za-z0-9_-]+\/reconcile|tasks)$/.test(route)))fail();
    const response=await fetch(base+route,{method,redirect:'manual',signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+clients[role].token(),Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.status>=300&&response.status<400)throw new Error('CLOUD_REDIRECT_REFUSED');
    const reader=response.body?.getReader();if(!reader)throw new Error('CLOUD_INVALID_RESPONSE');
    let size=0;const chunks=[];
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>1048576){await reader.cancel();throw new Error('CLOUD_RESPONSE_TOO_LARGE');}chunks.push(value);}}
    finally{reader.releaseLock();}
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    return {status:response.status,body:value};
  }
  return {bundle,directory,...clients,call,
    submit:(kind,event)=>clients.phone.post(kind,event),
    get:(kind,id)=>clients.agent.object(kind,id),
    inbox:()=>clients.phone.inbox(null,50)};
}
