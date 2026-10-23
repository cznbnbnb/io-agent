package com.turboio.androidtests;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;

/** Read-only channel statistics for retained dictation captures. For the newest
 * captures it reassembles the archived recording-service stream, reads each Opus
 * TOC stereo flag and decodes with a private 2-channel official decoder. Only
 * per-window RMS levels leave the device: no text, audio, SDK or microphone use. */
public final class VoiceChannelProbe extends Instrumentation {
 private static final int PACKET=240,WINDOW_SAMPLES=8000;
 private String nonce="";
 private static void check(boolean value,String code){if(!value)throw new IllegalStateException(code);}
 @Override public void onCreate(Bundle args){super.onCreate(args);if(args!=null)nonce=args.getString("probe_id","");start();}
 private static Object field(Object owner,String name)throws Exception{Field f=owner.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(owner);}
 private static int rms(long sum,int count){return count==0?0:(int)Math.round(Math.sqrt((double)sum/count));}
 @Override public void onStart(){
  Bundle result=new Bundle();String error="";StringBuilder report=new StringBuilder();
  try{
   check(nonce.matches("[a-f0-9]{32}"),"CHANNEL_PROBE_ARGUMENT_INVALID");
   ClassLoader loader=getTargetContext().getClassLoader();
   // The official decoder's JNI lives in business_jni, loaded only by this static initializer.
   Class.forName("com.rayneo.airuntime.AiRuntimeNative",true,loader);
   Method decodeFrame=loader.loadClass("com.turboio.addon.OtaFrame").getDeclaredMethod("decode",byte[].class);decodeFrame.setAccessible(true);
   File audio=new File(getTargetContext().getFilesDir(),"voice-audio");File[] captures=audio.listFiles(File::isDirectory);check(captures!=null,"CHANNEL_PROBE_NO_CAPTURES");
   Arrays.sort(captures,(a,b)->Long.compare(new File(b,"original.frames").lastModified(),new File(a,"original.frames").lastModified()));
   int reported=0;
   for(File capture:captures){
    if(reported>=8)break;File frames=new File(capture,"original.frames");if(!frames.isFile()||frames.length()==0||frames.length()>8388608)continue;
    byte[] wire=Files.readAllBytes(frames.toPath());byte[] stream=new byte[1<<20];int end=0;
    for(int at=0;at+4<=wire.length;){
     int length=((wire[at]&255)<<24)|((wire[at+1]&255)<<16)|((wire[at+2]&255)<<8)|(wire[at+3]&255);at+=4;check(length>0&&at+length<=wire.length,"CHANNEL_PROBE_FRAMES_INVALID");
     Object frame=decodeFrame.invoke(null,(Object)Arrays.copyOfRange(wire,at,at+length));at+=length;
     if(((Integer)field(frame,"type"))!=3)continue;Map<?,?> body=(Map<?,?>)field(frame,"json");byte[] binary=(byte[])field(frame,"binary");
     long offset=(Long)body.get("offset");check(offset>=0&&offset+binary.length<=stream.length,"CHANNEL_PROBE_RANGE_INVALID");
     System.arraycopy(binary,0,stream,(int)offset,binary.length);end=Math.max(end,(int)(offset+binary.length));
    }
    int packets=end/PACKET,stereo=0;Set<Integer> configs=new TreeSet<>();
    Object decoder=loader.loadClass("com.rayneo.airuntime.utils.OpusDecoder").getConstructor().newInstance();
    Method init=decoder.getClass().getMethod("init-uN6NtqM",int.class,int.class),decode=decoder.getClass().getMethod("decode2Bytes",byte[].class),release=decoder.getClass().getMethod("release");
    check(Boolean.TRUE.equals(init.invoke(decoder,16000,2)),"CHANNEL_PROBE_DECODER_INIT_FAILED");
    StringBuilder left=new StringBuilder(),right=new StringBuilder(),diff=new StringBuilder();long sl=0,sr=0,sd=0,tl=0,tr=0,td=0;int n=0,total=0,frameBytes=0;
    try{
     for(int p=0;p<packets;p++){
      byte[] packet=Arrays.copyOfRange(stream,p*PACKET,(p+1)*PACKET);int toc=packet[0]&255;if((toc&4)!=0)stereo++;configs.add(toc>>3);
      byte[] pcm=(byte[])decode.invoke(decoder,(Object)packet);if(pcm==null)continue;frameBytes=pcm.length;
      for(int i=0;i+3<pcm.length;i+=4){
       int l=(short)((pcm[i]&255)|(pcm[i+1]<<8)),r=(short)((pcm[i+2]&255)|(pcm[i+3]<<8)),d=l-r;
       sl+=(long)l*l;sr+=(long)r*r;sd+=(long)d*d;tl+=(long)l*l;tr+=(long)r*r;td+=(long)d*d;n++;total++;
       if(n==WINDOW_SAMPLES){left.append(rms(sl,n)).append(',');right.append(rms(sr,n)).append(',');diff.append(rms(sd,n)).append(',');sl=sr=sd=0;n=0;}
      }
     }
    }finally{release.invoke(decoder);}
    report.append(capture.getName(),0,8).append('|').append(frames.lastModified()).append("|packets=").append(packets).append("|stereo_toc=").append(stereo).append("|configs=").append(configs)
     .append("|pcm_per_packet=").append(frameBytes).append("|rmsL=").append(rms(tl,total)).append("|rmsR=").append(rms(tr,total)).append("|rmsLminusR=").append(rms(td,total))
     .append("|L=").append(left).append("|R=").append(right).append("|D=").append(diff).append('\n');
    reported++;
   }
   check(reported>0,"CHANNEL_PROBE_NO_CAPTURES");
  }catch(Throwable failure){Throwable cause=failure;for(int depth=0;depth<12&&cause.getCause()!=null;depth++)cause=cause.getCause();String message=cause.getMessage();error=message!=null&&message.matches("CHANNEL_PROBE_[A-Z_]{1,60}")?message:"CHANNEL_PROBE_FAILED:"+cause.getClass().getSimpleName();}
  result.putString("probe_id",nonce.matches("[a-f0-9]{32}")?nonce:"");result.putString("channels",report.toString());result.putString("microphone_started","false");result.putString("error",error);
  finish(Activity.RESULT_OK,result);
 }
}
