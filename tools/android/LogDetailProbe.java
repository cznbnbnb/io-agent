package com.turboio.androidtests;

import android.app.*;import android.os.Bundle;import java.io.*;import java.nio.charset.StandardCharsets;
import java.util.*;import org.json.*;

/**
 * Read-only scan of the host HTTP log for lifelog detail/transcript payloads.
 * Reports body lengths, endpoint names and short windows around transcript keys;
 * no full response body is exported.
 */
public final class LogDetailProbe extends Instrumentation {
 private Bundle args;private File external;private String probeId="";
 private final JSONObject report=new JSONObject();
 private final JSONArray detailLines=new JSONArray();
 private final JSONArray transcriptHits=new JSONArray();
 private final JSONArray bodyLengths=new JSONArray();

 private static List<File> allFiles(File root){
  List<File> files=new ArrayList<>();Deque<File> queue=new ArrayDeque<>();queue.add(root);
  while(!queue.isEmpty()){
   File node=queue.removeFirst();File[] children=node.listFiles();if(children==null)continue;
   for(File child:children){if(child.isDirectory())queue.add(child);else if(child.length()>0&&child.length()<16*1024*1024)files.add(child);}
  }
  files.sort(Comparator.comparing(File::getName));
  return files;
 }

 private void inspect(String file,String line)throws Exception{
  if(!line.contains("[Interceptor.Http]"))return;
  boolean response=line.contains("response body:");
  if(line.contains("/lifelog/api/v1/journal/latest")&&response&&bodyLengths.length()<6){
   bodyLengths.put(new JSONObject().put("file",file).put("bytes",line.length()).put("has_transcript",line.contains("transcript")).put("has_slices",line.contains("slices")).put("has_speaker",line.contains("speaker")).put("has_blocks",line.contains("blocks")));
  }
  if((line.contains("/lifelog/api/v1/journal/detail")||line.contains("/ai/lifelog/")||line.contains("/lifelog/api/v1/events/"))&&detailLines.length()<6){
   detailLines.put(new JSONObject().put("file",file).put("line",line.length()>2500?line.substring(0,2500):line));
  }
  if(transcriptHits.length()<10){
   int at=line.indexOf("\"transcript");
   if(at<0)at=line.indexOf("transcriptInfos");
   if(at<0)at=line.indexOf("\"slices\"");
   if(at>=0){int from=Math.max(0,at-120),to=Math.min(line.length(),at+360);transcriptHits.put(new JSONObject().put("file",file).put("window",line.substring(from,to)));}
  }
 }

 @Override public void onCreate(Bundle arguments){super.onCreate(arguments);this.args=arguments;start();}
 @Override public void onStart(){
  Bundle result=new Bundle();
  try{
   probeId=this.args.getString("probe_id","");
   external=getTargetContext().getExternalFilesDir(null);
   if(external==null)throw new IllegalStateException("EXPORT_UNAVAILABLE");
   File appFlutter=new File(getTargetContext().getApplicationInfo().dataDir,"app_flutter");
   List<File> files=allFiles(new File(appFlutter,"appLog"));
   int scanned=0;long lines=0;
   for(File file:files){
    if(scanned>=160)break;scanned++;
    try(BufferedReader reader=new BufferedReader(new InputStreamReader(new FileInputStream(file),StandardCharsets.UTF_8))){
     String line;while((line=reader.readLine())!=null){lines++;inspect(file.getName(),line);}
    }catch(Exception ignored){}
   }
   report.put("schema",1).put("probe_id",probeId).put("read_only",true).put("files_scanned",scanned).put("lines_scanned",lines)
         .put("journal_latest_bodies",bodyLengths).put("detail_lines",detailLines).put("transcript_windows",transcriptHits);
   try(FileOutputStream out=new FileOutputStream(new File(external,"io-agent-log-detail.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
   result.putInt("detail_lines",detailLines.length());result.putInt("transcript_windows",transcriptHits.length());finish(Activity.RESULT_OK,result);
  }catch(Throwable failure){
   result.putString("error",String.valueOf(failure.getMessage()));finish(Activity.RESULT_CANCELED,result);
  }
 }
}
