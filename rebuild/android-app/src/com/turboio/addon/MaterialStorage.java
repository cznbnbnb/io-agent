package com.turboio.addon;

import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;

/** Copy-once material upgrade. Legacy files remain readable by dev72; new
 * envelopes and compacted history never overwrite them. No network or deletes. */
final class MaterialStorage {
 static File current(File files,MaterialConfig config){return new File(files,"material-accounts-v2/"+config.account);}
 static File legacy(File files,MaterialConfig config){return new File(files,"material-accounts/"+config.account);}
 private static String[] names(MaterialConfig config){String b=config.connection.binding(),a=config.account;return new String[]{"material-outbox/"+b+"/state.json","lifelog-import/"+b+"/"+a+"/state.json","lifelog-revisions/"+b+"/"+a+"/state.json"};}
 private static File safe(File root,String relative)throws IOException{
  File target=root.getCanonicalFile();for(String part:relative.split("/")){if(part.isEmpty()||part.equals(".")||part.equals(".."))throw new IOException("MATERIAL_MIGRATION_PATH");target=new File(target,part);if(Files.isSymbolicLink(target.toPath()))throw new IOException("MATERIAL_MIGRATION_PATH");}return target;
 }
 private static File state(File files,String relative)throws IOException{File target=safe(files,relative);safe(files,relative+".lock");safe(files,relative+".partial");return target;}
 private static String sha(Object value){return TaskWire.hash(WireJson.bytes(value));}
 /** State-only normalization by an older reader is harmless. New envelopes,
  * repair payloads or source intents created on rollback require reconciliation. */
 private static String semantic(Object raw,int kind,MaterialConfig config){
  if(raw==null)return sha(kind==0?new ArrayList<>():kind==1?WireJson.object():new ArrayList<>());
  Map<String,Object> v=WireJson.map(raw);long schema=MaterialWire.positive(v.get("schema"));
  if(kind==0){
   BoundedJson.keys(v,"schema","binding","rows");MaterialWire.require(schema<=3&&config.connection.binding().equals(v.get("binding")),"MATERIAL_LEGACY_FORMAT");
   List<Object> normalized=new ArrayList<>();for(Object item:WireJson.list(v.get("rows"))){Map<String,Object> row=WireJson.map(item);String payload=MaterialWire.text(row.get("payload"),262144,false);MaterialWire.require(TaskWire.hash(payload.getBytes(StandardCharsets.UTF_8)).equals(row.get("payload_sha256")),"MATERIAL_PAYLOAD_CORRUPT");Map<String,Object> event=MaterialWire.event(payload.getBytes(StandardCharsets.UTF_8),config.connection.producer),body=WireJson.map(event.get("body"));MaterialWire.require(event.get("event_id").equals(row.get("event_id"))&&body.get("material_id").equals(row.get("material_id"))&&MaterialWire.positive(body.get("revision"))==MaterialWire.positive(row.get("revision")),"MATERIAL_LEGACY_FORMAT");
    List<Object> aliases=new ArrayList<>();if(row.get("history")!=null)for(Object old:WireJson.list(row.get("history"))){Map<String,Object> h=WireJson.map(old);aliases.add(WireJson.object("event_id",h.get("event_id"),"payload_sha256",h.get("payload_sha256")));}
    Object repair=null;if(row.get("text_revision_repair")!=null){Map<String,Object> h=WireJson.map(row.get("text_revision_repair"));String repaired=MaterialWire.text(h.get("payload"),262144,false);MaterialWire.require(TaskWire.hash(repaired.getBytes(StandardCharsets.UTF_8)).equals(h.get("payload_sha256")),"MATERIAL_PAYLOAD_CORRUPT");MaterialWire.event(repaired.getBytes(StandardCharsets.UTF_8),config.connection.producer);repair=WireJson.object("event_id",h.get("event_id"),"payload_sha256",h.get("payload_sha256"),"base_payload_sha256",h.get("base_payload_sha256"));}
    normalized.add(WireJson.object("payload",row.get("payload_sha256"),"aliases",aliases,"repair",repair));
   }normalized.sort(Comparator.comparing(MaterialStorage::sha));return sha(normalized);
  }
  BoundedJson.keys(v,"schema","account","connection",kind==1?"rows":"records");MaterialWire.require(schema==1&&config.account.equals(v.get("account"))&&config.connection.binding().equals(v.get("connection")),"MATERIAL_LEGACY_FORMAT");return sha(v.get(kind==1?"rows":"records"));
 }
 static File prepare(File files,MaterialConfig config)throws IOException{
  String prefix="material-accounts-v2/"+config.account+"/",old="material-accounts/"+config.account+"/";String[] names=names(config);
  File manifest=state(files,prefix+"migration/"+config.connection.binding()+"/state.json");
  try(AtomicDocument owner=new AtomicDocument(manifest)){
   List<AtomicDocument> locks=new ArrayList<>();try{
    List<Object> values=new ArrayList<>();Map<String,Object> observed=new TreeMap<>();
    for(int i=0;i<names.length;i++){
     File file=state(files,old+names[i]);if(new File(file.getPath()+".partial").exists())throw new IOException("MATERIAL_LEGACY_UNCERTAIN");
     AtomicDocument lock=new AtomicDocument(file);locks.add(lock);Object value=lock.read();values.add(value);observed.put(names[i],WireJson.object("copy_sha256",value==null?null:sha(value),"semantic_sha256",semantic(value,i,config)));
    }
    Object raw=owner.read();Map<String,Object> plan;
    if(raw==null){
     for(String name:names){File destination=state(files,prefix+name);if(destination.exists()||new File(destination.getPath()+".partial").exists())throw new IOException("MATERIAL_MIGRATION_UNOWNED");}
     plan=WireJson.object("schema",1,"account",config.account,"connection",config.connection.binding(),"phase","copying","legacy",observed);owner.save(plan);
    }else{
     plan=WireJson.map(raw);BoundedJson.keys(plan,"schema","account","connection","phase","legacy");MaterialWire.require(MaterialWire.positive(plan.get("schema"))==1&&config.account.equals(plan.get("account"))&&config.connection.binding().equals(plan.get("connection"))&&MaterialWire.choice(plan.get("phase"),"copying","ready"),"MATERIAL_MIGRATION_INVALID");
     Map<String,Object> prior=WireJson.map(plan.get("legacy"));BoundedJson.keys(prior,names);
     for(String name:names){Map<String,Object> expected=WireJson.map(prior.get(name)),now=WireJson.map(observed.get(name));BoundedJson.keys(expected,"copy_sha256","semantic_sha256");MaterialWire.require(expected.get("semantic_sha256").equals(now.get("semantic_sha256")),"MATERIAL_LEGACY_CHANGED");if("copying".equals(plan.get("phase")))MaterialWire.require(Objects.equals(expected.get("copy_sha256"),now.get("copy_sha256")),"MATERIAL_LEGACY_CHANGED");}
     if("ready".equals(plan.get("phase"))){for(String name:names){File destination=state(files,prefix+name);if(WireJson.map(prior.get(name)).get("copy_sha256")!=null&&!destination.isFile())throw new IOException("MATERIAL_MIGRATION_MISSING");}return current(files,config);}
    }
    for(int i=0;i<names.length;i++){
     File target=state(files,prefix+names[i]);Object source=values.get(i);
     try(AtomicDocument destination=new AtomicDocument(target)){
      Object existing=destination.read();if(existing!=null)MaterialWire.require(source!=null&&sha(existing).equals(sha(source)),"MATERIAL_MIGRATION_CONFLICT");
      if(source!=null)destination.save(source);else if(existing!=null||new File(target.getPath()+".partial").exists())throw new IOException("MATERIAL_MIGRATION_CONFLICT");
     }
    }
    plan.put("phase","ready");owner.save(plan);return current(files,config);
   }finally{for(int i=locks.size()-1;i>=0;i--)locks.get(i).close();}
  }
 }
}
