package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.util.*;
/** New summary queue against the existing HTTP contract, including uncertain cancellation. */
public final class DailySummaryHttpTest {
 static void yes(boolean ok){if(!ok)throw new AssertionError("Daily summary HTTP");}
 static List<DailySummary> source(String text){return DailySummary.latest(WireJson.bytes(WireJson.object("code",0,"data",Arrays.asList(WireJson.object("periodType","daily","periodStart","2026-10-26","periodEnd","2026-10-26","timezone","Asia/Shanghai","title","合成日报","context",text,"generatedAt","2026-10-26T12:00:00+08:00")))));}
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get(args[1]))));MaterialConnection c=MaterialConnection.parse(WireJson.bytes(fixture.get("connection")),System.currentTimeMillis());MaterialConfig config=new MaterialConfig(c,"a".repeat(64),true);MaterialTest.connection=c;MaterialTest.Loopback http=new MaterialTest.Loopback((String)fixture.get("endpoint"),false);boolean[] failed={false};MaterialApi.Transport uncertain=new MaterialApi.Transport(){public MaterialApi.Response exchange(String path,byte[] body)throws IOException{if(!failed[0]&&path.equals("/material-events")){failed[0]=true;throw new IOException("SYNTHETIC_UNCERTAIN_SEND");}return http.exchange(path,body);}public void cancel(){http.cancel();}};
  try{DailySummarySync.run(root,config,source("首次合成日报"),null,()->{},uncertain);throw new AssertionError("Expected uncertainty");}catch(IOException expected){yes("SYNTHETIC_UNCERTAIN_SEND".equals(expected.getMessage()));}yes(failed[0]);byte[] old;
  try(MaterialOutbox queue=new MaterialOutbox(DailySummarySync.directory(root,config),c)){old=((String)WireJson.map(queue.all().get(0)).get("payload")).getBytes(StandardCharsets.UTF_8);}
  MaterialSyncSession.Status recovered=DailySummarySync.run(root,config,source("修订后的合成日报"),null,()->{},http);yes(recovered.selectedComplete&&recovered.stored==1);MaterialApi.Response late=MaterialTransfer.send(http,old,MaterialWire.event(old,c.producer));yes(late.status==409);
  yes(DailySummarySync.run(root,config,source("修订后的合成日报"),null,()->{},http).added==0);yes(DailySummarySync.run(root,config,source("最后合成日报"),null,()->{},http).stored==1);
  try(MaterialOutbox queue=new MaterialOutbox(DailySummarySync.directory(root,config),c)){Map<String,Object> row=WireJson.map(queue.all().get(0));yes(MaterialWire.positive(row.get("revision"))==2);Files.write(new File(root,"result.json").toPath(),WireJson.bytes(WireJson.object("material_id",row.get("material_id"))));}
  System.out.println("Daily summary HTTP: cancelled unknown send, late original rejected, summary-only readback and revision update passed");
 }
}
