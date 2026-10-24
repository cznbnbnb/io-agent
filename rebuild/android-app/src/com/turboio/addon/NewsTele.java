package com.turboio.addon;
import android.os.*;import java.util.*;import java.nio.charset.StandardCharsets;import java.security.MessageDigest;import org.json.*;
/** Official business20 with the manuscript pulled over business17 by the glasses, as in the
 * verified HarmonyOS prompter: file UUID = DID, MD5 info, FNV-1a checksum. The SDK generic file
 * API is not used here; its own transfer UUID made the 1.0.7 prompter report an unknown error. */
final class NewsTele {
 private static String did="",peer="",phase="idle",note="尚未发送新闻稿";private static byte[] text;private static int speed;private static long deadline;private static boolean fileStarted,businessReady;private static int waiting;private static long startAck;
 // As in HarmonyOS 124: type3/code1 can arrive during the lens countdown, so only a same-DID type10
 // state1 counts as running. Stops inside the first 3.5 s of starting are deferred (candidate guard,
 // not a firmware contract).
 private static final long START_GUARD_MS=3500;
 private static PrompterFile.Outbound file;
 // Runs once when the wearer long-presses out of this manuscript (not on phone stop or failure).
 private static Runnable onExit;private static boolean taskOwned,recoveringTask;private static long recoveryUntil;
 // 2026-10-24 (user: a glasses power-off must not block later long questions): an unresolved task
 // manuscript is held only until its original show period ends, then released. If the lens still
 // shows it, its next same-DID frame re-adopts it through the durable owner and exits it.
 private static long showUntil;
 private static final Runnable releaseUncertain=()->{if(active()&&taskOwned&&phase.equals("uncertain")&&SystemClock.elapsedRealtime()>=showUntil){PrompterSharePort.trace("prompter uncertain released after show period");clear();note="旧任务稿件状态未确认，显示期限已过，已释放；内容保留在手机";}};
 static java.util.function.Consumer<String> closed;
 // 2026-10-23 R2 (App killed while an agent question was on the prompter): the glasses kept showing
 // the old manuscript and the new process ignored its frames, so the long-press exit opened nothing.
 // The question owner keeps the DID durably; a same-DID control frame while idle re-adopts the session.
 static final class Adoption{final Runnable exited;final long remaining;Adoption(Runnable exited,long remaining){this.exited=exited;this.remaining=remaining;}}
 static volatile java.util.function.Function<String,Adoption> orphans;
 static String did(){return did;}
 private static void adopt(String d,byte[] b){java.util.function.Function<String,Adoption> lookup=orphans;if(lookup==null||d.isEmpty()||!d.equals(NativeTransfer.connected()))return;
  try{NavCore.Envelope e=NavCore.decode(b);if(e==null||e.type<3||e.type>8)return;String owner=new JSONObject(e.json).optString("did");if(owner.isEmpty())return;
   Adoption a=lookup.apply(owner);if(a==null||!NativeTransfer.acquireMessages(owner))return;
   did=owner;peer=d;phase="playing";waiting=0;text=new byte[0];fileStarted=businessReady=true;file=null;onExit=a.exited;taskOwned=true;note="已接回重启前的任务提词器";
   BackgroundWork.acquire("新闻",16);showUntil=SystemClock.elapsedRealtime()+Math.max(0,a.remaining);NativeTransfer.MAIN.postDelayed(questionTimeout,Math.max(0,a.remaining));TaskAttention.hold("prompter",Math.max(0,a.remaining)+20000);PrompterSharePort.trace("prompter adopted type="+e.type);
  }catch(Exception unreadable){}
 }
 // 2026-10-23 (user): an agent question must not stay on the lens indefinitely; after 3 min the phone
 // exits the prompter. No dictation opens then; the question stays answerable on the phone.
 static final long QUESTION_SHOW_MS=180000;
 private static final Runnable questionTimeout=()->{if(active()&&taskOwned&&!phase.equals("uncertain")&&!phase.equals("closing")){PrompterSharePort.trace("prompter question timeout phase="+phase);onExit=null;note="任务显示期限已到，正在退出提词器；内容保留在手机";control(6);}};
 static String status(){return note;}static boolean active(){return !did.isEmpty();}
 static String checksum(byte[] b){long h=2166136261L;for(byte v:b)h=((h^(v&255))*16777619L)&0xffffffffL;return String.format(Locale.ROOT,"%08x",h);}
 private static String md5(byte[] b)throws Exception{StringBuilder s=new StringBuilder();for(byte v:MessageDigest.getInstance("MD5").digest(b))s.append(String.format(Locale.ROOT,"%02x",v&255));return s.toString();}
 static void start(String content,int value){start(content,value,null);}
 /** True when this manuscript now owns the prompter. */
 static boolean start(String content,int value,Runnable exited){return start(content,value,exited,exited!=null,QUESTION_SHOW_MS);}
 static boolean question(String content,int speed,long duration,Runnable exited){return duration>0&&start(content,speed,exited,true,Math.min(QUESTION_SHOW_MS,duration));}
 /** Cancel only the owned task DID; retain ownership until the glasses acknowledge exit. */
 static boolean cancelTask(String owner){if(!active()||!taskOwned||!did.equals(owner))return false;onExit=null;if(!phase.equals("closing")&&!phase.equals("uncertain"))control(6);return true;}
 /** Query the exact durable notice before any recovered stop; no new manuscript or voice path. */
 static boolean recoverNotice(String owner,String expectedPeer,long remaining){
  return recoverTask(owner,expectedPeer,remaining,null);
 }
 /** Query an original question even when the glasses send no reading-position frames. */
 static boolean canRecoverTask(String owner){return !active()||taskOwned&&did.equals(owner)&&phase.equals("uncertain");}
 static boolean recoverTask(String owner,String expectedPeer,long remaining,Runnable exited){
  if(!canRecoverTask(owner)||expectedPeer.isEmpty()||active()&&!peer.equals(expectedPeer)||!expectedPeer.equals(NativeTransfer.connected())||NativeTransfer.fileBusy()||!NativeTransfer.acquireMessages(owner))return false;
  // Retain the same lane and DID across a reconnect; never clear an unresolved manuscript to retry.
  NativeTransfer.MAIN.removeCallbacks(tick);NativeTransfer.MAIN.removeCallbacks(questionTimeout);
  did=owner;peer=expectedPeer;phase="recovering";waiting=10;text=new byte[0];file=null;fileStarted=businessReady=false;onExit=remaining>0?exited:null;taskOwned=recoveringTask=true;
  long duration=Math.max(0,Math.min(QUESTION_SHOW_MS,remaining));recoveryUntil=SystemClock.elapsedRealtime()+duration;showUntil=recoveryUntil;deadline=SystemClock.elapsedRealtime()+10000;
  BackgroundWork.acquire("新闻",16);TaskAttention.hold("prompter",duration+20000);note="正在核对重启前的任务稿件";
  try{send(10,new JSONObject().put("did",did).put("action",1));NativeTransfer.MAIN.postDelayed(tick,250);}catch(Exception e){fail("旧任务稿件状态尚未确认");}
  return true;
 }
 static boolean notice(String content,long duration){return start(content,120,null,true,Math.max(1,Math.min(QUESTION_SHOW_MS,duration)));}
 private static boolean start(String content,int value,Runnable exited,boolean task,long duration){if(active()){note="请先结束上一新闻会话";return false;}text=content.getBytes(StandardCharsets.UTF_8);if(content.length()>12000||text.length<1||text.length>48000||value<60||value>240){note="稿件超出限制或速度不在60–240";return false;}String owner=UUID.randomUUID().toString();if(!NativeTransfer.acquireMessages(owner)){note="请先连接眼镜并结束其他显示/传输任务";return false;}if(!PrompterSharePort.attach()){NativeTransfer.releaseMessages(owner);note="未能接入眼镜文件回包通道，未发送";return false;}did=owner;peer=NativeTransfer.connected();speed=value;fileStarted=businessReady=false;phase="prepare";waiting=2;deadline=SystemClock.elapsedRealtime()+30000;note="准备新闻稿，等待眼镜允许传稿";BackgroundWork.acquire("新闻",16);try{file=new PrompterFile.Outbound(did,text,md5(text));send(2,config());}catch(Exception e){fail("准备请求未确认");}NativeTransfer.MAIN.removeCallbacks(tick);NativeTransfer.MAIN.postDelayed(tick,250);boolean owned=active()&&!phase.equals("uncertain");if(owned){onExit=exited;taskOwned=task;if(task){showUntil=SystemClock.elapsedRealtime()+duration;NativeTransfer.MAIN.postDelayed(questionTimeout,duration);TaskAttention.hold("prompter",duration+20000);}}return owned;}
 // Same fields for prepare (type2) and start (type3) as the HarmonyOS candidate that displayed.
 private static JSONObject config()throws Exception{return new JSONObject().put("did",did).put("action",1).put("total",text.length).put("checksum",checksum(text)).put("scroll",2).put("speed",speed).put("pageOffset",0).put("highLightOffset",0);}
 private static Object message(String business,byte[] bytes)throws Exception{Object biz=NavReflect.call(NavReflect.type("P3.h"),"valueOf",business),priority=NavReflect.call(NavReflect.type("E3.b"),"valueOf","NORMAL");return NavReflect.make("E3.Q",bytes,UUID.randomUUID().toString(),peer,biz,null,priority,false,false,null,null);}
 private static void send(int type,JSONObject j)throws Exception{if(!peer.equals(NativeTransfer.connected()))throw new IllegalStateException();Object manager=NavReflect.field(NavReflect.type("E3.u"),"h");String owner=did;Object message=message("TELEPROMPTER",OtaFrame.encode(type,BoundedJson.read(j.toString().getBytes(StandardCharsets.UTF_8)),null));Object callback=NavReflect.proxy("kotlin.jvm.functions.Function2",(n,args)->{if(args.length>1&&args[1]!=null)NativeTransfer.MAIN.post(()->{if(did.equals(owner))fail("SDK拒绝新闻控制；请确认镜片状态");});});NavReflect.call(manager,"u",message,callback);}
 /** Raw business17 write; done(true) only on the SDK's success callback. */
 private static void sendFile(byte[] bytes,java.util.function.Consumer<Boolean> done)throws Exception{if(!peer.equals(NativeTransfer.connected()))throw new IllegalStateException();Object manager=NavReflect.field(NavReflect.type("E3.u"),"h"),message=message("FILE_TRANSFER",bytes);PrompterSharePort.trace("prompter file-tx bytes="+bytes.length+" type="+(bytes.length>0?(bytes[0]&255)>>>3:-1));Object callback=NavReflect.proxy("kotlin.jvm.functions.Function2",(n,args)->{boolean ok=args.length==2&&args[0]==message&&args[1]==null;NativeTransfer.MAIN.post(()->done.accept(ok));});NavReflect.call(manager,"u",message,callback);}
 static void begin(){if(active()&&phase.equals("ready"))control(3);}
 static void control(int type){if(!active()||!(type==3||type==4||type==5||type==6||type==7)||waiting!=0&&type!=6)return;if(type==3&&!phase.equals("ready"))return;if((type==4||type==5||type==7)&&!phase.equals("playing")&&!phase.equals("paused"))return;
  // Clear before the start guard too: a concurrent wearer exit must not begin dictation.
  if(type==6){onExit=null;if(recoveringTask){recoveryUntil=SystemClock.elapsedRealtime();return;}}
  if(type==6&&phase.equals("starting")){long wait=startAck+START_GUARD_MS-SystemClock.elapsedRealtime();if(wait>0){String owner=did;note="启动保护窗口内，稍后提交退出";NativeTransfer.MAIN.postDelayed(()->{if(active()&&did.equals(owner)&&!phase.equals("closing"))control(6);},wait);return;}}try{JSONObject j=type==3?config():new JSONObject().put("action",1).put("did",did);if(type==4)j.put("offset",0).put("code",1).put("isCompleted",false);if(type==7)j.put("scroll",2).put("speed",speed);waiting=type;deadline=SystemClock.elapsedRealtime()+10000;
  if(type==6){phase="closing";if(fileStarted&&file!=null&&!file.complete){byte[] cancel=file.cancel("user-stop");file.close();sendFile(cancel,ok->{});}}
  send(type,j);NativeTransfer.MAIN.removeCallbacks(tick);NativeTransfer.MAIN.postDelayed(tick,250);note="控制已提交，等待眼镜确认";}catch(Exception e){fail("新闻控制未确认");}}
 // Upstream calls stop() whenever the App leaves the foreground (MusicPlayer.background) unless the
 // optional background lease is held. 2026-10-23: an agent question was closed 3 s after the glasses
 // were ready because the phone screen timed out (the dev22 "未知错误" fits the same path, right after
 // an install relaunch). The glasses run the manuscript on their own, so an agent question stays
 // until the wearer exits; the phone's own exit button calls control(6) directly.
 static void stop(){if(taskOwned&&!phase.equals("uncertain")){PrompterSharePort.trace("prompter background stop ignored phase="+phase);return;}control(6);}static void reset(){if(!phase.equals("uncertain")||NativeTransfer.fileBusy())return;clear();note="已由用户确认镜片退出";}
 private static void fail(String s){PrompterSharePort.trace("prompter fail phase="+phase+" audio="+audio+" note="+s);PrompterSharePort.detach();phase="uncertain";waiting=0;note=s+"；未自动重试，可从眼镜退出后确认恢复";BackgroundWork.release("新闻");NativeTransfer.MAIN.removeCallbacks(tick);if(taskOwned){NativeTransfer.MAIN.removeCallbacks(releaseUncertain);NativeTransfer.MAIN.postDelayed(releaseUncertain,Math.max(0,showUntil-SystemClock.elapsedRealtime()));}}
 private static void clear(){String retired=did;recoveringTask=false;recoveryUntil=0;showUntil=0;NativeTransfer.MAIN.removeCallbacks(releaseUncertain);NativeTransfer.MAIN.removeCallbacks(questionTimeout);TaskAttention.release("prompter");PrompterSharePort.trace("prompter clear phase="+phase+" audio="+audio);audio=0;onExit=null;taskOwned=false;PrompterSharePort.detach();NativeTransfer.releaseMessages(did);did="";text=null;phase="idle";waiting=0;fileStarted=businessReady=false;if(file!=null)file.close();file=null;BackgroundWork.release("新闻");NativeTransfer.MAIN.removeCallbacks(tick);if(closed!=null&&!retired.isEmpty())closed.accept(retired);}
 private static void ready(){if(phase.equals("file")&&businessReady&&file!=null&&file.complete){waiting=0;phase="ready";note="稿件与提词业务均已就绪，请点“开始提词”";}}
 private static void query(){if(!active()||!phase.equals("starting"))return;try{waiting=10;send(10,new JSONObject().put("did",did).put("action",1));}catch(Exception e){fail("启动状态查询未提交");}}
 private static final Runnable tick=new Runnable(){public void run(){if(!active()||phase.equals("uncertain"))return;if(!peer.equals(NativeTransfer.connected()))fail("眼镜连接发生变化");else if((waiting!=0||phase.equals("file")||phase.equals("starting"))&&SystemClock.elapsedRealtime()>=deadline)fail(phase.equals("file")?"新闻稿未在时限内传完":phase.equals("starting")?"启动状态未确认，未发送暂停":"新闻回执超时");if(active()&&!phase.equals("uncertain"))NativeTransfer.MAIN.postDelayed(this,250);}};
 /** Business17 pulls for the current DID only: ACK, chunk requests, success or peer cancel. */
 static void receiveFile(String d,byte[] b){
  if(active()&&!peer.equals(d))PrompterSharePort.trace("prompter file-rx peer mismatch len="+d.length()+"/"+peer.length());
  if(!active()||!peer.equals(d)||!fileStarted||file==null||!phase.equals("file"))return;
  try{PrompterFile.Message chunk=file.receive(b);final PrompterFile.Outbound owner=file;
   if(chunk!=null)sendFile(PrompterFile.encode(chunk),ok->{if(file!=owner||!phase.equals("file"))return;if(!ok){fail("新闻稿分块发送未确认");return;}owner.committed(chunk);note="正在传稿 "+(owner.sentBytes*100/text.length)+"%";});
   else if(file.complete){note="眼镜确认整稿收取，等待提词就绪";ready();}
  }catch(RuntimeException e){fail(e.getMessage()!=null&&e.getMessage().equals("file-peer-cancelled")?"眼镜取消了收稿":"新闻稿传输回包异常");}catch(Exception e){fail("新闻稿分块未提交");}
 }
 // type9 is the glasses' prompter audio uplink (follow-reading), not a control: the 1.0.7 firmware's
 // inbound table has no 9 branch. 2026-10-23 dev22: treating it as "stop" sent type6 during prepare
 // and the lens showed 未知错误. Counted only, so the trace shows when the glasses opened the mic.
 private static int audio;
 static void receive(String d,byte[] b){if(!active())adopt(d,b);if(!active()||!peer.equals(d))return;try{NavCore.Envelope e=NavCore.decode(b);if(e==null)return;if(e.type==9){audio++;return;}
  // Probe (2026-10-23, user wants a double head shake to exit the task prompter): any frame type the
  // prompter does not handle is logged for agent-question sessions only.
  if(onExit!=null&&!(e.type>=2&&e.type<=8||e.type==10))PrompterSharePort.trace("prompter probe type="+e.type+" json="+e.json.length());JSONObject j=new JSONObject(e.json);if(!did.equals(j.optString("did")))return;int action=j.optInt("action"),code=j.optInt("code",-1);PrompterSharePort.trace("prompter rx type="+e.type+" action="+action+" code="+code+" phase="+phase);
  if(e.type==6&&(action==1||action==2&&code==1)){Runnable exited=action==1?onExit:null;if(action==1)send(6,new JSONObject().put("did",did).put("action",2).put("code",1));clear();note="眼镜已退出；新闻稿保留在手机";if(exited!=null)NativeTransfer.MAIN.post(exited);return;}
  if(e.type==8&&action==1){send(8,new JSONObject().put("did",did).put("action",2).put("code",1));return;}
  if(e.type==2&&action==2&&waiting==2){if(j.has("total")&&j.optInt("total")!=text.length)return;if(code!=1&&code!=7){fail("眼镜拒绝准备（"+code+"）");return;}
   if(!fileStarted){if(code!=1){fail("未传稿即收到完成码");return;}fileStarted=true;phase="file";deadline=SystemClock.elapsedRealtime()+120000;note="文件信息已发送，按眼镜请求分块传稿";final PrompterFile.Outbound owner=file;sendFile(file.info(),ok->{if(file==owner&&!ok)fail("新闻稿文件信息未确认");});}
   else if(code==7){businessReady=true;ready();}return;}
  if(e.type==3&&action==2&&waiting==3){if(code!=1){fail("眼镜拒绝开始（"+code+"）");return;}phase="starting";startAck=SystemClock.elapsedRealtime();deadline=startAck+10000;note="启动请求已受理，等待眼镜实际运行";query();return;}
  if(e.type==10&&recoveringTask){
   if(action!=2)return;int state=j.optInt("state",-1);recoveringTask=false;waiting=0;
   if(state==0){clear();note="旧任务稿件未在运行，未发送退出指令";return;}
   if(state!=1&&state!=4){onExit=null;fail("旧任务稿件状态未知，保留恢复责任");return;}
   phase=state==1?"playing":"ready";long remaining=Math.max(0,recoveryUntil-SystemClock.elapsedRealtime());
   PrompterSharePort.trace("prompter task recovered state="+state+" remaining="+remaining);note="已核对旧任务稿件，继续原显示期限";
   if(remaining==0)questionTimeout.run();else NativeTransfer.MAIN.postDelayed(questionTimeout,remaining);return;
  }
  if(e.type==10){if(action!=2||!phase.equals("starting")||waiting!=10)return;int state=j.optInt("state",-1);waiting=0;
   if(state==4){note="眼镜仍在等待启动";NativeTransfer.MAIN.postDelayed(NewsTele::query,500);return;}
   if(state!=1){fail("眼镜尚未进入运行状态（state "+state+"）");return;}
   phase="playing";note="眼镜已进入运行状态；镜片显示请人工确认";return;}
  if(action==2&&e.type==waiting){if(code!=1){fail("眼镜拒绝控制（"+code+"）");return;}waiting=0;phase=e.type==4?"paused":"playing";note=e.type==4?"提词已暂停":"眼镜已确认匀速提词";}
  else if(action==1&&(e.type==3||e.type==4||e.type==5)){send(e.type,new JSONObject().put("did",did).put("action",2).put("code",1));phase=e.type==4?"paused":"playing";note=e.type==4?"眼镜已暂停":"眼镜继续阅读";}
 }catch(Exception e){fail("新闻回包格式不兼容");}}
}
