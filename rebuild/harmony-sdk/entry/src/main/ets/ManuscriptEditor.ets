import { localWorkspace,LocalWorkspace,WorkspaceEntry } from './LocalWorkspace';
import { hilog } from '@kit.PerformanceAnalysisKit';

// One process-owned editor. Persistent rows remain in the existing workspace;
// the editor owns unsaved text and in-flight operations across page mounts.
export class ManuscriptEditor {
  title:string='';text:string='';id:string='';revision:number=0;
  busy:boolean=false;note:string='';changed:()=>void=():void=>{};
  private baselineTitle:string='';private baselineText:string='';
  private store:LocalWorkspace;
  constructor(store:LocalWorkspace=localWorkspace){this.store=store;}
  get dirty():boolean{return this.title!==this.baselineTitle||this.text!==this.baselineText;}
  setTitle(value:string):void{if(this.busy)return;if(value===this.title){if(this.note)hilog.info(0x2a03,'turboio','manuscript-noop field=title note-kept=true');return;}this.title=value;this.note='';this.changed();}
  setText(value:string):void{if(this.busy)return;if(value===this.text){if(this.note)hilog.info(0x2a03,'turboio','manuscript-noop field=text note-kept=true');return;}this.text=value;this.note='';this.changed();}
  private begin():void{if(this.busy)throw new Error('上一项稿件操作仍在处理');this.busy=true;this.note='正在处理稿件…';this.changed();}
  private finish():void{this.busy=false;this.changed();}
  private accept(row:WorkspaceEntry):void{this.id=row.id;this.revision=row.revision;this.title=row.title;this.text=row.text;this.baselineTitle=row.title;this.baselineText=row.text;}
  async choose(id:string,confirm:()=>Promise<boolean>):Promise<void>{
    if(this.busy)throw new Error('上一项稿件操作仍在处理');
    const row=this.store.manuscriptSnapshot(id);
    if(id===this.id&&row.revision===this.revision){this.note='当前稿件已在编辑';this.changed();return;}
    this.begin();
    try{
      if(this.dirty&&!await confirm()){this.note='已取消切换，草稿保留';return;}
      this.accept(row);this.note=`正在编辑第${row.revision}版`;
    }catch(error){this.note=(error as Error).message;throw new Error(this.note);}finally{this.finish();}
  }
  async fresh(confirm:()=>Promise<boolean>):Promise<void>{
    this.begin();
    try{
      if(this.dirty&&!await confirm()){this.note='已取消新建，草稿保留';return;}
      this.id='';this.revision=0;this.title='';this.text='';this.baselineTitle='';this.baselineText='';this.note='新稿草稿';
    }catch(error){this.note=(error as Error).message;throw new Error(this.note);}finally{this.finish();}
  }
  async save(asNew:boolean=false):Promise<void>{
    const id=asNew?'':this.id,revision=asNew?0:this.revision,title=this.title,text=this.text;
    this.begin();
    try{const row=await this.store.saveManuscript(id,revision,title,text);this.accept(row);this.note=`稿件已保存 · 第${row.revision}版`;
    }catch(error){this.note=(error as Error).message;throw new Error(this.note);}finally{this.finish();}
  }
  async remove(id:string,confirm:(row:WorkspaceEntry)=>Promise<boolean>):Promise<void>{
    if(this.busy)throw new Error('上一项稿件操作仍在处理');const row=this.store.manuscriptSnapshot(id);this.begin();
    try{
      if(!await confirm(row)){this.note='已取消删除，稿件保留';return;}
      await this.store.deleteManuscript(row.id,row.revision);
      if(this.id===row.id){this.id='';this.revision=0;this.baselineTitle='';this.baselineText='';this.note='稿件已删除，当前草稿可另存为新稿';}
      else this.note='稿件已删除';
    }catch(error){this.note=(error as Error).message;throw new Error(this.note);}finally{this.finish();}
  }
  async importText(load:()=>Promise<string|undefined>,confirm:()=>Promise<boolean>):Promise<void>{
    this.begin();
    try{
      if(this.dirty&&!await confirm()){this.note='已取消导入，草稿保留';return;}
      const text=await load();if(text===undefined){this.note='已取消选择文件，草稿保留';return;}
      if(!text.trim()||text.length>100000||text.includes('\u0000'))throw new Error('需要非空UTF-8文本，正文不超过10万字');
      this.id='';this.revision=0;this.text=text;this.baselineTitle='';this.baselineText='';this.note='已导入为新稿草稿，确认标题后保存；未发送眼镜';
    }catch(error){this.note=(error as Error).message;throw new Error(this.note);}finally{this.finish();}
  }
}
export const manuscriptEditor:ManuscriptEditor=new ManuscriptEditor();
