package com.turboio.androidtests.voice;

import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.lang.reflect.*;import java.security.*;import java.nio.charset.StandardCharsets;import java.util.*;import org.json.*;
import com.turboio.androidtests.voice.AlwaysOnWire;
import com.turboio.androidtests.voice.AlwaysOnAudioBatch;
import com.turboio.androidtests.voice.OfficialHiveCache;

/** Samples copies already queued by dev78's observer for at most 20 seconds.
 * Does not dequeue, register/replace listeners or invoke recording/SDK workflows.
 * A private official Opus decoder consumes at most 4 batches / 124 frames in
 * memory; audio is never written, played, uploaded or included in results. */
public final class AlwaysOnLiveCodecProbe extends Instrumentation {
 private String nonce;private ClassLoader loader;
 private static Object field(Object o,String n)throws Exception{Class<?> c=o instanceof Class?(Class<?>)o:o.getClass();Field f=c.getDeclaredField(n);f.setAccessible(true);return f.get(o instanceof Class?null:o);}
 private static Object call(Object o,String n,Class<?>[] types,Object...args)throws Exception{Class<?> c=o instanceof Class?(Class<?>)o:o.getClass();Method m=c.getDeclaredMethod(n,types);m.setAccessible(true);return m.invoke(o instanceof Class?null:o,args);}
 private static void check(boolean b,String code){if(!b)throw new IllegalStateException(code);}
 private static String hash(String s)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8))){int n=b&255;out.append("0123456789abcdef".charAt(n>>>4)).append("0123456789abcdef".charAt(n&15));}return out.toString();}
 // TOC interpretation matches vendored opus-1.5.2/src/opus.c and
 // opus_decoder.c. Decoder acceptance is separately required below.
 private static int samples48(byte[] b){int toc=b[0]&255;int per=(toc&128)!=0?(48000<<((toc>>3)&3))/400:(toc&96)==96?((toc&8)!=0?960:480):((toc>>3)&3)==3?2880:(48000<<((toc>>3)&3))/100;int code=toc&3,count=code==0?1:code==3?(b.length<2?0:b[1]&63):2;check(count>0&&per*count<=5760,"AUDIO_CODEC_PACKET_DURATION");return per*count;}
 private static int padding(byte[] b){if((b[0]&3)!=3||(b[1]&64)==0)return 0;int at=2,total=0,v;do{check(at<b.length,"AUDIO_CODEC_PADDING");v=b[at++]&255;total+=v==255?254:v;check(total<=b.length-at,"AUDIO_CODEC_PADDING");}while(v==255);return total;}
 @Override public void onCreate(Bundle args){super.onCreate(args);nonce=args.getString("probe_id","");start();}
 @Override public void onStart(){Bundle out=new Bundle();Object decoder=null;JSONArray profiles=new JSONArray();int batches=0,frames=0;try{
  check(nonce.matches("[a-f0-9]{32}"),"AUDIO_CODEC_NONCE");Context context=getTargetContext();loader=context.getClassLoader();android.content.pm.PackageInfo pkg=context.getPackageManager().getPackageInfo(context.getPackageName(),0);check(pkg.getLongVersionCode()==10500&&"0.5.3-dev78".equals(pkg.versionName),"AUDIO_CODEC_VERSION");
  context.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(context,"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  Class<?> runtime=loader.loadClass("com.turboio.addon.LifelogAudioObservationRuntime"),login=loader.loadClass("com.turboio.addon.Host107Login");Object account=null,self=null;long ready=SystemClock.elapsedRealtime()+12000;
  do{self=field(runtime,"instance");account=call(login,"account",new Class<?>[0]);if(self!=null&&account!=null)break;Thread.sleep(100);}while(SystemClock.elapsedRealtime()<ready);check(self!=null&&account!=null,"AUDIO_CODEC_NOT_READY");String owner=(String)field(account,"binding");
  Class.forName("com.rayneo.airuntime.AiRuntimeNative",true,loader);decoder=loader.loadClass("com.rayneo.airuntime.utils.OpusDecoder").getConstructor().newInstance();check(Boolean.TRUE.equals(call(decoder,"init-uN6NtqM",new Class<?>[]{int.class,int.class},16000,2)),"AUDIO_CODEC_INIT");
  Set<Object> seen=Collections.newSetFromMap(new IdentityHashMap<>());Map<String,Integer> layouts=new TreeMap<>();Set<String> tasks=new HashSet<>(),peers=new HashSet<>();long deadline=SystemClock.elapsedRealtime()+20000;
  while(batches<4&&SystemClock.elapsedRealtime()<deadline){byte[] raw=null;String peer="";synchronized(self){Object q=field(self,"queue");check(q instanceof ArrayDeque,"AUDIO_CODEC_QUEUE");for(Object event:(ArrayDeque<?>)q){if(seen.contains(event))continue;byte[] source=(byte[])field(event,"raw");check(source!=null&&source.length<=65536,"AUDIO_CODEC_WIRE_SIZE");raw=source.clone();peer=(String)field(event,"peer");seen.add(event);break;}}
   if(raw==null){Thread.sleep(25);continue;}check(seen.size()<=64,"AUDIO_CODEC_EVENT_BUDGET");AlwaysOnWire wire=AlwaysOnWire.read(raw);Arrays.fill(raw,(byte)0);if(wire.type!=0xa3)continue;AlwaysOnAudioBatch batch=AlwaysOnAudioBatch.parse(wire.message,wire.data());check(!batch.clamped&&batch.unparsedBytes==0&&!batch.frames.isEmpty(),"AUDIO_CODEC_BATCH_SHAPE");batches++;peers.add(hash(peer));
   for(AlwaysOnAudioBatch.Frame frame:batch.frames){byte[] packet=frame.bytes();check(packet.length>0&&packet.length<=8192,"AUDIO_CODEC_PACKET_SIZE");int toc=packet[0]&255,total=samples48(packet),pad=padding(packet);byte[] pcm=(byte[])call(decoder,"decode2Bytes",new Class<?>[]{byte[].class},(Object)packet);check(pcm!=null&&pcm.length==total/3*2*2,"AUDIO_CODEC_DECODE_SIZE");String key="toc="+toc+",channels="+((toc&4)==0?1:2)+",samples48="+total+",packet_bytes="+packet.length+",padding="+pad+",pcm16k_stereo_bytes="+pcm.length;layouts.put(key,layouts.getOrDefault(key,0)+1);frames++;if(frame.taskId!=null&&!frame.taskId.isEmpty())tasks.add(hash(frame.taskId));Arrays.fill(packet,(byte)0);Arrays.fill(pcm,(byte)0);}
  }
  check(frames>0,"AUDIO_CODEC_NO_LIVE_DATA");Object after=call(login,"account",new Class<?>[0]);check(after!=null&&owner.equals(field(after,"binding")),"AUDIO_CODEC_ACCOUNT_CHANGED");File cache=(File)call(after,"cacheFile",new Class<?>[]{File.class},new File(context.getApplicationInfo().dataDir,"app_flutter"));Set<String> matches=new TreeSet<>();for(String ref:OfficialHiveCache.sourceReferences(OfficialHiveCache.read(cache)))if(ref.startsWith("conversation/")&&tasks.contains(hash(ref.substring(13))))matches.add(hash(ref.substring(13)));
  for(Map.Entry<String,Integer> layout:layouts.entrySet())profiles.put(new JSONObject().put("layout",layout.getKey()).put("packets",layout.getValue()));out.putString("task_hashes",new JSONArray(tasks).toString());out.putString("peer_hashes",new JSONArray(peers).toString());out.putString("exact_current_source_matches",new JSONArray(matches).toString());out.putBoolean("passed",true);out.putBoolean("sampled_packets_decode_as_opus",true);
 }catch(Throwable e){while(e.getCause()!=null)e=e.getCause();String m=e.getMessage();out.putBoolean("passed",false);out.putString("error",m!=null&&m.matches("[A-Z_]{3,90}")?m:e.getClass().getSimpleName());}
 finally{if(decoder!=null)try{call(decoder,"release",new Class<?>[0]);out.putBoolean("private_decoder_released",true);}catch(Exception e){out.putBoolean("private_decoder_released",false);out.putBoolean("passed",false);}
  out.putString("probe_id",nonce);out.putString("profiles",profiles.toString());out.putInt("batches",batches);out.putInt("frames",frames);out.putInt("decoder_output_rate",16000);out.putInt("decoder_output_channels",2);out.putBoolean("new_recording_started",false);out.putBoolean("original_queue_mutated",false);out.putBoolean("audio_persisted_uploaded_played",false);out.putBoolean("whole_recording_complete",false);finish(out.getBoolean("passed")?Activity.RESULT_OK:Activity.RESULT_CANCELED,out);}
 }
}
