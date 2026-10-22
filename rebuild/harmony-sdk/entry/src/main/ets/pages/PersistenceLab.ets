@Entry
@Component
struct PersistenceLab {
  @StorageLink('persistenceLabStatus') status:string='等待实验参数';
  @StorageLink('persistenceLabScope') scope:string='等待实验范围';
  build(){
    Column({space:20}){
      Text('资料与队列恢复实验').fontSize(24)
      Text(this.status).fontSize(18)
      Text(this.scope).fontSize(16)
    }.padding(32).justifyContent(FlexAlign.Center).width('100%').height('100%')
  }
}
