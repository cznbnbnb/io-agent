package com.turboio.addon;

import java.io.*;
import java.util.*;

/** Owned recording-service byte stream -> per-capture decoder -> mono ASR input.
 * V1 profile comes from the existing inspected recording path: 240-byte/20ms Opus
 * frames at 16 kHz. Current physical source must still be checked before admission.
 * No command is sent here, no ordinary recording is adopted, and an end packet
 * never certifies physical microphone shutdown. */
final class RecordingVoiceSource {
 interface Decoder {byte[] decode(byte[] packet)throws Exception;}
 // One 240-byte packet per 20 ms. Sized from the capture limit plus 4 s of tail (2026-10-23: the
 // 60 s limit kept a 32 s buffer and a 35 s answer failed with VOICE_RECORDING_RANGE_INVALID).
 static final int PACKET_BYTES=240,PCM_BYTES=640,MAX_PACKETS=(VoiceAnswerSession.CAPTURE_SECONDS+4)*50,MAX_BYTES=MAX_PACKETS*PACKET_BYTES;
 /** The recording service sends stereo Opus: left is the wearer's bone-conduction
  * microphone, right the environment microphone (2026-10-22 device measurement:
  * speaker playback and a bystander appear only on the right). Dictation keeps
  * the left channel so other people's speech never becomes the wearer's answer. */
 static byte[] wearerChannel(byte[] stereo){
  TaskWire.require(stereo!=null&&stereo.length>0&&stereo.length%4==0,"VOICE_PCM_INVALID");
  byte[] left=new byte[stereo.length/2];for(int i=0,o=0;i<stereo.length;i+=4,o+=2){left[o]=stereo[i];left[o+1]=stereo[i+1];}return left;
 }
 private final String token,peerHash;private final long generation;
 private final VoiceAudioArchive archive;private final Decoder decoder;
 private final byte[] source=new byte[MAX_BYTES];private final BitSet present=new BitSet(MAX_BYTES);
 private int end,contiguous,decoded;private boolean failed,complete;
 RecordingVoiceSource(String token,String peer,long generation,VoiceAudioArchive archive,Decoder decoder){
  TaskWire.require(token!=null&&token.matches("[a-f0-9]{32}")&&peer!=null&&!peer.isEmpty()&&generation>0&&archive!=null&&archive.matches(token,14)&&decoder!=null,"VOICE_SOURCE_INVALID");
  this.token=token;peerHash=FixedPeerHash.of(peer);this.generation=generation;this.archive=archive;this.decoder=decoder;
 }
 private boolean owner(String peer,long generation){return peer!=null&&peerHash.equals(FixedPeerHash.of(peer))&&this.generation==generation;}
 private IOException failure(String code){failed=true;archive.incomplete();return new IOException(code);}
 private OtaFrame own(String peer,long generation,byte[] envelope)throws IOException{
  if(!owner(peer,generation))return null;
  try{
   if(envelope==null||envelope.length>16384)throw new IllegalArgumentException();
   OtaFrame f=OtaFrame.decode(envelope);Map<String,Object> body=WireJson.map(f.json);
   return token.equals(body.get("uuid"))?f:null;
  }catch(RuntimeException invalid){throw failure("VOICE_RECORDING_ENVELOPE_INVALID");}
 }
 /** null means unrelated; empty PCM means a valid split/duplicate with no new frame. */
 synchronized byte[] audio(String peer,long generation,byte[] envelope)throws Exception{
  OtaFrame f=own(peer,generation,envelope);if(f==null||f.type!=3)return null;
  // Preserve the exact received envelope before decoding or rejecting a conflicting span.
  try{archive.original(envelope);}catch(Exception unavailable){throw failure("VOICE_RECORDING_ARCHIVE_FAILED");}
  if(failed||complete)throw failure("VOICE_RECORDING_ALREADY_ENDED");
  try{
   Map<String,Object> body=WireJson.map(f.json);long at=TaskWire.nonnegative(body.get("offset"));
   if(f.binary.length==0||at>MAX_BYTES-f.binary.length)throw failure("VOICE_RECORDING_RANGE_INVALID");
   int offset=(int)at,limit=offset+f.binary.length;
   for(int i=offset;i<limit;i++)if(present.get(i)&&source[i]!=f.binary[i-offset])throw failure("VOICE_RECORDING_OVERLAP_CONFLICT");
   System.arraycopy(f.binary,0,source,offset,f.binary.length);present.set(offset,limit);end=Math.max(end,limit);
   contiguous=Math.min(end,present.nextClearBit(contiguous));
   ByteArrayOutputStream pcm=new ByteArrayOutputStream();
   while(decoded+PACKET_BYTES<=contiguous){
    byte[] frame=decoder.decode(Arrays.copyOfRange(source,decoded,decoded+PACKET_BYTES));
    if(frame==null||frame.length!=PCM_BYTES)throw failure("VOICE_RECORDING_FORMAT_UNVERIFIED");
    pcm.write(frame);decoded+=PACKET_BYTES;
   }
   byte[] ready=pcm.toByteArray();archive.decodedRecording(ready);return ready;
  }catch(Exception error){failed=true;archive.incomplete();throw error;}
 }
 synchronized boolean ended(String peer,long generation,byte[] envelope)throws IOException{
  OtaFrame f=own(peer,generation,envelope);if(f==null||f.type!=6)return false;
  Map<String,Object> body=WireJson.map(f.json);
  if(!Boolean.TRUE.equals(body.get("completed"))||f.binary.length!=0)return false;
  if(failed||end==0||contiguous!=end||end%PACKET_BYTES!=0||decoded!=end)throw failure("VOICE_RECORDING_INCOMPLETE");
  try{archive.recordingComplete(token,end,decoded/PACKET_BYTES);}catch(IOException invalid){throw failure("VOICE_RECORDING_INCOMPLETE");}
  complete=true;return true;
 }
 synchronized boolean complete(){return complete&&!failed;}
 synchronized int opusBytes(){return end;}
 synchronized int decodedPackets(){return decoded/PACKET_BYTES;}
}
