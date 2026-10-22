package com.turboio.androidtests;

import android.app.*;
import android.content.*;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.os.SystemClock;
import java.io.*;
import java.lang.reflect.*;
import java.nio.*;
import java.nio.channels.*;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Read-only local log shape probe for product 10423. No activity launch, HTTP,
 * signing-key lookup, direct token-value inspection, queue parsing or mutation.
 * The existing official account gate may internally decode its existing token;
 * this probe uses only its returned account binding, never a session/token value.
 * Configuration/queue bytes are hashed only for an internal before/after fence. */
public final class GatewayHeaderShapeProbe extends Instrumentation {
 private String probeId,accountBinding;private ClassLoader loader;private boolean accountGateUsed;
 private static void check(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 private Object call(Object owner,String name,Class<?>[] params,Object...values)throws Exception{Class<?> type=owner instanceof Class?(Class<?>)owner:owner.getClass();Method method=type.getDeclaredMethod(name,params);method.setAccessible(true);return method.invoke(owner instanceof Class?null:owner,values);}
 private String account()throws Exception{
  accountGateUsed=true;
  Object value=call(loader.loadClass("com.turboio.addon.Host107Login"),"account",new Class<?>[0]);check(value!=null,"HEADER_SHAPE_ACCOUNT_UNAVAILABLE");Field field=value.getClass().getDeclaredField("binding");field.setAccessible(true);Object binding=field.get(value);check(binding instanceof String&&!((String)binding).isEmpty(),"HEADER_SHAPE_ACCOUNT_UNAVAILABLE");return (String)binding;
 }
 private String awaitAccount()throws Exception{
  long deadline=SystemClock.elapsedRealtime()+15000;
  while(true){try{return account();}catch(IllegalStateException unavailable){
   if(!"HEADER_SHAPE_ACCOUNT_UNAVAILABLE".equals(unavailable.getMessage()))throw unavailable;
   long remaining=deadline-SystemClock.elapsedRealtime();if(remaining<=0)throw unavailable;SystemClock.sleep(Math.min(200,remaining));
  }}
 }
 private void admit()throws Exception{check(accountBinding!=null&&accountBinding.equals(account()),"HEADER_SHAPE_ACCOUNT_CHANGED");}
 private static boolean canonical(File file)throws IOException{return file.getAbsoluteFile().equals(file.getCanonicalFile())&&!Files.isSymbolicLink(file.toPath());}
 private static BasicFileAttributes attrs(File file)throws IOException{return Files.readAttributes(file.toPath(),BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);}
 private static boolean same(BasicFileAttributes a,BasicFileAttributes b){return a.isRegularFile()&&b.isRegularFile()&&a.size()==b.size()&&a.lastModifiedTime().equals(b.lastModifiedTime())&&Objects.equals(a.fileKey(),b.fileKey());}
 private static String digest(File file,File root,int budget)throws Exception{
  check(canonical(file)&&file.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator),"HEADER_SHAPE_STATE_PATH_INVALID");BasicFileAttributes before=attrs(file);check(before.isRegularFile()&&before.size()<=budget,"HEADER_SHAPE_STATE_BUDGET");MessageDigest digest=MessageDigest.getInstance("SHA-256");long count=0;ByteBuffer buffer=ByteBuffer.allocate(8192);
  try(SeekableByteChannel input=Files.newByteChannel(file.toPath(),StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){while(true){buffer.clear();int n=input.read(buffer);if(n<0)break;check(n>0,"HEADER_SHAPE_STATE_READ_STALLED");count+=n;check(count<=budget,"HEADER_SHAPE_STATE_BUDGET");digest.update(buffer.array(),0,n);}}
  finally{Arrays.fill(buffer.array(),(byte)0);}
  check(count==before.size()&&same(before,attrs(file)),"HEADER_SHAPE_STATE_CHANGED");StringBuilder hex=new StringBuilder();for(byte b:digest.digest())hex.append(String.format(Locale.ROOT,"%02x",b&255));return hex.toString();
 }
 private static final class State{
  final String settings;final Map<String,String> queues;State(String settings,Map<String,String> queues){this.settings=settings;this.queues=queues;}
 }
 private State state(File root)throws Exception{
  // Never parse either file kind or export paths containing account bindings.
  File prefs=new File(root,"shared_prefs");check(canonical(prefs)&&prefs.isDirectory(),"HEADER_SHAPE_STATE_PATH_INVALID");String settings=digest(new File(prefs,"io_agent_materials_v1.xml"),root,1048576);
  File files=new File(root,"files");check(canonical(files)&&files.isDirectory(),"HEADER_SHAPE_STATE_PATH_INVALID");Map<String,String> queues=new TreeMap<>();Deque<File> pending=new ArrayDeque<>();pending.add(files);int dirs=0,entries=0;long total=0;
  while(!pending.isEmpty()){
   check(++dirs<=512,"HEADER_SHAPE_STATE_ENUMERATION_BUDGET");File parent=pending.removeFirst();check(canonical(parent)&&parent.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator),"HEADER_SHAPE_STATE_PATH_INVALID");
   try(DirectoryStream<Path> children=Files.newDirectoryStream(parent.toPath())){for(Path path:children){check(++entries<=8192,"HEADER_SHAPE_STATE_ENUMERATION_BUDGET");File file=path.toFile();check(canonical(file),"HEADER_SHAPE_STATE_PATH_INVALID");BasicFileAttributes a=attrs(file);if(a.isDirectory()){check(file.toPath().getNameCount()-files.toPath().getNameCount()<=8,"HEADER_SHAPE_STATE_ENUMERATION_BUDGET");pending.addLast(file);}
    else if(a.isRegularFile()&&file.getName().equals("state.json")&&parent.getParentFile()!=null&&parent.getParentFile().getName().equals("material-outbox")){total+=a.size();check(total<=33554432L&&queues.size()<128,"HEADER_SHAPE_STATE_BUDGET");queues.put(file.getCanonicalPath(),digest(file,root,8388608));}
   }}
  }
  check(!queues.isEmpty(),"HEADER_SHAPE_QUEUE_UNAVAILABLE");return new State(settings,queues);
 }
 private static final class Source{final File file;final BasicFileAttributes attrs;Source(File file,BasicFileAttributes attrs){this.file=file;this.attrs=attrs;}}
 private JSONObject scan(File root)throws Exception{
  JSONObject audit=new JSONObject();JSONArray records=new JSONArray();audit.put("records",records).put("max_files",4).put("max_tail_bytes_per_file",4194304).put("max_total_bytes",16777216).put("max_line_bytes",1048576).put("max_shapes",64).put("request_pairing_id_verified",false).put("pairing_status","no_supported_correlation_id_verified").put("adjacency_used_for_pairing",false);
  File flutter=new File(root,"app_flutter"),directory=new File(flutter,"appLog");check(canonical(flutter)&&flutter.isDirectory(),"HEADER_SHAPE_LOG_PATH_INVALID");if(!directory.exists()){audit.put("directory_present",false);return audit;}check(canonical(directory)&&directory.isDirectory(),"HEADER_SHAPE_LOG_PATH_INVALID");audit.put("directory_present",true);
  String boundary=directory.getCanonicalPath()+File.separator;Deque<File> pending=new ArrayDeque<>();pending.add(directory);PriorityQueue<Source> latest=new PriorityQueue<>(Comparator.comparingLong((Source s)->s.attrs.lastModifiedTime().toMillis()).thenComparing(s->s.file.getName()));int visited=0,entries=0,eligible=0,skipped=0;
  while(!pending.isEmpty()){
   check(++visited<=128,"HEADER_SHAPE_LOG_ENUMERATION_BUDGET");File parent=pending.removeFirst();if(!canonical(parent)){skipped++;continue;}
   try(DirectoryStream<Path> children=Files.newDirectoryStream(parent.toPath())){for(Path path:children){check(++entries<=4096,"HEADER_SHAPE_LOG_ENUMERATION_BUDGET");File file=path.toFile();if(!canonical(file)||!file.getCanonicalPath().startsWith(boundary)){skipped++;continue;}BasicFileAttributes a=attrs(file);if(a.isDirectory())pending.addLast(file);else if(a.isRegularFile()&&file.getName().endsWith(".log")){eligible++;latest.add(new Source(file,a));if(latest.size()>4)latest.remove();}}}
  }
  audit.put("eligible_log_files",eligible).put("skipped_paths",skipped);List<Source> selected=new ArrayList<>(latest);selected.sort(Comparator.comparingLong((Source s)->s.attrs.lastModifiedTime().toMillis()).reversed());Map<String,JSONObject> shapes=new LinkedHashMap<>();int scanned=0,changed=0,heads=0,tails=0,oversized=0,accepted=0,shapeLimit=0;long total=0;
  for(Source source:selected){admit();File file=source.file;check(canonical(file)&&file.getCanonicalPath().startsWith(boundary),"HEADER_SHAPE_LOG_PATH_INVALID");BasicFileAttributes before=attrs(file);if(!same(source.attrs,before)){changed++;continue;}long offset=Math.max(0,before.size()-4194304);int size=(int)(before.size()-offset);check(total+size<=16777216,"HEADER_SHAPE_LOG_BUDGET");byte[] bytes=new byte[size];
   try{
    ByteBuffer buffer=ByteBuffer.wrap(bytes);try(SeekableByteChannel input=Files.newByteChannel(file.toPath(),StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){input.position(offset);while(buffer.hasRemaining()){int n=input.read(buffer);check(n>0,"HEADER_SHAPE_LOG_CHANGED");}}
    total+=size;scanned++;if(!canonical(file)||!same(before,attrs(file))){changed++;continue;}
    int start=0;boolean discard=offset>0;if(discard)heads++;
    for(int i=0;i<size;i++){if(bytes[i]!=10)continue;int end=i>start&&bytes[i-1]==13?i-1:i;if(!discard){if(end-start>1048576)oversized++;else{byte[] line=Arrays.copyOfRange(bytes,start,end);Map<String,Object> row;try{row=GatewayHeaderShapeParser.parse(line);}finally{Arrays.fill(line,(byte)0);}if(row!=null){accepted++;JSONObject json=new JSONObject(row);String key=json.toString();JSONObject prior=shapes.get(key);if(prior!=null)prior.put("occurrences",prior.getInt("occurrences")+1);else if(shapes.size()<64){json.put("occurrences",1);shapes.put(key,json);records.put(json);}else shapeLimit++;}}}discard=false;start=i+1;}
    if(start<size)tails++;
   }finally{Arrays.fill(bytes,(byte)0);}admit();
  }
  return audit.put("files_scanned",scanned).put("bytes_scanned",total).put("changed_files_skipped",changed).put("partial_heads_skipped",heads).put("partial_tails_skipped",tails).put("oversized_lines_skipped",oversized).put("accepted_calendar_records",accepted).put("unreported_shapes",shapeLimit).put("deduplicated_sanitized_shapes",true).put("complete_history",false);
 }
 @Override public void onCreate(Bundle args){super.onCreate(args);probeId=args==null?"":args.getString("probe_id","");start();}
 @Override public void onStart(){Bundle result=new Bundle();JSONObject audit=new JSONObject();Context context=getTargetContext();File root=null;State before=null;boolean passed=false;
  try{check(probeId.matches("[a-f0-9]{32}"),"HEADER_SHAPE_PROBE_ID_INVALID");check("com.rayneo.venus.pub".equals(context.getPackageName()),"HEADER_SHAPE_HOST_MISMATCH");PackageInfo pkg=context.getPackageManager().getPackageInfo(context.getPackageName(),0);check(pkg.getLongVersionCode()==10423&&"0.5.3-dev1".equals(pkg.versionName),"HEADER_SHAPE_HOST_MISMATCH");loader=context.getClassLoader();accountBinding=awaitAccount();root=new File(context.getApplicationInfo().dataDir).getCanonicalFile();check(canonical(root)&&root.isDirectory(),"HEADER_SHAPE_STATE_PATH_INVALID");before=state(root);admit();audit=scan(root);admit();passed=true;
  }catch(Throwable error){while(error.getCause()!=null)error=error.getCause();String code=error.getMessage();result.putString("error",code!=null&&code.matches("HEADER_SHAPE_[A-Z_]+")?code:"HEADER_SHAPE_FAILED");}
  finally{
   boolean stable=false;try{admit();State after=root==null?null:state(root);boolean config=before!=null&&after!=null&&before.settings.equals(after.settings),queues=before!=null&&after!=null&&before.queues.equals(after.queues);result.putBoolean("account_binding_unchanged",true);result.putBoolean("material_settings_bytes_unchanged",config);result.putBoolean("queue_bytes_unchanged",queues);result.putInt("queue_files_checked",before==null?0:before.queues.size());stable=config&&queues;}catch(Throwable unavailable){result.putBoolean("state_proof_unavailable",true);}passed&=stable;
   result.putString("probe_id",probeId);result.putBoolean("passed",passed);result.putBoolean("completed",true);result.putBoolean("state_unchanged",stable);result.putInt("network_requests",0);result.putBoolean("activity_started",false);result.putString("activity_started_scope","probe_only_caller_may_start_normal_main_activity");result.putBoolean("mutations_attempted",false);result.putBoolean("official_account_gate_used",accountGateUsed);result.putBoolean("official_account_gate_may_decode_existing_token",true);result.putBoolean("direct_user_token_values_inspected",false);result.putBoolean("signing_key_read",false);result.putBoolean("signing_header_values_exported",false);result.putBoolean("credentials_or_private_text_exported",false);result.putString("audit",audit.toString());finish(passed?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
  }
 }
}
