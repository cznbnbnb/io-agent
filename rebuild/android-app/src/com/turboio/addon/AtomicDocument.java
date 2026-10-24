package com.turboio.addon;

import java.io.*;
import java.nio.channels.*;
import java.nio.file.*;

/** One writer + fsync/atomic-rename. A partial write never replaces the last state. */
final class AtomicDocument implements AutoCloseable {
 private final File file,partial;private final RandomAccessFile lockFile;private final FileLock lock;private final int maxBytes;
 AtomicDocument(File file)throws IOException{
  this(file,8388608);
 }
 AtomicDocument(File file,int maxBytes)throws IOException{
  if(maxBytes<1||maxBytes>33554432)throw new IOException("STORE_BUDGET");this.maxBytes=maxBytes;
  this.file=file;partial=new File(file.getPath()+".partial");File parent=file.getParentFile();
  if(parent==null||!parent.isDirectory()&&!parent.mkdirs())throw new IOException("STORE_DIRECTORY_FAILED");
  lockFile=new RandomAccessFile(file.getPath()+".lock","rw");
  FileLock held=null;
  try{held=lockFile.getChannel().tryLock();if(held==null)throw new IOException("STORE_IN_USE");lock=held;}
  catch(IOException|RuntimeException error){lockFile.close();throw error;}
 }
 synchronized Object read()throws IOException{
  if(!file.exists())return null;
  if(file.length()>maxBytes)throw new IOException("STORE_BUDGET");
  return WireJson.read(Files.readAllBytes(file.toPath()),maxBytes,maxBytes>8388608?2000000:500000);
 }
 synchronized void save(Object value)throws IOException{
  if(!lock.isValid())throw new IOException("STORE_CLOSED");byte[] bytes=WireJson.bytes(value);
  if(bytes.length>maxBytes)throw new IOException("STORE_BUDGET");
  try(FileOutputStream out=new FileOutputStream(partial)){out.write(bytes);out.getFD().sync();}
  // Windows indexers may briefly open the destination without FILE_SHARE_DELETE. Retrying
  // the same atomic rename is safe; never delete/copy the committed file as a fallback.
  for(int attempt=0;;attempt++)try{
   Files.move(partial.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);break;
  }catch(AccessDeniedException denied){
   if(!System.getProperty("os.name","").startsWith("Windows")||attempt>=3)throw denied;
   try{Thread.sleep(25L<<attempt);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new IOException("STORE_INTERRUPTED",interrupted);}
  }
 }
 @Override public synchronized void close()throws IOException{try{lock.release();}finally{lockFile.close();}}
}
