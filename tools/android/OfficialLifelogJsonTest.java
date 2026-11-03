package com.turboio.addon;
import java.nio.charset.StandardCharsets;import java.util.*;
public final class OfficialLifelogJsonTest {
 static int checks;static void yes(boolean b){checks++;if(!b)throw new AssertionError("Official JSON "+checks);}static byte[] bytes(String s){return s.getBytes(StandardCharsets.UTF_8);}interface Work{void run();}static void reject(Work w){checks++;try{w.run();}catch(IllegalArgumentException ok){return;}throw new AssertionError("Expected JSON rejection");}
 public static void main(String[] args){
  OfficialLifelogJson.Result r=OfficialLifelogJson.read(bytes("{\"id\":1,\"id\":1,\"data\":{\"text\":\"保留\\n全部 😀\",\"text\":\"保留\\n全部 😀\"}}"));yes(r.identicalDuplicates==2);yes(WireJson.map(WireJson.map(WireJson.read(r.canonical)).get("data")).get("text").equals("保留\n全部 😀"));
  r=OfficialLifelogJson.read(bytes("{\"x\":null,\"x\":null,\"obj\":{\"a\":1,\"b\":2},\"obj\":{\"b\":2,\"a\":1}}"));yes(r.identicalDuplicates==2);yes(WireJson.map(WireJson.read(r.canonical)).containsKey("x"));
  r=OfficialLifelogJson.read(bytes("{\"id\":\"v\",\"\\u0069d\":\"v\",\"list\":[true,false,1.25,\"\\\"\\\\\"]}"));yes(r.identicalDuplicates==1);
  for(String s:Arrays.asList("{\"code\":0,\"code\":1}","{\"text\":\"a\",\"text\":\"b\"}","{\"x\":null,\"x\":0}","{\"x\":[1,2],\"x\":[2,1]}","{\"x\":{\"y\":1},\"x\":{\"y\":2}}","{\"x\":1,}","[1,]","{\"x\":\"bad\nline\"}","{\"x\":\"\\uD800\"}","true false","[+1]","[01]","{\"x\":\"unfinished"))reject(()->OfficialLifelogJson.read(bytes(s)));
  reject(()->OfficialLifelogJson.read(new byte[]{(byte)255}));reject(()->OfficialLifelogJson.read(new byte[1048577]));reject(()->OfficialLifelogJson.read(bytes(String.join("",Collections.nCopies(34,"["))+"0"+String.join("",Collections.nCopies(34,"]")))));
  String part=String.join("",Collections.nCopies(600000,"a"));byte[] large=WireJson.bytes(Arrays.asList(part,part));reject(()->OfficialLifelogJson.read(large));yes(Arrays.equals(large,OfficialLifelogJson.read(large,OfficialLifelogJson.MAX_EVENT_BYTES).canonical));reject(()->OfficialLifelogJson.read(new byte[4194305],OfficialLifelogJson.MAX_EVENT_BYTES));
  // The task/material wire parser still rejects even identical duplicates.
  reject(()->WireJson.read(bytes("{\"x\":1,\"x\":1}")));
  byte[] fixture=WireJson.bytes(OfficialLifelogSnapshotTest.fixture());yes(Arrays.equals(fixture,OfficialLifelogJson.read(fixture).canonical));
  System.out.println("Official lifelog JSON: "+checks+" assertions passed");
 }
}
