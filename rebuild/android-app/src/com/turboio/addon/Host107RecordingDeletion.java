package com.turboio.addon;

import android.os.Looper;
import java.lang.reflect.Method;
import java.util.Map;

/** Existing stock DataStore getter only. No engine/storage initialization,
 * preference writes, HTTP, session deletion, or microphone commands. */
final class Host107RecordingDeletion implements OfficialRecordingDeletion.Source {
 public OfficialAccountBinding current(){return Host107Login.account();}
 public String read(String exactKey)throws Exception{
  MaterialWire.require(Looper.myLooper()!=Looper.getMainLooper(),"OFFICIAL_DELETION_REQUIRES_IO");
  OfficialAccountBinding account=current();
  MaterialWire.require(account!=null&&account.recordingDeletionKey().equals(exactKey),"OFFICIAL_ACCOUNT_CHANGED");
  Object engine=NavReflect.field(NavReflect.type("y8.d"),"b");
  MaterialWire.require(engine!=null,"OFFICIAL_ENGINE_UNAVAILABLE");
  Map<?,?> plugins=(Map<?,?>)NavReflect.field(NavReflect.field(engine,"d"),"a");
  Object plugin=plugins.get(NavReflect.type("za.a0"));
  MaterialWire.require(plugin!=null,"OFFICIAL_DELETION_STORE_UNAVAILABLE");
  Method getter=plugin.getClass().getDeclaredMethod("a",String.class,NavReflect.type("za.n"));
  getter.setAccessible(true);Object value=getter.invoke(plugin,exactKey,null);
  MaterialWire.require(value==null||value instanceof String&&((String)value).length()<=1048576,"OFFICIAL_DELETION_BUDGET");
  MaterialWire.require(account.same(current()),"OFFICIAL_ACCOUNT_CHANGED");
  return (String)value;
 }
}
