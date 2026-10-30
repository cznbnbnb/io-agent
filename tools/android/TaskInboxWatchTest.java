package com.turboio.addon;

import java.io.IOException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Real background waiter: no callback storm, wrong identity rejected, reconnect and cancellation. */
public final class TaskInboxWatchTest {
 static void yes(boolean value){if(!value)throw new AssertionError("phone watch");}
 static final class Peer implements TaskApi.Transport {
  final BlockingQueue<TaskApi.Response> replies=new LinkedBlockingQueue<>();final AtomicInteger calls=new AtomicInteger();volatile boolean cancelled;
  public TaskApi.Response exchange(String path,byte[] body)throws IOException{yes(path.startsWith("/inbox/watch?")&&body==null);calls.incrementAndGet();try{return replies.take();}catch(InterruptedException e){throw new IOException("cancelled",e);}}
  public void cancel(){cancelled=true;}
 }
 static TaskApi.Response reply(TaskDevice d,String owner,char version){return new TaskApi.Response(200,WireJson.bytes(WireJson.object("schema_version","1.0","owner_id",owner,"server_id",d.server,"producer_id",d.producer,"version",String.valueOf(version).repeat(64))),0);}
 public static void main(String[] args)throws Exception{
  TaskDevice d=TaskDevice.issued(TaskDeviceTest.reply(TaskDeviceTest.TOKEN,"phone-11111111",TaskDeviceTest.DEVICE,"phone","2026-10-25T06:00:00.000Z","2026-10-24T18:00:00.000Z"),TaskDevice.BASE,null,TaskDeviceTest.NOW);
  Peer peer=new Peer();BlockingQueue<String> wake=new LinkedBlockingQueue<>();TaskInboxWatch watch=new TaskInboxWatch(d,peer,()->wake.add("changed"));
  try{
   peer.replies.add(reply(d,d.owner,'a'));yes(wake.poll(2,TimeUnit.SECONDS)!=null);yes(watch.healthy());
   peer.replies.add(reply(d,d.owner,'a'));yes(wake.poll(150,TimeUnit.MILLISECONDS)==null);yes(peer.calls.get()==3);
   peer.replies.add(reply(d,"foreign-owner",'b'));yes(wake.poll(2,TimeUnit.SECONDS)!=null);yes(!watch.healthy());yes(watch.version().equals("a".repeat(64)));
   peer.replies.add(reply(d,d.owner,'b'));yes(wake.poll(3,TimeUnit.SECONDS)!=null);yes(watch.healthy());yes(watch.version().equals("b".repeat(64)));
  }finally{watch.close();}
  yes(peer.cancelled&&watch.closed()&&!watch.healthy());yes(wake.poll(150,TimeUnit.MILLISECONDS)==null);
  System.out.println("Phone watch: idle, identity isolation, reconnect, cancellation passed");
 }
}
