package com.turboio.androidtests;

import android.app.*;import android.os.Bundle;import java.io.*;import java.nio.charset.StandardCharsets;
import java.util.*;import org.json.*;

/** Read-only scan for logged gateway signature lines. */
public final class SignLogProbe extends Instrumentation {
 private Bundle args;private File external;private String probeId="";
 private final JSONObject report=new JSONObject();

 @Override public void onCreate(Bundle arguments){super.onCreate(arguments);this.args=arguments;start();}
 @Override public void onStart(){
  Bundle result=new Bundle();
  try{
   probeId=this.args.getString("probe_id","");
   external=getTargetContext().getExternalFilesDir(null);
   if(external==null)throw new IllegalStateException("EXPORT_UNAVAILABLE");
   File appFlutter=new File(getTargetContext().getApplicationInfo().dataDir,"app_flutter");
   List<File> files=new ArrayList<>();Deque<File> queue=new ArrayDeque<>();queue.add(new File(appFlutter,"appLog"));
   while(!queue.isEmpty()){File node=queue.removeFirst();File[] children=node.listFiles();if(children==null)continue;for(File child:children){if(child.isDirectory())queue.add(child);else if(child.length()>0&&child.length()<32*1024*1024)files.add(child);}}
   files.sort((a,b)->Long.compare(b.lastModified(),a.lastModified()));
   JSONArray hits=new JSONArray();int scanned=0;long lines=0;
   for(File file:files){
    if(scanned>=8||hits.length()>=20)break;scanned++;
    try(BufferedReader reader=new BufferedReader(new InputStreamReader(new FileInputStream(file),StandardCharsets.UTF_8))){
     String line;while((line=reader.readLine())!=null){
      lines++;
      if(line.contains("Interceptor.Sign")||line.contains("xtcl-authorization")||line.contains("Signature=")||line.contains("签名生成")){
       if(hits.length()<20)hits.put(new JSONObject().put("file",file.getName()).put("line",line.length()>900?line.substring(0,900):line));
      }
     }
    }catch(Exception ignored){}
   }
   report.put("schema",1).put("probe_id",probeId).put("read_only",true).put("files_scanned",scanned).put("lines_scanned",lines).put("hits",hits);
   try(FileOutputStream out=new FileOutputStream(new File(external,"io-agent-sign-log.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
   result.putInt("hits",hits.length());finish(Activity.RESULT_OK,result);
  }catch(Throwable failure){result.putString("error",String.valueOf(failure.getMessage()));finish(Activity.RESULT_CANCELED,result);}
 }
}
