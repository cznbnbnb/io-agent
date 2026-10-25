import {spawn} from 'node:child_process';
import {BridgeError} from './client.mjs';

// Runtime adapter as a separate process: one JSON frame per line, id-matched
// request/response. The bridge keeps network durability and the adapter keeps
// runtime knowledge; an adapter can only cause the actions it actually returns.
//   -> {"id":7,"type":"hello","protocol":1}                    <- {"id":7,"ok":true,"capabilities":{...}}
//   -> {"id":8,"type":"item","item":{...}}                     <- {"id":8,"ok":true,"actions":[...]}
//   -> {"id":9,"type":"answer","request":{...},"answer":{...}} <- {"id":9,"ok":true,"actions":[...]}
//   -> {"id":10,"type":"closed","request":{...}}               <- {"id":10,"ok":true,"actions":[...]}
export class AdapterHost{
  #child=null;#pending=new Map();#buffer='';#sequence=0;#capabilities={can_execute:false};#stopPromise=null;#failureCode=null;
  constructor({command,args=[],env={},timeoutMs=15000,name='adapter'}={}){
    if(typeof command!=='string'||!command)throw new BridgeError('ADAPTER_COMMAND_REQUIRED',{permanent:true});
    if(!Array.isArray(args)||args.some(v=>typeof v!=='string')||!Number.isSafeInteger(timeoutMs)||timeoutMs<50||timeoutMs>60000)
      throw new BridgeError('INVALID_ADAPTER_CONFIG',{permanent:true});
    this.command=command;this.args=args;this.env=env;this.timeoutMs=timeoutMs;this.name=name;
  }
  get capabilities(){return this.#capabilities;}
  async start(){
    if(this.#stopPromise)throw new BridgeError('ADAPTER_STOPPING',{permanent:true});
    if(this.#child){
      if(this.#failureCode)throw new BridgeError(this.#failureCode,{permanent:true});
      if(this.#child.exitCode!==null||this.#child.signalCode!==null)throw new BridgeError('ADAPTER_EXITED',{permanent:true});
      return this.#capabilities;
    }
    this.#buffer='';this.#failureCode=null;
    this.#child=spawn(this.command,this.args,{stdio:['pipe','pipe','pipe'],env:{...process.env,...this.env},windowsHide:true});
    const ownedChild=this.#child;
    this.#child.stdout.setEncoding('utf8');
    this.#child.stdout.on('data',chunk=>{if(this.#child===ownedChild)this.#ingest(chunk);});
    this.#child.stderr.setEncoding('utf8');
    // Runtime stderr may contain prompts, credentials or source text. Drain it,
    // but never copy it into BridgeError/log output.
    this.#child.stderr.on('data',()=>{});
    this.#child.stdin.on('error',()=>{if(this.#child===ownedChild)this.#fault('ADAPTER_EXITED');});
    this.#child.on('error',()=>{if(this.#child===ownedChild)this.#fault('ADAPTER_SPAWN_FAILED');});
    this.#child.on('exit',()=>{if(this.#child===ownedChild)this.#fault('ADAPTER_EXITED',false);});
    let reply;try{reply=await this.#send({type:'hello',protocol:1});}catch(error){await this.stop();throw error;}
    if(this.#failureCode){const code=this.#failureCode;await this.stop();throw new BridgeError(code,{permanent:true});}
    const capabilities=reply.capabilities;
    if(!capabilities||typeof capabilities!=='object'||Array.isArray(capabilities)||typeof capabilities.can_execute!=='boolean'||
      capabilities.async_events!==undefined&&typeof capabilities.async_events!=='boolean'||
      capabilities.admission_probe_v1!==undefined&&typeof capabilities.admission_probe_v1!=='boolean'||
      capabilities.control_intake_probe_v1!==undefined&&typeof capabilities.control_intake_probe_v1!=='boolean'||
      capabilities.task_session_control_v1!==undefined&&typeof capabilities.task_session_control_v1!=='boolean'||
      capabilities.answer_intake_probe_v1!==undefined&&typeof capabilities.answer_intake_probe_v1!=='boolean'){
      this.#fault('ADAPTER_PROTOCOL');await this.stop();throw new BridgeError('ADAPTER_PROTOCOL',{permanent:true,detail:'capabilities'});
    }
    this.#capabilities={...capabilities};
    return this.#capabilities;
  }
  async #actions(payload){
    const value=await this.#send(payload);
    // A valid reply followed by garbage in the same read must not escape as a
    // successful action set while the protocol has already failed.
    if(this.#failureCode)throw new BridgeError(this.#failureCode,{permanent:true});
    if(!Array.isArray(value.actions)){this.#fault('ADAPTER_PROTOCOL');throw new BridgeError('ADAPTER_PROTOCOL',{permanent:true});}
    return value.actions;
  }
  onItem(item,context={}){return this.#actions({type:'item',item,...context});}
  onAnswer(value,context={}){return this.#actions({type:'answer',request:value.request,answer:value.answer,...context});}
  onRequestClosed(value,context={}){return this.#actions({type:'closed',request:value.request,...context});}
  async inspectAdmission(value){
    const frame=await this.#send({type:'admission_probe',...value});
    if(this.#failureCode)throw new BridgeError(this.#failureCode,{permanent:true});
    if(!frame.admission||typeof frame.admission!=='object'||Array.isArray(frame.admission)){
      this.#fault('ADAPTER_PROTOCOL');throw new BridgeError('ADAPTER_PROTOCOL',{permanent:true});
    }
    return frame.admission;
  }
  async inspectAnswerIntake(value){
    const frame=await this.#send({type:'answer_intake_probe',...value});
    if(this.#failureCode)throw new BridgeError(this.#failureCode,{permanent:true});
    if(!frame.answer_intake||typeof frame.answer_intake!=='object'||Array.isArray(frame.answer_intake)){
      this.#fault('ADAPTER_PROTOCOL');throw new BridgeError('ADAPTER_PROTOCOL',{permanent:true});
    }
    return frame.answer_intake;
  }
  async inspectControlIntake(value){
    const frame=await this.#send({type:'control_intake_probe',...value});
    if(this.#failureCode)throw new BridgeError(this.#failureCode,{permanent:true});
    if(!frame.control_intake||typeof frame.control_intake!=='object'||Array.isArray(frame.control_intake)){
      this.#fault('ADAPTER_PROTOCOL');throw new BridgeError('ADAPTER_PROTOCOL',{permanent:true});
    }
    return frame.control_intake;
  }
  async pollEvents(){
    const frame=await this.#send({type:'events',limit:20});
    if(this.#failureCode)throw new BridgeError(this.#failureCode,{permanent:true});
    if(!Array.isArray(frame.events)){this.#fault('ADAPTER_PROTOCOL');throw new BridgeError('ADAPTER_PROTOCOL',{permanent:true});}
    return frame.events;
  }
  async acknowledgeEvents(eventIds){
    await this.#send({type:'events_ack',event_ids:eventIds});
    if(this.#failureCode)throw new BridgeError(this.#failureCode,{permanent:true});
  }
  stop(){
    if(this.#stopPromise)return this.#stopPromise;
    this.#stopPromise=this.#stop().finally(()=>{this.#stopPromise=null;});return this.#stopPromise;
  }
  async #stop(){
    const child=this.#child,graceful=this.#capabilities.graceful_shutdown===true&&!this.#failureCode;
    this.#capabilities={can_execute:false,unavailable:true};this.#failAll('ADAPTER_STOPPED');
    if(!child)return;
    if(graceful&&child.exitCode===null&&child.signalCode===null){
      // Windows SIGTERM cannot be relied on for a Python cleanup handler. Give
      // the owned adapter a protocol shutdown before falling back to OS kill.
      try{await this.#send({type:'shutdown'});}catch{}
    }
    if(child.exitCode===null&&child.signalCode===null&&child.pid!==undefined)await new Promise((resolve,reject)=>{
      let force,deadline,done=false;
      const finish=error=>{if(done)return;done=true;clearTimeout(force);clearTimeout(deadline);child.off('exit',onExit);
        if(error)reject(new BridgeError('ADAPTER_STOP_FAILED',{permanent:true}));else resolve();};
      const onExit=()=>finish();child.once('exit',onExit);
      force=setTimeout(()=>{
        try{child.kill('SIGKILL');}catch{finish(true);return;}
        // A kill request alone is not proof of process exit. Keep the child
        // reference and fail shutdown if no exit event confirms it.
        deadline=setTimeout(()=>finish(true),2000);
      },2000);
      try{child.kill('SIGTERM');child.stdin.destroy();}catch{finish(true);}
    });
    if(this.#child===child)this.#child=null;
  }
  #ingest(chunk){
    if(this.#failureCode)return;
    this.#buffer+=chunk;
    if(Buffer.byteLength(this.#buffer)>1048576){this.#fault('ADAPTER_PROTOCOL');return;}
    let index;
    while((index=this.#buffer.indexOf('\n'))>=0){
      const line=this.#buffer.slice(0,index);this.#buffer=this.#buffer.slice(index+1);
      if(!line.trim())continue;
      let frame;
      try{frame=JSON.parse(line);}catch{this.#fault('ADAPTER_PROTOCOL');return;}
      if(!frame||typeof frame!=='object'||Array.isArray(frame)||!Number.isSafeInteger(frame.id)||typeof frame.ok!=='boolean'){
        this.#fault('ADAPTER_PROTOCOL');return;
      }
      const entry=this.#pending.get(frame?.id);
      if(!entry){this.#fault('ADAPTER_PROTOCOL');return;}
      if(frame.ok!==true){this.#fault('ADAPTER_REJECTED');return;}
      this.#pending.delete(frame.id);clearTimeout(entry.timer);
      entry.resolve(frame);
    }
  }
  #fault(code,kill=true){
    this.#failureCode??=code;this.#capabilities={can_execute:false,unavailable:true};this.#failAll(this.#failureCode);
    if(kill)try{this.#child?.kill('SIGKILL');this.#child?.stdin.destroy();}catch{}
  }
  #failAll(code){
    for(const [id,entry] of this.#pending){
      clearTimeout(entry.timer);entry.reject(new BridgeError(code,{permanent:true}));
      this.#pending.delete(id);
    }
  }
  #send(payload){
    const child=this.#child;
    if(this.#failureCode)return Promise.reject(new BridgeError(this.#failureCode,{permanent:true}));
    if(!child||child.exitCode!==null)return Promise.reject(new BridgeError('ADAPTER_EXITED',{permanent:true}));
    const id=++this.#sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        // A silent adapter must not be treated as success: kill it and report.
        this.#fault('ADAPTER_TIMEOUT');
      },this.timeoutMs);
      this.#pending.set(id,{resolve,reject,timer});
      try{child.stdin.write(JSON.stringify({id,...payload})+'\n');}
      catch{this.#fault('ADAPTER_EXITED');}
    });
  }
}
