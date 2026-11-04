import fs from 'node:fs';
import path from 'node:path';
export const HOST=Object.freeze({version:'1.0.10',code:258,sha256:'951dabcb8a0a954dd90b901dab9a6b53c48c406545879f4900949c8b41e26e22',apk:'RayNeo-1.0.10-258-original.apk',stage:'host-110',hookDexes:['classes2','classes3'],listener:'Lm9/c$c;',event:'Lcom/rayneo/rayneo_venus_sdk_plugin/k;',manager:'LO4/v;',message:'LO4/V;',queue:'LO4/Y;'});
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
 check('Lu9/e;',['.field public static volatile b:Lio/flutter/embedding/engine/a;']);
 check('Lio/flutter/embedding/engine/a;',['.field public final d:Lfb/d;']);
 check('Lfb/d;',['.field public final a:Ljava/util/HashMap;']);
 check('Lb8/r;',['.field public final d:Ljava/util/HashMap;']);
 check('Lb8/o;',['.method public final x()Ljava/util/HashMap;']);
 check('Lcom/rayneo/rayneo_venus_sdk_plugin/g;',['.field public final A:Lcom/rayneo/rayneo_venus_sdk_plugin/k;']);
 const listener=check(HOST.listener,['.method public final onAsrResult(Ljava/lang/String;ZLjava/lang/String;)V','.method public final onNlpResult(Lcom/rayneo/airuntime/controller/NlpResult;)V','.method public final onResponseComplete()V']);
 const audio=check('Lcom/rayneo/rayneo_venus_sdk_plugin/e;',['.method public final c(Ljava/lang/String;[B)V']);
 const activity=check('Lcom/rayneo/venus/MainActivity;',['.method public final onPostResume()V']);
 const event=check(HOST.event,['.method public final z(Ljava/lang/String;Ljava/util/Map;)V']);
 const manager=check(HOST.manager,['.field public static volatile h:LO4/v;','.method public static i()Ljava/util/List;','.method public final t(LO4/V;Lkotlin/jvm/functions/Function2;)V','.method public final u(Ljava/io/File;Ljava/lang/String;Lb5/q;Ljava/lang/String;)Ljava/lang/String;']);
 const queue=check(HOST.queue,['.method public static s(LO4/V;)V']);
 check(HOST.message,['.field public final b:Ljava/lang/String;','.field public final c:La5/h;','.field public final e:[B','.field public k:Lkotlin/jvm/functions/Function2;','.method public constructor <init>([BLjava/lang/String;Ljava/lang/String;La5/h;La5/Q;LO4/c;ZZLb5/p;Lkotlin/jvm/functions/Function2;)V']);
 for(const [descriptor,values] of [['La5/h;',['MARS_FOTA','LAUNCHER','AI_SUBTITLE','TELEPROMPTER']],['LO4/c;',['NORMAL']]]){const f=classFile(root,descriptor),s=fs.readFileSync(f,'utf8');for(const v of values)if(!s.includes('"'+v+'"'))throw new Error('Enum missing '+v);proofs.push({descriptor,file:path.relative(root,f),enum_values:values});}
 for(const [descriptor,lines] of [['LO4/G;',['.method public final b()Z']],['Lb5/q;',['.field public static final enum SmallCore:Lb5/q;']]])check(descriptor,lines);
 check('Lcom/rayneo/rayneo_venus_sdk_plugin/k;',['.method public constructor <init>()V','.field public b:Landroid/content/Context;','.field public g:Z','.method public final y(Ljava/lang/String;)LO4/G;','.method public static j(LO4/G;)Ljava/util/Map;',...['I:Lcom/rayneo/rayneo_venus_sdk_plugin/k$f;','J:Lcom/rayneo/rayneo_venus_sdk_plugin/k$e;','L:Lcom/rayneo/rayneo_venus_sdk_plugin/k$h;','K:Lcom/rayneo/rayneo_venus_sdk_plugin/k$g;'].map(s=>'.field public final '+s)]);
 check('Lcom/rayneo/rayneo_venus_sdk_plugin/i;',['.field public static final c:Ljava/util/concurrent/atomic/AtomicBoolean;','.field public static volatile l:Lcom/rayneo/rayneo_venus_sdk_plugin/i$b;','.field public static volatile f:Li9/n0;','.field public static volatile h:Lkotlin/jvm/functions/Function1;','.field public static volatile i:Lkotlin/jvm/functions/Function1;','.method public static m(Landroid/content/Context;)Z','.method public static n([La5/F;[Ljava/lang/String;)Z','.method public static b(LO4/G;Ljava/lang/String;ZLjava/lang/String;)Z','.method public static e(Ljava/lang/String;Ljava/lang/String;)Z','.method public static h(JLi9/G1;)Z','.method public static r(Ljava/lang/String;)V']);
 check('Lcom/rayneo/rayneo_venus_sdk_plugin/i$b;',['.method public final c(Landroid/content/Context;Li9/F1;)V']);
 check('LO4/v$a;',['.method public final a()LO4/v;']);
 check('LO4/H;',['.method public static a(Ljava/lang/String;)Ljava/lang/String;','.method public static b(Ljava/lang/String;)Ljava/lang/String;']);
 check('LO4/v;',['.field public static final g:LO4/v$a;','.method public static j()Ljava/util/Map;',...['a','b','c','e'].map(name=>'.field public final '+name+':Ll5/m;')]);
 check('Ll5/m;',['.field public final a:Ljava/util/ArrayList;']);
 check('LO4/Q;',['.field public static d:Z','.method public static z()V']);
 check('Li9/A1;',['.method public synthetic constructor <init>(Lcom/rayneo/rayneo_venus_sdk_plugin/k;I)V','.method public final invoke()Ljava/lang/Object;']);
 check('Li9/z1;',['.method public synthetic constructor <init>(Lcom/rayneo/rayneo_venus_sdk_plugin/k;I)V','.field public final synthetic b:I','.field public final synthetic c:Lcom/rayneo/rayneo_venus_sdk_plugin/k;']);
 check('Li9/F1;',['.method public constructor <init>()V']);
 check('La5/F;',['.field public static final enum VENUS:La5/F;','.field public static final enum V4:La5/F;']);
 check('Li9/G1;',['.field public static final enum STOPPED:Li9/G1;']);
 for(const [f,dex] of [[listener,'classes3'],[activity,'classes3'],[event,'classes3'],[queue,'classes2'],[manager,'classes2'],[audio,'classes3']])if(!path.relative(root,f).startsWith('smali_'+dex+path.sep))throw new Error('Unexpected hook DEX: '+f);
 check('Lyb/a0;',['.method public final a(Ljava/lang/String;Lyb/n;)Ljava/lang/String;']);
 check('Lg9/l$a;',['.method public final d()Lg9/l;']);
 check('LO4/h;',['.method public abstract a()La5/w;','.method public abstract c(LO4/q;)V','.method public abstract d()[La5/H;']);
 check('LO4/m;',['.field public final i:Ljava/util/concurrent/CopyOnWriteArrayList;','.method public final f(La5/I;LO4/q;)V','    iget-object v0, v0, LO4/m;->i:Ljava/util/concurrent/CopyOnWriteArrayList;','    invoke-interface {v0, v15}, LO4/h;->c(LO4/q;)V']);
 check('LO4/q;',['.field public final a:Ljava/lang/String;','.field public final i:[B','.field public final p:La5/h;']);
 const scanner=check('LO4/D;',['.method public static j([La5/E;[Ljava/lang/String;LO4/S;)V','    invoke-virtual {p1, v2}, Landroid/bluetooth/le/ScanSettings$Builder;->setScanMode(I)Landroid/bluetooth/le/ScanSettings$Builder;']);
 if(!path.relative(root,scanner).startsWith('smali_classes2'+path.sep))throw new Error('Unexpected scanner hook DEX');
 const location=check('LL8/u1;',['.method public final a(Lkotlin/jvm/functions/Function1;)V','    invoke-virtual {v2, v3, v4}, LL8/D2;->a(J)Ljava/util/Map;','    invoke-virtual {v0, p1}, Ljava/util/ArrayList;->add(Ljava/lang/Object;)Z']);
 const locationResult=check('LL8/b1;',['.method public final a(Ljava/util/Map;Z)V','    iget-wide v0, p0, LL8/b1;->m:J']);
 const locationProvider=check('LL8/Z0;',['.method public final invoke(Ljava/lang/Object;)Ljava/lang/Object;','    check-cast v4, LL8/u0;','    sget-object v0, LL8/u0;->ANDROID_SYSTEM:LL8/u0;','    invoke-virtual {v9, p1, v5}, LL8/J2;->d(ZLE8/i;)V']);
 for(const file of [location,locationResult,locationProvider])if(!path.relative(root,file).startsWith('smali_classes3'+path.sep))throw new Error('Unexpected location hook DEX');
 const application=check('Lcom/rayneo/venus/VenusApplication;',['.method public final onCreate()V']);return {listener,activity,event,manager,queue,audio,application,scanner,location,locationResult,locationProvider,proofs};
}
