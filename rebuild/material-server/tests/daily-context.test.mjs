import test from 'node:test';import assert from 'node:assert/strict';
import {adminFixture} from './admin-fixture.mjs';import {listen} from '../http.mjs';
const source=()=>({id:'context-'+ 'a'.repeat(64),date:'2026-10-30',timezone:'Asia/Shanghai',origin:'official_lifelog',coordinate_system:'source_unspecified',coverage:'source_snapshot',category:'activity',events:[{id:'trip-1',kind:'trajectory',started_at_ms:1793318400000,ended_at_ms:1793322000000,title:'合成行程',distance_m:1200,travel_mode:'walk'}],trail:[{at_ms:1793318400000,lat_e6:22000000,lng_e6:113000000,kind:'rawPoint',event_id:'trip-1'}]});
test('same-owner official context is versioned and deduplicated; daily text exposes context without raw points',async t=>{
 const f=await adminFixture();t.after(()=>f.close());const writer=f.store.mint({owner:f.owner,producer:"qa-context-writer",scopes:["materials:write"]});const s=source(),ack=f.store.dayContext.upload(writer.token,{base_revision:0,source:s});assert.equal(ack.revision,1);
 assert.equal(f.store.dayContext.upload(writer.token,{base_revision:0,source:s}).unchanged,true);
 assert.equal(f.store.dayContext.read(f.agent.token,{date:s.date}).items[0].point_count,1);assert.equal(f.store.dayContext.read(f.agent.token,{date:s.date}).items[0].trail,undefined);
 assert.equal(f.store.dayContext.read(f.agent.token,{date:s.date,include_points:true}).items[0].trail.length,1);
 const daily=f.store.lifelog.read(f.agent.token,{from:s.date,to:s.date});assert.equal(daily.context.items[0].events[0].distance_m,1200);assert.equal(daily.context.items[0].trail,undefined);
 assert.equal(f.store.dayContext.read(f.foreign.token,{date:s.date}).items.length,0);
 assert.throws(()=>f.store.dayContext.upload(f.agent.token,{base_revision:0,source:{...s,events:[]}}));
 assert.throws(()=>f.store.dayContext.upload(writer.token,{base_revision:0,source:{...s,events:[]}}),e=>e.code==='DAILY_CONTEXT_CONFLICT');
 assert.equal(f.store.dayContext.upload(writer.token,{base_revision:1,source:{...s,events:[]}}).revision,2);
});
test('category boundaries reject raw audio, fake metrics and invalid coordinates; calendar remains planned',async t=>{
 const f=await adminFixture();t.after(()=>f.close());const writer=f.store.mint({owner:f.owner,producer:"qa-context-writer",scopes:["materials:write"]});
 for(const s of [{...source(),audio:'forbidden'},{...source(),steps:50},{...source(),trail:[{...source().trail[0],lat_e6:100000000}]},{...source(),category:'calendar'},{...source(),events:[{...source().events[0],ended_at_ms:0}]}])assert.throws(()=>f.store.dayContext.upload(writer.token,{base_revision:0,source:s}),e=>e.code==='INVALID_DAILY_CONTEXT');
 const s={...source(),id:'context-'+'b'.repeat(64),category:'calendar',events:[{id:'plan-1',kind:'schedule',started_at_ms:1793318400000,ended_at_ms:1793322000000,title:'合成日历'}],trail:[]};f.store.dayContext.upload(writer.token,{base_revision:0,source:s});assert.equal(f.store.dayContext.read(f.agent.token,{date:s.date}).items[0].calendar_represents,'planned_events_not_attendance');
});
test('HTTP endpoints accept only typed flags and stay behind credentials',async t=>{
 const f=await adminFixture(),server=await listen(f.store,0);t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));f.close();});const writer=f.store.mint({owner:f.owner,producer:"qa-context-writer",scopes:["materials:write"]});const url='http://127.0.0.1:'+server.address().port+'/v1/daily-context';
 assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url+'?include_points=maybe',{headers:{Authorization:'Bearer '+f.agent.token}})).status,400);
 const r=await fetch(url+'/source',{method:'POST',headers:{Authorization:'Bearer '+writer.token,'Content-Type':'application/json'},body:JSON.stringify({base_revision:0,source:source()})});assert.equal(r.status,200);
 assert.equal((await(await fetch(url+'?date=2026-10-30',{headers:{Authorization:'Bearer '+f.agent.token}})).json()).items.length,1);
});

test('context pagination preserves filters and exposes the remaining activity/calendar sources',async t=>{
 const f=await adminFixture();t.after(()=>f.close());const writer=f.store.mint({owner:f.owner,producer:'qa-context-writer',scopes:['materials:write']});
 for(let i=0;i<4;i++)f.store.dayContext.upload(writer.token,{base_revision:0,source:{...source(),id:'context-'+String(i).repeat(64)}});
 const first=f.store.dayContext.read(f.agent.token,{date:'2026-10-30',limit:2});assert.equal(first.items.length,2);assert.equal(first.has_more,true);
 const last=f.store.dayContext.read(f.agent.token,{date:'2026-10-30',limit:2,cursor:first.next_cursor});assert.equal(last.items.length,2);assert.equal(last.has_more,false);assert.equal(new Set([...first.items,...last.items].map(v=>v.id)).size,4);
 assert.throws(()=>f.store.dayContext.read(f.agent.token,{date:'2026-10-29',cursor:first.next_cursor}));assert.throws(()=>f.store.dayContext.read(f.foreign.token,{date:'2026-10-30',cursor:first.next_cursor}));
});
