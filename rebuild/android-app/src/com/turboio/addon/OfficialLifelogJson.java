package com.turboio.addon;
import java.nio.charset.StandardCharsets;import java.util.*;

/** Official response adapter only. Equal duplicate JSON members are redundant;
 * different values are ambiguous and rejected. Task/material wire parsing stays
 * strict. Never choose an arbitrary first/last value from an official response. */
final class OfficialLifelogJson {
 static final class Result {final byte[] canonical;final int identicalDuplicates;Result(Object value,int duplicates){canonical=WireJson.bytes(value);identicalDuplicates=duplicates;}}
 private final String input;private int at,nodes,duplicates;
 private OfficialLifelogJson(byte[] bytes){WireJson.require(bytes!=null&&bytes.length<=1048576,"OFFICIAL_JSON_BUDGET");input=BoundedJson.utf8(bytes);}
 static Result read(byte[] bytes){OfficialLifelogJson parser=new OfficialLifelogJson(bytes);Object value=parser.value(0);parser.space();WireJson.require(parser.at==parser.input.length(),"OFFICIAL_JSON_TRAILING");return new Result(value,parser.duplicates);}
 private void space(){while(at<input.length()&&" \r\n\t".indexOf(input.charAt(at))>=0)at++;}
 private char next(){WireJson.require(at<input.length(),"OFFICIAL_JSON_INCOMPLETE");return input.charAt(at++);}
 private String string(){int start=at;WireJson.require(next()=='"',"OFFICIAL_JSON_KEY");boolean escaped=false;while(true){char c=next();if(!escaped&&c=='"')break;if(!escaped&&c=='\\')escaped=true;else escaped=false;}return (String)WireJson.read(input.substring(start,at).getBytes(StandardCharsets.UTF_8));}
 private Object value(int depth){WireJson.require(depth<=32&&++nodes<=100000,"OFFICIAL_JSON_BUDGET");space();WireJson.require(at<input.length(),"OFFICIAL_JSON_INCOMPLETE");char c=input.charAt(at);
  if(c=='"')return string();
  if(c=='{'){at++;Map<String,Object> result=new TreeMap<>();space();if(at<input.length()&&input.charAt(at)=='}'){at++;return result;}while(true){space();String key=string();space();WireJson.require(next()==':',"OFFICIAL_JSON_COLON");Object value=value(depth+1);if(result.containsKey(key)){WireJson.require(Objects.equals(result.get(key),value),"OFFICIAL_DUPLICATE_CONFLICT");duplicates++;}else result.put(key,value);space();c=next();if(c=='}')return result;WireJson.require(c==',',"OFFICIAL_JSON_OBJECT");}}
  if(c=='['){at++;List<Object> result=new ArrayList<>();space();if(at<input.length()&&input.charAt(at)==']'){at++;return result;}while(true){result.add(value(depth+1));space();c=next();if(c==']')return result;WireJson.require(c==',',"OFFICIAL_JSON_ARRAY");}}
  int start=at;while(at<input.length()&&",]} \r\n\t".indexOf(input.charAt(at))<0)at++;WireJson.require(at>start,"OFFICIAL_JSON_VALUE");return WireJson.read(input.substring(start,at).getBytes(StandardCharsets.UTF_8));
 }
}
