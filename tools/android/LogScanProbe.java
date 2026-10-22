package com.turboio.androidtests;

import android.app.*;import android.os.Bundle;import java.io.*;import java.nio.charset.StandardCharsets;
import java.util.*;import org.json.*;

/** Read-only scan of the newest host log files for HTTP request/response lines. */
public final class LogScanProbe extends Instrumentation {
 private Bundle args;private File external;private String probeId="";
 private final JSONObject report=new JSONObject();

 private static List<File> newest(File root,int limit){
  List<File> files=new ArrayList<>();Deque<File> queue=new ArrayDeque<>();queue.add(root);
  while(!queue.isEmpty()){
   File node=queue.removeFirst();File[] children=node.listFiles();if(children==null)continue;
   for(File child:children){if(child.isDirectory())queue.add(child);else if(child.length()>0&&child.length()<8*1024*1024)files.add(child);}
  }
  files.sort((a,b)->Long.compare(b.lastModified(),a.lastModified()));
  return files.size()>limit?files.subList(0,limit):files;
 }

 private static JSONArray scan(List<File> files,int limit){
  Deque<JSONObject> tail=new ArrayDeque<>();
  for(File child:files){
   try{
    for(String line:java.nio.file.Files.readAllLines(child.toPath(),StandardCharsets.UTF_8)){
     if(line.contains("[Interceptor.Http]")){
      tail.addLast(new JSONObject().put("file",child.getName()).put("line",line.length()>1200?line.substring(0,1200):line));
      if(tail.size()>limit)tail.removeFirst();
     }
    }
   }catch(Exception ignored){}
  }
  return new JSONArray(new ArrayList<>(tail));
 }

 @Override public void onCreate(Bundle arguments){super.onCreate(arguments);this.args=arguments;start();}
 @Override public void onStart(){
  Bundle result=new Bundle();
  try{
   probeId=this.args.getString("probe_id","");
   external=getTargetContext().getExternalFilesDir(null);
   if(external==null)throw new IllegalStateException("EXPORT_UNAVAILABLE");
   File appFlutter=new File(getTargetContext().getApplicationInfo().dataDir,"app_flutter");
   List<File> files=newest(new File(appFlutter,"appLog"),4);
   JSONArray lines=scan(files,200);
   report.put("schema",1).put("probe_id",probeId).put("read_only",true).put("files",files.size()).put("matched",lines.length()).put("lines",lines);
   try(FileOutputStream out=new FileOutputStream(new File(external,"io-agent-log-scan.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
   result.putInt("matched",lines.length());finish(Activity.RESULT_OK,result);
  }catch(Throwable failure){
   result.putString("error",String.valueOf(failure.getMessage()));finish(Activity.RESULT_CANCELED,result);
  }
 }
}
