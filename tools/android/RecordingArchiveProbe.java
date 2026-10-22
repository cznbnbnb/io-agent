package com.turboio.androidtests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import java.io.*;
import java.lang.reflect.*;
import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;
import org.json.JSONObject;

/** Reads one retained diagnostic attempt through the installed product's strict
 * parser and evidence verifier. No journal/archive constructors, SDK, activity
 * launch, network, task submission or readiness writes are used. */
public final class RecordingArchiveProbe extends Instrumentation {
 private static final Class<?>[] NONE=new Class<?>[0];
 private String nonce="",attempt="";private ClassLoader loader;private boolean saveAttempted;
 private Path root,draftPath,manifestPath;private byte[] draftBefore,manifestBefore;
 private static void check(boolean value,String code){if(!value)throw new IllegalStateException(code);}
 private Class<?> type(String name)throws Exception{return loader.loadClass("com.turboio.addon."+name);}
 private Object call(Object owner,String name,Class<?>[] signature,Object...arguments)throws Exception{
  Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();Method m=c.getDeclaredMethod(name,signature);m.setAccessible(true);return m.invoke(owner instanceof Class?null:owner,arguments);
 }
 private static String safeError(Throwable error){
  for(int depth=0;depth<12&&error.getCause()!=null;depth++)error=error.getCause();
  String message=error.getMessage();return message!=null&&message.matches("(?:ARCHIVE_PROBE|VOICE|WIRE)_[A-Z0-9_]{1,70}")?message:"ARCHIVE_PROBE_FAILED";
 }
 private Path checked(Path file,boolean directory)throws Exception{
  Path normalized=file.toAbsolutePath().normalize();check(normalized.startsWith(root)&&!normalized.equals(root),"ARCHIVE_PROBE_PATH_INVALID");
  check(!Files.isSymbolicLink(root)&&root.toRealPath().equals(root),"ARCHIVE_PROBE_PATH_INVALID");
  Path cursor=root;for(Path part:root.relativize(normalized)){cursor=cursor.resolve(part);check(!Files.isSymbolicLink(cursor),"ARCHIVE_PROBE_PATH_INVALID");}
  check(normalized.toRealPath().equals(normalized),"ARCHIVE_PROBE_PATH_INVALID");
  BasicFileAttributes attrs=Files.readAttributes(normalized,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
  check(directory?attrs.isDirectory():attrs.isRegularFile(),"ARCHIVE_PROBE_PATH_INVALID");return normalized;
 }
 private byte[] read(Path file,int budget)throws Exception{
  Path actual=checked(file,false);BasicFileAttributes before=Files.readAttributes(actual,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
  check(before.size()>0&&before.size()<=budget,"ARCHIVE_PROBE_FILE_BUDGET");
  ByteArrayOutputStream output=new ByteArrayOutputStream((int)before.size());ByteBuffer block=ByteBuffer.allocate(8192);
  try(SeekableByteChannel input=Files.newByteChannel(actual,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){
   int count;while((count=input.read(block))!=-1){check(output.size()+count<=budget,"ARCHIVE_PROBE_FILE_BUDGET");output.write(block.array(),0,count);block.clear();}
  }
  checked(actual,false);BasicFileAttributes after=Files.readAttributes(actual,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
  check(output.size()==before.size()&&before.size()==after.size()&&before.lastModifiedTime().equals(after.lastModifiedTime())&&Objects.equals(before.fileKey(),after.fileKey()),"ARCHIVE_PROBE_FILE_CHANGED");return output.toByteArray();
 }
 private Map<?,?> parse(byte[] bytes,int budget,int nodes)throws Exception{
  Object value=call(type("WireJson"),"read",new Class<?>[]{byte[].class,int.class,int.class},bytes,budget,nodes);check(value instanceof Map,"ARCHIVE_PROBE_DOCUMENT_INVALID");return (Map<?,?>)value;
 }
 private static long number(Map<?,?> value,String key){Object n=value.get(key);check(n instanceof Long&&((Long)n)>=0,"ARCHIVE_PROBE_NUMBER_INVALID");return (Long)n;}
 private void noPartial(Path document)throws Exception{check(!Files.exists(Paths.get(document.toString()+".partial"),LinkOption.NOFOLLOW_LINKS),"ARCHIVE_PROBE_PARTIAL");}
 private boolean unchanged()throws Exception{
  if(draftBefore==null||manifestBefore==null||draftPath==null||manifestPath==null)return false;
  noPartial(draftPath);noPartial(manifestPath);
  return Arrays.equals(draftBefore,read(draftPath,2097152))&&Arrays.equals(manifestBefore,read(manifestPath,65536));
 }
 @Override public void onCreate(Bundle args){super.onCreate(args);if(args!=null){nonce=args.getString("probe_id","");attempt=args.getString("attempt_id","");}start();}
 @Override public void onStart(){
  Bundle result=new Bundle();JSONObject audit=new JSONObject();boolean passed=false,same=false;String error="";
  try{
   check(nonce.matches("[a-f0-9]{32}")&&attempt.matches("[a-f0-9]{32}")&&!nonce.equals(attempt),"ARCHIVE_PROBE_ID_INVALID");
   check("com.rayneo.venus.pub".equals(getTargetContext().getPackageName()),"ARCHIVE_PROBE_CANDIDATE_MISMATCH");
   PackageInfo info=getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(),0);
   check(info.getLongVersionCode()==10423&&"0.5.3-dev1".equals(info.versionName),"ARCHIVE_PROBE_CANDIDATE_MISMATCH");loader=getTargetContext().getClassLoader();
   // Resolve the OS /data/data alias once; all descendants must then be exact
   // canonical, non-symlink paths beneath this app's canonical files directory.
   File data=new File(getTargetContext().getApplicationInfo().dataDir).getCanonicalFile();File files=getTargetContext().getFilesDir().getCanonicalFile();
   check(files.getParentFile().equals(data)&&files.getName().equals("files")&&!Files.isSymbolicLink(files.toPath())&&files.isDirectory(),"ARCHIVE_PROBE_PATH_INVALID");root=files.toPath();
   Path base=checked(root.resolve("voice-probes"),true),isolated=checked(base.resolve(attempt),true);
   draftPath=checked(isolated.resolve("voice-drafts").resolve(attempt+".json"),false);noPartial(draftPath);draftBefore=read(draftPath,2097152);
   final Map<?,?> document=parse(draftBefore,2097152,10000);
   check("REVIEW".equals(document.get("phase"))&&Boolean.FALSE.equals(document.get("needs_stop"))&&Boolean.FALSE.equals(document.get("cancelled"))&&Boolean.TRUE.equals(document.get("engine_end"))&&Boolean.TRUE.equals(document.get("engine_stopped"))&&Boolean.TRUE.equals(document.get("device_stopped"))&&"".equals(document.get("error")),"ARCHIVE_PROBE_DRAFT_NOT_READY");
   Object token=document.get("token");check(token instanceof String&&((String)token).matches("[a-f0-9]{32}"),"ARCHIVE_PROBE_OWNER_INVALID");
   manifestPath=checked(isolated.resolve("voice-audio").resolve((String)token).resolve("source.json"),false);noPartial(manifestPath);manifestBefore=read(manifestPath,65536);
   Map<?,?> manifest=parse(manifestBefore,65536,256);
   Class<?> storeType=type("VoiceAnswerSession$Store");Object store=Proxy.newProxyInstance(storeType.getClassLoader(),new Class<?>[]{storeType},(proxy,method,arguments)->{
    if(method.getDeclaringClass()==Object.class){if(method.getName().equals("equals"))return proxy==arguments[0];if(method.getName().equals("hashCode"))return System.identityHashCode(proxy);return "readonly-archive-store";}
    if(method.getName().equals("read"))return document;
    if(method.getName().equals("save")){saveAttempted=true;throw new IOException("ARCHIVE_PROBE_WRITE_FORBIDDEN");}
    throw new IOException("ARCHIVE_PROBE_STORE_METHOD_INVALID");
   });
   Constructor<?> constructor=type("VoiceAnswerSession").getDeclaredConstructor(storeType);constructor.setAccessible(true);Object draft=constructor.newInstance(store);
   check(!saveAttempted&&Boolean.TRUE.equals(call(draft,"healthy",NONE))&&"REVIEW".equals(call(draft,"phase",NONE))&&Boolean.FALSE.equals(call(draft,"needsStop",NONE)),"ARCHIVE_PROBE_SESSION_INVALID");
   call(type("VoiceAnswerEvidence"),"verify",new Class<?>[]{File.class,type("VoiceAnswerSession")},isolated.toFile(),draft);
   long stopAt=number(document,"stop_at"),stopSent=number(document,"stop_sent");check(stopAt>0&&stopSent>=stopAt,"ARCHIVE_PROBE_STOP_ORDER_INVALID");
   Object rawSegments=document.get("segments");check(rawSegments instanceof List,"ARCHIVE_PROBE_SEGMENTS_INVALID");List<?> segments=(List<?>)rawSegments;StringJoiner words=new StringJoiner("\n");
   for(Object item:segments){check(item instanceof Map,"ARCHIVE_PROBE_SEGMENTS_INVALID");Map<?,?> segment=(Map<?,?>)item;check(Boolean.TRUE.equals(segment.get("final"))&&segment.get("text") instanceof String,"ARCHIVE_PROBE_SEGMENTS_INVALID");words.add((String)segment.get("text"));}
   String text=words.toString();boolean preview=text.contains("预览"),noChange=text.contains("不要修改文件"),keep=text.contains("保留全部资料"),friday=text.contains("星期五")||text.contains("周五");
   JSONObject terminal=new JSONObject().put("phase","REVIEW").put("needs_stop",false).put("cancelled",false).put("engine_end",true).put("engine_stopped",true).put("device_stopped",true).put("error_empty",true).put("stop_at_positive",stopAt>0).put("stop_sent_positive",stopSent>0).put("stop_sent_at_or_after_stop_at",stopSent>=stopAt).put("all_segments_final",true).put("segment_count",segments.size()).put("transcript_character_count",text.codePointCount(0,text.length())).put("expected_preview_retained",preview).put("expected_no_file_change_retained",noChange).put("expected_keep_materials_retained",keep).put("expected_friday_retained",friday);
   JSONObject audio=new JSONObject();for(String name:new String[]{"frames","decoded_frames","wire_bytes","pcm_bytes","samples","nonzero_samples","peak"})audio.put(name,number(manifest,name));
   for(String name:new String[]{"sealed","complete","recording_source_complete"}){check(Boolean.TRUE.equals(manifest.get(name)),"ARCHIVE_PROBE_SOURCE_INCOMPLETE");audio.put(name,true);}
   audit.put("terminal",terminal).put("archive",audio).put("product_evidence_verified",true).put("retained_attempt_only",true).put("new_capture_performed",false);
   check(preview&&noChange&&keep&&friday,"ARCHIVE_PROBE_EXPECTED_CONDITIONS_MISSING");passed=true;
  }catch(Throwable failure){error=safeError(failure);}
  finally{
   try{same=unchanged();}catch(Throwable failure){if(error.isEmpty())error=safeError(failure);}
   passed=passed&&same&&!saveAttempted;if(!same&&error.isEmpty())error="ARCHIVE_PROBE_STATE_UNCONFIRMED";
   result.putString("probe_id",nonce.matches("[a-f0-9]{32}")?nonce:"");result.putString("audit",audit.toString());result.putString("error",error);result.putBoolean("passed",passed);result.putBoolean("state_unchanged",same);result.putBoolean("completed",true);
   result.putInt("network_requests",0);result.putBoolean("microphone_started",false);result.putBoolean("readiness_created",false);result.putBoolean("task_or_answer_submitted",false);result.putBoolean("credentials_or_text_exported",false);result.putBoolean("store_write_attempted",saveAttempted);result.putBoolean("files_written",false);
   finish(passed?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
  }
 }
}
