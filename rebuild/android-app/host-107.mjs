import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const HOST=Object.freeze({version:'1.0.7',code:230,sha256:'30239f65d910cf7008cfdf6cfacd5c068c5877068b4a637027786377a9ce4f91',listener:'Lq8/c$c;',event:'Lcom/rayneo/rayneo_venus_sdk_plugin/j;',manager:'LY3/u;',message:'LY3/S;',queue:'LY3/V;'});
export function classFile(root,descriptor){
 if(!/^L[A-Za-z0-9_$/]+;$/.test(descriptor))throw new Error('Invalid class descriptor');
 const relative=descriptor.slice(1,-1),folder=path.dirname(relative),stem=path.basename(relative).toLowerCase();const matches=[];
 for(const dex of fs.readdirSync(root).filter(n=>/^smali(?:_classes\d+)?$/.test(n))){
  let dirs=[path.join(root,dex)];
  for(const part of folder.split(/[\\/]/))dirs=dirs.flatMap(dir=>fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()&&(e.name.toLowerCase()===part.toLowerCase()||e.name.toLowerCase().startsWith(part.toLowerCase()+'.'))).map(e=>path.join(dir,e.name)));
  for(const dir of dirs)for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.smali')&&f.toLowerCase().startsWith(stem))){
    const full=path.join(dir,f);const head=fs.readFileSync(full,'utf8').split(/\r?\n/,5);
    if(head.some(s=>s.startsWith('.class ')&&s.endsWith(' '+descriptor)))matches.push(full);
  }
 }
 if(matches.length!==1)throw new Error('Expected exactly one class '+descriptor+', got '+matches.length);
 return matches[0];
}
export function verifyHost(root){
 const proofs=[];
 const check=(descriptor,required)=>{const file=classFile(root,descriptor),text=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');for(const line of required)if(!text.split('\n').includes(line))throw new Error('ABI mismatch '+descriptor+' '+line);proofs.push({descriptor,file:path.relative(root,file),required});return file;};
 check('Ly8/d;',['.field public static volatile b:Lio/flutter/embedding/engine/a;']);
 check('Lio/flutter/embedding/engine/a;',['.field public final d:Lfa/d;']);
 check('Lfa/d;',['.field public final a:Ljava/util/HashMap;']);
 check('Lg7/q;',['.field public final d:Ljava/util/HashMap;']);
 check('Lg7/o;',['.method public final x()Ljava/util/HashMap;']);
 check('Lcom/rayneo/rayneo_venus_sdk_plugin/f;',['.field public final A:Lcom/rayneo/rayneo_venus_sdk_plugin/j;']);
 const listener=check(HOST.listener,['.method public final onAsrResult(Ljava/lang/String;ZLjava/lang/String;)V','.method public final onNlpResult(Lcom/rayneo/airuntime/controller/NlpResult;)V','.method public final onResponseComplete()V']);
 const audio=check('Lcom/rayneo/rayneo_venus_sdk_plugin/e;',['.method public final c(Ljava/lang/String;[B)V']);
 const activity=check('Lcom/rayneo/venus/MainActivity;',['.method public final onPostResume()V']);
 const event=check(HOST.event,['.method public final z(Ljava/lang/String;Ljava/util/Map;)V']);
 const manager=check(HOST.manager,['.field public static volatile h:LY3/u;','.method public static g()Ljava/util/List;','.method public final t(LY3/S;Lkotlin/jvm/functions/Function2;)V','.method public final u(Ljava/io/File;Ljava/lang/String;Lk4/q;Ljava/lang/String;)Ljava/lang/String;']);
 const queue=check(HOST.queue,['.method public static o(LY3/S;)V']);
 check(HOST.message,['.field public final b:Ljava/lang/String;','.field public final c:Lj4/h;','.field public final e:[B','.field public k:Lkotlin/jvm/functions/Function2;','.method public constructor <init>([BLjava/lang/String;Ljava/lang/String;Lj4/h;Lj4/Q;LY3/b;ZZLk4/p;Lkotlin/jvm/functions/Function2;)V']);
 for(const [descriptor,values] of [['Lj4/h;',['MARS_FOTA','LAUNCHER','AI_SUBTITLE','TELEPROMPTER']],['LY3/b;',['NORMAL']]]){const f=classFile(root,descriptor),s=fs.readFileSync(f,'utf8');for(const v of values)if(!s.includes('"'+v+'"'))throw new Error('Enum missing '+v);proofs.push({descriptor,file:path.relative(root,f),enum_values:values});}
 for(const [descriptor,lines] of [['LY3/C;',['.method public final b()Z']],['Lk4/q;',['.field public static final enum b:Lk4/q;']]])check(descriptor,lines);
 check('Lcom/rayneo/rayneo_venus_sdk_plugin/j;',['.method public constructor <init>()V','.field public b:Landroid/content/Context;','.field public f:Z','.method public final y(Ljava/lang/String;)LY3/C;','.method public static j(LY3/C;)Ljava/util/Map;',...['H:Lcom/rayneo/rayneo_venus_sdk_plugin/j$f;','I:Lcom/rayneo/rayneo_venus_sdk_plugin/j$e;','K:Lcom/rayneo/rayneo_venus_sdk_plugin/j$h;','J:Lcom/rayneo/rayneo_venus_sdk_plugin/j$g;'].map(s=>'.field public final '+s)]);
 check('Lcom/rayneo/rayneo_venus_sdk_plugin/h;',['.field public static final c:Ljava/util/concurrent/atomic/AtomicBoolean;','.field public static volatile l:Lcom/rayneo/rayneo_venus_sdk_plugin/h$b;','.field public static volatile f:Lm8/n0;','.field public static volatile h:Lkotlin/jvm/functions/Function1;','.field public static volatile i:Lkotlin/jvm/functions/Function1;','.method public static j(Landroid/content/Context;)Z','.method public static k([Lj4/F;[Ljava/lang/String;)Z','.method public static b(Ljava/lang/String;Ljava/lang/String;Z)Z','.method public static d(Ljava/lang/String;Ljava/lang/String;)Z','.method public static e(JLm8/F1;)Z','.method public static o(Ljava/lang/String;)V']);
 check('Lcom/rayneo/rayneo_venus_sdk_plugin/h$b;',['.method public final c(Landroid/content/Context;Lm8/E1;)V']);
 check('LY3/u$a;',['.method public final a()LY3/u;']);
 check('LY3/D;',['.method public static a(Ljava/lang/String;)Ljava/lang/String;','.method public static b(Ljava/lang/String;)Ljava/lang/String;']);
 check('LY3/u;',['.field public static final g:LY3/u$a;','.method public static h()Ljava/util/Map;',...['a','b','c','e'].map(name=>'.field public final '+name+':Lu4/m;')]);
 check('Lu4/m;',['.field public final a:Ljava/util/ArrayList;']);
 check('LY3/N;',['.field public static d:Z','.method public static z()V']);
 check('Lm8/y1;',['.method public synthetic constructor <init>(Lcom/rayneo/rayneo_venus_sdk_plugin/j;I)V','.method public final invoke()Ljava/lang/Object;']);
 check('Lm8/x1;',['.method public synthetic constructor <init>(Lcom/rayneo/rayneo_venus_sdk_plugin/j;I)V','.field public final synthetic b:I','.field public final synthetic c:Lcom/rayneo/rayneo_venus_sdk_plugin/j;']);
 check('Lm8/E1;',['.method public constructor <init>()V']);
 check('Lj4/F;',['.field public static final enum i:Lj4/F;','.field public static final enum h:Lj4/F;']);
 check('Lm8/F1;',['.field public static final enum b:Lm8/F1;']);
 for(const f of [listener,activity,event,queue,manager,audio])if(!path.relative(root,f).startsWith('smali_classes2'+path.sep))throw new Error('Unexpected hook DEX: '+f);
 return {listener,activity,event,manager,queue,audio,proofs};
}

/** Read-only structural guard for a FUTURE wake hook. Not called by build.mjs.
 * These pinned 1.0.7 register/branch anchors intentionally fail on drift. They
 * are not a control-flow verifier, APK signature verification, an exhaustive
 * caller inventory, or evidence of a physical double tap/microphone release.
 * Existing passive e.c observation wrappers are accepted only when they still
 * invoke the separately inspected original exactly once. No file is written.
 */
export function verifyWakeAbi(root){
 const sdk='Lcom/rayneo/rayneo_venus_sdk_plugin/',proto='Lcom/rayneo/airuntime/tansport/proto/TransportMessage$AssistantMsg;';
 const wakeSignature=`(${sdk}o;${sdk}n;Ljava/lang/Integer;)V`,wakeCall=`Lt8/b$b;->j${wakeSignature}`;
 const proofs=[],loaded=new Map();
 const fail=label=>{throw new Error('Wake ABI mismatch: '+label);};
 const lines=text=>text.split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')&&!line.startsWith('.line '));
 const load=(descriptor,dex='smali_classes2')=>{
  if(loaded.has(descriptor))return loaded.get(descriptor);
  const file=classFile(root,descriptor);if(path.relative(root,file).split(path.sep)[0]!==dex)fail(descriptor+' dex');
  const text=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
  const source={descriptor,file:path.relative(root,file),text,lines:lines(text)};loaded.set(descriptor,source);return source;
 };
 const method=(source,header)=>{
  const positions=source.lines.flatMap((line,index)=>line===header?[index]:[]);if(positions.length!==1)fail(source.descriptor+' '+header);
  const start=positions[0],end=source.lines.indexOf('.end method',start+1);if(end<0||source.lines.slice(start+1,end).some(line=>line.startsWith('.method ')))fail(source.descriptor+' method boundary');
  return {source,header,body:source.lines.slice(start+1,end)};
 };
 const block=(m,label,expected)=>{const haystack='\n'+m.body.join('\n')+'\n',needle='\n'+expected.join('\n')+'\n';if(!haystack.includes(needle))fail(label);};
 const ordered=(m,label,expected)=>{let index=-1;for(const line of expected){index=m.body.indexOf(line,index+1);if(index<0)fail(label+' '+line);}};
 const count=(m,label,fragment,n)=>{if(m.body.filter(line=>line.includes(fragment)).length!==n)fail(label);};
 const record=(m,anchors)=>proofs.push({descriptor:m.source.descriptor,file:m.source.file,method:m.header,anchors,normalized_method_sha256:createHash('sha256').update(m.body.join('\n')).digest('hex')});

 const audio=load(sdk+'e;');const originalHeader='.method public final turboioOriginal_c(Ljava/lang/String;[B)V';
 const wrapped=audio.lines.includes(originalHeader);const ingress=method(audio,wrapped?originalHeader:'.method public final c(Ljava/lang/String;[B)V');
 if(wrapped){const wrapper=method(audio,'.method public final c(Ljava/lang/String;[B)V');block(wrapper,'existing audio wrapper original call',[`invoke-virtual {p0, p1, p2}, ${sdk}e;->turboioOriginal_c(Ljava/lang/String;[B)V`]);count(wrapper,'existing audio wrapper original exactly once','->turboioOriginal_c(',1);record(wrapper,['existing passive wrapper preserves original call']);}
 block(ingress,'ingress locals',['.locals 20']);
 ordered(ingress,'transport decode',[`move-object/from16 v5, p1`,`move-object/from16 v7, p2`,`invoke-static {v7}, ${proto}->parseFrom([B)${proto}`]);
 block(ingress,'type 1 wake branch',[`invoke-virtual/range {v16 .. v16}, ${proto}->getType()I`,'move-result v1','const/4 v3, 0x1','const/4 v4, 0x0','const/16 v18, 0x0','if-eq v1, v3, :cond_27']);
 ordered(ingress,'wake rc lookup',[':cond_27','move-object v3, v4',`const-class v2, ${sdk}WakeBean;`,`check-cast v0, ${sdk}WakeBean;`,`invoke-virtual {v0}, ${sdk}WakeBean;->getRc()I`,'move-result v2',`invoke-static {}, ${sdk}o;->values()[${sdk}o;`,'aget-object v6, v1, v5',`iget v7, v6, ${sdk}o;->b:I`,'if-ne v7, v2, :cond_28','move-object v12, v6']);
 ordered(ingress,'shared mode isolated',[`sget-object v1, ${sdk}o;->h:${sdk}o;`,'if-ne v12, v1, :cond_2b',`invoke-virtual {v0}, ${sdk}WakeBean;->getMode()I`,`invoke-static {v2}, ${sdk}n$a;->a(I)${sdk}n;`,'move-object v13, v4',':cond_2b','move-object v13, v3']);
 block(ingress,'exact incoming wake dispatch',[`invoke-virtual {v0}, ${sdk}WakeBean;->getLinkType()Ljava/lang/Integer;`,'move-result-object v3','check-cast v2, Lt8/b$b;',`invoke-virtual {v2, v12, v13, v3}, ${wakeCall}`]);count(ingress,'incoming wake call unique',wakeCall,1);record(ingress,['type=1','WakeBean.rc enum value lookup','SHARED_AUDIO-only mode','peer p1 and nullable linkType']);

 const bean=load(sdk+'WakeBean;');
 for(const [name,field,type,opcode,ret]of [['getRc','rc','I','iget','return'],['getMode','mode','I','iget','return'],['getLinkType','linkType','Ljava/lang/Integer;','iget-object','return-object']]){const m=method(bean,`.method public final ${name}()${type}`);block(m,'WakeBean '+name,[`${opcode} p0, p0, ${sdk}WakeBean;->${field}:${type}`,`${ret} p0`]);record(m,['exact getter field']);}
 const enumeration=load(sdk+'o;'),enumInit=method(enumeration,'.method static constructor <clinit>()V');
 block(enumInit,'KEY wire code and enum field',['const-string v4, "KEY"','const/4 v5, 0x3',`invoke-direct {v3, v4, v5, v5}, ${sdk}o;-><init>(Ljava/lang/String;II)V`,`sput-object v3, ${sdk}o;->f:${sdk}o;`]);
 block(enumInit,'SHARED_AUDIO wire code and enum field',['const-string v8, "SHARED_AUDIO"','const/4 v9, 0x7',`invoke-direct {v7, v8, v9, v9}, ${sdk}o;-><init>(Ljava/lang/String;II)V`,`sput-object v7, ${sdk}o;->h:${sdk}o;`]);
 const enumConstructor=method(enumeration,'.method private constructor <init>(Ljava/lang/String;II)V');block(enumConstructor,'wire code is third constructor parameter',[`iput p3, p0, ${sdk}o;->b:I`]);record(enumInit,['KEY/f rc=3','SHARED_AUDIO/h rc=7']);record(enumConstructor,['enum ordinal is not substituted for wire code']);

 const listener=load('Lt8/b$b;'),wake=method(listener,'.method public final j'+wakeSignature);
 block(wake,'wake locals',['.locals 12']);
 ordered(wake,'original linkType before clobber',['iget-object v1, p0, Lt8/b$b;->a:Lt8/b;','iget-object v1, v1, Lt8/b;->u:Lkotlin/jvm/functions/Function1;','invoke-interface {v1, p3}, Lkotlin/jvm/functions/Function1;->invoke(Ljava/lang/Object;)Ljava/lang/Object;','sget-object p3, Lm8/Y0;->a:Lm8/Y0;']);
 ordered(wake,'shared branch separated',[`sget-object v1, ${sdk}o;->h:${sdk}o;`,'const-string v2, "onWake"','if-ne p1, v1, :cond_7',':cond_7','invoke-virtual {p2}, Lm8/D;->a()Lm8/C;','const-string v5, "assistant_wake"']);
 block(wake,'arbitration deny returns before onWake',['invoke-virtual {v1, v5, p2}, Lt8/d;->a(Ljava/lang/String;Lm8/C;)Z','move-result p2','if-nez p2, :cond_8','return-void',':cond_8','iget-object p2, p0, Lt8/b$b;->a:Lt8/b;','iget-object p2, p2, Lt8/b;->l:Lkotlin/jvm/functions/Function2;']);
 ordered(wake,'onWake precedes original start',[':cond_8',`iget v1, p1, ${sdk}o;->b:I`,'invoke-interface {p2, v2, v0}, Lkotlin/jvm/functions/Function2;->invoke(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;','sget-object p2, Lt8/c;->a:[I','if-eq p1, v4, :cond_a','const/4 p2, 0x0','if-eq p1, v3, :cond_9','iget-object p0, p0, Lt8/b;->m:Lkotlin/jvm/functions/Function1;','invoke-interface {p0, p2}, Lkotlin/jvm/functions/Function1;->invoke(Ljava/lang/Object;)Ljava/lang/Object;']);record(wake,['exact void/reference signature','linkType clobbered','nonshared arbitration before onWake/startAssistant']);
 const map=method(load('Lt8/c;'),'.method static constructor <clinit>()V');ordered(map,'KEY uses default start branch',[`sget-object v1, ${sdk}o;->e:${sdk}o;`,'const/4 v2, 0x1',`sget-object v1, ${sdk}o;->g:${sdk}o;`,'const/4 v2, 0x2']);count(map,'only two wake switch mappings','aput ',2);count(map,'KEY must remain unmapped',`${sdk}o;->f:`,0);record(map,['VOICE_A=1 and LIVE_AI=2; KEY default']);
 const arbitration=method(load('Lt8/d;'),'.method public final a(Ljava/lang/String;Lm8/C;)Z');ordered(arbitration,'arbitration can preempt',['iget-boolean v0, p2, Lm8/C;->c:Z','invoke-virtual {v3}, Lu8/a;->f()Z','iget-boolean v0, p2, Lm8/C;->d:Z','iget-object v0, p0, Lt8/d;->g:Lkotlin/jvm/functions/Function2;','invoke-interface {v0, v3, v4}, Lkotlin/jvm/functions/Function2;->invoke(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;','iget-boolean v0, p2, Lm8/C;->e:Z','iget-object p0, p0, Lt8/d;->h:LAb/a;']);record(arbitration,['arbitration has preemption effects; not an idle proof']);

 const mock=method(load('Lm8/d1;'),'.method private final a(Loa/t;Loa/x;)V');ordered(mock,'mock can also produce KEY',['const-string v1, "voice_assistant_trigger_wake"',`sget-object v0, ${sdk}o;->f:${sdk}o;`,'const-string v2, "[MOCK] Simulating glass wake: "',`invoke-virtual {v1, v3, v4, v4}, ${wakeCall}`]);count(mock,'known mock wake call unique',wakeCall,1);record(mock,['mock KEY cannot prove transport provenance']);
 const manager=load('LY3/V;'),init=method(manager,'.method static constructor <clinit>()V');block(init,'single input executor',['invoke-static {}, Ljava/util/concurrent/Executors;->newSingleThreadExecutor()Ljava/util/concurrent/ExecutorService;','move-result-object v0','sput-object v0, LY3/V;->m:Ljava/util/concurrent/ExecutorService;']);record(init,['input executor is not MAIN']);
 const receive=method(manager,'.method public final b(LY3/C;LY3/p;)V');block(receive,'input executor dispatch',['new-instance p0, LY0/A;','const/16 v0, 0x8','invoke-direct {p0, v0, p1, p2}, LY0/A;-><init>(ILjava/lang/Object;Ljava/lang/Object;)V','sget-object p1, LY3/V;->m:Ljava/util/concurrent/ExecutorService;','invoke-interface {p1, p0}, Ljava/util/concurrent/Executor;->execute(Ljava/lang/Runnable;)V']);record(receive,['runnable discriminator 8']);
 const runner=method(load('LY0/A;','smali'),'.method public final run()V');block(runner,'runnable discriminator 8 mapping',[':pswitch_data_0','.packed-switch 0x0',':pswitch_22',':pswitch_1b',':pswitch_1a',':pswitch_19',':pswitch_18',':pswitch_17',':pswitch_16',':pswitch_15',':pswitch_14']);ordered(runner,'executor reaches inbound route',[':pswitch_14','iget-object v1, v0, LY0/A;->d:Ljava/lang/Object;','check-cast v1, LY3/C;','iget-object v0, v0, LY0/A;->c:Ljava/lang/Object;','check-cast v0, LY3/p;','invoke-static {v1, v0}, LY3/V;->i(LY3/C;LY3/p;)V']);record(runner,['input task reaches i on executor']);
 const route=method(manager,'.method public static i(LY3/C;LY3/p;)V');block(route,'exact source peer and bytes forwarded',[`sget-object v0, ${sdk}e;->a:${sdk}e;`,'iget-object v3, v2, LY3/S;->b:Ljava/lang/String;',`invoke-virtual {v0, v3, v9}, ${sdk}e;->c(Ljava/lang/String;[B)V`]);count(route,'transport dispatch unique',`${sdk}e;->c(`,1);record(route,['SDK message peer forwarded to c']);
 return {schema_version:1,host_version:HOST.version,declared_source_apk_sha256:HOST.sha256,scope:'read-only structural smali anchors; not a complete control-flow or APK verification',existing_audio_observer_wrapper:wrapped,known_callers:[sdk+'e;','Lm8/d1;'],caller_inventory_exhaustive:false,installs_hooks:false,android_runtime_wired:false,physical_double_tap_verified:false,physical_audio_release_verified:false,proofs};
}
