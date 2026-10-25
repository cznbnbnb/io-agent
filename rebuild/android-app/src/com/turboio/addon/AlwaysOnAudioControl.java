package com.turboio.addon;

import java.nio.charset.StandardCharsets;import java.util.*;

/** Pinned 1.0.7 A5 exit marker. The SDK dispatches exit independently of rc or
 * isFinish. Neither field proves audio continuity or a complete recording. */
final class AlwaysOnAudioControl {
 final String task;final Integer rc;final Boolean finished;
 private AlwaysOnAudioControl(String task,Integer rc,Boolean finished){this.task=task;this.rc=rc;this.finished=finished;}
 static AlwaysOnAudioControl exit(AlwaysOnWire wire){
  require(wire!=null&&wire.version==1&&wire.type==0xa5&&wire.data().length==0);byte[] raw=wire.message.getBytes(StandardCharsets.UTF_8);require(raw.length<=16384);Map<String,Object> value=WireJson.map(WireJson.read(raw,16384,1000));
  require(new HashSet<>(Arrays.asList("taskId","rc","isFinish")).containsAll(value.keySet())&&value.get("taskId") instanceof String&&((String)value.get("taskId")).matches("[A-Za-z0-9_-]{1,128}"));Object rc=value.get("rc"),finished=value.get("isFinish");require(rc==null||rc instanceof Long&&(Long)rc>=Integer.MIN_VALUE&&(Long)rc<=Integer.MAX_VALUE);require(finished==null||finished instanceof Boolean);return new AlwaysOnAudioControl((String)value.get("taskId"),rc==null?null:((Long)rc).intValue(),(Boolean)finished);
 }
 private static void require(boolean value){if(!value)throw new IllegalArgumentException("AUDIO_CONTROL_UNSUPPORTED");}
}
