// Debug-only settings operations. A durable intent precedes every device write;
// an interrupted operation is never automatically replayed.
export class DeviceSettingsSnapshot {
  peer: string = '';
  connection: number = 0;
  observed_at: number = 0;
  groups: Record<string,Record<string,number>> = {};
  bindings: Record<string,string> = {};
}
export interface DeviceSettingsPorts {
  command:()=>string|undefined;
  result:(id:string)=>string|undefined;
  save:(id:string,json:string)=>void;
  safe:()=>boolean;
  read:()=>Promise<DeviceSettingsSnapshot>;
  apply:(group:string,values:Record<string,number>)=>Promise<DeviceSettingsSnapshot>;
}
class DeviceSettingsRequest {
  schema:number=1;id:string='';action:string='';expires_at:number=0;
  group:string='';expected_binding:string='';values:Record<string,number>={};source_id:string='';
}
export class DeviceSettingsReceipt {
  schema:number=1;id:string='';request_json:string='';state:string='running';error:string='';
  group:string='';before:DeviceSettingsSnapshot|undefined=undefined;
  target:Record<string,number>={};after:DeviceSettingsSnapshot|undefined=undefined;
  effect_verified:boolean=false;
}
export const DEVICE_SETTING_GROUPS:string[]=['brightness','sleep','display','wakeup','crown','head','privacy','focus'];
export function validDeviceSetting(group:string,values:Record<string,number>):boolean {
  if(!values||typeof values!=='object'||Array.isArray(values))return false;
  let names:string[]=[],limits:number[][]=[];
  switch(group){
    case 'brightness':names=['value'];limits=[[1,17]];break;
    case 'sleep':return Object.keys(values).length===1&&[5,10,15,25,40,60,120].includes(values['seconds']);
    case 'display':names=['height','distance'];limits=[[1,6],[1,3]];break;
    case 'wakeup':names=['headup_on','degree','crown_switch'];limits=[[0,1],[0,70],[0,255]];break;
    case 'crown':names=['direction','double_action','long_press'];limits=[[0,1],[0,9],[0,9]];break;
    case 'head':names=['enabled','mode'];limits=[[0,1],[0,1]];break;
    case 'privacy':names=['mic_on','led_level','led_auto','log_on'];limits=[[0,1],[0,6],[0,1],[0,1]];break;
    case 'focus':names=['enabled','glass_close'];limits=[[0,1],[0,1]];break;
    default:return false;
  }
  return Object.keys(values).length===names.length&&names.every((key:string,index:number):boolean=>
    Number.isInteger(values[key])&&values[key]>=limits[index][0]&&values[key]<=limits[index][1]);
}
// Legacy values can be read and restored, but are not offered as new actions.
export function permittedDeviceSettingChange(group:string,target:Record<string,number>,before:Record<string,number>):boolean {
  if(!validDeviceSetting(group,target)||!before)return false;
  if(group==='wakeup')return [0,3].includes(target['crown_switch'])||target['crown_switch']===before['crown_switch'];
  if(group==='crown')return [0,1,2,3,4,5,7,8,9].includes(target['long_press'])||target['long_press']===before['long_press'];
  if(group==='privacy')return target['led_level']>=1||target['led_level']===before['led_level'];
  return true;
}
export function sameDeviceSetting(a:Record<string,number>,b:Record<string,number>):boolean {
  return !!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every((key:string):boolean=>a[key]===b[key]);
}
export class DeviceSettingsControl {
  private busy:boolean=false;
  private ports:DeviceSettingsPorts;
  constructor(ports:DeviceSettingsPorts){this.ports=ports;}
  private validate(value:DeviceSettingsRequest):boolean {
    if(!value||value.schema!==1||!/^dev-[a-f0-9]{32}$/.test(value.id)||!['read','set','restore'].includes(value.action)||
      !Number.isSafeInteger(value.expires_at)||value.expires_at>Date.now()+120000)return false;
    const keys=Object.keys(value),base=['schema','id','action','expires_at'];
    if(value.action==='read')return keys.length===4&&keys.every((key:string):boolean=>base.includes(key));
    const extra=value.action==='set'?['group','expected_binding','values']:['source_id','expected_binding'];
    if(keys.length!==4+extra.length||!keys.every((key:string):boolean=>base.includes(key)||extra.includes(key))||!/^[a-f0-9]{64}$/.test(value.expected_binding))return false;
    return value.action==='set'?validDeviceSetting(value.group,value.values):/^dev-[a-f0-9]{32}$/.test(value.source_id)&&value.source_id!==value.id;
  }
  async poll():Promise<void>{
    if(this.busy)return;this.busy=true;
    let request:DeviceSettingsRequest|undefined=undefined,receipt:DeviceSettingsReceipt|undefined=undefined;
    try{
      const raw=this.ports.command();if(!raw||raw.length>4096)return;
      request=JSON.parse(raw) as DeviceSettingsRequest;if(!this.validate(request))return;
      const canonical=JSON.stringify(request),prior=this.ports.result(request.id);
      if(prior){
        const saved=JSON.parse(prior) as DeviceSettingsReceipt;
        if(saved.request_json!==canonical)return;
        if(saved.state==='running'){saved.state='uncertain';saved.error='DEVICE_INTERRUPTED_NO_REPLAY';this.ports.save(request.id,JSON.stringify(saved));}
        return;
      }
      receipt=new DeviceSettingsReceipt();receipt.id=request.id;receipt.request_json=canonical;
      if(request.expires_at<=Date.now())throw new Error('DEVICE_EXPIRED');
      if(!this.ports.safe())throw new Error('DEVICE_BUSY_OR_NOT_READY');
      const before=await this.ports.read();receipt.before=before;
      if(request.action==='read'){receipt.after=before;receipt.state='complete';this.ports.save(request.id,JSON.stringify(receipt));return;}
      let group=request.group,target=request.values;
      if(request.action==='restore'){
        const sourceRaw=this.ports.result(request.source_id);if(!sourceRaw)throw new Error('DEVICE_SOURCE_MISSING');
        const source=JSON.parse(sourceRaw) as DeviceSettingsReceipt;
        const sourceRequest=JSON.parse(source.request_json) as DeviceSettingsRequest;
        if(source.id!==request.source_id||sourceRequest.action!=='set'||!source.before||source.before.peer!==before.peer||
          !DEVICE_SETTING_GROUPS.includes(source.group)||!validDeviceSetting(source.group,source.target))throw new Error('DEVICE_SOURCE_INVALID');
        group=source.group;target=source.before.groups[group];
        if(!validDeviceSetting(group,target)||!sameDeviceSetting(before.groups[group],source.target)&&!sameDeviceSetting(before.groups[group],target))throw new Error('DEVICE_RESTORE_CONFLICT');
      }
      if(before.bindings[group]!==request.expected_binding)throw new Error('DEVICE_BASELINE_CHANGED');
      if(request.action==='set'&&!permittedDeviceSettingChange(group,target,before.groups[group]))throw new Error('DEVICE_UNSUPPORTED_CHANGE');
      if(!this.ports.safe()||request.expires_at<=Date.now())throw new Error('DEVICE_BUSY_OR_EXPIRED');
      receipt.group=group;receipt.target=target;
      // Save the actual original values before the BLE side effect. Restart only
      // exposes an uncertain receipt and requires an explicit restore command.
      this.ports.save(request.id,JSON.stringify(receipt));
      const after=await this.ports.apply(group,target);receipt.after=after;
      if(after.peer!==before.peer||after.connection!==before.connection)throw new Error('DEVICE_CONNECTION_CHANGED');
      if(!sameDeviceSetting(after.groups[group],target))throw new Error('DEVICE_READBACK_MISMATCH');
      receipt.state='complete';this.ports.save(request.id,JSON.stringify(receipt));
    }catch(error){
      if(request&&receipt){receipt.error=/^DEVICE_[A-Z_]+$/.test((error as Error).message)?(error as Error).message:'DEVICE_FAILED';
        receipt.state=receipt.group?'uncertain':'error';try{this.ports.save(request.id,JSON.stringify(receipt));}catch{}}
    }finally{this.busy=false;}
  }
}
