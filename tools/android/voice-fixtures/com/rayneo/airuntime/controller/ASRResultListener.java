package com.rayneo.airuntime.controller;
public interface ASRResultListener {
 void onAsrResult(String text,boolean finished);void onAudioRecordStart();void onAudioRecordEnd();
 void onError(int code,String message);void onStartResult(boolean success,String message);
 void onProactiveHint(RayNeoProactiveHint hint);void onVadStatusChange(int state);
}
