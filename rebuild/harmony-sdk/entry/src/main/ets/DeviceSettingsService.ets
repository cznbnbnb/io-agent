import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { probeSession } from './ProbeSession';
import { DeviceSettingsSnapshot,DeviceSettingsPorts,DEVICE_SETTING_GROUPS,validDeviceSetting } from './DeviceSettingsControl';

function digest(text:string):string {
  const bytes=new util.TextEncoder().encodeInto(text),md=cryptoFramework.createMd('SHA256');
  try{md.updateSync({data:bytes});const hash=md.digestSync().data;
    try{return Array.from(hash).map((value:number):string=>value.toString(16).padStart(2,'0')).join('');}finally{hash.fill(0);}
  }finally{bytes.fill(0);}
}
function safe():boolean {
  const p=probeSession;
  return p.foreground&&p.features.state.connected&&!p.notificationOccupied()&&!p.features.launcherBusy&&!p.voice.active&&!p.voice.pendingWrites&&!p.recordingOccupied()&&!p.lifelogOccupied()&&
    !p.prompterOccupied()&&!p.agentCaptureOccupied&&!p.agentSuggestionOccupied&&!p.features.displayActive&&!p.features.launcherBusy;
}
async function waitFor(test:()=>boolean,connection:number):Promise<void>{
  const end=Date.now()+12500;
  while(!test()){
    if(!probeSession.foreground||!probeSession.features.state.connected||probeSession.features.state.connectionRev!==connection)throw new Error('DEVICE_CONNECTION_CHANGED');
    if(Date.now()>=end)throw new Error('DEVICE_READBACK_TIMEOUT');
    await new Promise<void>((resolve:()=>void):void=>{setTimeout(resolve,50);});
  }
  if(!probeSession.foreground||!probeSession.features.state.connected||probeSession.features.state.connectionRev!==connection)throw new Error('DEVICE_CONNECTION_CHANGED');
}
function numericGroup(keys:string[],values:number[]):Record<string,number> {
  const result:Record<string,number>={};
  for(let i=0;i<keys.length;i++)result[keys[i]]=values[i];
  return result;
}
async function fresh():Promise<DeviceSettingsSnapshot>{
  if(!safe())throw new Error('DEVICE_BUSY_OR_NOT_READY');
  const f=probeSession.features,s=f.state,connection=s.connectionRev,status=s.statusReadSerial,settings=s.settingsReadSerial;
  await f.refreshStatus();await waitFor(():boolean=>s.statusReadSerial>status&&!f.launcherBusy,connection);
  if(!safe())throw new Error('DEVICE_BUSY_OR_NOT_READY');
  await f.refreshSettings();await waitFor(():boolean=>s.settingsReadSerial>settings&&!f.launcherBusy,connection);
  const actual=JSON.parse(s.settingsJson)['generalSettings'] as Record<string,Record<string,number>>;
  const statusObject=JSON.parse(s.statusJson)['generalStatus'] as Record<string,Object>;
  const snapshot=new DeviceSettingsSnapshot();snapshot.peer=digest(probeSession.peerDeviceId);snapshot.connection=connection;snapshot.observed_at=Date.now();
  snapshot.groups['brightness']=numericGroup(['value'],[statusObject['brightness'] as number]);
  snapshot.groups['sleep']=numericGroup(['seconds'],[actual['autoLockTime'] as Object as number]);
  snapshot.groups['display']=numericGroup(['height','distance'],[actual['displayConfig']?.['height'],actual['displayConfig']?.['distance']]);
  snapshot.groups['wakeup']=numericGroup(['headup_on','degree','crown_switch'],[actual['wakeupConfig']?.['headupSwitch'],actual['wakeupConfig']?.['headupDegree'],actual['wakeupConfig']?.['crownSwitch']]);
  snapshot.groups['crown']=numericGroup(['direction','double_action','long_press'],[actual['crownConfig']?.['direction'],actual['crownConfig']?.['double'],actual['crownConfig']?.['longPress']]);
  snapshot.groups['head']=numericGroup(['enabled','mode'],[actual['headGestures']?.['enabled'],actual['headGestures']?.['mode']]);
  snapshot.groups['privacy']=numericGroup(['mic_on','led_level','led_auto','log_on'],[actual['privacyConfig']?.['mic_switch'],actual['privacyConfig']?.['led_light'],actual['privacyConfig']?.['led_auto_light'],actual['privacyConfig']?.['log_switch']]);
  const focus=statusObject['focusMode'] as Record<string,number>;
  snapshot.groups['focus']=numericGroup(['enabled','glass_close'],[focus?.['enable'],focus?.['enableGlassClose']]);
  const projected=snapshot.groups;snapshot.groups={};
  for(const group of DEVICE_SETTING_GROUPS){
    const values=projected[group];
    if(validDeviceSetting(group,values)){
      snapshot.groups[group]=values;
      snapshot.bindings[group]=digest(snapshot.peer+'\n'+String(connection)+'\n'+group+'\n'+JSON.stringify(values));
    }
  }
  return snapshot;
}
async function apply(group:string,v:Record<string,number>):Promise<DeviceSettingsSnapshot>{
  if(!safe()||!validDeviceSetting(group,v))throw new Error('DEVICE_BUSY_OR_INVALID');
  const f=probeSession.features,connection=f.state.connectionRev;
  switch(group){
    case 'brightness':await f.brightness(v['value']);break;
    case 'sleep':await f.sleepTime(v['seconds']);break;
    case 'display':await f.writeDisplay(v['height'],v['distance']);break;
    case 'wakeup':await f.writeWakeup(v['headup_on']===1,v['degree'],v['crown_switch']);break;
    case 'crown':await f.writeCrown(v['direction'],v['double_action'],v['long_press']);break;
    case 'head':await f.writeHeadGestures(v['enabled']===1,v['mode']);break;
    case 'privacy':await f.writePrivacy(v['mic_on']===1,v['led_level'],v['led_auto']===1,v['log_on']===1);break;
    case 'focus':await f.writeFocus(v['enabled']===1,v['glass_close']===1);break;
    default:throw new Error('DEVICE_INVALID_GROUP');
  }
  await waitFor(():boolean=>!f.launcherBusy,connection);
  if(!f.state.note.includes('读回确认已生效'))throw new Error('DEVICE_READBACK_UNCONFIRMED');
  return fresh();
}
export function deviceSettingsPorts(command:()=>string|undefined,result:(id:string)=>string|undefined,save:(id:string,json:string)=>void):DeviceSettingsPorts {
  return {command,result,save,safe,read:fresh,apply};
}
