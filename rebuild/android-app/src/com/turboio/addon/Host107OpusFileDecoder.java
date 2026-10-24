package com.turboio.addon;
import java.io.*;import java.util.Arrays;

/** Private decoder for validating a derived export; never the live ASR decoder. */
final class Host107OpusFileDecoder implements LifelogAudioExport.Decoder {
 private Object decoder;
 Host107OpusFileDecoder()throws IOException{try{Class.forName("com.rayneo.airuntime.AiRuntimeNative");decoder=Class.forName("com.rayneo.airuntime.utils.OpusDecoder").getConstructor().newInstance();if(!Boolean.TRUE.equals(NavReflect.call(decoder,"init-uN6NtqM",16000,2)))throw new IOException("AUDIO_EXPORT_DECODER_INIT");}catch(Exception failed){try{close();}catch(IOException ignored){}throw new IOException("AUDIO_EXPORT_DECODER_INIT");}}
 public void validate(byte[] packet,int samples48)throws IOException{byte[] pcm=null;try{pcm=(byte[])NavReflect.call(decoder,"decode2Bytes",packet);LifelogAudioLibrary.require(pcm!=null&&pcm.length==samples48/3*4,"AUDIO_EXPORT_DECODE_FAILED");}catch(Exception failed){throw new IOException("AUDIO_EXPORT_DECODE_FAILED");}finally{if(pcm!=null)Arrays.fill(pcm,(byte)0);}}
 public void close()throws IOException{Object held=decoder;decoder=null;if(held!=null)try{NavReflect.call(held,"release");}catch(Exception failed){throw new IOException("AUDIO_EXPORT_DECODER_RELEASE");}}
}
