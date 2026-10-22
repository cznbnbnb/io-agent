import { ArrayList } from '@kit.ArkTS';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { AMap, MapView, MapViewManager, LatLng, LatLngBounds, CameraUpdateFactory, PolylineOptions, MarkerOptions } from '@amap/amap_lbs_navi';

let previewSequence:number=0;

// Each component owns one native map; camera/overlays wait for the SDK's delayed
// ready callback. Disposed callbacks cannot operate a replacement map.
export class AmapPreviewController {
  readonly name:string=`turboio-native-navigation-${++previewSequence}`;
  private view:MapView|undefined=undefined;
  private map:AMap|undefined=undefined;
  private active:boolean=false;
  private ready:boolean=false;
  private epoch:number=0;
  private timer:number=-1;
  private route:string='';
  private destination:string='';
  private report:(message:string,failed:boolean)=>void;
  private select:(coordinate:string)=>void;
  constructor(report:(message:string,failed:boolean)=>void,select:(coordinate:string)=>void){this.report=report;this.select=select;}
  private current(epoch:number):boolean{return this.active&&epoch===this.epoch;}
  private clearTimer():void{if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;}
  private log(event:string):void{hilog.info(0x2a02,'TurboMap','%{public}s %{public}s',this.name,event);}
  private fail(message:string):void{if(!this.active)return;this.clearTimer();this.ready=false;this.log(message);this.report(message,true);}
  private created=(view?:MapView,name?:string):void=>{
    if(!this.active||name!==this.name||!view||this.view)return;
    const epoch=this.epoch;this.view=view;
    this.log('view-created');
    try{
      view.onCreate();view.onResume();
      view.getMapAsync((map:AMap):void=>{
        if(!this.current(epoch)||view!==this.view)return;
        this.map=map;
        this.log('map-object-ready');
        try{
          // SDK documents this delayed callback as protection against a blank first frame.
          map.addOnMapReadyDelayListener((_loaded:AMap):void=>{
            if(!this.current(epoch)||view!==this.view||map!==this.map||this.ready)return;
            try{
              map.getUiSettings()?.setZoomControlsEnabled(true);
              map.moveCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(39.9042,116.4074),11));
              this.ready=true;this.draw();this.clearTimer();this.log('map-frame-ready');this.report('地图已加载',false);
            }catch(_){this.fail('地图显示未完成，请重新加载');}
          });
          map.setOnMapClickListener((point:LatLng):void=>{
            if(this.current(epoch)&&this.ready&&map===this.map)this.select(`${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`);
          });
        }catch(_){this.fail('地图初始化未完成，请重新加载');}
      });
    }catch(_){this.fail('地图容器未能启动，请重新加载');}
  };
  open():void{
    if(this.active)return;this.active=true;this.epoch++;this.report('地图加载中…',false);
    this.log('open');
    const epoch=this.epoch;
    this.timer=setTimeout(()=>{this.timer=-1;if(this.current(epoch)&&!this.ready)this.fail('地图尚未完成加载，请检查网络、Key 绑定与地图服务权限后重试');},15000);
    try{MapViewManager.getInstance().registerMapViewCreatedCallback(this.created);}
    catch(_){this.fail('地图容器未能启动，请重新加载');}
  }
  setContent(route:string,destination:string):void{
    this.route=route;this.destination=destination;
    if(this.active&&this.ready){try{this.draw();}catch(_){this.fail('地图路线显示未完成，请重新加载');}}
  }
  dispose():void{
    if(!this.active)return;this.active=false;this.epoch++;this.ready=false;this.clearTimer();
    const view=this.view;this.view=undefined;this.map=undefined;
    this.log('dispose');
    try{MapViewManager.getInstance().unregisterMapViewCreatedCallback(this.created);}catch(_){}
    try{view?.onPause();}catch(_){}
    try{view?.onDestroy();}catch(_){}
  }
  private parse(value:string):LatLng|undefined{
    const p=value.split(',').map(Number);if(p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90)return undefined;return new LatLng(p[1],p[0]);
  }
  private draw():void{
    if(!this.ready||!this.map)return;const map=this.map;map.clear();const points=new ArrayList<LatLng>();
    for(const value of this.route.split(';')){const p=this.parse(value);if(p)points.add(p);}
    if(points.length>1){
      map.addPolyline(new PolylineOptions().addAll(points).setWidth(14).setColor(0xff24b58a));
      let minLat=90,maxLat=-90,minLon=180,maxLon=-180;
      for(let i=0;i<points.length;i++){const p=points[i];minLat=Math.min(minLat,p.latitude);maxLat=Math.max(maxLat,p.latitude);minLon=Math.min(minLon,p.longitude);maxLon=Math.max(maxLon,p.longitude);}
      map.moveCamera(CameraUpdateFactory.newLatLngBounds(new LatLngBounds(new LatLng(Math.max(-90,minLat-0.0001),Math.max(-180,minLon-0.0001)),new LatLng(Math.min(90,maxLat+0.0001),Math.min(180,maxLon+0.0001))),40));
    }
    const selected=this.parse(this.destination);
    if(selected){map.addMarker(new MarkerOptions().setPosition(selected).setTitle('目的地'));if(points.length<2)map.moveCamera(CameraUpdateFactory.newLatLngZoom(selected,15));}
  }
}
