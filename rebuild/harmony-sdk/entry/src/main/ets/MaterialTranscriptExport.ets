import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { MaterialRevision } from './MaterialStore';

// Export immutable canonical revisions. Legacy ASR JSON remains the original
// model output and is never rewritten into a different shape by a label edit.
export class MaterialTranscriptExport {
  private root:string='';
  initialize(filesDir:string):void{
    this.root=filesDir+'/material-transcripts';if(!fs.accessSync(this.root))fs.mkdirSync(this.root);
  }
  save(row:MaterialRevision,format:string='md'):string{
    if(!this.root||!/^mat-(recording|lifelog)-[0-9a-f]{32}$/.test(row.material_id)||
      !Number.isSafeInteger(row.revision)||row.revision<1||!['md','json'].includes(format)||row.operation==='delete')throw new Error('MATERIAL_EXPORT_INVALID');
    const content=format==='json'?JSON.stringify(row,null,2)+'\n':
      '# 记录文字\n\n- 资料：'+row.material_id+'\n- 资料修订：'+row.revision+'；文字修订：'+row.text_revision+
      '\n- 原音：'+(row.source.audioAvailable?'本机保留':'当前不可读')+'\n- 转写覆盖：'+(row.transcription_state==='complete'?'完整':row.transcription_state==='partial'?'部分':'尚未核实')+
      '\n\n'+row.text+'\n';
    const path=this.root+'/'+row.material_id+'-r'+row.revision+'.'+format;
    if(fs.accessSync(path)){if(fs.readTextSync(path)!==content)throw new Error('MATERIAL_EXPORT_CONFLICT');return path;}
    const bytes=new util.TextEncoder().encodeInto(content),file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const count=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(count<=0)throw new Error('MATERIAL_EXPORT_WRITE_FAILED');offset+=count;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}fs.renameSync(path+'.partial',path);return path;
  }
}
