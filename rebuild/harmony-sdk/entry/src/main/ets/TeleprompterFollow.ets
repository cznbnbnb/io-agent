import * as audio from 'libturbo_audio.so';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { ContinuousASR } from './ContinuousASR';
import { TeleprompterAlignment,FollowPosition } from './TeleprompterAlignment';
import { SecureServiceConfig,ServiceConfig } from './RemoteServices';
import { TeleprompterFollowHandle } from './TeleprompterSession';
import { common } from '@kit.AbilityKit';
import { LocalFollowASR } from './LocalFollowASR';
import { PrompterModelStore } from './PrompterModel';
import { hilog } from '@kit.PerformanceAnalysisKit';
export class TeleprompterFollow implements TeleprompterFollowHandle {
  onPosition:(position:FollowPosition)=>void=(_position:FollowPosition):void=>{};
  onStatus:(note:string)=>void=(_note:string):void=>{};
  onError:(note:string)=>void=(_note:string):void=>{};
  private stream:ContinuousASR=new ContinuousASR();private matcher:TeleprompterAlignment|undefined=undefined;
  private epoch:number=0;private listening:boolean=false;private holdUntil:number=0;private packets:number=0;private matches:number=0;
  private vault:SecureServiceConfig=new SecureServiceConfig();
  private config:ServiceConfig|undefined=undefined;
  private textUpdates:number=0;
  private local:LocalFollowASR=new LocalFollowASR();private models:PrompterModelStore=new PrompterModelStore();private source:string='cloud';
  initialize(context:common.UIAbilityContext):void{this.models.initialize(context);}
  async prepare(text:string,source:string='cloud'):Promise<void>{
    if(!['local','cloud'].includes(source))throw new Error('跟随识别来源无效');
    this.stop();const token=this.epoch;this.source=source;this.textUpdates=0;
    if(source==='local'){
      const directory=await this.models.ensure();if(token!==this.epoch)throw new Error('跟随准备已取消');
      await this.local.prepare(directory);if(token!==this.epoch)throw new Error('跟随准备已取消');
      this.matcher=new TeleprompterAlignment(text);this.matches=0;this.packets=0;return;
    }
    const stored=await this.vault.load();if(token!==this.epoch)throw new Error('跟随准备已取消');
    const config=new ServiceConfig();config.asrHost=stored.asrHost;config.asrModel=stored.asrModel;config.asrKey=stored.asrKey;
    if(!config.asrKey)throw new Error('朗读跟随需要先保存云转写配置');this.config=config;this.matcher=new TeleprompterAlignment(text);this.matches=0;this.packets=0;
  }
  async begin():Promise<void>{
    this.pause();const token=this.epoch;if(!this.matcher||this.source==='cloud'&&!this.config)throw new Error('跟随稿件未准备');
    // Only ASR fields cross into this client, never model/server/office keys.
    const config=this.config;
    const random=cryptoFramework.createRandom().generateRandomSync(16).data;
    const task=Array.from(random).map((value:number):string=>value.toString(16).padStart(2,'0')).join('');random.fill(0);
    const onText=(text:string,final:boolean,_id:number):void=>{if(token!==this.epoch||!this.listening||Date.now()<this.holdUntil)return;this.textUpdates++;const position=this.matcher?.match(text,final);hilog.info(0x2a03,'TurboIO','follow asr source=%{public}s round=%{public}d chars=%{public}d final=%{public}s matched=%{public}s',this.source,token,text.length,String(final),String(position!==undefined));if(position){this.matches++;this.onPosition(position);this.onStatus('跟随已匹配 '+this.matches+' 次；设备位置另行确认');}else if(this.textUpdates===1)this.onStatus('已识别到文字，等待与当前正文匹配');};
    const onError=(note:string):void=>{if(token!==this.epoch)return;this.pause();this.onError(note);};
    if(this.source==='local'){this.local.onText=onText;this.local.onError=onError;}else{this.stream.onText=onText;this.stream.onError=onError;}
    this.onStatus(this.source==='local'?'正在启动本机跟随':'正在连接跟随转写');
    try{audio.prompterReset();this.listening=true;this.holdUntil=0;if(this.source==='local')await this.local.begin();else await this.stream.start(config!,task);if(token!==this.epoch)throw new Error('跟随启动已取消');this.onStatus(this.source==='local'?'本机跟随就绪 · 音频不外发':'跟随转写就绪');}
    catch(error){if(token===this.epoch)this.pause();throw new Error((error as Error).message);}
  }
  opus(bytes:Uint8Array):void{
    if(!this.listening)return;
    const token=this.epoch;
    const packet=bytes.slice();
    try{const pcm=new Uint8Array(audio.prompterDecode(packet.buffer));let sum=0;try{for(let i=0;i<pcm.length;i+=2){let value=pcm[i]|pcm[i+1]<<8;if(value>=32768)value-=65536;sum+=value*value;}if(this.source==='local')this.local.append(pcm);else this.stream.append(pcm);if(token===this.epoch&&(this.packets===0||this.packets%50===0))hilog.info(0x2a03,'TurboIO','follow audio source=%{public}s round=%{public}d packets=%{public}d samples=%{public}d rms=%{public}d texts=%{public}d',this.source,token,this.packets+1,pcm.length/2,Math.round(Math.sqrt(sum/(pcm.length/2))),this.textUpdates);}finally{pcm.fill(0);}if(token!==this.epoch)return;this.packets++;if(this.packets===1)this.onStatus('已收到眼镜跟随音频，等待正文匹配');}
    catch(_){this.pause();this.onError('跟随音频解码失败；请暂停或退出后重试');}
    finally{packet.fill(0);}
  }
  boundary(value:number):boolean{return this.matcher?.boundary(value)===true;}
  reanchor(value:number):void{if(this.matcher?.boundary(value)){this.matcher.reanchor(value);this.holdUntil=Date.now()+700;this.onStatus('眼镜手动位置已更新；重新定位朗读');}}
  pause():void{this.epoch++;this.listening=false;this.stream.close();this.local.pause();try{audio.prompterClose();}catch(_){};}
  stop():void{this.pause();this.local.close();this.matcher=undefined;if(this.config)this.config.asrKey='';this.config=undefined;}
  waitForExit():Promise<void>{return this.local.waitForExit();}
}
