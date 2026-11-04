package com.turboio.addon;
import android.content.Context;
import java.io.*;import java.util.*;

/** Upload saved official records through the existing sync transport. Never starts data collection. */
final class DayContextSync {
 static boolean enabled(Context app,String account,String category){return app.getSharedPreferences("io_day_context_"+account,0).getBoolean(category,false);}
 static boolean enabled(Context app,String account,String category,boolean value){return app.getSharedPreferences("io_day_context_"+account,0).edit().putBoolean(category,value).commit();}
 static int run(Context app,MaterialConfig config,Set<String> selected,MaterialSyncSession.Guard guard,MaterialApi.Transport transport)throws Exception{
  boolean activity=enabled(app,config.account,"activity"),calendar=enabled(app,config.account,"calendar");if(!activity&&!calendar)return 0;
  int sent=0;File root=app.getFilesDir();
  try(MaterialLocalLibrary library=new MaterialLocalLibrary(root,config.account);AtomicDocument ledger=new AtomicDocument(new File(MaterialStorage.prepare(root,config),"day-context/state.json"),1048576)){
   Object raw=ledger.read();Map<String,Object> state=raw==null?WireJson.object("schema",1L,"account",config.account,"sources",new TreeMap<>()):WireJson.map(raw);
   BoundedJson.keys(state,"schema","account","sources");MaterialWire.require(Long.valueOf(1).equals(state.get("schema"))&&config.account.equals(state.get("account")),"DAY_CONTEXT_LOCAL_INVALID");Map<String,Object> saved=WireJson.map(state.get("sources"));
   List<MaterialLocalLibrary.DayRead> days=new ArrayList<>(library.days());days.sort((a,b)->Long.compare(b.readAt,a.readAt));
   for(MaterialLocalLibrary.DayRead day:days){if(selected!=null&&!selected.contains(day.date))continue;Map<String,Object> source=OfficialDayContext.saved(root,config.account,day.date,day.timezone);if(source==null)continue;
    for(String category:new String[]{"activity","calendar"}){
     if(!enabled(app,config.account,category))continue;guard.check();List<Object> events=new ArrayList<>();for(Object item:WireJson.list(source.get("events"))){Map<String,Object> event=WireJson.map(item);if("calendar".equals(category)=="schedule".equals(event.get("kind")))events.add(item);}
     Map<String,Object> projection=new LinkedHashMap<>(source);String id="context-"+TaskWire.hash(WireJson.bytes(Arrays.asList(source.get("id"),category)));projection.put("id",id);projection.put("category",category);projection.put("events",events);if(category.equals("calendar"))projection.put("trail",Collections.emptyList());
     String hash=TaskWire.hash(WireJson.bytes(projection));if(hash.equals(saved.get(id)))continue;if(sent>=4)return sent;
     MaterialApi.Response head=transport.exchange("/daily-context/head",WireJson.bytes(WireJson.object("id",id)));MaterialWire.require(head.status==200,"DAY_CONTEXT_UNAVAILABLE");Map<String,Object> current=WireJson.map(WireJson.read(head.body));BoundedJson.keys(current,"id","revision","hash");MaterialWire.require(id.equals(current.get("id")),"MATERIAL_IDENTITY_MISMATCH");
     if(!hash.equals(current.get("hash"))){guard.check();MaterialWire.require(enabled(app,config.account,category),"MATERIAL_PAUSED");MaterialApi.Response response=transport.exchange("/daily-context/source",WireJson.bytes(WireJson.object("base_revision",MaterialWire.number(current.get("revision")),"source",projection)));MaterialWire.require(response.status==200,"DAY_CONTEXT_UPLOAD_FAILED");Map<String,Object> ack=WireJson.map(WireJson.read(response.body));BoundedJson.keys(ack,"id","revision","hash","server_stored","unchanged");MaterialWire.require(id.equals(ack.get("id"))&&hash.equals(ack.get("hash"))&&Boolean.TRUE.equals(ack.get("server_stored")),"MATERIAL_ACK_MISMATCH");}
     guard.check();saved.put(id,hash);ledger.save(state);sent++;
    }
   }
  }return sent;
 }
}
