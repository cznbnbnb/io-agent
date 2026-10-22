// Explicit, bounded live observer for a synthetic phone task verification.
// It runs the real existing Agent bridge/adapter. No phone-role client or
// delegate/answer driver is created: commands and answers must come from phone.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AgentBridge} from '../../rebuild/agent-bridge/bridge.mjs';
import {AdapterHost} from '../../rebuild/agent-bridge/adapter-host.mjs';
import {readPrivateJson,BridgeError} from '../../rebuild/agent-bridge/client.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const [flag,runId]=process.argv.slice(2);
if(flag!=='--run-synthetic-phone'||!/^phone[0-9]{3}-[a-z0-9-]{1,40}$/.test(runId??''))throw Error('EXPLICIT_PHONE_VERIFICATION_REQUIRED');
const run=path.join(root,'rebuild/agent-bridge/private','phone-'+runId),file=path.join(run,'bridge-config.json');
const config=readPrivateJson(file);
if(config.owner_id!=='synthetic-cloud-'+runId||config.producer_id!=='cloud-agent'||config.base_url!=='https://cznbnb.cn/io-api/v1/'||
  !Array.isArray(config.adapter_command)||config.adapter_command.length!==7||config.adapter_command.at(-1)!==path.join(run,'home/runtime.json'))throw Error('SYNTHETIC_PHONE_BINDING_REQUIRED');
const reportFile=path.join(root,'rebuild/phase1',runId+'-live-observation.json');
if(fs.existsSync(reportFile)||fs.existsSync(path.join(run,'stop.requested')))throw Error('LIVE_OBSERVER_ALREADY_ATTEMPTED');
const report={at:new Date().toISOString(),runId,status:'starting',synthetic:true,phoneRoleSubmissionsByThisTool:0,polls:0,
  scope:'real cloud agent bridge and isolated real Hermes; normal phone is sole command/answer producer',endToEndAccepted:false};
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
const host=new AdapterHost({command:config.adapter_command[0],args:config.adapter_command.slice(1),timeoutMs:config.adapter_timeout_ms,name:'hermes-phone-verification'});
const bridge=new AgentBridge({config,adapter:host,stateFile:config.state_file});
let stopping=false;process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
try{
  await bridge.start();report.status='running';save();process.stdout.write(JSON.stringify({status:'ready',runId})+'\n');
  const deadline=Date.now()+20*60000;
  while(!stopping&&!fs.existsSync(path.join(run,'stop.requested'))&&Date.now()<deadline){
    await bridge.pollOnce();report.polls++;if(report.polls%10===0)save();
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  report.status='stopped';report.reason=Date.now()>=deadline?'bounded_deadline':'explicit_stop';
}catch(error){report.status='failed';report.error=error instanceof BridgeError?error.code:'LIVE_OBSERVER_FAILED';process.exitCode=1;}
finally{
  try{await bridge.stop();report.bridgeStopped=true;}catch{report.bridgeStopped=false;process.exitCode=1;}
  report.finishedAt=new Date().toISOString();save();process.stdout.write(JSON.stringify({status:report.status,polls:report.polls,bridgeStopped:report.bridgeStopped})+'\n');
}
