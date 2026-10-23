package com.turboio.addon;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Business-17 TransferMessage protobuf for one prompter manuscript, ported from the
 * verified HarmonyOS turbo_core FileTransfer. The file UUID is the prompter DID; the
 * glasses pull chunks, so nothing is pushed beyond the info message. No paths. */
final class PrompterFile {
 static final class Message {
  int type;String uuid="",fileName="",md5="",reason="";long fileSize,chunkId,start,size,state,busId=17;byte[] data=new byte[0];
 }
 private static void require(boolean ok,String code){if(!ok)throw new IllegalArgumentException(code);}
 private static void varint(ByteArrayOutputStream out,long n){require(n>=0,"file-integer");do{int b=(int)(n&127);n>>>=7;out.write(b|(n!=0?128:0));}while(n!=0);}
 private static byte[] ascii(String s,int max){require(s.length()<=max&&s.matches("[\\x20-\\x7e]*"),"file-ascii");return s.getBytes(StandardCharsets.US_ASCII);}
 private static void blob(ByteArrayOutputStream out,int field,byte[] data){varint(out,field*8L+2);varint(out,data.length);out.write(data,0,data.length);}
 private static void scalar(ByteArrayOutputStream out,int field,long n){varint(out,field*8L);varint(out,n);}
 static byte[] encode(Message m){
  require(m.uuid.matches("[A-Za-z0-9-]{1,64}"),"file-uuid");ByteArrayOutputStream body=new ByteArrayOutputStream();blob(body,1,ascii(m.uuid,64));
  if(m.type==1){require((m.fileName.equals(m.uuid)||m.fileName.equals(m.uuid+".txt"))&&m.md5.matches("[a-f0-9]{32}")&&(m.busId==17||m.busId==18)&&m.fileSize>=1&&m.fileSize<=48000,"file-info");
   blob(body,2,ascii(m.fileName,68));scalar(body,3,m.fileSize);blob(body,4,ascii(m.md5,32));scalar(body,5,m.busId);}
  else if(m.type==3||m.type==4){require(m.chunkId<=0xffffffffL&&m.start<=48000&&m.size>=1&&m.size<=20480,"file-chunk");scalar(body,2,m.chunkId);scalar(body,3,m.start);scalar(body,4,m.size);
   if(m.type==4){require(m.data.length==m.size,"file-chunk-size");blob(body,5,m.data);}}
  else if(m.type==5){require(m.state==0||m.state==1,"file-state");scalar(body,2,m.state);if(!m.reason.isEmpty())blob(body,3,ascii(m.reason,120));}
  else if(m.type==6){if(!m.reason.isEmpty())blob(body,2,ascii(m.reason,120));}
  else require(m.type==2,"file-message-type");
  ByteArrayOutputStream out=new ByteArrayOutputStream();blob(out,m.type,body.toByteArray());return out.toByteArray();
 }
 private static final class Field {int key,wire;long value;byte[] data=new byte[0];}
 private static List<Field> fields(byte[] bytes){
  require(bytes.length<=22000,"file-message-size");List<Field> out=new ArrayList<>();int[] at={0};
  while(at[0]<bytes.length){require(out.size()<16,"file-field-count");long tag=read(bytes,at);Field f=new Field();f.key=(int)(tag>>>3);f.wire=(int)(tag&7);
   for(Field old:out)require(old.key!=f.key,"file-duplicate-field");require(f.key>0,"file-field");
   if(f.wire==0)f.value=read(bytes,at);else if(f.wire==2){long n=read(bytes,at);require(n<=bytes.length-at[0],"file-truncated");f.data=Arrays.copyOfRange(bytes,at[0],at[0]+(int)n);at[0]+=(int)n;}
   else throw new IllegalArgumentException("file-wire");out.add(f);}
  return out;
 }
 private static long read(byte[] b,int[] at){long n=0;for(int i=0;i<8;i++){require(at[0]<b.length,"file-truncated");int v=b[at[0]++]&255;n|=(long)(v&127)<<(7*i);if((v&128)==0)return n;}throw new IllegalArgumentException("file-varint");}
 private static Field find(List<Field> list,int key){for(Field f:list)if(f.key==key)return f;return null;}
 private static String text(List<Field> list,int key,int max){Field f=find(list,key);if(f==null)return "";require(f.wire==2&&f.data.length<=max,"file-field");String s=new String(f.data,StandardCharsets.US_ASCII);require(s.matches("[\\x20-\\x7e]*"),"file-ascii");return s;}
 private static long number(List<Field> list,int key){Field f=find(list,key);if(f==null)return 0;require(f.wire==0,"file-field");return f.value;}
 static Message decode(byte[] bytes){
  List<Field> outer=fields(bytes);require(outer.size()==1&&outer.get(0).wire==2&&outer.get(0).key>=1&&outer.get(0).key<=6,"file-oneof");
  Message m=new Message();m.type=outer.get(0).key;List<Field> list=fields(outer.get(0).data);m.uuid=text(list,1,64);require(m.uuid.matches("[A-Za-z0-9-]{1,64}"),"file-uuid");
  if(m.type==1){m.fileName=text(list,2,68);m.fileSize=number(list,3);m.md5=text(list,4,32);m.busId=number(list,5);}
  if(m.type==3||m.type==4){m.chunkId=number(list,2);m.start=number(list,3);m.size=number(list,4);Field data=find(list,5);if(data!=null){require(data.wire==2,"file-field");m.data=data.data;}
   require(m.chunkId<=0xffffffffL&&m.start<=48000&&m.size>=1&&m.size<=20480&&(m.type!=4||m.data.length==m.size),"file-chunk-size");}
  // Proto3 omits the zero SUCCESS state; absence is valid, not a missing ACK.
  if(m.type==5){m.state=number(list,2);require(m.state<=1,"file-state");m.reason=text(list,3,120);}
  if(m.type==6)m.reason=text(list,2,120);
  return m;
 }
 /** One manuscript. Owner sends info(), answers each pull with the returned chunk, then calls committed(). */
 static final class Outbound {
  final String uuid;private final byte[] bytes;private final String md5;boolean acknowledged,complete,cancelled;long sentBytes;
  private final List<long[]> ranges=new ArrayList<>();private final Map<Long,String> descriptors=new HashMap<>();private int requests;
  Outbound(String uuid,byte[] bytes,String md5){this.uuid=uuid;this.bytes=bytes.clone();this.md5=md5;encode(info(1));}
  private Message info(int type){Message m=new Message();m.type=type;m.uuid=uuid;m.fileName=uuid;m.fileSize=bytes.length;m.md5=md5;m.busId=17;return m;}
  byte[] info(){return encode(info(1));}
  byte[] cancel(String reason){Message m=new Message();m.type=6;m.uuid=uuid;m.reason=reason;return encode(m);}
  Message receive(byte[] input){
   Message m=decode(input);if(!m.uuid.equals(uuid)||cancelled||complete)return null;
   if(m.type==2){acknowledged=true;return null;}
   if(m.type==6){cancelled=true;throw new IllegalStateException("file-peer-cancelled");}
   if(m.type==5){require(m.state==0,"file-peer-failed");require(sentBytes==bytes.length,"file-premature-success");complete=true;return null;}
   if(m.type!=3)return null;
   require(acknowledged,"file-request-before-ack");require(++requests<=256&&m.start<bytes.length,"file-request-limit");
   String descriptor=m.start+":"+m.size,old=descriptors.get(m.chunkId);require(old==null||old.equals(descriptor),"file-chunk-id-conflict");descriptors.put(m.chunkId,descriptor);
   Message out=new Message();out.type=4;out.uuid=uuid;out.chunkId=m.chunkId;out.start=m.start;out.size=Math.min(m.size,bytes.length-m.start);out.data=Arrays.copyOfRange(bytes,(int)out.start,(int)(out.start+out.size));return out;
  }
  void committed(Message m){
   require(!cancelled&&m.uuid.equals(uuid)&&m.type==4&&m.data.length==m.size&&m.start+m.size<=bytes.length,"file-commit");
   ranges.add(new long[]{m.start,m.start+m.size});ranges.sort(Comparator.comparingLong(r->r[0]));List<long[]> merged=new ArrayList<>();
   for(long[] r:ranges){long[] last=merged.isEmpty()?null:merged.get(merged.size()-1);if(last!=null&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else merged.add(new long[]{r[0],r[1]});}
   ranges.clear();ranges.addAll(merged);long n=0;for(long[] r:merged)n+=r[1]-r[0];sentBytes=n;
  }
  void close(){cancelled=true;Arrays.fill(bytes,(byte)0);ranges.clear();descriptors.clear();}
 }
}
