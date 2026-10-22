import { common } from '@kit.AbilityKit';
import { AMapPrivacyAgreeStatus, AMapPrivacyInfoStatus, AMapPrivacyShowStatus } from '@amap/amap_lbs_common';
import { MapsInitializer, NaviSetting } from '@amap/amap_lbs_navi';
import { PoiSearch, PoiQuery, PoiResult, PoiItem, ServiceSettings } from '@amap/amap_lbs_search';
import { ServiceConfig, NavigationPlace } from './RemoteServices';

// Called only after the user explicitly accepts the provider disclosure in NavigationPanel.
export function configureAmap(config:ServiceConfig, context:common.UIAbilityContext):void {
  if(!config.amapHarmonyKey?.trim())throw new Error('请配置高德鸿蒙 SDK Key（不是 Web / iOS Key）');
  if(config.amapConsent!==true)throw new Error('请先阅读并同意高德地图服务说明');
  NaviSetting.updatePrivacyShow(AMapPrivacyShowStatus.DidShow,AMapPrivacyInfoStatus.DidContain,context);
  NaviSetting.updatePrivacyAgree(AMapPrivacyAgreeStatus.DidAgree,context);
  MapsInitializer.updatePrivacyShow(AMapPrivacyShowStatus.DidShow,AMapPrivacyInfoStatus.DidContain,context);
  MapsInitializer.updatePrivacyAgree(AMapPrivacyAgreeStatus.DidAgree,context);
  MapsInitializer.setDebugMode(false);MapsInitializer.setApiKey(config.amapHarmonyKey);
  ServiceSettings.updatePrivacyShow(AMapPrivacyShowStatus.DidShow,AMapPrivacyInfoStatus.DidContain,context);
  ServiceSettings.updatePrivacyAgree(AMapPrivacyAgreeStatus.DidAgree,context);
  ServiceSettings.getInstance().setApiKey(config.amapHarmonyKey);
}
export function revokeAmap(context:common.UIAbilityContext):void {
  NaviSetting.updatePrivacyAgree(AMapPrivacyAgreeStatus.NotAgree,context);
  MapsInitializer.updatePrivacyAgree(AMapPrivacyAgreeStatus.NotAgree,context);
  ServiceSettings.updatePrivacyAgree(AMapPrivacyAgreeStatus.NotAgree,context);
}

export class AmapNativeServices {
  private pending:((error:Error)=>void)|undefined=undefined;
  cancel():void{const reject=this.pending;this.pending=undefined;if(reject)reject(new Error('搜索已取消'));}
  async searchPlaces(config:ServiceConfig,query:string,city:string,context:common.UIAbilityContext):Promise<NavigationPlace[]> {
    this.cancel();
    if(!query.trim()||query.length>100||!city.trim())throw new Error('请填写城市与地点名称');
    configureAmap(config,context);
    return new Promise<NavigationPlace[]>((resolve,reject)=>{
      let done=false;
      const finish=(error:Error|undefined,rows:NavigationPlace[]):void=>{
        if(done)return;done=true;clearTimeout(timer);this.pending=undefined;
        if(error)reject(error);else resolve(rows);
      };
      const timer=setTimeout(()=>finish(new Error('高德搜索超时，请检查网络或 Key 绑定'),[]),20000);
      this.pending=(error:Error):void=>finish(error,[]);
      try{
        const request=new PoiQuery(query.trim(),'',city.trim());request.setPageSize(8);request.setCityLimit(true);
        const search=new PoiSearch(context,request);
        search.setOnPoiSearchListener({
          onPoiItemSearched:(_item:PoiItem|undefined,_code:number):void=>{},
          onPoiSearched:(result:PoiResult|undefined,code:number):void=>{
            if(done)return;
            if(code!==1000){finish(new Error(`高德搜索失败（${code}），请核对鸿蒙 Key、完整 App ID 与服务权限`),[]);return;}
            const rows:NavigationPlace[]=[];const pois=result?.getPois();
            if(pois)for(let i=0;i<Math.min(8,pois.length);i++){
              const item=pois[i],point=item.getLatLonPoint();if(!point)continue;
              const row=new NavigationPlace();row.name=item.getTitle()||query;row.address=item.getSnippet()||'';
              row.location=`${point.getLongitude()},${point.getLatitude()}`;rows.push(row);
            }
            finish(undefined,rows);
          }
        });search.searchPOIAsyn();
      }catch(_){finish(new Error('高德搜索无法启动，请检查 SDK 配置'),[]);}
    });
  }
}
