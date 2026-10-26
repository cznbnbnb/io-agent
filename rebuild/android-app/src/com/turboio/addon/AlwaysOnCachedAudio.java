package com.turboio.addon;

import java.util.*;

/** Pinned host 1.0.7 A4 adapter. Actual cached dispatch reaches m8.s$a.c,
 * which splits each data array into 240-byte packets and retains a short tail.
 * Never joins transport batches, drops a tail, invents A3 flags, or treats
 * isFinish as proof of complete audio. Native decoding is required for export. */
final class AlwaysOnCachedAudio {
 final String task;final Boolean finished;final List<AlwaysOnAudioBatch.Frame> frames;
 private AlwaysOnCachedAudio(String task,Boolean finished,List<AlwaysOnAudioBatch.Frame> frames){this.task=task;this.finished=finished;this.frames=Collections.unmodifiableList(frames);}
 static AlwaysOnCachedAudio parse(AlwaysOnWire wire){
  if(wire==null||wire.version!=1||wire.type!=0xa4)throw new IllegalArgumentException("AUDIO_CACHED_UNSUPPORTED");
  AlwaysOnAudioControl fields=AlwaysOnAudioControl.fields(wire.message);byte[] data=wire.data();
  try{if(data.length>65536)throw new IllegalArgumentException("AUDIO_CACHED_BUDGET");int count=(data.length+239)/240;List<AlwaysOnAudioBatch.Frame> frames=new ArrayList<>(count);
   for(int i=0;i<count;i++)frames.add(AlwaysOnAudioBatch.cachedFrame(fields.task,Arrays.copyOfRange(data,i*240,Math.min(data.length,(i+1)*240)),i,count));
   return new AlwaysOnCachedAudio(fields.task,fields.finished,frames);
  }finally{Arrays.fill(data,(byte)0);}
 }
}
