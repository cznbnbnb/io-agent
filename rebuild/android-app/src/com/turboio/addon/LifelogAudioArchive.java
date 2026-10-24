package com.turboio.addon;
import java.io.*;import java.nio.*;import java.nio.channels.*;import java.nio.file.*;import java.security.*;import java.util.*;import java.nio.charset.StandardCharsets;

/** Durable original A3/A4 batches. No microphone, decoder or server calls.
 * A sealed byte journal is not a complete recording or a verified material link.
 * Raw bytes are forced before publishing the durable receipt. Unacknowledged
 * complete records recover; an uncertain tail is retained without truncation. */
final class LifelogAudioArchive implements AutoCloseable {
 interface Guard {void check()throws IOException;}
 static final long MAX_BYTES=268435456;static final int MAX_RECORDS=131072,MAX_MESSAGE=16384,MAX_PAYLOAD=65536;
 private static final byte[] MAGIC={'I','O','A','U','D','I','O','1'};
 private final File dir,raw;private final Map<String,Object> owner;private final AtomicDocument state;private final FileChannel channel;private final Map<Long,String> receipts=new HashMap<>();
 private long count,bytes;private String chain,tail="",sealed="";private boolean closed,uncertain;
 LifelogAudioArchive(File files,String account,String peer,long generation,String stream,Guard guard)throws IOException{
  require(account!=null&&account.matches("[a-f0-9]{64}")&&peer!=null&&peer.matches("[a-f0-9]{64}")&&generation>0&&stream!=null&&stream.matches("[a-f0-9]{32}"),"AUDIO_ARCHIVE_OWNER_INVALID");admit(guard);
  owner=WireJson.object("account",account,"peer",peer,"generation",generation,"stream",stream);
  File root=files.getCanonicalFile();require(root.isDirectory()&&!Files.isSymbolicLink(files.toPath()),"AUDIO_ARCHIVE_PATH_INVALID");
  File base=directory(root,"lifelog-audio"),accountDir=directory(base,account);dir=new File(accountDir,stream);boolean fresh=!dir.exists();if(fresh){require(dir.mkdir(),"AUDIO_ARCHIVE_DIRECTORY");syncDirectory(accountDir);}checkPath(dir,true);raw=new File(dir,"original.frames");
  checkDocuments();File manifest=new File(dir,"state.json");require(fresh||manifest.isFile(),"AUDIO_ARCHIVE_UNOWNED");
  AtomicDocument document=null;FileChannel opened=null;
  try{document=new AtomicDocument(manifest,65536);state=document;Object previous=state.read();if(previous==null){require(fresh,"AUDIO_ARCHIVE_UNOWNED");chain=genesis();save(guard);}else readState(WireJson.map(previous));
   checkPath(raw,false);if(!raw.exists()){require(bytes==0&&count==0&&sealed.isEmpty(),"AUDIO_ARCHIVE_RAW_MISSING");opened=FileChannel.open(raw.toPath(),StandardOpenOption.CREATE_NEW,StandardOpenOption.READ,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS);opened.write(ByteBuffer.wrap(MAGIC));opened.force(true);syncDirectory(dir);}else opened=FileChannel.open(raw.toPath(),StandardOpenOption.READ,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS);
   channel=opened;recover(guard);
  }catch(IOException|RuntimeException error){if(opened!=null)try{opened.close();}catch(IOException ignored){}if(document!=null)try{document.close();}catch(IOException ignored){}throw error;}
 }
 private static File directory(File parent,String name)throws IOException{File f=new File(parent,name);if(!f.exists()){require(f.mkdir(),"AUDIO_ARCHIVE_DIRECTORY");syncDirectory(parent);}checkPath(f,true);return f;}
 private static void syncDirectory(File f)throws IOException{try(FileChannel directory=FileChannel.open(f.toPath(),StandardOpenOption.READ)){directory.force(true);}}
 private static void checkPath(File f,boolean directory)throws IOException{require(!Files.isSymbolicLink(f.toPath())&&f.getAbsoluteFile().equals(f.getCanonicalFile()),"AUDIO_ARCHIVE_PATH_INVALID");if(f.exists())require(directory?f.isDirectory():f.isFile(),"AUDIO_ARCHIVE_PATH_INVALID");}
 private void checkDocuments()throws IOException{checkPath(dir,true);for(String n:new String[]{"state.json","state.json.partial","state.json.lock","original.frames"})checkPath(new File(dir,n),false);}
 private static void require(boolean b,String code)throws IOException{if(!b)throw new IOException(code);}
 private static void admit(Guard g)throws IOException{require(g!=null,"AUDIO_ARCHIVE_GUARD_REQUIRED");g.check();}
 private static String hash(byte[]...data){try{MessageDigest d=MessageDigest.getInstance("SHA-256");for(byte[] b:data)d.update(b);StringBuilder s=new StringBuilder();for(byte b:d.digest())s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}catch(NoSuchAlgorithmException impossible){throw new AssertionError(impossible);}}
 private String genesis(){return hash(MAGIC,WireJson.bytes(owner));}
 private static long number(Map<String,Object> m,String k)throws IOException{Object n=m.get(k);require(n instanceof Long&&(Long)n>=0,"AUDIO_ARCHIVE_STATE_INVALID");return (Long)n;}
 private void readState(Map<String,Object> m)throws IOException{
  require(m.keySet().equals(new HashSet<>(Arrays.asList("schema","owner","count","bytes","chain","sealed","recording_complete","source_link_verified")))&&Long.valueOf(1).equals(m.get("schema"))&&owner.equals(m.get("owner"))&&Boolean.FALSE.equals(m.get("recording_complete"))&&Boolean.FALSE.equals(m.get("source_link_verified")),"AUDIO_ARCHIVE_OWNER_OR_STATE_INVALID");
  count=number(m,"count");bytes=number(m,"bytes");require(count<=MAX_RECORDS&&bytes<=MAX_BYTES&&m.get("chain") instanceof String&&((String)m.get("chain")).matches("[a-f0-9]{64}")&&m.get("sealed") instanceof String,"AUDIO_ARCHIVE_STATE_INVALID");chain=(String)m.get("chain");sealed=(String)m.get("sealed");require(sealed.isEmpty()||reason(sealed),"AUDIO_ARCHIVE_STATE_INVALID");
 }
 private Map<String,Object> record(){return WireJson.object("schema",1,"owner",owner,"count",count,"bytes",bytes,"chain",chain,"sealed",sealed,"recording_complete",false,"source_link_verified",false);}
 private void save(Guard guard)throws IOException{admit(guard);checkDocuments();state.save(record());syncDirectory(dir);}
 private byte[] read(int length)throws IOException{ByteBuffer b=ByteBuffer.allocate(length);while(b.hasRemaining())require(channel.read(b)>0,"AUDIO_ARCHIVE_READ_FAILED");return b.array();}
 private static byte[] sizes(int h,int p){return ByteBuffer.allocate(8).putInt(h).putInt(p).array();}
 private static Map<String,Object> header(long sequence,String kind,String message,long received,long elapsed,String clock,String previous)throws IOException{
  require(sequence>0&&sequence<=MAX_RECORDS&&Arrays.asList("A3","A4","A5","link_lost").contains(kind)&&message!=null&&message.length()<=MAX_MESSAGE&&message.getBytes(StandardCharsets.UTF_8).length<=MAX_MESSAGE&&message.equals(new String(message.getBytes(StandardCharsets.UTF_8),StandardCharsets.UTF_8))&&received>0&&elapsed>=0&&clock!=null&&clock.matches("[a-f0-9]{32}"),"AUDIO_ARCHIVE_INPUT_INVALID");
  return WireJson.object("sequence",sequence,"kind",kind,"message",message,"received_at",received,"elapsed_nanos",elapsed,"clock_epoch",clock,"previous",previous);
 }
 private void validateHeader(Map<String,Object> h,long expected,String previous)throws IOException{
  try{Map<String,Object> canonical=header(number(h,"sequence"),(String)h.get("kind"),(String)h.get("message"),number(h,"received_at"),number(h,"elapsed_nanos"),(String)h.get("clock_epoch"),(String)h.get("previous"));require(h.equals(canonical)&&number(h,"sequence")==expected&&previous.equals(h.get("previous")),"AUDIO_ARCHIVE_RECORD_INVALID");}catch(ClassCastException e){throw new IOException("AUDIO_ARCHIVE_RECORD_INVALID");}
 }
 private void recover(Guard guard)throws IOException{
  admit(guard);long length=channel.size();require(length<=MAX_BYTES,"AUDIO_ARCHIVE_BUDGET");long expectedCount=count,expectedBytes=bytes;String expectedChain=chain;boolean matched=expectedCount==0&&expectedBytes==0&&expectedChain.equals(genesis());
  require(length>=8,"AUDIO_ARCHIVE_HEADER_INCOMPLETE");channel.position(0);require(Arrays.equals(read(8),MAGIC),"AUDIO_ARCHIVE_MAGIC");long found=0,offset=8;String previous=genesis();
  if(expectedCount==0&&expectedBytes==8){require(expectedChain.equals(previous),"AUDIO_ARCHIVE_COMMITTED_CORRUPT");matched=true;}
  while(offset<length){admit(guard);long remaining=length-offset;if(remaining<8){tail="partial_header";break;}byte[] sizes=read(8);ByteBuffer n=ByteBuffer.wrap(sizes);int h=n.getInt(),p=n.getInt();if(h<1||h>131072||p<0||p>MAX_PAYLOAD){tail="invalid_lengths";break;}if(remaining<8L+h+p+32){tail="partial_record";break;}
   byte[] meta=read(h),payload=read(p),footer=read(32);String digest=hash(sizes,meta,payload);if(!Arrays.equals(footer,unhex(digest))){tail="checksum_conflict";break;}
   Map<String,Object> parsed;try{parsed=WireJson.map(WireJson.read(meta));validateHeader(parsed,found+1,previous);}catch(IOException|RuntimeException invalid){tail="invalid_metadata";break;}
   require(++found<=MAX_RECORDS,"AUDIO_ARCHIVE_BUDGET");receipts.put(found,hash(WireJson.bytes(identity(parsed)),payload));offset+=8L+h+p+32;previous=digest;
   if(found==expectedCount){require(offset==expectedBytes&&previous.equals(expectedChain),"AUDIO_ARCHIVE_COMMITTED_CORRUPT");matched=true;}
  }
  require(matched,"AUDIO_ARCHIVE_COMMITTED_CORRUPT");if(!sealed.isEmpty())require(offset==length&&found==expectedCount,"AUDIO_ARCHIVE_SEALED_CHANGED");
  count=found;bytes=offset;chain=previous;uncertain=!tail.isEmpty();
  // Never mutate or delete uncertain bytes. A fully checksummed extra record is
  // durable even when the caller did not receive its manifest acknowledgement.
  if(!uncertain&&(count!=expectedCount||bytes!=expectedBytes))save(guard);
 }
 private static Map<String,Object> identity(Map<String,Object> header){Map<String,Object> copy=new TreeMap<>(header);copy.remove("previous");return copy;}
 private static byte[] unhex(String s){byte[] b=new byte[s.length()/2];for(int i=0;i<b.length;i++)b[i]=(byte)Integer.parseInt(s.substring(i*2,i*2+2),16);return b;}
 synchronized boolean append(long sequence,String kind,String message,byte[] payload,long received,long elapsed,String clock,Guard guard)throws IOException{
  require(!closed&&!uncertain&&sealed.isEmpty(),"AUDIO_ARCHIVE_NOT_WRITABLE");admit(guard);require(payload!=null&&payload.length<=MAX_PAYLOAD,"AUDIO_ARCHIVE_INPUT_INVALID");byte[] input=payload.clone();Map<String,Object> h=header(sequence,kind,message,received,elapsed,clock,chain);String identity=hash(WireJson.bytes(identity(h)),input);
  if(sequence<=count){require(identity.equals(receipts.get(sequence)),"AUDIO_ARCHIVE_REPLAY_CONFLICT");return false;}require(sequence==count+1,"AUDIO_ARCHIVE_SEQUENCE_GAP");byte[] meta=WireJson.bytes(h),sizes=sizes(meta.length,input.length);require(meta.length<=131072&&bytes+8L+meta.length+input.length+32<=MAX_BYTES,"AUDIO_ARCHIVE_BUDGET");
  checkDocuments();require(channel.size()==bytes,"AUDIO_ARCHIVE_RAW_CHANGED");String digest=hash(sizes,meta,input);boolean writing=false;
  try{admit(guard);writing=true;channel.position(bytes);for(byte[] part:new byte[][]{sizes,meta,input,unhex(digest)}){ByteBuffer b=ByteBuffer.wrap(part);while(b.hasRemaining())require(channel.write(b)>0,"AUDIO_ARCHIVE_WRITE_FAILED");}channel.force(true);admit(guard);count=sequence;bytes=channel.position();chain=digest;receipts.put(sequence,identity);save(guard);return true;
  }catch(IOException|RuntimeException error){if(writing){uncertain=true;tail="write_or_ack_uncertain";}throw error;}
 }
 static final class Batch {
  final Map<String,Object> metadata;private final byte[] bytes;
  Batch(Map<String,Object> m,byte[] p){metadata=Collections.unmodifiableMap(WireJson.map(WireJson.copy(m)));bytes=p.clone();}
  byte[] payload(){return bytes.clone();}
 }
 interface Visitor {void batch(Batch batch)throws IOException;}
 static long recordBytes(long sequence,String kind,String message,int payloadBytes,long received,long elapsed,String clock)throws IOException{
  require(payloadBytes>=0&&payloadBytes<=MAX_PAYLOAD,"AUDIO_ARCHIVE_INPUT_INVALID");return 40L+WireJson.bytes(header(sequence,kind,message,received,elapsed,clock,"0000000000000000000000000000000000000000000000000000000000000000")).length+payloadBytes;
 }
 synchronized boolean matches(long sequence,String kind,String message,byte[] payload,long received,long elapsed,String clock,Guard guard)throws IOException{
  require(!closed&&payload!=null&&payload.length<=MAX_PAYLOAD,"AUDIO_ARCHIVE_INPUT_INVALID");admit(guard);recover(guard);Map<String,Object> h=header(sequence,kind,message,received,elapsed,clock,chain);return sequence<=count&&hash(WireJson.bytes(identity(h)),payload).equals(receipts.get(sequence));
 }
 /** Only frozen, fully checksummed journals are supplied to a decoder. Callers
  * write derived output to staging and publish it only after this method returns.
  * The journal's source/recording-completeness flags remain independent. */
 synchronized void visit(Visitor visitor,Guard guard)throws IOException{
  require(!closed&&!uncertain&&!sealed.isEmpty()&&visitor!=null,"AUDIO_ARCHIVE_NOT_READABLE");admit(guard);recover(guard);require(!uncertain,"AUDIO_ARCHIVE_NOT_READABLE");long position=channel.position();String previous=genesis();long seen=0;
  try{channel.position(8);while(channel.position()<bytes){admit(guard);byte[] sizes=read(8);ByteBuffer lengths=ByteBuffer.wrap(sizes);int h=lengths.getInt(),p=lengths.getInt();require(h>0&&h<=131072&&p>=0&&p<=MAX_PAYLOAD,"AUDIO_ARCHIVE_COMMITTED_CORRUPT");byte[] meta=read(h),payload=read(p),footer=read(32);String digest=hash(sizes,meta,payload);require(Arrays.equals(footer,unhex(digest)),"AUDIO_ARCHIVE_COMMITTED_CORRUPT");Map<String,Object> parsed=WireJson.map(WireJson.read(meta));validateHeader(parsed,++seen,previous);require(hash(WireJson.bytes(identity(parsed)),payload).equals(receipts.get(seen)),"AUDIO_ARCHIVE_COMMITTED_CORRUPT");previous=digest;admit(guard);visitor.batch(new Batch(parsed,payload));}
   require(seen==count&&previous.equals(chain)&&channel.size()==bytes,"AUDIO_ARCHIVE_RAW_CHANGED");admit(guard);
  }finally{channel.position(position);}
 }
 private static boolean reason(String s){return Arrays.asList("capture_stopped","disconnected","process_interrupted","source_ended","segment_boundary").contains(s);}
 synchronized void seal(String reason,Guard guard)throws IOException{require(!closed&&!uncertain&&reason(reason),"AUDIO_ARCHIVE_NOT_SEALABLE");admit(guard);recover(guard);require(!uncertain,"AUDIO_ARCHIVE_NOT_SEALABLE");if(!sealed.isEmpty()){require(sealed.equals(reason),"AUDIO_ARCHIVE_SEAL_CONFLICT");return;}sealed=reason;try{save(guard);}catch(IOException|RuntimeException error){uncertain=true;tail="seal_ack_uncertain";throw error;}}
 synchronized Map<String,Object> snapshot()throws IOException{require(!closed,"AUDIO_ARCHIVE_CLOSED");Map<String,Object> copy=WireJson.map(WireJson.copy(record()));copy.put("tail_error",tail);copy.put("raw_bytes",channel.size());copy.put("uncertain",uncertain);return copy;}
 public synchronized void close()throws IOException{if(!closed){closed=true;try{channel.close();}finally{state.close();}}}
}
