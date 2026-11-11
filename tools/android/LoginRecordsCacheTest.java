package com.turboio.addon;
import java.util.*;import java.util.concurrent.*;
public final class LoginRecordsCacheTest {
 static int checks;static void yes(boolean b){checks++;if(!b)throw new AssertionError(checks);}
 public static void main(String[] args)throws Exception{
  LoginRecordsCache cache=new LoginRecordsCache();final int[] reads={0};Object store=new Object(),other=new Object();
  LoginRecordsCache.Reader reader=()->{reads[0]++;Map<String,Object> m=new HashMap<>();m.put("n",reads[0]);return m;};
  // Unwatched: never cached.
  yes(cache.get(null,0,reader).get("n").equals(1));yes(cache.get(null,1,reader).get("n").equals(2));yes(reads[0]==2);
  // Watched: one read until the store reports a change.
  Map<?,?> first=cache.get(store,10,reader);yes(first.get("n").equals(3));for(int i=0;i<1000;i++)yes(cache.get(store,10+i,reader)==first);yes(reads[0]==3);
  cache.changed();Map<?,?> second=cache.get(store,2000,reader);yes(second.get("n").equals(4)&&second!=first);yes(cache.get(store,2001,reader)==second&&reads[0]==4);
  // Age bound and clock going backwards force a fresh read.
  yes(cache.get(store,2000+LoginRecordsCache.MAX_AGE_MS-1,reader)==second);yes(cache.get(store,2000+LoginRecordsCache.MAX_AGE_MS,reader).get("n").equals(5));yes(cache.get(store,5,reader).get("n").equals(6));
  // Another store instance, or losing the watch, never serves the previous store's snapshot.
  yes(cache.get(other,6,reader).get("n").equals(7));yes(cache.get(store,7,reader).get("n").equals(8));yes(cache.get(null,8,reader).get("n").equals(9));yes(cache.get(store,9,reader).get("n").equals(10));
  // Unavailable reads and failures are not cached.
  LoginRecordsCache empty=new LoginRecordsCache();final int[] nulls={0};yes(empty.get(store,0,()->{nulls[0]++;return null;})==null);yes(empty.get(store,1,()->{nulls[0]++;return null;})==null&&nulls[0]==2);
  try{empty.get(store,2,()->{throw new java.io.IOException("READ_FAILED");});throw new AssertionError();}catch(java.io.IOException expected){checks++;}
  yes(empty.get(store,3,reader).get("n").equals(11));
  // A change during an in-flight read: that read's value is returned to its caller but not kept.
  LoginRecordsCache racing=new LoginRecordsCache();CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);ExecutorService pool=Executors.newSingleThreadExecutor();
  Future<Map<?,?>> stale=pool.submit(()->racing.get(store,0,()->{entered.countDown();release.await();Map<String,Object> m=new HashMap<>();m.put("n","stale");return m;}));
  yes(entered.await(5,TimeUnit.SECONDS));racing.changed();release.countDown();yes("stale".equals(stale.get(5,TimeUnit.SECONDS).get("n")));pool.shutdown();
  final int[] after={0};yes("fresh".equals(racing.get(store,1,()->{after[0]++;Map<String,Object> m=new HashMap<>();m.put("n","fresh");return m;}).get("n"))&&after[0]==1);
  System.out.println("Login records cache: "+checks+" checks passed");
 }
}
