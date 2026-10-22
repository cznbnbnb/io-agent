import { hilog } from '@kit.PerformanceAnalysisKit';
import { MaterialStore } from './MaterialStore';
import { MaterialSyncCoordinator, MaterialSyncSummary, MaterialSyncView, MaterialSyncProblem } from './MaterialSyncCoordinator';
import { MaterialSyncSettings, SecureMaterialSyncSettings, validateMaterialSyncSettings } from './MaterialSyncSettings';

export class MaterialSyncService {
  changed:()=>void=():void=>{};settingsNote:string='';
  private coordinator:MaterialSyncCoordinator|undefined=undefined;
  private vault:SecureMaterialSyncSettings=new SecureMaterialSyncSettings();
  private generation:number=0;private saving:boolean=false;
  private skippedReload:MaterialSyncCoordinator|undefined=undefined;private skippedReloadGeneration:number=0;
  private closing:Promise<void>=Promise.resolve();
  private foreground:boolean=false;private retryTimer:number=-1;private retryAttempt:number=0;
  private cancelSettingsRetry():void{
    if(this.retryTimer>=0)clearTimeout(this.retryTimer);this.retryTimer=-1;
  }
  private scheduleSettingsRetry(coordinator:MaterialSyncCoordinator,generation:number):void{
    const delays:number[]=[1000,3000,10000,30000,30000];
    if(!this.foreground||this.saving||coordinator!==this.coordinator||generation!==this.generation||
      this.retryTimer>=0||this.retryAttempt>=delays.length)return;
    const delay=delays[this.retryAttempt++];
    const timer=setTimeout(():void=>{
      // A cancelled callback already queued by the platform cannot erase a new
      // timer or reload credentials into a later settings/runtime generation.
      if(this.retryTimer!==timer||!this.foreground||this.saving||
        coordinator!==this.coordinator||generation!==this.generation)return;
      this.retryTimer=-1;this.reloadAttempt().catch(():void=>{});
    },delay);
    this.retryTimer=timer;
    try{hilog.info(0x0000,'TurboIO','[MaterialSync] settings retry attempt=%{public}d delay_ms=%{public}d',this.retryAttempt,delay);}catch{}
  }
  private notify():void{try{this.changed();}catch{}}
  initialize(filesDir:string,store:MaterialStore):void{
    if(this.coordinator)return;
    this.coordinator=new MaterialSyncCoordinator(filesDir,store);
    this.coordinator.changed=():void=>this.notify();
  }
  setForeground(value:boolean):void{
    this.foreground=value;this.cancelSettingsRetry();this.retryAttempt=0;
    if(!value){this.skippedReload=undefined;if(!this.saving)++this.generation;}
    this.coordinator?.setForeground(value);
    if(value)this.reload().catch(():void=>{});
  }
  async settings():Promise<MaterialSyncSettings>{return this.vault.load();}
  async reload():Promise<void>{
    if(this.saving){
      if(this.foreground&&this.coordinator){this.skippedReload=this.coordinator;this.skippedReloadGeneration=this.generation;}
      return;
    }
    this.skippedReload=undefined;this.cancelSettingsRetry();this.retryAttempt=0;
    await this.reloadAttempt();
  }
  private async reloadAttempt():Promise<void>{
    if(this.saving)return;
    const coordinator=this.coordinator,generation=++this.generation;if(!coordinator)return;
    try{
      await this.closing;if(generation!==this.generation||coordinator!==this.coordinator)return;
      await coordinator.configure(undefined);
      if(generation!==this.generation||coordinator!==this.coordinator)return;
      const value=await this.vault.load();if(generation!==this.generation||coordinator!==this.coordinator)return;
      await coordinator.configure(value.enabled?value.target:undefined);
      if(generation===this.generation){
        if(this.retryAttempt>0){try{hilog.info(0x0000,'TurboIO','[MaterialSync] settings recovered_after_attempt=%{public}d',this.retryAttempt);}catch{}}
        this.cancelSettingsRetry();this.retryAttempt=0;this.settingsNote='';this.notify();
      }
    }catch(error){
      if(generation===this.generation&&coordinator===this.coordinator){
        this.settingsNote='同步配置暂不可读，请解锁后重试；未覆盖已保存配置';this.notify();
        // Only an unavailable vault is temporary. Invalid/absent settings and
        // queue/configuration failures never authorize invented credentials.
        if((error as Error)?.message==='SYNC_SETTINGS_UNAVAILABLE')this.scheduleSettingsRetry(coordinator,generation);
      }
    }
  }
  async save(value:MaterialSyncSettings):Promise<void>{
    if(this.saving||!this.coordinator)throw new Error('同步设置忙，请稍后重试');
    const snapshot=JSON.parse(JSON.stringify(value)) as MaterialSyncSettings;validateMaterialSyncSettings(snapshot);
    this.skippedReload=undefined;this.cancelSettingsRetry();this.retryAttempt=0;
    const coordinator=this.coordinator,generation=++this.generation;this.saving=true;
    let persisted:boolean=false;
    try{
      // Pause before persisting replacement credentials; an old request cannot
      // race a new ledger writer. Do not resume if saving itself fails.
      await this.closing;
      if(generation!==this.generation||coordinator!==this.coordinator)return;
      await coordinator.configure(undefined);await this.vault.save(snapshot);persisted=true;
      if(generation!==this.generation||coordinator!==this.coordinator)return;
      await coordinator.configure(snapshot.enabled?snapshot.target:undefined);this.settingsNote='';
    }catch{this.settingsNote='同步配置未启用，请检查配置并重试';throw new Error(this.settingsNote);}
    finally{
      this.saving=false;
      const skipped=this.skippedReload,skippedGeneration=this.skippedReloadGeneration;this.skippedReload=undefined;
      this.notify();
      // A recreated foreground runtime may have skipped its only reload while
      // this save was pending. Read only after actual persistence and old close;
      // failed saves and the same runtime never resume old credentials here.
      if(persisted&&this.foreground&&skipped!==undefined&&skipped===this.coordinator&&coordinator!==this.coordinator&&
        generation!==this.generation&&skippedGeneration===this.generation)this.reload().catch(():void=>{});
    }
  }
  summary():MaterialSyncSummary{return this.coordinator?.summary()||new MaterialSyncSummary();}
  view(materialId:string):MaterialSyncView{return this.coordinator?.view(materialId)||new MaterialSyncView();}
  problems():MaterialSyncProblem[]{return this.coordinator?.problems()||[];}
  recover(queueId:string,action:string):void{
    if(!this.coordinator||this.saving)throw new Error('SYNC_RECOVERY_BUSY');
    this.coordinator.recover(queueId,action);
  }
  async syncNow():Promise<void>{await this.coordinator?.tick();}
  async dispose():Promise<void>{
    this.foreground=false;this.skippedReload=undefined;this.cancelSettingsRetry();this.retryAttempt=0;
    ++this.generation;const coordinator=this.coordinator;this.coordinator=undefined;
    if(coordinator){coordinator.changed=():void=>{};this.closing=coordinator.stop();await this.closing;}
  }
}
export const materialSyncService:MaterialSyncService=new MaterialSyncService();
