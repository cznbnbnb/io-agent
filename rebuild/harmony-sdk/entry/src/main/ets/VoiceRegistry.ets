// 声纹角色库：给识别出的说话人绑定"角色卡"（名字 + 简介），跨天跨段稳定认人。
// 存法：filesDir/lifelog/voices.json，每个角色保存一段声纹嵌入（均值向量，base64 Float32）。
// 匹配：新一段的说话人中心与库中每个角色比余弦相似度，超过阈值即认为是同一个人。
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';

export class VoiceRole {
  id:string='';
  name:string='';
  bio:string='';
  embedding:string='';          // base64(Float32Array)
  samples:number=0;
  createdAt:number=0;
  updatedAt:number=0;
}

export class VoiceMatch { role:VoiceRole|undefined=undefined; score:number=-1; }

export class VoiceRegistry {
  roles:VoiceRole[]=[];
  static readonly limit:number=50;
  static readonly threshold:number=0.62;
  private file:string='';

  initialize(filesDir:string):void{
    this.file=filesDir+'/lifelog/voices.json';
    this.load();
  }

  load():void{
    this.roles=[];
    try{
      if(!fs.accessSync(this.file))return;
      const text=fs.readTextSync(this.file) as string;
      const parsed=JSON.parse(text.length?text:'[]') as VoiceRole[];
      if(!Array.isArray(parsed))return;
      for(const raw of parsed){
        if(!raw||typeof raw.name!=='string'||typeof raw.embedding!=='string')continue;
        const role=new VoiceRole();
        role.id=typeof raw.id==='string'?raw.id:'';
        role.name=raw.name;role.bio=typeof raw.bio==='string'?raw.bio:'';
        role.embedding=raw.embedding;
        role.samples=typeof raw.samples==='number'?raw.samples:1;
        role.createdAt=typeof raw.createdAt==='number'?raw.createdAt:Date.now();
        role.updatedAt=typeof raw.updatedAt==='number'?raw.updatedAt:role.createdAt;
        this.roles.push(role);
      }
    }catch(_){this.roles=[];}
  }

  save():void{
    try{
      if(fs.accessSync(this.file))fs.unlinkSync(this.file);
      const file=fs.openSync(this.file,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY);
      try{
        const body=new util.TextEncoder().encodeInto(JSON.stringify(this.roles));
        fs.writeSync(file.fd,body.buffer);fs.fsyncSync(file.fd);
      }finally{fs.closeSync(file);}
    }catch(_){}
  }

  static encode(vector:Float32Array):string{
    const bytes=new Uint8Array(vector.length*4);
    const view=new DataView(bytes.buffer);
    for(let i=0;i<vector.length;i++)view.setFloat32(i*4,vector[i],true);
    return new util.Base64Helper().encodeToStringSync(bytes);
  }

  static decode(text:string):Float32Array{
    const bytes=new util.Base64Helper().decodeSync(text);
    const count=Math.floor(bytes.length/4);
    const out=new Float32Array(count);
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    for(let i=0;i<count;i++)out[i]=view.getFloat32(i*4,true);
    return out;
  }

  static cosine(a:Float32Array,b:Float32Array):number{
    let dot=0,na=0,nb=0;
    const n=Math.min(a.length,b.length);
    for(let i=0;i<n;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}
    if(na<=0||nb<=0)return -2;
    return dot/Math.sqrt(na*nb);
  }

  // 找最像的角色；不到阈值就当没匹配上（宁可叫"说话人N"也不乱认人）。
  match(vector:Float32Array):VoiceMatch{
    const result=new VoiceMatch();
    for(const role of this.roles){
      const stored=VoiceRegistry.decode(role.embedding);
      if(stored.length!==vector.length)continue;
      const score=VoiceRegistry.cosine(stored,vector);
      if(score>result.score){result.score=score;result.role=role;}
    }
    // 不到阈值就不认人：宁可显示"说话人N"，也不要张冠李戴。
    if(result.score<VoiceRegistry.threshold)result.role=undefined;
    return result;
  }

  byId(id:string):VoiceRole|undefined{
    for(const role of this.roles){if(role.id===id)return role;}
    return undefined;
  }

  // 命名/更新一个声纹（同一个 id 或新 id 都可）；超过上限时报错。
  bind(id:string,name:string,bio:string,vector:Float32Array,now:number):VoiceRole{
    const trimmed=name.trim();
    if(!trimmed)throw new Error('请填写名字');
    if(trimmed.length>24)throw new Error('名字最长 24 个字');
    if(vector.length<8)throw new Error('声纹样本无效');
    let role=id?this.byId(id):undefined;
    if(!role){
      if(this.roles.length>=VoiceRegistry.limit)throw new Error(`最多 ${VoiceRegistry.limit} 个声纹，请先删除一些`);
      role=new VoiceRole();role.id=id||`v${now}${this.roles.length}`;role.createdAt=now;role.samples=0;
      this.roles.push(role);
    }
    role.name=trimmed;
    role.bio=bio.trim().slice(0,120);
    role.embedding=VoiceRegistry.encode(vector);
    role.samples+=1;
    role.updatedAt=now;
    this.save();
    return role;
  }

  rename(id:string,name:string,bio:string,now:number):void{
    const role=this.byId(id);
    if(!role)throw new Error('角色不存在');
    const trimmed=name.trim();
    if(!trimmed)throw new Error('请填写名字');
    role.name=trimmed;role.bio=bio.trim().slice(0,120);role.updatedAt=now;
    this.save();
  }

  remove(id:string):void{
    this.roles=this.roles.filter((role:VoiceRole):boolean=>role.id!==id);
    this.save();
  }

  // 展示顺序：设置过的角色置底（用户说"确认后置底"）。
  ordered():VoiceRole[]{
    return [...this.roles].sort((a:VoiceRole,b:VoiceRole):number=>a.createdAt-b.createdAt);
  }

  // 给 AI 总结用的角色卡清单。
  cards():string{
    const lines:string[]=[];
    for(const role of this.roles){
      if(!role.name)continue;
      lines.push(role.bio?`- ${role.name}：${role.bio}`:`- ${role.name}`);
    }
    return lines.join('\n');
  }
}
