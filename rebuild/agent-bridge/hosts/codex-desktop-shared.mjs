import fs from 'node:fs';
import path from 'node:path';
import {atomic} from '../session-pairing.mjs';
import {privateRecord} from './resident-manager.mjs';
import {CodexDesktopSession} from './codex-desktop.mjs';
import {prepareManagedCli,drainManagedCli} from '../questions/managed-cli.mjs';

const need=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};

/** Desktop remains the sole model owner. This journal binds phone commands to
 * their original tasks; disconnect/restart reconciles IDs without replaying. */
export class CodexDesktopSharedHost {
  #session;#file;#operations={};#directory;#glasses;#pump;#pumping=false;#error=null;
  constructor(session,{stateFile,conversationId,workspace,connectorDirectory,glasses}){
    this.#session=session;this.#file=stateFile;this.#directory=connectorDirectory;this.#glasses=glasses;
    this.conversationId=conversationId;this.workspace=workspace;this.sessionId=session.conversationId;
    if(fs.existsSync(stateFile)){
      const state=privateRecord(stateFile,64*1024*1024);
      need(state.schema_version===1&&state.session_id===this.sessionId&&state.workspace===workspace&&state.operations&&!Array.isArray(state.operations)&&typeof state.operations==='object'&&Object.keys(state.operations).length<=1000,'DESKTOP_JOURNAL_INVALID');
      for(const [id,op] of Object.entries(state.operations))need(op?.id===id&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)&&op.turnId==='desktop-'+id&&
        typeof op.input==='string'&&typeof op.taskId==='string'&&op.cliContext===path.join(connectorDirectory,'cli-turns',op.turnId+'.json')&&
        ['inProgress','completed','failed','interrupted'].includes(op.status),'DESKTOP_JOURNAL_INVALID');
      this.#operations=state.operations;
    }
    this.#pump=setInterval(()=>{
      if(this.#pumping||this.#error)return;this.#pumping=true;
      void (async()=>{for(const op of Object.values(this.#operations))if(op.status==='inProgress'&&op.cliContext)await drainManagedCli(op.cliContext);})()
        .catch(error=>{this.#error=error.code??'DESKTOP_CLI_FAILED';}).finally(()=>{this.#pumping=false;});
    },100);
  }
  static async connect(options){
    need(path.isAbsolute(options.stateFile)&&path.isAbsolute(options.workspace)&&path.isAbsolute(options.connectorDirectory),'DESKTOP_CONFIG_INVALID');
    const session=await CodexDesktopSession.connect(options.sessionId,{sharedConversation:true,timeoutMs:15000});
    try{return new CodexDesktopSharedHost(session,options);}catch(error){session.close();throw error;}
  }
  get capabilities(){return this.#session.capabilities;}
  lifecycle(){return this.#error?{closed:true,reason:this.#error}:this.#session.lifecycle();}
  async status(){need(!this.#error,this.#error);const status=await this.#session.status();need(status.workspace===this.workspace,'DESKTOP_WORKSPACE_MISMATCH');return{...status,conversationId:this.conversationId};}
  async readiness(){return{...await this.status(),canExecute:true,reason:null};}
  async start({text,clientUserMessageId,taskId,expiresAt}){
    need(Date.parse(expiresAt)>Date.now(),'DESKTOP_INPUT_EXPIRED');await this.status();
    const previous=this.#operations[clientUserMessageId];
    if(previous){need(previous.input===text&&previous.taskId===taskId,'DESKTOP_OPERATION_CONFLICT');return{accepted:true,clientUserMessageId};}
    need(Object.keys(this.#operations).length<1000,'DESKTOP_OPERATION_LIMIT');
    const op={id:clientUserMessageId,input:text,taskId,turnId:'desktop-'+clientUserMessageId,status:'inProgress'};
    const cli=prepareManagedCli({directory:this.#directory,journal:this.#file,sessionId:this.sessionId,workspace:this.workspace,op,taskId,expiresAt,...this.#glasses,contextInWorkspace:true});
    op.cliContext=cli.file;this.#operations[op.id]=op;
    atomic(this.#file,{schema_version:1,session_id:this.sessionId,workspace:this.workspace,operations:this.#operations});
    // Application context is consumed by the model without becoming a visible
    // user chat bubble. Never combine the manual with the user's actual input.
    try{return await this.#session.start({text,clientUserMessageId,additionalContext:{'io-agent-current-task':{kind:'application',value:cli.briefInstruction}}});}
    catch(error){
      // A definite busy rejection wrote no input, so the ordinary queue may
      // retry later. A lost mutation reply keeps its durable intent instead.
      if(error.code==='CODEX_DESKTOP_BUSY'){delete this.#operations[op.id];atomic(this.#file,{schema_version:1,session_id:this.sessionId,workspace:this.workspace,operations:this.#operations});}
      throw error;
    }
  }
  async inspectOperation(id){
    const observed=await this.#session.inspectOperation(id),op=this.#operations[id];
    if(op&&observed.found&&['completed','failed','interrupted'].includes(observed.status)&&op.status!==observed.status){
      op.status=observed.status;
      atomic(this.#file,{schema_version:1,session_id:this.sessionId,workspace:this.workspace,operations:this.#operations});
      atomic(path.join(this.workspace,'.io-agent-cli',op.turnId,'closed.json'),{closed:true});
    }
    return observed;
  }
  interrupt(id){return this.#session.interrupt(id);}
  close(){clearInterval(this.#pump);this.#session.close();}
}
