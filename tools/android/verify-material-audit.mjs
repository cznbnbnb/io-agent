// Compare only acknowledged Android material IDs via the read-only public client.
// Body and transcript stay in memory; output contains hashes/counts, never raw content.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {MaterialQueryClient} from '../../rebuild/material-server/query/client.mjs';
const args=process.argv.slice(2);assert.equal(args.length,3,'Usage: verify-material-audit.mjs AUDIT.json PRIVATE-CONFIG.json REPORT.json');
const [auditPath,configPath,outputPath]=args.map(p=>path.resolve(p));assert.notEqual(outputPath,auditPath);assert.notEqual(outputPath,configPath);
assert(fs.statSync(auditPath).size<=4*1024*1024);const phone=JSON.parse(fs.readFileSync(auditPath,'utf8')),config=JSON.parse(fs.readFileSync(configPath,'utf8'));
assert.equal(phone.passed,true);assert.equal(phone.state_unchanged,true);assert.equal(phone.credentials_or_text_exported,false);
assert.equal(config.owner_id,'turboio-user');assert.equal(config.producer_id,'pc-query');assert.equal(config.base_url,'https://cznbnb.cn/io-api/v1/');assert.equal(config.credential_file,'reader.json');config.credential_file=path.join(path.dirname(configPath),'reader.json');
const expected=phone.audit.items;assert(Array.isArray(expected)&&expected.length>0&&expected.length<=256);const client=new MaterialQueryClient(config),items=[];
function quoted(text){let out='"';for(let i=0;i<text.length;i++){const c=text[i];out+=c==='"'?'\\"':c==='\\'?'\\\\':c==='\n'?'\\n':c==='\r'?'\\r':c==='\t'?'\\t':c.charCodeAt(0)<32?'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'):c;}return out+'"';}
function canonical(value){if(value===null)return 'null';if(typeof value==='string')return quoted(value);if(typeof value==='boolean'||typeof value==='number')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>quoted(k)+':'+canonical(value[k])).join(',')+'}';}
const sha=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
try{
 for(const e of expected){
  assert.match(e.material_id,/^rayneo-lifelog-[a-f0-9]{64}$/);assert(Number.isSafeInteger(e.revision)&&e.revision>0);assert.match(e.body_sha256,/^[a-f0-9]{64}$/);assert.match(e.full_text_sha256,/^[a-f0-9]{64}$/);
  const result=await client.get({material_id:e.material_id,revision:e.revision}),item=result.items[0],body=item.body;
  assert.equal(sha(canonical(body)),e.body_sha256);assert.equal(sha(body.full_text.text),e.full_text_sha256);
  assert.equal([...body.full_text.text].length,e.full_text_codepoints);assert.equal(body.utterances.length,e.utterances);assert.equal(body.speakers.length,e.speakers);assert.equal(item.commit_seq,e.commit_seq);
  items.push({...e,exact_server_body_match:true,exact_full_text_match:true});
 }
 const latest=[...items.reduce((m,x)=>{if(!m.has(x.material_id)||m.get(x.material_id).revision<x.revision)m.set(x.material_id,x);return m;},new Map()).values()];
 const unresolved=Object.entries(phone.audit.states??{}).filter(([state])=>state!=='server_stored').reduce((n,[,count])=>n+count,0);
 const report={schema:1,at:new Date().toISOString(),passed:true,scope:'Readback of acknowledged versions only; queue completeness checked separately',audit_sha256:sha(fs.readFileSync(auditPath)),materials:latest.length,stored_versions:items.length,unresolved_versions:unresolved,retired_versions:phone.audit.retired_versions??0,latest_full_text_codepoints:latest.reduce((n,x)=>n+x.full_text_codepoints,0),latest_utterances:latest.reduce((n,x)=>n+x.utterances,0),exact_body_readback:true,exact_full_text_readback:true,raw_text_or_credentials_persisted:false,items};
 fs.writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:true,materials:report.materials,stored_versions:report.stored_versions,unresolved_versions:unresolved,latest_full_text_codepoints:report.latest_full_text_codepoints,exact_full_text_readback:true}));
}catch(error){console.error(JSON.stringify({passed:false,error:'MATERIAL_READBACK_NOT_CONFIRMED',matched_versions:items.length}));process.exitCode=1;}
