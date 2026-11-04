package com.turboio.addon;
import java.nio.file.*;import java.util.*;import java.util.concurrent.atomic.*;import java.net.*;import java.io.*;
public final class Fixed60OfficialFeedTest {
 static int n;static void ok(boolean b){n++;if(!b)throw new AssertionError("check "+n);}
 static String request(int port,String target,String extra){return "GET "+target+" HTTP/1.1\r\nHost: 127.0.0.1:"+port+"\r\n"+extra+"\r\n";}
 static Object data(Fixed60OfficialFeed.Reply r){ok(r.code==200);return BoundedJson.map(BoundedJson.read(r.body)).get("data");}
 public static void main(String[] args)throws Exception{
  AtomicLong clock=new AtomicLong(1000);AtomicBoolean guard=new AtomicBoolean(true);
  // Reproduce the migration case: the legacy app still owns the original port.
  try(ServerSocket legacy=new ServerSocket(18794,4,InetAddress.getByName("127.0.0.1"));
      Fixed60OfficialFeed f=new Fixed60OfficialFeed(clock::get,guard::get)){
   int port=f.start(Fixed60OfficialFeed.PORT);ok(port==18795);ok(legacy.isBound());
   for(String path:Fixed60OfficialFeed.PATHS)for(String kind:new String[]{"app","firmware"}){
    String query=path+"?packageType="+kind+"&packageName=strix+OS&glassesType=S3&deviceType=android&versionCode=01.00.05.0005";
    try(Socket s=new Socket("127.0.0.1",port)){
     s.setSoTimeout(2000);s.getOutputStream().write(request(port,query,"").getBytes("UTF-8"));
     ByteArrayOutputStream wire=new ByteArrayOutputStream();byte[] b=new byte[4096];int size;
     while((size=s.getInputStream().read(b))!=-1)wire.write(b,0,size);
     String response=wire.toString("UTF-8");ok(response.startsWith("HTTP/1.1 200 OK"));
     Map<String,Object> body=BoundedJson.map(BoundedJson.read(response.substring(response.indexOf("\r\n\r\n")+4).getBytes("UTF-8")));
     ok(((Number)body.get("error_code")).intValue()==1000);ok(body.get("data")==null);
    }
   }
   ok(!f.armed());ok(f.fullResponses()==0&&f.servedBytes()==0);
  }
  if(args.length==1&&"--coexistence-only".equals(args[0])){
   System.out.println("Fixed60 dual-package update source: "+n+" checks passed; loopback only, no firmware input or device I/O");return;
  }
  byte[] zip=Files.readAllBytes(Paths.get(args[0]));
  try(Fixed60OfficialFeed f=new Fixed60OfficialFeed(clock::get,guard::get)){
   int port=f.start(0);String query=Fixed60OfficialFeed.PATHS[1]+"?packageType=firmware&packageName=strix+OS&glassesType=S3&deviceType=android&versionCode=01.00.05.0005";
   ok(data(f.reply(request(port,query,"")))==null);byte[] caller=zip.clone();f.arm(caller);caller[0]^=1;
   Map<String,Object> meta=BoundedJson.map(data(f.reply(request(port,query,""))));ok(meta.get("apkMd5").equals(Fixed60Firmware.hash("MD5",zip)));ok(((Number)meta.get("apkSize")).intValue()==zip.length);
   String path=new URI((String)meta.get("downloadUrl")).getRawPath();ok(Arrays.equals(zip,f.reply(request(port,path,"" )).body));
   ok(Arrays.equals(Arrays.copyOfRange(zip,100,201),f.reply(request(port,path,"Range: bytes=100-200\r\n")).body));
   ok(f.reply(request(port,path,"Range: bytes=0-9999999999\r\n")).body.length==zip.length);
   ok(f.reply(request(port,path,"Range: bytes=9999999999-\r\n")).code==416);
   ok(f.reply(request(port,path,"Range: bytes=9-2\r\n")).code==416);
   ok(f.reply(request(port,path,"Range: bytes=1-2,4-5\r\n")).code==416);
   ok(f.reply(request(port,path,"Range: bytes=-10\r\n")).code==416);
   ok(f.reply(request(port,path,"Host: evil\r\n")).code==400);
   ok(f.reply(request(port,path,"Transfer-Encoding: chunked\r\n")).code==400);
   ok(f.reply(request(port,path,"Content-Length: 1\r\n")).code==400);
   ok(f.reply(request(port,path,"Content-Length: 0\r\n")).code==200);
   ok(f.reply(request(port,path,"x_client_type: Android\r\n")).code==200);
   ok(f.reply(request(port,path,"x bad: forbidden\r\n")).code==400);
   ok(f.reply(request(port,query+"&packageType=firmware","" )).code==400);
   ok(data(f.reply(request(port,query.replace("android","iOS"),"")))==null);
   ok(data(f.reply(request(port,query.replace("packageType=firmware","packageType=app"),"")))==null);
   ok(data(f.reply(request(port,query.replace("0005","9999"),"")))==null);
   ok(f.reply(request(port,path,"" ).replace("GET ","POST ")).code==405);
   ok(f.reply(request(port,path,"" ).replace("127.0.0.1:","localhost:")).code==400);
   ok(f.reply(request(port,path+"?anything=1","" )).code==404);
   ok(f.reply(request(port,path,"" ).replace("GET ","HEAD ")).head);
   try(Socket s=new Socket("127.0.0.1",port)){s.setSoTimeout(2000);s.getOutputStream().write(request(port,query,"" ).getBytes("UTF-8"));ByteArrayOutputStream all=new ByteArrayOutputStream();byte[] b=new byte[4096];int k;while((k=s.getInputStream().read(b))!=-1)all.write(b,0,k);ok(all.toString("UTF-8").contains("HTTP/1.1 200 OK"));}
   try(Socket socket=new Socket("127.0.0.1",port)){
    socket.setSoTimeout(5000);socket.getOutputStream().write(request(port,path,"").getBytes("UTF-8"));
    ByteArrayOutputStream received=new ByteArrayOutputStream();byte[] buffer=new byte[65536];int size;
    while((size=socket.getInputStream().read(buffer))!=-1)received.write(buffer,0,size);
    byte[] wire=received.toByteArray();int header=-1;
    for(int i=0;i<Math.min(wire.length-3,16384);i++)if(wire[i]==13&&wire[i+1]==10&&wire[i+2]==13&&wire[i+3]==10){header=i+4;break;}
    ok(header>0);ok(Arrays.equals(Arrays.copyOfRange(wire,header,wire.length),zip));ok(f.fullResponses()==1&&f.servedBytes()==zip.length);
   }
   byte[] bad=zip.clone();bad[0]^=1;try{f.arm(bad);throw new AssertionError();}catch(IOException expected){n++;}
   ok(data(f.reply(request(port,query,"")))==null);ok(f.reply(request(port,path,"")).code==404);f.arm(zip);
   clock.set(901000);ok(data(f.reply(request(port,query,"")))==null);ok(f.reply(request(port,path,"" )).code==404);
   f.arm(zip);guard.set(false);ok(data(f.reply(request(port,query,"")))==null);try{f.arm(zip);throw new AssertionError();}catch(IOException expected){n++;}
   guard.set(true);f.arm(zip);f.disarm();ok(data(f.reply(request(port,query,"")))==null);
  }
  try(Fixed60OfficialFeed f=new Fixed60OfficialFeed(clock::get,guard::get,true)){
   int port=f.start(0);f.arm(zip);String query=Fixed60OfficialFeed.PATHS[1]+"?packageType=firmware&packageName=strix+OS&glassesType=S3&deviceType=android&versionCode=01.00.05.0005";
   Map<String,Object> meta=BoundedJson.map(data(f.reply(request(port,query,""))));ok((Fixed60Profile.ID+" GUARDED").equals(meta.get("taskName")));ok(((String)meta.get("updateDesc")).contains("requires separate once-only authorization"));ok(!((String)meta.get("updateDesc")).contains("sending is disabled"));ok(((Number)meta.get("apkSize")).intValue()==Fixed60Profile.ZIP_SIZE);
  }
  for(int type=1;type<=255;type++)ok(OtaFrame.readOnly(OtaFrame.encode(type,null,null))==(type==1||type==2||type==11));
  for(int type:new int[]{1,2,11}){ok(!OtaFrame.readOnly(OtaFrame.encode(type,OtaFrame.object("Mode",2),null)));ok(!OtaFrame.readOnly(OtaFrame.encode(type,null,new byte[]{1})));}
  ok(!OtaFrame.readOnly(new byte[]{8,1,16,4}));
  System.out.println("Fixed60 official preparation source/guard: "+n+" assertions passed; no device I/O");
 }
}
