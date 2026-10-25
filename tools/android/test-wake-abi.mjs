import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyWakeAbi} from '../../rebuild/android-app/host-107.mjs';

// Deliberately small structural text fixtures, independently transcribed from
// the investigated 1.0.7 blocks. They are not executable/replacement host smali.
const sdk='Lcom/rayneo/rayneo_venus_sdk_plugin/',proto='Lcom/rayneo/airuntime/tansport/proto/TransportMessage$AssistantMsg;';
const signature=`(${sdk}o;${sdk}n;Ljava/lang/Integer;)V`;
const method=(header,body)=>`.method ${header}\n${body}\n.end method\n`;
function fixture({wrapped=false,crlf=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'io-wake-abi-')),files=new Map();
 const put=(descriptor,text,dex='smali_classes2')=>{const file=path.join(root,dex,descriptor.slice(1,-1)+'.smali');fs.mkdirSync(path.dirname(file),{recursive:true});const source=`.class public final ${descriptor}\n.super Ljava/lang/Object;\n${text}`;fs.writeFileSync(file,crlf?source.replaceAll('\n','\r\n'):source);files.set(descriptor,file);};
 const audio=method(`public final ${wrapped?'turboioOriginal_c':'c'}(Ljava/lang/String;[B)V`,`.locals 20
move-object/from16 v5, p1
move-object/from16 v7, p2
invoke-static {v7}, ${proto}->parseFrom([B)${proto}
invoke-virtual/range {v16 .. v16}, ${proto}->getType()I
move-result v1
const/4 v3, 0x1
const/4 v4, 0x0
const/16 v18, 0x0
if-eq v1, v3, :cond_27
:cond_27
move-object v3, v4
const-class v2, ${sdk}WakeBean;
check-cast v0, ${sdk}WakeBean;
invoke-virtual {v0}, ${sdk}WakeBean;->getRc()I
move-result v2
invoke-static {}, ${sdk}o;->values()[${sdk}o;
aget-object v6, v1, v5
iget v7, v6, ${sdk}o;->b:I
if-ne v7, v2, :cond_28
move-object v12, v6
sget-object v1, ${sdk}o;->h:${sdk}o;
if-ne v12, v1, :cond_2b
invoke-virtual {v0}, ${sdk}WakeBean;->getMode()I
invoke-static {v2}, ${sdk}n$a;->a(I)${sdk}n;
move-object v13, v4
:cond_2b
move-object v13, v3
invoke-virtual {v0}, ${sdk}WakeBean;->getLinkType()Ljava/lang/Integer;
move-result-object v3
check-cast v2, Lt8/b$b;
invoke-virtual {v2, v12, v13, v3}, Lt8/b$b;->j${signature}
return-void`);
 put(sdk+'e;',audio+(wrapped?method('public final c(Ljava/lang/String;[B)V',`.locals 1
invoke-static {p1, p2}, Lcom/turboio/addon/LifelogAudioObservationRuntime;->incoming(Ljava/lang/String;[B)V
invoke-virtual {p0, p1, p2}, ${sdk}e;->turboioOriginal_c(Ljava/lang/String;[B)V
return-void`):''));
 put(sdk+'WakeBean;',method('public final getRc()I',`iget p0, p0, ${sdk}WakeBean;->rc:I\nreturn p0`)+method('public final getMode()I',`iget p0, p0, ${sdk}WakeBean;->mode:I\nreturn p0`)+method('public final getLinkType()Ljava/lang/Integer;',`iget-object p0, p0, ${sdk}WakeBean;->linkType:Ljava/lang/Integer;\nreturn-object p0`));
 put(sdk+'o;',method('static constructor <clinit>()V',`const-string v4, "KEY"
const/4 v5, 0x3
invoke-direct {v3, v4, v5, v5}, ${sdk}o;-><init>(Ljava/lang/String;II)V
sput-object v3, ${sdk}o;->f:${sdk}o;
const-string v8, "SHARED_AUDIO"
const/4 v9, 0x7
invoke-direct {v7, v8, v9, v9}, ${sdk}o;-><init>(Ljava/lang/String;II)V
sput-object v7, ${sdk}o;->h:${sdk}o;`)+method('private constructor <init>(Ljava/lang/String;II)V',`iput p3, p0, ${sdk}o;->b:I`));
 put('Lt8/b$b;',method('public final j'+signature,`.locals 12
iget-object v1, p0, Lt8/b$b;->a:Lt8/b;
iget-object v1, v1, Lt8/b;->u:Lkotlin/jvm/functions/Function1;
invoke-interface {v1, p3}, Lkotlin/jvm/functions/Function1;->invoke(Ljava/lang/Object;)Ljava/lang/Object;
sget-object p3, Lm8/Y0;->a:Lm8/Y0;
sget-object v1, ${sdk}o;->h:${sdk}o;
const-string v2, "onWake"
if-ne p1, v1, :cond_7
:cond_7
invoke-virtual {p2}, Lm8/D;->a()Lm8/C;
const-string v5, "assistant_wake"
invoke-virtual {v1, v5, p2}, Lt8/d;->a(Ljava/lang/String;Lm8/C;)Z
move-result p2
if-nez p2, :cond_8
return-void
:cond_8
iget-object p2, p0, Lt8/b$b;->a:Lt8/b;
iget-object p2, p2, Lt8/b;->l:Lkotlin/jvm/functions/Function2;
iget v1, p1, ${sdk}o;->b:I
invoke-interface {p2, v2, v0}, Lkotlin/jvm/functions/Function2;->invoke(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;
sget-object p2, Lt8/c;->a:[I
if-eq p1, v4, :cond_a
const/4 p2, 0x0
if-eq p1, v3, :cond_9
iget-object p0, p0, Lt8/b;->m:Lkotlin/jvm/functions/Function1;
invoke-interface {p0, p2}, Lkotlin/jvm/functions/Function1;->invoke(Ljava/lang/Object;)Ljava/lang/Object;`));
 put('Lt8/c;',method('static constructor <clinit>()V',`sget-object v1, ${sdk}o;->e:${sdk}o;
const/4 v2, 0x1
aput v2, v0, v1
sget-object v1, ${sdk}o;->g:${sdk}o;
const/4 v2, 0x2
aput v2, v0, v1`));
 put('Lt8/d;',method('public final a(Ljava/lang/String;Lm8/C;)Z',`iget-boolean v0, p2, Lm8/C;->c:Z
invoke-virtual {v3}, Lu8/a;->f()Z
iget-boolean v0, p2, Lm8/C;->d:Z
iget-object v0, p0, Lt8/d;->g:Lkotlin/jvm/functions/Function2;
invoke-interface {v0, v3, v4}, Lkotlin/jvm/functions/Function2;->invoke(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;
iget-boolean v0, p2, Lm8/C;->e:Z
iget-object p0, p0, Lt8/d;->h:LAb/a;`));
 put('Lm8/d1;',method('private final a(Loa/t;Loa/x;)V',`const-string v1, "voice_assistant_trigger_wake"
sget-object v0, ${sdk}o;->f:${sdk}o;
const-string v2, "[MOCK] Simulating glass wake: "
invoke-virtual {v1, v3, v4, v4}, Lt8/b$b;->j${signature}`));
 put('LY3/V;',method('static constructor <clinit>()V',`invoke-static {}, Ljava/util/concurrent/Executors;->newSingleThreadExecutor()Ljava/util/concurrent/ExecutorService;
move-result-object v0
sput-object v0, LY3/V;->m:Ljava/util/concurrent/ExecutorService;`)+method('public final b(LY3/C;LY3/p;)V',`new-instance p0, LY0/A;
const/16 v0, 0x8
invoke-direct {p0, v0, p1, p2}, LY0/A;-><init>(ILjava/lang/Object;Ljava/lang/Object;)V
sget-object p1, LY3/V;->m:Ljava/util/concurrent/ExecutorService;
invoke-interface {p1, p0}, Ljava/util/concurrent/Executor;->execute(Ljava/lang/Runnable;)V`)+method('public static i(LY3/C;LY3/p;)V',`sget-object v0, ${sdk}e;->a:${sdk}e;
iget-object v3, v2, LY3/S;->b:Ljava/lang/String;
invoke-virtual {v0, v3, v9}, ${sdk}e;->c(Ljava/lang/String;[B)V`));
 put('LY0/A;',method('public final run()V',`:pswitch_14
iget-object v1, v0, LY0/A;->d:Ljava/lang/Object;
check-cast v1, LY3/C;
iget-object v0, v0, LY0/A;->c:Ljava/lang/Object;
check-cast v0, LY3/p;
invoke-static {v1, v0}, LY3/V;->i(LY3/C;LY3/p;)V
:pswitch_data_0
.packed-switch 0x0
:pswitch_22
:pswitch_1b
:pswitch_1a
:pswitch_19
:pswitch_18
:pswitch_17
:pswitch_16
:pswitch_15
:pswitch_14
.end packed-switch`),'smali');
 return {root,files,change(descriptor,from,to){const file=files.get(descriptor),text=fs.readFileSync(file,'utf8');assert.ok(text.includes(from),'fixture mutation exists');fs.writeFileSync(file,text.replace(from,to));},close(){fs.rmSync(root,{recursive:true,force:true});}};
}

test('wake ABI accepts pristine and existing passive wrapper fixtures without claiming physical proof',()=>{
 for(const wrapped of [false,true])for(const crlf of [false,true]){
  const f=fixture({wrapped,crlf});try{
   const before=new Map([...f.files].map(([name,file])=>[name,fs.readFileSync(file)]));const result=verifyWakeAbi(f.root);
   assert.equal(result.existing_audio_observer_wrapper,wrapped);assert.equal(result.proofs.length,wrapped?15:14);
   for(const field of ['installs_hooks','android_runtime_wired','physical_double_tap_verified','physical_audio_release_verified','caller_inventory_exhaustive'])assert.equal(result[field],false);
   assert.deepEqual(result.known_callers,[sdk+'e;','Lm8/d1;']);for(const proof of result.proofs)assert.match(proof.normalized_method_sha256,/^[a-f0-9]{64}$/);
   for(const [name,file]of f.files)assert.deepEqual(fs.readFileSync(file),before.get(name));
  }finally{f.close();}
 }
});

const drifts=[
 ['wake return signature','Lt8/b$b;','public final j'+signature,'public final j'+signature.slice(0,-1)+'Z'],
 ['wake register layout','Lt8/b$b;','.locals 12','.locals 13'],
 ['wire event type',sdk+'e;','const/4 v3, 0x1','const/4 v3, 0x3'],
 ['wire branch',sdk+'e;','if-eq v1, v3, :cond_27','if-ne v1, v3, :cond_27'],
 ['rc getter',sdk+'WakeBean;','->rc:I','->mode:I'],
 ['enum wire parameter',sdk+'o;','iput p3, p0','iput p2, p0'],
 ['KEY wire code',sdk+'o;','const/4 v5, 0x3','const/4 v5, 0x4'],
 ['shared audio wire code',sdk+'o;','const/4 v9, 0x7','const/4 v9, 0x3'],
 ['nullable link argument',sdk+'e;','invoke-virtual {v2, v12, v13, v3}','invoke-virtual {v2, v12, v13, v4}'],
 ['shared mode branch',sdk+'e;','if-ne v12, v1, :cond_2b','if-eq v12, v1, :cond_2b'],
 ['priority deny polarity','Lt8/b$b;','if-nez p2, :cond_8','if-eqz p2, :cond_8'],
 ['priority deny early return','Lt8/b$b;','return-void\n:cond_8','nop\n:cond_8'],
 ['before-start event','Lt8/b$b;','const-string v2, "onWake"','const-string v2, "onLaterEvent"'],
 ['start callback identity','Lt8/b$b;','->m:Lkotlin/jvm/functions/Function1;','->n:Lkotlin/jvm/functions/Function1;'],
 ['preemption mutation','Lt8/d;','Lu8/a;->f()Z','Lu8/a;->g()Z'],
 ['mock callback removed','Lm8/d1;','invoke-virtual {v1, v3, v4, v4}','invoke-virtual {v1, v3, v4, v5}'],
 ['executor threading','LY3/V;','newSingleThreadExecutor()','newCachedThreadPool()'],
 ['runnable dispatch identity','LY3/V;','const/16 v0, 0x8','const/16 v0, 0x9'],
 ['runnable switch target','LY0/A;',':pswitch_15\n:pswitch_14',':pswitch_15\n:pswitch_13'],
 ['runnable inbound target','LY0/A;','LY3/V;->i(','LY3/V;->j('],
 ['source peer field','LY3/V;','LY3/S;->b:Ljava/lang/String;','LY3/S;->a:Ljava/lang/String;'],
];
for(const [name,descriptor,from,to]of drifts)test('rejects drift: '+name,()=>{const f=fixture();try{f.change(descriptor,from,to);assert.throws(()=>verifyWakeAbi(f.root),/Wake ABI mismatch/);}finally{f.close();}});

test('rejects additional wake switch mapping, duplicate method and duplicate original dispatch',()=>{
 for(const which of ['switch','method','wrapper']){const f=fixture({wrapped:true});try{
  if(which==='switch')f.change('Lt8/c;','aput v2, v0, v1',`aput v2, v0, v1\nsget-object v1, ${sdk}o;->f:${sdk}o;\naput v2, v0, v1`);
  if(which==='method')f.change('Lt8/b$b;',`.method public final j${signature}`,`.method public final j${signature}\n.end method\n.method public final j${signature}`);
  if(which==='wrapper'){const line=`invoke-virtual {p0, p1, p2}, ${sdk}e;->turboioOriginal_c(Ljava/lang/String;[B)V`;f.change(sdk+'e;',line,line+'\n'+line);}
  assert.throws(()=>verifyWakeAbi(f.root),/Wake ABI mismatch/);
 }finally{f.close();}}
});

test('rejects moving the pinned wake listener to a different DEX',()=>{
 const f=fixture();try{const old=f.files.get('Lt8/b$b;'),moved=path.join(f.root,'smali_classes3/t8/b$b.smali');fs.mkdirSync(path.dirname(moved),{recursive:true});fs.renameSync(old,moved);assert.throws(()=>verifyWakeAbi(f.root),/Wake ABI mismatch.*dex/);}finally{f.close();}
});

// Opt-in once for the existing local stage; always read-only. No build, SDK,
// install, device-lock operation or real input is reachable from this runner.
if(process.argv.includes('--verify-current-stage'))test('read-only current unpacked 1.0.7 wake ABI',()=>{
 const stage=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../rebuild/android-app/build/host-107');
 const result=verifyWakeAbi(stage);assert.equal(result.host_version,'1.0.7');
 console.log(JSON.stringify({stage:'host-107',proofs:result.proofs.length,existing_audio_observer_wrapper:result.existing_audio_observer_wrapper,installs_hooks:result.installs_hooks,android_runtime_wired:result.android_runtime_wired,physical_double_tap_verified:result.physical_double_tap_verified,physical_audio_release_verified:result.physical_audio_release_verified}));
});
