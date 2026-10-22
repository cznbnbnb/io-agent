import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {MaterialQueryClient} from '../../rebuild/material-server/query/client.mjs';

// Reads only material IDs just acknowledged in the authorized Android queue.
// Real text remains in memory; persist only comparison hashes and counts.
const root='rebuild/android-app',privateDir=path.resolve('rebuild/material-server/private/formal-android-material-20261021');
const dev2=process.argv.includes('--dev2'),dev5=process.argv.includes('--dev5'),dev6=process.argv.includes('--dev6');assert([dev2,dev5,dev6].filter(Boolean).length<=1);const phone=JSON.parse(fs.readFileSync(root+(dev6?'/phone-formal-material-audit-dev6-2026-10-21.json':dev5?'/phone-formal-material-audit-dev5-2026-10-21.json':dev2?'/phone-formal-material-audit-dev2-2026-10-21.json':'/phone-formal-material-audit-2026-10-21.json'),'utf8'));
if(dev2){const before=JSON.parse(fs.readFileSync(root+'/phone-formal-material-audit-2026-10-21.json','utf8'));assert.deepEqual(phone.audit.items,before.audit.items);}
if(dev5){const before=JSON.parse(fs.readFileSync(root+'/phone-formal-material-audit-dev2-2026-10-21.json','utf8'));assert.deepEqual(phone.audit.items.filter(x=>x.revision===1),before.audit.items);assert.equal(phone.product,'0.5.2-dev5 /10421');}
if(dev6){const before=JSON.parse(fs.readFileSync(root+'/phone-formal-material-audit-dev5-2026-10-21.json','utf8'));assert.deepEqual(phone.audit.items,before.audit.items);assert.equal(phone.product,'0.5.2-dev6 /10422');}
const config=JSON.parse(fs.readFileSync(path.join(privateDir,'query-config.json'),'utf8'));
assert.equal(config.owner_id,'turboio-user');assert.equal(config.producer_id,'pc-query');assert.equal(config.base_url,'https://cznbnb.cn/io-api/v1/');assert.equal(config.credential_file,'reader.json');
assert.equal(phone.state_unchanged,true);assert.equal(phone.credentials_or_text_exported,false);assert(phone.audit.items.length>0&&phone.audit.items.length<=16);
config.credential_file=path.join(privateDir,'reader.json');const client=new MaterialQueryClient(config);
function quoted(text){let out='"';for(let i=0;i<text.length;i++){const c=text[i];out+=c==='"'?'\\"':c==='\\'?'\\\\':c==='\n'?'\\n':c==='\r'?'\\r':c==='\t'?'\\t':c.charCodeAt(0)<32?'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'):c;}return out+'"';}
function canonical(value){if(value===null)return 'null';if(typeof value==='string')return quoted(value);if(typeof value==='boolean'||typeof value==='number')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>quoted(k)+':'+canonical(value[k])).join(',')+'}';}
const sha=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex'),items=[];
for(const expected of phone.audit.items){
 assert.match(expected.material_id,/^rayneo-lifelog-[a-f0-9]{64}$/);assert((dev5||dev6)?[1,2].includes(expected.revision):expected.revision===1);
 const result=await client.get({material_id:expected.material_id,revision:expected.revision}),item=result.items[0],body=item.body;
 assert.equal(sha(canonical(body)),expected.body_sha256);assert.equal(sha(body.full_text.text),expected.full_text_sha256);
 assert.equal([...body.full_text.text].length,expected.full_text_codepoints);assert.equal(body.utterances.length,expected.utterances);assert.equal(body.speakers.length,expected.speakers);assert.equal(item.commit_seq,expected.commit_seq); // Read endpoint exposes commit sequence and body, not event ID.
 items.push({...expected,exact_server_body_match:true,exact_full_text_match:true});
}
const latest=[...new Map(items.map(x=>[x.material_id,x])).values()];
const report={schema:1,at:new Date().toISOString(),candidate:phone.product,owner:'turboio-user',producer:'phone-android',reader:'pc-query',passed:true,materials:latest.length,stored_versions:items.length,
 utterances:items.reduce((n,x)=>n+x.utterances,0),full_text_codepoints:items.reduce((n,x)=>n+x.full_text_codepoints,0),
 source:'Current official account loaded lifelogs imported through normal Android UI',actual_lifelog_uploaded:true,exact_body_readback:true,raw_text_or_credentials_persisted:false,items,
 latest_utterances:latest.reduce((n,x)=>n+x.utterances,0),latest_full_text_codepoints:latest.reduce((n,x)=>n+x.full_text_codepoints,0),
 limits:[dev6?'Selected known days verified; no automatic full-history discovery':'Only already loaded official lifelogs; no automatic full-history discovery',(dev5||dev6)?'Fresh revision readback only; absent pending revision supersession, deletion and original audio remain open':'No authoritative revision/deletion or original audio sync acceptance','Manual foreground sync; background/8h acceptance remains open']};
fs.writeFileSync(root+(dev6?'/phone-formal-material-readback-dev6-2026-10-21.json':dev5?'/phone-formal-material-readback-dev5-2026-10-21.json':dev2?'/phone-formal-material-readback-dev2-2026-10-21.json':'/phone-formal-material-readback-2026-10-21.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,materials:report.materials,stored_versions:report.stored_versions,utterances:report.latest_utterances,full_text_codepoints:report.latest_full_text_codepoints,exact_body_readback:true,raw_text_or_credentials_printed:false}));
