import test from 'node:test';import assert from 'node:assert/strict';import {loadCore} from './load-core.mjs';
const b=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');
const encode=s=>new TextEncoder().encode(s);
test('homepage weather uses nested JSON string, timestamp and type18 envelope',()=>{
 const s=b.currentWeather('北京',27,101,1700000000),j=JSON.parse(s);assert.equal(j.cmd,'current_weather_update');assert.equal(typeof j.payload.data,'string');assert.deepEqual(JSON.parse(j.payload.data),{location:'北京',temp:27,icon:101});
 const e=readLauncherEnvelope(b.businessEnvelope(18,encode(s),1001));assert.equal(e.type,18);assert.equal(e.sequence,1001);
 assert.throws(()=>b.currentWeather('北京',999,101,1700000000));
});
test('minimal widget fits verified MTU512 and only addresses own widget',()=>{
 const s=b.installTextWidget('Turbo IO 7392'),j=JSON.parse(s);assert.equal(j.cmd,'widget_install');assert.equal(j.payload.data.id,b.HARMONY_WIDGET_ID);assert.equal(JSON.parse(j.payload.data.extras).uiContent.updateComponents.components[0].text,'Turbo IO 7392');
 assert(b.businessEnvelope(18,encode(s),1001).length+10<=509);
 assert.equal(JSON.parse(b.removeTextWidget()).payload.data.id,b.HARMONY_WIDGET_ID);assert(!b.removeTextWidget().includes('widgets_v2'));assert.throws(()=>b.installTextWidget('x'.repeat(21)));
});
test('temporary display does not request ASR and content preserves literal JSON metacharacters',()=>{
 const sid='a'.repeat(32),j=JSON.parse(b.displayStart(sid));assert.equal(j.force,false);assert.equal(j.scope,'temporary');assert.equal(j.config.is_display,true);
 const text='导航测试\n转弯"\\80米';assert.equal(JSON.parse(b.displayText(sid,text)).content.source_transcript,text);assert.equal(JSON.parse(b.displayStop(sid)).reason_code,10);assert.throws(()=>b.displayStart('wrong'));
});
test('probe command stays generic envelope with evidence-based whitelist',()=>{
 const j=JSON.parse(b.probeLauncherCommand('focus_mode',1,''));assert.equal(j.cmd,'focus_mode');assert.equal(j.payload.value,1);assert.equal(j.payload.mode,0);assert.equal(j.payload.data,'');
 const withData=JSON.parse(b.probeLauncherCommand('display_config',0,'{"height":2,"distance":2}'));assert.deepEqual(JSON.parse(withData.payload.data),{height:2,distance:2});
 const e=readLauncherEnvelope(b.businessEnvelope(2,encode(b.probeLauncherCommand('mic_switch',0,'')),7));assert.equal(e.type,2);assert.equal(e.sequence,7);
 assert.throws(()=>b.probeLauncherCommand('factory_reset',1,''));assert.throws(()=>b.probeLauncherCommand('ota_update',1,''));assert.throws(()=>b.probeLauncherCommand('mic_switch',-1,''));assert.throws(()=>b.probeLauncherCommand('mic_switch',0,'x'.repeat(201)));
});
test('every launcher command emits parseable JSON (regression: missing closing brace)',()=>{
 for(const [c,v] of [['request_general_status',0],['request_general_settings',0],['brightness_change',7],['auto_lock_time',15],['set_ai_voice_wakeup',1],['sync_time',1790751496]]){
  const s=b.launcherCommand(c,v);const j=JSON.parse(s);assert.equal(j.cmd,c);assert.equal(j.payload.value,v);assert.equal(typeof j.payload.data,'string');
 }
 for(const s of [b.lifeLogCommand('life_log_switch',true),b.lifeLogCommand('life_log_guide',false),b.currentWeather('北京',27,101,1700000000),b.dashboardQuery(),b.installTextWidget('测试'),b.removeTextWidget(),b.probeLauncherCommand('mic_switch',0,'')])JSON.parse(s);
});
test('clock wire uses official decimal UTC string without shifting the epoch or changing numeric offset seconds',()=>{
 const seconds=1791862005;
 for(const [offset,zone] of [[28800,'Asia/Shanghai'],[0,'UTC'],[-18000,'America/New_York']]){
  const envelope=readLauncherEnvelope(b.businessEnvelope(5,encode(b.syncTimeCommand(seconds,offset,zone))));
  const command=JSON.parse(new TextDecoder().decode(envelope.json)),data=JSON.parse(command.payload.data);
  assert.equal(envelope.type,5);assert.equal(command.cmd,'sync_time');assert.equal(command.payload.value,0);assert.equal(command.payload.mode,0);
  assert.equal(typeof command.payload.data,'string');assert.equal(typeof data.utc,'string');assert.equal(data.utc,String(seconds));
  assert.equal(Number(data.utc),seconds);assert.equal(typeof data.offset,'number');assert.equal(data.offset,offset);assert.equal(data.timezone,zone);
 }
 for(const value of [-1,1.5,NaN,Infinity,1791862005000,'1791862005'])assert.throws(()=>b.syncTimeCommand(value,28800,'Asia/Shanghai'));
 assert.equal(JSON.parse(JSON.parse(b.syncTimeCommand(2147483647,28800,'Asia/Shanghai')).payload.data).utc,'2147483647');
});
test('official settings write formats (blutter-verified): valid JSON, clamps and shapes',()=>{
 const sync=JSON.parse(b.syncTimeCommand(1790752141,28800,'Asia/Shanghai'));
 assert.equal(sync.cmd,'sync_time');assert.equal(sync.payload.value,0);assert.deepEqual(JSON.parse(sync.payload.data),{utc:'1790752141',offset:28800,timezone:'Asia/Shanghai'});
 const probe=JSON.parse(b.syncTimeProbeCommand(1790763520000,28800,'Asia/Shanghai'));
 assert.deepEqual(JSON.parse(probe.payload.data),{utc:1790763520000,offset:28800,timezone:'Asia/Shanghai'});
 assert.throws(()=>b.syncTimeProbeCommand(-1,28800,'Asia/Shanghai'));
 assert.throws(()=>b.syncTimeProbeCommand(1,28800,''));
 const pv=JSON.parse(b.privacyConfigCommand(true,4,false,true));assert.deepEqual(JSON.parse(pv.payload.data),{mic_switch:1,led_light:4,led_auto_light:0,log_switch:1});
 assert.equal(pv.payload.mode,0);assert.equal(typeof pv.payload.data,'string');
 assert.throws(()=>b.privacyConfigCommand(true,99,false,true));
 assert.equal(JSON.parse(JSON.parse(b.privacyConfigCommand(true,1,true,true)).payload.data).led_light,1);
 const wk=JSON.parse(b.wakeupConfigCommand(true,30,1));assert.deepEqual(JSON.parse(wk.payload.data),{headup_switch:1,headup_degree:30,crown_switch:1});
 assert.throws(()=>b.wakeupConfigCommand(false,999,5));
 assert.equal(JSON.parse(JSON.parse(b.wakeupConfigCommand(false,10,5)).payload.data).crown_switch,5);
 const cr=JSON.parse(b.crownConfigCommand(1,2,3));assert.equal(cr.payload.value,1);assert.deepEqual(JSON.parse(cr.payload.data),{double:2,longPress:3});
 assert.equal(JSON.parse(b.crownConfigCommand(0,0,7)).payload.value,0);
 const dp=JSON.parse(b.displayConfigCommand(6,3));assert.deepEqual(JSON.parse(dp.payload.data),{height:6,distance:3});
 assert.throws(()=>b.displayConfigCommand(99,1));
 assert.equal(JSON.parse(JSON.parse(b.displayConfigCommand(1,2)).payload.data).height,1);
 const hg=JSON.parse(b.headGesturesCommand(true,1));assert.equal(hg.payload.value,1);assert.equal(hg.payload.mode,1);assert.equal(hg.payload.data,'');
 const al=JSON.parse(b.autoLockTimeCommand(25));assert.equal(al.cmd,'auto_lock_time');assert.equal(al.payload.value,25);assert.equal(al.payload.mode,0);assert.equal(al.payload.data,'');
 assert.throws(()=>b.autoLockTimeCommand(13));
 const fm=JSON.parse(b.focusModeCommand(true,false,false,'09:00','18:00',[0,1,2,3,4,5,6]));
 assert.equal(fm.payload.value,1);assert.equal(fm.payload.mode,0);
 assert.deepEqual(JSON.parse(fm.payload.data),{type:2,auto:0,begin:'09:00',end:'18:00',weekday:[0,1,2,3,4,5,6]});
 assert.throws(()=>b.focusModeCommand(true,false,false,'9:00','18:00',[0]));
 assert.throws(()=>b.syncTimeCommand(-1,28800,'Asia/Shanghai'));assert.throws(()=>b.syncTimeCommand(1,28800,'x'.repeat(41)));
});
