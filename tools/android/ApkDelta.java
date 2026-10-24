package com.turboio.tools;

import java.io.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;

/** Shell-side byte reconstruction only. Does not install, launch or modify the source APK. */
public final class ApkDelta {
 private static final long LIMIT=1073741824L;
 private static void require(boolean value)throws IOException{if(!value)throw new IOException("APK_DELTA_INVALID");}
 private static byte[] hash(File file)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}return d.digest();}
 private static String hex(byte[] b){StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format(java.util.Locale.ROOT,"%02x",v&255));return s.toString();}
 public static void main(String[] args)throws Exception{
  require(args.length==4&&args[3].matches("[a-f0-9]{64}"));File base=new File(args[0]),patch=new File(args[1]),out=new File(args[2]);
  require(base.isFile()&&patch.isFile()&&!Files.isSymbolicLink(patch.toPath())&&patch.length()<=67108864&&patch.getCanonicalFile().getParentFile().equals(out.getCanonicalFile().getParentFile())&&!out.exists()&&!Files.isSymbolicLink(out.toPath()));
  boolean created=false,complete=false;
  try(DataInputStream in=new DataInputStream(new BufferedInputStream(new FileInputStream(patch)));RandomAccessFile source=new RandomAccessFile(base,"r")){
   byte[] magic=new byte[8],oldHash=new byte[32],newHash=new byte[32];in.readFully(magic);require(Arrays.equals(magic,"IOAPK001".getBytes("US-ASCII")));
   long oldSize=in.readLong(),newSize=in.readLong();in.readFully(oldHash);in.readFully(newHash);int count=in.readInt();
   require(oldSize==base.length()&&oldSize>0&&oldSize<=LIMIT&&newSize>0&&newSize<=LIMIT&&count>0&&count<=100000&&args[3].equals(hex(newHash))&&Arrays.equals(oldHash,hash(base)));
   require(out.createNewFile());created=true;MessageDigest actual=MessageDigest.getInstance("SHA-256");long written=0;byte[] bytes=new byte[65536];
   try(OutputStream target=new BufferedOutputStream(new FileOutputStream(out))){
    for(int i=0;i<count;i++){
     int op=in.readUnsignedByte();require(op==0||op==1);long offset=op==0?in.readLong():0,length=in.readLong();require(length>0&&length<=newSize-written);
     if(op==0){require(offset>=0&&offset<=oldSize&&length<=oldSize-offset);source.seek(offset);}
     long left=length;while(left>0){int size=(int)Math.min(left,bytes.length);if(op==0)source.readFully(bytes,0,size);else in.readFully(bytes,0,size);target.write(bytes,0,size);actual.update(bytes,0,size);left-=size;}written+=length;
    }
    require(written==newSize&&in.read()==-1&&Arrays.equals(actual.digest(),newHash));
   }
   require(out.length()==newSize&&Arrays.equals(hash(out),newHash));complete=true;System.out.println("APK_DELTA_VERIFIED "+args[3]);
  }finally{if(created&&!complete&&!out.delete())throw new IOException("APK_DELTA_CLEANUP_FAILED");}
 }
}
