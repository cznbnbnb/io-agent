import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { MaterialStore, MaterialSource, MaterialTextInput } from './MaterialStore';
import { markMaterialDeleted } from './MaterialDeletion';

export class MaterialDeletionReport {
  schema:number=1;kind:string='isolated_material_deletion';phase:string='';run_id:string='';at:number=0;
  status:string='failed';checks:string[]=[];error:string='';
  // No user content, credentials or real audio. These are synthetic fixture IDs.
  material_ids:string[]=[];revisions:number[]=[];source_cleanup_complete:boolean=false;
}

// Real filesystem diagnostic confined to a fresh private synthetic directory.
// Never imports RecordingService/AppRuntime, connects Bluetooth or sends network.
export class MaterialDeletionLab {
  private check(ok:boolean,label:string,report:MaterialDeletionReport):void{
    if(!ok)throw new Error(label);report.checks.push(label);
  }
  private write(path:string,text:string):void{
    const bytes=new util.TextEncoder().encodeInto(text);
    const file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const count=fs.writeSync(file.fd,bytes.slice(offset).buffer);
      if(count<=0)throw new Error('DELETE_LAB_WRITE_FAILED');offset+=count;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}fs.renameSync(path+'.partial',path);
  }
  run(filesDir:string,phase:string,runId:string):MaterialDeletionReport{
    const report=new MaterialDeletionReport();report.phase=phase;report.run_id=runId;report.at=Date.now();
    if(!/^[0-9]{13}$/.test(runId)||!['material-delete-seed','material-delete-resume'].includes(phase)){
      report.error='DELETE_LAB_PARAMETERS_INVALID';return report;
    }
    const parent=filesDir+'/p32-material-delete-lab',root=parent+'/'+runId;
    try{
      if(!fs.accessSync(parent))fs.mkdirSync(parent);
      if(phase==='material-delete-seed'){
        this.check(!fs.accessSync(root),'fresh_synthetic_directory',report);fs.mkdirSync(root);
      }else this.check(fs.accessSync(root),'existing_synthetic_directory',report);
      const store=new MaterialStore();store.initialize(root);
      for(const kind of ['recording','lifelog']){
        const source=new MaterialSource();source.kind=kind;
        source.name=(kind==='recording'?'take-':'seg-')+'e'.repeat(19)+runId;
        source.started=1000;source.ended=61000;source.complete=true;
        const id=store.idFor(kind,source.name),marker=root+'/'+kind+'-synthetic-source.bin';
        const input=new MaterialTextInput();input.text='Synthetic deletion fixture';
        if(phase==='material-delete-seed'){
          this.write(marker,'Synthetic marker bytes, not recorded audio');
          const first=store.ensure(source),text=store.appendTranscript(id,first.revision,input,'delete-lab-job');
          const deleted=markMaterialDeleted(store,source);
          this.check(deleted.operation==='delete'&&deleted.revision===text.revision+1&&!deleted.text&&deleted.utterances.length===0,
            kind+'_tombstone_committed',report);
          this.check(fs.accessSync(marker),kind+'_interrupted_cleanup_source_preserved',report);
          this.check(store.read(id,text.revision)?.text===input.text,kind+'_historical_revision_preserved',report);
          report.material_ids.push(id);report.revisions.push(deleted.revision);
        }else{
          const deleted=store.read(id);
          this.check(deleted?.operation==='delete'&&deleted.revision===3,kind+'_cold_tombstone_restored',report);
          this.check(store.ensure(source,'Stale synthetic text').operation==='delete',kind+'_rescan_does_not_revive',report);
          for(const job of ['delete-lab-job','different-late-job']){
            let rejected=false;try{store.appendTranscript(id,deleted!.revision,input,job);}catch(error){rejected=(error as Error).message==='MATERIAL_DELETED';}
            this.check(rejected,kind+'_'+job+'_rejected',report);
          }
          this.check(markMaterialDeleted(store,source).revision===deleted!.revision,kind+'_retry_keeps_same_revision',report);
          // Exact synthetic marker only: no supplied filename or user directory.
          if(fs.accessSync(marker))fs.unlinkSync(marker);
          this.check(!fs.accessSync(marker)&&store.read(id)?.operation==='delete',kind+'_source_cleanup_complete',report);
          report.material_ids.push(id);report.revisions.push(deleted!.revision);
        }
      }
      report.source_cleanup_complete=phase==='material-delete-resume';report.status='passed';
    }catch(error){report.error=(error as Error).message;}
    if(fs.accessSync(root))this.write(root+'/'+phase+'-report.json',JSON.stringify(report));
    return report;
  }
}
