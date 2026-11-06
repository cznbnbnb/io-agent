import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {MaterialStore} from '../store.mjs';import {listen} from '../http.mjs';import {BridgeClient} from '../../agent-bridge/client.mjs';
import {prepareManagedCli,managedCli,drainManagedCli} from '../../agent-bridge/questions/managed-cli.mjs';
import {CORRECTION_CUE,CORRECTION_GUIDANCE} from '../../agent-bridge/lifelog-correction-policy.mjs';

async function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-text-')),store=new MaterialStore(path.join(dir,'db.sqlite')),agent=store.devices.enroll({owner:'caller601-text-codex',role:'agent',label:'Agent'}),phone=store.mint({owner:'caller601-text-codex',producer:'phone',scopes:['materials:write']}),server=await listen(store),file=path.join(dir,'device.json');fs.writeFileSync(file,JSON.stringify(agent),{mode:0o600});
 const config={schema_version:'1.0',base_url:`http://127.0.0.1:${server.address().port}/v1/`,owner_id:'caller601-text-codex',producer_id:agent.producer_id,server_id:agent.server_id,computer_id:'test-pc',agent_id:'codex',credential_file:file,allow_loopback_http:true},client=new BridgeClient(config);
 t.after(async()=>{await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});});return {dir,store,agent,phone,client,config};}
const source=(key=1)=>({id:'text-'+key.toString(16).padStart(64,'0'),date:'2026-11-02',timezone:'Asia/Shanghai',kind:'transcript',started_at:'2026-11-02T01:00:00Z',ended_at:'2026-11-02T02:00:00Z',blocks:[{id:'title',kind:'title',text:'项目讨论'},{id:'clip-1',kind:'utterance',text:'X123还没到货',speaker:'others'},{id:'clip-2',kind:'utterance',text:'下午确认尺寸',speaker:'me'}],related_ids:[]});
const edit=(s,revision=0,changes=[{block_id:'clip-1',text:'DEMO-X123还没到货'}])=>({request_id:randomUUID(),material_id:s.id,expected_source_revision:1,expected_revision:revision,agent:'Codex',reason:'依据项目资料订正型号',evidence:['项目BOM，型号DEMO-X123'],edits:changes});

test('phone updates preserve edits, append new blocks and flag changed edited source; search uses effective text',async t=>{const f=await fixture(t),s=source();
 f.store.lifelog.upload(f.phone.token,{base_revision:0,source:s});const e=edit(s);await f.client.dailyEdit('daily-correct',e);assert.equal((await f.client.dailyEdit('daily-correct',e)).duplicate,true);
 s.blocks.push({id:'clip-3',kind:'utterance',text:'新补入的晚间记录'});f.store.lifelog.upload(f.phone.token,{base_revision:1,source:s});let r=(await f.client.daily({date:s.date})).items[0];assert(r.text.includes('DEMO-X123'));assert(r.text.includes('晚间'));assert.equal(r.needs_review,false);assert.equal(r.blocks[1].speaker,'others');assert.equal(r.blocks[2].speaker,'me');assert.equal(r.blocks[3].speaker,undefined);assert(!r.text.includes('others'));
 s.blocks[1].text='X124已经到货';f.store.lifelog.upload(f.phone.token,{base_revision:2,source:s});r=(await f.client.daily({date:s.date})).items[0];assert(r.text.includes('DEMO-X123还没到货'));assert(!r.text.includes('已经到货'));assert.equal(r.needs_review,true);assert.deepEqual(r.conflict_blocks,['clip-1']);
 assert.equal((await f.client.daily({date:s.date,keyword:'X124'})).items.length,0);assert.equal((await f.client.daily({date:s.date,keyword:'DEMO-X123'})).items.length,1);
 const h=await f.client.dailyEdit('daily-history',{material_id:s.id});assert.equal(h.original.blocks[1].text,'X124已经到货');assert.equal(h.items[0].agent,'Codex');assert.equal(h.items[0].changes.blocks['clip-1'].after.text,'DEMO-X123还没到货');assert.deepEqual(h.correction_guidance,CORRECTION_GUIDANCE);
 assert.equal(f.store.lifelog.head(f.phone.token,{id:s.id}).revision,3,'phone sees only source revisions, not edits');
});
test('version conflicts cannot overwrite another Agent; selective undo preserves unrelated edits and notes',async t=>{const f=await fixture(t),s=source();f.store.lifelog.upload(f.phone.token,{base_revision:0,source:s});await f.client.dailyEdit('daily-correct',edit(s));
 await assert.rejects(f.client.dailyEdit('daily-correct',edit(s)),{code:'CORRECTION_CONFLICT'});
 await f.client.dailyEdit('daily-correct',edit(s,1,[{block_id:'clip-2',text:'下午确认样机尺寸'}]));
 const note={...edit(s,2),note:'11月3日收到供应商到货确认'};delete note.edits;await f.client.dailyEdit('daily-note',note);
 const undo={...edit(s,3),revert_revision:1};delete undo.edits;await f.client.dailyEdit('daily-revert',undo);
 let r=(await f.client.daily({date:s.date})).items[0];assert(r.text.includes('X123还没到货'));assert(!r.text.includes('DEMO-X123'));assert(r.text.includes('样机尺寸'));assert.equal(r.notes[0].text,note.note);
 const again={...edit(s,4),revert_revision:1};delete again.edits;await assert.rejects(f.client.dailyEdit('daily-revert',again),{code:'CORRECTION_REVERT_CONFLICT'});
});
test('stale summaries are withheld until explicitly revised against current transcript dependencies',async t=>{const f=await fixture(t),s=source(),segment={...source(2),kind:'segment',related_ids:[s.id],blocks:[{id:'summary',kind:'summary',text:'X123未到货'}]};f.store.lifelog.upload(f.phone.token,{base_revision:0,source:s});f.store.lifelog.upload(f.phone.token,{base_revision:0,source:segment});
 await f.client.dailyEdit('daily-correct',edit(s));let r=(await f.client.daily({date:s.date,kind:'segment'})).items[0];assert.equal(r.summary_stale,true);assert.equal(r.text,'');
 const correction={...edit(segment,0,[{block_id:'summary',text:'DEMO-X123未到货'}]),dependencies_version:r.dependencies_version};await f.client.dailyEdit('daily-correct',correction);r=(await f.client.daily({date:s.date,kind:'segment'})).items[0];assert.equal(r.summary_stale,false);assert.equal(r.text,'DEMO-X123未到货');
 await f.client.dailyEdit('daily-correct',edit(s,1,[{block_id:'clip-2',text:'下午核对尺寸'}]));assert.equal((await f.client.daily({date:s.date,kind:'segment'})).items[0].summary_stale,true);
});
test('full-day CLI collects all server pages, while explicit pagination detects concurrent source changes',async t=>{const f=await fixture(t);for(let i=1;i<=62;i++)f.store.lifelog.upload(f.phone.token,{base_revision:0,source:source(i)});
 const full=await f.client.daily({date:'2026-11-02'});assert.equal(full.items.length,62);assert.equal(full.complete,true);assert.equal(full.has_more,false);assert.deepEqual(full.correction_guidance,CORRECTION_GUIDANCE);assert.equal(full.correction_guidance.content_role,'cli_guidance');assert.equal(full.items[0].text,source().blocks.map(b=>b.text).join('\n'));assert.equal(full.items[0].correction_guidance,undefined);
 const first=await f.client.daily({date:'2026-11-02',limit:1});assert.equal(first.has_more,true);f.store.lifelog.upload(f.phone.token,{base_revision:0,source:source(63)});await assert.rejects(f.client.daily({date:'2026-11-02',limit:1,cursor:first.next_cursor}),{code:'CURSOR_RESET_REQUIRED'});
});
test('narrow permissions isolate accounts and prohibit audio/position fields at phone boundary',async t=>{const f=await fixture(t),s=source();f.store.lifelog.upload(f.phone.token,{base_revision:0,source:s});
 const other=f.store.devices.enroll({owner:'caller602-text-codex',role:'agent',label:'Other'});assert.equal(f.store.lifelog.read(other.token,{}).items.length,0);assert.throws(()=>f.store.lifelog.correction(other.token,edit(s)),{code:'MATERIAL_NOT_FOUND'});
 assert.throws(()=>f.store.lifelog.upload(f.agent.token,{base_revision:0,source:source(2)}),{code:'FORBIDDEN'});assert.throws(()=>f.store.lifelog.correction(f.phone.token,edit(s)),{code:'FORBIDDEN'});
 for(const extras of [{started_at:0},{ended_at:"2026-02-30T01:00:00Z"},{audio:'data'},{latitude:23},{file:'/phone/private'}])assert.throws(()=>f.store.lifelog.upload(f.phone.token,{base_revision:1,source:{...s,...extras}}),{code:'INVALID_LIFELOG_SOURCE'});
 assert.throws(()=>f.store.get(f.agent.token,s.id),{code:'FORBIDDEN'});
});
test('managed CLI transports a complete day over 1 MiB and advertises correction commands',async t=>{const f=await fixture(t);for(let i=1;i<=6;i++){const s=source(i);s.blocks[1].text='中文'.repeat(40000);f.store.lifelog.upload(f.phone.token,{base_revision:0,source:s});}
 const route={computer_id:'test-pc',agent_id:'codex',project_id:'p',session_id:randomUUID()},taskId='daily-test',sessionId='native-test',op={id:'op',turnId:randomUUID(),taskId,status:'inProgress'},journal=path.join(f.dir,'journal.json');
 f.store.queueSubmit(f.agent.token,{schema_version:'1.0',kind:'task',event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:f.agent.producer_id,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),body:{task_id:taskId,revision:1,route,command:'Read',state:'queued',allow_create_session:false}},'task');
 const c=prepareManagedCli({directory:f.dir,journal,sessionId,workspace:f.dir,op,taskId,expiresAt:new Date(Date.now()+600000).toISOString(),bridge:f.config,route});op.cliContext=c.file;fs.writeFileSync(journal,JSON.stringify({session_id:sessionId,workspace:f.dir,operations:{op}}),{mode:0o600});
 const help=await managedCli('help',{},c.file,{env:{}});assert(help.commands.includes('daily-correct'));assert.deepEqual(help.correction_guidance,CORRECTION_GUIDANCE);assert(c.briefInstruction.includes(CORRECTION_CUE));assert(c.briefInstruction.length<1500);assert(c.instruction.includes(CORRECTION_CUE));assert(!c.briefInstruction.includes(CORRECTION_GUIDANCE.rules[0]));
 const waiting=managedCli('daily',{date:'2026-11-02'},c.file,{env:{},viaHost:true});await drainManagedCli(c.file);const result=await waiting;assert.equal(result.items.length,6);assert(Buffer.byteLength(JSON.stringify(result))>1048576);assert(result.complete);assert.deepEqual(result.correction_guidance,CORRECTION_GUIDANCE);assert.equal(result.items[0].blocks[1].text,'中文'.repeat(40000));
});

test('large correction histories page without truncating a change; old readers cannot bypass effective projection',async t=>{
 const f=await fixture(t),s=source();s.blocks[1].text='原'.repeat(200000);f.store.lifelog.upload(f.phone.token,{base_revision:0,source:s});
 for(let i=0;i<16;i++)await f.client.dailyEdit('daily-correct',edit(s,i,[{block_id:'clip-1',text:'正'.repeat(200000)+i}]));
 const first=await f.client.dailyEdit('daily-history',{material_id:s.id});assert(Buffer.byteLength(JSON.stringify(first))>8*1048576);assert(first.has_more);const rest=await f.client.dailyEdit('daily-history',{material_id:s.id,before:first.next_before});assert.equal(first.items.length+rest.items.length,16);assert.equal(rest.has_more,false);
 assert.throws(()=>f.store.page(f.agent.token,'daily-summaries',{}),{code:'LIFELOG_READER_UPGRADE_REQUIRED'});
 const original=await f.client.dailyEdit('daily-history',{material_id:s.id,source_revision:1});assert.equal(original.original.blocks[1].text,s.blocks[1].text);
});
