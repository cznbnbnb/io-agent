package com.turboio.addon;
import java.io.*;import java.nio.charset.*;import java.nio.file.*;import java.util.*;
public final class OfficialLifelogLogReaderTest {
 static int checks;static void yes(boolean value){checks++;if(!value)throw new AssertionError("Lifelog source "+checks);}
 static final String ID="0123456789abcdef0123456789abcdef";
 static String line(String body){return "[time] [Interceptor.Http] ← [GET https://xr-api-p.rayneo.cn/lifelog/api/v1/events/"+ID+"/full] response body: "+body;}
 static byte[] bytes(String s){return s.getBytes(StandardCharsets.UTF_8);}
 public static void main(String[] args)throws Exception{
  String body="{\"data\":{\"id\":\""+ID+"\",\"transcriptionContents\":\"合成原文，不执行任何任务。\\n补充完整条件。\"}}";
  OfficialLifelogLogReader.Detail detail=OfficialLifelogLogReader.parse(bytes(line(body)),10,20);
  yes(detail!=null&&ID.equals(detail.eventId)&&Arrays.equals(bytes(body),detail.json)&&detail.fileModified==10&&detail.lineOffset==20);
  for(String invalid:Arrays.asList(line(body).replace("←","→"),line(body).replace("[GET ","[POST "),line(body).replace("xr-api-p.rayneo.cn","unrelated.invalid"),line(body).replace("/full]","/full#fragment]"),line(body).replace("[Interceptor.Http]","[Other]"),"xtcl-access-token: synthetic-only",line(body.substring(0,body.length()-1))))yes(OfficialLifelogLogReader.parse(bytes(invalid),0,0)==null);
  detail=OfficialLifelogLogReader.parse(bytes(line(body).replace(ID,"123456789012345678").replace("/full]","/full?date=2026-10-21]")),0,0);yes(detail!=null&&detail.eventId.equals("123456789012345678"));
  detail=OfficialLifelogLogReader.parse(bytes(line(body).replace(ID,"123456789012345678").replace("/full]","/full?#]")),0,0);yes(detail!=null&&detail.eventId.equals("123456789012345678"));
  yes(OfficialLifelogLogReader.parse(bytes(line(body).replace("https://xr-api-p.rayneo.cn","https://xr-api-p.rayneo.cn@unrelated.invalid")),0,0)==null);
  yes(OfficialLifelogLogReader.parse(new byte[OfficialLifelogLogReader.MAX_LINE+1],0,0)==null);
  try{OfficialLifelogLogReader.parse(new byte[]{(byte)0xc3,(byte)0x28},0,0);throw new AssertionError();}catch(CharacterCodingException expected){checks++;}
  Path root=Paths.get(args[0]);Files.createDirectories(root);Path file=root.resolve("2026-10-21-10.log");
  String large=body.replace("合成原文",String.join("",Collections.nCopies(37717,"字")));Files.write(file,bytes("request headers: synthetic-only\n"+line(large)+"\n"+line(body)));
  List<OfficialLifelogLogReader.Detail> records=new ArrayList<>();OfficialLifelogLogReader.Summary scan=OfficialLifelogLogReader.scan(root.toFile(),records::add);
  yes(scan.details==1&&scan.partialTails==1&&scan.invalidUtf8==0);yes(records.get(0).json.length>100000&&Arrays.equals(bytes(large),records.get(0).json));
  Files.write(file,bytes("\n"),StandardOpenOption.APPEND);records.clear();scan=OfficialLifelogLogReader.scan(root.toFile(),records::add);yes(scan.details==2&&scan.partialTails==0);yes(Arrays.equals(bytes(body),records.get(1).json));
  Path nested=root.resolve("rotated");Files.createDirectories(nested);Files.write(nested.resolve("previous.log"),bytes(line(body)+"\r\n"));
  Path oversized=root.resolve("oversized.log");try(OutputStream out=Files.newOutputStream(oversized)){byte[] block=new byte[8192];Arrays.fill(block,(byte)'x');for(int i=0;i<129;i++)out.write(block);out.write(10);out.write(new byte[]{(byte)0xc3,0x28,10});out.write(bytes(line(body)+"\n"));}
  records.clear();scan=OfficialLifelogLogReader.scan(root.toFile(),records::add);yes(scan.details==4&&scan.oversizedLines==1&&scan.invalidUtf8==1);yes(!scan.budgetReached);
  try{OfficialLifelogLogReader.scan(root.toFile(),d->{throw new IOException("synthetic consumer failure");});throw new AssertionError();}catch(IOException expected){checks++;}
  Path newest=root.resolve("newest.log");Files.write(newest,bytes(line(body)+"\n"));Files.setLastModifiedTime(newest,java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis()+60000));
  records.clear();scan=OfficialLifelogLogReader.scan(root.toFile(),records::add);yes(records.get(0).fileModified==Files.getLastModifiedTime(newest).toMillis());
  try(OutputStream out=Files.newOutputStream(newest,StandardOpenOption.APPEND)){byte[] padding=new byte[8192];Arrays.fill(padding,(byte)' ');padding[8191]=10;for(int i=0;i<1100;i++)out.write(padding);out.write(bytes(line(body)+"\n"));}
  Files.setLastModifiedTime(newest,java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis()+60000));records.clear();scan=OfficialLifelogLogReader.scan(root.toFile(),records::add);yes(newest.toFile().length()>8388608&&scan.details==6&&records.get(1).lineOffset>8388608);
  Path paged=root.resolve("paged");Files.createDirectories(paged);Path recent=paged.resolve("recent.log"),older=paged.resolve("older.log");Files.write(recent,bytes(line(large)+"\n"));Files.write(older,bytes(line(body)+"\n"));Files.setLastModifiedTime(recent,java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis()+60000));
  OfficialLifelogLogReader.Session session=OfficialLifelogLogReader.open(paged.toFile());records.clear();scan=session.next(records::add,1024);yes(scan.budgetReached&&!scan.complete&&records.isEmpty());
  // A growing newest log must not consume the frozen inventory forever.
  Files.write(recent,bytes(line(body)+"\n"),StandardOpenOption.APPEND);int pages=1;long consumed=scan.bytes;
  while(!session.complete()&&pages++<200){scan=session.next(records::add,1024);yes(scan.bytes<=1024);consumed+=scan.bytes;}
  yes(session.complete()&&records.size()==2&&Arrays.equals(records.get(0).json,bytes(large))&&Arrays.equals(records.get(1).json,bytes(body)));
  yes(consumed==bytes(line(large)+"\n"+line(body)+"\n").length);yes(session.next(records::add,1024).bytes==0);
  Path retry=root.resolve("retry");Files.createDirectories(retry);Path retryFile=retry.resolve("source.log");Files.write(retryFile,bytes(line(body)+"\n"+line(large)+"\n"));session=OfficialLifelogLogReader.open(retry.toFile());
  try{session.next(d->{throw new IOException("synthetic durable store failure");},1024);throw new AssertionError();}catch(IOException expected){checks++;}
  records.clear();while(!session.complete())session.next(records::add,1024);yes(records.size()==2&&Arrays.equals(records.get(0).json,bytes(body))&&Arrays.equals(records.get(1).json,bytes(large)));
  session=OfficialLifelogLogReader.open(retry.toFile());records.clear();session.next(records::add,20);Files.write(retryFile,bytes(line(body)+"\n"));scan=session.next(records::add,1024);yes(scan.changedFiles==1&&session.complete()&&records.isEmpty());
  yes(OfficialLifelogLogReader.scan(retry.toFile(),records::add).details==1);
  System.out.println("Official lifelog source: "+checks+" assertions passed");
 }
}
