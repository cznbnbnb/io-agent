import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {classFile,HOST} from '../../rebuild/android-app/host-107.mjs';
export function verifyVoice(root){
 const checks=[
  ['Lcom/rayneo/airuntime/controller/ASRController;',['.method public final createTask(Ljava/lang/String;)Lcom/rayneo/airuntime/controller/ASRTask;','.method public final destroyTask(Ljava/lang/String;)V']],
  ['Lcom/rayneo/airuntime/controller/ASRTask;',['.method public final initTask(Lcom/rayneo/airuntime/controller/RayNeoASRConfig;Lcom/rayneo/airuntime/bridge/AudioRecorderBridge$AudioRecorderAdapter;Lcom/rayneo/airuntime/controller/ASRResultListener;)Z',...['startTask','stopTask','releaseTask'].map(n=>'.method public final '+n+'()Z'),'.method public final getTaskWorkState()Lcom/rayneo/airuntime/controller/WorkState;']],
  ['Lcom/rayneo/airuntime/controller/RayNeoASRConfig;',['.method public constructor <init>()V','.method public final getInputAudioFormat()Ljava/lang/String;','.method public final getInputAudioRate()I',...['ServerConfig(Lcom/rayneo/airuntime/controller/RayNeoServerConfig;)','UserName(Ljava/lang/String;)','DeviceName(Ljava/lang/String;)','DeviceModel(Ljava/lang/String;)','LanguageCode(Ljava/lang/String;)','InputAudioFormat(Ljava/lang/String;)','InputAudioRate(I)','BizType(Ljava/lang/String;)','EnvDebug(Z)'].map(n=>'.method public final set'+n+'V')]],
  ['Lcom/rayneo/airuntime/controller/ASRResultListener;',['.method public abstract onAsrResult(Ljava/lang/String;Z)V','.method public abstract onAudioRecordStart()V','.method public abstract onAudioRecordEnd()V','.method public abstract onStartResult(ZLjava/lang/String;)V','.method public abstract onError(ILjava/lang/String;)V','.method public abstract onProactiveHint(Lcom/rayneo/airuntime/controller/RayNeoProactiveHint;)V','.method public abstract onVadStatusChange(I)V']],
  ['Lcom/rayneo/airuntime/bridge/AudioRecorderBridge$AudioRecorderAdapter;',['.method public final notifyRecordData([B)V','.method public final notifyRecordStop()V']],
  ['Lp8/o;',['.method public constructor <init>()V',...['onCreate','onStart','onStop','onDestroy','onPause','onResume'].map(n=>'.method public final '+n+'()Z')]],
  ['Ly8/d;',['.field public static volatile b:Lio/flutter/embedding/engine/a;']],
  ['Lio/flutter/embedding/engine/a;',['.field public final d:Lfa/d;']],
  ['Lfa/d;',['.field public final a:Ljava/util/HashMap;']],
  ['Lcom/rayneo/rayneo_venus_sdk_plugin/f;',['.field public final y:Lm8/k;']],
  ['Lm8/k;',['.field public final u:Lp8/e;']],
  ['Lp8/e;',['.field public final a:Ls8/a;','.field public final b:LAb/a;','.field public final i:Ljava/lang/Object;',...['j','k','l','m'].map(n=>'.field public '+n+':Z'),'.field public final o:Lp8/k;','.field public final p:Lp8/g;','.field public final q:Lp8/a;','.method public final b()Lcom/rayneo/airuntime/controller/ASRController;','.method public final c()Z']],
  ['Lp8/a;',['.field public c:Lcom/rayneo/airuntime/controller/ASRTask;']],
  ['Lp8/k;',['.field public b:Lcom/rayneo/airuntime/controller/ASRTask;']],
  ['Lp8/g;',['.field public d:Lcom/rayneo/airuntime/controller/ASRTask;']],
  ['Ls8/a;',['a','c','d'].map(n=>'.field public '+n+':Ljava/lang/String;')],
  ['LAb/a;',['.method public abstract invoke()Ljava/lang/Object;']],
  ['Lcom/rayneo/airuntime/utils/OpusDecoder;',['.method public constructor <init>()V','.method public final init-uN6NtqM(II)Z','.method public final decode2Bytes([B)[B','.method public final release()V']],
 ];
 const proofs=checks.map(([descriptor,required])=>{const file=classFile(root,descriptor),raw=fs.readFileSync(file),text=raw.toString('utf8').replaceAll('\r\n','\n');for(const line of required)if(!text.split('\n').includes(line))throw Error('Voice ABI mismatch: '+descriptor+' '+line);return {descriptor,path:path.relative(root,file),sha256:crypto.createHash('sha256').update(raw).digest('hex'),required};});
 const recorder=proofs.find(p=>p.descriptor==='Lp8/o;');if(recorder.sha256!=='4cb19c13933f8eef556fc0d7363b67f8f9ce60f338e9015f6834ca9874c6d326')throw Error('External-data recorder implementation changed');
 return {host:HOST.version,host_sha256:HOST.sha256,proofs,external_data_adapter_opens_microphone:false,physical_engine_tested:false};
}
