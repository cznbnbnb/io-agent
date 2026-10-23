import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {privatePath} from '../private-path.mjs';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repository=path.resolve(source,'../../..');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function temporary(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-caller-paths-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function unsafe(action,code='CALLER_ACTIVE_CONTEXT_INVALID'){assert.throws(action,error=>error.code===code);}

test('only the configured private root may be a link; descendants and escapes remain rejected',t=>{
 const root=temporary(t),shared=path.join(root,'shared'),logical=path.join(root,'private');fs.mkdirSync(shared);fs.symlinkSync(shared,logical,'dir');
 const run=path.join(shared,'cloud-caller600-offline-codex');fs.mkdirSync(run);fs.writeFileSync(path.join(run,'agent.json'),'{}');
 assert.equal(privatePath(logical,path.join(logical,path.basename(run)),{directory:true}),run);
 assert.equal(privatePath(logical,path.join(logical,path.basename(run),'agent.json')),path.join(run,'agent.json'));
 assert.equal(privatePath(logical,path.join(run,'agent.json')),path.join(run,'agent.json'));
 assert.equal(privatePath(shared,path.join(run,'agent.json')),path.join(run,'agent.json'));
 assert.equal(privatePath(logical,path.join(logical,'new','registrations','profile'),{directory:true,allowMissing:true}),path.join(shared,'new','registrations','profile'));
 for(const candidate of [path.join(root,'outside'),shared+'-other/file',path.join(logical,'..','outside')])unsafe(()=>privatePath(logical,candidate,{allowMissing:true}));
 unsafe(()=>privatePath(logical,logical+'/cloud-caller600-offline-codex/../other',{allowMissing:true}));
 fs.symlinkSync(run,path.join(shared,'linked-run'),'dir');unsafe(()=>privatePath(logical,path.join(logical,'linked-run','agent.json')));
 fs.symlinkSync(path.join(run,'agent.json'),path.join(run,'alias.json'));unsafe(()=>privatePath(logical,path.join(run,'alias.json')));
 fs.symlinkSync(path.join(root,'absent'),path.join(run,'dangling.json'));unsafe(()=>privatePath(logical,path.join(run,'dangling.json'),{allowMissing:true}));
 fs.linkSync(path.join(run,'agent.json'),path.join(run,'hardlink.json'));unsafe(()=>privatePath(logical,path.join(run,'hardlink.json')));fs.unlinkSync(path.join(run,'hardlink.json'));
 unsafe(()=>privatePath(logical,path.join(run,'agent.json','child'),{allowMissing:true}));
 unsafe(()=>privatePath(logical,path.join(run,'agent.json'),{directory:true}));
 unsafe(()=>privatePath(logical,run));
});

// All fixture files live under tmp. No credentials are issued, sockets opened,
// live registration adopted, or files written to the repository's shared root.
test('real CLI reads a linked-root registration offline and rejects nested links, foreign CWD and session',async t=>{
 const probe=spawnSync(process.env.IO_AGENT_TEST_PYTHON??'python',['-I','-S','-B','-c','import sys;assert sys.version_info >= (3,10);print(sys.executable)'],{encoding:'utf8',timeout:5000});
 assert.equal(probe.status,0,'Set IO_AGENT_TEST_PYTHON to an explicit Python >= 3.10 interpreter');const python=probe.stdout.trim();
 const root=temporary(t),workspace=path.join(root,'worktree'),bridge=path.join(workspace,'rebuild/agent-bridge'),questions=path.join(bridge,'questions'),shared=path.join(root,'shared-private'),logical=path.join(bridge,'private');
 fs.mkdirSync(questions,{recursive:true});fs.mkdirSync(shared);fs.symlinkSync(shared,logical,'dir');
 for(const name of ['cli.mjs','private-path.mjs','adapter.py','context.py','tool.py'])fs.copyFileSync(path.join(source,name),path.join(questions,name));
 for(const name of ['bridge.mjs','client.mjs','adapter-host.mjs','state.mjs','runtime-events.mjs','run-lock.mjs'])fs.copyFileSync(path.join(source,'..',name),path.join(bridge,name));
 const hermes=path.join(bridge,'hermes');fs.mkdirSync(hermes);for(const name of fs.readdirSync(path.join(source,'../hermes')))if(name.endsWith('.py'))fs.copyFileSync(path.join(source,'../hermes',name),path.join(hermes,name));
 const session='offline-current-thread',baseName='codex-'+sha(JSON.stringify([workspace.toLowerCase(),session])).slice(0,24),base=path.join(shared,baseName),profile='a'.repeat(64),directory=path.join(base,'registrations',profile),logicalDirectory=path.join(logical,baseName,'registrations',profile);fs.mkdirSync(directory,{recursive:true});
 const config={schema:1,runtime:'codex',caller:{session_id:session,cwd:workspace},journal:path.join(logicalDirectory,'journal.sqlite'),binding:{server_id:'server-test',owner_id:'owner-test',producer_id:'pc-test',computer_id:'pc-test',agent_id:'codex-test'},route:{computer_id:'pc-test',agent_id:'codex-test',project_id:'project-test',session_id:session},task_id:'original-task',operation_id:'original-operation'};
 const contextFile=path.join(directory,'context.json');fs.writeFileSync(contextFile,JSON.stringify(config));fs.writeFileSync(path.join(directory,'host.json'),JSON.stringify({python,bridge:{}}));fs.writeFileSync(path.join(base,'active.json'),JSON.stringify({schema:1,profile}));
 const env={...process.env,CODEX_THREAD_ID:session,CLAUDE_CODE_SESSION_ID:'',IO_AGENT_CALLER_RUNTIME:'',IO_AGENT_CALLER_SESSION:''};
 const seed=`import asyncio,json,sys
from datetime import datetime,timedelta,timezone
sys.path.insert(0,sys.argv[1])
from context import load_context
from adapter import ExistingCaller
from tool import execute
c,j=load_context(sys.argv[2])
deadline=(datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat(timespec='milliseconds').replace('+00:00','Z')
source=dict(kind='task',object_id=c['task_id'],revision=1,command_expires_at=deadline,body=dict(task_id=c['task_id'],revision=1,route=c['route'],state='queued',command='Continue the already-running registered Codex task.',allow_create_session=False))
ExistingCaller(c,j).on_item(source,'item:task:'+c['task_id']+':1')
j.close()
print(json.dumps(asyncio.run(execute('ask',dict(question_key='offline',question='Offline path fixture?',mode='free_text',options=[],expires_at=deadline),sys.argv[2]))))`;
 const seeded=spawnSync(python,['-I','-S','-B','-c',seed,questions,path.join(logicalDirectory,'context.json')],{cwd:workspace,env,encoding:'utf8',timeout:10000});assert.equal(seeded.status,0,seeded.stderr);const request=JSON.parse(seeded.stdout);
 function cli(cwd=workspace,extraEnv={}){const result=spawnSync(process.execPath,[path.join(questions,'cli.mjs'),'status'],{cwd,env:{...env,...extraEnv},input:JSON.stringify({request_id:request.request_id}),encoding:'utf8',timeout:10000});return{...result,value:JSON.parse(result.stdout)};}
 const journal=path.join(directory,'journal.sqlite'),before=fs.readFileSync(journal),good=cli();assert.equal(good.status,0,good.stdout);assert.equal(good.value.state,'pending');assert.equal(good.value.caller_verified,true);assert.equal(good.value.network_checked,false);assert.deepEqual(fs.readFileSync(journal),before);
 assert.equal(cli(root).value.error,'CALLER_PROJECT_MISMATCH');
 assert.equal(cli(workspace,{CODEX_THREAD_ID:'other-thread'}).value.error,'CALLER_ACTIVE_CONTEXT_INVALID');
 fs.writeFileSync(contextFile,JSON.stringify({...config,caller:{...config.caller,session_id:'other-thread'}}));assert.equal(cli().value.error,'CALLER_SESSION_MISMATCH');fs.writeFileSync(contextFile,JSON.stringify(config));
 fs.writeFileSync(contextFile,JSON.stringify({...config,journal:path.join(root,'elsewhere.sqlite')}));assert.equal(cli().value.error,'CALLER_ACTIVE_CONTEXT_INVALID');fs.writeFileSync(contextFile,JSON.stringify(config));
 for(const entry of [base,path.join(base,'registrations'),directory,path.join(base,'active.json'),path.join(directory,'host.json'),contextFile,journal]){
  const saved=entry+'.saved';fs.renameSync(entry,saved);fs.symlinkSync(saved,entry,fs.statSync(saved).isDirectory()?'dir':'file');
  try{assert.equal(cli().value.error,'CALLER_ACTIVE_CONTEXT_INVALID',entry);}finally{fs.unlinkSync(entry);fs.renameSync(saved,entry);}
 }
 assert.equal(cli().status,0);assert.deepEqual(fs.readFileSync(journal),before);

 // The real preparation entry reaches expiry validation through both root
 // spellings; intentionally expired, token-free fixtures stop before identity I/O.
 const tools=path.join(workspace,'tools/android');fs.mkdirSync(tools,{recursive:true});fs.copyFileSync(path.join(repository,'tools/android/prepare-current-caller.mjs'),path.join(tools,'prepare-current-caller.mjs'));
 const runId='caller600-offline-codex',run=path.join(shared,'cloud-'+runId);fs.mkdirSync(run);
 const role=name=>({owner_id:'synthetic-cloud-'+runId,base_url:'https://cznbnb.cn/io-api/v1/',producer_id:'cloud-'+name,server_id:'fixture-server',credential_file:path.join(run,name+'.json')});
 const bundle={run_id:runId,agent:role('agent'),phone:role('phone')};fs.writeFileSync(path.join(run,'agent.json'),JSON.stringify({expires_at:'2000-01-01T00:00:00Z'}));fs.writeFileSync(path.join(run,'phone.json'),'{}');
 function prepare(){fs.writeFileSync(path.join(run,'bundle.json'),JSON.stringify(bundle));const result=spawnSync(process.execPath,[path.join(tools,'prepare-current-caller.mjs'),'--run-id',runId,'--python',python],{cwd:workspace,env,encoding:'utf8',timeout:10000});assert.equal(result.status,2);return JSON.parse(result.stderr).error;}
 assert.equal(prepare(),'CALLER_PREPARATION_EXPIRED');bundle.agent.credential_file=path.join(logical,'cloud-'+runId,'agent.json');assert.equal(prepare(),'CALLER_PREPARATION_EXPIRED');
 const agent=path.join(run,'agent.json');fs.renameSync(agent,agent+'.saved');fs.symlinkSync(agent+'.saved',agent);assert.equal(prepare(),'CALLER_PREPARATION_CREDENTIAL_PATH_INVALID');fs.unlinkSync(agent);fs.renameSync(agent+'.saved',agent);
 fs.renameSync(run,run+'.saved');fs.symlinkSync(run+'.saved',run,'dir');assert.equal(prepare(),'CALLER_PREPARATION_PATH_INVALID');fs.unlinkSync(run);fs.renameSync(run+'.saved',run);
 assert.equal(fs.existsSync(path.join(run,'caller-enrollment.json')),false);
});
