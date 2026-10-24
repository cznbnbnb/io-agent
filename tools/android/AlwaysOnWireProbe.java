package com.turboio.androidtests.voice;
import android.app.*;import android.os.*;import java.lang.reflect.*;import java.util.*;import java.io.*;import java.nio.file.*;import java.nio.channels.*;

/** Synthetic protobuf parsing only. Never invokes the native inbound handler,
 * changes its current peer, starts workflows or supplies audio to the SDK. */
public final class AlwaysOnWireProbe extends Instrumentation {
 private String nonce,mode;
 @Override public void onCreate(Bundle args){super.onCreate(args);nonce=args.getString("probe_id","");mode=args.getString("mode","");start();}
 private static Object call(Object o,String name)throws Exception{Method m=o.getClass().getMethod(name);m.setAccessible(true);return m.invoke(o);}
 @Override public void onStart(){Bundle out=new Bundle();try{
  if(!nonce.matches("[a-f0-9]{32}"))throw new IllegalStateException("AUDIO_WIRE_PROBE_NONCE");
  if("storage".equals(mode)){File root=getTargetContext().getFilesDir(),file=LifelogObservationPath.file(root,"lifelog-audio-observation-probe-"+nonce+".json");out.putBoolean("legacy_child_canonical_equal",new File(root,file.getName()).getAbsoluteFile().equals(new File(root,file.getName()).getCanonicalFile()));out.putBoolean("root_normalized",file.getParentFile().equals(root.getCanonicalFile()));try{Map<String,Object> value=new LifelogAudioObservation(nonce).snapshot();try(AtomicDocument document=new AtomicDocument(file,65536)){document.save(value);try(FileChannel directory=FileChannel.open(file.getParentFile().toPath(),StandardOpenOption.READ)){directory.force(true);}if(!Arrays.equals(WireJson.bytes(document.read()),WireJson.bytes(value)))throw new IllegalStateException("AUDIO_OBSERVATION_STORAGE_MISMATCH");}out.putBoolean("passed",true);out.putInt("storage_checks",3);}finally{for(String suffix:new String[]{"",".partial",".lock"})Files.deleteIfExists(new File(file.getPath()+suffix).toPath());out.putBoolean("synthetic_fixture_removed",!file.exists());}return;}
  LifelogAudioObservationTest.main(new String[0]);out.putInt("model_checks",LifelogAudioObservationTest.checks);
  Class<?> nativeType=getTargetContext().getClassLoader().loadClass("com.rayneo.airuntime.tansport.proto.TransportMessage$AssistantMsg");Method parse=nativeType.getMethod("parseFrom",byte[].class);Random random=new Random(904);int checks=0;
  for(int i=0;i<100;i++){int type=i==0?0:0xa1+i%5;byte[] data=new byte[i*17];random.nextBytes(data);String message=i==0?"":"合成🙂"+i;byte[] encoded=LifelogAudioObservationTest.packet(type,message,data),before=encoded.clone();AlwaysOnWire ours=AlwaysOnWire.read(encoded);Object nativeMessage=parse.invoke(null,(Object)encoded);Object nativeData=call(nativeMessage,"getData");
   if(((Integer)call(nativeMessage,"getType"))!=ours.type||((Integer)call(nativeMessage,"getVersion"))!=ours.version||!call(nativeMessage,"getMessage").equals(ours.message)||!Arrays.equals((byte[])call(nativeData,"t"),ours.data())||!Arrays.equals(before,encoded))throw new IllegalStateException("AUDIO_WIRE_NATIVE_MISMATCH");checks+=5;
  }out.putInt("differential_cases",100);out.putInt("differential_checks",checks);out.putBoolean("passed",true);
 }catch(Throwable error){while(error.getCause()!=null)error=error.getCause();out.putBoolean("passed",false);out.putString("error",error.getMessage()!=null&&error.getMessage().matches("[A-Z_]{3,90}")?error.getMessage():error.getClass().getSimpleName());}
 finally{out.putString("probe_id",nonce);out.putBoolean("synthetic_only",true);out.putBoolean("native_handler_invoked",false);out.putBoolean("audio_read_capture_playback",false);finish(out.getBoolean("passed")?Activity.RESULT_OK:Activity.RESULT_CANCELED,out);}
 }
}
