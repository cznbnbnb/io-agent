import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
export const prompterModelSHA:string='68c9c943840f7d9cf3e8a4970ba50f404feb5277f611fa82b7e72267786fa84a';
export const prompterTokensSHA:string='6fed8c6c248516f38e7faa19404b57413e8ce259f1cbc1fa4aebc86eac32fdfd';
export class PrompterModelStore {
  private context:common.UIAbilityContext|undefined=undefined;private pending:Promise<string>|undefined=undefined;
  initialize(context:common.UIAbilityContext):void{this.context=context;}
  private exists(path:string):boolean{try{return fs.accessSync(path);}catch(_){return false;}}
  ensure():Promise<string>{if(!this.context)return Promise.reject(new Error('本机跟随模型尚未初始化'));if(!this.pending)this.pending=this.extract().finally(():void=>{this.pending=undefined;});return this.pending;}
  private async extract():Promise<string>{
    const context=this.context!;const dir=context.filesDir+'/prompter-ctc-zh-2025-04-01';
    if(!this.exists(dir))fs.mkdirSync(dir,true);
    for(const name of ['model.int8.onnx','tokens.txt']){
      const path=dir+'/'+name;if(this.exists(path))continue;
      const bytes=await context.resourceManager.getRawFileContent('models/prompter_ctc_zh/'+name);
      if(!bytes.length)throw new Error('本机跟随模型资源缺失');
      const temporary=path+'.part-'+String(Date.now());const file=fs.openSync(temporary,fs.OpenMode.CREATE|fs.OpenMode.READ_WRITE);
      try{
        let offset=0;while(offset<bytes.length){const chunk=bytes.slice(offset,offset+1048576);try{const n=fs.writeSync(file.fd,chunk.buffer);if(!Number.isSafeInteger(n)||n<=0||n>chunk.length)throw new Error('跟随模型写入失败');offset+=n;}finally{chunk.fill(0);}await new Promise<void>((resolve:()=>void)=>setTimeout(resolve,0));}
        fs.fsyncSync(file.fd);
      }finally{fs.closeSync(file);bytes.fill(0);}
      // An existing destination belongs to a prior extraction; the Worker
      // validates its complete SHA before loading. Never replace it here.
      if(!this.exists(path))fs.renameSync(temporary,path);else fs.unlinkSync(temporary);
    }
    return dir;
  }
}
