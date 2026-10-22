package com.turboio.androidtests;

import android.app.*;import android.os.Bundle;import java.io.*;import java.nio.charset.StandardCharsets;
import java.util.*;import org.json.*;

/**
 * Read-only structural check: finds the logged /lifelog/api/v1/events/{id}/full
 * and /lifelog/api/v1/journal/detail response lines and reports field names,
 * array lengths and total text length. Response text itself is not exported.
 */
public final class EventFullProbe extends Instrumentation {
 private Bundle args;private File external;private String probeId="";
 private final JSONObject report=new JSONObject();

 private static String after(String line,String marker){int at=line.indexOf(marker);return at<0?null:line.substring(at+marker.length()).trim();}

 private static JSONObject shape(Object value)throws JSONException{
  JSONObject out=new JSONObject();
  if(value instanceof JSONObject){
   JSONObject o=(JSONObject)value;JSONArray keys=new JSONArray();JSONObject fields=new JSONObject();
   List<String> names=new ArrayList<>();for(Iterator<String> it=o.keys();it.hasNext();)names.add(it.next());Collections.sort(names);
   for(String key:names){keys.put(key);if(fields.length()<40)fields.put(key,shape(o.get(key)));}
   return out.put("type","object").put("keys",keys).put("fields",fields);
  }
  if(value instanceof JSONArray){JSONArray a=(JSONArray)value;JSONObject d=out.put("type","array").put("len",a.length());if(a.length()>0)d.put("sample",shape(a.get(0)));return d;}
  if(value instanceof String){String s=(String)value;return out.put("type","string").put("len",s.length());}
  if(value instanceof Number)return out.put("type","number");
  if(value instanceof Boolean)return out.put("type","bool");
  return out.put("type","other");
 }

 private static long textLength(Object value){
  if(value instanceof String)return ((String)value).length();
  if(value instanceof JSONArray){long total=0;JSONArray a=(JSONArray)value;for(int i=0;i<a.length();i++)total+=textLength(a.opt(i));return total;}
  if(value instanceof JSONObject){long total=0;JSONObject o=(JSONObject)value;for(Iterator<String> it=o.keys();it.hasNext();)total+=textLength(o.opt(it.next()));return total;}
  return 0;
 }

 private void inspect(String file,String line)throws Exception{
  if(!line.contains("[Interceptor.Http]")||!line.contains("response body:"))return;
  String body=after(line,"response body:");
  if(body==null||!body.startsWith("{"))return;
  boolean eventFull=line.contains("/lifelog/api/v1/events/")&&line.contains("/full");
  boolean journalDetail=line.contains("/lifelog/api/v1/journal/detail");
  if(!eventFull&&!journalDetail)return;
  JSONObject json=new JSONObject(body);
  JSONObject data=json.optJSONObject("data");
  JSONObject entry=new JSONObject().put("file",file).put("line_bytes",line.length()).put("endpoint",eventFull?"events/{id}/full":"journal/detail");
  if(data!=null){
   entry.put("data_keys",shape(data).optJSONArray("keys"));
   entry.put("data_shape",shape(data));
   entry.put("total_text_chars",textLength(data));
   entry.put("id",String.valueOf(data.opt("id")));
   entry.put("duration_seconds",data.opt("durationSeconds"));
  }
  String key=eventFull?"event_full":"journal_detail";
  JSONArray list=report.optJSONArray(key);if(list==null){list=new JSONArray();report.put(key,list);}
  if(list.length()<3)list.put(entry);
 }

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
   int scanned=0;long lines=0;
   for(File file:files){
    if(scanned>=12)break;scanned++;
    try(BufferedReader reader=new BufferedReader(new InputStreamReader(new FileInputStream(file),StandardCharsets.UTF_8))){
     String line;while((line=reader.readLine())!=null){lines++;inspect(file.getName(),line);}
    }catch(Exception ignored){}
   }
   report.put("schema",1).put("probe_id",probeId).put("read_only",true).put("files_scanned",scanned).put("lines_scanned",lines);
   try(FileOutputStream out=new FileOutputStream(new File(external,"io-agent-event-full.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
   result.putInt("event_full",report.optJSONArray("event_full")==null?0:report.optJSONArray("event_full").length());finish(Activity.RESULT_OK,result);
  }catch(Throwable failure){
   result.putString("error",String.valueOf(failure.getMessage()));finish(Activity.RESULT_CANCELED,result);
  }
 }
}
