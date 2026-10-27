// Independent synthetic ACP peer. No model, network, user data or approvals.
import fs from 'node:fs';import readline from 'node:readline';import {randomUUID} from 'node:crypto';
const ledger='fixture-native.json';let session=null,active=null;
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
const save=value=>fs.writeFileSync(ledger,JSON.stringify(value));
const state=()=>fs.existsSync(ledger)?JSON.parse(fs.readFileSync(ledger)):{session:'fixture-'+randomUUID(),prompts:[],context:[]};
const update=text=>send({method:'session/update',params:{sessionId:session,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
for await(const line of readline.createInterface({input:process.stdin})){
 const m=JSON.parse(line);
 if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
 else if(m.method==='session/new'){const s=state();session=s.session;save(s);send({id:m.id,result:{sessionId:session}});}
 else if(m.method==='session/load'){
  const s=state();if(m.params.sessionId!==s.session)send({id:m.id,error:{code:-32002,message:'Unknown session'}});
  else{session=s.session;update('history must not become a new result');send({id:m.id,result:{}});}
 }else if(m.method==='session/prompt'){
  const text=m.params.prompt[0].text,s=state();s.prompts.push(text);save(s);active=m;
  if(text==='wait')continue;
  if(text==='long'){update('中'.repeat(40000));send({id:m.id,result:{stopReason:'end_turn'}});active=null;continue;}
  if(text==='disconnect')process.exit(0);
  if(text==='foreign'){send({method:'session/update',params:{sessionId:'foreign',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'foreign result'}}}});continue;}
  if(text==='permission'){send({id:'permission-1',method:'session/request_permission',params:{sessionId:session,toolCall:{toolCallId:'tool-1',title:'Synthetic write'},options:[{optionId:'yes',kind:'allow_once',name:'Allow'}]}});continue;}
  s.context.push(text);save(s);update('answer:');update(s.context.join('|'));send({id:m.id,result:{stopReason:'end_turn'}});active=null;
 }else if(m.method==='session/cancel'&&active){send({id:active.id,result:{stopReason:'cancelled'}});active=null;}
 else if(m.id==='permission-1'){
  const s=state();s.permission=m.result;save(s);send({id:active.id,result:{stopReason:'end_turn'}});active=null;
 }
}
