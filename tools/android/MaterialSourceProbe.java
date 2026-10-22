package com.turboio.androidtests;

import android.app.*;import android.os.Bundle;import java.io.*;import java.lang.reflect.*;import java.nio.charset.StandardCharsets;import java.util.*;import org.json.*;

/** Bounded metadata-only source inventory. Never opens a DB, reads rows or starts the SDK. */
public final class MaterialSourceProbe extends Instrumentation {
 private final Set<String> seen=new HashSet<>();private final JSONArray candidates=new JSONArray();private int budget=3000,files,audio;
 private void scan(File node,String relative,int depth)throws Exception{
  if(node==null||depth>6||budget--<=0||candidates.length()>=150||!node.exists())return;String canonical=node.getCanonicalPath();if(!canonical.equals(node.getAbsolutePath())||!seen.add(canonical))return;
  if(node.isDirectory()){
   String n=node.getName().toLowerCase(Locale.ROOT);if(n.equals("flutter_assets")||n.equals("logs")||n.equals("shared_prefs")||n.equals("cache")||n.equals("connection-import")||n.startsWith("material-outbox")||n.startsWith("voice-drafts")||n.startsWith("voice-audio"))return;
   File[] children=node.listFiles();if(children!=null){Arrays.sort(children,Comparator.comparing(File::getName));for(File f:children)scan(f,relative+"/"+f.getName(),depth+1);}return;
  }
  if(!node.isFile())return;files++;String n=node.getName().toLowerCase(Locale.ROOT);boolean database=n.endsWith(".isar")||n.endsWith(".db")||n.endsWith(".sqlite")||n.endsWith(".sqlite3"),sound=n.matches(".*\\.(wav|opus|ogg|m4a|aac|mp3|flac)$"),document=(n.endsWith(".txt")||n.endsWith(".md"))&&relative.toLowerCase(Locale.ROOT).matches(".*(record|lifelog|transcript|always).*" );if(sound)audio++;
  if(!database&&!sound&&!document)return;JSONObject row=new JSONObject().put("relative_path",relative).put("bytes",node.length()).put("modified_ms",node.lastModified()).put("candidate_kind",database?"database":sound?"audio":"text_file");
  if(database){byte[] prefix=new byte[16];int count;try(InputStream in=new FileInputStream(node)){count=in.read(prefix);}StringBuilder hex=new StringBuilder();for(int i=0;i<Math.max(0,count);i++)hex.append(String.format(Locale.ROOT,"%02x",prefix[i]&255));row.put("header_hex",hex.toString());row.put("sqlite_header",count==16&&Arrays.equals(prefix,"SQLite format 3\0".getBytes(StandardCharsets.US_ASCII)));row.put("rows_read",false);}
  candidates.put(row);
 }
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 @Override public void onStart(){Bundle result=new Bundle();try{
  File data=new File(getTargetContext().getApplicationInfo().dataDir);scan(getTargetContext().getFilesDir().getCanonicalFile(),"files",0);scan(new File(data,"app_flutter").getCanonicalFile(),"app_flutter",0);scan(new File(data,"databases").getCanonicalFile(),"databases",0);File external=getTargetContext().getExternalFilesDir(null);if(external!=null)scan(external.getCanonicalFile(),"external_files",0);
  JSONObject report=new JSONObject().put("schema",1).put("metadata_only",true).put("candidate_files",candidates).put("files_considered",files).put("audio_candidate_count",audio).put("scan_budget_exhausted",budget<=0).put("depth_limit",6).put("database_rows_read",false).put("credentials_or_transcript_content_read",false).put("sdk_or_audio_started",false).put("original_files_modified",false);
  if(external==null)throw new IOException("EXPORT_UNAVAILABLE");File output=new File(external,"io-agent-material-source-probe.json");byte[] bytes=report.toString(2).getBytes(StandardCharsets.UTF_8);if(bytes.length>65536)throw new IOException("EXPORT_BUDGET");try(FileOutputStream out=new FileOutputStream(output)){out.write(bytes);out.getFD().sync();}
  result.putBoolean("metadata_only",true);result.putInt("candidate_count",candidates.length());result.putBoolean("database_or_credentials_read",false);result.putBoolean("sdk_or_capture_started",false);finish(Activity.RESULT_OK,result);
 }catch(Throwable failure){result.putString("failure_class",failure.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,result);}}
}
