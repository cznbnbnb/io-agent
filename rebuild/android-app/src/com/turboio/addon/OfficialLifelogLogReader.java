package com.turboio.addon;

import java.io.*;import java.net.*;import java.nio.*;import java.nio.channels.*;import java.nio.charset.*;import java.nio.file.*;import java.nio.file.attribute.*;import java.util.*;import java.util.regex.*;

/** Bounded read-only discovery of official full-event responses already loaded by
 * the host. No network, tokens, upload or deletion inference. The import owner must
 * separately validate account/record binding and JSON schema before using content. */
public final class OfficialLifelogLogReader {
 public static final int MAX_LINE=1048576,MAX_FILES=32,MAX_SCAN=16777216;
 private static final Pattern REQUEST=Pattern.compile("\\[GET ([^\\]\\s]{1,4096})\\]");
 private static final Pattern EVENT_PATH=Pattern.compile("/lifelog/api/v1/events/([A-Za-z0-9_-]{1,80})/full");
 public interface Sink {void accept(Detail detail)throws Exception;}
 public static final class Detail {
  public final String eventId;public final byte[] json;public final long fileModified,lineOffset;
  private Detail(String id,byte[] json,long modified,long offset){eventId=id;this.json=json;fileModified=modified;lineOffset=offset;}
 }
 public static final class Summary {
  public int files,details,oversizedLines,invalidUtf8,skippedFiles,partialTails,changedFiles;public long bytes;public boolean budgetReached,complete;
 }
 public static Detail parse(byte[] line,long modified,long offset)throws CharacterCodingException {
  if(line==null||line.length>MAX_LINE)return null;
  String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(line)).toString();
  int body=text.indexOf("response body:");if(body<0)return null;
  String prefix=text.substring(0,body);if(!prefix.contains("[Interceptor.Http]")||!prefix.contains("←"))return null;
  Matcher match=REQUEST.matcher(prefix);if(!match.find()||match.find())return null;
  match.reset();match.find();String id;
  try{URI target=new URI(match.group(1));
   // The official logger renders an empty query and fragment as "?#".
   // Empty delimiters do not change the fetched resource; nonempty fragments
   // and userinfo remain invalid for this response channel.
   if(target.getRawFragment()!=null&&!target.getRawFragment().isEmpty()||target.getRawUserInfo()!=null)return null;
   if(target.isAbsolute()){if(!"https".equals(target.getScheme())||!"xr-api-p.rayneo.cn".equals(target.getHost())||(target.getPort()!=-1&&target.getPort()!=443))return null;}
   else if(target.getRawAuthority()!=null)return null;
   Matcher endpoint=EVENT_PATH.matcher(target.getRawPath());if(!endpoint.matches())return null;id=endpoint.group(1);
  }catch(URISyntaxException invalid){return null;}
  // Query parameters select the already-fetched representation; they are never
  // exported. Importers must still bind this path ID to the body and account.
  String json=text.substring(body+"response body:".length()).trim();if(!framed(json))return null;
  return new Detail(id,json.getBytes(StandardCharsets.UTF_8),modified,offset);
 }
 /** Framing only; caller still performs strict schema/JSON validation. */
 private static boolean framed(String text){
  if(!text.startsWith("{")||!text.endsWith("}"))return false;char[] stack=new char[32];int depth=0;boolean string=false,escape=false;
  for(int i=0;i<text.length();i++){char c=text.charAt(i);if(string){if(escape){escape=false;continue;}if(c=='\\'){escape=true;continue;}if(c=='"')string=false;else if(c<32)return false;continue;}
   if(c=='"')string=true;else if(c=='{'||c=='['){if(depth==stack.length)return false;stack[depth++]=c;}
   else if(c=='}'||c==']'){if(depth==0||stack[--depth]!=(c=='}'?'{':'['))return false;if(depth==0&&i!=text.length()-1)return false;}
  }return depth==0&&!string&&!escape;
 }
 public static Summary scan(File directory,Sink sink)throws Exception {
  return open(directory).next(sink);
 }
 /** Freeze a bounded file inventory. Each next() reads at most MAX_SCAN bytes;
  * continuation retains split UTF-8/JSON lines without rereading earlier files.
  * Appends after inventory creation are handled by the next inventory, not mixed
  * into this one. Complete means this selected inventory, never full history. */
 public static Session open(File directory)throws IOException {
  if(directory==null)throw new IllegalArgumentException("LIFELOG_SCAN_INVALID");
  Summary result=new Summary();if(!directory.isDirectory())return new Session(new ArrayList<>(),0);
  File root=directory.getCanonicalFile();if(Files.isSymbolicLink(directory.toPath()))throw new IOException("LIFELOG_SOURCE_LINK");
  String boundary=root.getPath()+File.separator;List<File> files=new ArrayList<>();ArrayDeque<File> pending=new ArrayDeque<>();pending.add(root);int visited=0;
  while(!pending.isEmpty()&&visited++<512){File next=pending.removeFirst();File[] children=next.listFiles();if(children==null){result.skippedFiles++;continue;}
   for(File child:children){if(Files.isSymbolicLink(child.toPath())||!child.getCanonicalPath().startsWith(boundary)){result.skippedFiles++;continue;}
    if(child.isDirectory()){if(next.equals(root)&&pending.size()<128)pending.add(child);else result.skippedFiles++;}
    else if(child.getName().endsWith(".log")&&child.length()>0)files.add(child);
   }
  }
  // Spend the bounded scan on recent activity first; older logs must not starve
  // the responses the user just loaded. Consumers use timestamps for revisions.
  files.sort(Comparator.comparingLong(File::lastModified).thenComparing(File::getName).reversed());
  if(files.size()>MAX_FILES){result.skippedFiles+=files.size()-MAX_FILES;files=new ArrayList<>(files.subList(0,MAX_FILES));}
  List<SourceFile> snapshots=new ArrayList<>();for(File file:files)try{snapshots.add(new SourceFile(file));}catch(NoSuchFileException rotated){result.skippedFiles++;}
  return new Session(snapshots,result.skippedFiles);
 }
 private static final class SourceFile {
  final File file;final long length,modified;final Object key;
  SourceFile(File file)throws IOException{this.file=file.getCanonicalFile();BasicFileAttributes a=Files.readAttributes(file.toPath(),BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);if(!a.isRegularFile())throw new IOException("LIFELOG_SOURCE_CHANGED");length=a.size();modified=a.lastModifiedTime().toMillis();key=a.fileKey();}
  boolean unchanged()throws IOException{if(!file.getCanonicalFile().equals(file)||Files.isSymbolicLink(file.toPath()))return false;BasicFileAttributes a=Files.readAttributes(file.toPath(),BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);return a.isRegularFile()&&Objects.equals(key,a.fileKey())&&a.size()>=length&&(a.size()>length||a.lastModifiedTime().toMillis()==modified);}
 }
 public static final class Session {
  private final List<SourceFile> files;private final int skipped;private int index;private long offset,start;private boolean oversized,reportedInventory;private final ByteArrayOutputStream line=new ByteArrayOutputStream();private Detail ready;
  private Session(List<SourceFile> files,int skipped){this.files=files;this.skipped=skipped;}
  public boolean complete(){return index>=files.size()&&ready==null;}
  public Summary next(Sink sink)throws Exception{return next(sink,MAX_SCAN);}
  synchronized Summary next(Sink sink,int budget)throws Exception {
   if(sink==null||budget<=0||budget>MAX_SCAN)throw new IllegalArgumentException("LIFELOG_SCAN_INVALID");
   Summary result=new Summary();if(!reportedInventory){result.skippedFiles=skipped;reportedInventory=true;}
   // A consumer failure retains the exact response for retry, including when
   // the source subsequently rotates. No subsequent line is acknowledged yet.
   if(ready!=null){sink.accept(ready);ready=null;result.details++;}
   while(index<files.size()&&result.bytes<budget){SourceFile source=files.get(index);result.files++;
    boolean unchanged;try{unchanged=source.unchanged();}catch(NoSuchFileException rotated){unchanged=false;}
    if(!unchanged){result.changedFiles++;advance();continue;}
    try(SeekableByteChannel in=Files.newByteChannel(source.file.toPath(),StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){
     in.position(offset);ByteBuffer buffer=ByteBuffer.allocate(8192);
     while(offset<source.length&&result.bytes<budget){
      if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("LIFELOG_SCAN_INTERRUPTED");
      buffer.clear();buffer.limit((int)Math.min(buffer.capacity(),Math.min(source.length-offset,budget-result.bytes)));int n=in.read(buffer);
      if(n<0){result.changedFiles++;advance();break;}if(n==0)throw new IOException("LIFELOG_READ_STALLED");buffer.flip();
      while(buffer.hasRemaining()){int value=buffer.get()&255;result.bytes++;offset++;
       if(value==10){byte[] raw=oversized?null:line.toByteArray();long lineStart=start;boolean wasOversized=oversized;line.reset();oversized=false;start=offset;
        if(wasOversized)result.oversizedLines++;
        else{try{ready=parse(raw,source.modified,lineStart);}catch(CharacterCodingException invalid){result.invalidUtf8++;}
         if(ready!=null){sink.accept(ready);ready=null;result.details++;}}
       }else if(!oversized){if(line.size()>=MAX_LINE){oversized=true;line.reset();}else line.write(value);}
      }
     }
     if(index<files.size()&&files.get(index)==source&&offset>=source.length){if(oversized||line.size()!=0)result.partialTails++;advance();}
    }
   }
   result.complete=complete();result.budgetReached=!result.complete&&result.bytes>=budget;return result;
  }
  private void advance(){index++;offset=0;start=0;line.reset();oversized=false;}
 }
}
