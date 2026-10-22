package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;

/** Fixed expectations generated independently with Python 3 hashlib/hmac/base64.
 * Five GET request shapes are those verified by GatewayCanonicalProbe; times,
 * nonces and keys here are synthetic, not captured host credentials/signatures.
 * POST expectations test the migrated algorithm, not current Dart equivalence. */
final class OfficialGatewaySigningTest {
 private static final String NONCE="0123456789abcdef0123456789abcdef",TIME="1792576800",APP="synthetic-app",KEY="synthetic-only-key-20261021";
 private static final String JSON="{\"startYearMonth\":202610,\"endYearMonth\":202610}";
 private static final String[] TARGETS={"/synthetic/canonical","/synthetic/canonical?","/synthetic/canonical?b=2&a=1","/synthetic/canonical?q=%E4%B8%AD&repeat=1&repeat=2","/synthetic/canonical?q=a%20b&x=%2F","/lifelog/api/v1/calendar","/synthetic/canonical","/synthetic/canonical?a=1&b=2","/lifelog/api/v1/calendar"};
 private static final String[] BODIES={"","","","","",JSON,"{\"text\":\"中文 😀\"}","","{\"startYearMonth\":202610,\"endYearMonth\":202611}"};
 private static final String[][] EXPECTED={
  {"47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=","AyPf9x3jAHwHm6+x9loszxltwsEjJJx8H5pWNohlC6s=","srZ1xAkVh96ryDbkEmTASwP/yNfuLPrljJou53Md1MM="},
  {"47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=","AyPf9x3jAHwHm6+x9loszxltwsEjJJx8H5pWNohlC6s=","srZ1xAkVh96ryDbkEmTASwP/yNfuLPrljJou53Md1MM="},
  {"47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=","hTAwqmzgzaKJqts6qaVKAFkQKOZCSZqRN8FlG3fZ/zY=","FWUHTgKQ3qkzpxcpoO0dCzNJb+th65cXbPf8qftkjyk="},
  {"47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=","qfY7N3uP4JjhfRU30aaaX/cSXYLimW38E5bfzBzPnGg=","lwapsS+EGYHfP0Ez+6mNIHgZg+e9kjvmiW2wkJh5SI4="},
  {"47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=","1VAo+nf9mcaJMEC7muMBsyBDvOLGjMDw0xIynneRAFw=","N0wBZqhhFxotZi1BQbJJV1j4Tm9qa80rAfkQKdBsPxg="},
  {"P151/44IfOb9e3gUsfbhKL+Y720UO3WuSosKdiDh32Y=","gJYE/COO/res3VHy808jTp1Yl/O4lH2uP48Ta09ZYc4=","Nd230syfUrOrm97FkPPw/uqcIWQNXcloZ307dVN7eqc="},
  {"IhmOY7csqRRG+WkrBYdck1gqH6zNVqNu6xpGHeKcJL4=","wra4aOyPzT8/5XvDJREtWCu/YDovRqRx3cS0mxCGWPc=","poVgZwGMX1Z68xpb9m48Qy/iHbZtgaaLtYSshflWzCU="},
  {"47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=","pezEOz9yqLbfeMBM5X4BCTdDXLtfvvuAmM3wViDZGBs=","f7qg3OQRDKLCx7BimQw2wVnJqkWuMeMd3JutwZp4oho="},
  {"gSK7JGMN8fpTIex2QyPoQ+eaZ/R7eS8cne6aog606Fg=","Un0FhxF7Hx+K72eHgvIughHoAIvmNIsCrU5VYy+lcHc=","A/zEFUnOUv1AydQE4lgNg4/HQIxGoLYHBgkYNREmwDE="}
 };
 private static int checks;
 private static byte[] bytes(String s){return s.getBytes(StandardCharsets.UTF_8);}
 private static void yes(boolean ok){checks++;if(!ok)throw new AssertionError("gateway signing check "+checks);}
 private static void rejects(Runnable action){try{action.run();throw new AssertionError("invalid signing input accepted");}catch(IllegalArgumentException expected){yes(expected.getMessage().matches("GATEWAY_SIGNING_[A-Z_]+")&&expected.getCause()==null);}}
 private static String canonical(String method,String path,String query,String nonce,String time,byte[] body){return OfficialGatewaySigning.canonical(method,path,query,nonce,time,body);}
 private static String sign(String c){return OfficialGatewaySigning.authorization(APP,bytes(KEY),TIME,c);}
 public static void main(String[] args)throws Exception{
  String[] canonicals=new String[TARGETS.length],signatures=new String[TARGETS.length];
  for(int i=0;i<TARGETS.length;i++){
   int q=TARGETS[i].indexOf('?');String path=q<0?TARGETS[i]:TARGETS[i].substring(0,q),query=q<0?"":TARGETS[i].substring(q+1);
   byte[] body=bytes(BODIES[i]);String method=i==5||i==6||i==8?"POST":"GET";
   String c=canonical(method,path,query,NONCE,TIME,body),s=sign(c);canonicals[i]=c;signatures[i]=s;
   yes(OfficialGatewaySigning.bodyDigest(body).equals(EXPECTED[i][0]));
   yes(Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(bytes(c))).equals(EXPECTED[i][1]));
   yes(s.equals("TCL1-HMAC-SHA256 Credential="+APP+",SignedHeaders=xtcl-nonce;xtcl-timestamp;,Signature="+EXPECTED[i][2]));
   yes(!s.contains(KEY)&&!c.contains(KEY));
  }
  yes(canonicals[0].equals(canonicals[1]));yes(!canonicals[2].equals(canonicals[7]));yes(!signatures[2].equals(signatures[7]));
  yes(!canonicals[5].equals(canonicals[8]));yes(!signatures[5].equals(signatures[8]));
  byte[] owned=bytes(JSON);String before=canonical("POST",TARGETS[5],"",NONCE,TIME,owned);String signed=sign(before);owned[owned.length-2]='1';
  yes(before.equals(canonicals[5]));yes(signed.equals(signatures[5]));yes(canonical("POST",TARGETS[5],"",NONCE,TIME,owned).equals(canonicals[8]));
  yes(!OfficialGatewaySigning.bodyDigest(bytes(JSON)).equals(OfficialGatewaySigning.bodyDigest(owned)));
  byte[] key=bytes(KEY);yes(OfficialGatewaySigning.authorization(APP,key,TIME,before).equals(signed));yes(Arrays.equals(key,bytes(KEY)));Arrays.fill(key,(byte)'x');yes(signed.equals(signatures[5]));
  for(String bad:new String[]{null,"","get","DELETE","GET\nPOST","GET\r","GET ","ＧＥＴ"})rejects(()->canonical(bad,"/x","",NONCE,TIME,new byte[0]));
  for(String bad:new String[]{null,"","x","//other/x","https://other/x","/x?y=z","/x#fragment","/x\nGET","/x\r","/x\\y","/a b","/中文","/%","/%gg"})rejects(()->canonical("GET",bad,"",NONCE,TIME,new byte[0]));
  for(String bad:new String[]{null,"a=1\nPOST","a=1\r","a=1#fragment","a= ","a=\\","a=中文","a=%","a=%GG","a=\u0000"})rejects(()->canonical("GET","/x",bad,NONCE,TIME,new byte[0]));
  for(String bad:new String[]{null,"",NONCE.substring(1),NONCE+"a",NONCE.toUpperCase(),NONCE+"\n"})rejects(()->canonical("GET","/x","",bad,TIME,new byte[0]));
  for(String bad:new String[]{null,"","0","-1","+1","01","1.0","1e3","1792576800000000000000","9223372036854775808","1\n"," 1"}){
   rejects(()->canonical("GET","/x","",NONCE,bad,new byte[0]));rejects(()->OfficialGatewaySigning.authorization(APP,bytes(KEY),bad,before));
  }
  rejects(()->OfficialGatewaySigning.bodyDigest(null));rejects(()->OfficialGatewaySigning.bodyDigest(new byte[65537]));
  rejects(()->OfficialGatewaySigning.bodyDigest(new byte[]{(byte)0xc3,(byte)0x28}));
  byte[] maxBody=new byte[65536];Arrays.fill(maxBody,(byte)'a');yes(OfficialGatewaySigning.bodyDigest(maxBody).length()==44);
  yes(canonical("GET","/x","",NONCE,"9223372036854775807",new byte[0]).contains("9223372036854775807"));
  yes(canonical("GET","/x","",NONCE,"1",new byte[0]).contains("xtcl-timestamp:1;"));
  rejects(()->canonical("GET","/"+new String(new char[4096]).replace('\0','a'),"",NONCE,TIME,new byte[0]));
  rejects(()->canonical("GET","/x",new String(new char[8193]).replace('\0','a'),NONCE,TIME,new byte[0]));
  for(String bad:new String[]{null,"","app,Signature=x","app\r\nHeader:x","app;","中文"})rejects(()->OfficialGatewaySigning.authorization(bad,bytes(KEY),TIME,before));
  for(byte[] bad:new byte[][]{null,new byte[0],new byte[4097],new byte[]{(byte)0xc3,(byte)0x28}})rejects(()->OfficialGatewaySigning.authorization(APP,bad,TIME,before));
  for(String bad:new String[]{null,"",before+"\n",before.replace(TIME,"1792576801"),before.replace("POST\n","POST\r\n"),before.replace("xtcl-nonce:","other:"),before.substring(0,before.length()-1),before.replace(EXPECTED[5][0],"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB=")})rejects(()->sign(bad));
  System.out.println("Gateway signing: "+checks+" checks passed; 9 Python fixed vectors");
 }
}
