import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {loadApp} from './load-app.mjs';
test('probe binding follows connection and owner, without exposing manuscript or peer',()=>{
 const p={active:true,phase:'paused',canRequestExit:true,mode:2,progress:100,pendingWrites:0,fileComplete:true,preparationReady:true,lastQueryState:1,lastQueryFailure:'',cleanupEvidence:'none',cleanupSessionId:'test-owner',title:'private-title',manuscript:'private-body'};
 const session={features:{state:{connected:true}},foreground:true,peerDeviceId:'private-peer',auth:{connectionGeneration:7}};
 const cryptoFramework={createMd:()=>{let b;return{updateSync:input=>b=input.data.slice(),digestSync:()=>({data:Uint8Array.from(createHash('sha256').update(b).digest())})};}};
 const {prompterProbeSnapshot}=loadApp('PrompterProbeService',{'./TeleprompterService':{teleprompter:p},'./ProbeSession':{probeSession:session},'@kit.CryptoArchitectureKit':{cryptoFramework}});
 const a=prompterProbeSnapshot(),json=JSON.stringify(a);assert(a.binding.match(/^[a-f0-9]{64}$/));for(const secret of ['private-peer','private-title','private-body','test-owner'])assert(!json.includes(secret));
 session.auth.connectionGeneration++;assert.notEqual(prompterProbeSnapshot().binding,a.binding);session.auth.connectionGeneration--;p.cleanupSessionId='next-owner';assert.notEqual(prompterProbeSnapshot().binding,a.binding);
 session.features.state.connected=false;assert.equal(prompterProbeSnapshot().binding,'');p.cleanupEvidence='user_confirmation';assert.equal(prompterProbeSnapshot().exit_evidence,'user_confirmation');
});
