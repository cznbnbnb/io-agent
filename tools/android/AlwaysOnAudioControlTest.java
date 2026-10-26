package com.turboio.addon;
import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;

/** Actual pinned wire/JSON parser: exits cannot smuggle audio or extra fields. */
public final class AlwaysOnAudioControlTest {
 static int checks;static void yes(boolean v){if(!v)throw new AssertionError("control "+checks);checks++;}
 static void var(ByteArrayOutputStream b,int n){while(n>127){b.write((n&127)|128);n>>>=7;}b.write(n);}
 static byte[] wire(int version,int type,String message,byte[] data,boolean includeData){ByteArrayOutputStream b=new ByteArrayOutputStream();b.write(8);var(b,version);b.write(16);var(b,type);b.write(26);byte[] json=message.getBytes(StandardCharsets.UTF_8);var(b,json.length);b.write(json,0,json.length);if(includeData){b.write(34);var(b,data.length);b.write(data,0,data.length);}return b.toByteArray();}
 static AlwaysOnAudioControl parse(String m){return AlwaysOnAudioControl.exit(AlwaysOnWire.readKnown(wire(1,0xa5,m,new byte[0],true)));}
 interface Work {void run();}static void deny(Work w){try{w.run();throw new AssertionError("control accepted");}catch(IllegalArgumentException expected){yes(true);}}
 public static void main(String[] args){
  AlwaysOnAudioControl e=parse("{\"taskId\":\"task-current\",\"rc\":0,\"isFinish\":true}");yes(e.task.equals("task-current")&&e.rc==0&&Boolean.TRUE.equals(e.finished));
  e=parse("{\"taskId\":\"task-current\",\"rc\":-7,\"isFinish\":false}");yes(e.rc==-7&&Boolean.FALSE.equals(e.finished));e=parse("{\"taskId\":\"task-current\"}");yes(e.rc==null&&e.finished==null);e=parse("{\"taskId\":\"task-current\",\"rc\":null,\"isFinish\":null}");yes(e.rc==null&&e.finished==null);
  for(String m:Arrays.asList("{}","{\"taskId\":null}","{\"taskId\":\"\"}","{\"taskId\":\"../task\"}","{\"taskId\":3}","{\"taskId\":\"x\",\"text\":\"private\"}","{\"taskId\":\"x\",\"errorMsg\":\"private\"}","{\"taskId\":\"x\",\"rc\":\"0\"}","{\"taskId\":\"x\",\"rc\":false}","{\"taskId\":\"x\",\"rc\":1.5}","{\"taskId\":\"x\",\"rc\":2147483648}","{\"taskId\":\"x\",\"rc\":-2147483649}","{\"taskId\":\"x\",\"isFinish\":1}","{\"taskId\":\"x\",\"isFinish\":\"true\"}","{\"taskId\":\"x\",\"taskId\":\"y\"}"))deny(()->parse(m));
  String message="{\"taskId\":\"task-current\",\"isFinish\":true}";byte[] raw=wire(1,0xa5,message,new byte[0],false),before=raw.clone();yes(AlwaysOnAudioControl.exit(AlwaysOnWire.readKnown(raw)).task.equals("task-current"));yes(Arrays.equals(raw,before));
  deny(()->AlwaysOnAudioControl.exit(AlwaysOnWire.readKnown(wire(1,0xa5,message,new byte[]{1},true))));deny(()->AlwaysOnAudioControl.exit(AlwaysOnWire.readKnown(wire(0,0xa5,message,new byte[0],true))));deny(()->AlwaysOnAudioControl.exit(AlwaysOnWire.readKnown(wire(1,0xa4,message,new byte[0],true))));deny(()->AlwaysOnAudioControl.exit(AlwaysOnWire.readKnown(wire(1,0xa3,message,new byte[0],true))));byte[] extension=Arrays.copyOf(raw,raw.length+2);extension[raw.length]=40;extension[raw.length+1]=1;deny(()->AlwaysOnAudioControl.exit(AlwaysOnWire.readKnown(extension)));
  yes(parse("{\"taskId\":\"x\",\"rc\":2147483647}").rc==Integer.MAX_VALUE);yes(parse("{\"taskId\":\"x\",\"rc\":-2147483648}").rc==Integer.MIN_VALUE);System.out.println("Always-on control: "+checks+" checks passed");
 }
}
