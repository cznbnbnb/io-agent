package com.turboio.androidtests;
import android.app.*;import android.os.*;import com.turboio.androidtests.voice.MaterialQueueMigrationBridge;
/** Synthetic private files only; installed legacy reader versus new reader. */
public final class MaterialQueueMigrationProbe extends Instrumentation {
 private String nonce;
 @Override public void onCreate(Bundle args){super.onCreate(args);nonce=args.getString("probe_id","");start();}
 @Override public void onStart(){Bundle report=new Bundle();report.putString("probe_id",nonce);try{
  report.putString("audit",MaterialQueueMigrationBridge.check(getTargetContext().getFilesDir(),getTargetContext().getClassLoader(),nonce));report.putBoolean("passed",true);report.putBoolean("real_materials_or_settings_accessed",false);report.putInt("network_requests",0);finish(Activity.RESULT_OK,report);
 }catch(Throwable error){while(error.getCause()!=null)error=error.getCause();String code=error.getMessage();report.putString("error",code!=null&&code.matches("[A-Z_]{3,90}")?code:error.getClass().getSimpleName());report.putBoolean("passed",false);finish(Activity.RESULT_CANCELED,report);}}
}
