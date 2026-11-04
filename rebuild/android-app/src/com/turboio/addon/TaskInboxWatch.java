package com.turboio.addon;

import java.io.IOException;
import java.util.Map;

/** One waiting HTTPS request for all routes on this phone. No task bodies or
 * execution state live here; the existing mailboxes keep their own cursors. */
final class TaskInboxWatch implements AutoCloseable {
 final TaskDevice device;private final TaskApi.Transport transport;private final Runnable changed;
 private final Thread worker;private volatile boolean closed;private volatile String version="";private volatile long checkedAt;
 TaskInboxWatch(TaskDevice device,TaskApi.Transport transport,Runnable changed){this.device=device;this.transport=transport;this.changed=changed;worker=new Thread(this::run,"io-inbox-watch");worker.setDaemon(true);worker.start();}
 String version(){return version;}
 boolean healthy(){return !closed&&checkedAt>0&&TaskSessionDirectory.elapsed()-checkedAt<35000;}
 boolean closed(){return closed;}
 private void run(){int failures=0;while(!closed){
  try{
   TaskApi.Response response=transport.exchange("/inbox/watch?wait_seconds=25"+(version.isEmpty()?"":"&version="+version),null);
   if(response.status!=200)throw new IOException(TaskApi.error(response));
   Map<String,Object> value=WireJson.map(WireJson.read(response.body));String next=TaskWire.text(value.get("version"),64,false);
   TaskWire.require("1.0".equals(value.get("schema_version"))&&device.owner.equals(value.get("owner_id"))&&device.server.equals(value.get("server_id"))&&device.producer.equals(value.get("producer_id"))&&next.matches("[a-f0-9]{64}"),"TASK_WATCH_IDENTITY_MISMATCH");
   if(closed)return;boolean different=!version.equals(next);version=next;checkedAt=TaskSessionDirectory.elapsed();failures=0;if(different)changed.run();
  }catch(IOException|RuntimeException failure){
   checkedAt=0;if(closed)return;changed.run();
   try{Thread.sleep(Math.min(15000,1000L<<Math.min(failures++,4)));}catch(InterruptedException stopped){if(closed)return;}
  }
 }}
 public void close(){closed=true;transport.cancel();worker.interrupt();}
}
