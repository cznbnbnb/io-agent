package com.turboio.androidtests;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Map;

/** Exercises installed policy with synthetic maps. Never reads/writes tokens,
 * user records, clocks or settings, and never initiates SDK/device activity. */
public final class LoginIdentityProbe extends Instrumentation {
 public void onCreate(Bundle args){super.onCreate(args);start();}
 public void onStart(){Bundle result=new Bundle();try{
  Class<?> login=getTargetContext().getClassLoader().loadClass("com.turboio.addon.Host107Login");
  Method identity=login.getDeclaredMethod("identityValid",Map.class,long.class),access=login.getDeclaredMethod("valid",Map.class,long.class);
  identity.setAccessible(true);access.setAccessible(true);
  long now=System.currentTimeMillis();Map<String,Object> values=new HashMap<>();
  values.put("accessToken","synthetic-access");values.put("accessTokenExpireAt",now-7200000L);
  values.put("refreshToken","synthetic-refresh");values.put("refreshTokenExpireAt",now+86400000L);
  if(!Boolean.TRUE.equals(identity.invoke(null,values,now))||!Boolean.FALSE.equals(access.invoke(null,values,now)))throw new Exception("ACCESS_AND_IDENTITY_NOT_SEPARATE");
  values.put("refreshTokenExpireAt",now-1);
  if(!Boolean.FALSE.equals(identity.invoke(null,values,now)))throw new Exception("EXPIRED_REFRESH_ACCEPTED");
  values.clear();if(!Boolean.FALSE.equals(identity.invoke(null,values,now)))throw new Exception("LOGOUT_ACCEPTED");
  result.putBoolean("installed_policy_verified",true);result.putBoolean("live_credentials_accessed",false);
  result.putBoolean("expired_access_keeps_valid_identity",true);result.putBoolean("official_api_access_still_rejected",true);
  result.putBoolean("expired_refresh_and_logout_rejected",true);finish(Activity.RESULT_OK,result);
 }catch(Throwable failure){result.putString("failure",failure.getClass().getSimpleName()+":"+failure.getMessage());finish(Activity.RESULT_CANCELED,result);}}
}
