package com.turboio.addon;

import java.io.*;import java.nio.*;import java.nio.charset.StandardCharsets;

/** Bounded Ogg Opus muxer, RFC 7845 sections 3–5 / RFC 3533 section 6.
 * Original packets are copied unchanged. Capture begins mid-session, so pre-skip
 * is zero and the exported files are explicitly labelled as received fragments. */
final class OpusFile {
 private final OutputStream out;private final int serial;private int page;private long granule;private byte[] pending;private boolean finished;
 OpusFile(OutputStream out,int serial)throws IOException{this.out=out;this.serial=serial;ByteBuffer head=ByteBuffer.allocate(19).order(ByteOrder.LITTLE_ENDIAN);head.put("OpusHead".getBytes(StandardCharsets.US_ASCII)).put((byte)1).put((byte)1).putShort((short)0).putInt(16000).putShort((short)0).put((byte)0);page(head.array(),2,0);byte[] vendor="iO Agent received audio fragments".getBytes(StandardCharsets.UTF_8);ByteBuffer tags=ByteBuffer.allocate(16+vendor.length).order(ByteOrder.LITTLE_ENDIAN);tags.put("OpusTags".getBytes(StandardCharsets.US_ASCII)).putInt(vendor.length).put(vendor).putInt(0);page(tags.array(),0,0);}
 static int samples48(byte[] b)throws IOException{LifelogAudioLibrary.require(b!=null&&b.length>0&&b.length<=8192,"AUDIO_OPUS_PACKET_SIZE");int toc=b[0]&255;LifelogAudioLibrary.require((toc&4)==0,"AUDIO_OPUS_CHANNEL_UNSUPPORTED");int per=(toc&128)!=0?(48000<<((toc>>3)&3))/400:(toc&96)==96?((toc&8)!=0?960:480):((toc>>3)&3)==3?2880:(48000<<((toc>>3)&3))/100;int code=toc&3,count=code==0?1:code==3?(b.length<2?0:b[1]&63):2;LifelogAudioLibrary.require(count>0&&per*count<=5760,"AUDIO_OPUS_PACKET_DURATION");return per*count;}
 void packet(byte[] data)throws IOException{LifelogAudioLibrary.require(!finished,"AUDIO_OPUS_FINISHED");int samples=samples48(data);if(pending!=null)page(pending,0,granule);pending=data.clone();granule+=samples;}
 long finish()throws IOException{LifelogAudioLibrary.require(!finished&&pending!=null,"AUDIO_EXPORT_NO_FRAMES");page(pending,4,granule);pending=null;finished=true;return granule;}
 private void page(byte[] data,int flags,long position)throws IOException{int segments=data.length/255+1;LifelogAudioLibrary.require(segments<=255,"AUDIO_OGG_PAGE_SIZE");ByteBuffer b=ByteBuffer.allocate(27+segments+data.length).order(ByteOrder.LITTLE_ENDIAN);b.put("OggS".getBytes(StandardCharsets.US_ASCII)).put((byte)0).put((byte)flags).putLong(position).putInt(serial).putInt(page++).putInt(0).put((byte)segments);int remaining=data.length;for(int i=0;i<segments;i++){int n=Math.min(255,remaining);b.put((byte)n);remaining-=n;}b.put(data);byte[] bytes=b.array();int crc=0;for(byte x:bytes){crc^=(x&255)<<24;for(int bit=0;bit<8;bit++)crc=(crc<<1)^((crc&0x80000000)!=0?0x04c11db7:0);}b.putInt(22,crc);out.write(bytes);}
}
