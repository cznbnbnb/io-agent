package com.turboio.addon;

import java.io.*;import java.nio.file.*;import java.util.*;

/** Synthetic codec double checks stream identity/coverage/archive, not real Opus or mic. */
final class RecordingVoiceSourceTest {
 static void yes(boolean v){VoiceAnswerTest.yes(v);}
 static byte[] raw(int seed){byte[] b=new byte[240];for(int i=0;i<b.length;i++)b[i]=(byte)(seed+i);return b;}
 static byte[] packet(String token,long offset,byte[] bytes){return OtaFrame.encode(3,WireJson.object("uuid",token,"offset",offset),bytes);}
 static byte[] end(String token){return OtaFrame.encode(6,WireJson.object("uuid",token,"completed",true),null);}
 static final class Codec implements RecordingVoiceSource.Decoder {
  List<byte[]> received=new ArrayList<>();int output=640;
  public byte[] decode(byte[] frame){received.add(frame.clone());byte[] pcm=new byte[output];Arrays.fill(pcm,(byte)7);return pcm;}
 }
 static VoiceAnswerSession draft()throws Exception{VoiceAnswerSession s=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),VoiceAnswerTest.connection("recording-source"));VoiceAnswerTest.arm(s);return s;}
 static Object seal(VoiceAudioArchive a,VoiceAnswerSession s)throws Exception{
  yes(s.officialResult(s.token(),VoiceAnswerTest.PEER,1,"只做预览，保留所有资料。",true,1100));VoiceAnswerTest.stopped(s,1);return a.seal(s);
 }
 static void run(File root)throws Exception{
 // Wearer channel: interleaved s16le L,R pairs keep exactly the left samples.
  byte[] stereo={1,2,9,9,3,4,8,8,5,6,7,7};yes(Arrays.equals(RecordingVoiceSource.wearerChannel(stereo),new byte[]{1,2,3,4,5,6}));
  for(byte[] bad:new byte[][]{null,new byte[0],new byte[2],new byte[6]})VoiceAnswerTest.rejects(()->RecordingVoiceSource.wearerChannel(bad));
  byte[] decoded=new byte[1280];for(int i=0;i<decoded.length;i+=4){decoded[i]=1;decoded[i+2]=(byte)0x7f;}byte[] left=RecordingVoiceSource.wearerChannel(decoded);yes(left.length==RecordingVoiceSource.PCM_BYTES);for(int i=0;i<left.length;i+=2)yes(left[i]==1&&left[i+1]==0);
  for(String mode:new String[]{"split","reordered","duplicate"}){
   VoiceAnswerSession s=draft();Codec codec=new Codec();byte[] first=raw(11),second=raw(71);
   try(VoiceAudioArchive archive=new VoiceAudioArchive(new File(root,mode),s.token(),14)){
    RecordingVoiceSource stream=new RecordingVoiceSource(s.token(),VoiceAnswerTest.PEER,1,archive,codec);
    yes(stream.audio(VoiceAnswerTest.OTHER,1,packet(s.token(),0,first))==null);
    yes(stream.audio(VoiceAnswerTest.PEER,2,packet(s.token(),0,first))==null);
    yes(stream.audio(VoiceAnswerTest.PEER,1,packet("ffffffffffffffffffffffffffffffff",0,first))==null);
    if(mode.equals("split")){
     yes(stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),0,Arrays.copyOfRange(first,0,101))).length==0);
     yes(stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),101,Arrays.copyOfRange(first,101,240))).length==640);
     yes(stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),240,second)).length==640);
    }else if(mode.equals("reordered")){
     yes(stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),240,second)).length==0);
     yes(stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),0,first)).length==1280);
    }else{
     byte[] both=new byte[480];System.arraycopy(first,0,both,0,240);System.arraycopy(second,0,both,240,240);
     yes(stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),0,both)).length==1280);
     yes(stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),120,Arrays.copyOfRange(both,120,360))).length==0);
    }
    yes(codec.received.size()==2&&Arrays.equals(codec.received.get(0),first)&&Arrays.equals(codec.received.get(1),second));
    yes(!stream.ended(VoiceAnswerTest.OTHER,1,end(s.token())));
    yes(!stream.ended(VoiceAnswerTest.PEER,1,end("ffffffffffffffffffffffffffffffff")));
    yes(!stream.ended(VoiceAnswerTest.PEER,1,OtaFrame.encode(5,WireJson.object("uuid","","state",3,"action",2),null)));
    yes(stream.ended(VoiceAnswerTest.PEER,1,end(s.token()))&&stream.complete());yes(stream.ended(VoiceAnswerTest.PEER,1,end(s.token())));
    yes(s.needsStop()&&!s.finish()); // A recording completion cannot certify the physical microphone.
    Map<String,Object> report=WireJson.map(seal(archive,s));yes(Boolean.TRUE.equals(report.get("complete"))&&TaskWire.nonnegative(report.get("pcm_bytes"))==1280);
   }
  }
  // The buffer covers the whole capture limit plus 4 s: a packet 50 s in is accepted (a 32 s buffer failed at 35 s).
  yes(RecordingVoiceSource.MAX_PACKETS==(VoiceAnswerSession.CAPTURE_SECONDS+4)*50&&RecordingVoiceSource.MAX_BYTES>=VoiceAnswerSession.CAPTURE_SECONDS*12000);
  {VoiceAnswerSession s=draft();try(VoiceAudioArchive archive=new VoiceAudioArchive(new File(root,"long-capture"),s.token(),14)){RecordingVoiceSource stream=new RecordingVoiceSource(s.token(),VoiceAnswerTest.PEER,1,archive,new Codec());stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),50*12000,raw(17)));}}
  for(String fault:new String[]{"gap","tail","conflict","budget","format","late"}){
   VoiceAnswerSession s=draft();Codec codec=new Codec();byte[] first=raw(17);
   try(VoiceAudioArchive archive=new VoiceAudioArchive(new File(root,"bad-"+fault),s.token(),14)){
    RecordingVoiceSource stream=new RecordingVoiceSource(s.token(),VoiceAnswerTest.PEER,1,archive,codec);
    if(fault.equals("gap")){stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),240,first));VoiceAnswerTest.rejects(()->stream.ended(VoiceAnswerTest.PEER,1,end(s.token())));}
    if(fault.equals("tail")){stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),0,Arrays.copyOf(first,100)));VoiceAnswerTest.rejects(()->stream.ended(VoiceAnswerTest.PEER,1,end(s.token())));}
    if(fault.equals("conflict")){stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),0,first));VoiceAnswerTest.rejects(()->stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),100,new byte[40])));}
    if(fault.equals("budget"))VoiceAnswerTest.rejects(()->stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),RecordingVoiceSource.MAX_BYTES-100,first)));
    if(fault.equals("format")){codec.output=1280;VoiceAnswerTest.rejects(()->stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),0,first)));}
    if(fault.equals("late")){stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),0,first));yes(stream.ended(VoiceAnswerTest.PEER,1,end(s.token())));VoiceAnswerTest.rejects(()->stream.audio(VoiceAnswerTest.PEER,1,packet(s.token(),240,first)));}
    yes(!stream.complete());Map<String,Object> retained=WireJson.map(seal(archive,s));yes(Boolean.FALSE.equals(retained.get("complete"))&&TaskWire.nonnegative(retained.get("wire_bytes"))>0);
    yes(Files.size(new File(new File(new File(root,"bad-"+fault),"voice-audio"),s.token()+"/original.frames").toPath())>0);
   }
  }
  VoiceAnswerSession s=draft();try(VoiceAudioArchive other=new VoiceAudioArchive(new File(root,"wrong-business"),s.token(),13)){
   VoiceAnswerTest.rejects(()->new RecordingVoiceSource(s.token(),VoiceAnswerTest.PEER,1,other,new Codec()));
   VoiceAnswerTest.rejects(()->other.decodedRecording(new byte[0]));
  }
 }
}
