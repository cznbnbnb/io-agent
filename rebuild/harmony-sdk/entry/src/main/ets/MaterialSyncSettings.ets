import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { MaterialSyncTarget, validateMaterialSyncTarget } from './MaterialSyncTransport';

interface SyncStorageError { code:number; }
export class MaterialSyncSettings {
  schema:number=1;enabled:boolean=false;target:MaterialSyncTarget=new MaterialSyncTarget();
}
export function validateMaterialSyncSettings(value:MaterialSyncSettings):void{
  if(value.schema!==1||typeof value.enabled!=='boolean'||!value.target||!value.target.principal||
    typeof value.target.baseUrl!=='string'||typeof value.target.token!=='string')throw new Error('SYNC_SETTINGS_INVALID');
  if(value.enabled||value.target.token||value.target.baseUrl||value.target.principal.ownerId||value.target.principal.producerId||value.target.principal.serverId)
    validateMaterialSyncTarget(value.target);
}
// Separate alias from model keys and legacy daily Markdown export settings.
// A locked/unreadable store is an error, never an empty replacement config.
export class SecureMaterialSyncSettings {
  private alias():Uint8Array{return new util.TextEncoder().encodeInto('turboio.material-sync.v1');}
  async load():Promise<MaterialSyncSettings>{
    const query:asset.AssetMap=new Map();query.set(asset.Tag.ALIAS,this.alias());query.set(asset.Tag.RETURN_TYPE,asset.ReturnType.ALL);
    let results:asset.AssetMap[];
    try{results=await asset.query(query);}catch(error){
      if((error as SyncStorageError).code===24000002)return new MaterialSyncSettings();
      throw new Error('SYNC_SETTINGS_UNAVAILABLE');
    }
    if(!results.length)return new MaterialSyncSettings();
    const bytes=results[0].get(asset.Tag.SECRET) as Uint8Array;
    try{
      if(bytes.length>8192)throw new Error('SYNC_SETTINGS_INVALID');
      const value=JSON.parse(new util.TextDecoder().decodeToString(bytes)) as MaterialSyncSettings;
      validateMaterialSyncSettings(value);return value;
    }catch{throw new Error('SYNC_SETTINGS_INVALID');}finally{bytes.fill(0);}
  }
  async save(value:MaterialSyncSettings):Promise<void>{
    validateMaterialSyncSettings(value);
    const bytes=new util.TextEncoder().encodeInto(JSON.stringify(value));
    try{
      if(bytes.length>8192)throw new Error('SYNC_SETTINGS_INVALID');
      const attrs:asset.AssetMap=new Map();attrs.set(asset.Tag.ALIAS,this.alias());attrs.set(asset.Tag.SECRET,bytes);
      attrs.set(asset.Tag.ACCESSIBILITY,asset.Accessibility.DEVICE_UNLOCKED);
      attrs.set(asset.Tag.CONFLICT_RESOLUTION,asset.ConflictResolution.OVERWRITE);
      await asset.add(attrs);
    }catch{throw new Error('SYNC_SETTINGS_SAVE_FAILED');}finally{bytes.fill(0);}
  }
}
