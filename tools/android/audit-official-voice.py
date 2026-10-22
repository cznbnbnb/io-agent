"""Read pinned host interfaces only; no SDK initialization, credentials, capture, or network."""
import hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'rebuild/android-app'
HOST=ROOT/'build/host-107/smali_classes2'
required={
 'com/rayneo/airuntime/controller/ASRController.smali':[
  'init()Z','initWorkflow(Lcom/rayneo/airuntime/controller/RayNeoASRConfig;Lcom/rayneo/airuntime/controller/ASRResultListener;)Z',
  'createTask(Ljava/lang/String;)Lcom/rayneo/airuntime/controller/ASRTask;','destroyTask(Ljava/lang/String;)V',
  'getWorkState()Lcom/rayneo/airuntime/controller/WorkState;','startWorkflow()Z','stopWorkflow()Z','destroyWorkflow()Z'],
 'com/rayneo/airuntime/controller/ASRTask.smali':[
  'initTask(Lcom/rayneo/airuntime/controller/RayNeoASRConfig;Lcom/rayneo/airuntime/bridge/AudioRecorderBridge$AudioRecorderAdapter;Lcom/rayneo/airuntime/controller/ASRResultListener;)Z',
  'startTask()Z','stopTask()Z','releaseTask()Z','getTaskWorkState()Lcom/rayneo/airuntime/controller/WorkState;'],
 'com/rayneo/airuntime/controller/ASRResultListener.smali':[
  'onAsrResult(Ljava/lang/String;Z)V','onAudioRecordStart()V','onAudioRecordEnd()V','onStartResult(ZLjava/lang/String;)V','onError(ILjava/lang/String;)V'],
 'com/rayneo/airuntime/controller/AiResultListener.smali':[
  'onAsrResult(Ljava/lang/String;ZLjava/lang/String;)V','onAudioRecordStart()V','onAudioRecordEnd()V','onError(ILjava/lang/String;)V','onResponseComplete()V'],
 'p8/a.smali':[], 'p8/e.smali':[]}
rows=[]
for name,methods in required.items():
 data=(HOST/name).read_bytes();text=data.decode('utf-8')
 declared=re.findall(r'^\.method public (?:abstract |final )?([^\s]+)',text,re.M)
 for method in methods:
  if method not in declared:raise ValueError('Pinned interface mismatch: '+name+' '+method)
 rows.append({'path':name,'sha256':hashlib.sha256(data).hexdigest(),'required_signatures':methods})
report={'schema':1,'host':'1.0.7 (230)','pinned_host_sha256':'30239f65d910cf7008cfdf6cfacd5c068c5877068b4a637027786377a9ce4f91','kind':'static pinned-host interface evidence only',
 'interfaces':rows,'reuse_route':'Retain assistant ASR dispatch. For owned Agent capture, adapt official named ASRTask and AudioRecorderAdapter with exact request/task/route binding; reuse existing official configuration without exporting credentials.',
 'stop_evidence_limit':'stopTask/stopWorkflow return native results; hardware shutdown still requires matching end callback and fresh device idle evidence. release or destroy can clear listeners and cannot substitute for acknowledged stop.',
 'capture_or_sdk_started':False,'agent_voice_verified':False,'offline_asr_verified':False,'recording_database_transcripts_adapted':False}
(ROOT/'official-voice-107-interfaces.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'pinned_interfaces_checked':len(rows),'signatures_checked':sum(len(v) for v in required.values()),'physical_voice_or_stop_claimed':False}))
