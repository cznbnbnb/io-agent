package com.turboio.addon;

import android.app.Instrumentation;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.Bundle;
import java.io.*;
import java.nio.*;
import java.nio.file.Files;
import java.util.concurrent.*;
import java.util.zip.*;
import java.time.ZoneId;
import java.util.*;

/** On-device export regression. With recordingDate, also checks existing local files; never opens the microphone. */
public final class PhoneAudioMp3Probe extends Instrumentation {
 private String date;
 @Override public void onCreate(Bundle args){super.onCreate(args);date=args.getString("recordingDate","");start();}
 private static MediaFormat track(File file)throws IOException{
  MediaExtractor media=new MediaExtractor();
  try{media.setDataSource(file.getPath());if(media.getTrackCount()!=1)throw new AssertionError("expected one audio track");return media.getTrackFormat(0);}finally{media.release();}
 }
 // Decode a bounded window without remixing. Keep PCM on the phone, report only aggregate measurements.
 private static short[] samples(File file,File dir,int start,int seconds)throws Exception{
  File raw=new File(dir,"window.pcm");
  String[] args={"-nostdin","-loglevel","error","-y","-ss",String.valueOf(start),"-i",file.getPath(),"-t",String.valueOf(seconds),"-map","0:a:0","-ar","16000","-f","s16le",raw.getPath()};
  Object r=Class.forName("com.antonkarpenko.ffmpegkit.FFmpegKit").getMethod("executeWithArguments",String[].class).invoke(null,(Object)args);
  Object code=r.getClass().getMethod("getReturnCode").invoke(r);
  if(code==null||((Number)code.getClass().getMethod("getValue").invoke(code)).intValue()!=0)throw new AssertionError("PCM decode");
  ShortBuffer decoded=ByteBuffer.wrap(Files.readAllBytes(raw.toPath())).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer();
  short[] pcm=new short[decoded.remaining()];decoded.get(pcm);return pcm;
 }
 private static void checkExport(File out,File dir,String label,Bundle facts)throws Exception{
  MediaFormat fmt=track(out);
  if(!"audio/mpeg".equals(fmt.getString(MediaFormat.KEY_MIME))||fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)!=2)throw new AssertionError(label+" missing stereo MP3");
  long duration=fmt.getLong(MediaFormat.KEY_DURATION);short[] pcm=samples(out,dir,(int)Math.min(8,duration/4000000),2);
  int peak=0,diff=0;for(int i=0;i+1<pcm.length;i+=2){peak=Math.max(peak,Math.abs((int)pcm[i]));diff=Math.max(diff,Math.abs(pcm[i]-pcm[i+1]));}
  if(pcm.length==0||diff>2)throw new AssertionError(label+" ears differ: "+diff);
  facts.putLong(label+"_duration_us",duration);facts.putInt(label+"_channels",2);facts.putInt(label+"_peak",peak);facts.putInt(label+"_max_lr_delta",diff);
 }
 @Override public void onStart(){
  Bundle facts=new Bundle();File dir=null;int status=0;
  try{
   dir=Files.createTempDirectory(getTargetContext().getCacheDir().toPath(),"mp3-check-").toFile();
   List<PhoneAudioExport.Part> parts=new ArrayList<>();long at=1700000000000L;
   for(int i=0;i<2;i++){File f=new File(dir,(i+1)+".ogg");try(OutputStream stream=new FileOutputStream(f)){
    OpusFile writer=new OpusFile(stream,i+1);for(int packet=0;packet<50;packet++)writer.packet(new byte[]{(byte)0xf8,(byte)0xff,(byte)0xfe});writer.finish();}
    parts.add(new PhoneAudioExport.Part(f,at+i*2000,at+i*2000+1000,"live"));
   }
   parts.add(new PhoneAudioExport.Part(parts.get(0).file,at+303001,at+304001,"live"));
   parts.add(new PhoneAudioExport.Part(parts.get(0).file,at+304002,at+305002,"cached"));
   Collections.reverse(parts);List<List<PhoneAudioExport.Part>> planned=PhoneAudioExport.groups(parts);
   if(planned.size()!=3||planned.get(0).size()!=2)throw new AssertionError("split");
   File out=PhoneAudioExport.encode(dir,planned.get(0));MediaExtractor media=new MediaExtractor();try{
    media.setDataSource(out.getPath());MediaFormat fmt=media.getTrackFormat(0);long duration=fmt.getLong(MediaFormat.KEY_DURATION);
    if(fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)!=2||media.getTrackCount()!=1||!"audio/mpeg".equals(fmt.getString(MediaFormat.KEY_MIME))||Math.abs(duration-2000000)>75000)throw new AssertionError("audio format/duration: "+duration);
    facts.putString("joined_track_mime",fmt.getString(MediaFormat.KEY_MIME));facts.putLong("joined_duration_us",duration);facts.putInt("audio_tracks",media.getTrackCount());
   }finally{media.release();}
   if(!PhoneAudioExport.name("测试/录音",at,ZoneId.of("UTC")).equals("测试 录音_2023-11-14_22-13-20.mp3"))throw new AssertionError("filename");
   facts.putBoolean("time_gap_and_cached_split",true);
   // Alternate a 440 Hz tone on the left with an 880 Hz tone on the right.
   // Simply preserving stereo or copying just one microphone must fail.
   int frames=32000;ByteBuffer wav=ByteBuffer.allocate(44+frames*4).order(ByteOrder.LITTLE_ENDIAN);
   wav.putInt(0x46464952).putInt(36+frames*4).putInt(0x45564157).putInt(0x20746d66).putInt(16)
      .putShort((short)1).putShort((short)2).putInt(16000).putInt(64000).putShort((short)4).putShort((short)16).putInt(0x61746164).putInt(frames*4);
   for(int i=0;i<frames;i++){boolean left=i<16000;short tone=(short)(18000*Math.sin(2*Math.PI*(left?440:880)*i/16000));wav.putShort(left?tone:0).putShort(left?0:tone);}
   File split=new File(dir,"split.wav");Files.write(split.toPath(),wav.array());
   out=PhoneAudioExport.encode(dir,Collections.singletonList(new PhoneAudioExport.Part(split,at,at+2000,"recording")));
   checkExport(out,dir,"fixture",facts);short[] decoded=samples(out,dir,0,2);
   if(decoded.length<62000)throw new AssertionError("truncated stereo fixture");
   for(int half=0;half<2;half++)for(int ear=0;ear<2;ear++){
    double re=0,im=0;int hz=half==0?440:880;
    for(int i=0;i<8000;i++){double angle=2*Math.PI*hz*i/16000;int sample=decoded[2*(half*16000+4000+i)+ear];re+=sample*Math.cos(angle);im+=sample*Math.sin(angle);}
    if(Math.hypot(re,im)*2/8000<6000)throw new AssertionError("missing "+hz+" Hz in ear "+ear);
   }
   facts.putBoolean("both_source_tones_in_each_ear",true);
   // Optional local recording check. Never print titles, identifiers, paths or audio.
   if(!date.isEmpty()){
    android.content.Context app=getTargetContext();app.startActivity(app.getPackageManager().getLaunchIntentForPackage(app.getPackageName()).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
    OfficialAccountBinding account=null;for(int i=0;account==null&&i<60;i++){Thread.sleep(200);account=Host107Login.account();}
    if(account==null)throw new AssertionError("login");
    ZoneId zone=ZoneId.systemDefault();MaterialCatalog catalog;
    try(LifelogInsightStore store=new LifelogInsightStore(app.getFilesDir(),account.binding)){catalog=MaterialCatalog.withRecordings(MaterialCatalog.empty(account.binding,zone),store.snapshot(),date,zone.getId());}
    if(catalog.entries.isEmpty())throw new AssertionError("no recordings on test day");
    MaterialCatalog.Entry entry=catalog.entries.get(0);File stock=PhoneAudioExport.recording(app,account.binding,entry);
    facts.putBoolean("stock_file_found",true);
    int inputChannels=track(stock).getInteger(MediaFormat.KEY_CHANNEL_COUNT);facts.putInt("stock_source_channels",inputChannels);
    if(inputChannels==2){short[] original=samples(stock,dir,8,2);int diff=0;for(int i=0;i+1<original.length;i+=2)diff=Math.max(diff,Math.abs(original[i]-original[i+1]));facts.putInt("stock_source_max_lr_delta",diff);}
    File encoded=PhoneAudioExport.encode(dir,Collections.singletonList(new PhoneAudioExport.Part(stock,entry.startedAt,entry.endedAt,"recording")));
    checkExport(encoded,dir,"stock",facts);
    // Pick the smallest already-linked, locally saved lifelog without exposing its ID.
    File library=new File(new File(app.getFilesDir(),"lifelog-audio-library"),account.binding+".json");long smallest=Long.MAX_VALUE;String material="";
    for(Object raw:WireJson.list(WireJson.map(WireJson.read(Files.readAllBytes(library.toPath()))).get("sessions"))){Map<String,Object> row=WireJson.map(raw);long batches=(long)row.get("saved_batches");if(Boolean.TRUE.equals(row.get("source_link_verified"))&&batches>0&&batches<smallest){smallest=batches;material=(String)row.get("material_id");}}
    if(material.isEmpty())throw new AssertionError("no linked local lifelog");
    String binding=account.binding;CompletableFuture<List<List<Object>>> refs=new CompletableFuture<>();
    LifelogAudioRuntime.freeze(binding,material,(sessions,archives,error)->{if(error.isEmpty())refs.complete(Arrays.asList(sessions,archives));else refs.completeExceptionally(new IOException(error));});
    List<List<Object>> sources=refs.get(20,TimeUnit.SECONDS);
    LifelogAudioExport.Draft draft=LifelogAudioExport.prepare(app.getFilesDir(),app.getCacheDir(),binding,material,sources.get(0),sources.get(1),Host107OpusFileDecoder::new,()->LifelogAudioRuntime.account(binding),System.currentTimeMillis());
    try(ZipFile zip=new ZipFile(draft.file)){
     ZipEntry fragment=zip.stream().filter(e->e.getName().endsWith(".opus")).findFirst().get();File source=new File(dir,"lifelog.ogg");
     try(InputStream in=zip.getInputStream(fragment)){Files.copy(in,source.toPath());}
     facts.putInt("lifelog_source_channels",track(source).getInteger(MediaFormat.KEY_CHANNEL_COUNT));
     checkExport(PhoneAudioExport.encode(dir,Collections.singletonList(new PhoneAudioExport.Part(source,at,at,"live"))),dir,"lifelog",facts);
    }finally{LifelogAudioExport.remove(app.getCacheDir(),draft.id);}
   }status=-1;
  }catch(Throwable error){facts.putString("failure",android.util.Log.getStackTraceString(error));}
  finally{if(dir!=null){File[] tmp=dir.listFiles();if(tmp!=null)for(File f:tmp)f.delete();dir.delete();}}
  finish(status,facts);
 }
}
