package com.turboio.androidtests;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Synthetic local byte fixtures only; no Android, files, tokens or network. */
final class GatewayHeaderShapeParserTest {
 private static final String URL="https://xr-api-p.rayneo.cn/lifelog/api/v1/calendar?#";
 private static final String NONCE="0123456789abcdef0123456789abcdef",APP="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
 private static final String AUTH="TCL1-HMAC-SHA256 Credential="+APP+",SignedHeaders=xtcl-nonce;xtcl-timestamp;,Signature=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
 private static final String HEADERS="{\"xtcl-nonce\":\""+NONCE+"\",\"xtcl-timestamp\":\"1792576800\",\"xtcl-app\":\""+APP+"\",\"xtcl-authorization\":\""+AUTH+"\",\"xtcl-access-token\":\"synthetic-secret-do-not-decode\"}";
 private static final String BODY="{\"startYearMonth\":202610,\"endYearMonth\":202610}";
 private static int checks;
 private static void yes(boolean ok){checks++;if(!ok)throw new AssertionError("header shape check "+checks);}
 private static byte[] bytes(String text){return text.getBytes(StandardCharsets.UTF_8);}
 private static Map<String,Object> parse(String kind,String payload)throws Exception{return GatewayHeaderShapeParser.parse(bytes("prefix [Interceptor.Http] → [POST "+URL+"] "+kind+": "+payload));}
 private static boolean flag(Map<String,Object> row,String key){return Boolean.TRUE.equals(row.get(key));}
 private static Map<?,?> fields(Map<String,Object> row){return (Map<?,?>)row.get("fields");}
 private static void safe(Map<String,Object> row){String text=String.valueOf(row);yes(!text.contains(NONCE)&&!text.contains(APP)&&!text.contains(AUTH)&&!text.contains("synthetic-secret-do-not-decode")&&!text.contains("202610"));}
 public static void main(String[] args)throws Exception{
  Map<String,Object> headers=parse("headers",HEADERS);yes("json_object".equals(headers.get("format")));yes(flag(headers,"all_four_signing_fields_legal"));yes(((Number)headers.get("other_field_count")).intValue()==1);yes(!flag(headers,"request_pairing_id_verified"));safe(headers);
  Map<String,Object> body=parse("req body",BODY);yes(flag(body,"exact_two_month_fields"));yes(((Number)body.get("raw_utf8_bytes")).intValue()==bytes(BODY).length);yes(((String)body.get("raw_utf8_sha256")).matches("[a-f0-9]{64}"));safe(body);
  Map<String,Object> spaced=parse("req body"," "+BODY+" ");yes(flag(spaced,"exact_two_month_fields"));yes(!body.get("raw_utf8_sha256").equals(spaced.get("raw_utf8_sha256")));yes(((Number)spaced.get("raw_utf8_bytes")).intValue()==bytes(BODY).length+2);
  Map<String,Object> reversed=parse("req body","{\"endYearMonth\":202610,\"startYearMonth\":202610}");yes(flag(reversed,"exact_two_month_fields"));yes(!body.get("raw_utf8_sha256").equals(reversed.get("raw_utf8_sha256")));
  for(String unknown:new String[]{"null","true","-12.5e+2","[1,{\"nested\":\"synthetic-secret-do-not-decode\"}]","{\"nested\":\"中\\n\\u2603\"}","\"escaped \\\" quote\""}){Map<String,Object> row=parse("headers",HEADERS.substring(0,HEADERS.length()-1)+",\"unknown\":"+unknown+"}");yes(flag(row,"all_four_signing_fields_legal"));safe(row);}
  for(String key:new String[]{"xtcl-nonce","xtcl-timestamp","xtcl-app","xtcl-authorization"}){
   Map<String,Object> missing=parse("headers","{}");yes(((Number)missing.get("missing_field_count")).intValue()==4);yes(!flag(missing,"all_four_signing_fields_legal"));
   Map<String,Object> duplicate=parse("headers",HEADERS.substring(0,HEADERS.length()-1)+",\""+key+"\":\"x\"}");yes(((Number)duplicate.get("duplicate_field_count")).intValue()==1);yes(!flag(duplicate,"all_four_signing_fields_legal"));
   Map<?,?> f=(Map<?,?>)fields(duplicate).get(key);yes(((Number)f.get("occurrences")).intValue()==2);yes(Boolean.FALSE.equals(f.get("legal")));
  }
  for(String replacement:new String[]{"\"x\"","123","null","true","[]","{}"}){Map<String,Object> row=parse("headers",HEADERS.replace("\""+NONCE+"\"",replacement));yes(!flag(row,"all_four_signing_fields_legal"));safe(row);}
  for(String time:new String[]{"0","01","-1","9223372036854775808","1792576800\\n"})yes(!flag(parse("headers",HEADERS.replace("1792576800",time)),"all_four_signing_fields_legal"));
  for(String invalid:new String[]{"", "null", "[]", "{xtcl-nonce: value}","{\"x\":}",HEADERS+"{}",HEADERS.substring(0,HEADERS.length()-1),"{\"x\":01}","{\"x\":1.}","{\"x\":1e}","{\"x\":\"\\q\"}","{\"x\":\"unescaped\nnewline\"}"}){Map<String,Object> row=parse("headers",invalid);yes(!flag(row,"all_four_signing_fields_legal"));safe(row);}
  yes("brace_non_json_object".equals(parse("headers","{xtcl-access-token: synthetic-secret-do-not-decode}").get("format")));
  for(String invalid:new String[]{BODY.replace("202610","202613"),BODY.replace("202610","196912"),BODY.replace("202610","202610.0"),BODY.replace("202610","\"202610\""),BODY.replace("202610","true"),BODY.substring(0,BODY.length()-1)+",\"privateText\":\"synthetic-secret-do-not-decode\"}",BODY.substring(0,BODY.length()-1)+",\"startYearMonth\":202610}","{}","{\"startYearMonth\":202610}"}){Map<String,Object> row=parse("req body",invalid);yes(!flag(row,"exact_two_month_fields"));yes(!row.containsKey("raw_utf8_sha256"));safe(row);}
  for(String url:new String[]{"http://xr-api-p.rayneo.cn/lifelog/api/v1/calendar","https://other.example/lifelog/api/v1/calendar","https://xr-api-p.rayneo.cn:444/lifelog/api/v1/calendar","https://user@xr-api-p.rayneo.cn/lifelog/api/v1/calendar","https://xr-api-p.rayneo.cn/lifelog/api/v1/events","https://xr-api-p.rayneo.cn/lifelog/api/v1/calendar?q=1","https://xr-api-p.rayneo.cn/lifelog/api/v1/calendar#id"})yes(GatewayHeaderShapeParser.parse(bytes("[Interceptor.Http] → [POST "+url+"] headers: "+HEADERS))==null);
  for(String prefix:new String[]{"[Interceptor.Http] ← [POST "+URL+"] headers: ","[Interceptor.Http] → [GET "+URL+"] headers: ","[Interceptor.Http] → [POST "+URL+"] response body: ","[Interceptor.Http] → [Interceptor.Http] [POST "+URL+"] headers: "})yes(GatewayHeaderShapeParser.parse(bytes(prefix+HEADERS))==null);
  for(String suffix:new String[]{"","?","#","?#"})yes(flag(GatewayHeaderShapeParser.parse(bytes("[Interceptor.Http] → [POST https://xr-api-p.rayneo.cn/lifelog/api/v1/calendar"+suffix+"] headers: "+HEADERS)),"all_four_signing_fields_legal"));
  for(String suffix:new String[]{"","?","#","?#"})yes(flag(GatewayHeaderShapeParser.parse(bytes("[Interceptor.Http] → [POST https://xr-api-p.rayneo.cn:443/lifelog/api/v1/calendar"+suffix+"] headers: "+HEADERS)),"all_four_signing_fields_legal"));
  // Rejected URLs must be eliminated as bytes before any URL String decoding.
  for(String url:new String[]{"https://synthetic-secret-do-not-decode@xr-api-p.rayneo.cn/lifelog/api/v1/calendar","https://xr-api-p.rayneo.cn/lifelog/api/v1/calendar?token=synthetic-secret-do-not-decode","https://xr-api-p.rayneo.cn/lifelog/api/v1/calendar#synthetic-secret-do-not-decode","https://xr-api-p.rayneo.cn/lifelog/api/v1/calendar?%74oken=synthetic-secret-do-not-decode","https://xr-api-p.rayneo.cn:0443/lifelog/api/v1/calendar"})yes(GatewayHeaderShapeParser.parse(bytes("[Interceptor.Http] → [POST "+url+"] headers: "+HEADERS))==null);
  for(String url:new String[]{"https://XX@xr-api-p.rayneo.cn/lifelog/api/v1/calendar","https://xr-api-p.rayneo.cn/lifelog/api/v1/calendar?token=XX"}){byte[] rejected=bytes("[Interceptor.Http] → [POST "+url+"] headers: "+HEADERS);for(int i=0;i<rejected.length-1;i++)if(rejected[i]=='X'&&rejected[i+1]=='X'){rejected[i]=(byte)0xc0;rejected[i+1]=(byte)0xaf;break;}yes(GatewayHeaderShapeParser.parse(rejected)==null);}
  byte[] invalidUtf8=bytes("[Interceptor.Http] → [POST "+URL+"] headers: {\"unknown\":\"XX\"}");for(int i=0;i<invalidUtf8.length-1;i++)if(invalidUtf8[i]=='X'&&invalidUtf8[i+1]=='X'){invalidUtf8[i]=(byte)0xc0;invalidUtf8[i+1]=(byte)0xaf;break;}yes("json_object_invalid_or_unsupported".equals(GatewayHeaderShapeParser.parse(invalidUtf8).get("format")));
  yes(GatewayHeaderShapeParser.parse(null)==null);yes(GatewayHeaderShapeParser.parse(new byte[1048577])==null);
  yes(!flag(parse("headers",new String(new char[65537]).replace('\0',' ')),"payload_within_budget"));yes(!flag(parse("req body",new String(new char[4097]).replace('\0',' ')),"payload_within_budget"));
  System.out.println("Gateway header shape: "+checks+" synthetic checks passed");
 }
}
