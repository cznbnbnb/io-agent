package com.turboio.addon;

import java.io.*;import java.util.*;

/** Transport-only fragments of the exact durable event. The outbox is marked
 * stored only after finalize returns the original material revision receipt. */
final class MaterialTransfer {
 static final int PART_BYTES=131072;
 private static Map<String,Object> status(MaterialApi.Response response,String hash,int bytes)throws IOException{
  Map<String,Object> value=WireJson.map(WireJson.read(response.body));
  MaterialWire.require(hash.equals(value.get("upload_id"))&&MaterialWire.positive(value.get("bytes"))==bytes&&MaterialWire.positive(value.get("part_bytes"))==PART_BYTES&&MaterialWire.positive(value.get("parts"))==(bytes+PART_BYTES-1)/PART_BYTES,"MATERIAL_TRANSFER_MISMATCH");
  MaterialWire.time(value.get("expires_at"));Set<Long> seen=new HashSet<>();
  for(Object raw:WireJson.list(value.get("received"))){long part=MaterialWire.number(raw);MaterialWire.require(part<(bytes+PART_BYTES-1)/PART_BYTES&&seen.add(part),"MATERIAL_TRANSFER_MISMATCH");}
  return value;
 }
 static MaterialApi.Response send(MaterialApi.Transport transport,byte[] bytes,Map<String,Object> event)throws IOException{
  String hash=TaskWire.hash(bytes),base="/material-uploads/"+hash;
  MaterialApi.Response response=transport.exchange("/material-uploads",WireJson.bytes(WireJson.object("event_id",event.get("event_id"),"bytes",bytes.length,"sha256",hash)));
  if(response.status!=200)return response;
  Map<String,Object> state=status(response,hash,bytes.length);
  if(state.get("receipt")!=null)return new MaterialApi.Response(200,WireJson.bytes(state.get("receipt")),0);
  Set<Long> received=new HashSet<>();for(Object part:WireJson.list(state.get("received")))received.add(MaterialWire.number(part));
  for(int index=0;index<(bytes.length+PART_BYTES-1)/PART_BYTES;index++){
   if(received.contains((long)index))continue;
   byte[] part=Arrays.copyOfRange(bytes,index*PART_BYTES,Math.min(bytes.length,(index+1)*PART_BYTES));
   response=transport.exchange(base+"/parts/"+index,WireJson.bytes(WireJson.object("data",Base64.getEncoder().encodeToString(part),"sha256",TaskWire.hash(part))));
   if(response.status!=200)return response;
   state=status(response,hash,bytes.length);
   if(state.get("receipt")!=null)return new MaterialApi.Response(200,WireJson.bytes(state.get("receipt")),0);
   boolean stored=false;for(Object raw:WireJson.list(state.get("received")))if(MaterialWire.number(raw)==index)stored=true;
   MaterialWire.require(stored,"MATERIAL_TRANSFER_MISMATCH");
  }
  return transport.exchange(base+"/finalize",WireJson.bytes(WireJson.object()));
 }
}
