import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MaterialStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';
import {AgentBridge} from '../bridge.mjs';

// Only the runtime observations are synthetic. Every task/control/result and
// reconciliation request crosses real loopback HTTP and durable SQLite.
test('phone wins a multi-revision state race; pending and completed retries preserve exact control and result order',async t=>{
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-control-race-'))),now=Date.now();
  const store=new MaterialStore(path.join(directory,'queue.sqlite'),{clock:()=>now});
  const phone=store.mint({owner:'synthetic-owner',producer:'phone',scopes:['tasks:write','tasks:update','tasks:read','messages:receive']});
  const agent=store.mint({owner:'synthetic-owner',producer:'agent',scopes:['tasks:read','tasks:update','requests:write','messages:receive','messages:write','receipts:agent']});
  const server=await listen(store),base=`http://127.0.0.1:${server.address().port}/v1/`,identity=store.identity(agent.token);
  const credential=path.join(directory,'agent.json');fs.writeFileSync(credential,JSON.stringify(agent),{mode:0o600});
  const route={computer_id:'synthetic-pc',agent_id:'codex',project_id:'synthetic-project',session_id:randomUUID()};
  const execution={command_id:randomUUID(),turn_id:'native-owned-turn',phase:'running'},taskId='multi-revision-race';
  const config={schema_version:'1.0',base_url:base,allow_loopback_http:true,owner_id:identity.owner_id,producer_id:'agent',
    server_id:identity.server_id,computer_id:route.computer_id,agent_id:route.agent_id,credential_file:credential,state_file:path.join(directory,'bridge.json')};
  const envelope=(kind,body,producer)=>({schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind,producer_id:producer,
    created_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString(),body});
  const post=async(kind,body,principal=agent)=>{
    const response=await fetch(base+kind+'s',{method:'POST',headers:{Authorization:`Bearer ${principal.token}`,'Content-Type':'application/json'},
      body:JSON.stringify(envelope(kind,body,principal===phone?'phone':'agent'))});
    assert.equal(response.status,201,await response.clone().text());return response.json();
  };
  const getTask=async()=>{
    const response=await fetch(base+'tasks/'+taskId,{headers:{Authorization:`Bearer ${phone.token}`}});
    assert.equal(response.status,200);return response.json();
  };
  let bridge;
  t.after(async()=>{await bridge?.stop();await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const original={task_id:taskId,revision:1,route,state:'queued',command:'Original task remains unchanged',allow_create_session:false};
  await post('task',original,phone);
  await post('task',{...original,revision:2,state:'agent_received',execution:{...execution,turn_id:null,phase:'accepted'}});
  await post('task',{...original,revision:3,state:'running',execution});

  let deliveryId=null,eventsDelivered=false,control=null;
  const acknowledgements=[],attempts=[],rejectedEvents=[];
  const text='完整正文保留 Unicode🙂、换行\n以及控制字符\u0000。'.repeat(2000);
  const chunks=[text.slice(0,20000),text.slice(20000)];
  const adapter={name:'synthetic-state-observer',capabilities:{can_execute:true,async_events:true,task_session_control_v1:true},
    onItem:(_item,context)=>{deliveryId??=context.delivery_id;return[];},onAnswer:()=>[],
    pollEvents:()=>{
      if(eventsDelivered||!deliveryId)return[];eventsDelivered=true;
      return[
        {event_id:'runtime-result-pending',delivery_id:deliveryId,actions:[{action:'task_state',state:'running',execution:{...execution,phase:'result_pending'}}]},
        {event_id:'runtime-completed',delivery_id:deliveryId,actions:[
          ...chunks.map((part,index)=>({action:'message',channel:'result',message_id:`result-part-${index}`,text:part})),
          {action:'task_state',state:'completed',execution:{...execution,phase:'completed'}},
          {action:'receipt',stage:'task_completed',subject_kind:'task',subject_id:taskId,subject_revision:3}
        ]}
      ];
    },acknowledgeEvents:ids=>{acknowledgements.push(...ids);}
  };
  const fetchImpl=async(url,options)=>{
    const event=options.method==='POST'?JSON.parse(options.body):null;
    if(event?.kind==='task'&&event.body.execution?.phase==='result_pending'&&!control){
      // Both old state revisions have already been durably queued. The phone
      // takes revision 4 just before the first stale POST reaches the server.
      const pending=Object.values(bridge.state.outbox()).filter(e=>e.event.kind==='task').map(e=>e.event.body);
      assert.deepEqual(pending.map(e=>[e.revision,e.execution.phase]),[[4,'result_pending'],[5,'completed']]);
      const current=(await getTask()).body;
      control={control_id:randomUUID(),kind:'stop',expected_command_id:execution.command_id,expected_turn_id:execution.turn_id,
        expires_at:new Date(now+60000).toISOString()};
      await post('task',{...current,revision:4,state:'stop_requested',control},phone);
    }
    const response=await fetch(url,options);
    if(event){
      const value=await response.clone().json();attempts.push({kind:event.kind,phase:event.body.execution?.phase,revision:event.body.revision,status:response.status,code:value.error?.code});
      if(response.status===409)rejectedEvents.push(event);
    }
    return response;
  };
  bridge=new AgentBridge({config,adapter,clock:()=>now,fetchImpl});await bridge.start();
  await bridge.pollOnce();
  assert.equal(bridge.blocked,null);assert.equal((await getTask()).state,'stop_requested');
  assert.deepEqual(acknowledgements,['runtime-result-pending','runtime-completed']);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM queue_revisions WHERE kind='message'").get().n,0);

  // The next stale revision now has the correct numeric revision, so its
  // rejection is TASK_CONTROL_INVALID, not another REVISION_CONFLICT.
  await bridge.flush();
  assert.equal(bridge.blocked,null);assert.equal((await getTask()).state,'stop_requested');
  assert.equal((await getTask()).receipts.length,0);
  // Recovery keeps the newly rebased immutable event in its original place,
  // ahead of the completion receipt and after the already stored result parts.
  await bridge.stop();bridge=new AgentBridge({config,adapter,clock:()=>now,fetchImpl});await bridge.start();
  await bridge.flush();
  const final=await getTask();
  assert.equal(bridge.blocked,null);assert.equal(bridge.status().pending,0);assert.equal(final.state,'completed');
  assert.equal(final.revision,5);assert.deepEqual(final.body.control,control);assert.deepEqual(final.body.route,route);
  assert.equal(final.body.command,original.command);assert.deepEqual(final.body.execution,{...execution,phase:'completed'});
  assert.deepEqual(attempts.filter(a=>a.status===409).map(a=>a.code),['REVISION_CONFLICT','TASK_CONTROL_INVALID']);
  assert.equal(Object.keys(bridge.state.value.superseded_task_events).length,2);
  for(const event of rejectedEvents)assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events WHERE event_id=?').get(event.event_id).n,0);
  const rows=store.db.prepare("SELECT kind,state,seq,body FROM queue_revisions WHERE owner=? ORDER BY seq").all('synthetic-owner');
  const messages=rows.filter(row=>row.kind==='message');
  assert.equal(messages.map(row=>JSON.parse(row.body).text).join(''),text);
  const completed=rows.find(row=>row.kind==='task'&&row.state==='completed'),receipt=rows.find(row=>row.kind==='receipt');
  assert.ok(messages.at(-1).seq<completed.seq&&completed.seq<receipt.seq);
  assert.equal(JSON.parse(receipt.body).stage,'task_completed');
  const ceiling=store.queueCeiling('synthetic-owner');await bridge.pollOnce();await bridge.flush();
  assert.equal(store.queueCeiling('synthetic-owner'),ceiling);assert.equal(bridge.blocked,null);
});
