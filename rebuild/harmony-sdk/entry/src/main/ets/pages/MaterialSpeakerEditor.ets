import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { MaterialRevision, MaterialSpeaker, MaterialUtterance, MaterialSpeakerCorrection, deriveMaterialSpeakers } from '../MaterialStore';
import { localMaterialRevision, correctLocalMaterial } from '../RecordingService';
import { materialSyncService } from '../MaterialSyncService';

@Component
export struct MaterialSpeakerEditor {
  @Prop kind:string='lifelog';
  @Prop @Watch('reload') name:string='';
  @Prop @Watch('revisionChanged') revision:number=0;
  onChanged:(row:MaterialRevision)=>void=():void=>{};
  onPlay:(part:MaterialUtterance,row:MaterialRevision)=>void=():void=>{};
  @State row:MaterialRevision|undefined=undefined;
  @State speakers:MaterialSpeaker[]=[];
  @State selected:string[]=[];
  @State sourceSpeaker:string='';@State targetSpeaker:string='';
  @State label:string='';@State newLabel:string='';
  @State editedText:string='';@State splitPrefix:string='';
  @State page:number=0;@State expanded:boolean=false;
  @State busy:boolean=false;@State retryPending:boolean=false;@State note:string='';
  private pending:MaterialSpeakerCorrection|undefined=undefined;
  private pendingBase:number=0;private visible:boolean=false;
  aboutToAppear():void{this.visible=true;this.reload();}
  aboutToDisappear():void{this.visible=false;}
  private revisionChanged():void{
    if(!this.visible||this.row?.revision===this.revision)return;
    if(this.pending){this.retryPending=true;this.note='资料已有新修订；保留本次修改，重试会核对原版本，或放弃并刷新';return;}
    this.reload();
  }
  private reload():void{
    if(!this.visible)return;
    try{const row=localMaterialRevision(this.kind,this.name);this.row=row;this.speakers=deriveMaterialSpeakers(row);
      this.selected=[];this.page=0;this.sourceSpeaker='';this.targetSpeaker='';this.editedText='';this.splitPrefix='';this.label='';
      this.pending=undefined;this.retryPending=false;this.note='';this.onChanged(row);
    }catch(_){this.row=undefined;this.speakers=[];this.note='资料暂不可读，请刷新；原件保留';}
  }
  private ready():boolean{return !!this.row&&this.row.operation==='upsert'&&this.row.source.complete&&!this.row.source.interrupted&&
    this.row.transcription_state==='complete'&&this.row.utterances.length>0;}
  private reason():string{
    if(!this.row)return '资料暂不可读';
    if(!this.row.source.complete||this.row.source.interrupted)return '原音尚未完整封口，暂不能校正';
    if(this.row.transcription_state!=='complete')return '转写覆盖尚未完整核实，请先完成这一段的转写';
    return this.row.utterances.length?'仅校正这一段；标签名称不等于自动确认真实身份':'这份文字没有可校正的逐句结果';
  }
  private chooseSpeaker(speaker:MaterialSpeaker):void{this.sourceSpeaker=speaker.speaker_id;this.label=speaker.label;}
  private choosePart(part:MaterialUtterance):void{
    this.selected=this.selected.includes(part.utterance_id)?this.selected.filter((id:string):boolean=>id!==part.utterance_id):[...this.selected,part.utterance_id];
    const single=this.row?.utterances.find((saved:MaterialUtterance):boolean=>this.selected.length===1&&saved.utterance_id===this.selected[0]);
    this.editedText=single?.text||'';this.splitPrefix='';
  }
  private partLabel(part:MaterialUtterance):string{
    const speaker=this.speakers.find((saved:MaterialSpeaker):boolean=>saved.speaker_id===part.speaker_id);
    return (speaker?.label||'未确定')+' · '+(part.speaker_basis==='user'?'归属经人工校正':part.speaker_basis==='segment_cluster'?'模型聚类':'归属未知');
  }
  private partTime(part:MaterialUtterance):string{
    if(part.start_ms===null)return '句内时间未确定；原音父句 '+((part.source_range?.start_ms||0)/1000).toFixed(1)+'–'+((part.source_range?.end_ms||0)/1000).toFixed(1)+'秒';
    return (part.start_ms/1000).toFixed(1)+'–'+((part.end_ms||0)/1000).toFixed(1)+'秒';
  }
  private partPlayable(part:MaterialUtterance):boolean{
    return part.start_ms!==null&&part.end_ms!==null&&Number.isSafeInteger(part.start_ms)&&Number.isSafeInteger(part.end_ms)&&part.start_ms>=0&&part.end_ms>=part.start_ms;
  }
  private playPart(part:MaterialUtterance):void{
    if(!this.visible||this.busy||this.retryPending||!this.row||!this.row.source.audioAvailable||!this.partPlayable(part))return;
    const current=this.row.utterances.find((saved:MaterialUtterance):boolean=>saved.utterance_id===part.utterance_id);
    if(!current||JSON.stringify(current)!==JSON.stringify(part))return;
    this.onPlay(current,this.row);
  }
  private operation(kind:string):MaterialSpeakerCorrection{
    const bytes=cryptoFramework.createRandom().generateRandomSync(16).data,op=new MaterialSpeakerCorrection();
    op.operation_id='spk-'+Array.from(bytes).map((value:number):string=>value.toString(16).padStart(2,'0')).join('');bytes.fill(0);op.kind=kind;return op;
  }
  private errorText(code:string):string{
    if(code.includes('REVISION_CONFLICT')||code.includes('SOURCE_CHANGED'))return '资料或原音已变化；本次未覆盖。请放弃本次修改并刷新后核对';
    if(code.includes('MATERIAL_DELETED')||code.includes('SOURCE_UNAVAILABLE'))return '资料已删除或来源不可读，本次未写回';
    if(code.includes('BUSY'))return '这一段或手动转写正在处理，请稍后重试';
    if(code.includes('LIFETIME'))return '请回到应用前台后重试';
    if(code.includes('COVERAGE')||code.includes('UNSEALED'))return '原音或转写覆盖尚未完整核实，暂不能校正';
    if(code.includes('LABEL_INVALID'))return '名称需为1–80个字符，不含换行或控制字符';
    if(code.includes('SPLIT_OFFSET'))return '拆分位置无效，请输入完整的前半句原文';
    return '本次未确认保存，请重试同一修改或刷新核对';
  }
  private save(op:MaterialSpeakerCorrection):void{
    if(!this.visible||this.busy||!this.row)return;
    if(!this.pending){this.pending=op;this.pendingBase=this.row.revision;}
    this.busy=true;
    try{const saved=correctLocalMaterial(this.kind,this.name,this.pendingBase,this.pending);
      this.reload();this.note='已保存资料 v'+saved.revision+'；服务器同步结果另行显示';
      void materialSyncService.syncNow().catch(():void=>{});
    }catch(error){this.retryPending=true;this.note=this.errorText((error as Error).message);}
    finally{this.busy=false;}
  }
  private rename():void{const op=this.operation('rename');op.speaker_id=this.sourceSpeaker;op.label=this.label;this.save(op);}
  private confirmationCurrent(materialId:string,revision:number,kind:string,name:string):boolean{
    if(this.visible&&!this.busy&&!this.retryPending&&this.row!==undefined&&this.row.material_id===materialId&&this.row.revision===revision&&this.kind===kind&&this.name===name)return true;
    this.note='资料或编辑状态已变化，请重新核对后再确认';return false;
  }
  private merge():void{
    const source=this.speakers.find((speaker:MaterialSpeaker):boolean=>speaker.speaker_id===this.sourceSpeaker),target=this.speakers.find((speaker:MaterialSpeaker):boolean=>speaker.speaker_id===this.targetSpeaker);
    if(!this.row||!source||!target||source.speaker_id===target.speaker_id)return;
    const materialId=this.row.material_id,revision=this.row.revision,kind=this.kind,name=this.name;
    this.getUIContext().showAlertDialog({title:'合并这一段的说话人？',message:'把“'+source.label+'”的句子并入“'+target.label+'”。原句文字、原音和历史修订保留。',
      primaryButton:{value:'取消',action:():void=>{}},secondaryButton:{value:'合并',action:():void=>{if(!this.confirmationCurrent(materialId,revision,kind,name))return;const op=this.operation('merge');op.speaker_id=source.speaker_id;op.target_speaker_id=target.speaker_id;this.save(op);}}});
  }
  private self():void{
    const source=this.speakers.find((speaker:MaterialSpeaker):boolean=>speaker.speaker_id===this.sourceSpeaker);if(!this.row||!source)return;
    const materialId=this.row.material_id,revision=this.row.revision,kind=this.kind,name=this.name;
    const previous=this.speakers.find((speaker:MaterialSpeaker):boolean=>speaker.is_self&&speaker.speaker_id!==source.speaker_id);
    this.getUIContext().showAlertDialog({title:'确认这一段的“我”？',message:'将“'+source.label+'”标记为“我”。'+(previous?'会取消“'+previous.label+'”原来的本人标记。':'')+'这次确认仅用于这一段，不会自动确认其他录音的身份。',
      primaryButton:{value:'取消',action:():void=>{}},secondaryButton:{value:'确认是我',action:():void=>{if(!this.confirmationCurrent(materialId,revision,kind,name))return;const op=this.operation('self');op.speaker_id=source.speaker_id;this.save(op);}}});
  }
  private assign(unknown:boolean=false,newSpeaker:boolean=false):void{
    const op=this.operation(unknown?'unknown':'assign');op.utterance_ids=[...this.selected];
    if(!unknown){if(newSpeaker)op.label=this.newLabel;else op.target_speaker_id=this.targetSpeaker;}this.save(op);
  }
  private editText():void{const op=this.operation('text');op.utterance_ids=[...this.selected];op.text=this.editedText;this.save(op);}
  private split():void{
    const part=this.row?.utterances.find((saved:MaterialUtterance):boolean=>saved.utterance_id===this.selected[0]);
    if(!part||!this.splitPrefix||!part.text.startsWith(this.splitPrefix)||this.splitPrefix.length>=part.text.length){this.note='拆分位置需为当前句子中完整的前半句原文';return;}
    const op=this.operation('split');op.utterance_ids=[...this.selected];op.split_offset=this.splitPrefix.length;this.save(op);
  }
  build(){
    Column({space:8}){
      Row(){Text('本段文字与说话人').fontSize(13).fontColor($r('app.color.text_primary'));Blank();
        Button('刷新').fontSize(11).height(28).enabled(!this.busy&&!this.retryPending).onClick(()=>this.reload())
        Button(this.expanded?'收起校正':'校正').fontSize(11).height(28).enabled(!this.busy).onClick(()=>{this.expanded=!this.expanded;})
      }.width('100%')
      Text(this.reason()).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
      if(this.row){Text('资料 v'+this.row.revision+' · 文字 v'+this.row.text_revision+(this.row.source.audioAvailable?' · 原音保留':' · 原音当前不可读')).fontSize(11).fontColor($r('app.color.text_muted')).width('100%')}
      if(this.note){Text(this.note).fontSize(12).fontColor($r('app.color.text_secondary')).width('100%')}
      if(this.retryPending){Row({space:8}){
        Button('重试同一修改').fontSize(11).height(28).enabled(!this.busy).onClick(()=>{if(this.pending)this.save(this.pending);})
        Button('放弃本次修改并刷新').fontSize(11).height(28).enabled(!this.busy).onClick(()=>this.reload())
      }.width('100%')}
      if(this.expanded&&this.ready()){
        // Immutable revisions replace these objects, so renew builders and their click closures per revision.
        ForEach(this.speakers,(speaker:MaterialSpeaker)=>{
          Button((speaker.speaker_id===this.sourceSpeaker?'✓ ':'')+speaker.label+' · '+(speaker.is_self?'本人已确认':speaker.label_basis==='role_match'?'角色候选':speaker.label_basis==='user_confirmed'?'名称经确认':'匿名'))
            .fontSize(11).height(30).enabled(!this.busy&&!this.retryPending).onClick(()=>this.chooseSpeaker(speaker))
        },(speaker:MaterialSpeaker)=>(this.row?.material_id||'')+'-r'+(this.row?.revision||0)+'-speaker-'+speaker.speaker_id)
        TextInput({text:this.label,placeholder:'选择上方说话人后修改名称'}).maxLength(80).fontSize(12).onChange((value:string)=>{this.label=value;})
        Row({space:8}){
          Button('保存名称').fontSize(11).height(28).enabled(!!this.sourceSpeaker&&!this.busy&&!this.retryPending).onClick(()=>this.rename())
          Button('确认是我').fontSize(11).height(28).enabled(!!this.sourceSpeaker&&!this.busy&&!this.retryPending).onClick(()=>this.self())
        }.width('100%')
        Select(this.speakers.map((speaker:MaterialSpeaker):SelectOption=>({value:speaker.label}))).value('选择归属或合并目标').font({size:12})
          .enabled(!this.busy&&!this.retryPending).onSelect((index:number):void=>{this.targetSpeaker=this.speakers[index]?.speaker_id||'';})
        Button('将上方选中的说话人合并到目标').fontSize(11).height(28).enabled(!!this.sourceSpeaker&&!!this.targetSpeaker&&this.sourceSpeaker!==this.targetSpeaker&&!this.busy&&!this.retryPending).onClick(()=>this.merge())
        Text('选择句子（已选 '+this.selected.length+' 条）').fontSize(12).fontColor($r('app.color.text_primary')).width('100%')
        ForEach(this.row?.utterances.slice(this.page*25,(this.page+1)*25)||[],(part:MaterialUtterance)=>{
          Column({space:4}){
            Button((this.selected.includes(part.utterance_id)?'✓ ':'选择 · ')+this.partLabel(part)).fontSize(11).height(28).enabled(!this.busy&&!this.retryPending).onClick(()=>this.choosePart(part))
            Text(this.partTime(part)).fontSize(10).fontColor($r('app.color.text_muted')).width('100%')
            if(this.partPlayable(part)){Button('播放原句起点').fontSize(11).height(28).enabled(!!this.row?.source.audioAvailable&&!this.busy&&!this.retryPending).onClick(()=>this.playPart(part))}
            else{Text('句内时间未确定，不能定位子句起点').fontSize(10).fontColor($r('app.color.text_muted')).width('100%')}
            Text(part.text).fontSize(12).fontColor($r('app.color.text_secondary')).width('100%').copyOption(CopyOptions.LocalDevice)
          }.width('100%').padding(8).backgroundColor($r('app.color.card_bg_soft')).borderRadius(10)
        },(part:MaterialUtterance)=>(this.row?.material_id||'')+'-r'+(this.row?.revision||0)+'-utterance-'+part.utterance_id)
        if((this.row?.utterances.length||0)>25){Row({space:8}){
          Button('上一页').fontSize(11).height(28).enabled(this.page>0).onClick(()=>{this.page--;})
          Text('第 '+(this.page+1)+' 页').fontSize(11).fontColor($r('app.color.text_muted'))
          Button('下一页').fontSize(11).height(28).enabled((this.page+1)*25<(this.row?.utterances.length||0)).onClick(()=>{this.page++;})
        }.width('100%')}
        Row({space:8}){
          Button('归属到目标').fontSize(11).height(28).enabled(this.selected.length>0&&!!this.targetSpeaker&&!this.busy&&!this.retryPending).onClick(()=>this.assign())
          Button('标为未确定').fontSize(11).height(28).enabled(this.selected.length>0&&!this.busy&&!this.retryPending).onClick(()=>this.assign(true))
        }.width('100%')
        TextInput({text:this.newLabel,placeholder:'新建仅用于本段的说话人名称'}).maxLength(80).fontSize(12).onChange((value:string)=>{this.newLabel=value;})
        Button('创建标签并归属所选句子').fontSize(11).height(28).enabled(this.selected.length>0&&!!this.newLabel&&!this.busy&&!this.retryPending).onClick(()=>this.assign(false,true))
        if(this.selected.length===1){
          TextArea({text:this.editedText,placeholder:'修改所选句子的文字'}).fontSize(12).maxLength(65536).onChange((value:string)=>{this.editedText=value;})
          Button('保存这句文字').fontSize(11).height(28).enabled(!this.busy&&!this.retryPending).onClick(()=>this.editText())
          TextInput({text:this.splitPrefix,placeholder:'拆句位置：输入完整前半句原文'}).fontSize(12).onChange((value:string)=>{this.splitPrefix=value;})
          Button('在前半句末尾拆成两句').fontSize(11).height(28).enabled(!!this.splitPrefix&&!this.busy&&!this.retryPending).onClick(()=>this.split())
          Text('拆句保留原文和父句原音引用；拆出的句内时间保持未知，可分别调整归属。').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
        }
      }
    }.width('100%').padding(10).backgroundColor($r('app.color.row_bg')).borderRadius(12)
  }
}
