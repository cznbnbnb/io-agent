package com.turboio.addon;

import android.app.*;import android.content.*;import android.os.*;import android.widget.*;
import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;

/** Passive owner of the vendor OTA conversation. Only the vendor generates upgrade frames. */
final class Fixed60OfficialRuntime {
 private static volatile Fixed60OfficialRuntime instance;
 private final Application app;private final Handler main=new Handler(Looper.getMainLooper());
 private final Object owner=new Object();private final String lease="official-fixed60-"+UUID.randomUUID();
 private final Set<Activity> foreground=Collections.newSetFromMap(new WeakHashMap<Activity,Boolean>());
 private final Map<Activity,Boolean> screenFlags=new WeakHashMap<>();
 private final FirmwareQueue.PassivePolicy policy=this::allow;
 private final OfficialOtaPreflightPoll poll=new OfficialOtaPreflightPoll();
 private Fixed60OfficialJournal journal;private Fixed60OfficialGate gate;private Fixed60Firmware firmware;
 private boolean checking,claimed,blocked,spacePrepared,granted,authorizing,serviceOwned;
 private long generation,until,boundGeneration,serviceDeadline;private String bound="",serviceToken="";
 private volatile Facts facts;private volatile boolean sourceCompatible;
 private String note="官方安装前预检尚未开始",lastExport="",connectionDetail="";
 private final int[] tx=new int[256],rx=new int[256];private int rejected,sdkConfirmed,sdkBytes;
 private final ArrayDeque<String> trace=new ArrayDeque<>();
 private static final class Facts {final String peer;final long generation,at;Facts(String p,long g,long t){peer=p;generation=g;at=t;}}
 private static long now(){return SystemClock.elapsedRealtime();}
 private static boolean enabled(){return ProductInfo.OFFICIAL_OTA_PREPARATION||ProductInfo.OFFICIAL_OTA_GUARDED;}
 private Fixed60OfficialRuntime(Activity host){
  app=(Application)host.getApplication();foreground.add(host);
  try{journal=new Fixed60OfficialJournal(new File(app.getFilesDir(),"io-official-fixed60-v1.json"));gate=new Fixed60OfficialGate(journal,now());
   if(gate.pending()){claimed=FirmwareQueue.acquirePassive(owner,gate.expectedPeerHash(),policy);blocked=!claimed;note=claimed?"上轮结果未知；没有恢复授权或自动重传":"其他升级历史正在占用连接，保持锁定";}
  }catch(Exception bad){blocked=true;FirmwareQueue.acquire(owner);note="官方升级保护记录不可读，保持锁定";}
  app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
   public void onActivityResumed(Activity a){synchronized(Fixed60OfficialRuntime.this){foreground.add(a);if(serviceOwned)keepScreen(true);}}
   public void onActivityStopped(Activity a){synchronized(Fixed60OfficialRuntime.this){foreground.remove(a);background();}}
   public void onActivityDestroyed(Activity a){synchronized(Fixed60OfficialRuntime.this){foreground.remove(a);background();}}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityStarted(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
  });main.post(tick);
 }
 static void init(Activity host){if(enabled()&&instance==null)instance=new Fixed60OfficialRuntime(host);}
 static boolean ownsLease(String value){return instance!=null&&instance.lease.equals(value);}
 static boolean sourceCompatible(){return instance!=null&&instance.sourceCompatible;}
 static void begin(Activity host){init(host);if(instance!=null)instance.begin();}
 static void end(){if(instance!=null)instance.close("未使用授权和预检已关闭");}
 static String status(){return instance==null?"官方安装前预检尚未开始":instance.describe();}
 static boolean pending(){Fixed60OfficialRuntime r=instance;if(r==null)return false;synchronized(r){return r.blocked||r.gate!=null&&r.gate.pending();}}
 static boolean canAuthorize(){Fixed60OfficialRuntime r=instance;if(r==null)return false;synchronized(r){return ProductInfo.OFFICIAL_OTA_GUARDED&&r.claimed&&!r.blocked&&!r.checking&&!r.authorizing&&!r.granted&&r.gate!=null&&r.gate.ready(now());}}
 private synchronized String describe(){
  String counts="";for(int i=1;i<256;i++)if(tx[i]+rx[i]>0)counts+="\ntype"+i+" 出站观察="+tx[i]+" 入站观察="+rx[i];
  return (ProductInfo.OFFICIAL_OTA_GUARDED?"官方升级 · 单次授权":"官方安装前预检（禁止刷写）")+"\n"+note+"\n阶段="+(gate==null?"BLOCKED":gate.phase())+" · 未使用授权="+(gate!=null&&gate.phase()==Fixed60OfficialGate.Phase.ARMED?1:0)+" · 结果保护="+(gate!=null&&gate.pending())+"\n前台服务="+OtaService.aliveOfficial(serviceToken)+"\n"+(gate==null?"保护未就绪":gate.preflight(now()))+"\n独占="+claimed+" · 拦截="+rejected+" · 本进程SDK确认="+sdkConfirmed+" / "+sdkBytes+"字节\n"+(gate==null?"":"策略放行="+gate.admittedMessages()+"条 / "+gate.admittedBytes()+"字节 · AP覆盖="+gate.apCovered()+" / "+Fixed60Profile.AP_SIZE+"\n首次失败="+gate.firstFailure()+" · 当前原因="+gate.error()+"\n"+gate.recoveryStatus(now()))+"\n"+FirmwareQueue.diagnostics()+"\n"+connectionDetail+"\n"+(ProductInfo.OFFICIAL_OTA_GUARDED?"没有授权不会开始；策略放行与SDK确认都不等于安装成功":"Mode2及固件写入：永久拒绝")+"\n"+String.join("\n",trace)+counts;
 }
 private boolean safe(){return !blocked&&!checking&&!claimed&&gate!=null&&!gate.pending()&&!foreground.isEmpty()&&Host107Login.loggedIn()&&!Fixed60Runtime.get(app).pending()&&!FirmwareQueue.busy()&&!OtaController.critical()&&!OfficialOtaBridge.busy();}
 private Fixed60Firmware freeze()throws IOException{
  File files=app.getFilesDir();File[] dirs={new File(files,"ota/Strix_OS_1.0.5.5"),new File(files.getParentFile(),"app_flutter/ota/Strix_OS_1.0.5.5")};File only=null;
  for(File d:dirs)if(d.exists()){if(only!=null)throw new IOException("AMBIGUOUS_DIRECTORY");only=d;}if(only==null)throw new IOException("NOT_PREPARED");return Fixed60Firmware.freezeDirectory(only.toPath());
 }
 private synchronized void begin(){
  if(!safe()){note="请先结束其他操作并保持原眼镜已登录认证，未开始预检";return;}
  Fixed60Session.Link link=Host107Ota.link();if(link.peer==null||link.peer.isEmpty()){note="没有唯一已认证原眼镜，未开始预检";return;}
  checking=true;long epoch=++generation;note="正在核对原厂唯一解压目录；没有授权写入";
  new Thread(()->{Fixed60Firmware checked=null;try{checked=freeze();}catch(Exception invalid){}final Fixed60Firmware result=checked;main.post(()->{synchronized(this){
   if(epoch!=generation)return;checking=false;Fixed60Session.Link current=Host107Ota.link();
   if(!safe()||result==null||!link.peer.equals(current.peer)||link.generation!=current.generation){note="目录、账号或原连接核对未通过，未开始预检";return;}
   if(!NativeTransfer.acquireFirmwareMessages(lease)){note="其他设备操作尚未退出，未开始预检";return;}
   if(!FirmwareQueue.acquirePassive(owner,Fixed60Session.peerHash(link.peer),policy)){NativeTransfer.releaseMessages(lease);note="其他升级保护正在使用队列，未开始预检";return;}
   try{gate.bind(link.peer,link.generation,now());}catch(RuntimeException invalid){FirmwareQueue.release(owner);NativeTransfer.releaseMessages(lease);note="预检状态不符，未发送";return;}
   firmware=result;claimed=true;spacePrepared=false;bound=link.peer;boundGeneration=link.generation;until=now()+120000;facts=new Facts(bound,boundGeneration,now());sourceCompatible=true;note="已提交版本、电量和空闲只读查询；等待真实回执";
   for(int type:new int[]{1,2,11})sendRead(type);
  }});},"iO-official-preflight-directory").start();
 }
 private void sendRead(int type){
  long epoch=generation;Fixed60Session.Link link=Host107Ota.link();Host107Ota.send(owner,link,OtaFrame.encode(type,null,null),ok->{synchronized(this){if(epoch==generation&&claimed&&!ok){if(gate.pending()){gate.abort("READ_QUERY_SDK_FAILED",now());settle();}else close("只读查询未得到SDK确认，预检已结束");}}});
 }
 static void authorization(Activity host){init(host);if(instance==null||!ProductInfo.OFFICIAL_OTA_GUARDED)return;
  EditText token=new EditText(host);token.setSingleLine(true);token.setHint(Fixed60Profile.ID);
  new AlertDialog.Builder(host).setTitle("允许一次官方安装").setMessage("仅允许已核对的1.0.5.5固定60秒候选。请输入候选标记；授权不会自动开始，随后仍由原厂确认框开始。升级时保持App前台、蓝牙和供电；异常会保留结果未知，不能重刷。").setView(token).setNegativeButton("取消",null).setPositiveButton("允许一次",(d,w)->instance.authorize(token.getText().toString().trim())).show();
 }
 private synchronized void authorize(String token){
  if(!ProductInfo.OFFICIAL_OTA_GUARDED||!Fixed60Profile.ID.equals(token)||blocked||!claimed||checking||authorizing||granted||gate==null||gate.pending()||!gate.ready(now())||foreground.isEmpty()||!Host107Login.loggedIn()){note="授权条件未满足，未开放写入";return;}
  Fixed60Session.Link link=Host107Ota.link();if(!bound.equals(link.peer)||boundGeneration!=link.generation){close("原连接已变化，未授权");return;}
  checking=true;long epoch=generation;note="重新冻结16个官方成员；尚未授权";
  new Thread(()->{Fixed60Firmware checked=null;try{checked=freeze();}catch(Exception invalid){}final Fixed60Firmware result=checked;main.post(()->{synchronized(this){
   if(epoch!=generation)return;checking=false;Fixed60Session.Link current=Host107Ota.link();
   if(result==null||!claimed||gate.pending()||!gate.ready(now())||foreground.isEmpty()||!bound.equals(current.peer)||boundGeneration!=current.generation||!Host107Login.loggedIn()){close("目录、账号或新鲜预检变化，未授权");return;}
   firmware=result;authorizing=true;serviceOwned=true;serviceToken=UUID.randomUUID().toString();serviceDeadline=now()+5000;keepScreen(true);
   try{app.startForegroundService(new Intent(app,OtaService.class).putExtra("io_official_fixed60_lease",serviceToken));note="等待前台服务确认；尚未授权";}catch(RuntimeException invalid){close("前台服务启动失败，未授权");}
  }});},"iO-official-grant-freeze").start();
 }
 static boolean acceptService(String token){Fixed60OfficialRuntime r=instance;if(r==null)return false;synchronized(r){return r.serviceOwned&&r.claimed&&!r.blocked&&!r.serviceToken.isEmpty()&&r.serviceToken.equals(token)&&(r.authorizing||r.granted);}}
 static void serviceLost(){Fixed60OfficialRuntime r=instance;if(r==null)return;synchronized(r){if(r.serviceOwned){if(r.gate!=null&&r.gate.pending()){r.gate.abort("OTA_SERVICE_LOST",now());r.settle();}else r.close("升级服务已退出，未使用授权已撤销");}}}
 private synchronized boolean allow(Object message,String destination,byte[] bytes){
  Facts current=facts;long time=now();if(!claimed||current==null||time<current.at||time-current.at>1500||!current.peer.equals(destination))return false;
  try{OtaFrame f=OtaFrame.decode(bytes);tx[f.type]++;record("out",f);
   boolean write=f.type!=1&&f.type!=2&&f.type!=3&&f.type!=11;
   if(write&&(!ProductInfo.OFFICIAL_OTA_GUARDED||!granted)){rejected++;note=f.type==4?"原厂开始请求已拒绝；没有可用授权":"未授权写入已拒绝";return false;}
   if(f.type==4&&!gate.pending()){
    if(Looper.myLooper()!=Looper.getMainLooper()||!Host107Login.loggedIn()){granted=false;gate.revoke(now());rejected++;main.post(()->close("开始时的账号或宿主线程核对未通过，未发送"));return false;}
    Fixed60Session.Link freshLink=Host107Ota.link();if(!destination.equals(freshLink.peer)||current.generation!=freshLink.generation){granted=false;gate.revoke(now());rejected++;main.post(()->close("开始时原连接已变化，未发送"));return false;}time=now();
   }
   byte[] approved=gate.outbound(destination,current.generation,bytes,time,System.currentTimeMillis(),!foreground.isEmpty(),OtaService.aliveOfficial(serviceToken));sourceCompatible=!gate.pending();
   if(approved==null){rejected++;note="发送被保护拦截："+gate.error();main.post(this::settle);return false;}
   Host107Ota.replacePayload(message,approved);
   if(write)observeReceipt(message,f.binary.length,generation);main.post(this::settle);return true;
  }catch(Exception invalid){rejected++;if(gate!=null&&gate.pending())gate.abort("SDK_MESSAGE_ADAPTER_FAILED",time);note="官方消息适配未通过，已拒绝";main.post(this::settle);return false;}
 }
 private void observeReceipt(Object message,int binary,long epoch)throws Exception{
  Host107Ota.observeVendorReceipt(message,(ok,first)->{synchronized(this){if(epoch!=generation||!claimed)return;if(!ok){gate.abort("SDK_SEND_FAILED",now());note="SDK发送失败；结果保护保留";}else if(first){sdkConfirmed++;sdkBytes+=binary;}main.post(this::settle);}});
 }
 private void record(String direction,OtaFrame f){
  if(trace.size()>=24)trace.removeFirst();Map<?,?> j=f.json instanceof Map?(Map<?,?>)f.json:Collections.emptyMap();String shape="type="+f.type+" fields="+(f.json instanceof Map?j.size():-1)+" binary="+f.binary.length;
  if(f.type==3)shape+=" fixedSize="+sameNumber(j.get("OtaSize"),Fixed60Profile.ZIP_SIZE);if(f.type==4)shape+=" mode2="+sameNumber(j.get("Mode"),2)+" exactMode2="+Arrays.equals(BoundedJson.canonical(f.json),BoundedJson.canonical(OtaFrame.object("Mode",2)))+" mainThread="+(Looper.myLooper()==Looper.getMainLooper());if(f.type==3||f.type==11)shape+=" resultTrue="+Boolean.TRUE.equals(j.get("Result"));trace.addLast(direction+" "+shape);
 }
 private static boolean sameNumber(Object value,int n){return value instanceof Number&&((Number)value).doubleValue()==n;}
 static void observe(String kind,Map<?,?> data){Fixed60OfficialRuntime r=instance;if(r!=null)r.event(kind,data);}
 private synchronized void event(String kind,Map<?,?> data){
  if(!claimed||kind==null||data==null)return;if(kind.equals("bleStateChanged")||kind.equals("brStateChanged")||kind.equals("bondStateChanged")){facts=null;return;}
  if(!kind.equals("messageReceived"))return;Object raw=data.get("message");if(!(raw instanceof Map))return;Map<?,?> m=(Map<?,?>)raw;if(HostBusiness.id(m.get("businessId"))!=9)return;
  Facts current=facts;Object source=m.get("deviceId"),payload=m.get("payload");long time=now();if(current==null||time<current.at||time-current.at>1500||!current.peer.equals(source)||!(payload instanceof byte[])||((byte[])payload).length>8192)return;
  try{byte[] frozen=((byte[])payload).clone();OtaFrame f=OtaFrame.decode(frozen);rx[f.type]++;record("in",f);gate.inbound((String)source,current.generation,frozen,time);sourceCompatible=!gate.pending();main.post(this::settle);}catch(RuntimeException invalid){gate.abort("INVALID_OFFICIAL_EVENT",time);note="官方回执结构不符";main.post(this::settle);}
 }
 private synchronized void close(String reason){
  if(gate!=null&&gate.pending()){note="升级结果待核对，不能当普通准备取消";return;}
  generation++;checking=false;facts=null;firmware=null;spacePrepared=granted=authorizing=sourceCompatible=false;if(gate!=null)gate.revoke(now());finishService();
  if(claimed&&!blocked){FirmwareQueue.release(owner);NativeTransfer.releaseMessages(lease);}claimed=false;note=reason;export();
 }
 private synchronized void background(){
  if(!foreground.isEmpty())return;facts=null;sourceCompatible=false;generation++;checking=authorizing=false;
  if(gate!=null&&gate.pending()){if(gate.phase()!=Fixed60OfficialGate.Phase.UNKNOWN&&gate.phase()!=Fixed60OfficialGate.Phase.INSTALLING)gate.abort("LEFT_FOREGROUND",now());settle();}else close("已离开App，未使用授权已撤销");
 }
 private void keepScreen(boolean on){
  if(on){for(Activity a:new ArrayList<>(foreground))try{if(!screenFlags.containsKey(a))screenFlags.put(a,(a.getWindow().getAttributes().flags&android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)!=0);a.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}catch(RuntimeException ignored){}}
  else{for(Map.Entry<Activity,Boolean> e:new ArrayList<>(screenFlags.entrySet()))if(e.getKey()!=null&&!e.getValue())try{e.getKey().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}catch(RuntimeException ignored){}screenFlags.clear();}
 }
 private void finishService(){String old=serviceToken;serviceOwned=authorizing=false;serviceToken="";keepScreen(false);if(!old.isEmpty())OtaService.finishOfficial(old);}
 private synchronized void settle(){
  if(gate==null)return;Fixed60OfficialGate.Phase phase=gate.phase();
  if(gate.pending()){
   sourceCompatible=false;if(phase==Fixed60OfficialGate.Phase.UNKNOWN||phase==Fixed60OfficialGate.Phase.INSTALLING||phase==Fixed60OfficialGate.Phase.READBACK){granted=false;firmware=null;finishService();}
   if(phase==Fixed60OfficialGate.Phase.INSTALLING)note="眼镜报告进入安装，等待自然重启；尚未证明补丁启动";
   else if(phase==Fixed60OfficialGate.Phase.READBACK)note="原眼镜新鲜启动/空闲回读通过，仍需检查镜片";
   else if(phase==Fixed60OfficialGate.Phase.UNKNOWN)note="结果未知；首次失败="+gate.firstFailure()+"，不会重传";
  }else if(granted&&phase!=Fixed60OfficialGate.Phase.ARMED)close("未使用授权已撤销");
  export();
 }
 static void home(Activity host){confirmation(host,"已回到正常首页？","只在亲眼确认本次安装后，同一副眼镜已回正常首页且空闲时记录。若还在更新、黑屏或情况未知，请继续等待。",()->instance.home());}
 private synchronized void home(){Fixed60Session.Link link=Host107Ota.link();if(gate!=null&&gate.confirmHome("已回首页",link.peer,link.generation,now()))note="首页观察已记录；请单独只读回查";else note="同一眼镜、稳定连接或等待时间未满足，保护保持";}
 static void readback(){if(instance!=null)instance.readbackNow();}
 private synchronized void readbackNow(){
  if(blocked||gate==null||!gate.pending()||foreground.isEmpty()||!Host107Login.loggedIn()){note="当前不能回查，保护保持";return;}
  Fixed60Session.Link link=Host107Ota.link();if(!gate.beginReadback(link.peer,link.generation,now())||!NativeTransfer.acquireFirmwareRecovery(lease)){note="原眼镜或恢复条件未满足，未发送";return;}
  bound=link.peer;boundGeneration=link.generation;facts=new Facts(bound,boundGeneration,now());note="只读查询新鲜启动及空闲；结果保护保持";sendRead(1);sendRead(11);
 }
 static void release(Activity host){confirmation(host,"首页正常并结束启动核对？","确认同一副眼镜安装后已回正常首页、显示正常且空闲。只有新鲜版本和空闲回读通过才解除保护；一分钟卡及其他业务仍须单独验收，不会重试安装。",()->instance.release());}
 private synchronized void release(){
  Fixed60Session.Link link=Host107Ota.link();if(gate!=null&&gate.release("已检查镜片",link.peer,link.generation,now())){generation++;granted=sourceCompatible=false;claimed=false;facts=null;FirmwareQueue.release(owner);NativeTransfer.releaseMessages(lease);finishService();note="本次结果保护已解除；未自动再次安装";}else note="缺少新鲜回读或镜片确认，保护保持";export();
 }
 private static void confirmation(Activity host,String title,String text,Runnable action){if(instance==null)return;new AlertDialog.Builder(host).setTitle(title).setMessage(text).setNegativeButton("继续等待",null).setPositiveButton("已确认",(d,w)->action.run()).show();}
 private final Runnable tick=new Runnable(){public void run(){synchronized(Fixed60OfficialRuntime.this){
  if(claimed&&!blocked){
   Fixed60Session.Link link=Host107Ota.link();long time=now();facts=link.peer==null||link.peer.isEmpty()?null:new Facts(link.peer,link.generation,time);connectionDetail=Host107Connection.statusDetails(gate==null?"":gate.expectedPeerHash());
   if(gate.pending()){gate.tick(link.peer,link.generation,time,!foreground.isEmpty(),OtaService.aliveOfficial(serviceToken));settle();}
   else if(foreground.isEmpty()||!Host107Login.loggedIn()||time>=until||!bound.equals(link.peer)||boundGeneration!=link.generation)close("原连接、账号或预检期限变化，未使用授权已撤销");
   else{
    sourceCompatible=true;gate.tick(bound,boundGeneration,time,true,OtaService.aliveOfficial(serviceToken));
    if(authorizing){if(OtaService.aliveOfficial(serviceToken))try{gate.arm(firmware,Fixed60Profile.ID,bound,boundGeneration,time);authorizing=false;granted=true;until=time+900000;note="授权1次；请返回原厂确认框开始安装";}catch(RuntimeException bad){close("新鲜预检或授权条件变化，未授权");}else if(time>=serviceDeadline)close("前台服务未就绪，未授权");}
    if(!granted&&!authorizing&&!checking&&!spacePrepared&&gate.ready(time))try{gate.inspectCandidate(firmware,bound,boundGeneration,time);spacePrepared=true;note="版本、电量/空闲已通过；空间查询可读，安装仍未授权";}catch(RuntimeException invalid){close("预检条件未通过，已结束");}
    if(granted){for(int type:poll.due(gate.phase()==Fixed60OfficialGate.Phase.ARMED,true,time,t->gate.queryPending(t,time)))sendRead(type);settle();}
   }
  }export();}main.postDelayed(this,claimed?250:1000);}};
 private void export(){try{String text=describe();if(text.equals(lastExport))return;File files=app.getExternalFilesDir(null);if(files==null)return;String stem="io-agent-official-fixed60-status";File temp=new File(files,stem+".tmp"),out=new File(files,stem+".txt");try(FileOutputStream s=new FileOutputStream(temp)){s.write(text.getBytes(StandardCharsets.UTF_8));s.getFD().sync();}if(temp.renameTo(out))lastExport=text;}catch(IOException ignored){}}
}
