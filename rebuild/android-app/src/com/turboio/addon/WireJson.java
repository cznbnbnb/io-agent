package com.turboio.addon;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Strict bounded JSON for task/material documents. No Android or host classes. */
final class WireJson {
 private final String input;private int at,nodes;private final int maxNodes;
 private WireJson(String input,int nodes){this.input=input;maxNodes=nodes;}
 static Object read(byte[] data){return read(data,1048576,100000);}
 static Object read(byte[] data,int maxBytes,int maxNodes){
  require(data!=null&&data.length<=maxBytes,"WIRE_BUDGET");
  WireJson parser=new WireJson(BoundedJson.utf8(data),maxNodes);Object result=parser.value(0);parser.space();require(parser.at==parser.input.length(),"WIRE_TRAILING");return result;
 }
 static Object copy(Object value){return read(bytes(value),8388608,500000);}
 static byte[] bytes(Object value){StringBuilder out=new StringBuilder();write(value,out,0);return out.toString().getBytes(StandardCharsets.UTF_8);}
 private void space(){while(at<input.length()&&" \r\n\t".indexOf(input.charAt(at))>=0)at++;}
 private char next(){require(at<input.length(),"WIRE_INCOMPLETE");return input.charAt(at++);}
 private Object value(int depth){
  require(depth<=32&&++nodes<=maxNodes,"WIRE_COMPLEXITY");space();char c=next();
  if(c=='"')return string();
  if(c=='{'){
   Map<String,Object> out=new TreeMap<>();space();if(at<input.length()&&input.charAt(at)=='}'){at++;return out;}
   while(true){space();require(next()=='"',"WIRE_KEY");String key=string();require(!out.containsKey(key),"WIRE_DUPLICATE");space();require(next()==':',"WIRE_COLON");out.put(key,value(depth+1));space();c=next();if(c=='}')return out;require(c==',',"WIRE_OBJECT");}
  }
  if(c=='['){List<Object> out=new ArrayList<>();space();if(at<input.length()&&input.charAt(at)==']'){at++;return out;}while(true){out.add(value(depth+1));space();c=next();if(c==']')return out;require(c==',',"WIRE_ARRAY");}}
  for(String literal:new String[]{"true","false","null"})if(c==literal.charAt(0)&&input.startsWith(literal.substring(1),at)){at+=literal.length()-1;return literal.equals("null")?null:Boolean.valueOf(literal);}
  if(c=='-'||(c>='0'&&c<='9')){
   int begin=at-1;while(at<input.length()&&"0123456789.eE+-".indexOf(input.charAt(at))>=0)at++;
   String number=input.substring(begin,at);require(number.length()<=128&&number.matches("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?"),"WIRE_NUMBER");
   try{if(number.matches("-?(0|[1-9][0-9]*)"))return Long.valueOf(number);BigDecimal n=new BigDecimal(number);require(n.scale()>=-1000&&n.scale()<=1000,"WIRE_NUMBER");return n;}catch(NumberFormatException error){throw new IllegalArgumentException("WIRE_NUMBER");}
  }
  throw new IllegalArgumentException("WIRE_VALUE");
 }
 private String string(){
  StringBuilder out=new StringBuilder();
  while(true){char c=next();if(c=='"')break;require(c>=32,"WIRE_CONTROL");if(c=='\\'){
   c=next();switch(c){case '"':case '\\':case '/':break;case 'b':c='\b';break;case 'f':c='\f';break;case 'n':c='\n';break;case 'r':c='\r';break;case 't':c='\t';break;case 'u':int n=0;for(int i=0;i<4;i++){int digit=Character.digit(next(),16);require(digit>=0,"WIRE_ESCAPE");n=n*16+digit;}c=(char)n;break;default:throw new IllegalArgumentException("WIRE_ESCAPE");}
  }out.append(c);}
  String result=out.toString();unicode(result);return result;
 }
 private static void unicode(String value){for(int i=0;i<value.length();i++){char c=value.charAt(i);if(Character.isHighSurrogate(c))require(++i<value.length()&&Character.isLowSurrogate(value.charAt(i)),"WIRE_SURROGATE");else require(!Character.isLowSurrogate(c),"WIRE_SURROGATE");}}
 private static void quote(String value,StringBuilder out){
  unicode(value);out.append('"');for(int i=0;i<value.length();i++){char c=value.charAt(i);switch(c){case '"':out.append("\\\"");break;case '\\':out.append("\\\\");break;case '\n':out.append("\\n");break;case '\r':out.append("\\r");break;case '\t':out.append("\\t");break;default:if(c<32)out.append(String.format(Locale.ROOT,"\\u%04x",(int)c));else out.append(c);}}out.append('"');
 }
 private static void write(Object value,StringBuilder out,int depth){
  require(depth<=32,"WIRE_COMPLEXITY");
  if(value==null){out.append("null");return;}
  if(value instanceof String){quote((String)value,out);return;}
  if(value instanceof Boolean||value instanceof Long||value instanceof Integer){out.append(value);return;}
  if(value instanceof BigDecimal){out.append(((BigDecimal)value).toString());return;}
  if(value instanceof Map){out.append('{');boolean comma=false;for(String key:new TreeSet<>(map(value).keySet())){if(comma)out.append(',');comma=true;quote(key,out);out.append(':');write(map(value).get(key),out,depth+1);}out.append('}');return;}
  if(value instanceof List){out.append('[');boolean comma=false;for(Object item:list(value)){if(comma)out.append(',');comma=true;write(item,out,depth+1);}out.append(']');return;}
  throw new IllegalArgumentException("WIRE_TYPE");
 }
 @SuppressWarnings("unchecked") static Map<String,Object> map(Object value){require(value instanceof Map,"WIRE_OBJECT_REQUIRED");return (Map<String,Object>)value;}
 @SuppressWarnings("unchecked") static List<Object> list(Object value){require(value instanceof List,"WIRE_ARRAY_REQUIRED");return (List<Object>)value;}
 static Map<String,Object> object(Object...pairs){Map<String,Object> out=new TreeMap<>();for(int i=0;i<pairs.length;i+=2)out.put((String)pairs[i],pairs[i+1]);return out;}
 static void require(boolean condition,String code){if(!condition)throw new IllegalArgumentException(code);}
}
