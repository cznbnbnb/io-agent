package com.turboio.addon;

import android.Manifest;import android.app.*;import android.content.pm.PackageManager;import android.os.*;import java.util.*;

/** Permission request is bound to the visible screen, never to a delayed SDK call. */
final class GlassesPermission {
 private static final String TAG="io.agent.glasses.permissions";
 static String[] missing(Activity activity){
  List<String> needed=new ArrayList<>();String[] names=Build.VERSION.SDK_INT>=31?new String[]{Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT}:new String[]{Manifest.permission.ACCESS_FINE_LOCATION};
  for(String name:names)if(activity.checkSelfPermission(name)!=PackageManager.PERMISSION_GRANTED)needed.add(name);return needed.toArray(new String[0]);
 }
 static void request(Activity activity,Runnable done){
  if(activity.isFinishing()||activity.isDestroyed()||activity.getFragmentManager().isStateSaved())return;
  if(missing(activity).length==0){done.run();return;}
  if(activity.getFragmentManager().findFragmentByTag(TAG)!=null)return;
  Request fragment=new Request();fragment.done=done;activity.getFragmentManager().beginTransaction().add(fragment,TAG).commit();
 }
 public static final class Request extends Fragment {
  private Runnable done;private boolean launched;
  public Request(){}
  @Override public void onStart(){super.onStart();if(!launched&&getActivity()!=null){launched=true;requestPermissions(missing(getActivity()),19071);}}
  @Override public void onRequestPermissionsResult(int code,String[] names,int[] granted){super.onRequestPermissionsResult(code,names,granted);if(code!=19071)return;Runnable callback=done;done=null;if(isAdded()){getFragmentManager().beginTransaction().remove(this).commitAllowingStateLoss();if(callback!=null)callback.run();}}
  @Override public void onDestroy(){done=null;super.onDestroy();}
 }
}
