package com.turboio.androidtests;

import android.app.*;import android.os.*;import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.Files;import java.util.*;import java.util.regex.*;import org.json.*;

/** Read-only structure audit of the official app's own HTTP log. Exports route
 * templates, field names, value types, string lengths and coarse formats only:
 * never text, identifiers, coordinates, tokens, headers or URLs with values. */
public final class LifelogDetailShapeProbe extends Instrumentation {
 private static final Pattern REQUEST=Pattern.compile("\\[(GET|POST|PUT|PATCH|DELETE) https://([A-Za-z0-9.-]{1,128})(/[^\\]\\s?#]{0,1024})");
 private static final Pattern INTEREST=Pattern.compile("(?i)lifelog|summary|journal|location|outline|aitask|event|timeline|map|poi|geo|clsapi");
 private static final Pattern KEY=Pattern.compile("[A-Za-z][A-Za-z0-9_]{0,47}");
 private static final long FILE_TAIL=16L<<20,TOTAL=128L<<20;private static final int LINE_CAP=2<<20,MAX_FILES=64,MAX_ROUTES=200,MAX_DEPTH=12;
 private Bundle args;

 /** Merged structure of every value seen at one position. */
 private static final class Node {
  final TreeSet<String> types=new TreeSet<>(),formats=new TreeSet<>();
  final TreeMap<String,Node> keys=new TreeMap<>();Node items,embedded;
  int seen,dynamicKeys,minChars=Integer.MAX_VALUE,maxChars=-1,minLen=Integer.MAX_VALUE,maxLen=-1,multiline;Boolean geoRange;
  void add(Object v,int depth){
   seen++;
   if(v==null||v==JSONObject.NULL){types.add("null");return;}
   if(v instanceof Boolean){types.add("boolean");return;}
   if(v instanceof Integer||v instanceof Long){types.add("int");long n=((Number)v).longValue();if(n>=1000000000000L&&n<=9999999999999L)formats.add("epoch_ms");else if(n>=1000000000L&&n<=9999999999L)formats.add("epoch_s");return;}
   if(v instanceof Number){types.add("float");double d=((Number)v).doubleValue();boolean geo=d>=-180&&d<=180;geoRange=geoRange==null?geo:geoRange&&geo;return;}
   if(v instanceof String){String s=(String)v;types.add("string");int c=s.codePointCount(0,s.length());minChars=Math.min(minChars,c);maxChars=Math.max(maxChars,c);if(s.indexOf('\n')>=0)multiline++;formats.add(format(s));
    if(depth<MAX_DEPTH&&s.length()>1&&s.length()<=(512<<10)&&(s.charAt(0)=='{'||s.charAt(0)=='['))try{Object inner=s.charAt(0)=='{'?new JSONObject(s):new JSONArray(s);if(embedded==null)embedded=new Node();embedded.add(inner,depth+1);}catch(JSONException ignored){}
    return;}
   if(depth>=MAX_DEPTH){types.add("deeper");return;}
   if(v instanceof JSONObject){types.add("object");JSONObject o=(JSONObject)v;Iterator<String> it=o.keys();while(it.hasNext()){String k=it.next();if(!KEY.matcher(k).matches()||k.matches(".*[0-9]{6,}.*")||k.matches("(?i)[a-f0-9]{16,}")){dynamicKeys++;continue;}keys.computeIfAbsent(k,x->new Node()).add(o.opt(k),depth+1);}return;}
   if(v instanceof JSONArray){types.add("array");JSONArray a=(JSONArray)v;minLen=Math.min(minLen,a.length());maxLen=Math.max(maxLen,a.length());if(a.length()>0&&items==null)items=new Node();for(int i=0;i<a.length()&&i<500;i++)items.add(a.opt(i),depth+1);return;}
   types.add("unknown");
  }
  JSONObject json()throws JSONException{
   JSONObject out=new JSONObject().put("types",new JSONArray(types)).put("seen",seen);
   if(maxChars>=0)out.put("chars",new JSONArray().put(minChars).put(maxChars));if(!formats.isEmpty())out.put("formats",new JSONArray(formats));if(multiline>0)out.put("multiline",multiline);if(geoRange!=null)out.put("all_in_geo_range",geoRange);
   if(maxLen>=0)out.put("length",new JSONArray().put(minLen).put(maxLen));if(dynamicKeys>0)out.put("dynamic_keys",dynamicKeys);
   if(!keys.isEmpty()){JSONObject k=new JSONObject();for(Map.Entry<String,Node> e:keys.entrySet())k.put(e.getKey(),e.getValue().json());out.put("keys",k);}
   if(items!=null)out.put("items",items.json());if(embedded!=null)out.put("embedded_json",embedded.json());return out;
  }
 }
 private static String format(String s){
  if(s.isEmpty())return "empty";
  if(s.matches("[0-9]{13}"))return "epoch_ms_text";if(s.matches("[0-9]{10}"))return "epoch_s_text";if(s.matches("-?[0-9]+"))return "int_text";if(s.matches("-?[0-9]+\\.[0-9]+"))return "float_text";
  if(s.matches("-?[0-9]{1,3}\\.[0-9]+\\s*,\\s*-?[0-9]{1,3}\\.[0-9]+"))return "coord_pair_text";
  if(s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))return "date";if(s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*"))return "datetime";if(s.matches("[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?"))return "clock";
  if(s.matches("(?i)https?://.*"))return "url";if(s.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))return "uuid";if(s.matches("(?i)[0-9a-f]{16,}"))return "hex_id";
  if(s.matches("[A-Z][A-Z0-9_]{1,40}"))return "enum_upper";if(s.matches("[a-z][a-zA-Z0-9_]{1,40}"))return "enum_lower";
  if(s.startsWith("{")||s.startsWith("["))return "json_like";
  return "text";
 }
 private static String route(String path){
  StringBuilder out=new StringBuilder();for(String seg:path.split("/")){if(seg.isEmpty())continue;out.append('/');out.append(seg.matches("[A-Za-z_-]{1,40}")||seg.matches("v[0-9]{1,2}")?seg:":id");}
  return out.length()==0?"/":out.toString();
 }
 private static final class Route {int lines,bodies,invalid,requests;final Node shape=new Node(),request=new Node();final TreeSet<String> enums=new TreeSet<>();}

 @Override public void onCreate(Bundle arguments){super.onCreate(arguments);args=arguments;start();}
 @Override public void onStart(){Bundle done=new Bundle();try{
  String nonce=args.getString("probe_id","");if(!nonce.matches("[a-f0-9]{32}"))throw new IllegalArgumentException("PROBE_ID_INVALID");
  File logs=new File(getTargetContext().getApplicationInfo().dataDir,"app_flutter/appLog");String boundary=logs.getCanonicalPath()+File.separator;
  List<File> files=new ArrayList<>();Deque<File> dirs=new ArrayDeque<>();dirs.add(logs);int visited=0;
  while(!dirs.isEmpty()&&visited++<64){File dir=dirs.remove();File[] children=dir.listFiles();if(children==null)continue;for(File f:children){if(Files.isSymbolicLink(f.toPath())||!f.getCanonicalPath().startsWith(boundary))continue;if(f.isDirectory())dirs.add(f);else if(f.getName().endsWith(".log")&&f.length()>0)files.add(f);}}
  files.sort(Comparator.comparingLong(File::lastModified).reversed());
  TreeMap<String,Route> routes=new TreeMap<>();long total=0,newest=0,oldest=Long.MAX_VALUE;int examined=0,oversized=0,otherHosts=0;
  for(File file:files){if(examined>=MAX_FILES||total>=TOTAL)break;examined++;newest=Math.max(newest,file.lastModified());oldest=Math.min(oldest,file.lastModified());long length=file.length(),start=Math.max(0,length-FILE_TAIL);
   try(RandomAccessFile raw=new RandomAccessFile(file,"r")){raw.seek(start);try(InputStream in=new BufferedInputStream(new FileInputStream(raw.getFD()),65536)){ByteArrayOutputStream line=new ByteArrayOutputStream();boolean discard=start>0;int b;
    while(total<TOTAL){b=in.read();if(b!=-1)total++;if(b!=-1&&b!=10){if(!discard){if(line.size()>=LINE_CAP){discard=true;oversized++;line.reset();}else line.write(b);}continue;}
     if(!discard&&line.size()>0){String text=new String(line.toByteArray(),StandardCharsets.UTF_8);Matcher m=REQUEST.matcher(text);
      if(m.find()){String host=m.group(2);boolean official=host.endsWith("rayneo.cn")||host.endsWith("rayneo.com");if(!official)otherHosts++;else if(routes.size()<MAX_ROUTES||routes.containsKey(m.group(1)+" "+route(m.group(3)))){
       String key=m.group(1)+" "+route(m.group(3));Route r=routes.computeIfAbsent(key,k->new Route());r.lines++;
       for(String marker:new String[]{"request body:","request data:"}){int pos=text.indexOf(marker);if(pos>=0&&(key.contains("/journal/")||key.startsWith("DELETE "))){String requestJson=text.substring(pos+marker.length()).trim();try{Object request=requestJson.startsWith("[")?new JSONArray(requestJson):new JSONObject(requestJson);r.requests++;r.request.add(request,0);}catch(JSONException ignored){}}}
       if(key.contains("/journal/")||key.startsWith("DELETE ")){Matcher enumValue=Pattern.compile("\"(periodType|mode|deleteType)\"\\s*:\\s*(?:\"(daily|weekly|monthly|day|week|month|DAILY|WEEKLY|MONTHLY|standard|normal|auto|manual)\"|([0-9])(?=[,}]))").matcher(text);while(enumValue.find())r.enums.add(enumValue.group(1)+"="+(enumValue.group(2)==null?enumValue.group(3):enumValue.group(2)));}
       int body=text.indexOf("response body:");if(body>=0&&INTEREST.matcher(key).find()){String json=text.substring(body+"response body:".length()).trim();try{Object value=json.startsWith("[")?new JSONArray(json):new JSONObject(json);r.bodies++;r.shape.add(value,0);}catch(JSONException bad){r.invalid++;}}
      }}
     }
     line.reset();discard=false;if(b==-1)break;
    }
   }}
  }
  JSONObject list=new JSONObject();for(Map.Entry<String,Route> e:routes.entrySet()){Route r=e.getValue();JSONObject row=new JSONObject().put("log_lines",r.lines).put("response_bodies",r.bodies);if(r.invalid>0)row.put("unparsed_bodies",r.invalid);if(r.bodies>0)row.put("shape",r.shape.json());if(r.requests>0)row.put("request_shape",r.request.json()).put("request_bodies",r.requests);if(!r.enums.isEmpty())row.put("known_contract_enums",new JSONArray(r.enums));list.put(e.getKey(),row);}
  JSONObject report=new JSONObject().put("schema",1).put("probe_id",nonce).put("read_only",true).put("network_requests",0).put("text_or_identifiers_exported",false)
   .put("log_files",files.size()).put("examined_files",examined).put("scanned_bytes",total).put("oversized_lines",oversized).put("other_host_lines",otherHosts)
   .put("newest_log_age_hours",newest==0?-1:(System.currentTimeMillis()-newest)/3600000).put("oldest_examined_log_age_hours",oldest==Long.MAX_VALUE?-1:(System.currentTimeMillis()-oldest)/3600000).put("routes",list);
  File destination=new File(getTargetContext().getExternalFilesDir(null),"io-agent-lifelog-detail-shape.json");try(FileOutputStream out=new FileOutputStream(destination)){out.write(report.toString(1).getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
  done.putInt("routes",routes.size());finish(Activity.RESULT_OK,done);
 }catch(Throwable failed){done.putString("error",failed.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,done);}}
}
