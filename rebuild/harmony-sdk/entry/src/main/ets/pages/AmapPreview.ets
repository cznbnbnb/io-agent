import { MapViewComponent } from '@amap/amap_lbs_navi';
import { AmapPreviewController } from '../AmapPreviewController';

@Component
export struct AmapPreview {
  @Prop @Watch('redraw') route:string='';
  @Prop @Watch('redraw') destination:string='';
  @Prop selectable:boolean=true;
  onSelect:(coordinate:string)=>void=(_coordinate:string):void=>{};
  @State private mapName:string='';
  @State private message:string='地图加载中…';
  @State private failed:boolean=false;
  private controller:AmapPreviewController|undefined=undefined;
  private visible:boolean=false;
  aboutToAppear():void{this.visible=true;this.reload();}
  aboutToDisappear():void{this.visible=false;this.controller?.dispose();this.controller=undefined;}
  private reload():void{
    if(!this.visible)return;this.controller?.dispose();
    const controller=new AmapPreviewController((message:string,failed:boolean):void=>{
      if(this.visible&&this.controller===controller){this.message=message;this.failed=failed;}
    },(coordinate:string):void=>{if(this.visible&&this.selectable)this.onSelect(coordinate);});
    this.controller=controller;controller.setContent(this.route,this.destination);controller.open();this.mapName=controller.name;
  }
  private redraw():void{this.controller?.setContent(this.route,this.destination);}
  build(){
    Column({space:8}){
      ForEach(this.mapName?[this.mapName]:[],(name:string)=>{
        MapViewComponent({mapViewName:name}).height(260).width('100%')
      },(name:string):string=>name)
      Row({space:10}){
        Text(this.message).fontSize(12).fontColor(this.failed?$r('app.color.warm'):$r('app.color.text_muted')).layoutWeight(1)
        if(this.failed){Button('重新加载').fontSize(12).backgroundColor($r('app.color.input_bg')).fontColor($r('app.color.brand')).onClick(()=>this.reload())}
      }.width('100%')
    }.width('100%')
  }
}
