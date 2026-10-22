package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.nio.charset.StandardCharsets;import java.security.MessageDigest;
import java.util.*;import org.json.*;

/**
 * Read-only in-process memory probe: captures one live TCL gateway signature
 * header (or its canonical string) so the exact signing layout can be verified
 * offline. It does not modify the app, does not send requests and never writes
 * the captured window to the repository.
 */
public final class LifelogSignProbe extends Instrumentation {
 private static final String[] PATTERNS={
  "TCL1-HMAC-SHA256 Credential=",
  "TCL1-HMAC-SHA256\n",
  "xtcl-nonce;xtcl-timestamp;",
  "xtcl-authorization"
 };
 private Bundle args;private File external;private String probeId="";
 private final JSONObject report=new JSONObject();

 private static String hex(byte[] bytes){StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 private static String sha(String value){try{return hex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))).substring(0,12);}catch(Exception e){return "";}}

 private static final class Region{long start,end;String perms,path;}

 private static List<Region> regions()throws IOException{
  List<Region> out=new ArrayList<>();
  try(BufferedReader reader=new BufferedReader(new FileReader("/proc/self/maps"))){
   String line;
   while((line=reader.readLine())!=null){
    String[] parts=line.split("\\s+",6);
    if(parts.length<5)continue;
    int dash=parts[0].indexOf('-');if(dash<0)continue;
    try{
     Region r=new Region();
     r.start=Long.parseLong(parts[0].substring(0,dash),16);
     r.end=Long.parseLong(parts[0].substring(dash+1),16);
     r.perms=parts[1];r.path=parts.length>5?parts[5]:"";out.add(r);
    }catch(NumberFormatException ignored){}
   }
  }
  return out;
 }

 private JSONArray scan(String needle,int maxHits,long budgetBytes){
  JSONArray hits=new JSONArray();byte[] needleBytes=needle.getBytes(StandardCharsets.ISO_8859_1);
  long read=0;int regions=0,eligible=0,rw=0,total=0;long eligibleBytes=0;String openError="",readError="";
  try{
   List<Region> all=regions();total=all.size();
   try(RandomAccessFile mem=new RandomAccessFile("/proc/self/mem","r")){
    for(Region r:all){
     if(read>=budgetBytes)break;
     if(!r.perms.startsWith("rw"))continue;
     rw++;
     long size=r.end-r.start;if(size<=0||size>512L*1024*1024)continue;
     String path=r.path;
     if(!(path.isEmpty()||path.startsWith("[")||path.contains("ashmem")||path.contains("memfd")))continue;
     if(path.contains("dalvik")||path.contains(".so")||path.contains(".apk")||path.contains(".dex")||path.contains("gralloc"))continue;
     regions++;eligible++;eligibleBytes+=size;
     byte[] buffer=new byte[1<<18],carry=new byte[0];
     long offset=r.start;
     while(offset<r.end&&read<budgetBytes&&hits.length()<maxHits){
      int want=(int)Math.min(buffer.length,r.end-offset);
      try{mem.seek(offset);int got=mem.read(buffer,0,want);if(got<=0)break;
       byte[] chunk=new byte[carry.length+got];
       System.arraycopy(carry,0,chunk,0,carry.length);
       System.arraycopy(buffer,0,chunk,carry.length,got);
       read+=got;
       int at=indexOf(chunk,needleBytes);
       while(at>=0&&hits.length()<maxHits){
        int from=Math.max(0,at-320),to=Math.min(chunk.length,at+needleBytes.length+320);
        StringBuilder text=new StringBuilder();
        for(int i=from;i<to;i++){int v=chunk[i]&255;text.append(v>=32&&v<127?(char)v:'.');}
        String window=text.toString();
        boolean duplicate=false;for(int i=0;i<hits.length();i++)if(hits.getJSONObject(i).getString("sha12").equals(sha(window)))duplicate=true;
        if(!duplicate)hits.put(new JSONObject().put("pattern",needle).put("at",offset+at).put("sha12",sha(window)).put("window",window));
        at=indexOf(chunk,needleBytes,at+needleBytes.length);
       }
       int keep=Math.min(needleBytes.length-1,chunk.length);
       carry=Arrays.copyOfRange(chunk,chunk.length-keep,chunk.length);
       offset+=got;
      }catch(IOException partial){readError=partial.getClass().getSimpleName()+":"+partial.getMessage();offset+=buffer.length;}
     }
    }
   }catch(IOException open){openError=open.getClass().getSimpleName()+":"+open.getMessage();}
  }catch(Throwable failure){
   try{hits.put(new JSONObject().put("error",failure.getClass().getSimpleName()));}catch(JSONException ignored){}
   openError=failure.getClass().getSimpleName()+":"+failure.getMessage();
  }
  try{report.put("last_scan_bytes",read).put("last_scan_regions",regions).put("maps_total",total).put("maps_rw",rw).put("maps_eligible",eligible).put("maps_eligible_bytes",eligibleBytes).put("mem_open_error",openError).put("mem_read_error",readError);}catch(JSONException ignored){}
  return hits;
 }

 private static int indexOf(byte[] data,byte[] needle){return indexOf(data,needle,0);}
 private static int indexOf(byte[] data,byte[] needle,int from){
  outer:for(int i=Math.max(0,from);i<=data.length-needle.length;i++){
   for(int j=0;j<needle.length;j++)if(data[i+j]!=needle[j])continue outer;
   return i;
  }
  return -1;
 }

 @Override public void onCreate(Bundle arguments){super.onCreate(arguments);this.args=arguments;start();}
 @Override public void onStart(){
  Bundle result=new Bundle();
  try{
   probeId=this.args.getString("probe_id","");
   if(!probeId.matches("[a-f0-9]{32}"))throw new IllegalStateException("PROBE_ID_INVALID");
   external=getTargetContext().getExternalFilesDir(null);
   if(external==null)throw new IllegalStateException("EXPORT_UNAVAILABLE");
   report.put("schema",1).put("probe_id",probeId).put("at",new java.util.Date().toString()).put("read_only",true).put("network_requests_sent",0);
   getTargetContext().startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(getTargetContext(),"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
   JSONArray all=new JSONArray();
   for(int pass=0;pass<5&&all.length()==0;pass++){
    Thread.sleep(pass==0?1800:1500);
    for(String pattern:PATTERNS){
     JSONArray hits=scan(pattern,4,1200L*1024*1024);
     for(int i=0;i<hits.length();i++){JSONObject hit=hits.getJSONObject(i);if(hit.has("window"))all.put(hit);}
     if(all.length()>0)break;
    }
   }
   report.put("hits",all).put("hit_count",all.length());
   File output=new File(external,"io-agent-lifelog-sign-probe.json");
   byte[] bytes=report.toString(2).getBytes(StandardCharsets.UTF_8);
   if(bytes.length>262144)throw new IOException("EXPORT_BUDGET");
   try(FileOutputStream out=new FileOutputStream(output)){out.write(bytes);out.getFD().sync();}
   result.putInt("hit_count",all.length());result.putBoolean("read_only",true);
   finish(Activity.RESULT_OK,result);
  }catch(Throwable failure){
   while(failure.getCause()!=null)failure=failure.getCause();
   try{report.put("error",String.valueOf(failure.getMessage())).put("failure_class",failure.getClass().getSimpleName());
    try(FileOutputStream out=new FileOutputStream(new File(external,"io-agent-lifelog-sign-probe.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
   }catch(Exception ignored){}
   result.putString("error",String.valueOf(failure.getMessage()));finish(Activity.RESULT_CANCELED,result);
  }
 }
}
