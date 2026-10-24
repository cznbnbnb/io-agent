// This computer's paired-device credential (2026-10-24, user: pair the phone once, no connection files).
// node rebuild/agent-bridge/device.mjs status | pair-phone <label> | devices | unpair <device_id>
// The credential itself comes from tools/collab/enroll-computer.mjs and renews inside BridgeClient.
import {BridgeClient,BridgeError,readPrivateJson} from './client.mjs';
import {deviceFile} from './questions/cli.mjs';
const out=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function main([command,...args]){
  const file=deviceFile();let device;try{device=readPrivateJson(file,4096);}catch{return out({error:'DEVICE_NOT_ENROLLED',device_file:file});}
  if(device.role!=='agent')return out({error:'DEVICE_NOT_ENROLLED',device_file:file});
  const client=new BridgeClient({schema_version:'1.0',base_url:device.base_url,owner_id:device.owner_id,producer_id:device.producer_id,server_id:device.server_id,credential_file:file,...(device.allow_loopback_http===true?{allow_loopback_http:true}:{})});
  if(command==='status'&&!args.length){const identity=await client.identity(),now=readPrivateJson(file,4096);
    return out({enrolled:true,device_id:device.device_id,computer_id:device.computer_id,label:device.label,owner_id:identity.owner_id,producer_id:identity.producer_id,expires_at:now.expires_at,refresh_after:now.refresh_after});}
  // The code is shown to the user on purpose: it is single-use and expires in 10 minutes.
  if(command==='pair-phone'&&args.length===1){const p=await client.createPairing(args[0]);return out({...p,instructions:'在手机 iO Agent「添加电脑连接 → 输入配对码」里输入，10 分钟内有效，只能用一次'});}
  if(command==='devices'&&!args.length)return out(await client.devices());
  if(command==='unpair'&&args.length===1)return out(await client.unpair(args[0]));
  out({error:'DEVICE_COMMAND_INVALID',commands:['status','pair-phone <label>','devices','unpair <device_id>']});process.exitCode=2;
}
main(process.argv.slice(2)).catch(e=>{out({error:e instanceof BridgeError?e.code:'DEVICE_COMMAND_FAILED',status:e?.status??null});process.exitCode=1;});
