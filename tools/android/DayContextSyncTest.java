package com.turboio.addon;
import java.io.*;import java.net.*;import java.nio.file.*;import java.util.*;import javax.net.ssl.*;

final class DayContextSyncTest {
 static int checks;static void yes(boolean value){checks++;if(!value)throw new AssertionError("context sync "+checks);}
 static final class Server implements MaterialApi.Transport {
  int heads,posts;boolean drop;Map<String,Map<String,Object>> rows=new TreeMap<>();
  public MaterialApi.Response exchange(String path,byte[] bytes)throws IOException{
   Map<String,Object> input=WireJson.map(WireJson.read(bytes));if(path.equals("/daily-context/head")){heads++;String id=(String)input.get("id");Map<String,Object> old=rows.get(id);return new MaterialApi.Response(200,WireJson.bytes(WireJson.object("id",id,"revision",old==null?0:old.get("revision"),"hash",old==null?null:old.get("hash"))),0);}
   yes(path.equals("/daily-context/source"));Map<String,Object> source=WireJson.map(input.get("source"));String id=(String)source.get("id");Map<String,Object> old=rows.get(id);yes(MaterialWire.number(input.get("base_revision"))==(old==null?0:MaterialWire.number(old.get("revision"))));
   Map<String,Object> ack=WireJson.object("id",id,"revision",old==null?1:MaterialWire.number(old.get("revision"))+1,"hash",TaskWire.hash(WireJson.bytes(source)),"server_stored",true,"unchanged",false);rows.put(id,ack);posts++;if(drop){drop=false;throw new IOException("lost_ack");}return new MaterialApi.Response(200,WireJson.bytes(ack),0);
  }public void cancel(){}
 }
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);root.mkdirs();android.content.Context app=new android.content.Context(root);String account="a".repeat(64),date="2026-10-30",zone="Asia/Shanghai";
  MaterialConnection connection=MaterialConnection.parse(WireJson.bytes(WireJson.object("format",MaterialConnection.FORMAT,"base_url","https://synthetic.invalid/v1","owner_id","synthetic-owner","producer_id","synthetic-phone","server_id","synthetic-server","token","A".repeat(43),"token_id","00000000-0000-4000-8000-000000000001","expires_at",TaskWire.now(System.currentTimeMillis()+3600000))),System.currentTimeMillis());MaterialConfig config=new MaterialConfig(connection,account,true);
  try(MaterialLocalLibrary library=new MaterialLocalLibrary(root,account)){library.recordRead(date,zone,Collections.emptyList(),1,()->account);}
  Map<String,Object> source=WireJson.object("id","context-"+"c".repeat(64),"date",date,"timezone",zone,"origin","official_lifelog","coordinate_system","source_unspecified","coverage","source_snapshot","events",Arrays.asList(WireJson.object("id","calendar-1","kind","schedule","started_at_ms",1793318400000L,"ended_at_ms",1793318460000L,"title","合成日历")),"trail",Collections.emptyList());OfficialDayContext.retain(root,account,source,()->account);Server server=new Server();
  yes(DayContextSync.run(app,config,null,()->{},server)==0&&server.posts==0);
  DayContextSync.enabled(app,account,"activity",true);yes(DayContextSync.run(app,config,null,()->{},server)==1&&server.posts==1);yes(DayContextSync.run(app,config,null,()->{},server)==0&&server.heads==1);
  DayContextSync.enabled(app,account,"calendar",true);server.drop=true;boolean lost=false;try{DayContextSync.run(app,config,null,()->{},server);}catch(IOException expected){lost=true;}yes(lost&&server.posts==2);yes(DayContextSync.run(app,config,null,()->{},server)==1&&server.posts==2);yes(DayContextSync.run(app,new MaterialConfig(connection,"b".repeat(64),true),null,()->{},server)==0);
  URL.setURLStreamHandlerFactory(protocol->protocol.equals("https")?new URLStreamHandler(){protected URLConnection openConnection(URL url){return new HttpsURLConnection(url){public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}public String getCipherSuite(){return "synthetic";}public java.security.cert.Certificate[] getLocalCertificates(){return null;}public java.security.cert.Certificate[] getServerCertificates(){return null;}public int getResponseCode(){return 200;}public String getContentType(){return "application/json";}public OutputStream getOutputStream(){return new ByteArrayOutputStream();}public InputStream getInputStream(){return new ByteArrayInputStream("{}".getBytes(java.nio.charset.StandardCharsets.UTF_8));}};}}:null);
  MaterialHttp http=new MaterialHttp(connection);yes(http.exchange("/daily-context/head",WireJson.bytes(WireJson.object("id",source.get("id")))).status==200);yes(http.exchange("/daily-context/source",WireJson.bytes(source)).status==200);boolean rejected=false;try{http.exchange("/unknown-product-path",new byte[0]);}catch(IOException expected){rejected=expected.getMessage().equals("MATERIAL_PATH_INVALID");}yes(rejected);
  System.out.println("Official context sync and phone transport: "+checks+" checks passed");
 }
}
