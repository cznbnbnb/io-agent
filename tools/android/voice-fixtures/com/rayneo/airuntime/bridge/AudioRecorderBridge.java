package com.rayneo.airuntime.bridge;
public final class AudioRecorderBridge {
 public abstract static class AudioRecorderAdapter {
  public byte[] retained;public int starts,stops;
  public final void notifyRecordData(byte[] value){retained=value;}
  public final void notifyRecordStart(){starts++;}public final void notifyRecordStop(){stops++;}
  public abstract boolean onCreate();public abstract boolean onDestroy();public abstract boolean onPause();
  public abstract boolean onResume();public abstract boolean onStart();public abstract boolean onStop();
 }
}
