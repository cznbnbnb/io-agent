package com.turboio.addon;

import android.app.Activity;
import android.content.Context;
import android.os.*;
import android.widget.Toast;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.*;

/** User-initiated, local export. Each timeline event is an independent selection
 * boundary; all reads, validation and encoding run outside the UI/capture lanes. */
final class PhoneAudioExport {
 private static final ExecutorService IO=Executors.newSingleThreadExecutor();
 private static final AtomicBoolean busy=new AtomicBoolean();
 static final class Part {
  final File file;final long start,end;final String track;
  Part(File file,long start,long end,String track){this.file=file;this.start=start;this.end=end;this.track=track;}
 }
 static List<List<Part>> groups(List<Part> parts){
  parts.sort(Comparator.comparingLong(p->p.start));List<List<Part>> result=new ArrayList<>();Part prev=null;
  for(Part p:parts){if(prev==null||!p.track.equals("live")||!prev.track.equals(p.track)||p.start<prev.end||p.start-prev.end>300000)result.add(new ArrayList<>());result.get(result.size()-1).add(p);prev=p;}return result;
 }
 static String name(String title,long at,ZoneId zone){
  String safe=title.replaceAll("[\\p{Cntrl}\\\\/:*?\"<>|]+"," ").trim();StringBuilder stem=new StringBuilder();int bytes=0;
  for(int i=0;i<safe.length();){int cp=safe.codePointAt(i);String ch=new String(Character.toChars(cp));bytes+=ch.getBytes(StandardCharsets.UTF_8).length;if(bytes>170)break;stem.append(ch);i+=Character.charCount(cp);}
  return (stem.length()==0?"录音":stem.toString().trim())+"_"+DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss",Locale.ROOT).format(Instant.ofEpochMilli(at).atZone(zone))+".mp4";
 }
 static File recording(Context app,String account,MaterialCatalog.Entry entry)throws IOException{
  OfficialAccountBinding login=Host107Login.account();if(login==null||!login.binding.equals(account))throw new IOException("OFFICIAL_ACCOUNT_CHANGED");
  File dir=login.recordingsDirectory(new File(app.getApplicationInfo().dataDir,"app_flutter")).getCanonicalFile();
  for(String ext:new String[]{"opus","ogg","m4a","mp3","wav","oga"}){File f=new File(dir,entry.recordingId+"."+ext);
   if(f.isFile()&&f.length()>0&&f.getCanonicalFile().equals(f)&&dir.equals(f.getParentFile()))return f;}
  throw new IOException("RECORDING_NOT_LOCAL");
 }
 /** The host already ships FFmpegKit. Argv and private numbered concat entries
  * keep user titles out of both the command and the concat syntax. */
 static File encode(File dir,List<Part> group)throws Exception{
  List<String> argv=new ArrayList<>(Arrays.asList("-nostdin","-hide_banner","-loglevel","error","-xerror","-y","-protocol_whitelist","file"));
  if(group.size()==1){argv.add("-i");argv.add(group.get(0).file.getAbsolutePath());}
  else{StringBuilder manifest=new StringBuilder();for(Part p:group){if(!p.file.getParentFile().equals(dir)||!p.file.getName().matches("[0-9]+\\.ogg"))throw new IOException("AUDIO_EXPORT_PATH");manifest.append("file ").append(p.file.getName()).append('\n');}
   File list=new File(dir,"inputs.txt");Files.write(list.toPath(),manifest.toString().getBytes(StandardCharsets.UTF_8));Collections.addAll(argv,"-f","concat","-safe","1","-i",list.getAbsolutePath());}
  File out=new File(dir,"output.mp4");Collections.addAll(argv,"-map","0:a:0","-vn","-map_metadata","-1","-c:a","aac","-b:a","96k","-movflags","+faststart","-f","mp4",out.getAbsolutePath());
  Object session=Class.forName("com.antonkarpenko.ffmpegkit.FFmpegKit").getMethod("executeWithArguments",String[].class).invoke(null,(Object)argv.toArray(new String[0]));
  Object code=session.getClass().getMethod("getReturnCode").invoke(session);
  if(code==null||((Number)code.getClass().getMethod("getValue").invoke(code)).intValue()!=0||out.length()==0)throw new IOException("AUDIO_EXPORT_DECODE_FAILED");
  return out;
 }
 static void save(Activity a,String account,List<MaterialTimeline.Item> items,List<MaterialCatalog.Entry> selected){
  if(selected.isEmpty())return;if(!busy.compareAndSet(false,true)){AgentUI.notice(a,"已有音频正在导出");return;}
  Context app=a.getApplicationContext();Toast.makeText(app,"正在合并并导出 MP4 音频…",Toast.LENGTH_SHORT).show();
  Set<MaterialCatalog.Entry> wanted=new HashSet<>(selected);
  IO.execute(()->{int saved=0,failed=0;Set<String> errors=new LinkedHashSet<>();String last="";
   try{for(MaterialTimeline.Item item:items){if(Collections.disjoint(item.parts,wanted))continue;
    File dir=Files.createTempDirectory(app.getCacheDir().toPath(),"io-mp4-").toFile();
    try{List<Part> parts=new ArrayList<>();int[] sequence={0};
     for(MaterialCatalog.Entry entry:item.parts)if(wanted.contains(entry)){
      LifelogAudioRuntime.account(account);
      try{if(!entry.recordingId.isEmpty()){parts.add(new Part(recording(app,account,entry),entry.startedAt,entry.endedAt,"recording"));continue;}
       // freeze returns on MAIN. Only obtain the immutable references in that callback.
       CompletableFuture<List<List<Object>>> refs=new CompletableFuture<>();
       LifelogAudioRuntime.freeze(account,entry.id,(sessions,archives,error)->{if(error.isEmpty())refs.complete(Arrays.asList(sessions,archives));else refs.completeExceptionally(new IOException(error));});
       List<List<Object>> sources=refs.get();
       long[] nextCheck={0};LifelogAudioArchive.Guard guard=()->{long now=SystemClock.elapsedRealtime();if(now>=nextCheck[0]){LifelogAudioRuntime.account(account);nextCheck[0]=now+250;}};
       LifelogAudioExport.Draft draft=LifelogAudioExport.prepare(app.getFilesDir(),app.getCacheDir(),account,entry.id,sources.get(0),sources.get(1),Host107OpusFileDecoder::new,guard,System.currentTimeMillis());
       try(ZipFile zip=new ZipFile(draft.file)){if(!draft.sha.equals(LifelogAudioExport.sha(draft.file)))throw new IOException("AUDIO_EXPORT_CHANGED");
        ZipEntry index=zip.getEntry("片段索引.json");List<Part> extracted=new ArrayList<>();
        try(InputStream in=zip.getInputStream(index)){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)bytes.write(buf,0,n);
         for(Object raw:WireJson.list(WireJson.map(WireJson.read(bytes.toByteArray(),2097152,100000)).get("parts"))){Map<String,Object> row=WireJson.map(raw);File part=new File(dir,(++sequence[0])+".ogg");
          try(InputStream audio=zip.getInputStream(zip.getEntry((String)row.get("file")))){Files.copy(audio,part.toPath());}
          boolean live="realtime".equals(row.get("audio_channel"));long at=live?(Long)row.get("first_received_at"):MaterialTimeline.start(entry);
          extracted.add(new Part(part,at,live?(Long)row.get("last_received_at"):at,live?"live":"cached"));
         }}
        parts.addAll(extracted);
       }finally{LifelogAudioExport.remove(app.getCacheDir(),draft.id);}
      }catch(Exception e){Throwable cause=e instanceof ExecutionException?e.getCause():e;if("OFFICIAL_ACCOUNT_CHANGED".equals(cause.getMessage()))throw new IOException("OFFICIAL_ACCOUNT_CHANGED");failed++;errors.add("RECORDING_NOT_LOCAL".equals(cause.getMessage())?"录音文件不在本机，可先到原厂录音页下载":MaterialAudioExport.label(Objects.toString(cause.getMessage(),"")));}
     }
     for(List<Part> group:groups(parts)){LifelogAudioRuntime.account(account);File mp4=encode(dir,group);LifelogAudioRuntime.account(account);
      last=ExportDestination.write(app,name(item.title(),group.get(0).start,item.parts.get(0).zone),"video/mp4",stream->{Files.copy(mp4.toPath(),stream);LifelogAudioRuntime.account(account);});saved++;}
    }finally{File[] tmp=dir.listFiles();if(tmp!=null)for(File f:tmp)Files.deleteIfExists(f.toPath());Files.deleteIfExists(dir.toPath());}
   }}catch(Exception e){failed++;errors.add(MaterialAudioExport.label(Objects.toString(e.getMessage(),"")));}
   finally{busy.set(false);}
   String result=(saved==0?"未导出音频":saved==1?"已保存到 "+last:"已保存 "+saved+" 个 MP4 到 "+ExportDestination.label(app))+(failed==0?"":"；"+String.join("；",errors));
   new Handler(Looper.getMainLooper()).post(()->Toast.makeText(app,result,Toast.LENGTH_LONG).show());
  });
 }
}
