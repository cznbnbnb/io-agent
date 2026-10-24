import fs from 'node:fs';
import path from 'node:path';
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
