package com.turboio.addon;
import java.nio.charset.StandardCharsets;import java.util.*;

/** Fixed host 1.0.7 A3 batch adapter. Preserves the whole incoming batch even
 * where the vendor parser clamps a declaration or drops a partial trailing frame.
 * Frame indexes restart within each batch: they do not prove stream continuity,
 * a completed recording, a codec profile, account ownership or source linkage. */
public final class AlwaysOnAudioBatch {
 public static final int FRAME_BYTES=240,MAX_BATCH_BYTES=16384;
 public static final class Frame {
  public final String taskId;public final int mode,index,count;public final boolean vpu,vad,flagsPresent;private final byte[] bytes;
  private Frame(String task,byte[] data,int mode,int index,int count,boolean vpu,boolean vad,boolean flags){taskId=task;bytes=data;this.mode=mode;this.index=index;this.count=count;this.vpu=vpu;this.vad=vad;flagsPresent=flags;}
  public byte[] bytes(){return bytes.clone();}
 }
 public final String taskId;public final boolean modern,clamped;public final int unparsedBytes;public final List<Frame> frames;private final byte[] original,metadata;
 private AlwaysOnAudioBatch(byte[] meta,byte[] input,String task,boolean modern,boolean clamped,List<Frame> frames,int consumed){metadata=meta.clone();original=input.clone();taskId=task;this.modern=modern;this.clamped=clamped;this.frames=Collections.unmodifiableList(frames);unparsedBytes=input.length-consumed;}
 public byte[] original(){return original.clone();}public byte[] metadata(){return metadata.clone();}
 /** Only validated integer/null fields are admitted. Stringified numbers and
  * unknown protocol extensions are retained by the caller, not silently coerced. */
 public static AlwaysOnAudioBatch parse(String message,byte[] input){
  require(message!=null&&message.length()<=16384&&input!=null&&input.length<=MAX_BATCH_BYTES,"AUDIO_BATCH_BUDGET");byte[] raw=message.getBytes(StandardCharsets.UTF_8);require(raw.length<=16384,"AUDIO_BATCH_BUDGET");Map<String,Object> m=WireJson.map(WireJson.read(raw));
  require(new HashSet<>(Arrays.asList("taskId","mode","frameCount","vpuMask","vadMask","vpu","vad")).containsAll(m.keySet()),"AUDIO_BATCH_METADATA_UNSUPPORTED");
  Object t=m.get("taskId");require(t==null||t instanceof String&&((String)t).matches("[A-Za-z0-9_-]{1,128}"),"AUDIO_BATCH_TASK_INVALID");String task=(String)t;
  for(String k:new String[]{"mode","frameCount","vpu","vad"}){long n=number(m,k,0);require(n>=Integer.MIN_VALUE&&n<=Integer.MAX_VALUE,"AUDIO_BATCH_NUMBER_INVALID");}number(m,"vpuMask",0);number(m,"vadMask",0);
  boolean modern=false;for(String k:new String[]{"mode","frameCount","vpuMask","vadMask"})modern|=m.containsKey(k);List<Frame> frames=new ArrayList<>();boolean clamped=false;int consumed=0;
  if(!modern){frames.add(new Frame(task,input.clone(),0,0,1,number(m,"vpu",0)==1,number(m,"vad",0)==1,m.containsKey("vpu")&&m.containsKey("vad")));consumed=input.length;}
  else{int available=input.length/FRAME_BYTES;long declared=number(m,"frameCount",available);int count=(int)Math.min(available,Math.max(0,Math.min(31,declared)));clamped=declared!=count||input.length%FRAME_BYTES!=0;
   int mode=(int)number(m,"mode",0);long vpu=number(m,"vpuMask",0),vad=number(m,"vadMask",0);boolean flags=m.containsKey("vpuMask")&&m.containsKey("vadMask");
   for(int i=0;i<count;i++)frames.add(new Frame(task,Arrays.copyOfRange(input,i*FRAME_BYTES,(i+1)*FRAME_BYTES),mode,i,count,((vpu>>>i)&1)!=0,((vad>>>i)&1)!=0,flags));consumed=count*FRAME_BYTES;
  }
  return new AlwaysOnAudioBatch(raw,input,task,modern,clamped,frames,consumed);
 }
 private static long number(Map<String,Object> m,String key,long fallback){Object n=m.get(key);require(n==null||n instanceof Long,"AUDIO_BATCH_NUMBER_INVALID");return n==null?fallback:(Long)n;}
 private static void require(boolean ok,String code){if(!ok)throw new IllegalArgumentException(code);}
}
