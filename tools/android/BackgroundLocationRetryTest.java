package com.turboio.addon;

public final class BackgroundLocationRetryTest {
 private static int checks;
 private static void check(boolean value){if(!value)throw new AssertionError("check "+checks);checks++;}
 public static void main(String[] args){
  BackgroundLocationRetry retry=new BackgroundLocationRetry();
  check(retry.allow(false,1000));
  retry.completed(false,false,false,1000);
  check(!retry.allow(false,60999));check(retry.allow(false,61000));
  // An explicit foreground request remains immediate; cancellation cannot renew a delay.
  check(retry.allow(true,1001));retry.completed(false,true,false,30000);
  check(retry.allow(false,61000));
  retry.completed(false,false,false,61000);
  check(!retry.allow(false,360999));check(retry.allow(false,361000));
  retry.completed(false,false,false,361000);
  check(!retry.allow(false,660999));check(retry.allow(false,661000));
  retry.completed(true,false,true,400000);check(retry.allow(false,400000));
  // A successful foreground fix resets the next background failure to one minute.
  retry.completed(false,false,false,400001);
  check(!retry.allow(false,460000));check(retry.allow(false,460001));
  retry.completed(false,false,true,450000);check(retry.allow(false,460001));
  retry.completed(true,false,false,450001);check(retry.allow(false,450001));
  retry.completed(false,true,false,450002);check(retry.allow(false,450002));
  System.out.println("Background location retry: "+checks+" assertions passed");
 }
}
