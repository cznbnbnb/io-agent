import fs from 'node:fs';
import assert from 'node:assert/strict';
import {MaterialQueryClient} from '../../rebuild/material-server/query/client.mjs';

// Only the dedicated synthetic owner; never print credentials or fetched bodies.
const root='rebuild/android-app',bundle=JSON.parse(fs.readFileSync('rebuild/agent-bridge/private/cloud-material-android-20261021-a/bundle.json','utf8'));
const phone=JSON.parse(fs.readFileSync(root+'/phone-material-cloud-2026-10-21.json','utf8'));
assert.equal(bundle.reader.owner_id,'synthetic-cloud-material-android-20261021-a');
assert.equal(bundle.reader.base_url,'https://cznbnb.cn/io-api/v1/');
assert.equal(phone.passes.length,2);assert.equal(phone.passes[1].added,'0');
const client=new MaterialQueryClient(bundle.reader),id=phone.passes[0].material_id;
const result=await client.get({material_id:id,revision:1}),body=result.items[0].body;
assert.equal(body.full_text.text,'只做预览。\n保留全部资料。\n星期五再执行 😀\n');
assert.deepEqual(body.utterances.map(x=>x.text),['只做预览。\n保留全部资料。','星期五再执行 😀','']);
assert.deepEqual(body.utterances.map(x=>[x.start_ms,x.end_ms,x.overlap]),[[0,1000,true],[500,1500,true],[1500,2000,false]]);
assert.equal(body.processing.covered_ms,null);assert.equal(body.completeness,'partial');assert.equal(body.audio.state,'missing');
assert.equal(body.speakers.length,1);assert.equal(body.speakers[0].is_self,false);assert.equal(body.revision,1);
const changes=await client.changes();assert.equal(changes.items.length,1);assert.equal(changes.has_more,false);
assert.equal(changes.items[0].body.material_id,id);assert.equal(changes.items[0].body.revision,1);
assert.equal(changes.items[0].commit_seq,result.items[0].commit_seq);
const report={schema:1,at:new Date().toISOString(),candidate:'0.5.2-dev1 /10417',owner:bundle.reader.owner_id,material_id:id,
 transport:'Installed production Android MaterialSyncSession/MaterialHttp -> public HTTPS -> existing PC MaterialQueryClient',
 exact_full_text:true,exact_utterances_timing_overlap:true,speaker_and_unknown_coverage_preserved:true,
 server_changes:1,revision:1,duplicate_import_added:0,real_lifelog_read_or_uploaded:false,passed:true};
fs.writeFileSync(root+'/phone-material-cloud-readback-2026-10-21.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
