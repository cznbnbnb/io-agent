package com.turboio.addon;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Read-only adapter for the account-scoped official 1.0.7 deletion ledger.
 * Only the committed explicit set is admitted. Pending operations, retry IDs,
 * absent storage and historical cutoff rules never become inferred deletions.
 * The caller must revalidate immediately before a durable destructive action.
 */
final class OfficialRecordingDeletion {
 interface Source {
  OfficialAccountBinding current() throws Exception;
  String read(String exactKey) throws Exception;
 }
 static final class Snapshot {
  final String account, digest;
  final boolean present, pending, historical;
  final Set<String> committedTasks;
  private final String key;
  private Snapshot(String account,String key,String raw,Set<String> tasks,boolean pending,boolean historical){
   this.account=account;this.key=key;present=raw!=null;digest=hash(raw);
   this.pending=pending;this.historical=historical;
   committedTasks=Collections.unmodifiableSet(new TreeSet<>(tasks));
  }
  String material(String task){
   require(committedTasks.contains(task),"OFFICIAL_DELETION_NOT_COMMITTED");
   return "rayneo-lifelog-"+TaskWire.hash(WireJson.bytes(WireJson.object("provider","rayneo-lifelog","account",account,"source_type","conversation","source_id",task)));
  }
  void revalidate(Source source)throws Exception{
   admit(source,account);
   String current=source.read(key);
   admit(source,account);
   require(digest.equals(hash(current)),"OFFICIAL_DELETION_CHANGED");
  }
 }
 private static void require(boolean ok,String code){MaterialWire.require(ok,code);}
 private static String hash(String raw){
  require(raw==null||raw.getBytes(StandardCharsets.UTF_8).length<=1048576,"OFFICIAL_DELETION_BUDGET");
  return TaskWire.hash(WireJson.bytes(Arrays.asList(raw!=null,raw)));
 }
 private static void admit(Source source,String account)throws Exception{
  if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("MATERIAL_PAUSED");
  OfficialAccountBinding current=source.current();
  require(current!=null&&account.equals(current.binding),"OFFICIAL_ACCOUNT_CHANGED");
 }
 private static Set<String> tasks(Object raw){
  List<Object> values=WireJson.list(raw);require(values.size()<=10000,"OFFICIAL_DELETION_BUDGET");
  Set<String> result=new TreeSet<>();
  for(Object value:values){String id=MaterialWire.text(value,128,false);require(id.matches("[A-Za-z0-9_-]+")&&result.add(id),"OFFICIAL_DELETION_TASK_INVALID");}
  return result;
 }
 private static Set<String> operation(Object raw){
  if(raw==null)return Collections.emptySet();
  Map<String,Object> value=WireJson.map(raw);
  BoundedJson.keys(value,"id","explicitTaskIds","protectedTaskIds","cutoffMs");
  String id=MaterialWire.text(value.get("id"),128,false);require(id.matches("[A-Za-z0-9_-]+"),"OFFICIAL_DELETION_OPERATION_INVALID");
  Set<String> explicit=tasks(value.get("explicitTaskIds")),protectedIds=tasks(value.get("protectedTaskIds"));
  Object cutoff=value.get("cutoffMs");require(cutoff==null||cutoff instanceof Long&&(Long)cutoff>0&&(Long)cutoff<=9007199254740991L,"OFFICIAL_DELETION_CUTOFF_INVALID");
  require(Collections.disjoint(explicit,protectedIds),"OFFICIAL_DELETION_OPERATION_INVALID");
  return protectedIds;
 }
 static Snapshot read(OfficialAccountBinding expected,Source source)throws Exception{
  require(expected!=null&&source!=null,"OFFICIAL_ACCOUNT_REQUIRED");
  String account=expected.binding,key=expected.recordingDeletionKey();
  admit(source,account);String raw=source.read(key);admit(source,account);hash(raw);
  Set<String> committed=new TreeSet<>();boolean pending=false,historical=false;
  if(raw!=null){
   Map<String,Object> ledger=WireJson.map(WireJson.read(raw.getBytes(StandardCharsets.UTF_8),1048576,100000));
   BoundedJson.keys(ledger,"deletedTaskIds","serverDeletionRetryTaskIds","pending","deleteAll");
   committed=tasks(ledger.get("deletedTaskIds"));tasks(ledger.get("serverDeletionRetryTaskIds"));
   pending=ledger.get("pending")!=null;historical=ledger.get("deleteAll")!=null;
   operation(ledger.get("pending"));Set<String> protectedIds=operation(ledger.get("deleteAll"));
   // A concurrent original operation is allowed to roll back. Wait for its
   // settled snapshot; do not promote its explicit list or its retry queue.
   if(pending)committed.clear();else committed.removeAll(protectedIds);
  }
  Snapshot result=new Snapshot(account,key,raw,committed,pending,historical);
  result.revalidate(source);return result;
 }
}
