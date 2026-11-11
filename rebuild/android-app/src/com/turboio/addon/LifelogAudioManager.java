package com.turboio.addon;
import java.io.*;import java.nio.channels.*;import java.nio.file.*;import java.util.*;

/** One global writer and raw-byte budget across account-isolated journals.
 * Explicit local reception sequences survive segment rotation and lost replies.
 * No source association, collector, audio decoding, deletion or upload here. */
final class LifelogAudioManager implements AutoCloseable {
 static final class Limits {
  final long total,segment,commitMillis;final int streams;
  Limits(long total,long segment,int streams)throws IOException{this(total,segment,streams,0);}
  /** commitMillis is the journal's group-commit window; it is not part of the stored limits. */
  Limits(long total,long segment,int streams,long commitMillis)throws IOException{require(total>=512&&total<=2147483648L&&segment>=512&&segment<=LifelogAudioArchive.MAX_BYTES&&segment<=total&&streams>0&&streams<=256&&commitMillis>=0&&commitMillis<=60000,"AUDIO_MANAGER_LIMITS");this.total=total;this.segment=segment;this.streams=streams;this.commitMillis=commitMillis;}
  static Limits standard()throws IOException{return new Limits(536870912,8388608,256,LifelogAudioArchive.COMMIT_MS);}
  Map<String,Object> value(){return WireJson.object("raw_bytes",total,"segment_bytes",segment,"segments",(long)streams);}
 }
 private final File files,base;private final Limits limits;private final Map<String,Object> context;private final LifelogAudioArchive.Guard guard;private final AtomicDocument index;
 private List<Object> rows=new ArrayList<>();private LifelogAudioArchive active;private Map<String,Object> current;private boolean closed,failed;
 // usage() lists every journal of every account. This manager is the only writer, so between
 // rescans the total is the last scan plus what was appended here.
 private long usageBytes,usageAt;private boolean usageKnown;
 LifelogAudioManager(File files,String account,String peer,long generation,String clock,Limits limits,LifelogAudioArchive.Guard guard)throws IOException{
  require(account!=null&&account.matches("[a-f0-9]{64}")&&peer!=null&&peer.matches("[a-f0-9]{64}")&&generation>0&&clock!=null&&clock.matches("[a-f0-9]{32}")&&limits!=null&&guard!=null,"AUDIO_MANAGER_CONTEXT");this.guard=guard;guard.check();this.files=files.getCanonicalFile();require(this.files.isDirectory()&&!Files.isSymbolicLink(files.toPath()),"AUDIO_MANAGER_PATH");this.limits=limits;context=WireJson.object("account",account,"peer",peer,"generation",generation,"clock_epoch",clock);
  base=new File(this.files,"lifelog-audio");if(!base.exists()){require(base.mkdir(),"AUDIO_MANAGER_DIRECTORY");sync(this.files);}paths();AtomicDocument opened=null;
  try{opened=new AtomicDocument(new File(base,"manager.json"),1048576);index=opened;Object saved=index.read();if(saved==null)commit();else decode(WireJson.map(saved));usage();recover();}
  catch(IOException|RuntimeException e){if(active!=null)try{active.close();}catch(IOException ignored){}if(opened!=null)try{opened.close();}catch(IOException ignored){}throw e;}
 }
 private static void require(boolean b,String code)throws IOException{if(!b)throw new IOException(code);}
 private static void sync(File f)throws IOException{try(FileChannel c=FileChannel.open(f.toPath(),StandardOpenOption.READ)){c.force(true);}}
 private static void path(File f,boolean directory)throws IOException{require(!Files.isSymbolicLink(f.toPath())&&f.getAbsoluteFile().equals(f.getCanonicalFile()),"AUDIO_MANAGER_PATH");if(f.exists())require(directory?f.isDirectory():f.isFile(),"AUDIO_MANAGER_PATH");}
 private void paths()throws IOException{path(base,true);for(String n:new String[]{"manager.json","manager.json.partial","manager.json.lock"})path(new File(base,n),false);}
 private static long n(Map<String,Object> m,String key)throws IOException{Object v=m.get(key);require((v instanceof Long||v instanceof Integer)&&((Number)v).longValue()>=0,"AUDIO_MANAGER_STATE");return ((Number)v).longValue();}
 private static Map<String,Object> row(Object v){return WireJson.map(v);}
 private boolean ours(Map<String,Object> r){return context.equals(r.get("context"));}
 private boolean account(Map<String,Object> r){return context.get("account").equals(row(r.get("context")).get("account"));}
 private void decode(Map<String,Object> doc)throws IOException{
  require(doc.keySet().equals(new HashSet<>(Arrays.asList("schema","limits","segments")))&&Long.valueOf(1).equals(doc.get("schema"))&&limits.value().equals(doc.get("limits")),"AUDIO_MANAGER_STATE");rows=WireJson.list(doc.get("segments"));require(rows.size()<=limits.streams,"AUDIO_MANAGER_STATE");Set<String> ids=new HashSet<>();
  for(Object v:rows){Map<String,Object> r=row(v);require(r.keySet().equals(new HashSet<>(Arrays.asList("context","stream","first_sequence","count","phase","error")))&&r.get("stream") instanceof String&&((String)r.get("stream")).matches("[a-f0-9]{32}")&&ids.add((String)r.get("stream")),"AUDIO_MANAGER_STATE");Map<String,Object> c=row(r.get("context"));require(c.keySet().equals(context.keySet())&&c.get("account") instanceof String&&((String)c.get("account")).matches("[a-f0-9]{64}")&&c.get("peer") instanceof String&&((String)c.get("peer")).matches("[a-f0-9]{64}")&&n(c,"generation")>0&&c.get("clock_epoch") instanceof String&&((String)c.get("clock_epoch")).matches("[a-f0-9]{32}"),"AUDIO_MANAGER_STATE");require(n(r,"first_sequence")>0&&n(r,"first_sequence")<Long.MAX_VALUE-LifelogAudioArchive.MAX_RECORDS&&n(r,"count")<=LifelogAudioArchive.MAX_RECORDS&&Arrays.asList("allocating","open","sealed","quarantined").contains(r.get("phase"))&&r.get("error") instanceof String&&((String)r.get("error")).matches("[A-Z_]{0,90}"),"AUDIO_MANAGER_STATE");}
  // Intervals may touch but never overlap, even after a crash or quarantine.
  for(int i=0;i<rows.size();i++)for(int j=0;j<i;j++){Map<String,Object> a=row(rows.get(i)),b=row(rows.get(j));if(a.get("context").equals(b.get("context"))&&n(a,"count")>0&&n(b,"count")>0)require(n(a,"first_sequence")+n(a,"count")<=n(b,"first_sequence")||n(b,"first_sequence")+n(b,"count")<=n(a,"first_sequence"),"AUDIO_MANAGER_STATE");}
 }
 private void commit()throws IOException{try{guard.check();paths();index.save(WireJson.object("schema",1,"limits",limits.value(),"segments",rows));sync(base);}catch(IOException|RuntimeException e){failed=true;throw e;}}
 /** Count raw journal bytes across all accounts, including unowned/uncertain
  * journals. Metadata files are separately bounded by directory/segment limits. */
 private long usage()throws IOException{
  guard.check();paths();File[] accounts=base.listFiles();require(accounts!=null&&accounts.length<=515,"AUDIO_MANAGER_SCAN_BUDGET");long bytes=0;int segments=0;
  for(File a:accounts){if(a.getName().startsWith("manager.json")){require(Arrays.asList("manager.json","manager.json.partial","manager.json.lock").contains(a.getName()),"AUDIO_MANAGER_PATH");path(a,false);require(a.length()<=1048576,"AUDIO_MANAGER_SCAN_BUDGET");continue;}require(a.getName().matches("[a-f0-9]{64}"),"AUDIO_MANAGER_PATH");path(a,true);File[] streams=a.listFiles();require(streams!=null,"AUDIO_MANAGER_PATH");for(File s:streams){require(++segments<=512&&s.getName().matches("[a-f0-9]{32}"),"AUDIO_MANAGER_SCAN_BUDGET");path(s,true);File[] contents=s.listFiles();require(contents!=null&&contents.length<=4,"AUDIO_MANAGER_PATH");for(File f:contents){require(Arrays.asList("original.frames","state.json","state.json.partial","state.json.lock").contains(f.getName()),"AUDIO_MANAGER_PATH");path(f,false);if(f.getName().equals("original.frames")){require(f.length()<=LifelogAudioArchive.MAX_BYTES,"AUDIO_MANAGER_CAPACITY");bytes=Math.addExact(bytes,f.length());}else require(f.length()<=65536,"AUDIO_MANAGER_SCAN_BUDGET");}}}
  return bytes;
 }
 private long knownUsage(boolean fresh)throws IOException{long now=System.nanoTime();if(fresh||!usageKnown||now-usageAt>=30000000000L){usageBytes=usage();usageAt=now;usageKnown=true;}else guard.check();return usageBytes;}
 private void capacity(long extra,boolean fresh)throws IOException{require(knownUsage(fresh)+extra<=limits.total,"AUDIO_MANAGER_CAPACITY");require(base.getUsableSpace()>=67108864L+extra,"AUDIO_MANAGER_DISK_FULL");}
 private LifelogAudioArchive open(Map<String,Object> r)throws IOException{Map<String,Object> c=row(r.get("context"));return new LifelogAudioArchive(files,(String)c.get("account"),(String)c.get("peer"),n(c,"generation"),(String)r.get("stream"),guard,limits.commitMillis);}
 private static String error(Exception e){String s=e.getMessage();return s!=null&&s.matches("[A-Z_]{3,90}")?s:"AUDIO_MANAGER_ARCHIVE_UNAVAILABLE";}
 private void recover()throws IOException{
  Map<Object,Integer> openRows=new HashMap<>();for(Object value:rows){Map<String,Object> r=row(value);if(account(r)&&Arrays.asList("allocating","open").contains(r.get("phase"))){int count=openRows.getOrDefault(r.get("context"),0)+1;require(count<=1,"AUDIO_MANAGER_MULTIPLE_OPEN");openRows.put(r.get("context"),count);}}boolean changed=false;for(Object value:rows){Map<String,Object> r=row(value);if(!account(r)||!Arrays.asList("allocating","open").contains(r.get("phase")))continue;LifelogAudioArchive a=null;
   try{a=open(r);Map<String,Object> snap=a.snapshot();require(n(snap,"count")>=n(r,"count"),"AUDIO_MANAGER_RECEIPTS_LOST");r.put("count",n(snap,"count"));String phase=Boolean.TRUE.equals(snap.get("uncertain"))?"quarantined":((String)snap.get("sealed")).isEmpty()?"open":"sealed";if(phase.equals("open")&&!ours(r)){a.seal("process_interrupted",guard);phase="sealed";}r.put("phase",phase);r.put("error",phase.equals("quarantined")?"AUDIO_MANAGER_UNCERTAIN_TAIL":"");if(phase.equals("open")){require(active==null,"AUDIO_MANAGER_MULTIPLE_OPEN");active=a;current=r;a=null;}changed=true;
   }catch(IOException e){guard.check();r.put("phase","quarantined");r.put("error",error(e));changed=true;}finally{if(a!=null)a.close();}
  }if(changed)commit();
 }
 private long through()throws IOException{long next=0;for(Object value:rows){Map<String,Object> r=row(value);if(ours(r)&&n(r,"count")>0)next=Math.max(next,n(r,"first_sequence")+n(r,"count")-1);}return next;}
 private void writable()throws IOException{require(!closed&&!failed,"AUDIO_MANAGER_CLOSED_OR_UNCERTAIN");guard.check();}
 private void allocate(long first)throws IOException{
  require(rows.size()<limits.streams,"AUDIO_MANAGER_SEGMENTS_FULL");String stream=UUID.randomUUID().toString().replace("-","");current=WireJson.object("context",WireJson.copy(context),"stream",stream,"first_sequence",first,"count",0,"phase","allocating","error","");rows.add(current);commit();
  try{active=open(current);current.put("phase","open");commit();}catch(IOException|RuntimeException e){failed=true;throw e;}
 }
 synchronized boolean append(long sequence,String kind,String message,byte[] payload,long received,long elapsed)throws IOException{
  writable();require(payload!=null,"AUDIO_ARCHIVE_INPUT_INVALID");String clock=(String)context.get("clock_epoch");long last=through();
  if(sequence<=last){Map<String,Object> found=null;for(Object v:rows){Map<String,Object> r=row(v);if(ours(r)&&sequence>=n(r,"first_sequence")&&sequence<n(r,"first_sequence")+n(r,"count")){require(found==null,"AUDIO_MANAGER_STATE");found=r;}}require(found!=null,"AUDIO_MANAGER_REPLAY_CONFLICT");LifelogAudioArchive a=found==current?active:open(found);try{require(a.matches(sequence-n(found,"first_sequence")+1,kind,message,payload,received,elapsed,clock,guard),"AUDIO_MANAGER_REPLAY_CONFLICT");return false;}finally{if(a!=active)a.close();}}
  require(sequence==last+1,"AUDIO_MANAGER_SEQUENCE_GAP");long local=active==null?1:n(active.snapshot(),"count")+1;long cost=LifelogAudioArchive.recordBytes(local>LifelogAudioArchive.MAX_RECORDS?1:local,kind,message,payload.length,received,elapsed,clock);boolean rotate=active!=null&&(n(active.snapshot(),"raw_bytes")+cost>limits.segment||local>LifelogAudioArchive.MAX_RECORDS);
  if(rotate||active==null){cost=LifelogAudioArchive.recordBytes(1,kind,message,payload.length,received,elapsed,clock);require(cost+8<=limits.segment,"AUDIO_MANAGER_BATCH_TOO_LARGE");capacity(cost+8,true);require(rows.size()<limits.streams,"AUDIO_MANAGER_SEGMENTS_FULL");if(rotate)end("segment_boundary");allocate(sequence);local=1;usageBytes+=8;}else capacity(cost,false);
  // The index follows the archive's group commit: it may lag the journal, never lead it,
  // and recover() already adopts a journal that holds more receipts than the index.
  try{boolean added=active.append(local,kind,message,payload,received,elapsed,clock,guard);if(added)usageBytes+=cost;current.put("count",n(active.snapshot(),"count"));if(active.durable())commit();return added;}catch(IOException|RuntimeException e){failed=true;throw e;}
 }
 /** Commit batches still inside the archive's group window (input paused, status read). */
 synchronized void flush()throws IOException{writable();if(active==null||active.durable())return;try{active.flush(guard);current.put("count",n(active.snapshot(),"count"));commit();}catch(IOException|RuntimeException e){failed=true;throw e;}}
 synchronized void end(String reason)throws IOException{writable();if(active==null)return;try{active.seal(reason,guard);current.put("phase","sealed");commit();active.close();active=null;current=null;}catch(IOException|RuntimeException e){failed=true;throw e;}}
 synchronized void visit(long first,LifelogAudioArchive.Visitor visitor)throws IOException{writable();Map<String,Object> found=null;for(Object v:rows){Map<String,Object> r=row(v);if(ours(r)&&n(r,"first_sequence")==first&&n(r,"count")>0){require(found==null,"AUDIO_MANAGER_STATE");found=r;}}require(found!=null&&"sealed".equals(found.get("phase")),"AUDIO_MANAGER_NOT_READABLE");try(LifelogAudioArchive a=open(found)){a.visit(visitor,guard);}}
 synchronized List<Object> catalog()throws IOException{require(!closed,"AUDIO_MANAGER_CLOSED_OR_UNCERTAIN");guard.check();List<Object> found=new ArrayList<>();for(Object value:rows)if(account(row(value)))found.add(WireJson.copy(value));return found;}
 synchronized void visitStream(String stream,LifelogAudioArchive.Visitor visitor)throws IOException{writable();Map<String,Object> found=null;for(Object value:rows){Map<String,Object> r=row(value);if(account(r)&&Objects.equals(stream,r.get("stream")))found=r;}require(found!=null&&"sealed".equals(found.get("phase")),"AUDIO_MANAGER_NOT_READABLE");try(LifelogAudioArchive a=open(found)){a.visit(visitor,guard);}}
 synchronized Map<String,Object> snapshot()throws IOException{require(!closed,"AUDIO_MANAGER_CLOSED_OR_UNCERTAIN");guard.check();List<Object> selected=new ArrayList<>();int attention=0;for(Object v:rows){Map<String,Object> r=row(v);if(ours(r))selected.add(WireJson.copy(r));if(account(r)&&"quarantined".equals(r.get("phase")))attention++;}return WireJson.object("context",WireJson.copy(context),"segments",selected,"raw_bytes_all_accounts",usage(),"next_sequence",through()+1,"needs_attention",attention,"unavailable",failed,"recording_complete",false,"source_link_verified",false);}
 public synchronized void close()throws IOException{if(!closed){closed=true;try{if(active!=null)active.close();}finally{index.close();}}}
}
