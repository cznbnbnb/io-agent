package com.turboio.addon;

import java.io.*;import java.net.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;

/** Synthetic material contracts and real journals. Integration HTTP is loopback-only. */
public final class MaterialTest {
 static int checks;static long now;static MaterialConnection connection;static List<Object> events;
 interface Work {void run()throws Exception;}
 static void yes(boolean v){checks++;if(!v)throw new AssertionError("Material assertion "+checks);}
 static void rejects(Work w)throws Exception{checks++;try{w.run();}catch(IllegalArgumentException|IOException expected){return;}throw new AssertionError("Expected rejection "+checks);}
 static Map<String,Object> copy(Object v){return WireJson.map(WireJson.copy(v));}
 static byte[] bytes(int i){return WireJson.bytes(events.get(i));}
 static Map<String,Object> row(MaterialOutbox q,int i){return WireJson.map(q.all().get(i));}
 static Map<String,Object> identity(){return WireJson.object("schema_version","1.0","owner_id",connection.owner,"producer_id",connection.producer,"server_id",connection.server,"expires_at",connection.expires,"scopes",Arrays.asList("materials:write"),"material_schema_versions",Arrays.asList("1.0","1.1","1.2"));}
 static byte[] ack(MaterialOutbox.Claim c){Map<String,Object> e=WireJson.map(WireJson.read(c.payload.getBytes(StandardCharsets.UTF_8))),b=WireJson.map(e.get("body"));return WireJson.bytes(WireJson.object("schema_version","1.2","event_id",c.eventId,"material_id",b.get("material_id"),"revision",b.get("revision"),"commit_seq",1,"stored_at",TaskWire.now(now),"receipt",WireJson.object("receipt_id","synthetic-receipt","subject_kind","material","subject_id",b.get("material_id"),"subject_revision",b.get("revision"),"stage","server_stored","actor_id","server-storage","related_event_id",c.eventId,"error",null)));}
 static void unit(File root)throws Exception{
  Map<String,Object> source=WireJson.map(WireJson.read(connection.encode()));yes(!connection.preview().contains(connection.token()));yes(connection.identity(WireJson.bytes(identity()),now,true).contains("1.2"));
  for(String key:new String[]{"format","base_url","owner_id","token","token_id","expires_at","unexpected"}){
   Map<String,Object> bad=copy(source);bad.put(key,key.equals("base_url")?"https://example.invalid/not-api":key.equals("expires_at")?TaskWire.now(now-1):key.equals("owner_id")?"../invalid":"invalid");rejects(()->MaterialConnection.parse(WireJson.bytes(bad),now));
  }
  for(String url:new String[]{"http://example.invalid/v1","https://u:p@example.invalid/v1","https://example.invalid/x/../v1","https://example.invalid/%76%31","https://example.invalid/v1?token=x","https://example.invalid:8443/v1"}){Map<String,Object> bad=copy(source);bad.put("base_url",url);rejects(()->MaterialConnection.parse(WireJson.bytes(bad),now));}
  String raw=new String(connection.encode(),StandardCharsets.UTF_8);rejects(()->MaterialConnection.parse((raw.substring(0,raw.length()-1)+",\"tok\\u0065n\":\"duplicate\"}").getBytes(StandardCharsets.UTF_8),now));rejects(()->MaterialConnection.parse((raw+" trailing").getBytes(StandardCharsets.UTF_8),now));
  for(String key:new String[]{"owner_id","producer_id","server_id","expires_at","scopes","material_schema_versions"}){Map<String,Object> bad=identity();bad.put(key,key.equals("expires_at")?TaskWire.now(now+1):key.equals("scopes")?Arrays.asList("tasks:write"):key.equals("material_schema_versions")?Arrays.asList("1.1"):"foreign");rejects(()->connection.identity(WireJson.bytes(bad),now,true));}
  for(Object e:events)yes(MaterialWire.event(WireJson.bytes(e),connection.producer).get("kind").equals("material.revision"));
  for(String fault:new String[]{"task","producer","extra","audio","coverage","tombstone","speaker","range"}){
   Map<String,Object> e=copy(events.get(0)),b=WireJson.map(e.get("body"));
   if(fault.equals("task"))e.put("kind","task");if(fault.equals("producer"))e.put("producer_id","foreign");if(fault.equals("extra"))b.put("credential","never-export");if(fault.equals("audio"))WireJson.map(b.get("audio")).put("state","stored_verified");if(fault.equals("coverage"))WireJson.map(b.get("processing")).put("covered_ms",999999);if(fault.equals("tombstone"))b.put("operation","delete");if(fault.equals("speaker"))WireJson.map(WireJson.list(b.get("speakers")).get(0)).put("is_self",true);if(fault.equals("range"))WireJson.map(WireJson.list(b.get("utterances")).get(0)).put("start_ms",null);
   rejects(()->MaterialWire.event(WireJson.bytes(e),connection.producer));
  }
  File cold=new File(root,"cold");String frozen;
  try(MaterialOutbox q=new MaterialOutbox(cold,connection)){
   q.enqueue(bytes(0));q.enqueue(bytes(0));yes(q.all().size()==1);Map<String,Object> changed=copy(events.get(0));WireJson.map(WireJson.map(changed.get("body")).get("full_text")).put("text","不得悄悄换正文");rejects(()->q.enqueue(WireJson.bytes(changed)));
   MaterialOutbox.Claim claim=q.claim(now,Collections.singleton("1.2"));yes(claim!=null&&claim.action.equals("send"));frozen=claim.payload;yes(q.claim(now,Collections.singleton("1.2"))==null);
  }
  try(MaterialOutbox q=new MaterialOutbox(cold,connection)){
   yes(row(q,0).get("state").equals("reconcile"));MaterialOutbox.Claim lookup=q.claim(now+1,Collections.emptySet());yes(lookup.action.equals("lookup")&&lookup.payload.equals(frozen));
   yes(q.finish(lookup,200,ack(lookup),now+2,0));yes(!q.finish(lookup,200,ack(lookup),now+2,0));yes(row(q,0).get("state").equals("server_stored"));
   q.enqueue(bytes(1));yes(q.claim(now+3,Collections.singleton("1.1"))==null);MaterialOutbox.Claim c=q.claim(now+4,Collections.singleton("1.2"));yes(c.action.equals("send"));Map<String,Object> bad=WireJson.map(WireJson.read(ack(c)));bad.put("material_id","foreign");yes(q.finish(c,200,WireJson.bytes(bad),now+4,0));yes(row(q,1).get("state").equals("blocked")&&Boolean.TRUE.equals(row(q,1).get("needs_lookup")));yes(q.resumeBlocked()==1);
   c=q.claim(now+5,Collections.singleton("1.2"));yes(c.action.equals("lookup"));yes(q.finish(c,404,WireJson.bytes(WireJson.object("schema_version","1.0","error",WireJson.object("code","EVENT_NOT_FOUND"))),now+5,0));
   c=q.claim(now+6,Collections.singleton("1.2"));yes(c.action.equals("send")&&c.payload.equals(new String(WireJson.bytes(events.get(1)),StandardCharsets.UTF_8)));q.finish(c,0,new byte[0],now+6,0);yes(q.claim(now+7,Collections.singleton("1.2"))==null);c=q.claim(now+60000,Collections.singleton("1.2"));yes(c.action.equals("lookup"));
  }
  try(MaterialOutbox q=new MaterialOutbox(new File(root,"delete-offline"),connection)){
   for(Object e:events)q.enqueue(WireJson.bytes(e));yes(q.claim(now,Collections.singleton("1.2"))==null);yes(row(q,0).get("error").equals("DELETE_REQUIRES_RECONCILIATION"));yes(q.all().size()==5);
   Map<String,Object> revived=copy(events.get(3));revived.put("event_id","must-not-revive");revived.put("idempotency_key","must-not-revive-key");WireJson.map(revived.get("body")).put("revision",6);WireJson.map(revived.get("body")).put("base_revision",5);rejects(()->q.enqueue(WireJson.bytes(revived)));
  }
  try(MaterialOutbox q=new MaterialOutbox(new File(root,"expiry"),connection)){
   q.enqueue(bytes(0));yes(q.claim(MaterialWire.time(WireJson.map(events.get(0)).get("expires_at"))+1,Collections.singleton("1.2"))==null);yes(row(q,0).get("state").equals("expired"));
  }
  try(MaterialOutbox q=new MaterialOutbox(new File(root,"expired-unknown"),connection)){
   q.enqueue(bytes(0));MaterialOutbox.Claim c=q.claim(now,Collections.singleton("1.2"));q.finish(c,0,new byte[0],now,0);long later=MaterialWire.time(WireJson.map(events.get(0)).get("expires_at"))+1000;c=q.claim(later,Collections.emptySet());yes(c!=null&&c.action.equals("lookup"));q.finish(c,200,ack(c),later,0);yes(row(q,0).get("state").equals("server_stored"));
  }
  try(MaterialOutbox q=new MaterialOutbox(new File(root,"unconfirmed-404"),connection)){
   q.enqueue(bytes(0));MaterialOutbox.Claim c=q.claim(now,Collections.singleton("1.2"));q.finish(c,0,new byte[0],now,0);c=q.claim(now+60000,Collections.emptySet());q.finish(c,404,WireJson.bytes(WireJson.object("schema_version","1.0","error",WireJson.object("code","NOT_FOUND"))),now+60000,0);yes(row(q,0).get("state").equals("blocked")&&row(q,0).get("error").equals("LOOKUP_NOT_CONFIRMED"));yes(q.claim(now+60001,Collections.singleton("1.2"))==null);
  }
  File uncertain=new File(root,"partial");try(MaterialOutbox q=new MaterialOutbox(uncertain,connection)){q.enqueue(bytes(0));}
  Path state=new File(uncertain,"material-outbox/"+connection.binding()+"/state.json").toPath(),partial=Paths.get(state+".partial");byte[] old=Files.readAllBytes(state);Files.write(partial,"uncertain".getBytes(StandardCharsets.UTF_8));rejects(()->new MaterialOutbox(uncertain,connection));yes(Arrays.equals(Files.readAllBytes(state),old)&&Files.exists(partial));
  Map<String,Object> other=copy(source);other.put("server_id","other-server");MaterialConnection foreign=MaterialConnection.parse(WireJson.bytes(other),now);try(MaterialOutbox q=new MaterialOutbox(new File(root,"foreign"),foreign)){
   MaterialApi api=new MaterialApi(connection,new MaterialApi.Transport(){public MaterialApi.Response exchange(String p,byte[] b){throw new AssertionError("Foreign queue accessed transport");}public void cancel(){}});rejects(()->api.pump(q,now));
  }
  MaterialHttp http=new MaterialHttp(connection);rejects(()->http.exchange("/tasks",new byte[]{1}));rejects(()->http.exchange("/identity?token=x",null));http.cancel();rejects(()->http.exchange("/identity",null));
  System.out.println("Android material core: "+checks+" assertions passed");
 }
 static final class Loopback implements MaterialApi.Transport {
  final String endpoint;boolean drop;
  Loopback(String endpoint,boolean drop){if(!endpoint.matches("http://127\\.0\\.0\\.1:[0-9]+/v1"))throw new IllegalArgumentException();this.endpoint=endpoint;this.drop=drop;}
  public MaterialApi.Response exchange(String path,byte[] payload)throws IOException{
   HttpURLConnection c=(HttpURLConnection)new URL(endpoint+path).openConnection();try{c.setConnectTimeout(3000);c.setReadTimeout(5000);c.setInstanceFollowRedirects(false);c.setRequestMethod(payload==null?"GET":"POST");c.setRequestProperty("Authorization","Bearer "+connection.token());if(payload!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(payload);}}
    int status=c.getResponseCode();ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=status>=400?c.getErrorStream():c.getInputStream()){if(in!=null){byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1){if(out.size()+n>1048576)throw new IOException("FIXTURE_BUDGET");out.write(block,0,n);}}}if(drop&&payload!=null&&path.equals("/material-events")&&status==201){drop=false;throw new IOException("SYNTHETIC_LOST_ACK");}return new MaterialApi.Response(status,out.toByteArray(),0);
   }finally{c.disconnect();}
  }public void cancel(){}
 }
 public static void main(String[] args)throws Exception{
  Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get(args[2]))));now=MaterialWire.number(fixture.get("now"));connection=MaterialConnection.parse(WireJson.bytes(fixture.get("connection")),now);events=WireJson.list(fixture.get("events"));File root=new File(args[1]);
  if(args[0].equals("unit")){unit(root);return;}
  try(MaterialOutbox q=new MaterialOutbox(root,connection)){
   MaterialApi api=new MaterialApi(connection,new Loopback((String)fixture.get("endpoint"),args[0].equals("lost-ack")));
   if(args[0].equals("lost-ack")){q.enqueue(bytes(0));rejects(()->api.pump(q,now));yes(row(q,0).get("state").equals("retry_wait")&&Boolean.TRUE.equals(row(q,0).get("needs_lookup")));}
   else if(args[0].equals("resume")){yes(q.all().size()==1);yes(api.pump(q,now+60000));yes(row(q,0).get("state").equals("server_stored"));for(int i=1;i<events.size();i++){q.enqueue(bytes(i));yes(api.pump(q,now+60001+i));yes(row(q,i).get("state").equals("server_stored"));}yes(q.all().size()==5);}
   else throw new IllegalArgumentException("FIXTURE_MODE_INVALID");
  }System.out.println("Android material loopback "+args[0]+": "+checks+" assertions passed");
 }
}
