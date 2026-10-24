package com.turboio.addon;
import java.io.*;import java.nio.file.*;

/** Canonicalize the Android-owned files root once, then reject child links. */
final class LifelogObservationPath {
 static File file(File files)throws IOException{return file(files,"lifelog-audio-observation.json");}
 static File file(File files,String name)throws IOException{
  if(files==null||!name.matches("lifelog-audio-observation(?:-probe-[a-f0-9]{32})?\\.json"))throw new IOException("AUDIO_OBSERVATION_PATH");
  File root=files.getCanonicalFile();if(!root.isDirectory()||Files.isSymbolicLink(files.toPath()))throw new IOException("AUDIO_OBSERVATION_PATH");
  File file=new File(root,name);for(String suffix:new String[]{"",".partial",".lock"}){File child=new File(file.getPath()+suffix);if(Files.isSymbolicLink(child.toPath())||!child.getAbsoluteFile().equals(child.getCanonicalFile()))throw new IOException("AUDIO_OBSERVATION_PATH");}return file;
 }
}
