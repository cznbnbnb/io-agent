// Read-only real-cloud P41 transport check. The runtime stays non-executable.
// The offline phase blocks only this client's fetch, not the PC/phone network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AgentBridge} from '../../rebuild/agent-bridge/bridge.mjs';

const root=path.resolve('rebuild/material-server/private');
const query=JSON.parse(fs.readFileSync(path.join(root,'query-config.json'),'utf8'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-live-bridge-'));
const stateFile=path.join(dir,'state.json');
const config={...query,producer_id:'pc-desktop',credential_file:path.join(root,'pc-desktop.json'),state_file:stateFile};
let offline=false,writes=0,bridge;
const steps=[];
const fetchImpl=async(url,options)=>{
  if(options.method!=='GET'){writes++;throw new Error('READ_ONLY_PROBE');}
  if(offline)throw new Error('CLIENT_OFFLINE_SYNTHETIC');
  return fetch(url,options);
};
try{
  bridge=new AgentBridge({config,stateFile,fetchImpl});
  const start=await bridge.start();assert.equal(start.can_execute,false);assert.equal(start.server_id,query.server_id);
  steps.push({step:'public_tls_identity_and_required_scopes',passed:true});
  const first=await bridge.pollOnce();assert.equal(first.handled,0);assert.equal(first.pending,0);
  const cursor=bridge.status().cursor;assert.equal(cursor,null);
  steps.push({step:'cloud_inbox_observed_without_claim_or_cursor_consumption',passed:true,items:first.items});
  const before=fs.readFileSync(stateFile);
  offline=true;
  await assert.rejects(bridge.pollOnce(),error=>error.code==='NETWORK_UNAVAILABLE'&&error.retryable);
  assert.equal(bridge.status().cursor,cursor);assert.deepEqual(fs.readFileSync(stateFile),before);
  steps.push({step:'client_injected_offline_preserves_ledger',passed:true,network_outage_real:false});
  offline=false;
  const recovered=await bridge.pollOnce();assert.equal(recovered.handled,0);assert.equal(recovered.pending,0);
  steps.push({step:'public_cloud_read_after_client_recovery',passed:true});
  await bridge.stop();bridge=new AgentBridge({config,stateFile,fetchImpl});await bridge.start();
  assert.equal((await bridge.pollOnce()).handled,0);assert.equal(bridge.status().cursor,cursor);assert.equal(writes,0);
  steps.push({step:'bridge_object_reopen_and_public_read',passed:true,process_restart_tested:false});
  const report={at:new Date().toISOString(),status:'passed',base_url:config.base_url,steps,server_writes:writes,
    scope:'real cloud TLS/identity/inbox; observe-only; synthetic client offline injection; bridge object reopen',
    not_verified:['runtime execution','real network outage','process kill recovery','task question/answer','phone task delegation']};
  fs.writeFileSync('rebuild/phase1/bridge-public-live-verification-2026-10-12.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,steps:steps.map(s=>[s.step,s.passed]),server_writes:writes}));
}catch(error){console.error(JSON.stringify({status:'failed',code:typeof error.code==='string'?error.code:'PROBE_FAILED',completed_steps:steps}));process.exitCode=1;}
finally{await bridge?.stop();fs.rmSync(dir,{recursive:true,force:true});}
