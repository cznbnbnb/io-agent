// 每日记录上传：把当天的汇总 Markdown 与全部 OGG 音频以 multipart/form-data POST 到用户自己的服务器。
// 协议：POST <url>，表单字段 date=<YYYY-MM-DD>，文件字段 file=<date>.md 与 file=<seg>.ogg；
// 可选 Authorization: Bearer <token>。服务端只需把文件落盘即可（也可按需改写）。
import { http } from '@kit.NetworkKit';

export class UploadTarget {
  url:string='';token:string='';auto:boolean=false;time:string='23:30';
}

export class UploadService {
  note:string='';
  async upload(target:UploadTarget,date:string,markdownPath:string,audioFiles:string[]):Promise<string>{
    if(!/^https:\/\/[^\s/?#@:]+(?::[0-9]+)?(?:\/[^\s?#]*)?$/.test(target.url))throw new Error('上传地址需为 HTTPS');
    const list:http.MultiFormData[]=[];
    list.push({name:'date',contentType:'text/plain',data:date});
    list.push({name:'file',contentType:'text/markdown',remoteFileName:`${date}.md`,filePath:markdownPath});
    for(const path of audioFiles){
      const at=path.lastIndexOf('/');
      const name=at>=0?path.slice(at+1):path;
      list.push({name:'file',contentType:'audio/ogg',remoteFileName:name,filePath:path});
    }
    const request=http.createHttp();
    try{
      const header:Record<string,string>={};
      if(target.token)header['Authorization']=`Bearer ${target.token}`;
      const response=await request.request(target.url,{method:http.RequestMethod.POST,header:header,
        multiFormDataList:list,connectTimeout:20000,readTimeout:180000,
        expectDataType:http.HttpDataType.STRING,maxLimit:200000});
      if(response.responseCode<200||response.responseCode>=300)throw new Error(`服务器返回 HTTP ${response.responseCode}`);
      const body=typeof response.result==='string'?response.result:'';
      this.note=`已上传 ${list.length-1} 个文件（HTTP ${response.responseCode}）`;
      return body.slice(0,300);
    }catch(error){
      const message=(error as Error).message;
      if(message.indexOf('HTTP ')>=0)throw new Error(message);
      throw new Error('上传失败：网络不可达或服务器拒绝（未记录地址与凭据）');
    }finally{request.destroy();}
  }
}
