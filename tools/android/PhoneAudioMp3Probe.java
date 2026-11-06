package com.turboio.addon;

import android.app.Instrumentation;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.Bundle;
import java.io.*;
import java.nio.file.Files;
import java.time.ZoneId;
import java.util.*;

/** On-device regression: two seconds of synthetic Opus silence, never the microphone. */
public final class PhoneAudioMp3Probe extends Instrumentation {
 private String date;
 @Override public void onCreate(Bundle args){super.onCreate(args);date=args.getString("recordingDate","");start();}
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
    if(media.getTrackCount()!=1||!"audio/mpeg".equals(fmt.getString(MediaFormat.KEY_MIME))||Math.abs(duration-2000000)>75000)throw new AssertionError("audio format/duration: "+duration);
    facts.putString("joined_track_mime",fmt.getString(MediaFormat.KEY_MIME));facts.putLong("joined_duration_us",duration);facts.putInt("audio_tracks",media.getTrackCount());
   }finally{media.release();}
   if(!PhoneAudioExport.name("测试/录音",at,ZoneId.of("UTC")).equals("测试 录音_2023-11-14_22-13-20.mp3"))throw new AssertionError("filename");
   facts.putBoolean("time_gap_and_cached_split",true);
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
    File encoded=PhoneAudioExport.encode(dir,Collections.singletonList(new PhoneAudioExport.Part(stock,entry.startedAt,entry.endedAt,"recording")));
    MediaExtractor actual=new MediaExtractor();try{actual.setDataSource(encoded.getPath());MediaFormat fmt=actual.getTrackFormat(0);if(actual.getTrackCount()!=1||!"audio/mpeg".equals(fmt.getString(MediaFormat.KEY_MIME)))throw new AssertionError("stock export track");facts.putLong("stock_duration_us",fmt.getLong(MediaFormat.KEY_DURATION));}finally{actual.release();}
   }status=-1;
  }catch(Throwable error){facts.putString("failure",android.util.Log.getStackTraceString(error));}
  finally{if(dir!=null){File[] tmp=dir.listFiles();if(tmp!=null)for(File f:tmp)f.delete();dir.delete();}}
  finish(status,facts);
 }
}
