import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';import {loadCore} from './load-core.mjs';
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus'),peer='aabbccddeeff';
const {readOggOpusFrames}=loadApp('OggOpus');
const settle=()=>new Promise(r=>setImmediate(r));
const packet=(type,j,bytes=[])=>{const prefix=businessEnvelope(type,new TextEncoder().encode(JSON.stringify(j)));const n=bytes.length;return Uint8Array.from([...prefix,...(n?[34,...(n>127?[n%128|128,Math.floor(n/128)]:[n]),...bytes]:[])]);};
function setup(minutes=10,fixedNow=undefined){
 const files=new Map(),dirs=new Set(),handles=new Map(),sent=[],timers=new Map();let fd=0,random=0,timer=0,connected=true,failMeta=false,failCleanup=false,clockOffset=0,currentPeer=peer,sendHook;
 class Clock extends Date{static now(){return (fixedNow??Date.now())+clockOffset;}}
 const fs={OpenMode:{CREATE:1,READ_WRITE:2,WRITE_ONLY:4,TRUNC:8},WhenceType:{SEEK_SET:0},
  accessSync:p=>files.has(p)||dirs.has(p),
  mkdirSync:p=>{if(dirs.has(p))throw Error('exists');dirs.add(p);},
  rmdirSync:p=>{dirs.delete(p);},
  unlinkSync:p=>{if(!files.delete(p))throw Error('missing');},
  listFileSync:p=>[...dirs].filter(d=>d.startsWith(p+'/')&&!d.slice(p.length+1).includes('/')).map(d=>d.slice(p.length+1)),
  openSync:(path,flags)=>{if(!files.has(path)){if(!(flags&1))throw Error('missing');files.set(path,new Uint8Array());}if(flags&8)files.set(path,new Uint8Array());const file={fd:++fd,path,pos:0};handles.set(file.fd,file);return file;},
  closeSync:f=>handles.delete(typeof f==='number'?f:f.fd),
  lseek:(fd,pos)=>{handles.get(fd).pos=pos;return pos;},
  writeSync:(fd,buffer)=>{const h=handles.get(fd),b=new Uint8Array(buffer),old=files.get(h.path),out=new Uint8Array(Math.max(old.length,h.pos+b.length));out.set(old);out.set(b,h.pos);h.pos+=b.length;files.set(h.path,out);return b.length;},
  readSync:(fd,buffer,options={})=>{const h=handles.get(fd),b=files.get(h.path),n=Math.min(options.length??buffer.byteLength,b.length-h.pos);new Uint8Array(buffer).set(b.slice(h.pos,h.pos+n));h.pos+=n;return n;},
  fsyncSync:()=>{},renameSync:(a,b)=>{if(failMeta&&b.endsWith('/meta.json'))throw Error('synthetic-meta-disk-full');if(failCleanup&&b.endsWith('/lifelog-cleanup.json'))throw Error('synthetic-cleanup-disk-full');files.set(b,files.get(a));files.delete(a);},
  readTextSync:p=>files.has(p)?new TextDecoder().decode(files.get(p)):'',
  statSync:p=>{const path=typeof p==='number'?handles.get(p).path:p;return {size:files.get(path).length,mtime:Date.now()};}};
 const {LifelogSession}=loadApp('LifelogSession',{'@kit.AbilityKit':{},'@kit.CoreFileKit':{fileIo:fs},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(++random)})})}},'libturbo_audio.so':{lifelogReset:()=>{},lifelogClose:()=>{},lifelogDecode:()=>new Uint8Array(1920).buffer},'./RecordingCoverage':loadApp('RecordingCoverage'),'./OggOpus':loadApp('OggOpus')},{Date:Clock,setTimeout:(f,ms)=>{timers.set(++timer,{f,ms});return timer;},clearTimeout:id=>timers.delete(id),setInterval:(f,ms)=>{timers.set(++timer,{f,ms});return timer;},clearInterval:id=>timers.delete(id)});
 const sender=async(business,payload)=>{const e=readLauncherEnvelope(payload);const json=new TextDecoder().decode(e.json),entry={business,type:e.type,json,body:JSON.parse(json)};sent.push(entry);if(sendHook)await sendHook(entry);};
 const create=()=>{const value=new LifelogSession(sender,()=>connected?currentPeer:'',()=>true);value.initialize({filesDir:'/private-test'});return value;};
 const session=new LifelogSession(sender,()=>connected?currentPeer:'',()=>true);
 session.initialize({filesDir:'/private-test'});
 if(minutes!==10)session.setSegmentMinutes(minutes);
 const root='/private-test/lifelog',segs=()=>[...dirs].filter(d=>d.startsWith(root+'/seg-'));
 const fire=(ms)=>{for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.f();}};
 const fireRotate=()=>{for(const [id,t] of [...timers])if(t.ms>=1000&&t.ms<=1300){timers.delete(id);t.f();}};
 const settleAll=async()=>{for(let i=0;i<12;i++){fire(0);await settle();}};
 return {session,sent,timers,files,dirs,root,segs,fire,fireRotate,settleAll,create,advance:ms=>clockOffset+=ms,failMeta:v=>failMeta=v,
  failCleanup:v=>failCleanup=v,onSend:hook=>sendHook=hook,setPeer:p=>currentPeer=p,online:()=>connected=true,
  ledger:()=>JSON.parse(new TextDecoder().decode(files.get('/private-test/lifelog-cleanup.json'))),
  dayFlag:()=>files.has(root+'/day.json')&&JSON.parse(new TextDecoder().decode(files.get(root+'/day.json'))).enabled,
  fail:()=>{connected=false;},
  a2:()=>sent.filter(x=>x.type===162).at(-1),
  feed:async(type,j,b)=>{session.receive(peer,packet(type,j,b));await settleAll();}};
}
test('legacy daily text labels unknown coverage without implying a running window or complete transcription',()=>{
 const s=setup(),dir=s.root+'/seg-'+'f'.repeat(32),started=Date.now()-3000;s.dirs.add(dir);
 s.files.set(dir+'/meta.json',new TextEncoder().encode(JSON.stringify({version:1,started,ended:started+1200})));
 s.files.set(dir+'/text.md',new TextEncoder().encode('已保存文字'));
 s.files.set(dir+'/transcript.json',new TextEncoder().encode(JSON.stringify({transcription_complete:false,transcription_state:'unknown',utterances:[{start:0,end:1,text:'旧资料文字',speaker:-1}]})));
 s.session.refresh();const day=s.session.dayText(0);assert.equal(day.transcribed,0);assert.match(day.markdown,/覆盖范围尚未核实/);assert.doesNotMatch(day.markdown,/仍在分窗处理中/);
});

test('lifelog deletion commits its hook before removing legacy text and preserves source on hook failure',()=>{
 const s=setup(),name='seg-'+'a'.repeat(32),directory=s.root+'/'+name;
 s.dirs.add(directory);s.files.set(directory+'/text.md',new TextEncoder().encode('合成旧文字'));s.session.refresh();
 const item=s.session.items[0],before=[...s.files].map(([file,bytes])=>[file,Array.from(bytes)]);
 s.session.beforeRemove=()=>{throw Error('synthetic tombstone failure');};
 assert.throws(()=>s.session.remove(item),/删除标记未能保存/);
 assert.deepEqual([...s.files].map(([file,bytes])=>[file,Array.from(bytes)]),before);assert(s.dirs.has(directory));
 let calls=0;s.session.beforeRemove=selected=>{calls++;assert.equal(selected.name,name);assert(s.files.has(directory+'/text.md'));};
 s.session.remove(item);assert.equal(calls,1);assert(!s.dirs.has(directory));assert.match(s.session.note,/等待同步确认/);
});

test('lifelog deletion refuses the current capture before committing its deletion hook',async()=>{
 const s=setup();await s.session.start('day');let calls=0;s.session.beforeRemove=()=>calls++;
 assert.throws(()=>s.session.remove({name:s.segs()[0].split('/').at(-1)}),/正在收音/);assert.equal(calls,0);
 s.session.disconnected();
});

test('active prefix publishes only durable pages with a stable start; rotation reports the OLD segment start',async()=>{
 const s=setup(0.02),progress=[],closed=[];
 s.session.onSegmentProgress=(directory,path,started,frames)=>progress.push({directory,path,started,frames});
 s.session.onSegmentClosed=(directory,path,started)=>closed.push({directory,path,started});
 await s.session.start('day');const first=s.segs()[0];
 const initial=JSON.parse(new TextDecoder().decode(s.files.get(first+'/meta.json')));
 assert.equal(initial.sealed,false);assert.equal(initial.frames,0);
 await s.feed(161,{});const taskId=s.a2().body.taskId;
 s.advance(5000);
 for(let i=0;i<11;i++)await s.feed(163,{taskId,frameCount:31},new Uint8Array(31*240).fill(7));
 assert.equal(progress.length,1);assert.equal(progress[0].frames,300);assert.equal(progress[0].started,initial.started);
 assert.equal(readOggOpusFrames(s.files.get(first+'/audio.ogg')).length,300,'41 buffered frames are not advertised as durable');
 const current=s.session.items.find(i=>i.name===first.split('/').at(-1));
 assert.equal(current.created,initial.started);assert.equal(current.committedFrames,300);assert.equal(current.complete,false);
 s.fireRotate();await s.settleAll();
 assert.equal(closed[0].started,initial.started,'old segment never uses new segment timestamp');
 const final=JSON.parse(new TextDecoder().decode(s.files.get(first+'/meta.json')));
 assert.equal(final.sealed,true);assert.equal(final.frames,341);assert.equal(readOggOpusFrames(s.files.get(first+'/audio.ogg')).length,341);
 assert.equal(final.started,initial.started);assert(s.session.items.find(i=>i.name===first.split('/').at(-1)).complete);
});

test('crash after durable audio but before the next metadata checkpoint retains audio and marks interruption',async()=>{
 const s=setup();await s.session.start('day');await s.feed(161,{});const taskId=s.a2().body.taskId;
 for(let i=0;i<4;i++)await s.feed(163,{taskId,frameCount:31},new Uint8Array(31*240).fill(9));
 const dir=s.segs()[0],meta=JSON.parse(new TextDecoder().decode(s.files.get(dir+'/meta.json')));
 assert.equal(meta.frames,0);assert.equal(readOggOpusFrames(s.files.get(dir+'/audio.ogg')).length,100);
 // Simulate a new owner observing disk, without executing graceful close.
 s.session.active=false;s.session.refresh();
 assert.equal(s.session.items.length,1);assert.equal(s.session.items[0].interrupted,true);assert.equal(s.session.items[0].complete,false);
 assert.equal(s.session.items[0].created,meta.started);assert.equal(s.session.purgeEmpty(),0);assert(s.files.has(dir+'/audio.ogg'));
});

test('metadata promotion failure preserves prior metadata and audio, then next checkpoint retries',async()=>{
 const s=setup(),progress=[];s.session.onSegmentProgress=(...row)=>progress.push(row);
 await s.session.start('day');await s.feed(161,{});const taskId=s.a2().body.taskId,dir=s.segs()[0];
 const original=s.files.get(dir+'/meta.json').slice();s.failMeta(true);
 for(let i=0;i<11;i++)await s.feed(163,{taskId,frameCount:31},new Uint8Array(31*240).fill(9));
 assert.deepEqual(s.files.get(dir+'/meta.json'),original);assert.equal(progress.length,0);assert.match(s.session.metadataWarning,/未能保存/);
 assert.equal(readOggOpusFrames(s.files.get(dir+'/audio.ogg')).length,300);
 s.failMeta(false);await s.feed(163,{taskId,frameCount:1},new Uint8Array(240).fill(9));
 assert.equal(progress.length,1);assert.equal(s.session.metadataWarning,'');assert.equal(JSON.parse(new TextDecoder().decode(s.files.get(dir+'/meta.json'))).frames,300);
});

test('day mode persists intent, turns the glasses switch on, and answers A1 with A2/A8',async()=>{
 const s=setup();
 await s.session.start('day');
 const cmds=s.sent.filter(x=>x.business===15).map(x=>JSON.parse(x.json));
 assert.deepEqual(cmds.map(c=>c.cmd),['life_log_guide','life_log_switch']);
 assert.equal(cmds[1].payload.value,1);
 assert.equal(s.dayFlag(),true);
 assert.equal(s.session.active,true);
 await s.feed(161,{});
 const a2=s.a2(),a8=s.sent.find(x=>x.type===168);
 assert(a2,'A2 已发送');assert(a8,'A8 已发送');
 assert(a2.body.idleTimeoutSec>=300,'A2 声明的闲置容忍度已放大（避免眼镜频繁自行收轮）');
 const taskId=a2.body.taskId;
 await s.feed(163,{taskId,frameCount:2},new Uint8Array(480).fill(7));
 assert.equal(s.session.bytes,480);
 await s.feed(163,{taskId:'someone-else',frameCount:2},new Uint8Array(480).fill(9));
 assert.equal(s.session.bytes,480);
});

test('day mode rotates segments on schedule and decodes each finished segment to WAV',async()=>{
 const s=setup(0.02);
 await s.session.start('day');
 await s.feed(161,{});
 const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:2},new Uint8Array(480).fill(7));
 assert.equal(s.segs().length,1);
 const first=s.segs()[0];
 s.fireRotate();await s.settleAll();
 assert.equal(s.segs().length,2,'轮转后应有新段');
 assert(s.files.has(first+'/audio.ogg'),'旧段应已封成 OGG');
 assert.equal(s.files.has(first+'/audio.wav'),false,'全天模式不做 WAV 解码');
 const frames=readOggOpusFrames(s.files.get(first+'/audio.ogg'));
 assert.equal(frames.length,2,'OGG 内可取回 2 帧');
 assert.deepEqual(frames[0],new Uint8Array(240).fill(7));
 assert.equal(s.session.bytes,0,'新段字节清零');
 await s.feed(163,{taskId,frameCount:1},new Uint8Array(240).fill(8));
 assert.equal(s.session.bytes,240);
 assert.equal(s.session.items.filter(i=>i.complete).length,1);
});

test('glasses exit re-arms the day session instead of ending it',async()=>{
 const s=setup();
 await s.session.start('day');
 await s.feed(161,{});
 const first=s.a2().body.taskId;
 await s.feed(163,{taskId:first,frameCount:1},new Uint8Array(240).fill(5));
 const before=s.segs().length;
 await s.feed(165,{rc:0});
 assert.equal(s.session.active,true,'全天会话保持');
 assert.equal(s.sent.filter(x=>x.type===166).length,0,'不应发送 A6 退出');
 assert.equal(s.segs().length,before+1,'已切换到新段');
 await s.feed(161,{});
 const second=s.a2().body.taskId;
 assert.notEqual(second,first,'重新握手生成新 taskId');
});

test('day intent survives disconnect but unknown device capture cannot resume on reconnect',async()=>{
 const s=setup();
 await s.session.start('day');
 await s.feed(161,{});
 const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:2},new Uint8Array(480).fill(7));
 s.session.disconnected();await s.settleAll();
 assert.equal(s.session.active,false);
 assert.equal(s.session.dayEnabled,true);
 assert.equal(s.dayFlag(),true,'断开后仍保留全天意图');
 const before=s.sent.filter(x=>x.business===15).length;
 await s.session.connected();await s.settleAll();
  assert.equal(s.session.active,false,'重连不能重播未知采集');assert(s.session.cleanupRequired);assert(s.session.occupied);
  assert.equal(s.sent.filter(x=>x.business===15).length,before,'不自动下发开关');
  s.session.confirmExited(s.session.cleanupSessionId);assert(!s.session.occupied);await s.session.start('day');assert(s.session.active);
});

test('manual stop ends day mode, sends A6 and the OFF switch, then seals the OGG',async()=>{
 const s=setup();
 await s.session.start('day');
 await s.feed(161,{});
 const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:3},new Uint8Array(720).fill(6));
 await s.session.stop('测试停止');
 assert.equal(s.dayFlag(),false);
 assert.equal(s.sent.filter(x=>x.type===166).length,1,'A6 退出指令');
 const off=s.sent.filter(x=>x.business===15).map(x=>JSON.parse(x.json)).at(-1);
 assert.equal(off.payload.value,0,'开关 OFF');
 s.fire(3000);await s.settleAll();
 assert.equal(s.session.active,false);
 const seg=s.segs()[0];
 assert(s.files.has(seg+'/audio.ogg'),'停止后 OGG 已封口');
 assert.equal(s.files.has(seg+'/audio.wav'),false,'全天模式不做 WAV 解码');
 assert.equal(readOggOpusFrames(s.files.get(seg+'/audio.ogg')).length,3);
});

test('25-second test mode still produces both OGG and WAV',async()=>{
 const s=setup();
 await s.session.start('test');
 await s.feed(161,{});
 const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:2},new Uint8Array(480).fill(7));
 s.fire(25000);await s.settleAll();
 s.fire(3000);await s.settleAll();
 assert.equal(s.session.active,false);
 const seg=s.segs()[0];
 assert(s.files.has(seg+'/audio.ogg'),'测试模式也封 OGG');
 assert(s.files.has(seg+'/audio.wav'),'测试模式保留 WAV 校验');
 assert.equal(s.files.get(seg+'/audio.wav').length,44+2*1920);
 assert.equal(readOggOpusFrames(s.files.get(seg+'/audio.ogg')).length,2);
});

test('day mode segments align to clock boundaries (meeting friendly)',async()=>{
 const now=Date.parse('2026-10-15T03:17:21.000Z'),s=setup(10,now);
 s.session.setClockAlign(30);
 const boundary=(Math.floor(now/1800000)+1)*1800000;
 await s.session.start('day');
 const t=[...s.timers.values()].find(x=>x.ms>0&&x.ms!==3000);
 assert(t,'已排定轮转定时器');
 const expected=Math.max(1000,boundary-now);
 assert.equal(t.ms,expected,'轮转应精确贴近下一30分钟刻度，避免宿主调度延迟影响断言');
});

test('empty segments are recycled instead of left as broken rows',async()=>{
 const s=setup(0.02);
 await s.session.start('day');
 const first=s.segs()[0];
 assert.equal(s.segs().length,1);
 s.fireRotate();await s.settleAll();
 assert.equal(s.segs().length,1,'空段被回收，仅保留新段');
 assert.equal(s.dirs.has(first),false,'旧空段目录已删除');
 assert.equal(s.session.items.length,1,'只剩当前在录的段，且标记为接收中');
 assert.equal(s.session.items[0].complete,false);
 assert.equal(s.session.items[0].note,'等待眼镜音频');
});

test('daily merge builds absolute timeline from transcript.json and writes a day file',async()=>{
 const s=setup();
 await s.session.start('test');
 await s.feed(161,{});
 const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:2},new Uint8Array(480).fill(7));
 s.fire(25000);await s.settleAll();
 s.fire(3000);await s.settleAll();
 const seg=s.segs()[0];
 const started=Date.now()-180000;
 s.files.set(seg+'/meta.json',new TextEncoder().encode(JSON.stringify({version:1,started:started,ended:started+120000,frames:2000,seconds:120})));
 s.files.set(seg+'/transcript.json',new TextEncoder().encode(JSON.stringify({started:started,seconds:120,speechSeconds:5,utterances:[{start:1.5,end:6.5,text:'测试句子',lang:'zh',speaker:-1}]})));
 s.files.set(seg+'/text.md',new TextEncoder().encode('# 智记'));
 s.session.refresh();
 assert.equal(s.session.dayItems(0).length,1,'今天的分段可枚举');
 const rendered=s.session.dayText(0,'这是总结');
 assert(rendered.markdown.indexOf('AI 总结')>=0);
 assert(rendered.markdown.indexOf('这是总结')>=0);
 assert(rendered.markdown.indexOf('测试句子')>=0);
 assert(rendered.markdown.indexOf('已转写 1/1 段')>=0);
 const when=new Date(started+1500);
 const p=(n)=>(n<10?'0':'')+n;
 const stamp=`${p(when.getHours())}:${p(when.getMinutes())}:${p(when.getSeconds())}`;
 assert(rendered.markdown.indexOf(`[${stamp}]`)>=0,'绝对时间戳已生成');
 assert.equal(rendered.transcribed,1);
 assert.equal(rendered.total,1);
 const path=s.session.saveDayFile(0,rendered.markdown);
 assert(s.files.has(path),'汇总文件已写入沙盒');
 assert(new TextDecoder().decode(s.files.get(path)).indexOf('测试句子')>=0);
});

test('daily merge marks untranscribed segments instead of failing',async()=>{
 const s=setup();
 await s.session.start('test');
 await s.feed(161,{});
 const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:2},new Uint8Array(480).fill(7));
 s.fire(25000);await s.settleAll();
 s.fire(3000);await s.settleAll();
 s.session.refresh();
 const rendered=s.session.dayText(0);
 assert(rendered.markdown.indexOf('尚未转写')>=0);
 assert.equal(rendered.transcribed,0);
 assert.equal(rendered.total,1);
});

test('定时窗口判定：普通区间与跨零点，参数校验',async()=>{
 const s=setup();
 await s.session.applySchedule(true,'09:00','18:00');
 const at=(h,m)=>{const d=new Date();d.setHours(h,m,0,0);return d;};
 assert.equal(s.session.inWindow(at(9,0)),true);
 assert.equal(s.session.inWindow(at(12,30)),true);
 assert.equal(s.session.inWindow(at(17,59)),true);
 assert.equal(s.session.inWindow(at(18,0)),false,'结束时刻即出窗');
 assert.equal(s.session.inWindow(at(8,59)),false);
 await s.session.applySchedule(true,'22:00','06:00');
 assert.equal(s.session.inWindow(at(23,0)),true,'跨零点窗口内');
 assert.equal(s.session.inWindow(at(3,0)),true);
 assert.equal(s.session.inWindow(at(12,0)),false);
 await assert.rejects(()=>s.session.applySchedule(true,'9:00','18:00'),/HH:mm/);
 await assert.rejects(()=>s.session.applySchedule(true,'09:00','09:00'),/不能相同/);
 await s.session.applySchedule(false,'09:00','18:00');
 assert.equal(s.session.inWindow(at(12,0)),false,'关闭后不再判定窗口');
 assert.equal(s.session.scheduleEnabled,false);
});

test('空段不进列表、单独计数，可一键清理且不动正在收音的段',async()=>{
 const s=setup();
 await s.session.start('day');
 const active=s.segs()[0];
 const ghost=s.root+'/seg-'+'0'.repeat(32);
 s.dirs.add(ghost);
 s.session.refresh();
 assert.equal(s.session.items.filter((i)=>i.name.indexOf('0000')>=0).length,0,'空段不出现在列表');
 assert(s.session.emptySegments>=1,'空段被单独计数');
 const removed=s.session.purgeEmpty();
 assert(removed>=1);
 assert.equal(s.dirs.has(ghost),false,'空段目录已删除');
 assert.equal(s.dirs.has(active),true,'正在收音的段不受影响');
 assert.equal(s.session.emptySegments,0);
});

test('删除单段会清掉该段全部文件',async()=>{
 const s=setup();
 await s.session.start('test');
 await s.feed(161,{});
 const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:2},new Uint8Array(480).fill(7));
 s.fire(25000);await s.settleAll();
 s.fire(3000);await s.settleAll();
 s.session.refresh();
 const item=s.session.items[0];
 assert(item,'有可删除的分段');
 s.session.remove(item);
 assert.equal(s.session.items.length,0);
 assert.equal(s.dirs.has(s.root+'/'+item.name),false);
});

test('段落封口时通知自动转写钩子，关闭后不再通知',async()=>{
 const s=setup(0.02);
 const calls=[];
 s.session.onSegmentClosed=(dir,ogg,started)=>{calls.push({dir,ogg,started});};
 await s.session.start('day');
 await s.feed(161,{});
 const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:2},new Uint8Array(480).fill(7));
 s.fireRotate();await s.settleAll();
 assert.equal(calls.length,1,'轮转后应通知一次');
 assert(calls[0].ogg.endsWith('/audio.ogg'),'通知带 OGG 路径');
 assert(calls[0].started>0,'通知带段落开始时间');
 s.session.setAutoTranscribe(false);
 await s.feed(163,{taskId,frameCount:2},new Uint8Array(480).fill(8));
 s.fireRotate();await s.settleAll();
 assert.equal(calls.length,1,'关闭自动转写后不再通知');
 assert.equal(s.session.autoTranscribe,false);
});

test('回归：全天模式停止时不走 WAV 解码，不再误报封装失败',async()=>{
 const s=setup();
 await s.session.start('day');
 await s.feed(161,{});
 const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:2},new Uint8Array(480).fill(7));
 await s.session.stop('手动结束');
 s.fire(3000);await s.settleAll();
 assert.equal(s.session.active,false);
 assert(s.session.note.indexOf('封装失败')<0,`不应出现封装失败，实际：${s.session.note}`);
 const seg=s.segs()[0];
 assert(s.files.has(seg+'/audio.ogg'),'OGG 已封口');
 assert.equal(s.files.has(seg+'/audio.wav'),false,'全天模式不产 WAV');
});

test('删除与清理会给出明确提示',async()=>{
 const s=setup();
 await s.session.start('test');
 await s.feed(161,{});
 const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:2},new Uint8Array(480).fill(7));
 s.fire(25000);await s.settleAll();
 s.fire(3000);await s.settleAll();
 s.session.refresh();
 s.session.remove(s.session.items[0]);
 assert.equal(s.session.note,'已删除 1 段');
 s.session.purgeEmpty();
 assert(s.session.note.indexOf('清理')>=0||s.session.note.indexOf('没有')>=0,`清理提示：${s.session.note}`);
});

test('音频留存：文字不能代替备份核验，显式授权后才清理原音',async()=>{
 const s=setup();
 const day=new Date();day.setHours(0,0,0,0);
 const old=day.getTime()-5*86400000;
 const name='seg-'+'a'.repeat(32);
 s.dirs.add(s.root+'/'+name);
 s.files.set(s.root+'/'+name+'/audio.ogg',new Uint8Array(2048).fill(1));
 s.files.set(s.root+'/'+name+'/meta.json',new TextEncoder().encode(JSON.stringify({version:1,started:old,ended:old+60000,frames:1000,seconds:60})));
 s.files.set(s.root+'/'+name+'/text.md',new TextEncoder().encode('# 已转写'));
 s.session.refresh();
 assert.equal(s.session.pruneAudio(3),0);
 assert(s.files.has(s.root+'/'+name+'/audio.ogg'),'仅有文字时默认保留原音');
 const pruned=s.session.pruneAudio(3,()=>true);
 assert.equal(pruned,1);
 assert.equal(s.files.has(s.root+'/'+name+'/audio.ogg'),false,'过期音频已删除');
 assert.equal(s.files.has(s.root+'/'+name+'/text.md'),true,'文字保留');
 assert.equal(s.files.has(s.root+'/'+name+'/meta.json'),true,'元数据保留');
 assert.equal(s.session.items.length,1);assert.equal(s.session.items[0].bytes,0);assert(s.session.items[0].hasText);
 assert.match(s.session.readText(s.session.items[0]),/已转写/);assert.equal(s.session.purgeEmpty(),0);
 s.session.refresh();assert.equal(s.session.items.length,1);assert.throws(()=>s.session.file(s.session.items[0],'ogg'),/音频已清理/);
});

test('Ability disposal stops scheduled capture timers without changing saved user intent',async()=>{
 const s=setup();await s.session.applySchedule(true,'09:00','18:00');
 const preferences=new Uint8Array(s.files.get(s.root+'/schedule.json'));
 s.session.dispose();assert.equal(s.timers.size,0);
 assert.deepEqual(s.files.get(s.root+'/schedule.json'),preferences);
});

test('音频留存：过期的未转写分段不动音频，避免丢数据',async()=>{
 const s=setup();
 const day=new Date();day.setHours(0,0,0,0);
 const old=day.getTime()-9*86400000;
 const name='seg-'+'b'.repeat(32);
 s.dirs.add(s.root+'/'+name);
 s.files.set(s.root+'/'+name+'/audio.ogg',new Uint8Array(2048).fill(1));
 s.files.set(s.root+'/'+name+'/meta.json',new TextEncoder().encode(JSON.stringify({version:1,started:old,ended:old+60000,frames:1000,seconds:60})));
 s.session.refresh();
 assert.equal(s.session.pruneAudio(3),0);
 assert.equal(s.files.has(s.root+'/'+name+'/audio.ogg'),true,'未转写的音频必须保留');
});

test('recording handoff seals queued tail audio, preserves day intent and resumes automatically',async()=>{
 const s=setup(),closed=[];s.session.onSegmentClosed=(dir)=>closed.push(dir);
 await s.session.start('day');assert.equal(s.session.capturePhase,'waiting-wake');
 await s.feed(161,{});assert.equal(s.session.capturePhase,'waiting-audio');const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:1},new Uint8Array(240).fill(7));assert.equal(s.session.capturePhase,'receiving');
 let resolved=false;const pending=s.session.suspendForRecording().then(()=>resolved=true);await s.settleAll();
 assert.equal(resolved,false);assert(s.dayFlag());assert.equal(s.session.capturePhase,'stopping');
  await s.feed(163,{taskId,frameCount:1},new Uint8Array(240).fill(8));await s.feed(165,{rc:0});s.fire(3000);await s.settleAll();await pending;
 assert(!s.session.active);assert(s.dayFlag());assert.equal(s.session.capturePhase,'recording');assert.equal(closed.length,1);
 assert.equal(readOggOpusFrames(s.files.get(closed[0]+'/audio.ogg')).length,2);
 await s.session.connected();assert(!s.session.active,'connection callbacks cannot steal microphone');
 await s.session.resumeAfterRecording();assert(s.session.active);assert(s.dayFlag());assert.equal(s.session.capturePhase,'waiting-wake');
});
test('empty waiting session can hand off; disabling day during recording prevents automatic resume',async()=>{
  const s=setup();await s.session.start('day');const pending=s.session.suspendForRecording();await s.settleAll();await s.feed(165,{rc:0});s.fire(3000);await s.settleAll();await pending;
 assert.equal(s.session.items.length,0);assert(s.dayFlag());await s.session.stopDay();await s.session.resumeAfterRecording();assert(!s.session.active);assert(!s.dayFlag());
});
test('AI suspension has its own owner; unrelated recording completion cannot resume its microphone',async()=>{
  const s=setup();await s.session.start('day');const pending=s.session.suspendForVoice();await s.settleAll();await s.feed(165,{rc:0});s.fire(3000);await s.settleAll();await pending;
 assert.equal(s.session.capturePhase,'voice');await s.session.resumeAfterRecording();assert(!s.session.active);assert.equal(s.session.capturePhase,'voice');
 await s.session.resumeAfterVoice();assert(s.session.active);
});
test('cancelled handoff waits for sealing then resumes rather than leaving day intent inactive',async()=>{
 const s=setup();await s.session.start('day');const pending=s.session.suspendForVoice();await s.settleAll();const resumed=s.session.resumeAfterVoice();await s.settleAll();assert.equal(s.session.capturePhase,'stopping');
  await s.feed(165,{rc:0});s.fire(3000);await s.settleAll();await pending;await resumed;assert(s.session.active);assert.equal(s.session.capturePhase,'waiting-wake');assert(s.dayFlag());
});
test('real launcher envelope detects negative switch response; missing status is never rejection',async()=>{
 for(const value of [undefined,0,1]){
  const s=setup();await s.session.start('day');s.session.receiveLauncher(packet(21,{cmd:'life_log_switch_result',payload:{value}}));
  assert.equal(s.session.active,value!==1);if(value===1)assert.match(s.session.note,/麦克风权限/);
 }
});
test('header-only failed OGG is hidden and never queued for transcription',async()=>{
 const s=setup();await s.session.start('day');const dir=s.segs()[0];s.session.receiveLauncher(packet(21,{cmd:'life_log_switch_result',payload:{value:2}}));
 assert(!s.session.active);assert(s.files.has(dir+'/audio.ogg'));assert.equal(s.session.items.length,0);assert.equal(s.session.emptySegments,1);
});
test('segment transcript saves reject traversal and write both durable files',async()=>{
 const s=setup();await s.session.start('day');const dir=s.segs()[0];
 assert.throws(()=>s.session.saveSegmentResult(s.root+'/../outside','text','{}'),/标识/);
 s.session.saveSegmentResult(dir,'# 保存的文字','{"utterances":[]}');assert.equal(new TextDecoder().decode(s.files.get(dir+'/text.md')),'# 保存的文字');assert(s.files.has(dir+'/transcript.json'));
});

test('capture intent is durable before ON and A2; the cleanup identity survives ordinary day rearm',async()=>{
 const s=setup();s.onSend(entry=>{const saved=s.ledger();assert.equal(saved.peer,peer);assert.equal(saved.session,s.session.cleanupSessionId);assert.equal(saved.evidence,'none');});
 await s.session.start('day');const id=s.session.cleanupSessionId;assert.match(id,/^life-[a-f0-9]{32}$/);
 await s.feed(161,{});const first=s.a2().body.taskId;await s.feed(165,{rc:0});await s.feed(161,{});
 assert.notEqual(s.a2().body.taskId,first);assert.equal(s.ledger().session,id);assert.equal(s.session.cleanupSessionId,id);
 assert.deepEqual(Object.keys(s.ledger()).sort(),['evidence','peer','schema','session']);
});
test('intent persistence failure sends nothing and retains a fail-closed cleanup obligation',async()=>{
 const s=setup();s.failCleanup(true);await assert.rejects(s.session.start('day'),/退出记录保存失败/);
 assert.equal(s.sent.length,0);assert(s.session.cleanupRequired);assert(s.session.occupied);assert.equal(s.session.canConfirmExited,false);
 assert(s.files.has('/private-test/lifelog-cleanup.json.partial'));
});
for(const owner of ['recording','voice'])test(`${owner} handoff rejects a local three-second seal without device exit`,async()=>{
 const s=setup();await s.session.start('day');await s.feed(161,{});const id=s.a2().body.taskId;
 const pending=owner==='recording'?s.session.suspendForRecording():s.session.suspendForVoice();const rejected=assert.rejects(pending,/退出未确认/);
 await s.settleAll();await s.feed(163,{taskId:id,frameCount:1},new Uint8Array(240).fill(7));s.fire(3000);await s.settleAll();await rejected;
 assert.equal(s.session.active,false);assert(s.session.occupied);assert(s.session.cleanupRequired);assert(s.dayFlag());
 await assert.rejects(s.session.suspendForRecording(),/退出尚未确认/);assert.equal(s.ledger().evidence,'none');
});
test('a valid device exit cannot release the lease until the queued tail has been sealed',async()=>{
 const s=setup();await s.session.start('day');let done=false;const pending=s.session.suspendForVoice().then(()=>done=true);
 await s.settleAll();await s.feed(165,{rc:0});assert.equal(done,false);assert(s.session.occupied);
 s.fire(3000);await s.settleAll();await pending;assert.equal(done,true);assert.equal(s.session.cleanupRequired,false);assert.equal(s.session.occupied,false);
 assert.equal(s.ledger().evidence,'device_event');assert.equal(s.session.capturePhase,'voice');
});
test('a held native stop write cannot postpone local sealing or authorize a handoff',async()=>{
 const s=setup();await s.session.start('day');let release;s.onSend(entry=>entry.type===166?new Promise(r=>release=r):undefined);
 const pending=s.session.suspendForRecording(),rejected=assert.rejects(pending,/发送尚未排空/);await s.settleAll();
 await s.feed(165,{rc:0});s.fire(3000);await s.settleAll();await rejected;
 assert.equal(s.session.active,false);assert(s.session.pendingWrites);assert(s.session.occupied);assert.equal(s.session.canConfirmExited,false);
 assert.equal(s.ledger().evidence,'none');assert(s.create().cleanupRequired,'a crash during the held native write must restore cleanup, not terminal evidence');
 assert.throws(()=>s.session.confirmExited(s.session.cleanupSessionId),/等待本段封口与发送结束/);
 release();await s.settleAll();assert.equal(s.session.pendingWrites,false);assert.equal(s.session.occupied,false);assert.equal(s.ledger().evidence,'device_event');
});
for(const failure of ['exit','guide','switch'])test(`${failure} stop failure is visible, all remaining stop writes are attempted and handoff stays blocked`,async()=>{
 const s=setup();await s.session.start('day');s.onSend(entry=>{
  if(failure==='exit'&&entry.type===166||failure==='guide'&&entry.body.cmd==='life_log_guide'&&entry.body.payload.value===0||failure==='switch'&&entry.body.cmd==='life_log_switch'&&entry.body.payload.value===0)throw Error('synthetic-exit-write-failed');
 });
 const pending=s.session.suspendForVoice(),rejected=assert.rejects(pending,/退出指令未提交完整/);await s.settleAll();await rejected;
 await s.feed(165,{rc:0});s.fire(3000);await s.settleAll();assert(s.session.occupied);assert(s.session.cleanupRequired);assert.equal(s.session.pendingWrites,false);
 assert.equal(s.sent.filter(x=>x.type===166).length,1);assert.equal(s.sent.filter(x=>x.body.payload?.value===0).length,2);assert.equal(s.ledger().evidence,'none');
});
test('duplicate stop calls share one exit attempt rather than submitting duplicate OFF commands',async()=>{
 const s=setup();await s.session.start('day');let release;s.onSend(entry=>entry.type===166?new Promise(r=>release=r):undefined);
 const first=s.session.stop(),second=s.session.stop();await s.settleAll();assert.equal(s.sent.filter(x=>x.type===166).length,1);
 release();await Promise.all([first,second]);assert.equal(s.sent.filter(x=>x.body.payload?.value===0).length,2);
});
test('missing, invalid, foreign-task and pre-stop A5 packets cannot serve as exit confirmation',async()=>{
 const s=setup();await s.session.start('day');await s.feed(161,{});
 // Arrives before the stop request, but its processing is queued behind it.
 s.session.receive(peer,packet(165,{rc:0}));const stopped=s.session.stop();await stopped;await s.settleAll();
 for(const body of [{},{rc:1},{rc:'0'},{rc:0,taskId:'foreign-round'}])await s.feed(165,body);
 s.fire(3000);await s.settleAll();assert(s.session.cleanupRequired);assert.equal(s.ledger().evidence,'none');
});
test('OFF request success and unbound switch-state reports are not independent device-exit proof',async()=>{
 const s=setup();await s.session.start('day');await s.session.stop();
 for(const cmd of ['life_log_switch_result','life_log_switch'])s.session.receiveLauncher(packet(21,{cmd,payload:{value:0}}));
 s.fire(3000);await s.settleAll();assert(s.session.occupied);assert.equal(s.ledger().evidence,'none');
});
test('disconnect retains cleanup and day intent; reconnect rejects old ACK and never replays ON',async()=>{
 const s=setup();await s.session.start('day');await s.session.stop('pause',true);s.session.disconnected();s.fail();await s.settleAll();const n=s.sent.length;
 s.session.receive(peer,packet(165,{rc:0}));s.online();await s.session.connected();await s.feed(165,{rc:0});
 assert.equal(s.sent.length,n);assert(s.session.cleanupRequired);assert(s.dayFlag());assert.equal(s.session.active,false);
 await assert.rejects(s.session.start('day'),/清理上次/);
});
test('cold restore is cleanup-only and preserved scheduled/day intent cannot reopen its microphone',async()=>{
 const s=setup();await s.session.start('day');const id=s.session.cleanupSessionId,n=s.sent.length,day=s.files.get(s.root+'/day.json').slice();
 const restored=s.create();assert.equal(restored.cleanupSessionId,id);assert(restored.occupied);assert.equal(restored.active,false);
 await restored.connected();restored.receive(peer,packet(161,{}));restored.receive(peer,packet(165,{rc:0}));await s.settleAll();await restored.scheduleTick();
 assert.equal(s.sent.length,n);assert(restored.cleanupRequired);assert.deepEqual(s.files.get(s.root+'/day.json'),day);
});
test('legacy saved day intent without a cleanup ledger also requires an explicit new start after restart',async()=>{
 const s=setup();s.files.set(s.root+'/day.json',new TextEncoder().encode('{"enabled":true}'));const restored=s.create();
 await restored.connected();await restored.scheduleTick();assert.equal(s.sent.length,0);assert(restored.dayEnabled);assert.equal(restored.active,false);
});
test('explicit cleanup only targets the original connected peer and matching new exit settles the same identity',async()=>{
 const s=setup();await s.session.start('day');s.session.disconnected();s.fail();const id=s.session.cleanupSessionId,n=s.sent.length;
 await assert.rejects(s.session.cleanup(),/原眼镜/);s.online();s.setPeer('foreign-peer');await s.session.connected();
 await assert.rejects(s.session.cleanup(),/原眼镜/);assert.throws(()=>s.session.confirmExited(id),/原眼镜/);assert.equal(s.sent.length,n);
 s.setPeer(peer);await s.session.connected();await s.session.cleanup();assert.equal(s.session.cleanupSessionId,id);
 await s.feed(165,{rc:0});assert.equal(s.session.cleanupRequired,false);assert.equal(s.ledger().evidence,'device_event');assert.equal(s.session.active,false);
});
test('manual exit confirmation is bound to the cleanup identity and stays distinct from a device event',async()=>{
 const s=setup();await s.session.start('day');await s.session.stop();s.fire(3000);await s.settleAll();const id=s.session.cleanupSessionId;
 assert.equal(s.session.canConfirmExited,true);assert.throws(()=>s.session.confirmExited('life-'+'f'.repeat(32)),/当前智记退出请求/);
 s.session.confirmExited(id);assert.equal(s.ledger().evidence,'user_confirmation');assert.equal(s.session.cleanupRequired,false);assert.equal(s.session.active,false);
 assert.throws(()=>s.session.confirmExited(id),/当前智记退出请求/);
});
test('failed exit-evidence persistence preserves occupancy and the original pending journal',async()=>{
 const s=setup();await s.session.start('day');await s.session.stop();await s.feed(165,{rc:0});const original=s.files.get('/private-test/lifelog-cleanup.json').slice();
 s.failCleanup(true);s.fire(3000);await s.settleAll();assert(s.session.occupied);assert(s.session.cleanupRequired);assert.equal(s.session.canConfirmExited,false);
 assert.deepEqual(s.files.get('/private-test/lifelog-cleanup.json'),original);assert.equal(s.create().cleanupRequired,true);
});
test('corrupt, empty, partial and unknown cleanup schemas block capture without overwriting evidence',async()=>{
 for(const raw of ['', '{','{}',JSON.stringify({schema:2,peer,session:'life-'+'a'.repeat(32),evidence:'none'})]){
  const s=setup(),path='/private-test/lifelog-cleanup.json';s.files.set(path,new TextEncoder().encode(raw));const restored=s.create();
  assert(restored.occupied);await assert.rejects(restored.start('day'),/清理上次/);assert.equal(s.sent.length,0);assert.equal(new TextDecoder().decode(s.files.get(path)),raw);
 }
 const s=setup();s.files.set('/private-test/lifelog-cleanup.json.partial',new TextEncoder().encode('incomplete'));assert(s.create().cleanupRequired);
});
test('late audio after sealing or on a replacement connection cannot append to the original saved audio',async()=>{
 const s=setup();await s.session.start('day');await s.feed(161,{});const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:1},new Uint8Array(240).fill(7));await s.session.stop();s.fire(3000);await s.settleAll();
 const dir=s.segs()[0],saved=s.files.get(dir+'/audio.ogg').slice();await s.feed(163,{taskId,frameCount:1},new Uint8Array(240).fill(9));
 assert.deepEqual(s.files.get(dir+'/audio.ogg'),saved);assert(s.session.cleanupRequired);
 s.session.disconnected();await s.session.connected();await s.feed(161,{});assert.deepEqual(s.files.get(dir+'/audio.ogg'),saved);
});
test('stopping during an ON write drains it but never submits its stale second ON',async()=>{
 const s=setup();let release;s.onSend(entry=>entry.body.cmd==='life_log_guide'&&entry.body.payload.value===1?new Promise(r=>release=r):undefined);
 const started=s.session.start('day'),rejected=assert.rejects(started,/变化/);await s.settleAll();const stopped=s.session.stop('cancel start',true);
 s.fire(3000);await s.settleAll();assert(s.session.pendingWrites);release();await rejected;await stopped;await s.settleAll();
 assert.equal(s.sent.filter(x=>x.body.cmd==='life_log_switch'&&x.body.payload.value===1).length,0);assert(s.session.cleanupRequired);
});
test('foreign authenticated peers cannot supply A5 confirmation for the original cleanup',async()=>{
 const s=setup();await s.session.start('day');await s.session.stop();s.session.receive('foreign-peer',packet(165,{rc:0}));
 s.fire(3000);await s.settleAll();assert(s.session.cleanupRequired);assert.equal(s.ledger().evidence,'none');
});
test('a queued A5 from a prior stop attempt cannot settle an explicit cleanup retry',async()=>{
 const s=setup();await s.session.start('day');await s.session.stop();s.fire(3000);await s.settleAll();
 s.session.receive(peer,packet(165,{rc:0}));await s.session.cleanup();await s.settleAll();
 assert(s.session.cleanupRequired);assert.equal(s.ledger().evidence,'none');
 await s.feed(165,{rc:0});assert.equal(s.session.cleanupRequired,false);assert.equal(s.ledger().evidence,'device_event');
});
test('duplicate cleanup during a held native write never submits an additional exit attempt',async()=>{
 const s=setup();await s.session.start('day');s.session.disconnected();await s.session.connected();let release;
 s.onSend(entry=>entry.type===166?new Promise(r=>release=r):undefined);const first=s.session.cleanup();await s.settleAll();
 await assert.rejects(s.session.cleanup(),/等待当前发送结束/);assert.equal(s.sent.filter(x=>x.type===166).length,1);
 release();await first;assert.equal(s.session.cleanupRequired,true);assert.equal(s.session.pendingWrites,false);
});
test('an early A5 cannot cancel the independent cleanup deadline or commit terminal evidence during a held native write',async()=>{
 const s=setup();await s.session.start('day');s.session.disconnected();await s.session.connected();let release;
 s.onSend(entry=>entry.type===166?new Promise(r=>release=r):undefined);const work=s.session.cleanup(),rejected=assert.rejects(work,/8.5秒超时/);
 await s.settleAll();await s.feed(165,{rc:0});assert.equal(s.ledger().evidence,'none');assert(s.session.pendingWrites);
 s.fire(8500);await s.settleAll();await rejected;assert(s.session.cleanupRequired);assert(s.session.pendingWrites);assert(s.create().cleanupRequired);
 release();await s.settleAll();assert.equal(s.session.pendingWrites,false);assert.equal(s.ledger().evidence,'device_event');
});
test('handoff has its own deadline even if local tail decoding has not finished',async()=>{
 const s=setup();await s.session.start('test');await s.feed(161,{});const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:1},new Uint8Array(240).fill(7));let release;
 s.session.decodeSegment=()=>new Promise(r=>release=r);
 const work=s.session.suspendForRecording(),rejected=assert.rejects(work,/交接8.5秒超时/);await s.settleAll();await s.feed(165,{rc:0});
 s.fire(3000);await s.settleAll();s.fire(8500);await s.settleAll();await rejected;
 assert(s.session.occupied);assert.equal(s.ledger().evidence,'none');release(0);await s.settleAll();assert.equal(s.session.cleanupRequired,false);
});
test('disconnect rejects an explicit cleanup wait and discards an early volatile A5 while native work remains pending',async()=>{
 const s=setup();await s.session.start('day');s.session.disconnected();await s.session.connected();let release;
 s.onSend(entry=>entry.type===166?new Promise(r=>release=r):undefined);const work=s.session.cleanup(),rejected=assert.rejects(work,/连接中断/);
 await s.settleAll();await s.feed(165,{rc:0});s.session.disconnected();await rejected;
 assert.equal([...s.timers.values()].some(t=>t.ms===8500),false);assert.equal(s.ledger().evidence,'none');
 release();await s.settleAll();assert.equal(s.session.pendingWrites,false);assert(s.session.cleanupRequired);assert.equal(s.ledger().evidence,'none');
});
test('a timed-out cleanup completion cannot cancel the deadline of a newer explicit retry',async()=>{
 const s=setup();await s.session.start('day');s.session.disconnected();await s.session.connected();let releaseFirst,releaseSecond,attempt=0,retry,retryRejected;
 s.onSend(entry=>{if(entry.type===166)return new Promise(r=>{if(++attempt===1)releaseFirst=r;else releaseSecond=r;});});
 const first=s.session.cleanup(),firstRejected=assert.rejects(first,/8.5秒超时/);await s.settleAll();s.fire(8500);await firstRejected;
 let launched=false;s.session.changed=()=>{
  if(!launched&&s.session.cleanupRequired&&!s.session.pendingWrites){launched=true;retry=s.session.cleanup();retryRejected=assert.rejects(retry,/8.5秒超时/);}
 };
 releaseFirst();await s.settleAll();assert(launched);assert(s.session.pendingWrites);assert([...s.timers.values()].some(t=>t.ms===8500));
 s.fire(8500);await retryRejected;assert(s.session.cleanupRequired);releaseSecond();await s.settleAll();assert.equal(s.session.pendingWrites,false);
});
for(const completion of ['resolve','reject'])test(`old finalizer ${completion} after a replacement capture cannot fail or stop the new generation`,async()=>{
 const s=setup();await s.session.start('test');await s.feed(161,{});const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:1},new Uint8Array(240).fill(7));let complete;
 s.session.decodeSegment=()=>new Promise((resolve,reject)=>complete=()=>completion==='resolve'?resolve(0):reject(Error('synthetic-old-decode-failed')));
 await s.session.stop();s.fire(3000);await s.settleAll();assert.equal(typeof complete,'function');
 s.session.disconnected();await s.session.connected();const originalId=s.session.cleanupSessionId;s.session.confirmExited(originalId);
 await s.session.start('day');const replacementId=s.session.cleanupSessionId,n=s.sent.length,note=s.session.note;
 complete();await s.settleAll();assert.equal(s.session.active,true);assert.equal(s.session.cleanupSessionId,replacementId);
 assert.equal(s.session.note,note);assert.equal(s.sent.length,n);assert.equal(s.ledger().session,replacementId);
});
test('actual yielding native decode retains local occupancy until its finally has closed the old decoder',async()=>{
 const s=setup();await s.session.start('test');await s.feed(161,{});const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:1},new Uint8Array(240).fill(7));const dir=s.segs()[0];
 await s.session.stop();s.fire(3000);await settle();assert([...s.timers.values()].some(t=>t.ms===0),'actual decode is paused at its cooperative yield');
 s.session.disconnected();await s.session.connected();s.session.confirmExited(s.session.cleanupSessionId);
 assert.equal(s.session.cleanupRequired,false);assert.equal(s.session.occupied,true,'local decoder still owns the native resource after physical exit confirmation');
 await assert.rejects(s.session.suspendForVoice(),/解码收尾/);await assert.rejects(s.session.suspendForRecording(),/解码收尾/);
 await assert.rejects(s.session.start('day'),/解码收尾/);
 s.fire(0);await s.settleAll();assert.equal(s.session.occupied,false);assert.equal(s.files.has(dir+'/audio.wav'),false,'cancelled old decode must not publish a WAV');
 assert(s.files.has(dir+'/source.opus'));await s.session.start('day');const id=s.session.cleanupSessionId,note=s.session.note,n=s.sent.length;
 await s.settleAll();assert(s.session.active);assert.equal(s.session.cleanupSessionId,id);assert.equal(s.session.note,note);assert.equal(s.sent.length,n);
});
test('a current-generation finalizer failure still closes its local capture and preserves cleanup debt',async()=>{
 const s=setup();await s.session.start('test');await s.feed(161,{});const taskId=s.a2().body.taskId;
 await s.feed(163,{taskId,frameCount:1},new Uint8Array(240).fill(7));
 s.session.decodeSegment=async()=>{throw Error('synthetic-current-decode-failed');};await s.session.stop();s.fire(3000);await s.settleAll();
 assert.equal(s.session.active,false);assert(s.session.cleanupRequired);assert(s.session.occupied);assert.match(s.session.note,/封装失败/);
});
