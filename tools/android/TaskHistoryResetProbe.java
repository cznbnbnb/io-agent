package com.turboio.androidtests;
import android.app.*;import android.content.*;import android.os.*;import java.io.*;import java.lang.reflect.*;import java.nio.file.*;import java.util.*;import java.util.concurrent.*;
/** Explicit user-authorized history reset. Never part of the product APK. */
public final class TaskHistoryResetProbe extends Instrumentation {
 Bundle args; ClassLoader loader;
 public void onCreate(Bundle b){super.onCreate(b);args=b;start();}
 Class<?> type(String n)throws Exception{return loader.loadClass("com.turboio.addon."+n);}
 Object field(Object o,String n)throws Exception{Field f=(o instanceof Class?(Class<?>)o:o.getClass()).getDeclaredField(n);f.setAccessible(true);return f.get(o instanceof Class?null:o);}
 Object call(Object o,String n,Class<?>[] ts,Object... vs)throws Exception{Method m=(o instanceof Class?(Class<?>)o:o.getClass()).getDeclaredMethod(n,ts);m.setAccessible(true);return m.invoke(o instanceof Class?null:o,vs);}
 void require(boolean b,String code)throws Exception{if(!b)throw new IOException(code);}
 int erase(File f)throws Exception{if(!f.exists())return 0;require(!Files.isSymbolicLink(f.toPath()),"RESET_SYMLINK_REFUSED");int count=0;if(f.isDirectory()){File[] children=f.listFiles();require(children!=null,"RESET_DIRECTORY_UNREADABLE");for(File child:children)count+=erase(child);}else count++;require(f.delete(),"RESET_DELETE_FAILED");return count;}
 public void onStart(){Bundle out=new Bundle();try{
  require("turboio-user".equals(args.getString("confirmed_owner")),"EXPLICIT_RESET_REQUIRED");Context app=getTargetContext();loader=app.getClassLoader();
  Constructor<?> ctor=type("TaskSettings").getDeclaredConstructor(Context.class);ctor.setAccessible(true);Object settings=ctor.newInstance(app);Object device=call(settings,"loadDevice",new Class<?>[0]);require(device!=null&&"turboio-user".equals(field(device,"owner")),"RESET_OWNER_MISMATCH");
  Object voice=field(type("VoiceAnswerRuntime"),"instance");require(voice==null||field(voice,"active")==null,"RESET_VOICE_ACTIVE");
  Object tasks=field(type("TaskRuntime"),"instance"),cards=field(type("AgentCardRuntime"),"instance");
  runOnMainSync(()->{try{call(type("AgentCardRuntime"),"pause",new Class<?>[]{String.class},(Object)null);if(tasks!=null){call(tasks,"cancelAll",new Class<?>[0]);((Handler)field(tasks,"main")).removeCallbacksAndMessages(null);}if(cards!=null)((Handler)field(cards,"main")).removeCallbacksAndMessages(null);}catch(Exception e){throw new RuntimeException(e);}});
  for(Object runtime:new Object[]{tasks,voice})if(runtime!=null){ExecutorService io=(ExecutorService)field(runtime,"io");io.shutdownNow();require(io.awaitTermination(15,TimeUnit.SECONDS),"RESET_IO_STILL_ACTIVE");}
  if(tasks!=null){Object hub=field(tasks,"hub");if(hub!=null)call(hub,"close",new Class<?>[0]);}if(cards!=null)call(field(cards,"document"),"close",new Class<?>[0]);
  SharedPreferences prefs=app.getSharedPreferences("io_agent_tasks_v1",0);SharedPreferences.Editor edit=prefs.edit();for(String k:new String[]{"profiles_sealed_v2","sealed","single_backup_v1","session_directory_v1","session_default_request_v1"})edit.remove(k);require(edit.commit(),"RESET_SAVE_FAILED");
  call(settings,"saveDevice",new Class<?>[]{type("TaskDevice")},call(device,"withCursor",new Class<?>[]{String.class},""));
  SharedPreferences cardPrefs=app.getSharedPreferences("io_agent_card_preferences_v1",0);require(cardPrefs.edit().remove("offered").remove("notice_queue_v1").commit(),"RESET_CARD_PREFS_FAILED");
  int count=0;for(String path:new String[]{"task-mailbox","voice-drafts","io-agent-card-v1.json","io-agent-card-v1.json.partial","io-agent-card-v1.json.lock"})count+=erase(new File(app.getFilesDir(),path));
  File external=app.getExternalFilesDir(null);if(external!=null)count+=erase(new File(external,"io-agent-card-status.json"));
  require(((List<?>)field(call(settings,"loadAll",new Class<?>[0]),"profiles")).isEmpty(),"RESET_PROFILES_REMAIN");out.putInt("removed_history_files",count);out.putBoolean("phone_pairing_preserved",true);out.putBoolean("materials_login_audio_exports_untouched",true);finish(Activity.RESULT_OK,out);
 }catch(Throwable e){while(e.getCause()!=null)e=e.getCause();out.putString("failure_class",e.getClass().getSimpleName());String msg=e.getMessage();out.putString("failure_code",msg!=null&&msg.matches("[A-Z_]{3,80}")?msg:"RESET_FAILED");finish(Activity.RESULT_CANCELED,out);}}
}
