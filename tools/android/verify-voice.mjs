import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {classFile,HOST} from '../../rebuild/android-app/host-110.mjs';
// apktool writes host line endings; pinned hashes are over the Windows (CRLF) form.
const crlf=raw=>Buffer.from(raw.toString('latin1').replaceAll('\r\n','\n').replaceAll('\n','\r\n'),'latin1');
export function verifyVoice(root){
 const checks=[
  ['Lcom/rayneo/airuntime/controller/ASRController;',['.method public final createTask(Ljava/lang/String;)Lcom/rayneo/airuntime/controller/ASRTask;','.method public final destroyTask(Ljava/lang/String;)V']],
  ['Lcom/rayneo/airuntime/controller/ASRTask;',['.method public final initTask(Lcom/rayneo/airuntime/controller/RayNeoASRConfig;Lcom/rayneo/airuntime/bridge/AudioRecorderBridge$AudioRecorderAdapter;Lcom/rayneo/airuntime/controller/ASRResultListener;)Z',...['startTask','stopTask','releaseTask'].map(n=>'.method public final '+n+'()Z'),'.method public final getTaskWorkState()Lcom/rayneo/airuntime/controller/WorkState;']],
  ['Lcom/rayneo/airuntime/controller/RayNeoASRConfig;',['.method public constructor <init>()V','.method public final getInputAudioFormat()Ljava/lang/String;','.method public final getInputAudioRate()I',...['ServerConfig(Lcom/rayneo/airuntime/controller/RayNeoServerConfig;)','UserName(Ljava/lang/String;)','DeviceName(Ljava/lang/String;)','DeviceModel(Ljava/lang/String;)','LanguageCode(Ljava/lang/String;)','InputAudioFormat(Ljava/lang/String;)','InputAudioRate(I)','BizType(Ljava/lang/String;)','EnvDebug(Z)'].map(n=>'.method public final set'+n+'V')]],
  ['Lcom/rayneo/airuntime/controller/ASRResultListener;',['.method public abstract onAsrResult(Ljava/lang/String;Z)V','.method public abstract onAudioRecordStart()V','.method public abstract onAudioRecordEnd()V','.method public abstract onStartResult(ZLjava/lang/String;)V','.method public abstract onError(ILjava/lang/String;)V','.method public abstract onProactiveHint(Lcom/rayneo/airuntime/controller/RayNeoProactiveHint;)V','.method public abstract onVadStatusChange(I)V']],
  ['Lcom/rayneo/airuntime/bridge/AudioRecorderBridge$AudioRecorderAdapter;',['.method public final notifyRecordData([B)V','.method public final notifyRecordStop()V']],
  ['Ll9/p;',['.method public constructor <init>()V',...['onCreate','onStart','onStop','onDestroy','onPause','onResume'].map(n=>'.method public final '+n+'()Z')]],
  ['Lu9/e;',['.field public static volatile b:Lio/flutter/embedding/engine/a;']],
  ['Lio/flutter/embedding/engine/a;',['.field public final d:Lfb/d;']],
  ['Lfb/d;',['.field public final a:Ljava/util/HashMap;']],
  ['Lcom/rayneo/rayneo_venus_sdk_plugin/g;',['.field public final y:Li9/k;']],
  ['Li9/k;',['.field public final u:Ll9/e;']],
  ['Ll9/e;',['.field public final a:Lo9/a;','.field public final b:Lzc/a;','.field public final i:Ljava/lang/Object;',...['j','k','l','m'].map(n=>'.field public '+n+':Z'),'.field public final o:Ll9/l;','.field public final p:Ll9/g;','.field public final q:Ll9/a;','.method public final b()Lcom/rayneo/airuntime/controller/ASRController;','.method public final c()Z']],
  ['Ll9/a;',['.field public c:Lcom/rayneo/airuntime/controller/ASRTask;']],
  ['Ll9/l;',['.field public b:Lcom/rayneo/airuntime/controller/ASRTask;']],
  ['Ll9/g;',['.field public d:Lcom/rayneo/airuntime/controller/ASRTask;']],
  ['Lo9/a;',['a','c','d'].map(n=>'.field public '+n+':Ljava/lang/String;')],
  ['Lzc/a;',['.method public abstract invoke()Ljava/lang/Object;']],
  ['Lcom/rayneo/airuntime/utils/OpusDecoder;',['.method public constructor <init>()V','.method public final init-uN6NtqM(II)Z','.method public final decode2Bytes([B)[B','.method public final release()V']],
 ];
 const proofs=checks.map(([descriptor,required])=>{const file=classFile(root,descriptor),raw=fs.readFileSync(file),text=raw.toString('utf8').replaceAll('\r\n','\n');for(const line of required)if(!text.split('\n').includes(line))throw Error('Voice ABI mismatch: '+descriptor+' '+line);return {descriptor,path:path.relative(root,file),sha256:crypto.createHash('sha256').update(crlf(raw)).digest('hex'),required};});
 const recorder=proofs.find(p=>p.descriptor==='Ll9/p;');if(recorder.sha256!=='b3125f2df046fc0c633779d33b206197def484ef1a2239b627ce661cbbc5b58f')throw Error('External-data recorder implementation changed');
 return {host:HOST.version,host_sha256:HOST.sha256,proofs,external_data_adapter_opens_microphone:false,physical_engine_tested:false};
}
