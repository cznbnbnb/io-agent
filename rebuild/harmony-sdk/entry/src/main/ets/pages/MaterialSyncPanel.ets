import { materialSyncService } from '../MaterialSyncService';
import { MaterialSyncSettings } from '../MaterialSyncSettings';
import { MaterialSyncSummary, MaterialSyncProblem } from '../MaterialSyncCoordinator';
import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { MaterialSyncTarget, MaterialSyncTransport } from '../MaterialSyncTransport';
import { MaterialSyncImportCandidate, readMaterialSyncImportFile } from '../MaterialSyncImport';

@Component
export struct MaterialSyncPanel {
  onChanged:()=>void=():void=>{};
  @State expanded:boolean=false;@State loaded:boolean=false;@State busy:boolean=false;
  @State syncEnabled:boolean=false;@State baseUrl:string='';@State tokenEntry:string='';
  @State hasSavedToken:boolean=false;@State credentialExpiry:number=0;@State operation:string='';
  @State owner:string='';@State producer:string='';@State server:string='';
  @State summary:MaterialSyncSummary=new MaterialSyncSummary();@State note:string='';
  @State problems:MaterialSyncProblem[]=[];
  private visible:boolean=false;private loadGeneration:number=0;
  private lastServiceNote:string='';
  private boundTarget:MaterialSyncTarget|undefined=undefined;
  private boundExpiry:number=0;
  private identityClient:MaterialSyncTransport=new MaterialSyncTransport();
  private verifiedTarget:MaterialSyncTarget|undefined=undefined;
  private pendingSource:boolean=false;
  private pendingCandidate:MaterialSyncImportCandidate|undefined=undefined;
  aboutToAppear():void{
    this.visible=true;this.refresh();
    materialSyncService.changed=():void=>{if(this.visible)this.refresh();};
    try{const path=this.pendingDirectory();if(!fs.accessSync(path))fs.mkdirSync(path);}catch{}
  }
  aboutToDisappear():void{this.visible=false;this.clearDraft();materialSyncService.changed=():void=>{};}
  private pendingDirectory():string{return (this.getUIContext().getHostContext() as common.UIAbilityContext).filesDir+'/connection-import';}
  private pendingFile():string{return this.pendingDirectory()+'/material-sync.json';}
  private current(generation:number):boolean{return this.visible&&this.expanded&&generation===this.loadGeneration;}
  private cancelCheck():void{this.identityClient.cancel();this.identityClient=new MaterialSyncTransport();this.verifiedTarget=undefined;}
  private clearDraft():void{
    ++this.loadGeneration;this.cancelCheck();this.boundTarget=undefined;this.boundExpiry=0;
    this.pendingCandidate=undefined;this.pendingSource=false;this.tokenEntry='';this.hasSavedToken=false;
    this.credentialExpiry=0;this.loaded=false;this.busy=false;this.operation='';
  }
  private changedDraft():void{
    if(this.busy)return;++this.loadGeneration;this.cancelCheck();
    if(this.tokenEntry.trim()||!this.matchesBinding())this.credentialExpiry=0;
    this.note='配置已修改，保存时会重新核对服务器身份';
  }
  private copyTarget(source:MaterialSyncTarget):MaterialSyncTarget{
    const target=new MaterialSyncTarget();target.baseUrl=source.baseUrl;target.token=source.token;
    target.principal.ownerId=source.principal.ownerId;target.principal.producerId=source.principal.producerId;target.principal.serverId=source.principal.serverId;return target;
  }
  private sameTarget(a:MaterialSyncTarget,b:MaterialSyncTarget):boolean{
    return a.baseUrl.replace(/\/+$/,'')===b.baseUrl.replace(/\/+$/,'')&&a.token===b.token&&
      a.principal.ownerId===b.principal.ownerId&&a.principal.producerId===b.principal.producerId&&a.principal.serverId===b.principal.serverId;
  }
  private matchesBinding():boolean{
    const target=this.boundTarget;return target!==undefined&&target.baseUrl.replace(/\/+$/,'')===this.baseUrl.trim().replace(/\/+$/,'')&&
      target.principal.ownerId===this.owner.trim()&&target.principal.producerId===this.producer.trim()&&target.principal.serverId===this.server.trim();
  }
  private proposed():MaterialSyncTarget{
    const target=new MaterialSyncTarget();target.baseUrl=this.baseUrl.trim();
    // A saved/imported bearer is never sent to an edited endpoint or identity.
    target.token=this.tokenEntry.trim()||(this.matchesBinding()?this.boundTarget?.token||'':'');
    target.principal.ownerId=this.owner.trim();target.principal.producerId=this.producer.trim();target.principal.serverId=this.server.trim();return target;
  }
  private expectedExpiry():string|undefined{
    return !this.tokenEntry.trim()&&this.matchesBinding()&&this.boundExpiry>0?new Date(this.boundExpiry).toISOString():undefined;
  }
  private failureText(error:Error):string{
    const code=error.message;
    if(code==='SYNC_IMPORT_EXPIRED'||code==='SYNC_EXPIRY_INVALID')return '连接配置已过期或期限不正确，请重新签发后导入';
    if(code==='SYNC_IMPORT_INVALID')return '连接文件格式不正确，未保存配置';
    if(code==='SYNC_IMPORT_READ_FAILED')return '连接文件暂不可读取，未保存配置';
    if(code==='SYNC_TARGET_INVALID')return '请核对 HTTPS 地址和对应的手机凭据；地址或身份变更后需重新导入';
    if(code==='SYNC_SCHEMA_UNSUPPORTED')return '服务器需支持资料1.2后才能同步校正文字';
    if(code==='SYNC_IDENTITY_MISMATCH'||code==='SYNC_EXPIRY_MISMATCH')return '连接文件与服务器实际身份或期限不一致，未保存配置';
    if(code==='SYNC_IDENTITY_UNAVAILABLE'&&this.identityClient.lastIdentityStatus===401)return '手机凭据已失效，请重新签发后导入';
    if(code==='SYNC_IDENTITY_UNAVAILABLE'&&this.identityClient.lastIdentityStatus===403)return '此凭据缺少资料同步权限';
    return '服务器身份暂未核对成功，未保存配置；可稍后重试';
  }
  private refresh():void{
    this.summary=materialSyncService.summary();this.problems=materialSyncService.problems();
    const next=materialSyncService.settingsNote,previous=this.lastServiceNote;
    // Service notices must not erase later draft, import or save feedback.
    if(next!==previous){
      this.lastServiceNote=next;
      if(next)this.note=next;else if(this.note===previous)this.note='';
    }
    this.onChanged();
  }
  private async load():Promise<void>{
    this.clearDraft();this.busy=true;this.operation='loading';const generation=this.loadGeneration;
    try{const value=await materialSyncService.settings();if(!this.visible||!this.expanded||generation!==this.loadGeneration)return;
      this.syncEnabled=value.enabled;this.baseUrl=value.target.baseUrl;this.tokenEntry='';
      this.boundTarget=this.copyTarget(value.target);this.hasSavedToken=!!value.target.token;
      this.owner=value.target.principal.ownerId;this.producer=value.target.principal.producerId;this.server=value.target.principal.serverId;
      this.loaded=true;this.note='';
    }catch{if(generation===this.loadGeneration&&this.visible&&this.expanded){this.loaded=false;this.note='配置暂不可读，请解锁后重试；不会覆盖已有设置';}}
    finally{if(this.current(generation)){this.busy=false;this.operation='';}}
  }
  private async importConnection(fromComputer:boolean):Promise<void>{
    if(!this.loaded||this.busy||!this.visible||!this.expanded)return;
    this.cancelCheck();const generation=++this.loadGeneration;this.busy=true;this.operation='checking';
    let candidate:MaterialSyncImportCandidate|undefined=undefined;
    try{
      let uri=this.pendingFile();
      if(!fromComputer){
        const context=this.getUIContext().getHostContext() as common.UIAbilityContext;
        const uris=await new picker.DocumentViewPicker(context).select({maxSelectNumber:1,fileSuffixFilters:['连接配置|.json']});
        if(!this.current(generation))return;
        if(!uris.length){this.note='已取消导入，保存配置未改变';return;}uri=uris[0];
      }
      candidate=readMaterialSyncImportFile(uri);
      const target=this.copyTarget(candidate.target),client=this.identityClient;
      const identity=await client.preflight(target,new Date(candidate.expiresAt).toISOString(),'1.2');
      if(!this.current(generation))return;
      this.boundTarget=target;this.boundExpiry=candidate.expiresAt;this.verifiedTarget=this.copyTarget(target);
      this.baseUrl=target.baseUrl;this.owner=target.principal.ownerId;this.producer=target.principal.producerId;this.server=target.principal.serverId;
      this.tokenEntry='';this.hasSavedToken=true;this.credentialExpiry=Date.parse(identity.expires_at);this.syncEnabled=false;
      this.pendingSource=fromComputer;this.pendingCandidate=fromComputer?candidate:undefined;
      this.note='服务器与手机身份、期限及资料版本已核对；尚未保存，开启开关后保存才会同步';
    }catch(error){if(this.current(generation))this.note=this.failureText(error as Error);}
    finally{if(this.current(generation)){this.busy=false;this.operation='';}}
  }
  private cleanupPending(saved:MaterialSyncTarget):boolean{
    const original=this.pendingCandidate;if(!this.pendingSource||!original||!this.sameTarget(saved,original.target))return true;
    try{
      const current=readMaterialSyncImportFile(this.pendingFile());
      if(current.tokenId!==original.tokenId||current.expiresAt!==original.expiresAt||!this.sameTarget(current.target,original.target))return false;
      fs.unlinkSync(this.pendingFile());this.pendingCandidate=undefined;this.pendingSource=false;return true;
    }catch{return false;}
  }
  private statusText():string{
    const code=this.summary.note;
    if(code==='AUTH_REQUIRED')return '令牌已失效，请更新同步配置';
    if(code==='FORBIDDEN')return '当前身份缺少同步权限，请检查配置';
    if(code==='IDENTITY_MISMATCH')return '服务器身份不匹配，文字尚未发送';
    if(code==='SCHEMA_UNSUPPORTED')return '服务器尚未支持说话人修订，文字保留并等待升级后重试';
    if(['IDENTITY_UNAVAILABLE','TRANSPORT_UNKNOWN'].includes(code))return '网络暂不可用，保留积压并自动重试';
    if(['DISCOVERY_NEEDS_ATTENTION','SYNC_NEEDS_ATTENTION','OUTBOX_PERSIST_FAILED','CONFIGURATION_FAILED'].includes(code))return '本机队列需要检查，原始资料保留';
    return this.summary.enabled?(this.summary.foreground?'前台同步':'等待回到前台'):'未开启';
  }
  private problemText(item:MaterialSyncProblem):string{
    const date=item.started>0?new Date(item.started).toLocaleString():'日期未知';
    const reason=item.error==='PAYLOAD_CORRUPT'?'发送副本损坏，保留原件待修复':item.error==='CONFLICT'?'服务器版本冲突':
      item.error==='ACK_INVALID'?'回执不完整，需重新查账':item.state==='expired'?'本次投递已过期':
      item.error==='AUTH_REQUIRED'?'需要更新令牌':item.error==='FORBIDDEN'?'缺少权限':item.error==='SCHEMA_UNSUPPORTED'?'服务器尚未支持此资料版本，保留等待升级':'提交受阻';
    return `${date} · ${item.kind==='lifelog'?'智记':'录音'} · 版本 ${item.revision}：${reason}`;
  }
  private recover(item:MaterialSyncProblem,action:string):void{
    try{materialSyncService.recover(item.queueId,action);this.note=action==='renew'?'已生成新的投递期限，原文和版本不变':'已安排查账，先确认服务器是否已有这条资料';this.refresh();}
    catch{this.note='本项暂不可恢复，请等待同步结束或检查当前配置；原始资料保留';}
  }
  private async save():Promise<void>{
    if(!this.loaded||this.busy||!this.visible||!this.expanded)return;
    const value=new MaterialSyncSettings();value.enabled=this.syncEnabled;value.target=this.proposed();
    const expected=this.expectedExpiry();this.cancelCheck();const generation=++this.loadGeneration;
    this.busy=true;this.operation=value.enabled?'checking':'saving';let accepted=false;
    let savedExpiry=this.boundTarget&&this.sameTarget(value.target,this.boundTarget)?this.boundExpiry:0;
    try{
      if(value.enabled){
        const identity=await this.identityClient.preflight(value.target,expected,'1.2');
        if(!this.current(generation))return;
        this.verifiedTarget=this.copyTarget(value.target);savedExpiry=Date.parse(identity.expires_at);
        if(savedExpiry<=Date.now())throw new Error('SYNC_IMPORT_EXPIRED');
        this.credentialExpiry=savedExpiry;
        value.target=this.copyTarget(this.verifiedTarget);
      }
      if(!this.current(generation))return;this.operation='saving';accepted=true;
      // After this explicit durable save is accepted, leaving the page does not
      // cancel it. Only late UI updates are fenced; return/reload reads the vault.
      await materialSyncService.save(value);
      if(!this.current(generation))return;
      const cleaned=this.cleanupPending(value.target);
      this.boundTarget=this.copyTarget(value.target);this.hasSavedToken=!!value.target.token;this.tokenEntry='';
      this.boundExpiry=savedExpiry;this.credentialExpiry=savedExpiry;
      this.note=value.enabled?'文字同步已开启，返回前台时继续积压':'文字同步已暂停，已有队列和回执保留';
      if(!cleaned)this.note+='；电脑登记文件保留，请检查后清理';this.refresh();
    }catch(error){if(this.current(generation))this.note=accepted?'保存或启用未完成，请重读实际配置；同步暂不可确认':this.failureText(error as Error);}
    finally{if(this.current(generation)){this.busy=false;this.operation='';}}
  }
  build(){
    Column({space:8}){
      Row({space:8}){
        Text('资料增量同步').fontSize(13).fontColor($r('app.color.text_primary')).layoutWeight(1)
        Text(this.statusText()).fontSize(11).fontColor($r('app.color.text_muted'))
        Button(this.expanded?'收起':'设置').fontSize(11).height(28).enabled(this.operation!=='saving').onClick(()=>{
          this.expanded=!this.expanded;if(this.expanded)this.load();else this.clearDraft();
        })
      }.width('100%')
      Text(`待同步 ${this.summary.queued} · 已存文字版本 ${this.summary.stored} · 需处理 ${this.summary.blocked+this.summary.expired+this.summary.issues}`)
        .fontSize(11).fontColor($r('app.color.text_secondary')).width('100%')
      if(this.expanded){
        Text('开启后同步本机录音和智记的文字、元数据及历史修订（包括删除标记）。前台自动恢复；后台暂停。原音另行配置，当前不上传。')
          .fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
        Row({space:8}){
          Button('导入连接配置').fontSize(11).height(28).enabled(this.loaded&&!this.busy).onClick(()=>this.importConnection(false))
          Button('读取电脑登记配置').fontSize(11).height(28).enabled(this.loaded&&!this.busy).onClick(()=>this.importConnection(true))
        }.width('100%')
        Text(this.hasSavedToken?(this.matchesBinding()?'已提供手机凭据；输入框留空可继续使用':'地址或身份已变更，请导入对应配置或输入新凭据'):'尚未配置手机凭据').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
        if(this.credentialExpiry>0)Text('凭据期限：'+new Date(this.credentialExpiry).toLocaleString()).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
        TextInput({text:this.baseUrl,placeholder:'HTTPS API 地址（以 /v1 结尾）'}).fontSize(12).enabled(this.loaded&&!this.busy).onChange((v:string):void=>{if(!this.busy){this.baseUrl=v;this.changedDraft();}})
        TextInput({text:this.owner,placeholder:'资料所有者 owner_id'}).fontSize(12).enabled(this.loaded&&!this.busy).onChange((v:string):void=>{if(!this.busy){this.owner=v;this.changedDraft();}})
        TextInput({text:this.producer,placeholder:'本手机 producer_id'}).fontSize(12).enabled(this.loaded&&!this.busy).onChange((v:string):void=>{if(!this.busy){this.producer=v;this.changedDraft();}})
        TextInput({text:this.server,placeholder:'服务器 server_id'}).fontSize(12).enabled(this.loaded&&!this.busy).onChange((v:string):void=>{if(!this.busy){this.server=v;this.changedDraft();}})
        TextInput({text:this.tokenEntry,placeholder:'更换手机凭据（留空保留现有凭据）'}).type(InputType.Password).fontSize(12).enabled(this.loaded&&!this.busy).onChange((v:string):void=>{if(!this.busy){this.tokenEntry=v;this.changedDraft();}})
        Row({space:8}){
          Toggle({type:ToggleType.Switch,isOn:this.syncEnabled}).enabled(this.loaded&&!this.busy).onChange((v:boolean):void=>{if(!this.busy){this.syncEnabled=v;this.changedDraft();}})
          Text('同步文字（保存后生效）').fontSize(12).layoutWeight(1)
          Button(this.operation==='checking'?'核对中…':this.operation==='saving'?'保存中…':'保存').fontSize(11).height(28).enabled(this.loaded&&!this.busy).onClick(()=>this.save())
          Button('重读').fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.load())
        }.width('100%')
        Button('立即同步').fontSize(12).height(30).enabled(this.summary.enabled&&!this.summary.busy&&!this.busy)
          .onClick(()=>{materialSyncService.syncNow().catch(():void=>{});})
        ForEach(this.problems,(item:MaterialSyncProblem)=>{
          Column({space:4}){
            Text(this.problemText(item)).fontSize(11).fontColor($r('app.color.text_secondary')).width('100%')
            Row({space:8}){
              Button('重新查账').fontSize(11).height(28).enabled(item.canRecheck&&!this.summary.busy&&!this.busy).onClick(()=>this.recover(item,'recheck'))
              if(item.canRenew){Button('补传此版本').fontSize(11).height(28).enabled(!this.summary.busy&&!this.busy).onClick(()=>this.recover(item,'renew'))}
            }.width('100%')
            if(item.canRenew)Text('服务器已确认旧投递不存在，可以重新补传；不会改变资料版本。').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
          }.width('100%')
        },(item:MaterialSyncProblem)=>item.queueId)
        if(this.summary.blocked+this.summary.expired>20)Text('仅列出前20项，处理后会继续显示剩余项。').fontSize(11).fontColor($r('app.color.text_muted'))
      }
      if(this.note)Text(this.note).fontSize(11).fontColor($r('app.color.text_secondary')).width('100%')
    }.padding(10).width('100%').backgroundColor($r('app.color.card_bg_soft')).borderRadius(14)
  }
}
