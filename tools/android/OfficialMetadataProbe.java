package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.lang.reflect.*;import java.net.*;import java.nio.*;import java.nio.channels.*;import java.nio.charset.*;import java.nio.file.*;import java.nio.file.attribute.*;import java.util.*;import java.util.regex.*;import org.json.*;

/** Current-account cache metadata only. No HTTP, SDK, file writes or cache edits. */
public final class OfficialMetadataProbe extends Instrumentation {
 private String nonce,accountBinding;private ClassLoader loader;private int shapeNodes;
 private static final String[] DELETION_KEYS={"flutter.recording_deletion_ledger_v1","recording_deletion_ledger_v1"};
 private static final String[] SESSION_KEYS={"recording_cache_list","flutter.recording_cache_list","session_task_list","flutter.session_task_list"};
 private static final Set<String> PATHS=new HashSet<>(Arrays.asList("/lifelog/api/v1/calendar","/lifelog/api/v1/events","/clsapi/aiTask/selectPage","/clsapi/aiTask/v2/selectPage"));
 private static final Set<String> MONTH_KEYS=new HashSet<>(Arrays.asList("startMonth","endMonth","startYearMonth","endYearMonth"));
 private static final Set<String> QUERY_KEYS=new HashSet<>(Arrays.asList("date","timezone","startMonth","endMonth","startYearMonth","endYearMonth","page","pageSize","size","current","limit","offset","status","taskType","type"));
 private static final Set<String> KEYS=new HashSet<>(Arrays.asList("code","data","date","timezone","dailyLifelogList","dailySummaryList","hasLog","hasSummary","year","month","day","startMonth","endMonth","startDate","endDate","dateList","events","transcriptionInfos","sourceId","sourceType","id","taskId","rows","records","items","list","total","totalCount","page","pageSize","current","size","pages","hasMore","hasNext","nextPage","cursor","nextCursor","bucketName","objectKey","audioSaveFlag","status","createTime","updateTime","createdAt","updatedAt","duration","audioLengthSeconds","version","schema","schemaVersion","entries","deleted","isDeleted","deletedAt","deletedIds","taskIds","recordingIds","recordingId","deletedRecordings","tombstones","pending","confirmed","expiresAt","timestamp","reason","state","revision"));
 private Class<?> type(String name)throws Exception{return loader.loadClass("com.turboio.addon."+name);}
 private Class<?> local(String name)throws Exception{return getClass().getClassLoader().loadClass("com.turboio.androidtests.voice."+name);}
 private Object call(Object owner,String name,Class<?>[] args,Object...values)throws Exception{Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();Method m=c.getDeclaredMethod(name,args);m.setAccessible(true);return m.invoke(owner instanceof Class?null:owner,values);}
 private Object field(Object owner,String name)throws Exception{Field f=owner.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(owner);}
 private static void check(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 private Object account()throws Exception{return call(type("Host107Login"),"account",new Class<?>[0]);}
 private void admit()throws Exception{Object current=account();check(current!=null&&accountBinding.equals(field(current,"binding")),"OFFICIAL_ACCOUNT_CHANGED");}
 private Object parsed(Object value)throws Exception{if(value instanceof String){byte[] bytes=((String)value).getBytes(StandardCharsets.UTF_8);check(bytes.length<=2097152,"METADATA_JSON_BUDGET");return call(type("WireJson"),"read",new Class<?>[]{byte[].class},bytes);}return value;}
 private static String kind(Object value){return value==null?"null":value instanceof Map?"object":value instanceof List?"array":value instanceof String?"string":value instanceof Boolean?"boolean":value instanceof Number?"number":"unsupported";}
 static {KEYS.addAll(MONTH_KEYS);}
 private Object shape(Object value,int depth)throws Exception{
  check(++shapeNodes<=20000,"METADATA_SHAPE_BUDGET");if(depth>=6)return "depth_limit";
  if(value instanceof Map){Map<?,?> map=(Map<?,?>)value;check(map.size()<=10000,"METADATA_SHAPE_BUDGET");JSONObject out=new JSONObject();int unknown=0;for(Map.Entry<?,?> entry:map.entrySet())if(KEYS.contains(entry.getKey()))out.put((String)entry.getKey(),shape(entry.getValue(),depth+1));else unknown++;if(unknown>0)out.put("_other_field_count",unknown);return out;}
  if(value instanceof List){List<?> list=(List<?>)value;check(list.size()<=10000,"METADATA_SHAPE_BUDGET");JSONArray samples=new JSONArray();for(int i=0;i<Math.min(2,list.size());i++)samples.put(shape(list.get(i),depth+1));return new JSONObject().put("count",list.size()).put("sample_shapes",samples);}
  return kind(value);
 }
 private Map<?,?> map(Object raw,JSONObject audit,String name)throws Exception{Object value=parsed(raw);audit.put(name+"_type",kind(value));check(value instanceof Map,"METADATA_OBJECT_SHAPE_UNSUPPORTED");return (Map<?,?>)value;}
 private URI uri(Object raw)throws Exception{check(raw instanceof String&&((String)raw).length()<=4096,"METADATA_URL_SHAPE_UNSUPPORTED");URI uri=new URI((String)raw);check("https".equals(uri.getScheme())&&"xr-api-p.rayneo.cn".equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443)&&uri.getRawUserInfo()==null&&uri.getRawFragment()==null&&PATHS.contains(uri.getRawPath()),"METADATA_CACHE_SCOPE_INVALID");return uri;}
 private static String format(Object value){
  if(value instanceof Number){
   double decimal=((Number)value).doubleValue();if(!Double.isFinite(decimal)||Math.rint(decimal)!=decimal||decimal<Long.MIN_VALUE||decimal>=Long.MAX_VALUE)return "number_fractional_or_out_of_range";
   long integer=((Number)value).longValue();String digits=Long.toString(integer);boolean month=integer>=197001&&integer<=999912&&integer%100>=1&&integer%100<=12;
   return month?"number_integer_6digits_valid_yyyymm":"number_integer_"+(integer<0?"negative":digits.length()+"digits");
  }
  if(!(value instanceof String))return kind(value);String s=(String)value;if(s.matches("[0-9]{4}-[0-9]{2}"))return "yyyy-MM";if(s.matches("[0-9]{6}"))return "yyyymm";if(s.matches("[0-9]+"))return "numeric_string";return "other_string";
 }
 private JSONObject request(URI uri,Map<?,?> stored,JSONObject out)throws Exception{
  JSONObject formats=new JSONObject();Set<String> names=new TreeSet<>();int unknown=0;Set<String> seen=new HashSet<>();
  if(uri.getRawQuery()!=null&&!uri.getRawQuery().isEmpty())for(String part:uri.getRawQuery().split("&",-1)){String[] pair=part.split("=",2);check(pair.length==2,"METADATA_QUERY_SHAPE_UNSUPPORTED");String key=URLDecoder.decode(pair[0],"UTF-8");check(seen.add(key),"METADATA_QUERY_DUPLICATE");if(QUERY_KEYS.contains(key)){names.add(key);if(MONTH_KEYS.contains(key))formats.put(key,format(URLDecoder.decode(pair[1],"UTF-8")));}else unknown++;}
  out.put("query_names",new JSONArray(names)).put("other_query_count",unknown).put("month_formats",formats);
  // Inspect only explicit known request parameter containers; never headers.
  Object request=stored.get("request");if(request!=null){out.put("cached_request_type",kind(request));check(request instanceof Map,"METADATA_REQUEST_SHAPE_UNSUPPORTED");for(String container:new String[]{"queryParameters","params","data","body"}){Object values=((Map<?,?>)request).get(container);if(values==null)continue;out.put(container+"_type",kind(values));check(values instanceof Map,"METADATA_REQUEST_PARAMETERS_UNSUPPORTED");JSONObject months=new JSONObject();for(String key:MONTH_KEYS)if(((Map<?,?>)values).containsKey(key))months.put(key,format(((Map<?,?>)values).get(key)));out.put(container+"_month_formats",months);}}
  return out;
 }
 private Map<?,?> response(Object storedRaw,JSONObject audit,boolean detailed)throws Exception{Map<?,?> stored=map(storedRaw,audit,"cache_value");Map<?,?> response=map(stored.get("response"),audit,"response");if(detailed)audit.put("response_shape",shape(response,0));check(Long.valueOf(0).equals(response.get("code")),"METADATA_RESPONSE_NOT_SUCCESS");return response;}
 private void eventSources(Map<?,?> response,Set<String> sources,JSONObject audit)throws Exception{
  Map<?,?> data=map(response.get("data"),audit,"data");Object rows=data.get("events");audit.put("events_type",kind(rows));check(rows instanceof List,"METADATA_EVENTS_SHAPE_UNSUPPORTED");check(((List<?>)rows).size()<=10000,"METADATA_ROWS_BUDGET");int links=0;
  for(Object raw:(List<?>)rows){check(raw instanceof Map,"METADATA_EVENT_SHAPE_UNSUPPORTED");Object info=((Map<?,?>)raw).get("transcriptionInfos");if(info==null)continue;check(info instanceof List,"METADATA_SOURCE_LINK_SHAPE_UNSUPPORTED");for(Object link:(List<?>)info){check(link instanceof Map,"METADATA_SOURCE_LINK_SHAPE_UNSUPPORTED");Object id=((Map<?,?>)link).get("sourceId");check(id instanceof String&&((String)id).matches("[A-Za-z0-9_.:-]{1,128}"),"METADATA_SOURCE_ID_SHAPE_UNSUPPORTED");sources.add((String)id);check(++links<=10000&&sources.size()<=10000,"METADATA_SOURCE_BUDGET");}}
  audit.put("rows",((List<?>)rows).size()).put("source_links",links);
 }
 private void calendar(Map<?,?> response,JSONObject audit)throws Exception{
  Map<?,?> data=map(response.get("data"),audit,"data");audit.put("data_shape",shape(data,0));Object rows=data.get("dailyLifelogList");audit.put("dailyLifelogList_type",kind(rows));check(rows instanceof List,"METADATA_CALENDAR_SHAPE_UNSUPPORTED");check(((List<?>)rows).size()<=10000,"METADATA_ROWS_BUDGET");int yes=0,no=0,missing=0,other=0;
  for(Object row:(List<?>)rows){check(row instanceof Map,"METADATA_CALENDAR_ROW_SHAPE_UNSUPPORTED");Map<?,?> value=(Map<?,?>)row;if(!value.containsKey("hasLog"))missing++;else if(Boolean.TRUE.equals(value.get("hasLog")))yes++;else if(Boolean.FALSE.equals(value.get("hasLog")))no++;else other++;}
  audit.put("dailyLifelogList_count",((List<?>)rows).size()).put("hasLog_true",yes).put("hasLog_false",no).put("hasLog_missing",missing).put("hasLog_other_type",other);check(other==0,"METADATA_HASLOG_SHAPE_UNSUPPORTED");
 }
 private void sessions(Map<?,?> response,Set<String> sources,JSONObject audit)throws Exception{
  Object data=parsed(response.get("data"));audit.put("data_type",kind(data));Object rows=data;String path="data";
  if(data instanceof Map){rows=null;int found=0;for(String key:new String[]{"rows","records","items","list"})if(((Map<?,?>)data).containsKey(key)){found++;rows=((Map<?,?>)data).get(key);path="data."+key;}audit.put("row_containers",found);check(found==1,"METADATA_SESSION_CONTAINER_UNSUPPORTED");}
  audit.put("rows_type",kind(rows)).put("rows_path",path);check(rows instanceof List,"METADATA_SESSION_ROWS_UNSUPPORTED");check(((List<?>)rows).size()<=10000,"METADATA_ROWS_BUDGET");int ids=0,tasks=0,buckets=0,objects=0,flags=0;
  for(Object row:(List<?>)rows){check(row instanceof Map,"METADATA_SESSION_ROW_UNSUPPORTED");Map<?,?> value=(Map<?,?>)row;if(sources.contains(value.get("id")))ids++;if(sources.contains(value.get("taskId")))tasks++;if(value.containsKey("bucketName"))buckets++;if(value.containsKey("objectKey"))objects++;if(value.containsKey("audioSaveFlag"))flags++;}
  audit.put("rows",((List<?>)rows).size()).put("id_source_matches",ids).put("taskId_source_matches",tasks).put("bucketName_present",buckets).put("objectKey_present",objects).put("audioSaveFlag_present",flags);
 }
 private static String[] deletionSnapshot(SharedPreferences prefs)throws Exception{String[] result=new String[2];for(int i=0;i<DELETION_KEYS.length;i++)if(prefs.contains(DELETION_KEYS[i])){try{result[i]=prefs.getString(DELETION_KEYS[i],null);}catch(ClassCastException unsupported){throw new IllegalStateException("METADATA_DELETION_PREF_TYPE_UNSUPPORTED");}check(result[i]!=null&&result[i].length()<=1048576,"METADATA_DELETION_PREF_BUDGET");}return result;}
 private static String[] sessionSnapshot(SharedPreferences prefs)throws Exception{String[] result=new String[SESSION_KEYS.length];for(int i=0;i<SESSION_KEYS.length;i++)if(prefs.contains(SESSION_KEYS[i])){try{result[i]=prefs.getString(SESSION_KEYS[i],null);}catch(ClassCastException unsupported){throw new IllegalStateException("METADATA_SESSION_PREF_TYPE_UNSUPPORTED");}check(result[i]!=null&&result[i].length()<=1048576,"METADATA_SESSION_PREF_BUDGET");}return result;}
 private static final byte[] LOG_TAG="[Interceptor.Http]".getBytes(StandardCharsets.US_ASCII),BODY_MARK="] req body: ".getBytes(StandardCharsets.US_ASCII),HEADERS_MARK="] headers: ".getBytes(StandardCharsets.US_ASCII),RESPONSE_MARK="] response body: ".getBytes(StandardCharsets.US_ASCII),CALENDAR_MARK="/lifelog/api/v1/calendar".getBytes(StandardCharsets.US_ASCII),SESSION_MARK="/clsapi/aiTask/".getBytes(StandardCharsets.US_ASCII);
 private static final Pattern REQUEST_HEADER=Pattern.compile("\\[Interceptor\\.Http\\]\\s*→\\s*\\[(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) ([^\\s\\[\\]]+)\\] req body: ");
 // The origin/path allowlist below remains identical. Only a decorated prefix
 // between the fixed logger tag and this exact method/URL suffix may differ.
 private static final Pattern REQUEST_SUFFIX=Pattern.compile("\\[(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) ([^\\s\\[\\]]+)\\] req body: \\z");
 private static final Pattern METHOD_BRACKET=Pattern.compile("\\[(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)(?: |\\t|\\])");
 private static final class LogStages {
  final JSONObject all=new JSONObject(),calendar=new JSONObject(),sessions=new JSONObject();
  final JSONArray rejectedFragmentShapes=new JSONArray();final Map<String,JSONObject> fragmentShapes=new LinkedHashMap<>();
  void hit(String key,int scope)throws JSONException{all.put(key,all.optInt(key)+1);if((scope&1)!=0)calendar.put(key,calendar.optInt(key)+1);if((scope&2)!=0)sessions.put(key,sessions.optInt(key)+1);}
  void rejectedFragment(String raw,int scope)throws JSONException{
   // Input is bounded by the 4 KiB header limit and is never decoded or emitted.
   // Keep only character classes and five fixed separators, with adjacent equal
   // classes collapsed. Neither original letters/digits nor their run lengths
   // enter a JSON key or value. This cannot authorize a different URI shape.
   StringBuilder shape=new StringBuilder();char prior=0;boolean truncated=false;
   for(int i=0;i<raw.length();i++){char c=raw.charAt(i),kind=c>='0'&&c<='9'?'D':(c>='A'&&c<='Z')||(c>='a'&&c<='z')?'L':"#_-.:".indexOf(c)>=0?c:'?';
    if(kind==prior)continue;prior=kind;if(shape.length()==64){truncated=true;break;}shape.append(kind);
   }
   int length=raw.length();String bucket=length==0?"0":length<=8?"1-8":length<=16?"9-16":length<=32?"17-32":length<=64?"33-64":length<=128?"65-128":length<=256?"129-256":length<=512?"257-512":length<=4096?"513-4096":"over-4096";
   String key=bucket+"/"+truncated+"/"+shape;JSONObject row=fragmentShapes.get(key);
   if(row==null){if(fragmentShapes.size()>=16){hit("rejected_fragment_shape_limit",scope);return;}
    row=new JSONObject().put("shape",shape.toString()).put("length_bucket",bucket).put("shape_truncated",truncated).put("count",0).put("calendar_count",0).put("session_count",0);fragmentShapes.put(key,row);rejectedFragmentShapes.put(row);
   }
   row.put("count",row.optInt("count")+1);if((scope&1)!=0)row.put("calendar_count",row.optInt("calendar_count")+1);if((scope&2)!=0)row.put("session_count",row.optInt("session_count")+1);
  }
  JSONObject json()throws JSONException{return new JSONObject().put("all",all).put("calendar_header_candidates",calendar).put("session_header_candidates",sessions).put("rejected_fragment_shapes",rejectedFragmentShapes).put("fragment_shape_encoding","raw_fragment_not_decoded").put("fragment_shape_max_chars",64).put("fragment_shape_max_records",16);}
 }
 private static final Set<String> BODY_KEYS=new HashSet<>(QUERY_KEYS);
 static {BODY_KEYS.add("accountId");BODY_KEYS.add("physicalTimezone");}
 private static int find(byte[] bytes,int start,int end,byte[] expected){outer:for(int i=start;i<=end-expected.length;i++){for(int j=0;j<expected.length;j++)if(bytes[i+j]!=expected[j])continue outer;return i;}return -1;}
 private static int occurrences(byte[] bytes,byte[] marker){int count=0,at=0;while((at=find(bytes,at,bytes.length,marker))>=0){count++;at+=marker.length;}return count;}
 private static String utf8(byte[] bytes,int start,int end)throws CharacterCodingException{return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes,start,end-start)).toString();}
 private JSONObject logRequest(byte[] bytes,int start,int end,Object privateAccountId,LogStages stages)throws Exception{
  // Headers and all other log records are discarded at byte-marker selection;
  // their contents are never decoded, JSON parsed or placed in diagnostics.
  int tag=find(bytes,start,end,LOG_TAG);if(tag<0)return null;stages.hit("tag_line",0);
  int mark=find(bytes,tag+LOG_TAG.length,end,BODY_MARK),headers=find(bytes,tag+LOG_TAG.length,end,HEADERS_MARK),response=find(bytes,tag+LOG_TAG.length,end,RESPONSE_MARK);
  if((headers>=0&&(mark<0||headers<mark))||(response>=0&&(mark<0||response<mark))){stages.hit(headers>=0&&(response<0||headers<response)?"headers_record_discarded":"response_record_discarded",0);return null;}
  if(mark<0){stages.hit("request_marker_absent",0);return null;}int bodyStart=mark+BODY_MARK.length;
  int scope=(find(bytes,tag,bodyStart,CALENDAR_MARK)>=0?1:0)|(find(bytes,tag,bodyStart,SESSION_MARK)>=0?2:0);stages.hit("request_marker_line",scope);
  if(find(bytes,tag+LOG_TAG.length,bodyStart,LOG_TAG)>=0){stages.hit("multiple_tags_rejected",scope);return null;}
  if(bodyStart-tag>4096){stages.hit("header_budget_rejected",scope);return null;}
  String header;try{header=utf8(bytes,tag,bodyStart);}catch(CharacterCodingException invalid){stages.hit("header_utf8_rejected",scope);return null;}
  stages.hit("header_utf8_valid",scope);
  if(header.indexOf('\u001b')>=0)stages.hit("header_has_ansi_escape",scope);
  if(header.indexOf('→')>=0)stages.hit("header_has_right_arrow",scope);
  if(header.contains("->"))stages.hit("header_has_ascii_arrow",scope);
  if(header.contains("\\u2192"))stages.hit("header_has_escaped_arrow",scope);
  if(header.indexOf('←')>=0)stages.hit("header_has_left_arrow",scope);
  if(METHOD_BRACKET.matcher(header).find())stages.hit("header_has_method_bracket",scope);
  if(header.contains("https://"))stages.hit("header_has_https_literal",scope);
  if(header.contains("http://"))stages.hit("header_has_http_literal",scope);
  if(header.contains("\\/"))stages.hit("header_has_escaped_slash",scope);
  Matcher strict=REQUEST_HEADER.matcher(header),match=REQUEST_SUFFIX.matcher(header);boolean exact=strict.matches();
  stages.hit(exact?"strict_header_match":"strict_header_rejected",scope);
  if(!match.find()){stages.hit("suffix_header_rejected",scope);return null;}stages.hit("suffix_header_match",scope);
  // A left-arrow response cannot become a request merely by carrying a similar
  // literal. No header/response payload is ever inspected to find another URL.
  if(header.indexOf('←')>=0){stages.hit("response_direction_rejected",scope);return null;}
  URI endpoint;try{endpoint=new URI(match.group(2));}catch(URISyntaxException invalid){stages.hit("uri_syntax_rejected",scope);return null;}
  stages.hit("uri_syntax_valid",scope);
  // Real fixed-host request logs include a trailing '#': the observed raw
  // fragment is empty. Admit only absent/empty fragments for this read-only
  // metadata scan. Never replay the logged URL or accept a nonempty fragment.
  String rawFragment=endpoint.getRawFragment();boolean emptyLogFragment="".equals(rawFragment);
  boolean https="https".equals(endpoint.getScheme()),host="xr-api-p.rayneo.cn".equals(endpoint.getHost()),port=endpoint.getPort()==-1||endpoint.getPort()==443,user=endpoint.getRawUserInfo()==null,fragment=rawFragment==null||emptyLogFragment,path=PATHS.contains(endpoint.getRawPath());
  stages.hit(https?"uri_https":"uri_scheme_rejected",scope);stages.hit(host?"uri_host_expected":"uri_host_rejected",scope);stages.hit(port?"uri_port_allowed":"uri_port_rejected",scope);stages.hit(user?"uri_userinfo_absent":"uri_userinfo_rejected",scope);stages.hit(fragment?"uri_fragment_absent":"uri_fragment_rejected",scope);stages.hit(path?"uri_path_known":"uri_path_rejected",scope);
  // Diagnose rejected fragments only after all other official-origin/path
  // gates pass. No body, account field or arbitrary-origin URL is inspected.
  if(!fragment&&https&&host&&port&&user&&path&&!"/lifelog/api/v1/events".equals(endpoint.getRawPath()))stages.rejectedFragment(rawFragment,"/lifelog/api/v1/calendar".equals(endpoint.getRawPath())?1:2);
  if(!endpoint.isAbsolute())stages.hit("uri_relative",scope);
  if(!https||!host||!port||!user||!fragment||!path)return null;
  if("/lifelog/api/v1/events".equals(endpoint.getRawPath())){stages.hit("events_request_discarded",scope);return null;}stages.hit("request_scope_accepted",scope);
  JSONObject row=new JSONObject().put("method",match.group(1)).put("route","/lifelog/api/v1/calendar".equals(endpoint.getRawPath())?"calendar":"/clsapi/aiTask/v2/selectPage".equals(endpoint.getRawPath())?"v2_selectPage":"selectPage").put("account_ownership_unverified",true).put("header_exact_match",exact).put("empty_log_fragment_present",emptyLogFragment).put("logged_url_replayed",false);
  JSONObject query=new JSONObject();row.put("query",query);try{request(endpoint,Collections.emptyMap(),query);}catch(Exception unsupported){stages.hit("query_shape_rejected",scope);row.put("query_parse_supported",false);return row;}
  stages.hit("query_shape_accepted",scope);
  Object body;try{String raw=utf8(bytes,bodyStart,end);body=parsed(raw);}catch(Exception unsupported){stages.hit("body_parse_rejected",scope);row.put("body_parse_supported",false);return row;}
  row.put("body_parse_supported",body instanceof Map).put("body_type",kind(body));if(!(body instanceof Map)){stages.hit("body_non_object",scope);return row;}stages.hit("body_object_accepted",scope);
  Map<?,?> values=(Map<?,?>)body;JSONObject fields=new JSONObject(),months=new JSONObject();int unknown=0;
  for(Map.Entry<?,?> field:values.entrySet())if(BODY_KEYS.contains(field.getKey())){String key=(String)field.getKey();fields.put(key,kind(field.getValue()));if(MONTH_KEYS.contains(key))months.put(key,format(field.getValue()));}else unknown++;
  row.put("body_fields",fields).put("other_body_field_count",unknown).put("body_month_formats",months);
  if(values.containsKey("accountId")){Object recorded=values.get("accountId");boolean comparable=privateAccountId instanceof Long&&recorded instanceof Long;row.put("account_id_match_comparable",comparable).put("account_id_matches_current",comparable&&privateAccountId.equals(recorded));}
  return row;
 }
 private static final class LogFile {final File file;final BasicFileAttributes attrs;LogFile(File file,BasicFileAttributes attrs){this.file=file;this.attrs=attrs;}}
 private static boolean canonical(File file)throws IOException{return file.getAbsoluteFile().equals(file.getCanonicalFile())&&!Files.isSymbolicLink(file.toPath());}
 private void requestLogs(File flutter,Object login,JSONObject report)throws Exception{
  final int maxFiles=4,maxTail=4194304,maxLine=1048576,maxShapes=16;JSONArray shapes=new JSONArray();Set<String> seenShapes=new HashSet<>();LogStages stages=new LogStages();report.put("records",shapes).put("selector_stages",stages.json()).put("selector_stage_missing_means_zero",true).put("account_ownership_unverified",true).put("complete_history",false).put("max_files",maxFiles).put("max_tail_bytes_per_file",maxTail).put("max_total_bytes",16777216).put("max_line_bytes",maxLine).put("max_shapes",maxShapes).put("deduplicated_sanitized_shapes",true);
  File appRoot=new File(getTargetContext().getApplicationInfo().dataDir).getCanonicalFile(),resolved=flutter.getCanonicalFile();check(resolved.getParentFile().equals(appRoot)&&resolved.getName().equals("app_flutter"),"METADATA_LOG_PATH_INVALID");report.put("android_data_alias_resolved",!flutter.getAbsoluteFile().equals(resolved));flutter=resolved;check(canonical(flutter)&&flutter.isDirectory(),"METADATA_LOG_PATH_INVALID");File directory=new File(flutter,"appLog");if(!directory.exists()){report.put("directory_present",false);return;}check(canonical(directory)&&directory.isDirectory(),"METADATA_LOG_PATH_INVALID");report.put("directory_present",true);
  String boundary=directory.getCanonicalPath()+File.separator;Deque<File> todo=new ArrayDeque<>();todo.add(directory);PriorityQueue<LogFile> latest=new PriorityQueue<>(Comparator.comparingLong(f->f.attrs.lastModifiedTime().toMillis()));int visited=0,entries=0,eligible=0,skipped=0;boolean enumerationLimited=false;
  outer:while(!todo.isEmpty()){
   if(visited++>=128){enumerationLimited=true;break;}File parent=todo.remove();if(!canonical(parent)){skipped++;continue;}
   try(DirectoryStream<Path> children=Files.newDirectoryStream(parent.toPath())){for(Path path:children){if(++entries>4096){enumerationLimited=true;break outer;}File file=path.toFile();if(!canonical(file)||!file.getCanonicalPath().startsWith(boundary)){skipped++;continue;}BasicFileAttributes attr=Files.readAttributes(path,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);if(attr.isDirectory())todo.add(file);else if(attr.isRegularFile()&&file.getName().endsWith(".log")){eligible++;latest.add(new LogFile(file,attr));if(latest.size()>maxFiles)latest.remove();}}}
  }
  report.put("enumeration_limited",enumerationLimited).put("eligible_log_files",eligible).put("skipped_paths",skipped);
  // Without a complete bounded directory enumeration, newest-four is not proven.
  if(enumerationLimited){report.put("scan_stopped",true).put("files_scanned",0).put("bytes_scanned",0);return;}
  List<LogFile> selected=new ArrayList<>(latest);selected.sort(Comparator.comparingLong((LogFile f)->f.attrs.lastModifiedTime().toMillis()).reversed());int scanned=0,partialHeads=0,partialTails=0,oversized=0,changed=0;long total=0;boolean capped=false;Object privateAccountId=field(login,"accountId");int httpMarkers=0,bodyMarkers=0,calendarMarkers=0,sessionMarkers=0;
  for(LogFile selectedFile:selected){admit();File file=selectedFile.file;check(canonical(file)&&file.getCanonicalPath().startsWith(boundary),"METADATA_LOG_PATH_INVALID");BasicFileAttributes before=Files.readAttributes(file.toPath(),BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);check(before.isRegularFile(),"METADATA_LOG_PATH_INVALID");long length=before.size(),offset=Math.max(0,length-maxTail);int size=(int)(length-offset);check(total+size<=16777216,"METADATA_LOG_BUDGET");byte[] bytes=new byte[size];ByteBuffer buffer=ByteBuffer.wrap(bytes);
   try(SeekableByteChannel input=Files.newByteChannel(file.toPath(),StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){input.position(offset);while(buffer.hasRemaining()){int n=input.read(buffer);check(n>0,"METADATA_LOG_CHANGED");}}
   scanned++;total+=size;BasicFileAttributes after=Files.readAttributes(file.toPath(),BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);if(before.size()!=after.size()||!before.lastModifiedTime().equals(after.lastModifiedTime())||!Objects.equals(before.fileKey(),after.fileKey())){changed++;Arrays.fill(bytes,(byte)0);continue;}
   httpMarkers+=occurrences(bytes,LOG_TAG);bodyMarkers+=occurrences(bytes,BODY_MARK);calendarMarkers+=occurrences(bytes,"/lifelog/api/v1/calendar".getBytes(StandardCharsets.US_ASCII));sessionMarkers+=occurrences(bytes,"/clsapi/aiTask/".getBytes(StandardCharsets.US_ASCII));
   int lineStart=0;boolean discard=offset>0;if(discard)partialHeads++;for(int i=0;i<size;i++){if(bytes[i]!=10)continue;int end=i>lineStart&&bytes[i-1]==13?i-1:i;if(!discard){if(end-lineStart>maxLine)oversized++;else if(shapes.length()<maxShapes){JSONObject row=logRequest(bytes,lineStart,end,privateAccountId,stages);if(row!=null&&seenShapes.add(row.toString()))shapes.put(row);}else capped=true;}discard=false;lineStart=i+1;}
   if(lineStart<size)partialTails++;Arrays.fill(bytes,(byte)0);admit();if(shapes.length()>=maxShapes){capped=true;break;}
  }
  report.put("files_scanned",scanned).put("bytes_scanned",total).put("incomplete_heads_skipped",partialHeads).put("incomplete_tails_skipped",partialTails).put("oversized_lines_skipped",oversized).put("changed_files_skipped",changed).put("shape_limit_reached",capped).put("marker_counts",new JSONObject().put("http_tag",httpMarkers).put("request_body",bodyMarkers).put("calendar_route",calendarMarkers).put("session_route",sessionMarkers));
 }
 @Override public void onCreate(Bundle args){super.onCreate(args);nonce=args.getString("probe_id","");start();}
 @Override public void onStart(){Bundle result=new Bundle();JSONObject audit=new JSONObject();Context context=getTargetContext();File queue=null;byte[] queueBefore=null;Map<String,?> settingsBefore=null;String[] deletionBefore=null,sessionBefore=null;SharedPreferences deletionPrefs=null;boolean passed=false;
  try{check(nonce.matches("[a-f0-9]{32}"),"PROBE_ID_INVALID");loader=context.getClassLoader();android.content.pm.PackageInfo pkg=context.getPackageManager().getPackageInfo(context.getPackageName(),0);check(pkg.getLongVersionCode()==10422&&"0.5.2-dev6".equals(pkg.versionName),"METADATA_CANDIDATE_MISMATCH");context.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(context,"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));Object login=null;long deadline=SystemClock.elapsedRealtime()+12000;do{login=account();if(login!=null)break;Thread.sleep(200);}while(SystemClock.elapsedRealtime()<deadline);check(login!=null,"OFFICIAL_LOGIN_REQUIRED");accountBinding=(String)field(login,"binding");
   audit.put("normal_activity_started",true).put("network_requests_scope","probe_explicit_requests");settingsBefore=new HashMap<>(context.getSharedPreferences("io_agent_materials_v1",0).getAll());deletionPrefs=context.getSharedPreferences("FlutterSharedPreferences",0);try{deletionBefore=deletionSnapshot(deletionPrefs);sessionBefore=sessionSnapshot(deletionPrefs);}catch(IllegalStateException unsupported){if("METADATA_DELETION_PREF_TYPE_UNSUPPORTED".equals(unsupported.getMessage()))audit.put("deletion_preference_value_type","non_string");if("METADATA_SESSION_PREF_TYPE_UNSUPPORTED".equals(unsupported.getMessage()))audit.put("session_preference_value_type","non_string");throw unsupported;}
   Constructor<?> constructor=type("MaterialSettings").getDeclaredConstructor(Context.class);constructor.setAccessible(true);Object config=call(constructor.newInstance(context),"load",new Class<?>[0]);check(config!=null&&accountBinding.equals(field(config,"account")),"FORMAL_ACCOUNT_MISMATCH");Object connection=field(config,"connection");check("turboio-user".equals(field(connection,"owner"))&&"phone-android".equals(field(connection,"producer")),"FORMAL_CONNECTION_MISMATCH");File accountFiles=(File)call(type("MaterialSyncSession"),"accountFiles",new Class<?>[]{File.class,type("MaterialConfig")},context.getFilesDir(),config);queue=new File(accountFiles,"material-outbox/"+call(connection,"binding",new Class<?>[0])+"/state.json");check(queue.isFile()&&queue.length()<=8388608&&!Files.isSymbolicLink(queue.toPath()),"FORMAL_QUEUE_MISSING");queueBefore=Files.readAllBytes(queue.toPath());
   File flutter=new File(context.getApplicationInfo().dataDir,"app_flutter"),cacheFile=(File)call(login,"cacheFile",new Class<?>[]{File.class},flutter);admit();Map<?,?> cache=(Map<?,?>)call(local("OfficialMetadataCache"),"read",new Class<?>[]{File.class},cacheFile);check(cache.size()<=128,"METADATA_CACHE_BUDGET");admit();audit.put("cache_entries",cache.size());JSONArray eventPages=new JSONArray(),calendarPages=new JSONArray(),sessionPages=new JSONArray();audit.put("events",eventPages).put("calendars",calendarPages).put("sessions",sessionPages);Set<String> sourceIds=new HashSet<>();
   for(Map.Entry<?,?> entry:cache.entrySet()){URI uri=uri(entry.getKey());if(!uri.getRawPath().equals("/lifelog/api/v1/events"))continue;JSONObject page=new JSONObject();eventPages.put(page);eventSources(response(entry.getValue(),page,true),sourceIds,page);}audit.put("known_source_count",sourceIds.size());
   for(Map.Entry<?,?> entry:cache.entrySet()){URI uri=uri(entry.getKey());String path=uri.getRawPath();if(path.equals("/lifelog/api/v1/events"))continue;JSONObject page=new JSONObject();boolean isCalendar=path.equals("/lifelog/api/v1/calendar");(isCalendar?calendarPages:sessionPages).put(page);if(!isCalendar)page.put("route",path.equals("/clsapi/aiTask/v2/selectPage")?"v2_selectPage":"selectPage");Map<?,?> stored=map(entry.getValue(),page,"cache_value");if(isCalendar){JSONObject req=new JSONObject();page.put("request",req);request(uri,stored,req);}Map<?,?> response=response(stored,page,isCalendar);if(isCalendar)calendar(response,page);else sessions(response,sourceIds,page);admit();}
   JSONArray ledgers=new JSONArray();audit.put("deletion_preferences",ledgers).put("deletion_is_authoritative",false).put("global_preferences_account_ownership_unverified",true);for(int i=0;i<DELETION_KEYS.length;i++){JSONObject ledger=new JSONObject().put("key",DELETION_KEYS[i]).put("present",deletionBefore[i]!=null).put("account_ownership_unverified",true);ledgers.put(ledger);if(deletionBefore[i]!=null){Object value=parsed(deletionBefore[i]);ledger.put("type",kind(value)).put("shape",shape(value,0));check(value instanceof Map||value instanceof List,"METADATA_DELETION_SHAPE_UNSUPPORTED");}}
   JSONArray sessionPreferences=new JSONArray();audit.put("session_preferences",sessionPreferences);for(int i=0;i<SESSION_KEYS.length;i++){JSONObject entry=new JSONObject().put("key",SESSION_KEYS[i]).put("present",sessionBefore[i]!=null).put("account_ownership_unverified",true);sessionPreferences.put(entry);if(sessionBefore[i]!=null){Object value=parsed(sessionBefore[i]);entry.put("type",kind(value)).put("shape",shape(value,0));Map<String,Object> wrapper=new HashMap<>();wrapper.put("data",value);sessions(wrapper,sourceIds,entry);}}
   JSONObject logs=new JSONObject();audit.put("request_logs",logs);requestLogs(flutter,login,logs);
   admit();passed=true;
  }catch(Throwable error){while(error.getCause()!=null)error=error.getCause();String message=error.getMessage();result.putString("error",message!=null&&message.matches("[A-Z_]{3,90}")?message:error.getClass().getSimpleName());}
  finally{try{admit();boolean same=queueBefore!=null&&queue!=null&&Arrays.equals(queueBefore,Files.readAllBytes(queue.toPath()))&&settingsBefore!=null&&settingsBefore.equals(context.getSharedPreferences("io_agent_materials_v1",0).getAll())&&deletionBefore!=null&&Arrays.equals(deletionBefore,deletionSnapshot(deletionPrefs))&&sessionBefore!=null&&Arrays.equals(sessionBefore,sessionSnapshot(deletionPrefs));result.putBoolean("state_unchanged",same);passed&=same;}catch(Throwable error){passed=false;result.putBoolean("state_unchanged",false);}result.putString("probe_id",nonce);result.putString("nonce",nonce);result.putBoolean("passed",passed);result.putBoolean("completed",true);result.putInt("network_requests",0);result.putInt("request_attempts",0);result.putBoolean("credentials_or_text_exported",false);result.putBoolean("mutations_attempted",false);result.putString("audit",audit.toString());finish(passed?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);}
 }
}
