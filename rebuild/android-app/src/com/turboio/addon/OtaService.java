package com.turboio.addon;
import android.app.*;import android.content.*;import android.os.*;

/** Immediate platform foreground acknowledgement, separate from permission to transfer firmware. */
public final class OtaService extends Service {
 private static volatile OtaService instance;private static volatile boolean ready;
 private boolean foreground;private volatile boolean ownerActive;private volatile int ownerKind;private volatile String ownerToken="";
 static boolean alive(){return instance!=null&&ready;}
 static boolean aliveOfficial(String token){OtaService s=instance;return s!=null&&ready&&s.ownerActive&&s.ownerKind==2&&token!=null&&!token.isEmpty()&&token.equals(s.ownerToken);}
 static void finishOfficial(String token){OtaService s=instance;if(s!=null&&s.ownerKind==2&&token!=null&&!token.isEmpty()&&token.equals(s.ownerToken))s.terminate(0);}
 static void finish(){ready=false;if(instance!=null)instance.terminate(0);}
 private void terminate(int startId){
  if(instance==this){instance=null;ready=false;}ownerActive=false;
  if(foreground){stopForeground(STOP_FOREGROUND_REMOVE);foreground=false;}
  if(startId>0)stopSelf(startId);else stopSelf();
 }
 private boolean promote(){
  if(foreground)return true;
  try{
   Intent launch=getPackageManager().getLaunchIntentForPackage(getPackageName());
   PendingIntent open=launch==null?null:PendingIntent.getActivity(this,7622,launch,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
   Notification notification=new Notification.Builder(this,"turboio_ota").setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("iO Agent 固件升级").setContentText("请回 App 查看状态；不会自动开始或重试升级").setContentIntent(open).setOnlyAlertOnce(true).setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE).build();
   startForeground(7622,notification,16);foreground=true;android.util.Log.i("iOAgentOtaService","FOREGROUND_ACK");return true;
  }catch(RuntimeException failure){OtaController.serviceLost();Fixed60Runtime.serviceLost();Fixed60OfficialRuntime.serviceLost();terminate(0);return false;}
 }
 @Override public void onCreate(){
  super.onCreate();instance=this;ready=false;
  getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("turboio_ota","固件升级",NotificationManager.IMPORTANCE_LOW));
  // Meet the OS startup contract even when the delivered owner token is stale.
  // Promoting a notification grants no SDK ticket and sends no firmware.
  promote();
 }
 private boolean currentOwnerValid(){return ownerActive&&instance==this&&ready&&(ownerKind==2?Fixed60OfficialRuntime.acceptService(ownerToken):ownerKind==1?Fixed60Runtime.acceptService(ownerToken):OtaController.busy()||OfficialOtaBridge.busy());}
 @Override public int onStartCommand(Intent intent,int flags,int id){
  if(!promote())return START_NOT_STICKY;
  boolean fixed=intent!=null&&intent.hasExtra("io_fixed60_lease"),official=intent!=null&&intent.hasExtra("io_official_fixed60_lease");String token=official?intent.getStringExtra("io_official_fixed60_lease"):fixed?intent.getStringExtra("io_fixed60_lease"):null;
  boolean accepted=intent!=null&&!(fixed&&official)&&(official?Fixed60OfficialRuntime.acceptService(token):fixed?Fixed60Runtime.acceptService(token):OtaController.busy()||OfficialOtaBridge.busy());
  if(!accepted){android.util.Log.i("iOAgentOtaService","OWNER_REQUEST_REJECTED");if(!currentOwnerValid())terminate(id);return START_NOT_STICKY;}
  instance=this;ownerActive=true;ownerKind=official?2:fixed?1:0;ownerToken=fixed||official?token:"";ready=true;return START_NOT_STICKY;
 }
 @Override public IBinder onBind(Intent intent){return null;}
 @Override public void onTaskRemoved(Intent intent){}
 @Override public void onDestroy(){if(instance==this){instance=null;ready=false;OtaController.serviceLost();Fixed60Runtime.serviceLost();OfficialOtaBridge.serviceLost();Fixed60OfficialRuntime.serviceLost();}super.onDestroy();}
 @Override public void onTimeout(int id,int type){OtaController.serviceLost();Fixed60Runtime.serviceLost();OfficialOtaBridge.serviceLost();Fixed60OfficialRuntime.serviceLost();terminate(0);}
}
