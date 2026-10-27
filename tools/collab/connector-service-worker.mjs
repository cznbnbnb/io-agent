import path from 'node:path';import {fileURLToPath} from 'node:url';
import {runConnector} from '../../rebuild/agent-bridge/connector.mjs';import {privateRecord} from '../../rebuild/agent-bridge/hosts/resident-manager.mjs';import {CLAUDE_ENV_KEYS} from './connector-service.mjs';
export function serviceEnvironment(file){
 const value=privateRecord(file);if(value===null||Array.isArray(value)||typeof value!=='object'||Object.entries(value).some(([key,v])=>!CLAUDE_ENV_KEYS.includes(key)||typeof v!=='string'||v.includes('\0')))throw Object.assign(new Error('CONNECTOR_SERVICE_ENV_INVALID'),{code:'CONNECTOR_SERVICE_ENV_INVALID'});return value;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [action,key,directory,deviceKey,deviceFile,...extra]=process.argv.slice(2);
 const main=async()=>{if(action!=='run'||key!=='--directory'||deviceKey!=='--device'||!path.isAbsolute(directory??'')||!path.isAbsolute(deviceFile??'')||extra.length)throw Object.assign(new Error('CONNECTOR_SERVICE_ARGUMENT_INVALID'),{code:'CONNECTOR_SERVICE_ARGUMENT_INVALID'});
  Object.assign(process.env,serviceEnvironment(path.join(directory,'service-env.json')));
  await runConnector(directory,{deviceFile,onReady:out=>process.stdout.write(JSON.stringify(out)+'\n')});return{stopped:true};};
 main().then(out=>console.log(JSON.stringify(out)),e=>{console.error(JSON.stringify({ok:false,error:/^[A-Z][A-Z0-9_]{0,100}$/.test(e.code??'')?e.code:'CONNECTOR_SERVICE_FAILED'}));process.exitCode=1;});
}
