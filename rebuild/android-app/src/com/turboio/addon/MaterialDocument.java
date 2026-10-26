package com.turboio.addon;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.zip.*;

/** Exports exactly the selected retained revision, without network, audio or macros. */
final class MaterialDocument {
 enum Format {
  DOCX("Word 文档 (.docx)","docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  MARKDOWN("Markdown (.md)","md","text/markdown"),TEXT("纯文本 (.txt)","txt","text/plain");
  final String label,extension,mime;Format(String label,String extension,String mime){this.label=label;this.extension=extension;this.mime=mime;}
 }
 static String filename(MaterialCatalog.Entry entry,Format format){return "iO-"+DateTimeFormatter.ofPattern("yyyyMMdd-HHmm",Locale.ROOT).format(Instant.ofEpochMilli(entry.startedAt).atZone(entry.zone))+"-"+TaskWire.hash(entry.id.getBytes(StandardCharsets.UTF_8)).substring(0,8)+"."+format.extension;}
 static String segmentTime(MaterialCatalog.Segment segment){if(segment.start==null)return "时间未标定";return elapsed(segment.start)+" – "+elapsed(segment.end);}
 private static String elapsed(long ms){long seconds=ms/1000;return String.format(Locale.ROOT,"%02d:%02d:%02d",seconds/3600,seconds/60%60,seconds%60);}
 private static List<String> lines(MaterialCatalog.Entry e){
  List<String> out=new ArrayList<>();out.add(e.title);out.add("记录时间："+e.day+" "+e.timeRange()+"（"+e.zone.getId()+"）");out.add("文字修订："+e.revision+" · "+e.coverage);out.add("同步状态："+e.syncLabel());out.add("");out.add("转写正文");out.add(e.fullText.isEmpty()?"暂无转写正文":e.fullText);
  if(!e.segments.isEmpty()){out.add("");out.add("逐段原文（时间相对记录开头；说话人沿用原记录标签）");for(MaterialCatalog.Segment segment:e.segments){out.add(segmentTime(segment)+" · "+segment.speaker);out.add(segment.text);out.add("");}}
  out.add("");out.add("资料编号："+e.id);return out;
 }
 static byte[] encode(MaterialCatalog.Entry entry,Format format)throws IOException{
  if(entry==null||format==null)throw new IOException("MATERIAL_EXPORT_INVALID");List<String> lines=lines(entry);
  if(format!=Format.DOCX){StringJoiner join=new StringJoiner("\n");for(int i=0;i<lines.size();i++){String line=lines.get(i);join.add(format==Format.MARKDOWN&&i==0?"# "+line:line);}return (join.toString()+"\n").getBytes(StandardCharsets.UTF_8);}
  ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(ZipOutputStream zip=new ZipOutputStream(bytes)){
   part(zip,"[Content_Types].xml","<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>");
   part(zip,"_rels/.rels","<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>");
   StringBuilder body=new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>");
   for(int i=0;i<lines.size();i++)for(String line:lines.get(i).split("\\R",-1)){body.append("<w:p><w:r>");if(i==0)body.append("<w:rPr><w:b/><w:sz w:val=\"32\"/></w:rPr>");body.append("<w:t xml:space=\"preserve\">").append(xml(line)).append("</w:t></w:r></w:p>");}
   body.append("<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1134\" w:right=\"1134\" w:bottom=\"1134\" w:left=\"1134\"/></w:sectPr></w:body></w:document>");part(zip,"word/document.xml",body.toString());
  }return bytes.toByteArray();
 }
 private static void part(ZipOutputStream zip,String name,String content)throws IOException{ZipEntry entry=new ZipEntry(name);entry.setTime(0);zip.putNextEntry(entry);zip.write(content.getBytes(StandardCharsets.UTF_8));zip.closeEntry();}
 private static String xml(String text){StringBuilder safe=new StringBuilder();text.codePoints().forEach(cp->{if(cp==9||cp==10||cp==13||(cp>=32&&cp<=0xd7ff)||(cp>=0xe000&&cp<=0xfffd)||(cp>=0x10000&&cp<=0x10ffff))safe.appendCodePoint(cp);});return safe.toString().replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;");}
}
