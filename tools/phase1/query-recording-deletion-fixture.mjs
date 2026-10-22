// Real read-only query CLI against the existing private reader profile.
// Store raw responses privately; print only this synthetic fixture's metadata.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const phase=process.argv[2];assert(['probe','before','after-cancel','after','after-cold'].includes(phase));
const root=process.cwd(),dir=path.join(root,'rebuild/phase1/device-private/recording-delete063-fixture');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const fixture=read(path.join(dir,'fixture.json'));
assert.equal(fixture.synthetic,true);assert.match(fixture.material_id,/^mat-recording-[a-f0-9]{32}$/);
const runtime='D:/openclaw/nodejs/node.exe',cli=path.join(root,'rebuild/material-server/query/cli.mjs');
const config=path.join(root,'rebuild/material-server/private/formal-formal-phone-20261014-0330/query-config.json');
function query(label,args){
 const result=spawnSync(runtime,[cli,...args,'--config',config],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:2000000,windowsHide:true});
 assert(!result.error,'QUERY_PROCESS_FAILED');
 fs.writeFileSync(path.join(dir,label+'-stdout.txt'),result.stdout);fs.writeFileSync(path.join(dir,label+'-stderr.txt'),result.stderr);
 const reply=JSON.parse((result.status===0?result.stdout:result.stderr).trim());
 fs.writeFileSync(path.join(dir,label+'.json'),JSON.stringify({exit_code:result.status,reply},null,2)+'\n');
 return reply;
}
const result=query('cloud-'+phase+'-get',['get','--material-id',fixture.material_id]);
if(phase==='probe'){
 console.log(JSON.stringify({phase,ok:result.ok,error:result.error?.code,revision:result.items?.[0]?.body?.revision}));process.exit(0);
}
if(phase==='after-cancel'){
 assert.equal(result.ok,true);assert.equal(result.items.length,1);assert.equal(result.items[0].body.operation,'upsert');
 assert(result.items[0].body.full_text.text.includes(fixture.marker));assert.equal(result.items[0].body.revision,1);
 console.log(JSON.stringify({phase,revision:1,operation:'upsert',commit_seq:result.items[0].commit_seq}));process.exit(0);
}
if(phase==='before'){
 assert.equal(result.ok,true);assert.equal(result.items.length,1);assert.equal(result.items[0].body.operation,'upsert');
 assert(result.items[0].body.full_text.text.includes(fixture.marker));
 let cursor='',last;
 for(let page=0;page<20;page++){
  last=query('cloud-before-changes-'+page,['changes','--limit','50',...(cursor?['--cursor',cursor]:[])]);
  assert.equal(last.ok,true);assert(last.next_cursor);cursor=last.next_cursor;if(!last.has_more)break;
 }
 assert.equal(last.has_more,false);fs.writeFileSync(path.join(dir,'changes-cursor.json'),JSON.stringify({cursor})+'\n');
 console.log(JSON.stringify({phase,material_id:fixture.material_id,revision:result.items[0].body.revision,commit_seq:result.items[0].commit_seq,cursor_saved:true}));
}else{
 assert.equal(result.ok,false);assert.equal(result.error.code,'MATERIAL_DELETED');assert.equal(result.error.status,410);
 const {cursor}=read(path.join(dir,'changes-cursor.json'));
 const changes=query('cloud-'+phase+'-changes',['changes','--limit','50','--cursor',cursor]);
 assert.equal(changes.ok,true);assert.equal(changes.has_more,false);
 const deleted=changes.items.filter(item=>item.body.material_id===fixture.material_id&&item.body.operation==='delete');
 assert.equal(deleted.length,1);assert.equal(deleted[0].withdrawn,true);assert.deepEqual(deleted[0].matches,[]);
 assert.equal(deleted[0].body.full_text.text,'');assert.deepEqual(deleted[0].body.utterances,[]);assert.deepEqual(deleted[0].body.speakers??[],[]);
 console.log(JSON.stringify({phase,material_id:fixture.material_id,status:410,withdrawn:true,revision:deleted[0].body.revision,commit_seq:deleted[0].commit_seq}));
}
