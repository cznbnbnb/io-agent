package com.turboio.androidtests;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.*;

/** Byte-selected calendar log shapes only. Unknown JSON values are skipped, not
 * decoded into Strings; only the four signing fields may be decoded transiently.
 * No request pairing or signing is attempted. */
final class GatewayHeaderShapeParser {
 private static final String[] NAMES={"xtcl-nonce","xtcl-timestamp","xtcl-app","xtcl-authorization"};
 private static final byte[] TAG=ascii("[Interceptor.Http]"),HEAD=ascii("] headers: "),BODY=ascii("] req body: "),RESP=ascii("] response body: ");
 private static final byte[] POST=ascii("[POST "),RIGHT="→".getBytes(StandardCharsets.UTF_8),LEFT="←".getBytes(StandardCharsets.UTF_8),PLAIN_PREFIX="[Interceptor.Http] → [POST ".getBytes(StandardCharsets.UTF_8);
 private static final List<byte[]> URLS=urls();
 private GatewayHeaderShapeParser(){}
 private static byte[] ascii(String s){return s.getBytes(StandardCharsets.US_ASCII);}
 private static List<byte[]> urls(){List<byte[]> result=new ArrayList<>();for(String port:new String[]{"",":443"})for(String suffix:new String[]{"","?","#","?#"})result.add(ascii("https://xr-api-p.rayneo.cn"+port+"/lifelog/api/v1/calendar"+suffix));return Collections.unmodifiableList(result);}
 private static boolean equal(byte[] b,int start,int end,byte[] expected){if(end-start!=expected.length)return false;for(int i=0;i<expected.length;i++)if(b[start+i]!=expected[i])return false;return true;}
 private static int find(byte[] b,int from,byte[] pattern){outer:for(int i=from;i<=b.length-pattern.length;i++){for(int j=0;j<pattern.length;j++)if(b[i+j]!=pattern[j])continue outer;return i;}return -1;}
 private static void check(boolean ok){if(!ok)throw new IllegalArgumentException("HEADER_SHAPE_UNSUPPORTED");}
 static Map<String,Object> parse(byte[] line)throws Exception{
  if(line==null||line.length>1048576)return null;int tag=find(line,0,TAG);if(tag<0)return null;
  int h=find(line,tag+TAG.length,HEAD),b=find(line,tag+TAG.length,BODY),r=find(line,tag+TAG.length,RESP);
  int mark=h<0?b:b<0?h:Math.min(h,b);if(mark<0||r>=0&&r<mark)return null;
  boolean headers=mark==h;int start=mark+(headers?HEAD.length:BODY.length);
  if(start-tag>4096)return null;int other=find(line,tag+TAG.length,TAG);if(other>=0&&other<start)return null;
  // Route admission is entirely byte-based. In particular, never create a
  // String/URI from a rejected URL's userinfo, query, fragment or other path.
  int post=find(line,tag+TAG.length,POST),right=find(line,tag+TAG.length,RIGHT),left=find(line,tag+TAG.length,LEFT);
  if(post<0||post>=mark||right<0||right>=post||left>=0&&left<start)return null;
  int secondPost=find(line,post+POST.length,POST);if(secondPost>=0&&secondPost<mark)return null;
  boolean admitted=false;for(byte[] allowed:URLS)if(equal(line,post+POST.length,mark,allowed)){admitted=true;break;}if(!admitted)return null;
  Map<String,Object> out=new LinkedHashMap<>();out.put("record",headers?"headers":"request_body");out.put("request_pairing_id_verified",false);out.put("pairing_performed",false);
  out.put("prefix_has_extra_decoration",!equal(line,tag,post+POST.length,PLAIN_PREFIX));
  int length=line.length-start;out.put("payload_within_budget",length<=(headers?65536:4096));if(length>(headers?65536:4096))return out;
  Json scan=new Json(line,start);scan.space();int first=scan.at;String shape=first==line.length?"empty":line[first]=='{'?"object_candidate":line[first]=='['?"array":line[first]=='"'?"quoted_string":"other";
  if(first<line.length&&line[first]=='{'){int p=first+1;while(p<line.length&&Json.ws(line[p]))p++;if(p<line.length&&line[p]!='"'&&line[p]!='}')shape="brace_non_json_object";}
  out.put("format",shape);if(!shape.equals("object_candidate"))return out;
  try{
   scan.at++;Map<String,Field> known=new LinkedHashMap<>();Set<String> keys=new HashSet<>();int duplicate=0,unknown=0,total=0;
   scan.space();if(scan.peek()!='}')while(true){String name=scan.string(true);check(name.length()<=256);scan.space();check(scan.take()==':');scan.space();int at=scan.at;String type=scan.kind();boolean allowed=headers?Arrays.asList(NAMES).contains(name):name.equals("startYearMonth")||name.equals("endYearMonth");
    String text=null;boolean legal=false;
    if(allowed&&headers&&scan.peek()=='"'){text=scan.string(true);legal=valid(name,text);}
    else{scan.value(0);if(allowed&&!headers&&type.equals("number")){int n=scan.at-at;legal=n==6;int number=0;if(legal)for(int i=at;i<scan.at;i++){int d=line[i]-'0';if(d<0||d>9){legal=false;break;}number=number*10+d;}legal=legal&&number>=197001&&number<=999912&&number%100>=1&&number%100<=12;}}
    if(!keys.add(name))duplicate++;if(allowed){Field f=known.get(name);if(f==null)known.put(name,new Field(type,legal));else{f.count++;f.legal=false;}}else unknown++;total++;check(total<=256);
    scan.space();int delimiter=scan.take();if(delimiter=='}')break;check(delimiter==',');scan.space();
   }else scan.at++;
   scan.space();check(scan.at==line.length);out.put("format","json_object");out.put("duplicate_field_count",duplicate);out.put("other_field_count",unknown);
   Map<String,Object> fields=new LinkedHashMap<>();int missing=0;for(String name:headers?NAMES:new String[]{"startYearMonth","endYearMonth"}){Field f=known.get(name);Map<String,Object> shapeField=new LinkedHashMap<>();shapeField.put("present",f!=null);shapeField.put("occurrences",f==null?0:f.count);shapeField.put("type",f==null?"missing":f.type);shapeField.put("legal",f!=null&&f.legal&&f.count==1);fields.put(name,shapeField);if(f==null)missing++;}
   out.put("fields",fields);out.put("missing_field_count",missing);
   boolean valid=missing==0&&duplicate==0;for(Field f:known.values())valid&=f.legal&&f.count==1;
   if(headers)out.put("all_four_signing_fields_legal",valid);
   else{valid&=unknown==0&&total==2;out.put("exact_two_month_fields",valid);if(valid){out.put("raw_utf8_bytes",length);MessageDigest hash=MessageDigest.getInstance("SHA-256");hash.update(line,start,length);StringBuilder hex=new StringBuilder();for(byte v:hash.digest())hex.append(String.format(Locale.ROOT,"%02x",v&255));out.put("raw_utf8_sha256",hex.toString());}}
  }catch(IllegalArgumentException unsupported){out.clear();out.put("record",headers?"headers":"request_body");out.put("format","json_object_invalid_or_unsupported");out.put("request_pairing_id_verified",false);out.put("pairing_performed",false);}
  return out;
 }
 private static final class Field{final String type;boolean legal;int count=1;Field(String type,boolean legal){this.type=type;this.legal=legal;}}
 private static boolean valid(String key,String value){
  if(key.equals("xtcl-nonce"))return value.matches("[a-f0-9]{32}");
  if(key.equals("xtcl-timestamp")){if(!value.matches("[1-9][0-9]{0,18}"))return false;try{return Long.parseLong(value)>0;}catch(NumberFormatException bad){return false;}}
  if(key.equals("xtcl-app"))return value.matches("[!-~]{32}");
  Matcher m=Pattern.compile("TCL1-HMAC-SHA256 Credential=([!-~]{32}),SignedHeaders=xtcl-nonce;xtcl-timestamp;,Signature=([A-Za-z0-9+/]{43}=)").matcher(value);
  if(!m.matches())return false;try{return Base64.getEncoder().encodeToString(Base64.getDecoder().decode(m.group(2))).equals(m.group(2));}catch(IllegalArgumentException bad){return false;}
 }
 /** Validates JSON syntax and UTF-8 while avoiding Strings for skipped values. */
 private static final class Json{
  final byte[] b;int at,nodes;Json(byte[] b,int at){this.b=b;this.at=at;}
  static boolean ws(byte c){return c==32||c==9||c==13||c==10;}
  void space(){while(at<b.length&&ws(b[at]))at++;}
  int peek(){check(at<b.length);return b[at]&255;}int take(){int c=peek();at++;return c;}
  String kind(){int c=peek();return c=='"'?"string":c=='{'?"object":c=='['?"array":c=='t'||c=='f'?"boolean":c=='n'?"null":c=='-'||c>='0'&&c<='9'?"number":"invalid";}
  String string(boolean capture){check(take()=='"');StringBuilder text=capture?new StringBuilder():null;int count=0;while(true){check(++count<=65536);int c=take();if(c=='"')return capture?text.toString():null;check(c>=32);if(c=='\\'){c=take();if(c=='u'){int value=0;for(int i=0;i<4;i++){int d=Character.digit((char)take(),16);check(d>=0);value=value*16+d;}if(capture)text.append((char)value);continue;}check("\"\\/bfnrt".indexOf(c)>=0);if(capture)text.append(c=='b'?'\b':c=='f'?'\f':c=='n'?'\n':c=='r'?'\r':c=='t'?'\t':(char)c);continue;}
   if(c<128){if(capture)text.append((char)c);continue;}int needed=c>=0xc2&&c<=0xdf?1:c>=0xe0&&c<=0xef?2:c>=0xf0&&c<=0xf4?3:-1;check(needed>0);int code=c&((1<<(6-needed))-1);for(int i=0;i<needed;i++){int next=take();check((next&0xc0)==0x80);code=code*64+(next&63);}check(code>=(needed==1?0x80:needed==2?0x800:0x10000)&&code<=0x10ffff&&(code<0xd800||code>0xdfff));if(capture)text.appendCodePoint(code);
  }}
  void literal(String s){for(int i=0;i<s.length();i++)check(take()==s.charAt(i));}
  void value(int depth){check(depth<=16&&++nodes<=4096);space();int c=peek();if(c=='"'){string(false);return;}if(c=='{'||c=='['){at++;space();if(peek()==(c=='{'?'}':']')){at++;return;}while(true){if(c=='{'){string(false);space();check(take()==':');}value(depth+1);space();int delimiter=take();if(delimiter==(c=='{'?'}':']'))return;check(delimiter==',');space();}}
   if(c=='t'){literal("true");return;}if(c=='f'){literal("false");return;}if(c=='n'){literal("null");return;}int start=at;if(c=='-')at++;check(at<b.length);if(b[at]=='0')at++;else{check(b[at]>='1'&&b[at]<='9');while(at<b.length&&b[at]>='0'&&b[at]<='9')at++;}if(at<b.length&&b[at]=='.'){at++;int digits=at;while(at<b.length&&b[at]>='0'&&b[at]<='9')at++;check(at>digits);}if(at<b.length&&(b[at]=='e'||b[at]=='E')){at++;if(at<b.length&&(b[at]=='+'||b[at]=='-'))at++;int digits=at;while(at<b.length&&b[at]>='0'&&b[at]<='9')at++;check(at>digits);}check(at>start);
  }
 }
}
