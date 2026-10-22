package com.rayneo.airuntime.controller;
import com.rayneo.airuntime.bridge.AudioRecorderBridge.AudioRecorderAdapter;
public final class ASRTask {
 public final ASRController controller;public final String name;public ASRResultListener listener;public AudioRecorderAdapter recorder;public RayNeoASRConfig config;
 public WorkState state=WorkState.READY;public int starts,stops,releases,stateReads;public boolean releaseAccepted;
 public ASRTask(ASRController c,String name){controller=c;this.name=name;}
 public boolean initTask(RayNeoASRConfig config,AudioRecorderAdapter adapter,ASRResultListener sink){this.config=config;recorder=adapter;listener=sink;return !controller.failInit&&adapter.onCreate();}
 public boolean startTask(){starts++;state=WorkState.WORKING;recorder.onStart();listener.onAudioRecordStart();listener.onStartResult(true,"synthetic-only");return true;}
 public boolean stopTask(){stops++;state=WorkState.STOPPED;recorder.onStop();if(controller.automaticEnd)listener.onAudioRecordEnd();return !controller.failStop;}
 public boolean releaseTask(){releases++;if(controller.throwRelease)throw new IllegalStateException("synthetic release failure");if(controller.failRelease)return false;releaseAccepted=true;return true;}
 public WorkState getTaskWorkState(){stateReads++;if(releaseAccepted&&controller.throwStateAfterRelease)throw new IllegalStateException("synthetic released state unavailable");return state;}
}
