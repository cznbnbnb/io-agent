package com.turboio.addon;

import java.lang.reflect.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Observes per-message receipts; preserves the vendor callback's arguments/result/exception. */
final class OfficialSdkReceipt {
 interface Observer {void done(boolean ok,boolean first);}
 static Object wrap(Class<?> contract,Object original,Object expected,Observer observer){
  if(contract==null||!contract.isInterface()||original==null||!contract.isInstance(original)||expected==null||observer==null)throw new IllegalArgumentException("SDK_CALLBACK_INVALID");
  AtomicBoolean seen=new AtomicBoolean();
  return Proxy.newProxyInstance(contract.getClassLoader(),new Class[]{contract},(proxy,method,args)->{
   if(method.getDeclaringClass()==Object.class){if(method.getName().equals("hashCode"))return System.identityHashCode(proxy);if(method.getName().equals("equals"))return proxy==args[0];return "iOOfficialOtaCallback";}
   if(method.getName().equals("invoke")&&method.getParameterCount()==2){boolean ok=args!=null&&args.length==2&&args[0]==expected&&args[1]==null;try{observer.done(ok,!seen.getAndSet(true));}catch(RuntimeException ignored){}}
   try{return method.invoke(original,args);}catch(InvocationTargetException originalFailure){throw originalFailure.getCause();}
  });
 }
}
