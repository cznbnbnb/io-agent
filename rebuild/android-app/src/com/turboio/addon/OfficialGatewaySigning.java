package com.turboio.addon;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Pure offline canonical/signature construction. GET rules have installed-host
 * synthetic evidence. Nonempty POST bodies are a static algorithm migration;
 * the current Dart host's nonempty-body dynamic vector is still unverified.
 * This class enables no HTTP transport and reads no credentials, clock or files. */
final class OfficialGatewaySigning {
 private static final String ALGORITHM="TCL1-HMAC-SHA256";
 private OfficialGatewaySigning(){}
 private static void require(boolean ok,String field){if(!ok)throw new IllegalArgumentException("GATEWAY_SIGNING_"+field+"_INVALID");}
 private static void timestamp(String value){
  require(value!=null&&value.matches("[1-9][0-9]{0,18}"),"TIMESTAMP");
  try{require(Long.parseLong(value)>0,"TIMESTAMP");}catch(NumberFormatException invalid){throw new IllegalArgumentException("GATEWAY_SIGNING_TIMESTAMP_INVALID");}
 }
 private static void target(String method,String path,String query){
  // This bounded helper currently supports only the evidenced GET/POST shapes.
  require("GET".equals(method)||"POST".equals(method),"METHOD");
  require(path!=null&&path.length()<=4096&&path.startsWith("/")&&!path.startsWith("//"),"PATH");
  raw(path,false,"PATH");
  require(query!=null&&query.length()<=8192,"QUERY");raw(query,true,"QUERY");
 }
 private static void raw(String value,boolean query,String field){
  for(int i=0;i<value.length();i++){
   char c=value.charAt(i);
   if(c=='%'){
    require(i+2<value.length()&&hex(value.charAt(i+1))&&hex(value.charAt(i+2)),field);i+=2;
   }else require(c>='a'&&c<='z'||c>='A'&&c<='Z'||c>='0'&&c<='9'||"-._~!$&'()*+,;=:@/".indexOf(c)>=0||query&&c=='?',field);
  }
 }
 private static boolean hex(char c){return c>='0'&&c<='9'||c>='a'&&c<='f'||c>='A'&&c<='F';}
 private static void utf8(byte[] value,String field){
  try{StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(value));}
  catch(CharacterCodingException invalid){throw new IllegalArgumentException("GATEWAY_SIGNING_"+field+"_INVALID");}
 }
 private static String sha(byte[] bytes){
  try{return Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(bytes));}
  catch(GeneralSecurityException unavailable){throw new IllegalStateException("GATEWAY_SIGNING_CRYPTO_UNAVAILABLE");}
 }
 static String bodyDigest(byte[] exactBodyUtf8){
  require(exactBodyUtf8!=null&&exactBodyUtf8.length<=65536,"BODY");
  byte[] snapshot=exactBodyUtf8.clone();utf8(snapshot,"BODY");return sha(snapshot);
 }
 static String canonical(String method,String rawPath,String rawQuery,String nonce,String timestampSeconds,byte[] exactBodyUtf8){
  target(method,rawPath,rawQuery);require(nonce!=null&&nonce.matches("[a-f0-9]{32}"),"NONCE");timestamp(timestampSeconds);
  // The returned immutable string holds only the digest, never the caller's array.
  return method+"\n"+rawPath+"\n"+rawQuery+"\nxtcl-nonce:"+nonce+";xtcl-timestamp:"+timestampSeconds+";\n"+bodyDigest(exactBodyUtf8);
 }
 static String authorization(String app,byte[] keyUtf8,String timestampSeconds,String canonical){
  require(app!=null&&app.matches("[A-Za-z0-9._-]{1,128}"),"APP");timestamp(timestampSeconds);
  require(canonical!=null&&canonical.length()<=12544,"CANONICAL");
  String[] fields=canonical.split("\n",-1);require(fields.length==5,"CANONICAL");target(fields[0],fields[1],fields[2]);
  require(fields[3].matches("xtcl-nonce:[a-f0-9]{32};xtcl-timestamp:"+timestampSeconds+";"),"CANONICAL");
  require(fields[4].matches("[A-Za-z0-9+/]{43}="),"CANONICAL");
  byte[] digest=Base64.getDecoder().decode(fields[4]);require(digest.length==32&&Base64.getEncoder().encodeToString(digest).equals(fields[4]),"CANONICAL");
  require(keyUtf8!=null&&keyUtf8.length>0&&keyUtf8.length<=4096,"KEY");
  byte[] key=keyUtf8.clone();
  try{
   utf8(key,"KEY");Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key,"HmacSHA256"));
   String value=ALGORITHM+"\n"+timestampSeconds+"\n"+sha(canonical.getBytes(StandardCharsets.UTF_8));
   String signature=Base64.getEncoder().encodeToString(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
   return ALGORITHM+" Credential="+app+",SignedHeaders=xtcl-nonce;xtcl-timestamp;,Signature="+signature;
  }catch(GeneralSecurityException unavailable){throw new IllegalStateException("GATEWAY_SIGNING_CRYPTO_UNAVAILABLE");}
  finally{Arrays.fill(key,(byte)0);}
 }
}
