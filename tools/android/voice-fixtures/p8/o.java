package p8;
import com.rayneo.airuntime.bridge.AudioRecorderBridge.AudioRecorderAdapter;
/** JVM-only mirror of the pinned host's notification-only external-data adapter. */
public final class o extends AudioRecorderAdapter {
 public boolean onCreate(){return true;}public boolean onDestroy(){notifyRecordStop();return true;}
 public boolean onPause(){notifyRecordStop();return true;}public boolean onResume(){notifyRecordStart();return true;}
 public boolean onStart(){notifyRecordStart();return true;}public boolean onStop(){notifyRecordStop();return true;}
}
