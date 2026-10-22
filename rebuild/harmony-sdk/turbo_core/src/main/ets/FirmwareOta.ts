// Original implementation of the observed files/Mode2 protocol. No device I/O.
import { util } from '@kit.ArkTS';
export class OtaMessage { type:number=0;json:Uint8Array=new Uint8Array();binary:Uint8Array=new Uint8Array(); }
export function readOtaMessage(bytes:Uint8Array):OtaMessage{
  if(bytes.length<4||bytes.length>52000)throw new Error('OTA_FRAME_SIZE');
  let pos=0,seen=0,version=0;const out=new OtaMessage();
  const variable=():number=>{let value=0;for(let i=0;i<5;i++){if(pos>=bytes.length)throw new Error('OTA_TRUNCATED');const b=bytes[pos++];if(i===4&&b>15)throw new Error('OTA_VARINT');value+=(b&127)*Math.pow(128,i);if(!(b&128)){if(i>0&&b===0)throw new Error('OTA_VARINT');return value;}}throw new Error('OTA_VARINT');};
  while(pos<bytes.length){const key=variable(),tag=Math.floor(key/8),wire=key%8;if(tag<1||tag>6||(seen&(1<<tag)))throw new Error('OTA_FIELD');seen|=1<<tag;
    if(tag===3||tag===4){const size=variable();if(wire!==2||size>bytes.length-pos||size>(tag===3?8192:51200))throw new Error('OTA_FIELD_SIZE');const data=bytes.slice(pos,pos+size);pos+=size;if(tag===3)out.json=data;else out.binary=data;}
    else{if(wire!==0)throw new Error('OTA_WIRE');const value=variable();if(tag===1)version=value;else if(tag===2)out.type=value;else if(value!==0)throw new Error('OTA_FLAGS');}
  }
  if(version!==1||out.type<1||out.type>255)throw new Error('OTA_VERSION');return out;
}
export function otaMessage(type:number,json:Uint8Array,binary:Uint8Array=new Uint8Array()):Uint8Array{
  if(!Number.isInteger(type)||type<1||type>255||json.length>8192||binary.length>51200)throw new Error('OTA_FRAME_SIZE');
  const out:number[]=[8,1,16];const variable=(n:number):void=>{do{const b=n%128;n=Math.floor(n/128);out.push(b|(n?128:0));}while(n);};variable(type);
  out.push(26);variable(json.length);for(const b of json)out.push(b);if(binary.length){out.push(34);variable(binary.length);for(const b of binary)out.push(b);}return new Uint8Array(out);
}
function object(bytes:Uint8Array):Record<string,Object>{
  const value=JSON.parse(bytes.length?new util.TextDecoder('utf-8',{fatal:true}).decodeToString(bytes):'{}') as Record<string,Object>;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('OTA_JSON');return value;
}
function exact(value:Record<string,Object>,keys:string[]):boolean{return Object.keys(value).length===keys.length&&keys.every((key:string):boolean=>Object.keys(value).includes(key));}
export function isOtaOutbound(bytes:Uint8Array,flash:boolean):boolean{
  try{const m=readOtaMessage(bytes);if([1,2,11].includes(m.type))return m.binary.length===0&&exact(object(m.json),[]);
    if(m.type===3){const j=object(m.json);return !m.binary.length&&exact(j,['OtaSize'])&&Number.isSafeInteger(j['OtaSize'])&&Number(j['OtaSize'])===8735334;}
    if(!flash)return false;
    if(m.type===4){const j=object(m.json);return !m.binary.length&&exact(j,['Mode'])&&j['Mode']===2;}
    if(m.type===5){const j=object(m.json);return !m.binary.length&&exact(j,['OtaVersion'])&&j['OtaVersion']==='Strix OS 1.0.5.5';}
    if(m.type===6){const j=JSON.parse(new util.TextDecoder('utf-8',{fatal:true}).decodeToString(m.json)) as Object[];return !m.binary.length&&Array.isArray(j)&&j.length===15;}
    if(m.type===7){const j=object(m.json);return exact(j,['Name','Start','Size'])&&typeof j['Name']==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(j['Name'] as string)&&Number.isSafeInteger(j['Start'])&&Number(j['Start'])>=0&&Number.isSafeInteger(j['Size'])&&Number(j['Size'])===m.binary.length&&m.binary.length>0;}
    return false;
  }catch(_){return false;}
}
export class OtaRange { start:number=0;end:number=0;constructor(start:number,end:number){this.start=start;this.end=end;} }
export class OtaCoverage {
  ranges:OtaRange[]=[];bytes:number=0;
  add(start:number,end:number):void{
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start)throw new Error('OTA_RANGE');
    const merged:OtaRange[]=[];let low=start,high=end,inserted=false;
    for(const r of this.ranges){if(r.end<low)merged.push(r);else if(r.start>high){if(!inserted){merged.push(new OtaRange(low,high));inserted=true;}merged.push(r);}else{low=Math.min(low,r.start);high=Math.max(high,r.end);}}
    if(!inserted)merged.push(new OtaRange(low,high));if(merged.length>2048)throw new Error('OTA_COVERAGE_BUDGET');this.ranges=merged;this.bytes=merged.reduce((n:number,r:OtaRange):number=>n+r.end-r.start,0);
  }
}
export class OtaMember {name:string='';size:number=0;sha256:string='';md5:string='';}
export class OtaAction {type:number=0;body:string='{}';name:string='';start:number=0;size:number=0;constructor(type:number,body:string='{}'){this.type=type;this.body=body;} }
export class FirmwareOtaSession {
  phase:string='idle';reason:string='';peer:string='';connection:number=0;started:boolean=false;deadline:number=0;freshAt:number=0;battery:number=-1;
  sentBytes:number=0;requests:number=0;coverage:Map<string,OtaCoverage>=new Map();installSeenAt:number=0;progress:number=-1;
  private members:OtaMember[]=[];private manifest:string='';
  prepare(peer:string,connection:number,members:OtaMember[],manifest:string,now:number):OtaAction{
    if(this.phase!=='idle'||!peer||!Number.isSafeInteger(connection)||members.length!==15||new Set(members.map((m:OtaMember):string=>m.name)).size!==15||
      members.some((m:OtaMember):boolean=>!/^[A-Za-z0-9_.-]{1,64}$/.test(m.name)||!Number.isSafeInteger(m.size)||m.size<1)||
      members.reduce((n:number,m:OtaMember):number=>n+m.size,0)>32000000||members.find((m:OtaMember):boolean=>m.name==='nuttx_ap.bin')?.size!==7208648)throw new Error('OTA_PREPARE');
    this.peer=peer;this.connection=connection;this.members=members;this.manifest=manifest;this.phase='version';this.deadline=now+15000;return new OtaAction(1);
  }
  fail(reason:string):void{this.phase=this.started?'unknown':'failed';this.reason=reason;this.deadline=0;}
  check(peer:string,connection:number,now:number):void{
    if(['idle','failed','unknown','installing','readback_ready'].includes(this.phase))return;
    if(peer!==this.peer||connection!==this.connection){this.fail('OTA_CONNECTION_CHANGED');return;}
    if(this.deadline>0&&now>=this.deadline)this.fail('OTA_REPLY_TIMEOUT');
  }
  start(peer:string,connection:number,now:number):OtaAction{
    this.check(peer,connection,now);if(this.phase!=='ready'||now-this.freshAt>120000||this.battery<50)throw new Error('OTA_NOT_READY');
    this.started=true;this.phase='starting';this.deadline=now+30000;return new OtaAction(4,'{"Mode":2}');
  }
  receive(peer:string,connection:number,bytes:Uint8Array,now:number):OtaAction|undefined{
    this.check(peer,connection,now);if(['idle','failed','unknown','installing','readback_ready'].includes(this.phase))return undefined;
    try{
      if(peer!==this.peer||connection!==this.connection)throw new Error('OTA_CONNECTION_CHANGED');
      const m=readOtaMessage(bytes);if(m.binary.length)throw new Error('OTA_UNEXPECTED_BINARY');const j=object(m.json);
      if(m.type===10){if(!Number.isSafeInteger(j['errcode'])||Number(j['errcode'])<0||Number(j['errcode'])>65535)throw new Error('OTA_DEVICE_ERROR_FORMAT');throw new Error('OTA_DEVICE_ERROR_'+String(j['errcode']));}
      if(this.phase==='version'||this.phase==='read_version'){
        if(m.type!==1||j['OsVersion']!=='Strix OS 1.0.5.5'||j['OtaValidationState']!=='idle'||j['OtaValidationConfirmed']!==true||!Array.isArray(j['PackageTypes'])||!(j['PackageTypes'] as string[]).includes('files'))throw new Error('OTA_DEVICE_VERSION_OR_VALIDATION');
        const readback=this.phase==='read_version';this.phase=readback?'read_idle':'battery';this.deadline=now+15000;return new OtaAction(readback?11:2);
      }
      if(this.phase==='battery'){
        if(m.type!==2||!Number.isInteger(j['BatteryLevel'])||Number(j['BatteryLevel'])<50||Number(j['BatteryLevel'])>100)throw new Error('OTA_BATTERY');this.battery=Number(j['BatteryLevel']);this.phase='space';this.deadline=now+15000;return new OtaAction(3,'{"OtaSize":8735334}');
      }
      if(this.phase==='space'){if(m.type!==3||j['Result']!==true)throw new Error('OTA_SPACE');this.phase='device_idle';this.deadline=now+15000;return new OtaAction(11);}
      if(this.phase==='device_idle'||this.phase==='read_idle'){
        if(m.type!==11||j['Result']!==true)throw new Error('OTA_DEVICE_BUSY');this.phase=this.phase==='read_idle'?'readback_ready':'ready';this.deadline=0;this.freshAt=now;return undefined;
      }
      if(this.phase==='starting'){if(m.type!==4||j['Result']!==true)throw new Error('OTA_START_REJECTED');this.phase='request_version';this.deadline=now+30000;return undefined;}
      if(this.phase==='request_version'){if(m.type!==5||!exact(j,[]))throw new Error('OTA_VERSION_REQUEST');this.phase='request_manifest';this.deadline=now+30000;return new OtaAction(5,'{"OtaVersion":"Strix OS 1.0.5.5"}');}
      if(this.phase==='request_manifest'){if(m.type!==6||j['OtaVersion']!=='Strix OS 1.0.5.5')throw new Error('OTA_MANIFEST_REQUEST');this.phase='transfer';this.deadline=now+60000;return new OtaAction(6,this.manifest);}
      if(this.phase==='transfer'){
        // The device emits a progress notification ({Progress:n}) between slice
        // requests. It is not a slice request and must not fail the transfer.
        if(m.type===8){
          if(!exact(j,['Progress'])||!Number.isSafeInteger(j['Progress'])||Number(j['Progress'])<0||Number(j['Progress'])>1000000)throw new Error('OTA_PROGRESS_FORMAT');
          this.progress=Number(j['Progress']);this.deadline=now+60000;return undefined;
        }
        if(m.type===9){if(!exact(j,[])||this.coverage.get('nuttx_ap.bin')?.bytes!==7208648)throw new Error('OTA_PREMATURE_INSTALL');this.phase='installing';this.deadline=0;this.installSeenAt=now;return undefined;}
        if(m.type!==7)throw new Error('OTA_SLICE_TYPE_'+String(m.type));
        if(!exact(j,['Name','Start','Size']))throw new Error('OTA_SLICE_KEYS');
        if(typeof j['Name']!=='string'||!Number.isSafeInteger(j['Start'])||!Number.isSafeInteger(j['Size']))throw new Error('OTA_SLICE_TYPES');
        const name=j['Name'] as string,start=Number(j['Start']),size=Number(j['Size']),member=this.members.find((f:OtaMember):boolean=>f.name===name);
        if(!member)throw new Error('OTA_SLICE_MEMBER');
        if(start<0||size<1||size>51200||start+size>member.size||this.requests>=2000||this.sentBytes+size>64000000)throw new Error('OTA_SLICE_BOUNDS');
        this.requests++;this.sentBytes+=size;this.deadline=now+60000;const action=new OtaAction(7,JSON.stringify(j));action.name=name;action.start=start;action.size=size;return action;
      }
      throw new Error('OTA_PHASE');
    }catch(error){this.fail((error as Error).message);return undefined;}
  }
  sent(action:OtaAction):void{if(action.type!==7)return;let c=this.coverage.get(action.name);if(!c){c=new OtaCoverage();this.coverage.set(action.name,c);}c.add(action.start,action.start+action.size);}
  readback(peer:string,connection:number,now:number):OtaAction{
    if(!this.started||!['unknown','installing','readback_ready'].includes(this.phase)||!peer||peer!==this.peer)throw new Error('OTA_READBACK_PHASE');
    this.peer=peer;this.connection=connection;this.reason='';this.phase='read_version';this.deadline=now+15000;return new OtaAction(1);
  }
}
