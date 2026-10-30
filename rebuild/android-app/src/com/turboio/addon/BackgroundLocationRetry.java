package com.turboio.addon;

/** Budget failed background one-shot fixes. Cached fixes and continuous navigation bypass it. */
final class BackgroundLocationRetry {
 private int failures;
 private long retryAt;
 boolean allow(boolean visible,long now){return visible||now>=retryAt;}
 void completed(boolean available,boolean cancelled,boolean visible,long now){
  if(cancelled)return;
  if(available){failures=0;retryAt=0;return;}
  if(visible)return;
  failures=Math.min(2,failures+1);retryAt=now+(failures==1?60000:300000);
 }
}
