import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';import {loadCore} from './load-core.mjs';
const {businessEnvelope,HARMONY_WIDGET_ID}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');
const wire=(type,j,seq=0)=>businessEnvelope(type,new TextEncoder().encode(JSON.stringify(j)),seq);

test('bounded text profiles preserve legacy wire and encode the official complete fields',()=>{
 const {displayText}=loadCore('./BusinessCommands'),sid='a'.repeat(32),text='中文与"引号"';
 const old=JSON.parse(displayText(sid,text));assert.equal(old.mode,3);assert.equal(old.status,0);assert.deepEqual(Object.keys(old.content),['source_transcript']);
 for(const profile of ['source-final','classic-final','dual-final']){
  const p=JSON.parse(displayText(sid,text,profile));assert.equal(p.status,1);assert.equal(p.mode,profile==='classic-final'?1:3);assert.equal(p.content.source_transcript,text);
  assert.equal(p.content.target_translation,profile==='dual-final'?text:'');assert.equal(p.content.label,profile==='dual-final'?0:1);assert.equal(p.content.keyword_info,'');
 }
 assert.throws(()=>displayText(sid,text,'unknown'));assert.throws(()=>displayText(sid,'x'.repeat(97),'source-final'));
});

test('subtitle-only probes distinguish preview startup and never use the wearer animation label',async()=>{
 const {displayStart,displayText}=loadCore('./BusinessCommands'),sid='a'.repeat(32);
 assert.equal(JSON.parse(displayStart(sid)).config.is_display,true);assert.equal(JSON.parse(displayStart(sid,false)).config.is_display,false);assert.throws(()=>displayStart(sid,'false'));
 for(const profile of ['subtitle-preview','subtitle-no-preview']){
  const s=setup();await s.device.show('正文',false,125000,'',profile);
  const start=JSON.parse(new TextDecoder().decode(s.sent[0].e.json));assert.equal(start.config.is_display,profile==='subtitle-preview');
  const text=JSON.parse(displayText(sid,'正文',profile));assert.equal(text.mode,3);assert.equal(text.status,1);assert.equal(text.content.label,0);assert.equal(text.content.source_transcript,'正文');assert.equal(text.content.target_translation,'');
 }
});

test('profile changes do not renew the fixed cutoff and ACK config excludes unrelated fields',async()=>{
 const s=setup();await assert.rejects(s.device.show('test',false,120000,'','unknown'));assert.equal(s.sent.length,0);assert.equal(s.raw(),'');
 await s.device.show('初始正文',false,120000,'','source-final');const sid=s.device.displaySessionId,cutoff=[...s.timers.entries()].find(([,t])=>t.n===120000)[0];
 s.device.receive(19,wire(8,{sid,code:1,effective_config:{font_size:1,content_width:90,max_lines:4,is_display:true,position:'center',straight_view:'original',private_unknown:'must not export'}}));
 const first=[...s.timers.entries()].find(([,t])=>t.n===0);s.timers.delete(first[0]);first[1].f();await new Promise(r=>setImmediate(r));
 assert.equal(JSON.parse(new TextDecoder().decode(s.sent.at(-1).e.json)).status,1);
 await s.device.updateDisplay('新正文','classic-final');assert.equal(s.device.state.displayTextProfile,'classic-final');assert(s.timers.has(cutoff));assert.equal([...s.timers.values()].filter(t=>t.n===120000).length,1);
 const config=JSON.parse(s.device.state.displayAckConfig);assert.equal(config.content_width,90);assert.equal(config.private_unknown,undefined);assert.equal(s.device.state.displayTextWrites,2);
});
test('Chinese widget text is byte-budgeted before starting a pending launcher command',async()=>{
 const {device:d,sent}=setup();await d.dashboardRead();d.receive(15,wire(19,{cmd:'dashboard_config',payload:{data:{widgets_v2:[]}}}));
 const before=sent.length;await assert.rejects(d.widget('雷'.repeat(20)),/单帧/);assert.equal(sent.length,before);assert.equal(d.launcherBusy,false);
 await d.widget('雷'.repeat(15));assert.equal(sent.length,before+1);
});
test('display stop keeps occupancy until matching exit response or explicit physical confirmation',async()=>{
 const {device:d,sent,timers}=setup();await d.show('测试');const {sid}=JSON.parse(new TextDecoder().decode(sent[0].e.json));
 await d.stopDisplay();assert(d.displayActive);assert(d.displayClosing);await assert.rejects(d.show('不能抢占'));
 d.receive(19,wire(8,{sid,code:1}));assert.equal(d.state.displayReady,false);
 [...timers.values()].find(t=>t.n===8000).f();assert(d.displayActive);assert.match(d.state.display,/未确认/);
 d.receive(19,wire(3,{sid:'unrelated'}));assert(d.displayActive);d.receive(19,wire(3,{sid}));assert(!d.displayActive);
 await d.show('下一轮');await d.stopDisplay();d.confirmDisplayExited();assert(!d.displayActive);assert.match(d.state.display,/非设备回执/);
});
test('weather negative result is never relabeled success',async()=>{
 const {device:d}=setup();await d.weather('测试',27,101);d.receive(15,wire(19,{cmd:'current_weather_update',payload:{value:5}}));assert.match(d.state.weather,/未接受/);assert.equal(d.launcherBusy,false);
});
function setup(initial=''){
 const sent=[],timers=new Map();let id=0,peer='synthetic-original',saved=initial,failSave=false,failSend=false,handler;
 const {DeviceFeatures}=loadApp('DeviceFeatures',{'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(7)})})}}},{setTimeout:(f,n)=>{timers.set(++id,{f,n});return id;},clearTimeout:id=>timers.delete(id)});
 const ports={load:()=>saved,save:raw=>{if(failSave)throw Error('synthetic-disk-failure');saved=raw;}};
 const create=()=>{
  const d=new DeviceFeatures(async(b,p)=>{sent.push({b,e:readLauncherEnvelope(p)});if(handler)handler(b,readLauncherEnvelope(p));if(failSend)throw Error('synthetic-ambiguous-send');});
  d.initializeDisplayCleanup(ports,()=>peer);d.connected(true,50);return d;
 };
 return {device:create(),sent,timers,create,raw:()=>saved,record:()=>JSON.parse(saved),setPeer:value=>peer=value,failSave:value=>failSave=value,failSend:value=>failSend=value,handler:value=>handler=value};
}

test('zero-adjustment clock resend reaches business15/type5 with string UTC for the same current instant',async()=>{
 const {device:d,sent}=setup(),before=Math.floor(Date.now()/1000);
 await d.syncTime(0);const after=Math.floor(Date.now()/1000),row=sent[0];
 assert.equal(sent.length,1);assert.equal(row.b,15);assert.equal(row.e.type,5);
 const command=JSON.parse(new TextDecoder().decode(row.e.json)),data=JSON.parse(command.payload.data);
 assert.equal(command.cmd,'sync_time');assert.equal(typeof data.utc,'string');
 assert(Number(data.utc)>=before&&Number(data.utc)<=after,'wire UTC is the current epoch, without a local-time shift');
 assert.equal(data.offset,-new Date().getTimezoneOffset()*60);assert.equal(typeof data.timezone,'string');
 assert.equal(command.payload.value,0);assert.equal(command.payload.mode,0);
});

test('restore double-click AI preserves actual rotation direction and long press, never defaults unread fields',async()=>{
 const {device:d,sent}=setup();await assert.rejects(d.restoreDoubleClickAI(),/读取|读回/);assert.equal(sent.length,0);
 d.receive(15,wire(4,{generalSettings:{crownConfig:{direction:1,double:6,longPress:3}}}));
 await d.restoreDoubleClickAI();const command=JSON.parse(new TextDecoder().decode(sent.at(-1).e.json));assert.equal(command.cmd,'crown_config');assert.equal(command.payload.value,1);assert.deepEqual(JSON.parse(command.payload.data),{double:0,longPress:3});
});

const fireReadback = timers => {
 const [id, timer] = [...timers.entries()].find(([, timer]) => timer.n === 1500);
 timers.delete(id); timer.f();
};

test('focus waits through transitional states and confirms only the final requested state',async()=>{
 const {device:d,timers,sent}=setup(),policy={auto:0,begin:'09:00',end:'18:00',weekday:[0,1,2,3,4,5,6]};
 const status=enable=>wire(1,{generalStatus:{focusMode:{enable,enableGlassClose:1,policy}}});
 d.receive(15,status(1));await d.writeFocus(false,true);fireReadback(timers);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(JSON.parse(JSON.parse(new TextDecoder().decode(sent[0].e.json)).payload.data).type,1);
 for(const state of [2,3]){
   d.receive(15,status(state));assert(d.launcherBusy);assert.doesNotMatch(d.state.note,/确认已生效/);
   const [id,timer]=[...timers].find(([,t])=>t.n===600);timers.delete(id);timer.f();await new Promise(resolve=>setImmediate(resolve));
 }
 d.receive(15,status(0));assert.equal(d.launcherBusy,false);assert.match(d.state.note,/确认已生效/);
});
test('a rejected focus change times out rather than treating the previous state as confirmation',async()=>{
 const {device:d,timers}=setup(),policy={auto:1,begin:'10:00',end:'19:00',weekday:[1,3,5]};
 const actual=wire(1,{generalStatus:{focusMode:{enable:0,enableGlassClose:1,policy}}});
 d.receive(15,actual);await d.writeFocus(true,true);fireReadback(timers);await new Promise(resolve=>setImmediate(resolve));d.receive(15,actual);assert(d.launcherBusy);
 const rev=d.state.statusRev;[...timers.values()].find(t=>t.n===9500).f();
 assert(!d.launcherBusy);assert.match(d.state.note,/超时/);assert(d.state.statusRev>rev);
});
test('wakeup writes preserve a current legacy value but do not invent new legacy settings',async()=>{
 const {device:d,sent}=setup();d.receive(15,wire(4,{generalSettings:{wakeupConfig:{headupSwitch:1,headupDegree:30,crownSwitch:5}}}));
 await d.writeWakeup(false,31,5);
 assert.equal(JSON.parse(JSON.parse(new TextDecoder().decode(sent[0].e.json)).payload.data).crown_switch,5);
 await assert.rejects(d.writeWakeup(false,31,2),/旧值/);
});
test('fresh settings/status replies advance counters without inventing changed values or connection epochs',()=>{
 const {device:d}=setup(),epoch=d.state.connectionRev;
 const settings=wire(4,{generalSettings:{autoLockTime:15}}),status=wire(1,{generalStatus:{brightness:4}});
 d.receive(15,settings);const rev=d.state.settingsRev;d.receive(15,settings);
 d.receive(15,status);d.receive(15,status);d.connected(true,49);
 assert.equal(d.state.settingsReadSerial,2);assert.equal(d.state.statusReadSerial,2);assert.equal(d.state.settingsRev,rev);assert.equal(d.state.connectionRev,epoch);
 d.receive(15,wire(4,{generalSettings:[]}));assert.equal(d.state.settingsReadSerial,2);
 d.connected(false,-1);assert(d.state.connectionRev>epoch);
});
test('setting write waits for actual send and verifies the target rather than any JSON change', async () => {
 const {device:d,timers}=setup();
 d.receive(15,wire(1,{generalStatus:{brightness:7,battery:50}}));
 await d.brightness(8); fireReadback(timers);
 d.receive(15,wire(1,{generalStatus:{brightness:7,battery:49}}));
 assert.match(d.state.note,/不一致/); assert.doesNotMatch(d.state.note,/确认已生效/);
});
test('an already matching value is confirmed even when the readback JSON is unchanged', async () => {
 const {device:d,timers}=setup();const actual={generalStatus:{brightness:8,battery:50}};
 d.receive(15,wire(1,actual));await d.brightness(8);fireReadback(timers);d.receive(15,wire(1,actual));
 assert.match(d.state.note,/确认已生效/);
});

test('unchanged rejected readback advances the view revision so optimistic controls restore the actual value',async()=>{
 const {device:d,timers}=setup();const actual={generalStatus:{brightness:7,battery:50}};
 d.receive(15,wire(1,actual));const rev=d.state.statusRev;
 await d.brightness(8);fireReadback(timers);d.receive(15,wire(1,actual));
 for(let i=0;i<10;i++)await Promise.resolve();
 assert.match(d.state.note,/不一致/);assert(d.state.statusRev>rev);assert.equal(d.launcherBusy,false);
});
test('echo, partial response and unrelated domain cannot declare an applied value', async () => {
 const {device:d,timers}=setup();await d.brightness(8);
 d.receive(15,wire(3,{cmd:'brightness_change',payload:{value:3}}));assert.doesNotMatch(d.state.note,/确认已生效/);
 fireReadback(timers);d.receive(15,wire(1,{generalStatus:{battery:49}}));
 d.receive(15,wire(4,{generalSettings:{displayConfig:{height:8}}}));assert.doesNotMatch(d.state.note,/确认已生效/);
 [...timers.values()].find(t=>t.n===4000).f();assert.match(d.state.note,/超时/);
});
test('disconnect clears readback timers, old cache and queued writes across reconnect', async () => {
 const {device:d,timers,sent}=setup();d.receive(15,wire(4,{generalSettings:{autoLockTime:15}}));
 let finish;d.send=(b,p)=>{sent.push({b,e:readLauncherEnvelope(p)});return new Promise(resolve=>{finish=resolve;});};
 const first=d.brightness(8),second=d.brightness(9);const settled=Promise.allSettled([first,second]);
 for(let i=0;i<10;i++)await Promise.resolve();d.connected(false,-1);d.connected(true,60);finish();await settled;
 assert.equal(sent.length,1);assert.equal(timers.size,0);assert.equal(d.state.settingsJson,'');
 await assert.rejects((async()=>{d.connected(false,-1);await d.brightness(7);})(),/连接/);
});
test('send failures reach the caller rather than being swallowed by the write queue', async () => {
 const {device:d}=setup();d.send=async()=>{throw new Error('synthetic failure');};
 await assert.rejects(d.brightness(8),/未发送/);assert.match(d.state.note,/发送未完成/);
});

test('a fast readback during send clears its deadline and publishes idle after the send resolves',async()=>{
 const {device:d,timers}=setup();await d.brightness(8);
 let finish;const views=[];d.changed=()=>views.push(d.launcherBusy);
 d.send=()=>{d.receive(15,wire(1,{generalStatus:{brightness:8}}));return new Promise(resolve=>{finish=resolve;});};
 fireReadback(timers);assert.equal(timers.size,0);assert.equal(d.launcherBusy,true);
 finish();for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(d.launcherBusy,false);assert.equal(views.at(-1),false);assert.match(d.state.note,/确认已生效/);
});

test('compound settings reject missing or partial baselines instead of sending defaults for companion fields',async()=>{
 const {device:d,sent}=setup();
 await assert.rejects(d.writeWakeup(false,20,0),/不完整/);
 d.receive(15,wire(4,{generalSettings:{wakeupConfig:{headupSwitch:1}}}));
 await assert.rejects(d.writeWakeup(false,20,0),/不完整/);assert.equal(sent.length,0);
 d.receive(15,wire(4,{generalSettings:{wakeupConfig:{headupSwitch:1,headupDegree:30,crownSwitch:2}}}));
 await d.writeWakeup(false,30,2);assert.equal(sent.length,1);
});

test('focus changes preserve the complete device policy and reject an incomplete policy',async()=>{
 const {device:d,sent}=setup();
 d.receive(15,wire(1,{generalStatus:{focusMode:{enable:0,enableGlassClose:1,policy:{auto:1}}}}));
 await assert.rejects(d.writeFocus(true,false),/先读取/);assert.equal(sent.length,0);
 const policy={auto:1,begin:'10:30',end:'20:45',weekday:[1,3,5]};
 d.receive(15,wire(1,{generalStatus:{focusMode:{enable:0,enableGlassClose:1,policy}}}));
 await d.writeFocus(true,false);
 const payload=JSON.parse(new TextDecoder().decode(sent[0].e.json)).payload;
 assert.equal(payload.value,1);assert.equal(payload.mode,0);assert.deepEqual(JSON.parse(payload.data),{type:1,...policy});
});
test('A2UI requires baseline and exact sequence/code ACK; unrelated or legacy value does not grant deletion',async()=>{
 const {device:d,sent}=setup();await assert.rejects(d.widget('test'),/基线/);await d.dashboardRead();d.receive(15,wire(19,{cmd:'dashboard_config',payload:{data:{widgets_v2:[{id:'weather'}]}}}));await d.widget('test');const seq=sent.at(-1).e.sequence;
 d.receive(15,wire(19,{code:0},seq+1));await assert.rejects(d.removeWidget(),/只能删除/);
 d.receive(15,wire(19,{code:0},seq));await d.removeWidget();const json=JSON.parse(new TextDecoder().decode(sent.at(-1).e.json));assert.equal(json.payload.data.id,HARMONY_WIDGET_ID);assert.equal(json.cmd,'widget_uninstall');
});
test('existing foreign-owned test id is never overwritten just because it uses our prefix',async()=>{
 const {device:d}=setup();await d.dashboardRead();d.receive(15,wire(19,{cmd:'dashboard_config',payload:{data:{widgets_v2:[{id:HARMONY_WIDGET_ID}]}}}));await assert.rejects(d.widget('test'),/拒绝覆盖/);
});
test('display waits for matching SID success before text, and stops on unexpected audio',async()=>{
 const {device:d,sent,timers}=setup();await d.show('测试7392');const start=JSON.parse(new TextDecoder().decode(sent[0].e.json));assert.equal(sent[0].b,19);assert.equal(sent[0].e.type,7);
 d.receive(19,wire(8,{sid:'wrong',code:1}));assert.equal(d.state.displayReady,false);
 d.receive(19,wire(8,{sid:start.sid,code:1}));assert.equal(d.state.displayReady,true);[...timers.values()].find(t=>t.n===0).f();await new Promise(r=>setImmediate(r));assert.equal(sent[1].e.type,5);
 d.receive(19,Uint8Array.of(8,1,16,4,34,1,99));await new Promise(r=>setImmediate(r));assert.equal(sent.at(-1).e.type,3);assert.equal(d.state.displayReady,false);
});
test('continuous display removes only the preview deadline; disconnect retains cleanup occupancy',async()=>{
 for(const continuous of [false,true]){const {device:d,sent,timers}=setup();assert(!d.displayActive);await d.show('route',continuous);assert(d.displayActive);assert(!d.state.displayReady);const {sid}=JSON.parse(new TextDecoder().decode(sent[0].e.json));d.receive(19,wire(8,{sid,code:1}));assert.equal([...timers.values()].some(t=>t.n===180000),!continuous);d.connected(false,0);assert(d.displayActive);assert(d.displayClosing);assert(!d.state.displayReady);assert.equal(timers.size,0);}
});

test('start persists only its original peer and SID before any wire command',async()=>{
 const s=setup();s.handler((b,e)=>{assert.equal(b,19);assert.equal(e.type,7);assert.equal(s.record().peer,'synthetic-original');assert.equal(s.record().sid,JSON.parse(new TextDecoder().decode(e.json)).sid);});
 await s.device.show('private text must not enter the journal');assert.equal(s.record().evidence,'none');assert(!s.raw().includes('private text'));
});

test('restart restores only cleanup, never text, handshake, readiness or microphone commands',async()=>{
 const s=setup();await s.device.show('do not replay',true);const sid=s.record().sid,n=s.sent.length;
 const restored=s.create();assert(restored.displayActive);assert(restored.displayClosing);assert(!restored.state.displayReady);assert.equal(s.sent.length,n);
 restored.receive(19,wire(8,{sid,code:1}));await new Promise(r=>setImmediate(r));assert.equal(s.sent.length,n);await assert.rejects(restored.show('blocked'));
 await restored.stopDisplay();assert.equal(s.sent.length,n+1);assert.equal(s.sent.at(-1).e.type,3);
 restored.receive(19,wire(3,{sid}));assert(!restored.displayActive);assert.equal(s.record().evidence,'device_event');assert.equal(s.record().peer,'');assert.equal(s.record().sid,'');assert(!s.create().displayActive);
});

test('recovery neither sends cleanup to nor accepts confirmation from a different peer',async()=>{
 const s=setup();await s.device.show('owned');const sid=s.record().sid;s.device.connected(false,-1);s.setPeer('another-device');s.device.connected(true,90);const n=s.sent.length;
 await assert.rejects(s.device.stopDisplay(),/原眼镜/);assert.throws(()=>s.device.confirmDisplayExited(),/原眼镜/);
 s.device.receive(19,wire(3,{sid}));assert(s.device.displayActive);assert.equal(s.sent.length,n);
 s.setPeer('synthetic-original');await s.device.stopDisplay();s.device.receive(19,wire(3,{sid}));assert(!s.device.displayActive);
});

test('authenticated source identity cannot be replaced with the current peer for an exit or audio event',async()=>{
 const s=setup();await s.device.show('owned');const sid=s.record().sid,n=s.sent.length;
 s.device.receive(19,wire(3,{sid}),'another-authenticated-peer');
 s.device.receive(19,Uint8Array.of(8,1,16,4,34,1,99),'another-authenticated-peer');
 assert(s.device.displayActive);assert(!s.device.displayClosing);assert.equal(s.sent.length,n);
 s.device.receive(19,wire(3,{sid}),'synthetic-original');assert(!s.device.displayActive);
});

test('ambiguous start retains durable cleanup and an explicit stop uses the same SID',async()=>{
 const s=setup();s.failSend(true);await assert.rejects(s.device.show('ambiguous'),/不明/);assert(s.device.displayActive);assert(s.device.displayClosing);
 const sid=s.record().sid;s.failSend(false);await s.device.stopDisplay();assert.equal(JSON.parse(new TextDecoder().decode(s.sent.at(-1).e.json)).sid,sid);
 assert(s.create().displayActive,'a successful stop write is not exit proof');
});

test('intent persistence failure prevents the start and blocks every new display',async()=>{
 const s=setup();s.failSave(true);await assert.rejects(s.device.show('no write'),/保存失败/);assert.equal(s.sent.length,0);assert(s.device.displayActive);
 s.failSave(false);await assert.rejects(s.device.show('still blocked'));assert.equal(s.sent.length,0);
});

test('exit persistence failure cannot release occupancy or replace the pending record',async()=>{
 const s=setup();await s.device.show('owned');const sid=s.record().sid;await s.device.stopDisplay();s.failSave(true);s.device.receive(19,wire(3,{sid}));
 assert(s.device.displayActive);assert(s.device.displayClosing);assert(!s.device.state.displayReady);assert.equal(s.record().evidence,'none');assert(s.create().displayActive);
 s.failSave(false);s.device.receive(19,wire(3,{sid}));assert(!s.device.displayActive);assert.equal(s.record().evidence,'device_event');
});

test('unknown code 2 cannot authorize display text and triggers cleanup instead',async()=>{
 const s=setup();await s.device.show('not authorized');const sid=s.record().sid;s.device.receive(19,wire(8,{sid,code:2}));await new Promise(r=>setImmediate(r));
 assert(!s.device.state.displayReady);assert(s.device.displayClosing);assert.deepEqual(s.sent.map(x=>x.e.type),[7,3]);assert(s.device.displayActive);
});

test('stale startup and queued-text timers cannot act on a replacement display epoch',async()=>{
 const s=setup();await s.device.show('old');const sid=s.record().sid,startup=[...s.timers.values()].find(t=>t.n===10000).f;
 s.device.receive(19,wire(8,{sid,code:1}));const text=[...s.timers.values()].find(t=>t.n===0).f;
 s.device.connected(false,-1);s.device.connected(true,60);const n=s.sent.length;startup();text();await new Promise(r=>setImmediate(r));assert.equal(s.sent.length,n);
 s.device.receive(19,wire(3,{sid}));await s.device.show('replacement');const now=s.sent.length;startup();text();await new Promise(r=>setImmediate(r));assert.equal(s.sent.length,now);assert(!s.device.displayClosing);
});

test('fast matching stop response remains terminal when the stop send later completes',async()=>{
 const s=setup();await s.device.show('fast');const sid=s.record().sid;s.handler((b,e)=>{if(e.type===3)s.device.receive(19,wire(3,{sid}));});
 await s.device.stopDisplay();assert(!s.device.displayActive);assert.match(s.device.state.display,/同会话退出/);assert.equal(s.record().evidence,'device_event');
});

test('manual physical exit confirmation is stored separately from device evidence',async()=>{
 const s=setup();await s.device.show('manual');await s.device.stopDisplay();s.device.confirmDisplayExited();
 assert.equal(s.record().evidence,'user_confirmation');assert(!s.create().displayActive);
});

test('channel ownership refusal sends nothing and does not create cleanup debt',async()=>{
 const s=setup();s.device.canDisplayBegin=()=>false;await assert.rejects(s.device.show('occupied'),/占用/);assert.equal(s.sent.length,0);assert.equal(s.raw(),'');assert(!s.device.displayActive);
});

test('malformed cleanup records remain preserved and prevent a new display',async()=>{
 for(const raw of ['{','{}',JSON.stringify({schema:1,peer:'',sid:'a'.repeat(32),evidence:'none'}),JSON.stringify({schema:1,peer:'owner',sid:'a'.repeat(32),evidence:'device_event'})]){
  const s=setup(raw);assert(s.device.displayActive);await assert.rejects(s.device.show('blocked'));assert.equal(s.raw(),raw);assert.equal(s.sent.length,0);
 }
});

test('fixed display lifetime survives a successful handshake and stops without model or page input',async()=>{
 const s=setup(),operation='chn-'+'1'.repeat(32);await s.device.show('bounded',false,15000,operation);const sid=s.record().sid;
 assert.equal(s.record().operation,operation);s.device.receive(19,wire(8,{sid,code:1}));
 assert(![...s.timers.values()].some(t=>t.n===180000));[...s.timers.values()].find(t=>t.n===15000).f();await new Promise(r=>setImmediate(r));
 assert.equal(s.sent.at(-1).e.type,3);assert(s.device.displayClosing);assert(s.device.state.displayStopSubmitted);
 s.device.receive(19,wire(3,{sid}));assert.equal(s.record().operation,operation);assert.equal(s.record().evidence,'device_event');
 const restored=s.create();assert.equal(restored.state.displayLastOperation,operation);assert.equal(restored.state.displayExitEvidence,'device_event');assert(!restored.displayActive);
});
test('background cleanup waits for actual exit and disconnect leaves a durable pending session',async()=>{
 const s=setup();await s.device.show('background');const sid=s.record().sid;let result;
 const pending=s.device.stopDisplayAndWait().then(v=>result=v);await new Promise(r=>setImmediate(r));assert.equal(result,undefined);
 s.device.receive(19,wire(3,{sid}));await pending;assert.equal(result,true);
 await s.device.show('again');const stopped=s.device.stopDisplayAndWait();s.device.connected(false,-1);assert.equal(await stopped,false);assert(s.create().displayActive);assert.equal(s.timers.size,0);
});
test('a hung stop write cannot leave an unbounded background waiter',async()=>{
 const s=setup();await s.device.show('hung');s.device.send=()=>new Promise(()=>{});const pending=s.device.stopDisplayAndWait();
 [...s.timers.values()].find(t=>t.n===8500).f();assert.equal(await pending,false);assert(s.device.displayActive);assert(s.create().displayActive);
});
