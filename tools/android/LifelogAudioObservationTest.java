package com.turboio.addon;
import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;

public final class LifelogAudioObservationTest {
 public static int checks;
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("AUDIO_OBSERVATION_TEST_"+checks);}
 private static void number(ByteArrayOutputStream out,long n){do{int b=(int)(n&127);n>>>=7;out.write(b|(n==0?0:128));}while(n!=0);}
 public static byte[] packet(int type,String message,byte[] raw){ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(8);number(out,1);out.write(16);number(out,type);out.write(26);byte[] text=message.getBytes(StandardCharsets.UTF_8);number(out,text.length);out.write(text,0,text.length);out.write(34);number(out,raw.length);out.write(raw,0,raw.length);return out.toByteArray();}
 private static void invalid(byte[] bytes){try{AlwaysOnWire.read(bytes);throw new AssertionError("ACCEPTED_INVALID_WIRE");}catch(IllegalArgumentException expected){yes(expected.getMessage().equals("AUDIO_WIRE_INVALID"));}}
 public static void main(String[] args){
  checks=0;String account=String.join("",Collections.nCopies(64,"a")),peer="private-peer-never-export",task="private-task-never-export";String json="{\"taskId\":\""+task+"\",\"mode\":1,\"frameCount\":2,\"vpuMask\":1,\"vadMask\":2}";
  byte[] raw=new byte[480];Arrays.fill(raw,(byte)0x78);byte[] packet=packet(0xa3,json,raw),original=packet.clone();AlwaysOnWire wire=AlwaysOnWire.read(packet);yes(wire.type==0xa3&&wire.version==1&&wire.message.equals(json)&&Arrays.equals(wire.data(),raw));byte[] copy=wire.data();copy[0]=0;yes(wire.data()[0]==0x78);yes(Arrays.equals(packet,original));
  AlwaysOnWire empty=AlwaysOnWire.read(new byte[0]);yes(empty.type==0&&empty.version==0&&empty.message.isEmpty()&&empty.data().length==0);
  Random random=new Random(304);for(int i=0;i<100;i++){byte[] data=new byte[random.nextInt(1000)];random.nextBytes(data);String text="合成🙂"+i;byte[] encoded=packet(163+i,text,data);AlwaysOnWire parsed=AlwaysOnWire.read(encoded);yes(parsed.type==163+i&&parsed.message.equals(text)&&Arrays.equals(parsed.data(),data));}
  byte[] unknown=Arrays.copyOf(packet,packet.length+7);System.arraycopy(new byte[]{0x48,(byte)0xff,(byte)0xff,(byte)0xff,(byte)0xff,0x0f,0x50},0,unknown,packet.length,7);invalid(unknown);byte[] unknownValid=Arrays.copyOf(unknown,unknown.length-1);yes(AlwaysOnWire.read(unknownValid).type==163);
  for(byte[] bad:new byte[][]{{0},{(byte)0x80},{8,(byte)0x80},{26,2,65},{26,2,(byte)0xc0,(byte)0x80},{16,1,16,2},{17,0},{26,(byte)0xff,(byte)0xff,(byte)0xff,(byte)0xff,0x7f},{75},{8,(byte)0xff,(byte)0xff,(byte)0xff,(byte)0xff,(byte)0xff,(byte)0xff,(byte)0xff,(byte)0xff,(byte)0xff,2},new byte[65537]})invalid(bad);
  LifelogAudioObservation model=new LifelogAudioObservation("01234567890123456789012345678901");model.accept(peer,packet,1000,account,1100,Collections.singleton(LifelogAudioObservation.hash(task)));Map<String,Object> state=model.snapshot();List<?> rows=(List<?>)state.get("samples");Map<?,?> row=(Map<?,?>)rows.get(0);yes(rows.size()==1&&row.get("kind").equals("A3")&&((Number)row.get("frame_count")).intValue()==2);yes(Boolean.TRUE.equals(row.get("exact_conversation_cache_match"))&&Boolean.TRUE.equals(row.get("context_observed_after_receive")));yes(Boolean.FALSE.equals(row.get("source_link_verified"))&&Boolean.FALSE.equals(row.get("account_origin_verified"))&&Boolean.FALSE.equals(row.get("codec_verified")));
  String output=new String(WireJson.bytes(state),StandardCharsets.UTF_8);yes(!output.contains(peer)&&!output.contains(task)&&!output.contains(json));yes(!output.contains("vpuMask")&&!output.contains("vadMask"));
  ((Map<String,Object>)row).put("kind","tampered");yes(!new String(WireJson.bytes(model.snapshot()),StandardCharsets.UTF_8).contains("tampered"));
  model.accept(peer,packet,1200,"",0,null);rows=(List<?>)model.snapshot().get("samples");yes(rows.size()==2&&((Map<?,?>)rows.get(1)).get("exact_conversation_cache_match")==null);
  model.accept(peer,packet(0xa4,"{\"taskId\":\"cached\",\"isFinish\":true}",new byte[7]),1201,account,1100,Collections.emptySet());rows=(List<?>)model.snapshot().get("samples");yes(Boolean.TRUE.equals(((Map<?,?>)rows.get(2)).get("is_finish")));
  model.accept(peer,packet(0xa3,"{\"new_field\":1}",raw),1202,account,1100,Collections.emptySet());rows=(List<?>)model.snapshot().get("samples");yes(Boolean.TRUE.equals(((Map<?,?>)rows.get(3)).get("batch_parse_error")));
  model.accept(peer,new byte[]{0},1203,account,1100,Collections.emptySet());model.accept(peer,packet(2,"",new byte[0]),1204,account,1100,Collections.emptySet());model.dropped(4);state=model.snapshot();yes(((Number)state.get("invalid_wire")).longValue()==1&&((Number)state.get("ignored_types")).longValue()==1&&((Number)state.get("dropped_packets")).longValue()==4);
  for(int i=0;i<100;i++)model.accept(peer,packet(0xa4,"{\"taskId\":\"task"+i+"\"}",raw),2000+i,account,1100,Collections.emptySet());state=model.snapshot();yes(((List<?>)state.get("samples")).size()==24&&WireJson.bytes(state).length<65536);yes(Boolean.FALSE.equals(state.get("audio_persisted"))&&Boolean.FALSE.equals(state.get("source_link_verified")));yes(Arrays.equals(packet,original));
  System.out.println("Lifelog audio observation: "+checks+" checks passed");
 }
}
