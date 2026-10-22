package com.turboio.addon;

import com.rayneo.airuntime.controller.*;

/** Official registry/config shape doubles. Never invokes the real controller or microphone. */
final class VoiceEnvironmentTest {
 static void yes(boolean value){VoiceAnswerTest.yes(value);}
 static final Host107VoiceTask.Listener SINK=new Host107VoiceTask.Listener(){public void result(String t,boolean f){}public void started(boolean a){}public void engineAudio(boolean a){}public void error(String c){}};
 static void run()throws Exception{
  VoiceAnswerTest.rejects(()->Host107VoiceEnvironment.current("zh-CN"));
  VoiceAnswerTest.rejects(()->Host107VoiceEnvironment.fromPlugin(new Object(),"zh-CN"));
  p8.e initial=new p8.e(()->new RayNeoServerConfig());m8.k initialPlugin=new m8.k(initial);
  VoiceAnswerTest.rejects(()->Host107VoiceEnvironment.fromPlugin(initialPlugin,"invalid-language"));yes(initial.initCalls==0);
  RayNeoServerConfig server=new RayNeoServerConfig();int[] supplierCalls={0};p8.e helper=new p8.e(()->{supplierCalls[0]++;return server;});m8.k plugin=new m8.k(helper);
  y8.d.b=new io.flutter.embedding.engine.a();y8.d.b.d.a.put(m8.k.class,plugin);
  VoiceAnswerTest.rejects(()->Host107VoiceEnvironment.current("zh-CN"));yes(helper.initCalls==0);
  y8.d.b.d.a.put(com.rayneo.rayneo_venus_sdk_plugin.f.class,new com.rayneo.rayneo_venus_sdk_plugin.f(null));
  VoiceAnswerTest.rejects(()->Host107VoiceEnvironment.current("zh-CN"));yes(helper.initCalls==0);
  y8.d.b.d.a.put(com.rayneo.rayneo_venus_sdk_plugin.f.class,new com.rayneo.rayneo_venus_sdk_plugin.f(plugin));
  Host107VoiceEnvironment environment=Host107VoiceEnvironment.current("zh-CN");yes(environment.idle()&&helper.j&&helper.initCalls==1&&supplierCalls[0]==1);
  String token="cccccccccccccccccccccccccccccccc";Host107VoiceTask voice=environment.prepare(token,SINK);ASRTask task=helper.controller.tasks.get("io_agent_asr_"+token);RayNeoASRConfig config=task.config;
  yes(config.server==server&&config.language.equals("zh-CN")&&config.format.equals("pcm")&&config.rate==16000&&!config.debug&&config.biz.equals("ASK_AI"));
  yes(config.user.equals(helper.a.c)&&config.device.equals(helper.a.d)&&config.model.equals(helper.a.a));yes(task.starts==0&&task.stops==0&&task.recorder.getClass()==p8.o.class);
  helper.l=true;yes(!environment.idle());VoiceAnswerTest.rejects(()->environment.prepare("dddddddddddddddddddddddddddddddd",SINK));yes(helper.controller.tasks.size()==1&&task.stops==0);
  helper.l=false;voice.release(token);yes(helper.controller.tasks.isEmpty());
  yes(helper.m); // Actual host defaults external-data/mock mode to true while idle.
  for(String busy:new String[]{"running","workflow-initialized","ask","tele","proactive","init-failed","server-missing","model-too-long"}){
   p8.e h=new p8.e(()->busy.equals("server-missing")?null:new RayNeoServerConfig());ASRTask stock=new ASRController().createTask("stock-original");stock.state=WorkState.WORKING;
   if(busy.equals("running"))h.l=true;if(busy.equals("workflow-initialized"))h.k=true;if(busy.equals("ask"))h.q.c=stock;if(busy.equals("tele"))h.o.b=stock;if(busy.equals("proactive"))h.p.d=stock;if(busy.equals("init-failed"))h.initAccepted=false;if(busy.equals("model-too-long"))h.a.a=new String(new char[1025]);
   VoiceAnswerTest.rejects(()->Host107VoiceEnvironment.fromPlugin(new m8.k(h),"en-US"));yes(stock.stops==0&&stock.releases==0&&stock.state==WorkState.WORKING&&h.controller.tasks.isEmpty());
   if(!busy.equals("init-failed")&&!busy.equals("server-missing")&&!busy.equals("model-too-long"))yes(h.initCalls==0);
  }
  y8.d.b=null;
 }
}
