package com.turboio.addon;
import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;
public final class OfficialLifelogSnapshotTest {
 static int checks;static final String EVENT="123456789012345678",SOURCE="0123456789abcdef0123456789abcdef",ACCOUNT=String.join("",Collections.nCopies(64,"a"));static final long START=1792500000000L;
 static void yes(boolean v){checks++;if(!v)throw new AssertionError("Lifelog mapping "+checks);}
 interface Work{void run()throws Exception;}static void rejects(Work w)throws Exception{checks++;try{w.run();}catch(IllegalArgumentException expected){return;}throw new AssertionError("Expected rejection "+checks);}
 static Map<String,Object> clip(String id,int start,int end,String text){return WireJson.object("clipId",id,"clipType","SPEECH","speakerType","OTHERS","speakerName","合成发言人","startTime",Long.toString(START+start),"endTime",Long.toString(START+end),"content",text,"translateContent",null,"languageCode","zh-CN");}
 static Map<String,Object> fixture(){Map<String,Object> link=WireJson.object("sourceType","CONVERSATION","sourceId",SOURCE);return WireJson.object("code",0,"msg","success","data",WireJson.object("id",EVENT,"deletable",true,"originalList",Arrays.asList(WireJson.object("id",SOURCE,"startTime",Long.toString(START),"endTime",Long.toString(START+10000),"transcriptionInfos",Arrays.asList(link))),"transcriptionContents",Arrays.asList(WireJson.object("sourceId",SOURCE,"sourceType","CONVERSATION","title","合成测试，不执行任务","startTime",Long.toString(START),"endTime",Long.toString(START+10000),"clips",Arrays.asList(clip("clip-1",0,1000,"只做预览。\n保留全部资料。"),clip("clip-2",500,1500,"星期五再执行 😀"),clip("clip-3",1500,2000,""))))));}
 static Map<String,Object> event(Map<String,Object> f){return WireJson.map(f.get("data"));}
 static Map<String,Object> source(Map<String,Object> f){return WireJson.map(WireJson.list(event(f).get("transcriptionContents")).get(0));}
 static Map<String,Object> firstClip(Map<String,Object> f){return WireJson.map(WireJson.list(source(f).get("clips")).get(0));}
 static OfficialLifelogSnapshot.Source read(Map<String,Object> f){return OfficialLifelogSnapshot.read(EVENT,WireJson.bytes(f)).get(0);}
 public static void main(String[] args)throws Exception {
  Map<String,Object> f=fixture();OfficialLifelogSnapshot.Source snapshot=read(f);yes(snapshot.clips.size()==3&&snapshot.sourceId.equals(SOURCE));
  Map<String,Object> body=WireJson.map(WireJson.read(snapshot.materialBody(ACCOUNT,1)));MaterialWire.body(body);
  yes(WireJson.map(body.get("full_text")).get("text").equals("只做预览。\n保留全部资料。\n星期五再执行 😀\n"));
  List<Object> utterances=WireJson.list(body.get("utterances"));yes(utterances.size()==3&&WireJson.map(utterances.get(0)).get("overlap").equals(true)&&WireJson.map(utterances.get(1)).get("overlap").equals(true)&&WireJson.map(utterances.get(2)).get("overlap").equals(false));
  yes(body.get("operation").equals("upsert")&&body.get("completeness").equals("partial")&&WireJson.map(body.get("processing")).get("covered_ms")==null);yes(WireJson.map(body.get("audio")).get("state").equals("missing"));
  yes(WireJson.map(WireJson.list(body.get("speakers")).get(0)).get("is_self").equals(false));
  Map<String,Object> regroup=fixture();event(regroup).put("id","987654321098765432");OfficialLifelogSnapshot.Source same=OfficialLifelogSnapshot.read("987654321098765432",WireJson.bytes(regroup)).get(0);yes(Arrays.equals(same.materialBody(ACCOUNT,1),snapshot.materialBody(ACCOUNT,1)));yes(!same.materialId(ACCOUNT).equals(same.materialId(ACCOUNT.replace('a','b'))));
  byte[] original=snapshot.original();original[0]=0;yes(snapshot.original()[0]=='{');yes(new String(snapshot.original(),StandardCharsets.UTF_8).contains("translateContent"));
  Map<String,Object> revision=WireJson.map(WireJson.read(snapshot.materialBody(ACCOUNT,2)));yes(((Long)revision.get("base_revision"))==1&&revision.get("material_id").equals(body.get("material_id")));
  rejects(()->snapshot.materialBody("",1));rejects(()->snapshot.materialBody(ACCOUNT,0));
  Map<String,Object> bad=fixture();bad.put("code",401);final Map<String,Object> codeBad=bad;rejects(()->read(codeBad));
  bad=fixture();event(bad).put("id","foreign");final Map<String,Object> eventBad=bad;rejects(()->read(eventBad));
  bad=fixture();firstClip(bad).put("startTime",Long.toString(START-1));final Map<String,Object> rangeBad=bad;rejects(()->read(rangeBad));
  bad=fixture();firstClip(bad).put("clipId","clip-2");final Map<String,Object> duplicateBad=bad;rejects(()->read(duplicateBad));
  bad=fixture();source(bad).put("sourceId","unrelated");final Map<String,Object> sourceBad=bad;rejects(()->read(sourceBad));
  bad=fixture();firstClip(bad).put("startTime","2026-10-21");final Map<String,Object> timeBad=bad;rejects(()->read(timeBad));
  String json=new String(WireJson.bytes(f),StandardCharsets.UTF_8);OfficialLifelogLogReader.Detail detail=OfficialLifelogLogReader.parse(("[Interceptor.Http] ← [GET https://xr-api-p.rayneo.cn/lifelog/api/v1/events/"+EVENT+"/full?#] response body: "+json).getBytes(StandardCharsets.UTF_8),0,0);yes(detail!=null&&OfficialLifelogSnapshot.read(detail.eventId,detail.json).size()==1);
  long now=System.currentTimeMillis();MaterialConnection connection=MaterialConnection.parse(WireJson.bytes(WireJson.object("format",MaterialConnection.FORMAT,"base_url","https://synthetic.invalid/v1","owner_id","synthetic-owner","producer_id","synthetic-phone","server_id","synthetic-server","token",String.join("",Collections.nCopies(43,"A")),"token_id","00000000-0000-4000-8000-000000000001","expires_at",TaskWire.now(now+3600000))),now);
  byte[] queued=WireJson.bytes(WireJson.object("schema_version","1.2","event_id","synthetic-lifelog-1","idempotency_key","synthetic-lifelog-1","kind","material.revision","producer_id",connection.producer,"created_at",TaskWire.now(now),"expires_at",TaskWire.now(now+3600000),"body",body));MaterialWire.event(queued,connection.producer);
  try(MaterialOutbox outbox=new MaterialOutbox(new File(args[0]),connection)){outbox.enqueue(queued);outbox.enqueue(queued);yes(outbox.all().size()==1);}
  try(MaterialOutbox outbox=new MaterialOutbox(new File(args[0]),connection)){yes(outbox.all().size()==1);Map<String,Object> stored=WireJson.map(outbox.all().get(0));Map<String,Object> restored=WireJson.map(WireJson.read(((String)stored.get("payload")).getBytes(StandardCharsets.UTF_8)));yes(Arrays.equals(WireJson.bytes(restored.get("body")),WireJson.bytes(body)));}
  System.out.println("Official lifelog mapping: "+checks+" assertions passed");
 }
}
