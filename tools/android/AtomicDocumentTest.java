package com.turboio.addon;

import java.io.*;import java.nio.channels.*;import java.nio.file.*;import java.nio.file.OpenOption;import java.util.concurrent.*;

/** Actual Windows sharing violations, bounded retry, and preservation of the old atomic record. */
public final class AtomicDocumentTest {
 public static void main(String[] args)throws Exception{
  Path root=Files.createTempDirectory(Paths.get(args[0]),"atomic-"),record=root.resolve("state.json");
  try(AtomicDocument document=new AtomicDocument(record.toFile())){
   document.save(WireJson.object("value","old"));
   if(System.getProperty("os.name","").startsWith("Windows")){
    @SuppressWarnings({"unchecked","rawtypes"}) OpenOption noDelete=(OpenOption)Enum.valueOf((Class)Class.forName("com.sun.nio.file.ExtendedOpenOption"),"NOSHARE_DELETE");
    FileChannel brieflyHeld=FileChannel.open(record,StandardOpenOption.READ,noDelete);ScheduledExecutorService release=Executors.newSingleThreadScheduledExecutor();
    release.schedule(()->{try{brieflyHeld.close();}catch(IOException failure){throw new RuntimeException(failure);}},40,TimeUnit.MILLISECONDS);
    try{document.save(WireJson.object("value","new"));}finally{brieflyHeld.close();release.shutdown();release.awaitTermination(2,TimeUnit.SECONDS);}
    if(!"new".equals(WireJson.map(document.read()).get("value")))throw new AssertionError("Brief hold did not recover");
    try(FileChannel permanent=FileChannel.open(record,StandardOpenOption.READ,noDelete)){
     boolean refused=false;long start=System.nanoTime();try{document.save(WireJson.object("value","must-not-commit"));}catch(AccessDeniedException expected){refused=true;}
     if(!refused||System.nanoTime()-start>TimeUnit.SECONDS.toNanos(3))throw new AssertionError("Persistent denial not bounded");
     if(!"new".equals(WireJson.map(document.read()).get("value")))throw new AssertionError("Old record lost on denial");
    }
   }
   document.save(WireJson.object("value","final"));if(!"final".equals(WireJson.map(document.read()).get("value")))throw new AssertionError("Recovery failed");
  }
  System.out.println("Atomic document: passed (bounded Windows sharing retry, permanent failure preserves committed state)");
 }
}
