package com.turboio.addon;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/** Protocol regression for the shared performance hot paths, not a timing test. */
public final class WireHotPathTest {
 private static int checks;
 private static void yes(boolean value){if(!value)throw new AssertionError();checks++;}
 private static Object json(String text){return WireJson.read(text.getBytes(StandardCharsets.UTF_8));}
 private static void rejects(Runnable action){try{action.run();}catch(IllegalArgumentException expected){checks++;return;}throw new AssertionError("Invalid input accepted");}
 public static void main(String[] args)throws Exception{
  yes(json("-0").equals(0L));yes(json("9223372036854775807").equals(Long.MAX_VALUE));yes(json("-9223372036854775808").equals(Long.MIN_VALUE));
  for(String text:Arrays.asList("0.0","-3.25","1e2","1E-3","1e+1000"))yes(json(text).equals(new BigDecimal(text)));
  for(String text:Arrays.asList("01","-01","+1",".1","1.","1e","--1","NaN","1e1001","9223372036854775808","1 2","{\"a\":1,\"a\":2}","\"\\ud800\""))rejects(()->json(text));
  Object nested=json("{\"n\":[1,-2,3.4e2],\"text\":\"中文\\n\"}");yes(TaskWire.same(nested,WireJson.copy(nested)));
  yes(TaskWire.hash(new byte[0]).equals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
  yes(TaskWire.hash("abc".getBytes(StandardCharsets.UTF_8)).equals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
  byte[] all=new byte[256];for(int i=0;i<256;i++)all[i]=(byte)i;yes(TaskWire.hash(all).equals("40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880"));
  for(String time:Arrays.asList("1970-01-01T00:00:00Z","1969-12-31T23:59:59.999999999Z","2024-02-29T10:00:00.123456789Z"))for(int i=0;i<2;i++)yes(TaskConnection.stamp(time)==Instant.parse(time).toEpochMilli());
  for(String time:Arrays.asList("2026-02-29T00:00:00Z","2026-10-20T24:00:00Z","2026-10-20T10:00:60Z","2026-10-20T10:00:00+00:00","2026-10-20T10:00:00.1234567890Z","2026-10-20T10:00:00Z\n"))for(int i=0;i<2;i++)rejects(()->TaskConnection.stamp(time));
  rejects(()->TaskConnection.stamp(null));rejects(()->TaskConnection.stamp(42L));
  ExecutorService workers=Executors.newFixedThreadPool(4);
  try{List<Future<?>> results=new ArrayList<>();for(int t=0;t<4;t++)results.add(workers.submit(()->{for(int i=0;i<2000;i++){long expected=1792404000000L+i*1000L;String text=Instant.ofEpochMilli(expected).toString();if(TaskConnection.stamp(text)!=expected||!json("[1,2.5]").equals(Arrays.asList(1L,new BigDecimal("2.5"))))throw new AssertionError("Concurrent parse changed");}}));for(Future<?> result:results){result.get();checks++;}}finally{workers.shutdownNow();}
  // A conversion cache must not turn an expired connection into an authorized one.
  Map<String,Object> input=TaskConnectionTest.sample();long expiry=TaskConnection.stamp(input.get("expires_at"));TaskConnection.parse(WireJson.bytes(input),expiry-1);rejects(()->TaskConnection.parse(WireJson.bytes(input),expiry));
  System.out.println("Wire hot paths: "+checks+" assertions plus 8,000 concurrent cases passed");
 }
}
