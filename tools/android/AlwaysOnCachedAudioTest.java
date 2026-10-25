package com.turboio.addon;
import java.io.*;import java.util.*;

/** Known cached dispatch framing, including a short tail and empty control. */
public final class AlwaysOnCachedAudioTest {
 static int checks;static void yes(boolean value){if(!value)throw new AssertionError("cached "+checks);checks++;}
 static byte[] padded(){byte[] packet=new byte[240];packet[0]=(byte)0xfb;packet[1]=0x41;packet[2]=(byte)235;packet[3]=(byte)0xff;packet[4]=(byte)0xfe;return packet;}
 static byte[] wire(String message,byte[] data){return AlwaysOnAudioControlTest.wire(1,0xa4,message,data,true);}
 static AlwaysOnCachedAudio parse(String message,byte[] data){return AlwaysOnCachedAudio.parse(AlwaysOnWire.readKnown(wire(message,data)));}
 interface Work{void run();}static void deny(Work work){try{work.run();throw new AssertionError("cached accepted");}catch(IllegalArgumentException expected){yes(true);}}
 public static void main(String[] args)throws Exception{
  String message="{\"taskId\":\"cached-task\",\"isFinish\":false}";
  for(int size:new int[]{0,1,239,240,241,480,483,7681,65000}){byte[] data=new byte[size];for(int i=0;i<size;i++)data[i]=(byte)(i*17);byte[] original=data.clone(),encoded=wire(message,data),before=encoded.clone();AlwaysOnCachedAudio cached=AlwaysOnCachedAudio.parse(AlwaysOnWire.readKnown(encoded));yes(cached.task.equals("cached-task")&&Boolean.FALSE.equals(cached.finished));yes(cached.frames.size()==(size+239)/240);ByteArrayOutputStream joined=new ByteArrayOutputStream();boolean shape=true;
   for(int i=0;i<cached.frames.size();i++){AlwaysOnAudioBatch.Frame frame=cached.frames.get(i);byte[] packet=frame.bytes();shape&=packet.length==Math.min(240,size-i*240)&&frame.index==i&&frame.count==cached.frames.size()&&!frame.flagsPresent&&!frame.vpu&&!frame.vad;joined.write(packet);if(packet.length>0)packet[0]^=1;shape&=frame.bytes()[0]==original[i*240];}
   yes(shape&&Arrays.equals(joined.toByteArray(),original));yes(Arrays.equals(encoded,before)&&Arrays.equals(data,original));
  }
  AlwaysOnCachedAudio empty=parse("{\"taskId\":\"cached-task\",\"isFinish\":true}",new byte[0]);yes(empty.frames.isEmpty()&&Boolean.TRUE.equals(empty.finished));yes(parse("{\"taskId\":\"cached-task\"}",padded()).finished==null);yes(parse("{\"taskId\":\"cached-task\",\"rc\":-7,\"isFinish\":null}",padded()).frames.size()==1);yes(OpusFile.samples48(padded())==960);
  for(String bad:new String[]{"{}","{\"taskId\":\"../x\"}","{\"taskId\":\"x\",\"text\":\"private\"}","{\"taskId\":\"x\",\"frameCount\":1}","{\"taskId\":\"x\",\"isFinish\":1}","{\"taskId\":\"x\",\"rc\":\"0\"}","{\"taskId\":\"x\",\"taskId\":\"y\"}"})deny(()->parse(bad,padded()));
  deny(()->AlwaysOnCachedAudio.parse(AlwaysOnWire.readKnown(AlwaysOnAudioControlTest.wire(0,0xa4,message,padded(),true))));deny(()->AlwaysOnCachedAudio.parse(AlwaysOnWire.readKnown(AlwaysOnAudioControlTest.wire(1,0xa3,message,padded(),true))));deny(()->parse(message,new byte[65537]));byte[] original=wire(message,padded()),unknown=Arrays.copyOf(original,original.length+2);unknown[original.length]=40;unknown[original.length+1]=1;deny(()->AlwaysOnCachedAudio.parse(AlwaysOnWire.readKnown(unknown)));
  System.out.println("Always-on cached: "+checks+" checks passed");
 }
}
