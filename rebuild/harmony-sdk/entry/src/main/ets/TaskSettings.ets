import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { TaskTarget, validateTaskTarget } from './TaskTransport';
import { TaskRoute, taskRouteValid } from './TaskWire';

interface TaskStorageError {code:number;}
export class TaskSettings {schema:number=1;enabled:boolean=false;target:TaskTarget=new TaskTarget();route:TaskRoute=new TaskRoute();}
export function validateTaskSettings(value:TaskSettings):void {
  if(!value||value.schema!==1||typeof value.enabled!=='boolean'||!value.target||!value.target.principal||!value.route||
    typeof value.target.baseUrl!=='string'||typeof value.target.token!=='string'||
    [value.route.computer_id,value.route.agent_id,value.route.project_id,value.route.session_id].some((s:string):boolean=>typeof s!=='string'))throw new Error('TASK_SETTINGS_INVALID');
  if(value.enabled||value.target.baseUrl||value.target.token||value.target.principal.ownerId||value.target.principal.producerId||value.target.principal.serverId)validateTaskTarget(value.target);
  if((value.enabled||value.route.computer_id||value.route.agent_id||value.route.project_id||value.route.session_id)&&!taskRouteValid(value.route))throw new Error('TASK_ROUTE_INVALID');
}
export class SecureTaskSettings {
  private alias():Uint8Array{return new util.TextEncoder().encodeInto('turboio.tasks.v1');}
  async load():Promise<TaskSettings>{
    const query:asset.AssetMap=new Map();query.set(asset.Tag.ALIAS,this.alias());query.set(asset.Tag.RETURN_TYPE,asset.ReturnType.ALL);
    let results:asset.AssetMap[];
    try{results=await asset.query(query);}catch(error){if((error as TaskStorageError).code===24000002)return new TaskSettings();throw new Error('TASK_SETTINGS_UNAVAILABLE');}
    if(!results.length)return new TaskSettings();const bytes=results[0].get(asset.Tag.SECRET) as Uint8Array;
    try{if(bytes.length>8192)throw new Error('TASK_SETTINGS_INVALID');const value=JSON.parse(new util.TextDecoder().decodeToString(bytes)) as TaskSettings;validateTaskSettings(value);return value;}
    catch{throw new Error('TASK_SETTINGS_INVALID');}finally{bytes.fill(0);}
  }
  async save(value:TaskSettings):Promise<void>{
    validateTaskSettings(value);const bytes=new util.TextEncoder().encodeInto(JSON.stringify(value));
    try{if(bytes.length>8192)throw new Error('TASK_SETTINGS_INVALID');const attrs:asset.AssetMap=new Map();
      attrs.set(asset.Tag.ALIAS,this.alias());attrs.set(asset.Tag.SECRET,bytes);attrs.set(asset.Tag.ACCESSIBILITY,asset.Accessibility.DEVICE_UNLOCKED);
      attrs.set(asset.Tag.CONFLICT_RESOLUTION,asset.ConflictResolution.OVERWRITE);await asset.add(attrs);
    }catch{throw new Error('TASK_SETTINGS_SAVE_FAILED');}finally{bytes.fill(0);}
  }
}
