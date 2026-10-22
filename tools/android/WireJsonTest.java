package com.turboio.addon;
import java.nio.charset.StandardCharsets;import java.util.*;
public final class WireJsonTest {
 static void bad(byte[] bytes){try{WireJson.read(bytes);}catch(IllegalArgumentException expected){return;}throw new AssertionError();}
 public static void main(String[] args){
  for(String json:new String[]{"{\"a\":1,\"\\u0061\":2}","[] trailing","{\"a\":01}","{\"a\":+2}","[1e99999]","[\"\\ud800\"]","[\"\\udc00\"]","[1,]"})bad(json.getBytes(StandardCharsets.UTF_8));
  bad(new byte[]{(byte)0xc0,(byte)0x80});bad(new byte[1048577]);
  Map<String,Object> value=WireJson.object("text","完整条件\n保留。😀","items",Arrays.asList(1L,true,null,""));
  if(!TaskWire.same(value,WireJson.read(WireJson.bytes(value))))throw new AssertionError();
  String large="文".repeat(30000);if(!WireJson.read(WireJson.bytes(Arrays.asList(large))).equals(Arrays.asList(large)))throw new AssertionError();
  System.out.println("Wire JSON: passed (UTF-8, duplicate keys, surrogate pairs, grammar, full text, budgets)");
 }
}
