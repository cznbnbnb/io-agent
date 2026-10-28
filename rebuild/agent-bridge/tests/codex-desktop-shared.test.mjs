import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomic} from '../session-pairing.mjs';
import {CodexDesktopSharedHost} from '../hosts/codex-desktop-shared.mjs';
import {managedCli} from '../questions/managed-cli.mjs';
import {connectorConfig} from '../connector.mjs';

test('desktop shared host keeps immutable phone-task context hidden and never replays after restart',async t=>{
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-desktop-shared-')));fs.chmodSync(directory,0o700);
  const native=randomUUID(),route=randomUUID(),stateFile=path.join(directory,'desktop.json'),calls=[];
  let busy=false,observed={found:false},closed=0;
  const session={conversationId:native,capabilities:{shared_conversation_input:true},lifecycle:()=>({closed:false}),
    status:async()=>({workspace:directory,busy,conversationId:native}),
    start:async args=>{calls.push(args);if(busy)throw Object.assign(Error('busy'),{code:'CODEX_DESKTOP_BUSY'});return{accepted:true,clientUserMessageId:args.clientUserMessageId};},
    inspectOperation:async()=>observed,close:()=>closed++};
  const options={stateFile,conversationId:route,workspace:directory,connectorDirectory:directory,glasses:{bridge:{},route:{computer_id:'test',agent_id:'codex',project_id:'test',session_id:route}}};
  let host=new CodexDesktopSharedHost(session,options);t.after(()=>{host.close();fs.rmSync(directory,{recursive:true,force:true});});
  assert.equal((await host.status()).conversationId,route);
  const input={text:'phone message only',taskId:'synthetic-phone-task',clientUserMessageId:randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString()};
  await host.start(input);
  assert.equal(calls[0].text,input.text);assert(!calls[0].text.includes('IO_AGENT'));
  const context=calls[0].additionalContext['io-agent-current-task'];assert.equal(context.kind,'application');assert(context.value.includes('IO_AGENT_CLI_ARGS='));assert(context.value.length<1500);
  const j=JSON.parse(fs.readFileSync(stateFile)),op=j.operations[input.clientUserMessageId],file=JSON.parse(fs.readFileSync(op.cliContext));
  assert.equal(j.session_id,native);assert.equal(file.task_id,input.taskId);assert.equal(file.session_id,native);assert.equal(file.route.session_id,route);
  const publicFile=path.join(directory,'.io-agent-cli',op.turnId,'context.json'),bootstrap=JSON.parse(fs.readFileSync(publicFile));
  assert.equal(bootstrap.schema_version,2);assert.equal(bootstrap.bridge,undefined);assert.equal(bootstrap.journal,undefined);assert(context.value.includes(publicFile));
  host.close();host=new CodexDesktopSharedHost(session,options);await host.start(input);assert.equal(calls.length,1);
  observed={found:true,turnId:'actual-native-turn',status:'completed',resultComplete:true,result:{type:'text',text:'final'}};
  assert.deepEqual(await host.inspectOperation(input.clientUserMessageId),observed);
  await assert.rejects(managedCli('help',{},op.cliContext,{env:{CODEX_THREAD_ID:native}}),{code:'MANAGED_CLI_TURN_CLOSED'});
  await assert.rejects(managedCli('help',{},publicFile,{env:{CODEX_THREAD_ID:native},viaHost:true}),{code:'MANAGED_CLI_TURN_CLOSED'});
  assert.equal(JSON.parse(fs.readFileSync(stateFile)).operations[input.clientUserMessageId].status,'completed');
  assert.equal(closed,1);
});

test('explicit desktop mode retains original native session and route without spawning ACP',()=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-desktop-config-')));fs.chmodSync(dir,0o700);
  try{
    const route=randomUUID(),native=randomUUID();
    fs.writeFileSync(path.join(dir,'connector.json'),JSON.stringify({schema_version:1,managed:true,runtime:'codex',label:'Synthetic',workspace:dir,command:[process.execPath],route_session_id:route,control_mode:'desktop'}),{mode:0o600});
    fs.writeFileSync(path.join(dir,'acp.json'),JSON.stringify({session_id:native}),{mode:0o600});
    const deviceFile=path.join(dir,'device.json');fs.writeFileSync(deviceFile,JSON.stringify({role:'agent',computer_id:'fixture-computer',base_url:'http://127.0.0.1/v1/',owner_id:'fixture-owner',producer_id:'fixture-agent',server_id:'fixture-server'}),{mode:0o600});
    const binding=connectorConfig(dir,{deviceFile}).native_runtime.sessions[0];
    assert.equal(binding.desktop.session_id,native);assert.equal(binding.route.session_id,route);assert.equal(binding.acp,undefined);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('workspace client communicates without permission to read any host journal or credential',async t=>{
  const workspace=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-public-mailbox-'))),turn='desktop-'+randomUUID(),mailbox=path.join(workspace,'.io-agent-cli',turn),file=path.join(mailbox,'context.json');
  atomic(file,{schema_version:2,session_id:randomUUID(),workspace,turn_id:turn,expires_at:new Date(Date.now()+60000).toISOString(),mailbox});
  const script=fileURLToPath(new URL('../questions/managed-cli.mjs',import.meta.url)),root=fileURLToPath(new URL('../',import.meta.url));
  const env={...process.env};delete env.CODEX_THREAD_ID;delete env.CLAUDE_CODE_SESSION_ID;delete env.CLAUDE_SESSION_ID;
  const child=spawn(process.execPath,['--permission','--allow-fs-read='+root,'--allow-fs-read='+mailbox,'--allow-fs-write='+mailbox,script,'--context',file,'help'],{env,stdio:['pipe','pipe','pipe']});
  let output='',error='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v);child.stdin.end('{}');
  const pump=setInterval(()=>{for(const name of fs.readdirSync(mailbox).filter(n=>n.endsWith('.request.json'))){const request=JSON.parse(fs.readFileSync(path.join(mailbox,name)));assert.deepEqual(request,{action:'help',input:{}});atomic(path.join(mailbox,name.replace('.request.json','.response.json')),{value:{commands:['notify','ask','wait','status','daily']}});fs.unlinkSync(path.join(mailbox,name));}},10);
  const timer=setTimeout(()=>child.kill(),3000);
  t.after(()=>{clearInterval(pump);clearTimeout(timer);child.kill();fs.rmSync(workspace,{recursive:true,force:true});});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert.equal(code,0,error);assert.deepEqual(JSON.parse(output),{commands:['notify','ask','wait','status','daily']});
});
