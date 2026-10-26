// Five isolated processes, synthetic data only. The legacy phase is diagnostic:
// it proves why a real rollback must be blocked once extended tasks exist.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';import {parseArgs} from 'node:util';import assert from 'node:assert/strict';
const self=fileURLToPath(import.meta.url),repo=path.resolve(path.dirname(self),'../..');
const {values:a}=parseArgs({options:{'baseline-commit':{type:'string'},out:{type:'string'},phase:{type:'string'},work:{type:'string'}}});
const sha=v=>createHash('sha256').update(v).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p)),save=(p,v)=>fs.writeFileSync(p,JSON.stringify(v),{mode:0o600});
const python=code=>execFileSync('python3',['-B','-c',code],{cwd:repo,encoding:'utf8',timeout:30000,maxBuffer:1048576});
const profile=JSON.parse(python("import runpy,json;p=runpy.run_path('tools/phase1/package-session-release.py');print(json.dumps({k:p[k] for k in ['FILES','SOURCES','RUNTIME','SHARED','LOCAL','MARKER','ADDED','PHASES']},default=list))"));
const git=n=>execFileSync('git',['show',a['baseline-commit']+':'+n],{cwd:repo,maxBuffer:2097152});
const write=(p,data)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data,{mode:0o600});};
const hashSources=root=>Object.fromEntries(profile.FILES.map(n=>[n,fs.existsSync(path.join(root,n))?sha(fs.readFileSync(path.join(root,n))):null]));

if(!a.phase){
  assert(/^v22\.23\.2$/.test(process.version));assert(/^[a-f0-9]{40}$/.test(a['baseline-commit']??'')&&a.out&&!a.work);
  const work=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-session-release-')));fs.chmodSync(work,0o700);
  try{
    const baseline=path.join(work,'baseline'),candidate=path.join(work,'candidate');
    for(const n of profile.RUNTIME){if(!profile.ADDED.includes(n))write(path.join(baseline,n),git(n));write(path.join(candidate,n),fs.readFileSync(path.join(repo,n)));}
    const shared=Object.fromEntries(profile.SHARED.map(n=>[n,sha(git(n))]));
    for(const n of profile.SHARED){write(path.join(baseline,n),git(n));write(path.join(candidate,n),git(n));}
    const marker={schema:1,files:{}};
    for(let i=0;i<profile.SHARED.length;i++){const bytes=fs.readFileSync(path.join(repo,profile.SHARED[i]));write(path.join(candidate,profile.LOCAL[i]),bytes);marker.files[path.basename(profile.SHARED[i])]=sha(bytes);}
    // Match the packager's deterministic marker bytes exactly.
    const sorted=Object.fromEntries(Object.entries(marker.files).sort(([a],[b])=>a.localeCompare(b)));
    write(path.join(candidate,profile.MARKER),JSON.stringify({files:sorted,schema:1})+'\n');
    for(const root of [baseline,candidate])fs.symlinkSync(path.join(repo,'rebuild/material-server/node_modules'),path.join(root,'rebuild/material-server/node_modules'),'dir');
    write(path.join(work,'stable-expiry.mjs'),git('rebuild/material-server/audio-expiry.mjs'));
    const before={baseline:hashSources(baseline),candidate:hashSources(candidate)};
    const java=path.join(work,'java');fs.mkdirSync(java);
    for(const name of ['TaskWire','TaskMailbox','TaskConnection','WireJson','AtomicDocument'])write(path.join(java,name+'.java'),git('rebuild/android-app/src/com/turboio/addon/'+name+'.java'));
    write(path.join(java,'BoundedJson.java'),git('rebuild/android-app/upstream/android-addon/src/com/turboio/addon/BoundedJson.java'));
    write(path.join(java,'LegacyInboxProbe.java'),`package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.util.*;
public class LegacyInboxProbe {public static void main(String[] args)throws Exception{
 Map<String,Object> f=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get(args[0]))));int rejected=0;
 for(Object item:WireJson.list(f.get("heads")))try{TaskWire.object(item);throw new AssertionError("legacy accepted extended state");}catch(IllegalArgumentException expected){rejected++;}
 if(rejected!=4)throw new AssertionError("missing control state");
 TaskConnection c=TaskConnection.parse(WireJson.bytes(f.get("connection")),((Number)f.get("now")).longValue());
 try(TaskMailbox box=new TaskMailbox(new File(args[1]),c)){
  try{box.acceptPage(WireJson.map(f.get("page")),"");throw new AssertionError("legacy inbox unexpectedly advanced");}catch(IllegalArgumentException expected){}
  if(!box.cursor().isEmpty()||box.cached("request","legacy-question")!=null)throw new AssertionError("partial page committed");
 }System.out.println("{\\"legacy_heads_rejected\\":4,\\"legacy_inbox_blocked\\":true,\\"cursor_preserved\\":true}");
}}
`);
    execFileSync('javac',['--release','8','-encoding','UTF-8','-d',java,...fs.readdirSync(java).filter(n=>n.endsWith('.java')).map(n=>path.join(java,n))],{timeout:30000,stdio:['ignore','pipe','pipe']});
    const results=[];for(const phase of profile.PHASES){
      const result=JSON.parse(execFileSync(process.execPath,[self,'--phase',phase,'--work',work,'--baseline-commit',a['baseline-commit']],{encoding:'utf8',timeout:45000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']}));
      assert.equal(result.phase,phase);assert.equal(result.passed,true);results.push(result);
    }
    assert.deepEqual({baseline:hashSources(baseline),candidate:hashSources(candidate)},before);
    fs.rmSync(work,{recursive:true});
    const result={schema:1,at:new Date().toISOString(),node:process.version,baseline_commit:a['baseline-commit'],passed:true,production_changed:false,
      rehearsal_sha256:sha(fs.readFileSync(self)),sources:before,shared_contract_sha256:shared,phases:results,temporary_data_removed:true,
      legacy_rollback:'Blocked after any extended task revision; diagnostic old-source phase is not approval for production rollback.'};
    save(path.resolve(a.out),result);console.log(JSON.stringify(result));
  }finally{fs.rmSync(work,{recursive:true,force:true});}
}else{
  assert(profile.PHASES.includes(a.phase)&&a.work&&!a.out);
  const work=fs.realpathSync(a.work);assert(path.dirname(work)===fs.realpathSync(os.tmpdir())&&path.basename(work).startsWith('io-session-release-'));
  const root=path.join(work,['seed','rollback','expiry'].includes(a.phase)?'baseline':'candidate');
  const {MaterialStore}=await import(pathToFileURL(path.join(root,'rebuild/material-server/store.mjs'))),{listen}=await import(pathToFileURL(path.join(root,'rebuild/material-server/http.mjs')));
  const fixture=path.join(work,'fixture.json'),file=path.join(work,'synthetic.sqlite');let f=a.phase==='seed'?null:read(fixture),now=f?.now??Date.now();
  const store=new MaterialStore(file,{clock:()=>now});let server;const checks=[];
  const envelope=(body,identity,kind='task')=>({schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind,
    producer_id:identity.producer_id,created_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString(),body});
  const controlSnapshot=()=>sha(JSON.stringify({tables:['agent_computer_bindings','agent_sessions','agent_defaults','agent_session_requests'].map(n=>store.db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()),
    tasks:store.db.prepare("SELECT * FROM queue_revisions WHERE kind='task' AND object_id LIKE 'controlled-%' ORDER BY seq").all()}));
  const guard=()=>python("import runpy;p=runpy.run_path('tools/phase1/deploy-session-release.py');p['rollback_guard']("+JSON.stringify(file)+")");
  try{
    if(a.phase==='seed'){
      const agent=store.devices.enroll({owner:'synthetic-session-release',role:'agent',label:'Synthetic Mac'}),pair=store.devices.createPairing(agent.token,{role:'phone',label:'Synthetic phone'}),phone=store.devices.pair({code:pair.code});
      const material=store.mint({owner:agent.owner_id,producer:'synthetic-material',scopes:['materials:write','materials:read','audio:write','audio:read']});material.producer_id='synthetic-material';
      f={now,agent,phone,material,route:{computer_id:'synthetic-mac',agent_id:'codex',project_id:'synthetic-project',session_id:randomUUID()},inode:fs.statSync(file).ino};
      const original=structuredClone(read(path.join(repo,'docs/contracts/material-v1.2.json')).events.find(e=>e.body.revision===1&&e.body.operation==='upsert'));
      Object.assign(original,envelope(original.body,material,'material.revision'),{schema_version:'1.2'});store.submit(material.token,original);f.original=original;
      const bytes=Buffer.from('synthetic existing audio, never a user recording'),manifest={material_id:original.body.material_id,material_revision:1,kind:'raw',media_type:'application/vnd.turboio.lifelog-archive',bytes:bytes.length,sha256:sha(bytes),capture:{first_received_at:new Date(now-1000).toISOString(),last_received_at:new Date(now).toISOString(),recording_complete:false}};
      const upload=store.audio.begin(material.token,manifest);store.audio.put(material.token,upload.object_id,0,{data:bytes.toString('base64'),sha256:sha(bytes)});f.audio=store.audio.finalize(material.token,upload.object_id);f.audioHash=sha(bytes);
      const task={task_id:'legacy-task',revision:1,route:f.route,state:'queued',command:'Synthetic existing question',allow_create_session:false};store.queueSubmit(phone.token,envelope(task,phone),'task');
      const question=structuredClone(read(path.join(repo,'docs/contracts/normal.json')).events.find(e=>e.kind==='request').body);Object.assign(question,{request_id:'legacy-question',task_id:task.task_id,route:f.route});store.queueSubmit(agent.token,envelope(question,agent,'request'),'request');
      guard();save(fixture,f);checks.push('Existing audio, text, pairing, legacy question and server identity seeded; legacy rollback guard passes');
    }else{
      assert.equal(fs.statSync(file).ino,f.inode);assert.equal(store.identity(f.phone.token).server_id,f.phone.server_id);
      assert.equal(sha(Buffer.from(store.audio.content(f.material.token,f.audio.object_id,0).data,'base64')),f.audioHash);
      assert.equal(store.audio.get(f.material.token,f.audio.object_id).expires_at,f.audio.expires_at);
      server=await listen(store);const url=`http://127.0.0.1:${server.address().port}/v1/`;
      const get=async suffix=>{const r=await fetch(url+suffix,{headers:{Authorization:'Bearer '+f.phone.token}});assert.equal(r.status,200);return r.json();};
      if(a.phase==='upgrade'){
        assert(store.identity(f.phone.token).capabilities.includes('agent_session_directory_v1'));
        const observation={ready:true,busy:false,can_execute:true,exact_turn_interrupt:true,descendants_proof:false,atomic_queue_append:true,native_queue_expiry:false,reason:null};
        f.lease=store.agentSessions.publish(f.agent.token,{action:'acquire',request_id:randomUUID(),instance_id:randomUUID(),route:f.route,expected_generation:0,host_kind:'codex',workspace:'/synthetic/project',label:'Synthetic session',observation}).session;
        store.agentSessions.setDefault(f.phone.token,{request_id:randomUUID(),expected_revision:0,route:f.route});guard();
        for(const state of ['stop_requested','stop_unconfirmed','stopped','resume_requested']){
          let body={task_id:'controlled-'+state,revision:1,route:f.route,state:'queued',command:'Synthetic bounded task',allow_create_session:false};
          const put=(patch,who=f.agent)=>{body={...body,revision:body.revision+1,...patch};store.queueSubmit(who.token,envelope(body,who),'task');};
          store.queueSubmit(f.phone.token,envelope(body,f.phone),'task');const ex={command_id:randomUUID(),turn_id:null,phase:'accepted'};
          put({state:'agent_received',execution:ex});ex.turn_id='synthetic-turn-'+state;ex.phase='running';put({state:'running',execution:{...ex}});
          const control={control_id:randomUUID(),kind:'stop',expected_command_id:ex.command_id,expected_turn_id:ex.turn_id,expires_at:new Date(now+60000).toISOString()};
          put({state:'stop_requested',control},f.phone);
          if(state!=='stop_requested')put({state:'stop_unconfirmed',execution:{...ex,phase:'stop_unconfirmed'}});
          if(['stopped','resume_requested'].includes(state))put({state:'stopped',execution:{...ex,phase:'stopped'}});
          if(state==='resume_requested')put({state,control:{...control,control_id:randomUUID(),kind:'resume',text:'Synthetic continuation'}},f.phone);
        }
        assert.throws(guard,e=>String(e.stderr).includes('SESSION_DATA_PREVENTS_LEGACY_ROLLBACK'));
        f.controlSnapshot=controlSnapshot();save(fixture,f);checks.push('New directory/default survives normal reads; all four control states and immutable history persisted','Legacy rollback is now blocked, including completed-history candidates');
      }else if(a.phase==='rollback'){
        assert(!store.agentSessions);assert(!store.identity(f.phone.token).capabilities.includes('task_session_control_v1'));
        const heads=[];for(const state of ['stop_requested','stop_unconfirmed','stopped','resume_requested']){const value=await get('tasks/controlled-'+state);assert.equal(value.state,state);heads.push(value);}
        const page=await get('inbox?limit=20');assert(page.items.some(x=>x.object_id==='legacy-question'));
        const connection={format:'turboio-task-connection/1',base_url:'https://synthetic.invalid/v1',owner_id:f.phone.owner_id,producer_id:f.phone.producer_id,server_id:f.phone.server_id,token:f.phone.token,token_id:f.phone.token_id,expires_at:f.phone.expires_at,...f.route};
        save(path.join(work,'legacy-probe.json'),{heads,page,connection,now});
        const oldPhone=JSON.parse(execFileSync('java',['-cp',path.join(work,'java'),'com.turboio.addon.LegacyInboxProbe',path.join(work,'legacy-probe.json'),path.join(work,'legacy-mailbox')],{encoding:'utf8',timeout:15000}));assert.equal(oldPhone.legacy_inbox_blocked,true);
        const {AgentBridge}=await import(pathToFileURL(path.join(repo,'rebuild/agent-bridge/bridge.mjs')));save(path.join(work,'agent.json'),f.agent);
        const bridge=new AgentBridge({config:{schema_version:'1.0',base_url:url,allow_loopback_http:true,owner_id:f.agent.owner_id,producer_id:f.agent.producer_id,server_id:f.agent.server_id,credential_file:path.join(work,'agent.json'),computer_id:f.route.computer_id,agent_id:f.route.agent_id,state_file:path.join(work,'bridge.json')},adapter:{capabilities:{can_execute:false,task_session_control_v1:true}},clock:()=>now});
        await assert.rejects(bridge.start(),{code:'SERVER_SESSION_CONTROL_UNSUPPORTED'});await bridge.stop();
        const next=structuredClone(f.original);Object.assign(next,envelope(next.body,f.material,'material.revision'),{schema_version:'1.2'});Object.assign(next.body,{base_revision:1,revision:2,text_revision:2});next.body.full_text.text+=' synthetic old-service revision';store.submit(f.material.token,next);f.replacement=next;
        assert.equal(controlSnapshot(),f.controlSnapshot);assert.throws(guard,e=>String(e.stderr).includes('SESSION_DATA_PREVENTS_LEGACY_ROLLBACK'));save(fixture,f);
        checks.push('Diagnostic legacy runtime starts and GET reads four extended states without data deletion','Exact historical Java parser rejects four heads; one extended revision blocks a whole inbox page and preserves cursor','New native bridge refuses old server capability; old service still writes unrelated text; rollback guard forbids this combination');
      }else if(a.phase==='expiry'){
        const result=JSON.parse(execFileSync(process.execPath,[path.join(work,'stable-expiry.mjs'),'--db',file+'.audio.sqlite','--server-id',f.phone.server_id],{encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']}));
        assert.equal(result.objects,0);assert.equal(controlSnapshot(),f.controlSnapshot);checks.push('Original independent cleaner still works during diagnostic legacy phase; future audio expiry is unchanged');
      }else{
        assert.equal(controlSnapshot(),f.controlSnapshot);assert.deepEqual(store.get(f.material.token,f.original.body.material_id).body,f.replacement.body);
        const directory=await get('agent-sessions');assert.deepEqual(directory.default.route,f.route);assert.equal(directory.sessions[0].generation,f.lease.generation);
        assert.equal((await get('tasks/controlled-stopped')).state,'stopped');assert.throws(guard,e=>String(e.stderr).includes('SESSION_DATA_PREVENTS_LEGACY_ROLLBACK'));
        checks.push('Forward restore preserves old-service text revision, complete control history, shared default and route generation','No database restored; legacy rollback remains blocked after re-upgrade');
      }
    }
    console.log(JSON.stringify({phase:a.phase,passed:true,checks}));
  }finally{if(server)await new Promise(r=>server.close(r));store.close();}
}
