package com.rayneo.airuntime.controller;
import java.util.*;
public final class ASRController {
 public final Map<String,ASRTask> tasks=new LinkedHashMap<>();public final List<String> destroyed=new ArrayList<>();
 public boolean failInit,failRelease,failStop,throwRelease,throwStateAfterRelease,destroyFailureAfterRemoval,automaticEnd=true;public int destroyFailures,destroyCalls;
 public ASRTask createTask(String name){if(tasks.containsKey(name))throw new IllegalStateException("duplicate");ASRTask task=new ASRTask(this,name);tasks.put(name,task);return task;}
 public void destroyTask(String name){destroyCalls++;if(destroyFailures>0){destroyFailures--;if(destroyFailureAfterRemoval)tasks.remove(name);throw new IllegalStateException("synthetic destroy failure");}destroyed.add(name);tasks.remove(name);}
}
