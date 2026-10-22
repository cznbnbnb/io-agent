package com.turboio.androidtests;

import android.app.*;import android.os.*;import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;import org.json.*;
import com.turboio.androidtests.voice.OfficialLifelogLogReader;
import com.turboio.androidtests.voice.OfficialLifelogSnapshot;
import java.nio.file.Files;import java.util.regex.*;

/** Runs production reader; exports schema/counts only, never text, IDs or headers. */
public final class LifelogLogShapeProbe extends Instrumentation {
 private Bundle args;
 private static final Set<String> FIELDS=new HashSet<>(Arrays.asList("code","message","msg","data","result","id","eventType","flowType","source","deletable","startTime","endTime","durationSeconds","startTimeFormatted","endTimeFormatted","title","summaryContent","outline","originalList","transcriptionContents","transcriptionInfos","participants","emotion","contentAudited","contentDesensitized","content","text","speaker","speakerId","speakerName","speakerLabel","speakerRole","start","end","timestamp","sourceId","sourceType","list","items","slices","speakerType","startMs","endMs","startTimeMs","endTimeMs","duration","sequence","index","role","label","name","sentences","words","paragraphs","updatedAt","revision","offset","time","conversationId","audioId"));
 private static Object shape(Object value,int depth)throws JSONException {
  if(value==null||value==JSONObject.NULL)return "null";
  if(value instanceof String)return new JSONObject().put("type","string").put("chars",((String)value).codePointCount(0,((String)value).length()));
  if(value instanceof Number)return "number";if(value instanceof Boolean)return "boolean";if(depth>5)return "nested";
  if(value instanceof JSONObject){JSONObject out=new JSONObject();Iterator<String> keys=((JSONObject)value).keys();int omitted=0;while(keys.hasNext()){String key=keys.next();boolean schemaField=depth<=5&&key.matches("[A-Za-z][A-Za-z_]{0,39}");if(FIELDS.contains(key)||schemaField)out.put(key,shape(((JSONObject)value).get(key),depth+1));else omitted++;}if(omitted>0)out.put("_other_field_count",omitted);return out;}
  if(value instanceof JSONArray){JSONArray list=(JSONArray)value;JSONObject out=new JSONObject().put("type","array").put("length",list.length());if(list.length()>0)out.put("first",shape(list.get(0),depth+1));return out;}
  return "unknown";
 }
 private static JSONObject semantics(JSONObject event)throws Exception {
  JSONArray contents=event.optJSONArray("transcriptionContents"),originals=event.optJSONArray("originalList"),sources=new JSONArray();Set<String> ids=new HashSet<>();
  if(originals!=null)for(int i=0;i<originals.length();i++)ids.add(originals.getJSONObject(i).optString("id",""));
  if(contents!=null)for(int i=0;i<contents.length();i++){JSONObject source=contents.getJSONObject(i);JSONArray clips=source.optJSONArray("clips");String begin=source.optString("startTime",""),end=source.optString("endTime","");boolean epoch=begin.matches("[0-9]{13}")&&end.matches("[0-9]{13}"),within=epoch,ordered=true,unique=true;long first=epoch?Long.parseLong(begin):0,last=epoch?Long.parseLong(end):0,previous=-1;int chars=0;Set<String> clipIds=new HashSet<>();
   if(clips!=null)for(int j=0;j<clips.length();j++){JSONObject clip=clips.getJSONObject(j);String a=clip.optString("startTime",""),b=clip.optString("endTime",""),content=clip.optString("content","");boolean valid=a.matches("[0-9]{13}")&&b.matches("[0-9]{13}");epoch&=valid;if(valid){long start=Long.parseLong(a),stop=Long.parseLong(b);within&=start>=first&&stop<=last&&stop>=start;ordered&=start>=previous;previous=start;}else within=false;String id=clip.optString("clipId","");unique&=!id.isEmpty()&&clipIds.add(id);chars+=content.codePointCount(0,content.length());}
   sources.put(new JSONObject().put("source_id_in_originals",ids.contains(source.optString("sourceId",""))).put("clips",clips==null?0:clips.length()).put("text_chars",chars).put("all_times_epoch_ms",epoch).put("all_clips_inside_source",within).put("ordered_by_start",ordered).put("all_clip_ids_unique",unique));
  }return new JSONObject().put("sources",sources);
 }
 /** Independent bounded format audit. Only fixed booleans/types/counts leave the
  * process; no raw prefix, URL, filenames, IDs, token or body is exported. */
 private static JSONObject formatAudit(File directory)throws Exception {
  List<File> files=new ArrayList<>();Deque<File> dirs=new ArrayDeque<>();dirs.add(directory);String boundary=directory.getCanonicalPath()+File.separator;int visited=0;
  while(!dirs.isEmpty()&&visited++<128){File dir=dirs.remove();File[] children=dir.listFiles();if(children==null)continue;for(File f:children){if(Files.isSymbolicLink(f.toPath())||!f.getCanonicalPath().startsWith(boundary))continue;if(f.isDirectory()){if(dir.equals(directory))dirs.add(f);}else if(f.getName().endsWith(".log"))files.add(f);}}
  files.sort(Comparator.comparingLong(File::lastModified).reversed());JSONArray found=new JSONArray();long total=0;int examined=0,large=0,partial=0,candidates=0;
  Pattern endpoint=Pattern.compile("/lifelog/api/v1/events/([A-Za-z0-9-]{1,80})/full");
  for(File file:files){if(examined>=32||total>=67108864)break;examined++;long length=file.length(),start=Math.max(0,length-16777216);if(start>0)large++;
   try(RandomAccessFile raw=new RandomAccessFile(file,"r")){raw.seek(start);try(InputStream in=new BufferedInputStream(new FileInputStream(raw.getFD()))){ByteArrayOutputStream line=new ByteArrayOutputStream();boolean discard=start>0;int b;
    while(total<67108864&&(b=in.read())!=-1){total++;if(b!=10){if(!discard){if(line.size()>=1048576){discard=true;line.reset();}else line.write(b);}continue;}
     if(!discard){String value=new String(line.toByteArray(),StandardCharsets.UTF_8);Matcher m=endpoint.matcher(value);if(m.find()){candidates++;if(found.length()<16){int body=value.indexOf("response body");String prefix=body<0?value:value.substring(0,body);JSONObject row=new JSONObject().put("line_bytes",line.size()).put("file_bytes",length).put("tail_start",start).put("has_response_body",body>=0).put("exact_body_marker",value.contains("response body:")).put("interceptor",prefix.contains("[Interceptor.Http]")).put("left_arrow",prefix.contains("←")).put("get_bracket",prefix.contains("[GET ")).put("full_close_bracket",prefix.contains("/full]")).put("id_32hex",m.group(1).matches("[A-Fa-f0-9]{32}")).put("official_host",prefix.contains("https://xr-api-p.rayneo.cn"));
       char after=m.end()<value.length()?value.charAt(m.end()):0;row.put("after_full_character",after=='?'?"query":after==']'?"close_bracket":Character.isWhitespace(after)?"whitespace":"other");
       if(m.end()<=prefix.length()){String layout=prefix.substring(m.end()).replaceAll("[\\p{L}\\p{N}_-]+","x");row.put("suffix_punctuation",layout.substring(0,Math.min(160,layout.length())));}
       row.put("production_parser_accepts",OfficialLifelogLogReader.parse(line.toByteArray(),0,0)!=null);
       if(body>=0){int jsonStart=value.indexOf('{',body);if(jsonStart>=0)try{JSONObject response=new JSONObject(value.substring(jsonStart));Object event=response.opt("data");if(!(event instanceof JSONObject))event=response;row.put("json_valid",true).put("endpoint_id_matches_body",m.group(1).equalsIgnoreCase(((JSONObject)event).optString("id",""))).put("response_code",response.optInt("code",-1)).put("semantics",semantics((JSONObject)event)).put("shape",shape(response,0));}catch(JSONException invalid){row.put("json_valid",false);}}
       found.put(row);}}
     }line.reset();discard=false;
    }if(discard||line.size()>0)partial++;
   }}
  }
  return new JSONObject().put("files",examined).put("bytes",total).put("large_file_tails",large).put("partial_tails",partial).put("candidate_lines",candidates).put("candidates",found);
 }
 @Override public void onCreate(Bundle arguments){super.onCreate(arguments);args=arguments;start();}
 @Override public void onStart(){Bundle done=new Bundle();try{
  String nonce=args.getString("probe_id","");if(!nonce.matches("[a-f0-9]{32}"))throw new IllegalArgumentException("PROBE_ID_INVALID");
  File logs=new File(getTargetContext().getApplicationInfo().dataDir,"app_flutter/appLog");JSONArray details=new JSONArray();Set<String> seen=new HashSet<>();
  OfficialLifelogLogReader.Sink sink=detail->{
   if(details.length()>=4||!seen.add(detail.eventId))return;
   JSONObject response=new JSONObject(new String(detail.json,StandardCharsets.UTF_8));Object body=response.opt("data");if(!(body instanceof JSONObject))body=response;
   JSONObject record=(JSONObject)body;
   JSONObject item=new JSONObject().put("bytes",detail.json.length).put("endpoint_id_matches_body",detail.eventId.equals(record.optString("id",""))).put("response_code",response.optInt("code",-1)).put("semantics",semantics(record)).put("shape",shape(response,0));
   try{List<OfficialLifelogSnapshot.Source> mapped=OfficialLifelogSnapshot.read(detail.eventId,detail.json);JSONArray results=new JSONArray();
    for(OfficialLifelogSnapshot.Source source:mapped){byte[] encoded=source.materialBody(String.join("",Collections.nCopies(64,"0")),1);JSONObject material=new JSONObject(new String(encoded,StandardCharsets.UTF_8));JSONArray utterances=material.getJSONArray("utterances");boolean exact=utterances.length()==source.clips.size();for(int i=0;i<source.clips.size()&&exact;i++)exact=source.clips.get(i).text.equals(utterances.getJSONObject(i).getString("text"));results.put(new JSONObject().put("bytes",encoded.length).put("utterances",utterances.length()).put("exact_clip_text",exact).put("speakers",material.getJSONArray("speakers").length()));}
    item.put("material_mapping",new JSONObject().put("valid",true).put("synthetic_scope_only",true).put("account_ownership_verified",false).put("persisted_or_uploaded",false).put("sources",results));
   }catch(IllegalArgumentException invalid){String code=invalid.getMessage();item.put("material_mapping",new JSONObject().put("valid",false).put("error",code!=null&&code.matches("[A-Z_]{1,80}")?code:"MAPPING_REJECTED"));}
   details.put(item);
  };
  OfficialLifelogLogReader.Session session=OfficialLifelogLogReader.open(logs);OfficialLifelogLogReader.Summary scan=new OfficialLifelogLogReader.Summary();int pages=0;
  do{OfficialLifelogLogReader.Summary page=session.next(sink);scan.files+=page.files;scan.bytes+=page.bytes;scan.details+=page.details;scan.partialTails+=page.partialTails;scan.oversizedLines+=page.oversizedLines;scan.invalidUtf8+=page.invalidUtf8;scan.skippedFiles+=page.skippedFiles;scan.changedFiles+=page.changedFiles;scan.complete=page.complete;pages++;}while(!session.complete()&&pages<8);
  scan.budgetReached=!session.complete();
  JSONObject report=new JSONObject().put("schema",1).put("probe_id",nonce).put("read_only",true).put("files",scan.files).put("scanned_bytes",scan.bytes).put("matching_response_lines",scan.details).put("partial_tails",scan.partialTails).put("oversized_lines",scan.oversizedLines).put("invalid_utf8",scan.invalidUtf8).put("skipped_files",scan.skippedFiles).put("budget_reached",scan.budgetReached).put("records",details).put("text_or_identifiers_exported",false).put("network_requests",0).put("microphone_started",false);
  report.put("pages",pages).put("selected_inventory_complete",scan.complete).put("changed_files",scan.changedFiles);
  if(details.length()==0)report.put("format_audit",formatAudit(logs));
  File destination=new File(getTargetContext().getExternalFilesDir(null),"io-agent-lifelog-log-shape.json");try(FileOutputStream out=new FileOutputStream(destination)){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
  done.putInt("records",details.length());finish(Activity.RESULT_OK,done);
 }catch(Exception failed){done.putString("error",failed.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,done);}}
}
