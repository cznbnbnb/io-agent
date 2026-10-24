package com.turboio.addon;

import java.nio.*;
import java.nio.charset.*;
import java.util.*;

/** Bounded diagnostic reader for the pinned AssistantMsg protobuf. Never used
 * to replace the vendor parser or to authorize recording/source ownership. */
final class AlwaysOnWire {
 static final int MAX_BYTES=65536;
 final int type,version; final String message; private final byte[] data;
 private AlwaysOnWire(int type,int version,String message,byte[] data){this.type=type;this.version=version;this.message=message;this.data=data;}
 byte[] data(){return data.clone();}
 static AlwaysOnWire read(byte[] raw){return read(raw,false);}
 /** Uploadable raw envelopes must not silently carry unknown protobuf fields. */
 static AlwaysOnWire readKnown(byte[] raw){return read(raw,true);}
 private static AlwaysOnWire read(byte[] raw,boolean known){
  require(raw!=null&&raw.length<=MAX_BYTES);Reader r=new Reader(raw);boolean[] seen=new boolean[5];int type=0,version=0;String message="";byte[] data=new byte[0];
  while(r.at<raw.length){long tag=r.number();require(tag>0&&tag<=0xffffffffL);int field=(int)(tag>>>3),wire=(int)(tag&7);require(field>0);
   if(field<=4){require(!seen[field]);seen[field]=true;require(wire==(field<=2?0:2));
    if(field<=2){long n=r.number();require(n>=0&&n<=Integer.MAX_VALUE);if(field==1)version=(int)n;else type=(int)n;}
    else{byte[] b=r.bytes(field==3?16384:MAX_BYTES);if(field==3)try{message=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(b)).toString();}catch(CharacterCodingException invalid){throw new IllegalArgumentException("AUDIO_WIRE_INVALID");}else data=b;}
   }else {require(!known);switch(wire){case 0:r.number();break;case 1:r.skip(8);break;case 2:r.bytes(MAX_BYTES);break;case 5:r.skip(4);break;default:throw new IllegalArgumentException("AUDIO_WIRE_INVALID");}}
  }return new AlwaysOnWire(type,version,message,data);
 }
 private static void require(boolean value){if(!value)throw new IllegalArgumentException("AUDIO_WIRE_INVALID");}
 private static final class Reader {
  final byte[] raw;int at;Reader(byte[] raw){this.raw=raw;}
  long number(){long n=0;for(int i=0;i<10;i++){require(at<raw.length);int b=raw[at++]&255;if(i==9)require((b&254)==0);n|=(long)(b&127)<<(7*i);if((b&128)==0)return n;}throw new IllegalArgumentException("AUDIO_WIRE_INVALID");}
  void skip(int n){require(n>=0&&n<=raw.length-at);at+=n;}
  byte[] bytes(int max){long n=number();require(n>=0&&n<=max&&n<=raw.length-at);byte[] b=Arrays.copyOfRange(raw,at,at+(int)n);at+=(int)n;return b;}
 }
}
