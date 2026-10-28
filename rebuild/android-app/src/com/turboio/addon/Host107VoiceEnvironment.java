package com.turboio.addon;

import java.lang.reflect.*;
import java.util.*;

/** Exact official ASR configuration/ownership adapter. Credential objects never leave memory. */
final class Host107VoiceEnvironment {
 private static final String BASE="com.rayneo.airuntime.controller.";
 private final Object plugin,helper,lock,controller,config;
 private Host107VoiceEnvironment(Object plugin,Object helper,Object lock,Object controller,Object config){this.plugin=plugin;this.helper=helper;this.lock=lock;this.controller=controller;this.config=config;}
 private static Class<?> type(String name)throws ReflectiveOperationException{return Class.forName(Host107Abi.className(name));}
 private static Object field(Object object,String name)throws ReflectiveOperationException{return object.getClass().getField(name).get(object);}
 private static Object call(Object object,String method)throws ReflectiveOperationException{return object.getClass().getMethod(method).invoke(object);}
 private static void set(Object object,String method,Class<?> parameter,Object value)throws ReflectiveOperationException{object.getClass().getMethod(method,parameter).invoke(object,value);}
 private static void require(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 static Host107VoiceEnvironment current(String language)throws ReflectiveOperationException{
  Object engine=type("y8.d").getField("b").get(null);require(engine!=null,"VOICE_HOST_NOT_READY");
  Object entries=field(field(engine,"d"),"a");require(entries instanceof Map,"VOICE_HOST_MISMATCH");
  Object wrapper=((Map<?,?>)entries).get(type("com.rayneo.rayneo_venus_sdk_plugin.f"));
  require(wrapper!=null&&wrapper.getClass()==type("com.rayneo.rayneo_venus_sdk_plugin.f"),"VOICE_HOST_NOT_READY");
  return fromPlugin(field(wrapper,"y"),language);
 }
 static Host107VoiceEnvironment fromPlugin(Object plugin,String language)throws ReflectiveOperationException{
  require(plugin!=null&&plugin.getClass()==type("m8.k"),"VOICE_HOST_NOT_READY");
  require(language!=null&&language.matches("[a-z]{2,3}-[A-Z]{2}"),"VOICE_LANGUAGE_INVALID");
  Object helper=field(plugin,"u");require(helper!=null&&helper.getClass()==type("p8.e"),"VOICE_HOST_MISMATCH");Object lock=field(helper,"i");require(lock!=null,"VOICE_HOST_MISMATCH");
  synchronized(lock){
   idle(helper);
   // Reuse the host's own idempotent controller initialization. Never initialize, start,
   // stop or destroy its generic ASR workflow or any of its existing named tasks.
   require(Boolean.TRUE.equals(call(helper,"c"))&&Boolean.TRUE.equals(field(helper,"j")),"VOICE_ENGINE_INIT_FAILED");
   Object controller=call(helper,"b");require(controller!=null&&controller.getClass()==type(BASE+"ASRController"),"VOICE_HOST_MISMATCH");
   Object account=field(helper,"a");require(account!=null&&account.getClass()==type("s8.a"),"VOICE_HOST_MISMATCH");
   Object supplier=field(helper,"b");require(supplier!=null,"VOICE_CONFIG_UNAVAILABLE");
   // Invoke through the official public supplier interface, not a synthetic implementation.
   Object server=type("Ab.a").getMethod("invoke").invoke(supplier);
   require(server!=null&&server.getClass()==type(BASE+"RayNeoServerConfig"),"VOICE_CONFIG_UNAVAILABLE");
   Object config=type(BASE+"RayNeoASRConfig").getConstructor().newInstance();
   set(config,"setServerConfig",type(BASE+"RayNeoServerConfig"),server);
   for(String[] pair:new String[][]{{"setUserName","c"},{"setDeviceName","d"},{"setDeviceModel","a"}}){Object value=field(account,pair[1]);require(value instanceof String&&((String)value).length()<=1024,"VOICE_CONFIG_UNAVAILABLE");set(config,pair[0],String.class,value);}
   set(config,"setLanguageCode",String.class,language);set(config,"setInputAudioFormat",String.class,"pcm");set(config,"setInputAudioRate",int.class,16000);set(config,"setBizType",String.class,"ASK_AI");set(config,"setEnvDebug",boolean.class,false);
   return new Host107VoiceEnvironment(plugin,helper,lock,controller,config);
  }
 }
 private static void idle(Object helper)throws ReflectiveOperationException{
  // k/l mean workflow initialized/running. m is the host's external-input/mock mode,
  // defaults true, and is not a transition/busy flag. Never change that host mode.
  require(Boolean.FALSE.equals(field(helper,"k"))&&Boolean.FALSE.equals(field(helper,"l")),"VOICE_ENGINE_BUSY");
  Object ask=field(helper,"q"),tele=field(helper,"o"),proactive=field(helper,"p");
  require(ask!=null&&ask.getClass()==type("p8.a")&&tele!=null&&tele.getClass()==type("p8.k")&&proactive!=null&&proactive.getClass()==type("p8.g"),"VOICE_HOST_MISMATCH");
  require(field(ask,"c")==null&&field(tele,"b")==null&&field(proactive,"d")==null,"VOICE_ENGINE_BUSY");
 }
 boolean idle()throws ReflectiveOperationException{
  synchronized(lock){try{return field(plugin,"u")==helper&&field(helper,"i")==lock&&Boolean.TRUE.equals(field(helper,"j"))&&call(helper,"b")==controller&&checkIdle();}catch(IllegalStateException busy){return false;}}
 }
 private boolean checkIdle()throws ReflectiveOperationException{idle(helper);return true;}
 Host107VoiceTask prepare(String token,Host107VoiceTask.Listener listener)throws ReflectiveOperationException{
  synchronized(lock){require(idle(),"VOICE_ENGINE_BUSY");return Host107VoiceTask.prepare(controller,config,token,listener);}
 }
}
