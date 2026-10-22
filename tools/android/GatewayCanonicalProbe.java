package com.turboio.androidtests;

import android.app.*;
import android.os.Bundle;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.json.*;

/** Compare the installed host's signer with independently constructed synthetic
 * vectors. No account, token, app key, user file or network request is accessed.
 * This does not prove that the resource-library signer is the Dart lifelog signer. */
public final class GatewayCanonicalProbe extends Instrumentation {
 private Bundle args;
 private static void check(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 private static String sha(String s)throws Exception{return Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));}
 private static String hmac(String key,String value)throws Exception{Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));return Base64.getEncoder().encodeToString(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));}
 @Override public void onCreate(Bundle args){super.onCreate(args);this.args=args;start();}
 @Override public void onStart(){
  Bundle result=new Bundle();Object signer=null;Method close=null;
  try{
   String nonce=args.getString("probe_id","");check(nonce.matches("[a-f0-9]{32}"),"PROBE_ID_INVALID");result.putString("probe_id",nonce);
   Class<?> type=getTargetContext().getClassLoader().loadClass("com.rayneo.resource.cloud.CloudDictResApi");
   signer=type.getConstructor().newInstance();close=type.getMethod("close");
   Method sign=type.getDeclaredMethod("genSign",String.class,String.class,String.class,String.class);sign.setAccessible(true);
   String app="synthetic-app",key="synthetic-only-key-20261021";
   String[] paths={"/synthetic/canonical","/synthetic/canonical?","/synthetic/canonical?b=2&a=1","/synthetic/canonical?q=%E4%B8%AD&repeat=1&repeat=2","/synthetic/canonical?q=a%20b&x=%2F"};
   JSONArray vectors=new JSONArray();
   for(int i=0;i<paths.length;i++){
    long before=System.currentTimeMillis()/1000;Object raw=sign.invoke(signer,app,key,"GET",paths[i]);long after=System.currentTimeMillis()/1000;
    check(raw instanceof Map,"HEADERS_INVALID");Map<?,?> headers=(Map<?,?>)raw;
    check(headers.keySet().equals(new HashSet<>(Arrays.asList("xtcl-timestamp","xtcl-nonce","xtcl-app","xtcl-authorization"))),"HEADER_SET_INVALID");
    String timestamp=(String)headers.get("xtcl-timestamp"),random=(String)headers.get("xtcl-nonce");
    long seconds=Long.parseLong(timestamp);check(seconds>=before&&seconds<=after,"TIMESTAMP_NOT_SECONDS");check(random.matches("[a-f0-9]{32}"),"NONCE_INVALID");check(app.equals(headers.get("xtcl-app")),"APP_MISMATCH");
    int q=paths[i].indexOf('?');String path=q>0?paths[i].substring(0,q):paths[i],query=q>0?paths[i].substring(q+1):"";
    String canonical="GET\n"+path+"\n"+query+"\nxtcl-nonce:"+random+";xtcl-timestamp:"+timestamp+";\n"+sha("");
    String expected="TCL1-HMAC-SHA256 Credential="+app+",SignedHeaders=xtcl-nonce;xtcl-timestamp;,Signature="+hmac(key,"TCL1-HMAC-SHA256\n"+timestamp+"\n"+sha(canonical));
    check(expected.equals(headers.get("xtcl-authorization")),"CANONICAL_MISMATCH");
    vectors.put(new JSONObject().put("vector",i).put("query_preserved",true).put("host_signature_matches",true));
   }
   result.putString("audit",new JSONObject().put("vectors",vectors).put("timestamp_unit","seconds").put("hash_encoding","standard Base64").put("hmac_encoding","standard Base64").put("query_order","raw supplied order").put("canonical_header_separator","semicolon").put("body","SHA-256 of empty UTF-8 string").put("lifelog_applicability_verified",false).toString());
   result.putBoolean("passed",true);
  }catch(Throwable e){while(e.getCause()!=null)e=e.getCause();String message=e.getMessage();result.putString("error",message!=null&&message.matches("[A-Z_]{3,80}")?message:"CANONICAL_PROBE_FAILED");result.putString("failure_class",e.getClass().getSimpleName());}
  finally{if(signer!=null&&close!=null)try{close.invoke(signer);result.putBoolean("client_closed",true);}catch(Exception ignored){result.putBoolean("client_closed",false);}}
  result.putBoolean("credentials_or_user_files_accessed",false);result.putInt("network_requests",0);result.putBoolean("microphone_started",false);
  finish(result.getBoolean("passed",false)&&result.getBoolean("client_closed",false)?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
 }
}
