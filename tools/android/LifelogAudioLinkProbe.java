package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.lang.reflect.*;import java.net.*;import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.security.*;import java.util.*;import java.util.regex.*;
import org.json.*;
import com.turboio.androidtests.voice.OfficialHiveCache;
import com.turboio.androidtests.voice.OfficialLifelogLogReader;
import com.turboio.androidtests.voice.OfficialLifelogSnapshot;

/** Read existing normal-process metadata and bounded official logs. No HTTP or
 * audio bytes; emitted identifiers are hashes. Log coincidence is not ownership. */
public final class LifelogAudioLinkProbe extends Instrumentation {
 private String nonce;private JSONObject saved;private String snapshotError="";private ClassLoader loader;
 private final Set<String> sourceIds=new HashSet<>(),sourceHashes=new HashSet<>(),taskHashes=new HashSet<>(),roundHashes=new HashSet<>();
 private final Map<String,Set<String>> clips=new HashMap<>();
 private final Set<String> edges=new LinkedHashSet<>();private final Map<String,Integer> counts=new TreeMap<>();
 private final Set<String> idKeys=new HashSet<>(Arrays.asList("id","taskId","dialogId","conversationId","roundId","sourceId","clipId","sessionId"));
 private final Pattern ids=Pattern.compile("\\b(taskId|dialogId|roundId|conversationId|sourceId|clipId)[=:\\s\"]{1,5}([A-Za-z0-9_.:-]{1,128})");
 private int nodes,files,oversized,partial;private long scanned;private boolean limited;
 private static void check(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 private static String hash(String value)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))){int n=b&255;out.append("0123456789abcdef".charAt(n>>>4)).append("0123456789abcdef".charAt(n&15));}return out.toString();}
 private Object call(Object owner,String name,Class<?>[] types,Object...values)throws Exception{Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();Method m=c.getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(owner instanceof Class?null:owner,values);}
 private Object account()throws Exception{return call(loader.loadClass("com.turboio.addon.Host107Login"),"account",new Class<?>[0]);}
 private String binding(Object a)throws Exception{Field f=a.getClass().getField("binding");return (String)f.get(a);}
 private void count(String key){counts.put(key,counts.getOrDefault(key,0)+1);}
 private void edge(JSONObject value)throws Exception{if(edges.size()<256)edges.add(value.toString());else limited=true;}
 @Override public void onCreate(Bundle args){super.onCreate(args);nonce=args.getString("probe_id","");
  // Read before the diagnostic process can replace the normal observer snapshot.
  try{File root=getTargetContext().getFilesDir().getCanonicalFile(),file=new File(root,"lifelog-audio-observation.json");check(file.isFile()&&!Files.isSymbolicLink(file.toPath())&&file.length()<=65536,"AUDIO_LINK_SNAPSHOT_PATH");byte[] bytes=Files.readAllBytes(file.toPath());check(bytes.length<=65536,"AUDIO_LINK_SNAPSHOT_SIZE");saved=new JSONObject(new String(bytes,StandardCharsets.UTF_8));}
  catch(Exception e){snapshotError=e.getMessage()!=null&&e.getMessage().matches("[A-Z_]{3,80}")?e.getMessage():e.getClass().getSimpleName();}start();
 }
 private void jsonIds(Object value,String path,int depth)throws Exception{
  if(++nodes>80000||depth>12){limited=true;return;}
  if(value instanceof JSONObject){JSONObject row=(JSONObject)value,keys=new JSONObject();Iterator<String> it=row.keys();while(it.hasNext()){String k=it.next();Object v=row.get(k);if(idKeys.contains(k)&&v instanceof String&&((String)v).matches("[A-Za-z0-9_.:-]{1,128}"))keys.put(k,hash((String)v));}
   if(keys.length()>0){Iterator<String> names=keys.keys();boolean relevant=false;while(names.hasNext()){String k=names.next(),h=keys.getString(k);count("conversation_id_field_"+k);if(k.equals("roundId"))roundHashes.add(h);relevant|=taskHashes.contains(h)||sourceHashes.contains(h);}
    if(relevant||keys.length()>1)edge(new JSONObject().put("kind","conversation_response").put("path",path).put("ids",keys).put("matches_observed_or_current_source",relevant));}
   it=row.keys();while(it.hasNext()){String k=it.next();Object v=row.get(k);if(v instanceof JSONObject||v instanceof JSONArray)jsonIds(v,path+"/"+(k.matches("[A-Za-z][A-Za-z0-9_]{0,39}")?k:"other"),depth+1);}
  }else if(value instanceof JSONArray){JSONArray a=(JSONArray)value;for(int i=0;i<a.length()&&!limited;i++)jsonIds(a.get(i),path+"/[]",depth+1);}
 }
 private void line(byte[] raw)throws Exception{
  String text=new String(raw,StandardCharsets.UTF_8);
  if(text.contains("onAlwaysOnResponse")||text.contains("[AO_TRACE]")||text.contains("onCachedAudioReady")){
   String kind=text.contains("onAlwaysOnResponse")?"response":text.contains("onCachedAudioReady")?"cached_audio_ready":"trace";count("native_"+kind);Matcher m=ids.matcher(text);JSONObject found=new JSONObject();while(m.find()){String h=hash(m.group(2));found.put(m.group(1),h);if(m.group(1).equals("roundId"))roundHashes.add(h);}
   if(found.length()>0)edge(new JSONObject().put("kind",kind).put("ids",found));
  }
  OfficialLifelogLogReader.Detail detail=null;try{detail=OfficialLifelogLogReader.parse(raw,0,0);}catch(Exception malformed){count("full_parse_error");}
  if(detail!=null){count("full_responses");try{for(OfficialLifelogSnapshot.Source s:OfficialLifelogSnapshot.read(detail.eventId,detail.json)){if(!s.sourceType.equals("conversation")||!sourceIds.contains(s.sourceId))continue;String sh=hash(s.sourceId);Set<String> values=clips.computeIfAbsent(sh,k->new HashSet<>());for(OfficialLifelogSnapshot.Clip c:s.clips){if(values.size()>=10000){limited=true;break;}values.add(hash(c.id));}}}catch(Exception shape){count("full_schema_error");}}
  int b=text.indexOf("response body:");if(b<0||!text.substring(0,b).contains("[Interceptor.Http]")||!text.substring(0,b).contains("←"))return;
  Matcher request=Pattern.compile("\\[(?:GET|POST) ([^\\]\\s]{1,4096})\\]").matcher(text.substring(0,b));if(!request.find())return;String target=request.group(1);if(request.find())return;URI u;try{u=new URI(target);}catch(Exception bad){return;}
  if(!"/always-on/message/conversation/query".equals(u.getRawPath())||u.getRawUserInfo()!=null||u.getRawFragment()!=null&&!u.getRawFragment().isEmpty())return;
  if(u.isAbsolute()&&(!"https".equals(u.getScheme())||!"xr-api-p.rayneo.cn".equals(u.getHost())||u.getPort()!=-1&&u.getPort()!=443)||!u.isAbsolute()&&u.getRawAuthority()!=null)return;
  count("conversation_responses");try{JSONObject body=new JSONObject(text.substring(b+14).trim());if(body.optInt("code",-1)==0)jsonIds(body,"",0);else count("conversation_rejected");}catch(JSONException bad){count("conversation_json_error");}
 }
 private void logs(File directory)throws Exception{
  File root=directory.getCanonicalFile();check(!Files.isSymbolicLink(directory.toPath()),"AUDIO_LINK_LOG_PATH");if(!root.isDirectory())return;List<File> selected=new ArrayList<>();File[] top=root.listFiles();check(top!=null&&top.length<=512,"AUDIO_LINK_LOG_INVENTORY");
  for(File f:top){if(Files.isSymbolicLink(f.toPath()))continue;if(f.isFile()&&f.getName().endsWith(".log"))selected.add(f);else if(f.isDirectory()){File[] nested=f.listFiles();if(nested!=null&&nested.length<=512)for(File n:nested)if(n.isFile()&&!Files.isSymbolicLink(n.toPath())&&n.getName().endsWith(".log"))selected.add(n);}}
  selected.sort(Comparator.comparingLong(File::lastModified).reversed());for(File f:selected){if(files>=16||scanned>=67108864){limited=true;break;}check(f.getCanonicalPath().startsWith(root.getPath()+File.separator),"AUDIO_LINK_LOG_PATH");files++;long length=f.length(),start=Math.max(0,length-16777216);
   try(RandomAccessFile in=new RandomAccessFile(f,"r")){in.seek(start);ByteArrayOutputStream out=new ByteArrayOutputStream();boolean skip=start>0;byte[] buffer=new byte[8192];long left=length-start;
    while(left>0&&scanned<67108864){int n=in.read(buffer,0,(int)Math.min(buffer.length,Math.min(left,67108864-scanned)));if(n<0)break;left-=n;scanned+=n;for(int i=0;i<n;i++){int c=buffer[i]&255;if(c==10){if(!skip)line(out.toByteArray());out.reset();skip=false;}else if(!skip){if(out.size()>=1048576){out.reset();skip=true;oversized++;}else out.write(c);}}}if(skip||out.size()>0)partial++;}
  }
 }
 @Override public void onStart(){Bundle result=new Bundle();JSONObject report=new JSONObject();try{
  check(nonce.matches("[a-f0-9]{32}"),"AUDIO_LINK_NONCE");Context target=getTargetContext();loader=target.getClassLoader();android.content.pm.PackageInfo pkg=target.getPackageManager().getPackageInfo(target.getPackageName(),0);check(pkg.getLongVersionCode()==10500&&"0.5.3-dev78".equals(pkg.versionName),"AUDIO_LINK_VERSION");
  check(saved!=null,"AUDIO_LINK_SNAPSHOT_MISSING");check(saved.optBoolean("observer_only")&&!saved.optBoolean("audio_persisted",true),"AUDIO_LINK_SNAPSHOT_SCOPE");report.put("saved_snapshot",saved).put("snapshot_read_before_diagnostic_start",true);
  target.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(target,"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));Object a=null;long until=SystemClock.elapsedRealtime()+12000;do{a=account();if(a!=null)break;Thread.sleep(200);}while(SystemClock.elapsedRealtime()<until);check(a!=null,"OFFICIAL_LOGIN_REQUIRED");String owner=binding(a);
  JSONArray samples=saved.getJSONArray("samples");for(int i=0;i<samples.length();i++){JSONObject s=samples.getJSONObject(i);if(owner.equals(s.optString("account_observed"))&&s.optBoolean("task_id_present")){String id=s.getString("task_id_sha256");check(id.matches("[a-f0-9]{64}"),"AUDIO_LINK_TASK_HASH");taskHashes.add(id);}}
  File flutter=new File(target.getApplicationInfo().dataDir,"app_flutter"),cache=(File)call(a,"cacheFile",new Class<?>[]{File.class},flutter);
  for(String ref:OfficialHiveCache.sourceReferences(OfficialHiveCache.read(cache)))if(ref.startsWith("conversation/")){String id=ref.substring(13);sourceIds.add(id);sourceHashes.add(hash(id));}
  logs(new File(flutter,"appLog"));check(owner.equals(binding(account())),"AUDIO_LINK_ACCOUNT_CHANGED");
  JSONArray links=new JSONArray();for(String e:edges)links.put(new JSONObject(e));JSONArray matched=new JSONArray();int totalClips=0;for(Map.Entry<String,Set<String>> e:clips.entrySet()){totalClips+=e.getValue().size();for(String round:roundHashes)if(e.getValue().contains(round))matched.put(new JSONObject().put("round_sha256",round).put("source_sha256",e.getKey()).put("exact_round_clip_match",true));}
  Set<String> direct=new HashSet<>(taskHashes);direct.retainAll(sourceHashes);report.put("current_conversation_sources",sourceIds.size()).put("observed_task_hashes",new JSONArray(taskHashes)).put("exact_task_source_matches",new JSONArray(direct)).put("round_hash_count",roundHashes.size()).put("full_conversation_sources",clips.size()).put("unique_clips",totalClips).put("round_clip_matches",matched).put("relationships",links).put("counts",new JSONObject(counts)).put("files",files).put("scanned_bytes",scanned).put("oversized_lines",oversized).put("partial_tails",partial).put("budget_limited",limited).put("source_association_proven",false);result.putBoolean("passed",true);
 }catch(Throwable e){while(e.getCause()!=null)e=e.getCause();String m=e.getMessage();result.putBoolean("passed",false);result.putString("error",m!=null&&m.matches("[A-Z_]{3,90}")?m:e.getClass().getSimpleName());}
 finally{result.putString("audit",report.toString());result.putString("snapshot_error",snapshotError);result.putString("probe_id",nonce);result.putBoolean("audio_read_capture_playback",false);result.putBoolean("plain_identifiers_or_text_exported",false);result.putInt("diagnostic_network_requests",0);finish(result.getBoolean("passed")?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);}
 }
}
