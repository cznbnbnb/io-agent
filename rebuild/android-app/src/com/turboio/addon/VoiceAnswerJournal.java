package com.turboio.addon;

import java.io.*;

/** A separate private, single-writer journal per capture; never discards an older draft. */
final class VoiceAnswerJournal implements VoiceAnswerSession.Store,AutoCloseable {
 private final AtomicDocument document;private final File file;
 VoiceAnswerJournal(File files,String attempt)throws IOException{
  if(attempt==null||!attempt.matches("[a-f0-9]{32}"))throw new IOException("VOICE_OWNER_INVALID");
  file=new File(files,"voice-drafts/"+attempt+".json");document=new AtomicDocument(file);
 }
 public Object read()throws IOException{
  if(new File(file.getPath()+".partial").exists())throw new IOException("VOICE_JOURNAL_UNCERTAIN");return document.read();
 }
 public void save(Object value)throws IOException{document.save(value);}
 public void close()throws IOException{document.close();}
}
