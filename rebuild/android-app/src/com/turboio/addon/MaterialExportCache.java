package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.util.*;

/** Bounded private preparation for a picker. Only this class's random draft
 * directories may be removed; retained materials are never opened. */
final class MaterialExportCache {
 static final long TTL=24L*60*60*1000;static final int MAX_BYTES=4194304,MAX_DRAFTS=8;
 static final class Draft {
  final String id,account,title,format,mime,digest;final long created,size;
  Draft(String id,String account,String title,String format,String mime,String digest,long created,long size){this.id=id;this.account=account;this.title=title;this.format=format;this.mime=mime;this.digest=digest;this.created=created;this.size=size;}
 }
 private static void require(boolean ok)throws IOException{if(!ok)throw new IOException("MATERIAL_EXPORT_CACHE_INVALID");}
 private static File root(File cache)throws IOException{File root=new File(cache.getCanonicalFile(),"io-material-document-exports");require(!Files.isSymbolicLink(root.toPath()));if(!root.isDirectory()&&!root.mkdirs())throw new IOException("MATERIAL_EXPORT_CACHE_UNAVAILABLE");return root;}
 private static File directory(File cache,String id)throws IOException{require(id!=null&&id.matches("[a-f0-9]{32}"));File dir=new File(root(cache),id);require(!Files.isSymbolicLink(dir.toPath())&&dir.getCanonicalFile().equals(dir.getAbsoluteFile()));return dir;}
 private static void write(File file,byte[] bytes)throws IOException{try(FileOutputStream stream=new FileOutputStream(file)){stream.write(bytes);stream.getFD().sync();}}
 static synchronized Draft prepare(File cache,String account,MaterialCatalog.Entry entry,MaterialDocument.Format format,long now)throws IOException{
  require(account!=null&&account.matches("[a-f0-9]{64}")&&now>0);byte[] bytes=MaterialDocument.encode(entry,format);require(bytes.length>0&&bytes.length<=MAX_BYTES);File root=root(cache);prune(cache,now);File[] children=root.listFiles();require(children!=null&&children.length<MAX_DRAFTS);
  String id=UUID.randomUUID().toString().replace("-","");File dir=directory(cache,id);require(dir.mkdir());Draft draft=new Draft(id,account,MaterialDocument.filename(entry,format),format.name(),format.mime,TaskWire.hash(bytes),now,bytes.length);
  try{write(new File(dir,"document.partial"),bytes);Files.move(new File(dir,"document.partial").toPath(),new File(dir,"document.bin").toPath(),StandardCopyOption.ATOMIC_MOVE);
   byte[] manifest=WireJson.bytes(WireJson.object("schema",1,"id",id,"account",account,"title",draft.title,"format",draft.format,"mime",draft.mime,"sha256",draft.digest,"created",now,"size",bytes.length));write(new File(dir,"manifest.partial"),manifest);Files.move(new File(dir,"manifest.partial").toPath(),new File(dir,"manifest.json").toPath(),StandardCopyOption.ATOMIC_MOVE);return draft;
  }catch(IOException|RuntimeException failed){try{remove(cache,id);}catch(IOException ignored){}throw failed;}
 }
 static synchronized Draft load(File cache,String id,String expectedAccount,String expectedFormat,String expectedTitle,long now)throws IOException{
  File dir=directory(cache,id),manifest=new File(dir,"manifest.json");require(dir.isDirectory()&&!Files.isSymbolicLink(manifest.toPath())&&manifest.isFile()&&manifest.length()<=4096);
  try{Map<String,Object> value=WireJson.map(WireJson.read(Files.readAllBytes(manifest.toPath()),4096,100));BoundedJson.keys(value,"schema","id","account","title","format","mime","sha256","created","size");require(MaterialWire.positive(value.get("schema"))==1&&id.equals(value.get("id"))&&expectedAccount!=null&&expectedAccount.matches("[a-f0-9]{64}")&&expectedAccount.equals(value.get("account"))&&expectedFormat.equals(value.get("format"))&&expectedTitle.equals(value.get("title")));
   MaterialDocument.Format format=MaterialDocument.Format.valueOf(expectedFormat);String title=(String)value.get("title"),digest=(String)value.get("sha256");long created=MaterialWire.positive(value.get("created")),size=MaterialWire.positive(value.get("size"));require(format.mime.equals(value.get("mime"))&&title.matches("iO-[0-9]{8}-[0-9]{4}-[a-f0-9]{8}\\."+format.extension)&&digest.matches("[a-f0-9]{64}")&&size<=MAX_BYTES);
   if(now<created||now-created>TTL)throw new IOException("MATERIAL_EXPORT_CACHE_EXPIRED");return new Draft(id,expectedAccount,title,expectedFormat,format.mime,digest,created,size);
  }catch(IllegalArgumentException|ClassCastException|NullPointerException invalid){throw new IOException("MATERIAL_EXPORT_CACHE_INVALID");}
 }
 static synchronized byte[] bytes(File cache,Draft draft,long now)throws IOException{
  Draft checked=load(cache,draft.id,draft.account,draft.format,draft.title,now);File file=new File(directory(cache,draft.id),"document.bin");require(!Files.isSymbolicLink(file.toPath())&&file.isFile()&&file.length()==checked.size&&file.length()<=MAX_BYTES);byte[] bytes=Files.readAllBytes(file.toPath());require(bytes.length==checked.size&&TaskWire.hash(bytes).equals(checked.digest));return bytes;
 }
 static synchronized void remove(File cache,String id)throws IOException{
  File dir=directory(cache,id);if(!dir.exists())return;require(dir.isDirectory());File[] files=dir.listFiles();require(files!=null);Set<String> owned=new HashSet<>(Arrays.asList("document.partial","document.bin","manifest.partial","manifest.json"));for(File file:files)require(owned.contains(file.getName())&&!Files.isSymbolicLink(file.toPath())&&file.isFile());for(File file:files)if(!file.delete())throw new IOException("MATERIAL_EXPORT_CACHE_UNAVAILABLE");require(dir.delete());
 }
 static synchronized void prune(File cache,long now)throws IOException{
  File[] directories=root(cache).listFiles();require(directories!=null);for(File dir:directories){if(!dir.getName().matches("[a-f0-9]{32}")||Files.isSymbolicLink(dir.toPath())||!dir.isDirectory())continue;File manifest=new File(dir,"manifest.json");long created=dir.lastModified();if(manifest.isFile()&&!Files.isSymbolicLink(manifest.toPath())&&manifest.length()<=4096)try{created=MaterialWire.positive(WireJson.map(WireJson.read(Files.readAllBytes(manifest.toPath()),4096,100)).get("created"));}catch(RuntimeException ignored){}if(created>0&&now>=created&&now-created>TTL)try{remove(cache,dir.getName());}catch(IOException ignored){}}
 }
}
