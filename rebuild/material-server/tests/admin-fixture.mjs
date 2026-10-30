import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {MaterialStore} from '../store.mjs';
import {TrafficLedger} from '../traffic.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/normal.json',import.meta.url)));
export async function adminFixture({taskCount=4}={}){
 let now=Date.now();const store=new MaterialStore(':memory:',{clock:()=>now}),owner='caller601-console-codex';
 const agent=store.devices.enroll({owner,role:'agent',label:'测试 Mac mini'}),phone=store.devices.enroll({owner,role:'phone',label:'测试主手机'}),second=store.devices.enroll({owner,role:'phone',label:'测试备用手机'}),foreign=store.devices.enroll({owner:'caller602-foreign-codex',role:'agent',label:'FOREIGN PRIVATE'});
 const account='a'.repeat(64);store.phones.update(phone.token,{account_binding:account});store.phones.update(second.token,{account_binding:account});
 const routes=[{computer_id:'qa-mac',agent_id:'codex',project_id:'qa-glasses',session_id:randomUUID()},{computer_id:'qa-mac',agent_id:'claude-code',project_id:'qa-daily',session_id:randomUUID()}];
 const observation={ready:true,busy:false,can_execute:true,exact_turn_interrupt:true,descendants_proof:false,atomic_queue_append:true,native_queue_expiry:false,reason:null};
 for(const [i,route] of routes.entries())store.agentSessions.publish(agent.token,{action:'acquire',request_id:randomUUID(),instance_id:randomUUID(),route,expected_generation:0,host_kind:i?'claude':'codex',workspace:i?'/work/日常总结':'/work/眼镜项目',label:i?'日常回顾':'项目推进',observation});
 store.agentSessions.setDefault(agent.token,{request_id:randomUUID(),expected_revision:0,route:routes[0]});
 const submit=(kind,body,identity)=>store.queueSubmit(identity.token,{schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind,producer_id:identity.producer_id,created_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString(),body},kind);
 const addTask=(id,command,completed=false,index=0)=>{const body={task_id:id,revision:1,route:routes[index],state:'queued',command,allow_create_session:false};submit('task',body,phone);if(completed){submit('task',{...body,revision:2,state:'agent_received'},agent);submit('task',{...body,revision:3,state:'completed'},agent);}return body;};
 for(let i=0;i<taskCount;i++)addTask('qa-task-'+i,['检查眼镜问答链路','整理本周项目讨论','准备明日会议提纲','总结工作日常'][i%4],i>0,i%2);
 const request={...structuredClone(fixture.events.find(e=>e.kind==='request').body),request_id:'qa-question',task_id:'qa-task-0',route:routes[0],question:'下一步优先处理哪一项？',options:[{option_id:'one',label:'先处理界面'},{option_id:'two',label:'先处理同步'}]};submit('request',request,agent);
 const writer=store.mint({owner,producer:'qa-writer',scopes:['materials:write']});
 const daily=(date,id='daily-'+date,text='## 今日概况\n完成项目讨论与交互方案核对。\n\n## 待跟进\n- 确认明日会议资料\n- 复核工作区状态')=>{const start=Date.parse(date+'T00:00:00Z'),body={material_id:id,revision:1,base_revision:0,operation:'upsert',source:'agent_analysis',started_at:new Date(start).toISOString(),ended_at:new Date(start+86400000).toISOString(),completeness:'complete',text_revision:1,utterances:[],speakers:[],audio:{state:'not_retained',sha256:null,object_id:null},full_text:{format:'markdown',text:'# '+date+' 每日 AI 总结\n\n'+text,origin:'legacy'},processing:{transcription_state:'unknown',covered_ms:null,source_ms:null,speaker:'unavailable',boundary:'unknown',recognition_channel:'unknown',user_edited:false}};
 store.submit(writer.token,{schema_version:'1.2',kind:'material.revision',event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'qa-writer',created_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString(),body});return body;};
 daily('2026-10-29');daily('2026-10-28');daily('2026-10-27');daily('2026-10-26','legacy-transcript','This historical entry must not be in the summary console.');
 const traffic=new TrafficLedger(':memory:',store.devices.serverId(),{clock:()=>now});const start=now;
 for(let i=0;i<180;i++){now=start-3600000+i*20000;traffic.record({owner,producer:i%4?agent.producer_id:phone.producer_id,route:i%3?'inbox':'identity',method:'GET',status:i===100?503:200,request_bytes:0,response_bytes:402,duration_ms:3});}now=start;
 await store.admin.enroll({username:'qa.admin',owner,password:'synthetic-initial-password'});const first=await store.admin.login({username:'qa.admin',password:'synthetic-initial-password'}),login=await store.admin.change(first.token,{current_password:'synthetic-initial-password',new_password:'synthetic-personal-password'});
 return {store,traffic,owner,agent,phone,second,foreign,routes,login,submit,addTask,daily,advance:ms=>{now+=ms;},close:()=>{traffic.close();store.close();}};
}
