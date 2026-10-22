import { worker,MessageEvents } from '@kit.ArkTS';
import { LocalFollowEngine } from '../LocalFollowEngine';
import { LocalFollowRequest,LocalFollowReply } from '../LocalFollowWire';
const port=worker.workerPort;const engine=new LocalFollowEngine();let generation:number=-1;
port.onmessage=(event:MessageEvents):void=>{
  const request=event.data as LocalFollowRequest;let reply=new LocalFollowReply();reply.generation=request.generation;reply.sequence=request.sequence;
  try{
    if(request.cmd==='load'){engine.load(request.directory);generation=request.generation;reply.type='loaded';}
    else if(request.cmd==='start'){generation=request.generation;engine.begin();reply.type='started';}
    else if(request.cmd==='pause'){generation=request.generation;engine.pause();return;}
    else if(request.cmd==='finish'){
      if(request.generation!==generation)return;reply=engine.finish();reply.generation=generation;reply.type='finished';
    }
    else if(request.cmd==='audio'){
      if(request.generation!==generation)return;reply=engine.append(request.pcm);reply.generation=generation;reply.sequence=request.sequence;reply.type='audio';
    }else throw new Error('REQUEST_INVALID');
  }catch(_){reply.type='error';reply.text='本机跟随模型或识别不可用，请退出后重试';}
  finally{request.pcm?.fill(0);}
  port.postMessage(reply);
};
