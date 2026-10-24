package com.turboio.addon;
import java.util.*;
public final class AlwaysOnAudioBatchTest {
 private static int checks;private static void yes(boolean b){checks++;if(!b)throw new AssertionError(checks);}private static void reject(String json,int size){try{AlwaysOnAudioBatch.parse(json,new byte[size]);throw new AssertionError("accepted");}catch(IllegalArgumentException expected){checks++;}}
 public static void main(String[] args){
  Random r=new Random(37);for(int size:new int[]{0,1,239,240,241,480,7440,7680,16384})for(int declared:new int[]{-1,0,1,2,31,32,100}){
   byte[] data=new byte[size];r.nextBytes(data);String msg="{\"taskId\":\"synthetic-a3\",\"mode\":2,\"frameCount\":"+declared+",\"vpuMask\":5,\"vadMask\":2}";AlwaysOnAudioBatch b=AlwaysOnAudioBatch.parse(msg,data);int count=Math.min(size/240,Math.max(0,Math.min(31,declared)));
   yes(b.frames.size()==count);yes(Arrays.equals(b.original(),data));yes(b.unparsedBytes==size-count*240);yes(b.clamped==(declared!=count||size%240!=0));yes(b.modern);
   for(int i=0;i<count;i++){AlwaysOnAudioBatch.Frame f=b.frames.get(i);yes(f.index==i&&f.count==count&&f.mode==2&&f.flagsPresent);yes(f.vpu==((5L>>>i&1)!=0)&&f.vad==((2L>>>i&1)!=0));yes(Arrays.equals(f.bytes(),Arrays.copyOfRange(data,i*240,(i+1)*240)));}
   if(size>0){byte first=data[0];data[0]^=1;yes(b.original()[0]==first);byte[] copy=b.original();copy[0]^=1;yes(b.original()[0]==first);}
  }
  AlwaysOnAudioBatch legacy=AlwaysOnAudioBatch.parse("{\"vpu\":1,\"vad\":0}",new byte[241]);yes(!legacy.modern&&legacy.frames.size()==1&&legacy.frames.get(0).bytes().length==241&&legacy.taskId==null&&legacy.frames.get(0).flagsPresent);
  AlwaysOnAudioBatch missing=AlwaysOnAudioBatch.parse("{\"mode\":null}",new byte[480]);yes(missing.frames.size()==2&&!missing.frames.get(0).flagsPresent);
  AlwaysOnAudioBatch reset=AlwaysOnAudioBatch.parse("{\"frameCount\":1}",new byte[240]);yes(reset.frames.get(0).index==0);yes(AlwaysOnAudioBatch.parse("{\"frameCount\":1}",new byte[240]).frames.get(0).index==0);
  for(String bad:new String[]{"[]","{\"mode\":1,\"mode\":2}","{\"mode\":\"1\"}","{\"mode\":1.1}","{\"mode\":2147483648}","{\"taskId\":\"../other\"}","{\"frameCount\":true}","{\"unknown\":1}"})reject(bad,240);reject("{}",16385);
  try{legacy.frames.clear();throw new AssertionError();}catch(UnsupportedOperationException expected){checks++;}
  System.out.println("AlwaysOn audio batch: "+checks+" checks passed; synthetic only, no recording completeness claims");
 }
}
