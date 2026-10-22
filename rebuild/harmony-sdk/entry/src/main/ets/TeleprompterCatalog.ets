import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { businessEnvelope,readLauncherEnvelope } from 'turbo_core';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';

export class OwnedPrompterItem {
  peer:string='';did:string='';pin:boolean=false;title:string='';offset:number=0;scroll:number=2;
  total:number=0;timestamp:number=0;timezone:number=0;preview:string='';
}
class OwnedPrompterSnapshot {schema:number=1;items:OwnedPrompterItem[]=[];}
interface CatalogWireItem {did:string;pin:boolean;title:string;offset:number;scroll:number;total:number;timestamp:number;timezone:number;preview:string;}
interface CatalogChunk {chunkid:number;total:number;islast:boolean;}
interface CatalogDelta {action:number;type:number;total:number;chunkinfo:CatalogChunk;items:CatalogWireItem[];}
// This is the completed-file inventory owned by this App, not all glasses files.
// Only batchAdd is emitted. Never answer a full-sync request with this partial list.
export class TeleprompterCatalog {
  note:string='';changed:()=>void=():void=>{};
  private path:string='';private items:OwnedPrompterItem[]=[];private epoch:number=0;private busy:boolean=false;
  private send:(business:number,payload:Uint8Array)=>Promise<void>;private device:()=>string;
  constructor(send:(business:number,payload:Uint8Array)=>Promise<void>,device:()=>string){this.send=send;this.device=device;}
  initialize(context:common.UIAbilityContext):void{
    this.disconnect();this.path='';this.items=[];const path=context.filesDir+'/prompter-owned-catalog.json';let exists=false;
    try{exists=fs.accessSync(path);}catch(error){if((error as BusinessError).code!==13900002)throw new Error('稿件标题记录暂不可读');}
    if(exists){
      if(fs.statSync(path).size>262144)throw new Error('稿件标题记录过大，暂不更新眼镜列表');
      const saved=JSON.parse(fs.readTextSync(path)) as OwnedPrompterSnapshot;
      if(saved.schema!==1||!Array.isArray(saved.items)||saved.items.length>500)throw new Error('稿件标题记录待核对');
      const seen:string[]=[];for(const item of saved.items){this.validate(item);const key=item.peer+':'+item.did;if(seen.includes(key))throw new Error('稿件标题记录有重复');seen.push(key);}
      this.items=saved.items;
    }
    this.path=path;
  }
  private validate(item:OwnedPrompterItem):void{
    if(typeof item.peer!=='string'||!/^\w[\w:.-]{0,127}$/.test(item.peer)||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(item.did)||
      typeof item.title!=='string'||!item.title.trim()||item.title.length>100||/[\u0000-\u001f\u007f]/.test(item.title)||item.pin!==false||item.offset!==0||![1,2].includes(item.scroll)||
      !Number.isSafeInteger(item.total)||item.total<1||item.total>48000||!Number.isSafeInteger(item.timestamp)||item.timestamp<1||
      !Number.isSafeInteger(item.timezone)||Math.abs(item.timezone)>50400||typeof item.preview!=='string'||item.preview.length>200)throw new Error('稿件标题记录无效');
  }
  private persist(items:OwnedPrompterItem[]):void{
    const snapshot=new OwnedPrompterSnapshot();snapshot.items=items;const bytes=new util.TextEncoder().encodeInto(JSON.stringify(snapshot));
    if(bytes.length>262144){bytes.fill(0);throw new Error('标题记录空间不足');}
    const file=fs.openSync(this.path+'.next',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const chunk=bytes.slice(offset);try{const n=fs.writeSync(file.fd,chunk.buffer);if(!Number.isSafeInteger(n)||n<=0||n>chunk.length)throw new Error('标题记录写入失败');offset+=n;}finally{chunk.fill(0);}}fs.fsyncSync(file.fd);}
    finally{bytes.fill(0);fs.closeSync(file);}fs.renameSync(this.path+'.next',this.path);this.items=items;
  }
  async addCompleted(peer:string,did:string,title:string,text:string,total:number,mode:number):Promise<void>{
    const token=this.epoch;let claimed=false;
    try{
      if(!this.path||this.busy||peer!==this.device())throw new Error('CATALOG_NOT_READY');
      const item=new OwnedPrompterItem();item.peer=peer;item.did=did;item.title=title.trim()||'未命名文稿';item.total=total;item.scroll=mode;
      const original=new util.TextEncoder().encodeInto(text);try{if(original.length!==total)throw new Error('CATALOG_SOURCE_SIZE');}finally{original.fill(0);}
      item.timestamp=Math.floor(Date.now()/1000);item.timezone=-new Date().getTimezoneOffset()*60;item.preview=Array.from(text).slice(0,80).join('');this.validate(item);
      if(this.items.some((row:OwnedPrompterItem):boolean=>row.peer===peer&&row.did===did))throw new Error('CATALOG_ALREADY_REGISTERED');
      // Temporary containment: failure correlated with the eighth owned row.
      // Seven is not a verified device limit. The playback path is detached
      // from catalog writes until safe synchronization is established.
      if(this.items.filter((row:OwnedPrompterItem):boolean=>row.peer===peer).length>=7)throw new Error('CATALOG_LIMIT');
      if(this.items.length>=500)throw new Error('CATALOG_FULL');this.busy=true;claimed=true;this.persist([...this.items,item]);
      // Header total describes this App inventory. Chunk total counts changed
      // items; the original increment path deliberately uses different counts.
      const totalItems=this.items.filter((row:OwnedPrompterItem):boolean=>row.peer===peer).length;
      const body:CatalogDelta={action:2,type:3,total:totalItems,chunkinfo:{chunkid:1,total:1,islast:true},items:[{did:item.did,pin:item.pin,title:item.title,offset:item.offset,scroll:item.scroll,total:item.total,timestamp:item.timestamp,timezone:item.timezone,preview:item.preview}]};
      const json=new util.TextEncoder().encodeInto(JSON.stringify(body));const payload=businessEnvelope(1,json);json.fill(0);
      try{if(token!==this.epoch||peer!==this.device())throw new Error('CATALOG_CANCELLED');await this.send(20,payload);if(token!==this.epoch)return;
        this.note='已提交稿件标题；眼镜列表效果待确认';hilog.info(0x2a03,'TurboIO','prompter catalog tx did=%{public}s operation=batchAdd count=1 owned=%{public}d',did,totalItems);this.changed();}
      finally{payload.fill(0);}
    }catch(_){if(token===this.epoch){this.note='稿件标题更新未确认；正文提词仍可使用';this.changed();}throw new Error('CATALOG_UNCONFIRMED');}
    finally{if(claimed&&token===this.epoch)this.busy=false;}
  }
  receive(peer:string,business:number,bytes:Uint8Array):void{
    if(peer!==this.device()||business!==20||bytes.length>16384)return;
    try{const packet=readLauncherEnvelope(bytes);
      try{if(packet.type!==1||packet.binary.length)return;const body=JSON.parse(new util.TextDecoder().decodeToString(packet.json)) as Record<string,Object>;
        if(body['action']!==1||!Number.isInteger(body['type'] as number))return;const type=body['type'] as number;
        // No operation ID: these are observations, never proof of title display.
        hilog.info(0x2a03,'TurboIO','prompter catalog observed action=1 type=%{public}d uncorrelated=true',type);
        if(type===1)this.note='眼镜请求文稿列表同步；本轮不替换已有列表';
        else if(type===2)this.note='眼镜请求列表重传；标题更新结果待核对';
        else if(type===3)this.note='已观察眼镜列表接收通知；标题效果待确认';
        else if(type===4)this.note='眼镜报告列表异常；标题更新未确认';else return;this.changed();
      }finally{packet.json.fill(0);packet.binary.fill(0);}
    }catch(_){/* Malformed or unrelated list traffic must not affect playback. */}
  }
  disconnect():void{this.epoch++;this.busy=false;}
}
