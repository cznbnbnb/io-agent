package com.turboio.addon;

import java.io.*;
import java.nio.*;
import java.nio.channels.*;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Immutable snapshot of one reviewed 1.0.5.5 candidate. Never extracts or sends. */
final class Fixed60Firmware {
 private static final String MANIFEST="OtaFileInfo.json",AP="nuttx_ap.bin";
 private final Map<String,byte[]> members;
 private Fixed60Firmware(Map<String,byte[]> bytes)throws IOException{
  members=Collections.unmodifiableMap(bytes);verifyManifestAndPatch();
 }
 static String hash(String algorithm,byte[] bytes){
  try{byte[] digest=MessageDigest.getInstance(algorithm).digest(bytes);StringBuilder text=new StringBuilder();for(byte b:digest)text.append(String.format(Locale.ROOT,"%02x",b&255));return text.toString();}
  catch(java.security.GeneralSecurityException e){throw new IllegalStateException("DIGEST_UNAVAILABLE",e);}
 }
 static Fixed60Firmware verify(Path zip)throws IOException{
  return verify(readFile(zip,Fixed60Profile.ZIP_SIZE,Fixed60Profile.ZIP_SHA));
 }
 static Fixed60Firmware verify(byte[] input)throws IOException{
  if(input==null||input.length!=Fixed60Profile.ZIP_SIZE)throw new IOException("FIXED60_ZIP_SIZE");
  // Callers retain no mutable reference to the bytes being verified.
  byte[] zip=input.clone();
  if(!hash("SHA-256",zip).equals(Fixed60Profile.ZIP_SHA))throw new IOException("FIXED60_ZIP_SHA");
  Map<String,byte[]> files=new LinkedHashMap<>();int total=0;
  try(ZipInputStream in=new ZipInputStream(new ByteArrayInputStream(zip))){
   ZipEntry entry;int index=0;
   while((entry=in.getNextEntry())!=null){
    if(index>=Fixed60Profile.PINS.length)throw new IOException("FIXED60_EXTRA_MEMBER");
    String[] pin=Fixed60Profile.PINS[index++].split(" ");int size=Integer.parseInt(pin[1]);
    if(entry.isDirectory()||!entry.getName().equals(pin[0])||files.containsKey(pin[0]))throw new IOException("FIXED60_MEMBER_SET");
    byte[] bytes=new byte[size];int at=0,n;
    while(at<size&&(n=in.read(bytes,at,size-at))!=-1)at+=n;
    if(at!=size||in.read()!=-1||!hash("SHA-256",bytes).equals(pin[2]))throw new IOException("FIXED60_MEMBER_HASH");
    in.closeEntry();total+=size;files.put(pin[0],bytes);
   }
  }
  if(files.size()!=Fixed60Profile.PINS.length||total!=Fixed60Profile.EXPANDED_SIZE)throw new IOException("FIXED60_MISSING_MEMBER");
  return new Fixed60Firmware(files);
 }
 /** Freeze a vendor download directory before use; subsequent replacements cannot change slices. */
 static Fixed60Firmware freezeDirectory(Path directory)throws IOException{
  BasicFileAttributes first=Files.readAttributes(directory,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
  if(!first.isDirectory())throw new IOException("FIXED60_DIRECTORY");
  Set<String> names=new HashSet<>();for(String line:Fixed60Profile.PINS)names.add(line.split(" ")[0]);
  try(DirectoryStream<Path> list=Files.newDirectoryStream(directory)){
   for(Path path:list)if(!names.remove(path.getFileName().toString()))throw new IOException("FIXED60_DIRECTORY_MEMBER");
  }
  if(!names.isEmpty())throw new IOException("FIXED60_DIRECTORY_MISSING");
  Map<String,byte[]> files=new LinkedHashMap<>();
  for(String line:Fixed60Profile.PINS){String[] pin=line.split(" ");files.put(pin[0],readFile(directory.resolve(pin[0]),Integer.parseInt(pin[1]),pin[2]));}
  BasicFileAttributes last=Files.readAttributes(directory,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
  if(!last.isDirectory()||!Objects.equals(first.fileKey(),last.fileKey())||!first.lastModifiedTime().equals(last.lastModifiedTime()))throw new IOException("FIXED60_DIRECTORY_CHANGED");
  return new Fixed60Firmware(files);
 }
 private static byte[] readFile(Path path,int size,String sha)throws IOException{
  BasicFileAttributes before=Files.readAttributes(path,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
  if(!before.isRegularFile()||before.size()!=size)throw new IOException("FIXED60_FILE_TYPE_SIZE");
  byte[] bytes=new byte[size];ByteBuffer buffer=ByteBuffer.wrap(bytes);
  Set<OpenOption> options=new HashSet<>();options.add(StandardOpenOption.READ);options.add(LinkOption.NOFOLLOW_LINKS);
  try(SeekableByteChannel channel=Files.newByteChannel(path,options)){
   while(buffer.hasRemaining())if(channel.read(buffer)<0)throw new IOException("FIXED60_SHORT_FILE");
   if(channel.read(ByteBuffer.allocate(1))!=-1)throw new IOException("FIXED60_FILE_GREW");
  }
  BasicFileAttributes after=Files.readAttributes(path,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
  if(!after.isRegularFile()||after.size()!=size||!Objects.equals(before.fileKey(),after.fileKey())||!before.lastModifiedTime().equals(after.lastModifiedTime())||!hash("SHA-256",bytes).equals(sha))throw new IOException("FIXED60_FILE_CHANGED");
  return bytes;
 }
 private void verifyManifestAndPatch()throws IOException{
  try{
   List<Object> rows=BoundedJson.list(manifest());Set<String> found=new HashSet<>();
   if(rows.size()!=15)throw new IllegalArgumentException();
   for(Object value:rows){Map<String,Object> row=BoundedJson.map(value);BoundedJson.keys(row,"Name","Size","Md5","BurnMode","BurnAddr","BurnPath");
    String name=BoundedJson.text(row.get("Name"),64);byte[] bytes=members.get(name);
    if(bytes==null||MANIFEST.equals(name)||!found.add(name)||BoundedJson.number(row.get("Size"),1,Fixed60Profile.AP_SIZE)!=bytes.length||!hash("MD5",bytes).equals(row.get("Md5")))throw new IllegalArgumentException();
    if(AP.equals(name))row.put("Md5",Fixed60Profile.SOURCE_AP_MD5);
   }
   if(!hash("SHA-256",BoundedJson.canonical(rows)).equals(Fixed60Profile.ORIGINAL_MANIFEST_SHA))throw new IllegalArgumentException();
   byte[] restored=members.get(AP).clone();
   for(int i=0;i<Fixed60Profile.PATCH_OFFSETS.length;i++){
    int offset=Fixed60Profile.PATCH_OFFSETS[i];String before=Fixed60Profile.BEFORE[i],after=Fixed60Profile.AFTER[i];
    for(int j=0;j<4;j++){
     if((restored[offset+j]&255)!=Integer.parseInt(after.substring(j*2,j*2+2),16))throw new IllegalArgumentException();
     restored[offset+j]=(byte)Integer.parseInt(before.substring(j*2,j*2+2),16);
    }
   }
   if(!hash("SHA-256",restored).equals(Fixed60Profile.SOURCE_AP_SHA))throw new IllegalArgumentException();
  }catch(RuntimeException error){throw new IOException("FIXED60_MANIFEST_PATCH",error);}
 }
 Object manifest(){return BoundedJson.read(members.get(MANIFEST));}
 Set<String> payloadNames(){Set<String> names=new LinkedHashSet<>(members.keySet());names.remove(MANIFEST);return Collections.unmodifiableSet(names);}
 int payloadBytes(){return Fixed60Profile.EXPANDED_SIZE-members.get(MANIFEST).length;}
 int size(String name){byte[] bytes=members.get(name);if(bytes==null||MANIFEST.equals(name))throw new IllegalArgumentException("FIXED60_PAYLOAD_NAME");return bytes.length;}
 byte[] slice(String name,int start,int count){int length=size(name);if(start<0||count<1||count>51200||start>length-count)throw new IllegalArgumentException("FIXED60_SLICE_BOUNDS");return Arrays.copyOfRange(members.get(name),start,start+count);}
}
