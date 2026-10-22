import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { AsrEngineClient } from './AsrEngine';
import { CodecCheckResult } from './LifelogPcmWindow';
import { cloneDailyLabSource } from './DailyLabSourceClone';

class CodecProbeReport {
  schema:number=1;kind:string='p22_native_pcm_equivalence';started:number=0;finished:number=0;
  phase:string='running';error:string='';sourceSha256:string='';result:CodecCheckResult|undefined=undefined;
}
// Own copied lab source + own finite Worker. Never captures, publishes text,
// runs tools or uploads. Does not replace the previous daily trial pointer.
export class CodecWindowProbe {
  private active:boolean=false;private engine:AsrEngineClient|undefined=undefined;private cancelled:boolean=false;
  cancel():void{this.cancelled=true;this.engine?.close();}
  async run(context:common.UIAbilityContext,base:string,from:string,name:string):Promise<string>{
    if(this.active)throw new Error('CODEC_PROBE_BUSY');this.active=true;this.cancelled=false;
    const report=new CodecProbeReport();report.started=Date.now();const root=base+'/run-'+report.started;
    const persist=():void=>{
      const bytes=new util.TextEncoder().encodeInto(JSON.stringify(report));
      const file=fs.openSync(root+'/codec-window-probe.json.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
      try{let at=0;while(at<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(at).buffer);if(n<=0)throw new Error('CODEC_PROBE_REPORT_WRITE');at+=n;}fs.fsyncSync(file.fd);}
      finally{fs.closeSync(file);bytes.fill(0);}fs.renameSync(root+'/codec-window-probe.json.partial',root+'/codec-window-probe.json');
    };
    try{
      report.sourceSha256=cloneDailyLabSource(base,from,root,name);persist();
      this.engine=new AsrEngineClient(context.filesDir,(_p:number,_n:string):void=>{});
      report.result=await this.engine.codecProbe(root+'/lifelog/'+name+'/audio.ogg');
      report.phase=this.cancelled?'cancelled':report.result.equivalent?'verified':'not_verified';
    }catch(error){report.phase=this.cancelled?'cancelled':'failed';const message=(error as Error).message;
      report.error=/^[A-Z0-9_]{1,100}$/.test(message)?message:'details_kept_private';}
    finally{
      this.engine?.close();this.engine=undefined;this.active=false;report.finished=Date.now();
      if(fs.accessSync(root)){try{persist();}catch(_){report.phase='report_write_failed';}}
    }
    return report.phase;
  }
}
