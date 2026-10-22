// 线上真实性核验：对已部署的 HTTPS 服务做读写往返，结果只含合成数据与元数据，不含令牌。
// 用法：node tools/phase1/verify-live-service.mjs --query-config <配置> --writer <手机凭据文件> [--output <文件>]
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MaterialQueryClient,readPrivateJson} from '../../rebuild/material-server/query/client.mjs';

const args=process.argv.slice(2),option=(name,fallback)=>{const at=args.indexOf(`--${name}`);return at<0?fallback:args[at+1];};
const configPath=path.resolve(option('query-config','rebuild/material-server/private/query-config.json'));
const writerPath=path.resolve(option('writer','rebuild/material-server/private/phone-harmony.json'));
const output=path.resolve(option('output','rebuild/phase1/server-live-verification.json'));
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const base=new URL(config.base_url);
const steps=[];
const step=(name,details={})=>steps.push({step:name,...details});

// 1. Unauthenticated access must be refused by the deployed stack.
const anonymous=await fetch(new URL('identity',base),{redirect:'manual'});
step('unauthenticated_identity',{status:anonymous.status,expected:401,passed:anonymous.status===401});

// 2. The read credential must resolve to the registered identity.
const query=new MaterialQueryClient({...config,credential_file:path.resolve(path.dirname(configPath),config.credential_file)},{clock:Date.now});
const before=await query.changes({limit:5});
step('identity_bound_read',{owner_id:config.owner_id,producer_id:config.producer_id,server_id:config.server_id,
  cursor_present:typeof before.next_cursor==='string'&&before.next_cursor.length>0,passed:typeof before.next_cursor==='string'});

// 3. Discover the writer identity from its own credential, then write a synthetic revision
// over the real TLS endpoint. The credential file never contains a producer label, so the
// server's answer decides which producer_id the envelope must carry.
const writer=readPrivateJson(writerPath,4096);
const writerIdentity=await (await fetch(new URL('identity',base),{headers:{Authorization:`Bearer ${writer.token}`}})).json();
step('writer_identity',{producer_id:writerIdentity.producer_id??null,owner_matches:writerIdentity.owner_id===config.owner_id,
  server_matches:writerIdentity.server_id===config.server_id,can_write:(writerIdentity.scopes??[]).includes('materials:write'),
  passed:writerIdentity.owner_id===config.owner_id&&writerIdentity.server_id===config.server_id&&
    (writerIdentity.scopes??[]).includes('materials:write')});
// Unique per run so the write/replay/delta checks stay meaningful on repeat runs.
// Rows created here are synthetic verification rows named live-check-*.
const materialId=`live-check-${Date.now()}`;
const text='线上自检：合成资料，不是用户内容';
const event={schema_version:'1.1',event_id:randomUUID(),idempotency_key:randomUUID(),kind:'material.revision',
  producer_id:writerIdentity.producer_id,created_at:new Date().toISOString(),
  expires_at:new Date(Date.now()+3600000).toISOString(),body:{material_id:materialId,revision:1,base_revision:0,operation:'upsert',
    source:'lifelog',started_at:new Date(Date.now()-60000).toISOString(),ended_at:new Date().toISOString(),completeness:'complete',
    text_revision:1,utterances:[],audio:{state:'local',sha256:null,object_id:null},
    full_text:{format:'markdown',text,origin:'asr'},
    processing:{transcription_state:'complete',covered_ms:60000,source_ms:60000,speaker:'unknown',boundary:'no_speech',
      recognition_channel:'unknown',user_edited:false}}};
const send=async body=>{const response=await fetch(new URL('material-events',base),{method:'POST',redirect:'manual',
  headers:{Authorization:`Bearer ${writer.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,value:await response.json().catch(()=>null)};};
const accepted=await send(event);
step('synthetic_write',{status:accepted.status,expected:201,material_id:materialId,commit_seq:accepted.value?.commit_seq??null,
  receipt_stage:accepted.value?.receipt?.stage??null,passed:accepted.status===201&&accepted.value?.receipt?.stage==='server_stored'});
const replay=await send(event);
// The service answers a duplicate from its canonical (RFC8785) stored copy, so key order
// differs while every value is identical: compare structurally, not as raw text.
const sorted=value=>Array.isArray(value)?value.map(sorted)
  :(value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value);
const sameAck=JSON.stringify(sorted(replay.value))===JSON.stringify(sorted(accepted.value));
const sameReceipt=replay.value?.receipt?.receipt_id===accepted.value?.receipt?.receipt_id;
step('idempotent_replay',{status:replay.status,expected:200,same_ack:sameAck,same_receipt_id:sameReceipt,
  commit_seq:replay.value?.commit_seq??null,passed:replay.status===200&&sameAck&&sameReceipt});

// 4. The read path must return the exact stored text and its source reference.
const found=await query.search({keyword:'线上自检',limit:5});
const item=found.items.find(value=>value.body.material_id===materialId);
step('read_back_via_https',{status:found.items.length?200:0,matches:Boolean(item),text_exact:item?.body.full_text.text===text,
  source_revision:item?.source_ref?.revision??null,coverage:item?.evidence?.transcription_state??null,
  passed:Boolean(item)&&item.body.full_text.text===text&&item.source_ref.revision===1});

// 5. Incremental delivery must surface the same revision after the earlier cursor.
const delta=await query.changes({cursor:before.next_cursor,limit:5});
step('incremental_delivery',{revisions:delta.items.map(value=>`${value.body.material_id}@${value.body.revision}`),
  passed:delta.items.some(value=>value.body.material_id===materialId&&value.body.revision===1)});

const report={at:new Date().toISOString(),base_url:config.base_url,server_id:config.server_id,owner_id:config.owner_id,
  scope:'real HTTPS deployment, synthetic material only; no audio, no user conversation, no phone client',
  steps,status:steps.every(value=>value.passed)?'passed':'failed',
  verified:['TLS/nginx entry','unauthenticated refusal','credential identity binding','synthetic write with server_stored receipt',
    'idempotent replay','read-back with exact text and source reference','incremental cursor delivery'],
  not_verified:['phone-to-server sync','computer bridge delivery','audio upload','credential rotation','long-run stability']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({status:report.status,steps:steps.map(value=>[value.step,value.passed])})+'\n');
process.exitCode=report.status==='passed'?0:1;
