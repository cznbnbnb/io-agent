package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.util.*;

public final class LifelogObservationPathTest {
 static int checks;private static void yes(boolean value){checks++;if(!value)throw new AssertionError("OBSERVATION_PATH_TEST");}
 private static void reject(File root,String name)throws Exception{try{LifelogObservationPath.file(root,name);throw new AssertionError("PATH_ACCEPTED");}catch(IOException expected){yes(expected.getMessage().equals("AUDIO_OBSERVATION_PATH"));}}
 public static void main(String[] args)throws Exception{
  Path root=Paths.get(args[0]),real=Files.createDirectories(root.resolve("real/files"));String name="lifelog-audio-observation.json";yes(LifelogObservationPath.file(real.toFile()).getParentFile().equals(real.toFile().getCanonicalFile()));
  Files.createSymbolicLink(root.resolve("alias"),root.resolve("real"));File alias=root.resolve("alias/files").toFile();yes(!new File(alias,name).getAbsoluteFile().equals(new File(alias,name).getCanonicalFile()));yes(LifelogObservationPath.file(alias).equals(LifelogObservationPath.file(real.toFile())));
  reject(real.toFile(),"../outside.json");reject(root.resolve("missing").toFile(),name);Files.createSymbolicLink(real.resolve(name),root.resolve("outside"));reject(real.toFile(),name);Files.delete(real.resolve(name));Files.createSymbolicLink(real.resolve(name+".partial"),root.resolve("outside"));reject(real.toFile(),name);Files.delete(real.resolve(name+".partial"));Files.createSymbolicLink(root.resolve("direct"),real);reject(root.resolve("direct").toFile(),name);
  System.out.println("Lifelog observation path: "+checks+" checks passed");
 }
}
