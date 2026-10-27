import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {atomic} from '../session-pairing.mjs';
import {prepareManagedCli,drainManagedCli} from '../questions/managed-cli.mjs';
import {privateRecord} from './resident-manager.mjs';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const need=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code});};
const MAX_FRAME=4*1024*1024,MAX_RESULT=1024*1024;

/** One client owns one ACP subprocess. It never replaces a Desktop launcher,
 * attaches to Desktop IPC, automatically approves tools, or retries a prompt.
 * ACP cancellation alone cannot certify that background work has stopped. */
export class AcpSession {
  static async connect({command,workspace,stateFile,sessionId,conversationId,timeoutMs=15000,permissionMode='cancel',connectorDirectory,glasses}){
    need(Array.isArray(command)&&command.length>0&&command.every(v=>typeof v==='string'&&!/[\0\r\n]/.test(v))&&
      path.isAbsolute(command[0])&&path.isAbsolute(workspace??'')&&path.isAbsolute(stateFile??'')&&
      ['cancel','phone'].includes(permissionMode)&&Number.isInteger(timeoutMs)&&timeoutMs>=100&&timeoutMs<=60000&&
      (sessionId===undefined||typeof sessionId==='string'&&sessionId.length>0&&sessionId.length<=256)&&
      (conversationId===undefined||typeof conversationId==='string'&&conversationId)&&(connectorDirectory===undefined||path.isAbsolute(connectorDirectory)),'ACP_CONFIG_INVALID');
    workspace=fs.realpathSync(workspace);need(fs.statSync(workspace).isDirectory(),'ACP_WORKSPACE_INVALID');
    const host=new AcpSession({command,workspace,stateFile,timeoutMs,conversationId,permissionMode,connectorDirectory,glasses});
    try{
      const init=await host.request('initialize',{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'io-agent-connector',version:'1.0.0'}});
      need(object(init)&&init.protocolVersion===1&&object(init.agentCapabilities),'ACP_VERSION_UNSUPPORTED');
      need(init.agentCapabilities.loadSession===true,'ACP_SESSION_LOAD_UNSUPPORTED');
      if(sessionId){
        host.sessionId=sessionId;await host.request('session/load',{sessionId,cwd:workspace,mcpServers:[]});
      }else{
        const created=await host.request('session/new',{cwd:workspace,mcpServers:[]});
        need(object(created)&&typeof created.sessionId==='string'&&created.sessionId&&created.sessionId.length<=256,'ACP_SESSION_INVALID');host.sessionId=created.sessionId;
      }
      host.conversationId??=host.sessionId;
      host.openJournal();host.ready=true;return host;
    }catch(error){await host.close();throw error;}
  }
  capabilities=Object.freeze({atomic_idle_start:true,exact_turn_interrupt:true,final_result_evidence:true,native_queue_expiry:false});
  ready=false;closed=false;sessionId=null;conversationId;workspace;
  #child;#pending=new Map();#next=0;#active=null;#operations={};#stateFile;#timeout;#buffer='';#exit;#saveError=false;#permissions=new Map();#permissionMode;#closing=null;#glasses;#connectorDirectory;#cliPump=null;#cliBusy=false;
  constructor({command,workspace,stateFile,timeoutMs,conversationId,permissionMode,connectorDirectory,glasses}){
    this.#glasses=glasses;this.#connectorDirectory=connectorDirectory;
    this.#permissionMode=permissionMode;
    this.workspace=workspace;this.conversationId=conversationId;this.#stateFile=stateFile;this.#timeout=timeoutMs;
    const env={...process.env};
    for(const key of ['CODEX_THREAD_ID','CLAUDE_CODE_SESSION_ID','IO_AGENT_CALLER_RUNTIME','IO_AGENT_CALLER_SESSION','IO_AGENT_CODEX_ENDPOINT','IO_AGENT_CODEX_RPC_PATH','IO_AGENT_CONNECTOR_PROFILE','CODEX_CLI_PATH','CODEX_APP_SERVER_USE_LOCAL_DAEMON','CLAUDECODE'])delete env[key];
    if(connectorDirectory)env.IO_AGENT_CONNECTOR_PROFILE=path.join(connectorDirectory,'connector.json');
    this.#child=spawn(command[0],command.slice(1),{cwd:workspace,env,shell:false,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],windowsHide:true});
    this.#exit=new Promise(resolve=>{this.#child.once('exit',resolve);this.#child.once('error',resolve);});
    this.#child.stderr.resume(); // Provider diagnostics may contain secrets; never publish them.
    const disconnected=()=>{
      this.closed=true;this.ready=false;
      for(const {reject,timer} of this.#pending.values()){clearTimeout(timer);reject(Object.assign(new Error('ACP_TRANSPORT_CLOSED'),{code:'ACP_TRANSPORT_CLOSED'}));}
      this.#pending.clear();
    };
    this.#child.once('exit',disconnected);this.#child.once('error',disconnected);
    this.#child.stdin.on('error',disconnected);
    this.#child.stdout.setEncoding('utf8');
    this.#child.stdout.on('data',chunk=>{
      this.#buffer+=chunk;
      try{
        need(Buffer.byteLength(this.#buffer)<=MAX_FRAME,'ACP_FRAME_LIMIT');
        let end;
        while((end=this.#buffer.indexOf('\n'))>=0){
          const line=this.#buffer.slice(0,end);this.#buffer=this.#buffer.slice(end+1);if(!line.trim())continue;
          const message=JSON.parse(line);need(object(message)&&message.jsonrpc==='2.0','ACP_PROTOCOL_INVALID');
          if(typeof message.method==='string'){
            if(Object.hasOwn(message,'id')){
              if(message.method==='session/request_permission'){
                need(message.params?.sessionId===this.sessionId,'ACP_SESSION_MISMATCH');
                const params=message.params;
                need(Array.isArray(params.options)&&params.options.every(o=>object(o)&&typeof o.optionId==='string'&&typeof o.kind==='string'),'ACP_PERMISSION_INVALID');
                const allow=params.options.find(o=>o.kind==='allow_once'),deny=params.options.find(o=>o.kind==='reject_once');
                const detail=JSON.stringify(params.toolCall?.rawInput??{}),title=params.toolCall?.title;
                if(this.#permissionMode==='phone'&&this.#active&&allow&&typeof title==='string'&&title.length<=500&&detail.length<=3000){
                  const id='acp-permission-'+randomUUID(),question='允许本次工具操作吗？\n'+title+'\n'+detail;
                  const timer=setTimeout(()=>{this.replyPermission(id,null);},180000);
                  this.#permissions.set(id,{requestId:id,turnId:this.#active.turnId,wireId:message.id,allow:allow.optionId,deny:deny?.optionId,timer,
                    question,expires_at:new Date(Date.now()+180000).toISOString()});
                }else{
                  this.send({jsonrpc:'2.0',id:message.id,result:{outcome:{outcome:'cancelled'}}});
                  if(this.#active)this.#active.permissionCancelled=true;
                }
              }else this.send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Client capability not advertised'}});
            }else if(message.method==='session/update'){
              need(object(message.params)&&typeof message.params.sessionId==='string'&&object(message.params.update),'ACP_UPDATE_INVALID');
              // History replay during load is never evidence for an uncertain prompt.
              if(!this.#active)continue;
              need(message.params.sessionId===this.sessionId,'ACP_SESSION_MISMATCH');
              const update=message.params.update;
              if(update.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text'){
                need(typeof update.content.text==='string','ACP_UPDATE_INVALID');
                this.#active.text+=update.content.text;need(Buffer.byteLength(this.#active.text)<=MAX_RESULT,'ACP_RESULT_LIMIT');
              }
              if(update.sessionUpdate==='tool_call'||update.sessionUpdate==='tool_call_update')this.#active.sawTools=true;
            }
          }else{
            const pending=this.#pending.get(message.id);need(pending,'ACP_RESPONSE_UNKNOWN');
            need(Object.hasOwn(message,'result')!==Object.hasOwn(message,'error'),'ACP_RESPONSE_INVALID');
            clearTimeout(pending.timer);this.#pending.delete(message.id);
            if(message.error){
              const text=typeof message.error.message==='string'?message.error.message.toLowerCase():'';
              pending.reject(Object.assign(new Error('ACP_RPC_REJECTED'),{code:'ACP_RPC_REJECTED',rpcMethod:pending.method,rpcCode:message.error.code,
                reasonClass:text.includes('auth')||text.includes('login')?'authentication':text.includes('not found')?'not_found':text.includes('invalid')?'invalid_parameters':text.includes('support')?'unsupported':'provider_error'}));
            }
            else pending.resolve(message.result);
          }
        }
      }catch(error){
        for(const {reject,timer}of this.#pending.values()){clearTimeout(timer);reject(error);}this.#pending.clear();
        void this.close();
      }
    });
  }
  openJournal(){
    if(fs.existsSync(this.#stateFile)){
      const state=privateRecord(this.#stateFile,64*1024*1024);
      need(state.schema_version===1&&state.session_id===this.sessionId&&state.workspace===this.workspace&&object(state.operations)&&Object.keys(state.operations).length<=1000,'ACP_JOURNAL_INVALID');
      this.#operations=state.operations;
      for(const [id,op]of Object.entries(this.#operations)){
        need(op.id===id&&typeof op.text==='string'&&typeof op.turnId==='string'&&['inProgress','completed','failed','interrupted','unknown'].includes(op.status),'ACP_JOURNAL_INVALID');
        if(op.status==='inProgress')op.status='unknown';
      }
    }
    // Empty ACP sessions may not be persisted by the native Agent. Keep the
    // managed route, but commit its native ID only with the first prompt intent.
    if(fs.existsSync(this.#stateFile))this.save();
  }
  save(){
    need(!this.#saveError,'ACP_STORAGE_UNCERTAIN');
    try{const value={schema_version:1,session_id:this.sessionId,workspace:this.workspace,operations:this.#operations};need(Buffer.byteLength(JSON.stringify(value))<=64*1024*1024,'ACP_JOURNAL_LIMIT');atomic(this.#stateFile,value);}
    catch(error){this.#saveError=true;throw error;}
  }
  send(message){need(!this.closed&&!this.#child.stdin.destroyed,'ACP_TRANSPORT_CLOSED');this.#child.stdin.write(JSON.stringify(message)+'\n');}
  request(method,params,{prompt=false}={}){
    need(!this.closed,'ACP_TRANSPORT_CLOSED');const id='io-'+(++this.#next);
    return new Promise((resolve,reject)=>{
      const timer=prompt?null:setTimeout(()=>{this.#pending.delete(id);reject(Object.assign(new Error('ACP_RPC_TIMEOUT'),{code:'ACP_RPC_TIMEOUT'}));},this.#timeout);
      this.#pending.set(id,{resolve,reject,timer,method});
      try{this.send({jsonrpc:'2.0',id,method,params});}catch(error){clearTimeout(timer);this.#pending.delete(id);reject(error);}
    });
  }
  async status(){need(this.ready&&!this.closed&&!this.#saveError,'ACP_HOST_UNAVAILABLE');return{conversationId:this.conversationId,workspace:this.workspace,busy:this.#active!==null};}
  async readiness(){return{...await this.status(),canExecute:true,reason:null};}
  lifecycle(){return{closed:this.closed};}
  async start({text,clientUserMessageId,expiresAt,taskId}){
    await this.status();need(!this.#active,'ACP_HOST_BUSY');need(Date.parse(expiresAt)>Date.now(),'ACP_INPUT_EXPIRED');
    const previous=this.#operations[clientUserMessageId];
    if(previous){need(previous.input===text,'ACP_OPERATION_CONFLICT');return{accepted:true,clientUserMessageId};}
    need(Object.keys(this.#operations).length<1000,'ACP_OPERATION_LIMIT');
    const op={id:clientUserMessageId,input:text,text:'',turnId:'acp-'+randomUUID(),status:'inProgress',sawTools:false,permissionCancelled:false};
    const prompt=[{type:'text',text}];
    if(this.#glasses){
      need(typeof taskId==='string'&&taskId,'ACP_TASK_ID_REQUIRED');op.taskId=taskId;
      const cli=prepareManagedCli({directory:this.#connectorDirectory,journal:this.#stateFile,sessionId:this.sessionId,workspace:this.workspace,op,taskId,expiresAt,...this.#glasses});
      op.cliContext=cli.file;
      this.#cliPump=setInterval(()=>{
        if(this.#cliBusy)return;this.#cliBusy=true;
        void drainManagedCli(cli.file).catch(()=>{this.#saveError=true;}).finally(()=>{this.#cliBusy=false;});
      },100);
      prompt.unshift({type:'text',text:cli.instruction});
    }
    this.#operations[op.id]=op;this.save();this.#active=op;
    // A durable intent precedes the wire write. A lost reply remains unknown,
    // including across restart; session/load never causes this input to replay.
    const finish=(status)=>{clearInterval(this.#cliPump);this.#cliPump=null;for(const q of this.#permissions.values())if(q.turnId===op.turnId)this.replyPermission(q.requestId,null);op.status=status;this.save();this.#active=null;};
    void this.request('session/prompt',{sessionId:this.sessionId,prompt},{prompt:true}).then(result=>{
      need(object(result)&&typeof result.stopReason==='string','ACP_PROMPT_RESULT_INVALID');
      if(result.stopReason==='cancelled')finish('interrupted');
      else finish(result.stopReason==='end_turn'&&!op.permissionCancelled?'completed':'failed');
    },()=>finish('unknown')).catch(()=>{this.#saveError=true;this.#active=null;});
    return{accepted:true,clientUserMessageId};
  }
  pendingPermissions(){return [...this.#permissions.values()].map(q=>({requestId:q.requestId,turnId:q.turnId,question:q.question,expires_at:q.expires_at}));}
  replyPermission(requestId,choice){
    const q=this.#permissions.get(requestId);if(!q)return false;
    need(choice===null||choice==='allow_once'||choice==='deny_once','ACP_PERMISSION_CHOICE_INVALID');
    need(this.#active?.turnId===q.turnId,'ACP_PERMISSION_STALE');clearTimeout(q.timer);this.#permissions.delete(requestId);
    this.#active.permissionReplies??={};this.#active.permissionReplies[requestId]=choice??'cancelled';this.save();
    if(choice!=='allow_once')this.#active.permissionCancelled=true;
    const optionId=choice==='allow_once'?q.allow:choice==='deny_once'?q.deny:null;
    this.send({jsonrpc:'2.0',id:q.wireId,result:{outcome:optionId?{outcome:'selected',optionId}:{outcome:'cancelled'}}});return true;
  }
  async inspectOperation(id){
    const op=this.#operations[id];if(!op)return{found:false};
    return{found:true,turnId:op.turnId,status:op.status,...(op.status==='completed'?{resultComplete:true,result:{type:'text',text:op.text}}:{})};
  }
  async interrupt(expectedTurnId){
    await this.status();need(this.#active?.turnId===expectedTurnId,'ACP_STOP_STALE');
    this.send({jsonrpc:'2.0',method:'session/cancel',params:{sessionId:this.sessionId}});
    return{expectedTurnId,requested:true};
  }
  async inspectStop(turnId){
    const op=Object.values(this.#operations).find(op=>op.turnId===turnId);
    return{conversationId:this.conversationId,turnId,terminal:op?.status==='interrupted',descendantsStopped:false};
  }
  close(){return this.#closing??=(async()=>{
    this.ready=false;clearInterval(this.#cliPump);this.#cliPump=null;
    for(const q of this.#permissions.values())clearTimeout(q.timer);this.#permissions.clear();
    if(this.#child.exitCode===null&&this.#child.signalCode===null&&this.#child.pid){
      // Only this connector's newly spawned process group is a cleanup target.
      const signal=kind=>{try{process.kill(process.platform==='win32'?this.#child.pid:-this.#child.pid,kind);}catch(error){if(error.code!=='ESRCH')throw error;}};
      signal('SIGTERM');let timer;
      await Promise.race([this.#exit,new Promise(resolve=>{timer=setTimeout(()=>{signal('SIGKILL');resolve();},2000);})]);clearTimeout(timer);
    }
    this.closed=true;
  })();}
}
