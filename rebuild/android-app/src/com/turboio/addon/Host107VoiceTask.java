package com.turboio.addon;

import java.lang.reflect.*;
import java.util.*;

/** One named official ASR task fed by owned external PCM. This adapter never opens a mic. */
final class Host107VoiceTask {
 interface Listener {
  void result(String text,boolean finished);
  void started(boolean accepted);
  void engineAudio(boolean started);
  void error(String code);
 }
 private static final String BASE="com.rayneo.airuntime.controller.";
 private final Object controller,task,recorder,callback;
 private final String token,name;
 private final Listener listener;
 private boolean startAttempted,inputSealed,stopAccepted,taskReleaseAccepted,destroyCompleted,releaseTerminalProven;
 private volatile boolean releaseStarted;
 private volatile boolean closed;
 private volatile boolean engineEnded;

 private static Class<?> type(String name)throws ReflectiveOperationException{return Class.forName(Host107Abi.className(name));}
 private static Object call(Object target,String method,Class<?>[] signature,Object...args)throws ReflectiveOperationException{
  return target.getClass().getMethod(method,signature).invoke(target,args);
 }
 private static Object call(Object target,String method)throws ReflectiveOperationException{return call(target,method,new Class<?>[0]);}
 private static void require(boolean condition,String code){if(!condition)throw new IllegalStateException(code);}
 private void notifyEvent(Runnable event){try{event.run();}catch(RuntimeException ignored){/* The owner keeps its stop obligation. */}}

 static Host107VoiceTask prepare(Object controller,Object config,String token,Listener listener)throws ReflectiveOperationException{
  require(token!=null&&token.matches("[a-f0-9]{32}")&&listener!=null,"VOICE_OWNER_INVALID");
  require(controller!=null&&controller.getClass()==type(BASE+"ASRController")&&config!=null&&config.getClass()==type(BASE+"RayNeoASRConfig"),"VOICE_HOST_MISMATCH");
  require("pcm".equals(call(config,"getInputAudioFormat"))&&Integer.valueOf(16000).equals(call(config,"getInputAudioRate")),"VOICE_PCM_CONFIG_INVALID");
  return new Host107VoiceTask(controller,config,token,listener);
 }
 private Host107VoiceTask(Object controller,Object config,String token,Listener listener)throws ReflectiveOperationException{
  this.controller=controller;this.token=token;this.listener=listener;name="io_agent_asr_"+token;
  // The pinned host's p8.o only forwards lifecycle notifications. Unlike p8.b it does not
  // create TYAudioRecorder/AudioRecord. Do not borrow stock AskAI/teleprompter task names.
  recorder=type("p8.o").getConstructor().newInstance();
  Class<?> result=type(BASE+"ASRResultListener");
  callback=Proxy.newProxyInstance(result.getClassLoader(),new Class<?>[]{result},(proxy,method,args)->{
   if(method.getDeclaringClass()==Object.class){
    if(method.getName().equals("equals"))return proxy==args[0];
    if(method.getName().equals("hashCode"))return System.identityHashCode(proxy);
    return "iO Agent ASR listener";
   }
   if(closed||releaseStarted)return null;
   switch(method.getName()){
    case "onAsrResult":
     if(args!=null&&args.length==2&&args[0] instanceof String&&args[1] instanceof Boolean){
      String text=(String)args[0];boolean finished=(Boolean)args[1];
      if(text.codePointCount(0,text.length())<=65536)notifyEvent(()->listener.result(text,finished));
      else notifyEvent(()->listener.error("VOICE_TRANSCRIPT_TOO_LONG"));
     }else notifyEvent(()->listener.error("VOICE_CALLBACK_INVALID"));break;
    case "onStartResult":
     boolean accepted=args!=null&&args.length==2&&Boolean.TRUE.equals(args[0]);
     notifyEvent(()->listener.started(accepted));break;
    case "onAudioRecordStart":engineEnded=false;notifyEvent(()->listener.engineAudio(true));break;
    case "onAudioRecordEnd":engineEnded=true;notifyEvent(()->listener.engineAudio(false));break;
    case "onError":notifyEvent(()->listener.error("VOICE_ENGINE_ERROR"));break;
    case "onProactiveHint":case "onVadStatusChange":break;
    default:notifyEvent(()->listener.error("VOICE_CALLBACK_INVALID"));
   }
   return null;
  });
  task=call(controller,"createTask",new Class<?>[]{String.class},name);
  require(task!=null&&task.getClass()==type(BASE+"ASRTask"),"VOICE_TASK_UNAVAILABLE");
  try{
   Object ok=call(task,"initTask",new Class<?>[]{type(BASE+"RayNeoASRConfig"),type("com.rayneo.airuntime.bridge.AudioRecorderBridge$AudioRecorderAdapter"),result},config,recorder,callback);
   require(Boolean.TRUE.equals(ok),"VOICE_TASK_INIT_FAILED");
  }catch(ReflectiveOperationException|RuntimeException failure){
   // No start has been attempted and this is an external-data adapter, so only our name
   // may be released. Never stop/destroy the controller or another host workflow.
   try{call(task,"releaseTask");}catch(ReflectiveOperationException ignored){}
   try{call(controller,"destroyTask",new Class<?>[]{String.class},name);}catch(ReflectiveOperationException ignored){}
   throw failure;
  }
 }
 String token(){return token;}
 synchronized boolean start(String owner)throws ReflectiveOperationException{
  require(token.equals(owner)&&!closed&&!releaseStarted&&!startAttempted,"VOICE_OWNER_INVALID");
  startAttempted=true;return Boolean.TRUE.equals(call(task,"startTask"));
 }
 synchronized void pcm(String owner,byte[] pcm)throws ReflectiveOperationException{
  require(token.equals(owner)&&!closed&&!releaseStarted&&startAttempted&&!inputSealed,"VOICE_INPUT_CLOSED");
  require(pcm!=null&&pcm.length>0&&pcm.length<=32768&&pcm.length%2==0,"VOICE_PCM_INVALID");
  require(state().equals("WORKING"),"VOICE_ENGINE_NOT_WORKING");
  // The vendor may retain its array beyond this call. Never mutate it after admission.
  call(recorder,"notifyRecordData",new Class<?>[]{byte[].class},(Object)pcm.clone());
 }
 synchronized boolean stop(String owner)throws ReflectiveOperationException{
  require(token.equals(owner)&&!closed&&!releaseStarted,"VOICE_OWNER_INVALID");
  inputSealed=true;stopAccepted=Boolean.TRUE.equals(call(task,"stopTask"));return stopAccepted;
 }
 /** Signal the end of our external PCM stream without conflating it with stopping
  * the glasses. Native callbacks may still finish the last sentence afterwards. */
 synchronized void sealInput(String owner)throws ReflectiveOperationException{
  require(token.equals(owner)&&!closed&&!releaseStarted&&startAttempted,"VOICE_OWNER_INVALID");
  if(inputSealed)return;
  inputSealed=true;call(recorder,"notifyRecordStop");
 }
 synchronized String state()throws ReflectiveOperationException{
  require(!closed&&!releaseStarted,"VOICE_TASK_CLOSED");Object value=call(task,"getTaskWorkState");
  require(value instanceof Enum&&value.getClass()==type(BASE+"WorkState"),"VOICE_STATE_INVALID");return ((Enum<?>)value).name();
 }
 synchronized boolean engineStopped()throws ReflectiveOperationException{
  // The physical 1.0.7 named external-data task reports STOPPED after accepted stop
  // without onAudioRecordEnd. Verify our sealed task's native state independently.
  // This does not certify physical glasses mic stop or transcript completeness.
  if(releaseStarted)return !closed&&releaseTerminalProven;
  return !closed&&startAttempted&&inputSealed&&stopAccepted&&new HashSet<>(Arrays.asList("STOPPED","TERMINATED")).contains(state());
 }
 synchronized void release(String owner)throws ReflectiveOperationException{
  require(token.equals(owner)&&!closed&&!destroyCompleted,"VOICE_OWNER_INVALID");
  if(!releaseStarted){
   // Capture actual accepted-stop + terminal-state evidence before touching the
   // release API. Neither releaseTask's boolean nor map removal proves STOPPED.
   boolean terminal=startAttempted&&engineStopped();require(!startAttempted||terminal,"VOICE_STOP_UNCONFIRMED");
   releaseTerminalProven=terminal;inputSealed=true;releaseStarted=true;
  }
  // SDK acceptance is call-level evidence only. A failed/throwing release can
  // retry this stage; after acceptance, destroy retry never re-releases the
  // native task or queries its potentially invalidated state. Opening, PCM,
  // callbacks and ordinary state/stop access remain fenced throughout.
  if(!taskReleaseAccepted){require(Boolean.TRUE.equals(call(task,"releaseTask")),"VOICE_RELEASE_FAILED");taskReleaseAccepted=true;}
  call(controller,"destroyTask",new Class<?>[]{String.class},name);destroyCompleted=true;closed=true;
 }
}
